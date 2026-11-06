import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const core=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const scriptVersion=source.match(/^\/\/ @version\s+(\S+)/m)?.[1]??null;

export function stockSnapshotsFromLog(log) {
  const events=Array.isArray(log?.days)?log.days.flatMap(d=>d.events||[]):log?.events;
  if(!Array.isArray(events))throw Error('Expected a script log export');
  const frames=new Map();let legacy=0;
  for(const event of events.filter(e=>e.type==='stock-observation')){
    const d=event.data;
    if(!d||d.truncated||!d.snapshot)throw Error('Observation data was truncated or is missing; do not evaluate incomplete samples');
    const id=d.observationId??`legacy-${legacy++}`,part=d.part??0,total=d.totalParts??1,at=d.at;
    if(!Number.isFinite(at)||!Number.isInteger(total)||total<1||total>1000||!Number.isInteger(part)||part<0||part>=total||
      !Array.isArray(d.snapshot.stocks)||!Array.isArray(d.snapshot.ticks))throw Error('Invalid observation frame');
    if(!frames.has(id))frames.set(id,{at,total,parts:new Map(),version:event.version??log.version??null,settings:d.settings??null});
    const frame=frames.get(id),previous=frame.parts.get(part);
    if(frame.at!==at||frame.total!==total||frame.version!==(event.version??log.version??null)||
      JSON.stringify(frame.settings)!==JSON.stringify(d.settings??null)||previous&&JSON.stringify(previous)!==JSON.stringify(d.snapshot))
      throw Error('Conflicting observation parts');
    frame.parts.set(part,d.snapshot);
  }
  if(!frames.size)throw Error('No observation snapshots in this export; trade summaries cannot substitute for market history');
  const snapshots=[];
  for(const frame of frames.values()){
    if(frame.parts.size!==frame.total)throw Error('Incomplete observation frame; one or more parts are missing');
    const parts=Array.from({length:frame.total},(_,i)=>frame.parts.get(i)),first=parts[0];
    if(parts.some(p=>p.userId!==first.userId||p.enabled!==first.enabled||JSON.stringify(p.rules)!==JSON.stringify(first.rules)))
      throw Error('Conflicting observation market or rules');
    snapshots.push({at:frame.at,sourceVersion:frame.version,recordedSettings:frame.settings,
      view:{...first,stocks:parts.flatMap(p=>p.stocks),ticks:parts.flatMap(p=>p.ticks),positions:[],rounds:[],myBets:[]}});
  }
  snapshots.sort((a,b)=>a.at-b.at);
  return snapshots;
}

// Offline only. Every decision sees only the snapshot and ticks available at that timestamp.
export function replayStock({snapshots,initialBalance=10000,config={},holdMs=3600000,executionDelayMs=0}) {
  if(!Array.isArray(snapshots)||!snapshots.length||!Number.isSafeInteger(initialBalance)||initialBalance<0||
      !Number.isSafeInteger(holdMs)||holdMs<0||!Number.isSafeInteger(executionDelayMs)||executionDelayMs<0)throw Error('Invalid replay input');
  const cfg={trade:true,predict:false,tradeLimit:3000,predictionLimit:0,stake:0,reserve:100,...config,predict:false};
  if(!config||typeof config!=='object'||Array.isArray(config)||typeof cfg.trade!=='boolean'||
    ['autoBudget','netEfficiency'].some(k=>cfg[k]!==undefined&&typeof cfg[k]!=='boolean')||
    ['tradeLimit','predictionLimit','stake','reserve'].some(k=>!core.whole(cfg[k])||cfg[k]>1e12)||
    ['dailyBuyLimit','positionLimit','perStockLimit','riskLimit','cashReserve','lossLimit'].some(k=>cfg[k]!=null&&(!core.whole(cfg[k])||cfg[k]>1e12)))
    throw Error('Invalid replay configuration');
  const ledger={owned:{},entries:[]},positions=[],trades=[],orders=[],curve=[],identities=new Map();
  const account=snapshots[0].view?.userId;
  let balance=initialBalance,peak=initialBalance,maxDrawdown=0,previous=-Infinity,feesAndRounding=0,missingValuationSamples=0,pending=null,halt=null;
  for(const sample of snapshots){
    const at=typeof sample.at==='number'?sample.at:Date.parse(sample.at);
    if(!Number.isFinite(at)||at<=previous)throw Error('Snapshots must have unique increasing timestamps');
    previous=at;
    const view=structuredClone(sample.view);
    if(!view||!Array.isArray(view.ticks))throw Error('Snapshot market data missing');
    if(view.userId!==account)throw Error('Snapshots from different accounts cannot share a portfolio');
    for(const s of view.stocks||[]){
      if(identities.has(String(s.id))&&identities.get(String(s.id))!==s.modelName)throw Error('Stock identity changed between snapshots');
      identities.set(String(s.id),s.modelName);
    }
    view.ticks=view.ticks.filter(t=>Number.isFinite(Date.parse(t.createdAt))&&Date.parse(t.createdAt)<=at);
    view.positions=structuredClone(positions);view.myBets=[];view.rounds=[];
    const model=core.model(view,{tokens:balance});if(!model)throw Error('Snapshot does not match the verified stock contract');
    if(!pending&&!halt){
      const action=core.choose(model,cfg,ledger,at);
      if(action){
        const order={id:String(orders.length+1),decisionAt:at,dueAt:at+executionDelayMs,action:action.action,
          stockId:action.stockId,modelName:action.modelName,shares:action.shares,
          reservedTokens:action.action==='buy'?action.debit:0,status:'pending'};
        if(!Number.isSafeInteger(order.dueAt))throw Error('Delayed order time outside supported range');
        orders.push(order);pending={action,order};
      }
    }
    if(pending&&at>=pending.order.dueAt){
      const {action,order}=pending,stock=view.stocks.find(s=>core.sameStockId(s.id,action.stockId)),buy=action.action==='buy',r=model.rules;
      const amount=stock?core.quote(stock.priceCents,action.shares,buy?r.buyFeePct:r.sellFeePct,buy):null;
      const pos=positions.find(p=>core.sameStockId(p.stockId,action.stockId)),held=positions.reduce((sum,p)=>sum+p.costBasisTokens,0);
      let reason=!view.enabled?'market-disabled':!stock?'missing-quote':stock.suspended?'suspended':stock.stale?'stale-quote':
        amount===null?'unrepresentable-quote':null;
      if(!reason&&buy)reason=amount>balance?'cash':amount>r.maxTradeTokens?'trade-limit':
        core.spend(ledger.entries,'buy',at)+amount>r.maxDailyBuyTokens?'daily-limit':held+amount>r.maxPositionTokens?'position-limit':null;
      if(!reason&&!buy)reason=!pos||pos.shares<action.shares?'position':Date.parse(pos.holdUntil)>at?'holding-period':
        BigInt(stock.priceCents)*BigInt(action.shares)>BigInt(r.maxTradeTokens)*100n?'trade-limit':
        BigInt(stock.priceCents)*BigInt(action.shares)>BigInt(r.reserveTokens)*100n?'liquidity':amount===0?'zero-proceeds':null;
      Object.assign(order,{resolvedAt:at,observationLagMs:at-order.dueAt,status:reason?'unfilled':'filled'});
      pending=null;
      if(reason)order.reason=reason;
      else {
        order.amount=amount;order.priceCents=stock.priceCents;order.reservationExceeded=buy&&amount>order.reservedTokens;
        const gross=stock.priceCents*action.shares/100;
        const entry={id:order.id,at,confirmedAt:at,stockId:stock.id,modelName:stock.modelName,
          action:action.action,shares:action.shares,result:'success',debit:buy?amount:0};
        if(buy){
          balance-=amount;feesAndRounding+=amount-gross;
          positions.push({stockId:stock.id,shares:action.shares,costBasisTokens:amount,holdUntil:new Date(at+holdMs).toISOString()});
          ledger.owned[String(stock.id)]={shares:action.shares,cost:amount,modelName:stock.modelName,manual:false};
        }else{
          const before=pos.costBasisTokens;
          const remaining=pos.shares-action.shares;
          pos.costBasisTokens=Number((BigInt(before)*BigInt(remaining)+BigInt(pos.shares)-1n)/BigInt(pos.shares));pos.shares=remaining;
          entry.releasedCost=before-pos.costBasisTokens;entry.proceeds=amount;balance+=amount;feesAndRounding+=gross-amount;
          if(remaining)ledger.owned[String(stock.id)]={shares:remaining,cost:pos.costBasisTokens,modelName:stock.modelName,manual:false};
          else {positions.splice(positions.indexOf(pos),1);delete ledger.owned[String(stock.id)];}
        }
        ledger.entries.push(entry);trades.push({...entry,decisionAt:order.decisionAt,priceCents:stock.priceCents,reason:action.reason});
        // Match stockReconcile: a completed over-budget buy is retained, then all automatic trading stops.
        // A later quote or rolling-budget release cannot silently resume the real script's held state.
        if(buy&&(amount>order.reservedTokens||!cfg.autoBudget&&core.spend(ledger.entries,'buy',at)>cfg.tradeLimit))
          halt={at,orderId:order.id,reason:amount>order.reservedTokens?'buy-reservation-exceeded':'buy-budget-exceeded',
            reservedTokens:order.reservedTokens,actualTokens:amount};
      }
    }
    let value=balance,unknown=0;
    for(const pos of positions){
      const stock=view.stocks.find(s=>core.sameStockId(s.id,pos.stockId));
      const liquidation=stock&&!stock.stale&&!stock.suspended?core.quote(stock.priceCents,pos.shares,model.rules.sellFeePct,false):null;
      if(liquidation===null){unknown++;value+=pos.costBasisTokens;}else value+=liquidation;
    }
    peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,peak?1-value/peak:0);
    if(unknown)missingValuationSamples++;
    const investedCost=positions.reduce((sum,pos)=>sum+pos.costBasisTokens,0);
    curve.push({at,cash:balance,investedCost,estimatedEquity:value,unknownPositions:unknown});
  }
  const equity=curve.at(-1).estimatedEquity;
  // 每笔模拟成交后的成本保持到下一次快照；末点没有后续观察时间，不外推占用时长。
  const observedDurationMs=curve.at(-1).at-curve[0].at;
  const costTime=curve.slice(0,-1).reduce((sum,point,i)=>sum+point.investedCost*(curve[i+1].at-point.at),0);
  const capitalUsage={basis:'cost-basis',peakCost:curve.reduce((peak,p)=>Math.max(peak,p.investedCost),0),
    endingCost:curve.at(-1).investedCost,timeWeightedAverageCost:observedDurationMs?costTime/observedDurationMs:null,observedDurationMs};
  const execution={submitted:orders.length,filled:trades.length,unfilled:orders.filter(o=>o.status==='unfilled').length,
    pending:Number(Boolean(pending)),overReservation:orders.filter(o=>o.reservationExceeded).length,complete:!pending,halt};
  return {kind:'offline-simulation',samples:snapshots.length,initialBalance,endingCash:balance,estimatedEquity:equity,
    simulation:{scriptVersion,config:cfg,holdMs,executionDelayMs,fillPolicy:'first-observed-snapshot-at-or-after-delay',
      from:curve[0].at,to:curve.at(-1).at,initialPositions:'empty',usesRecordedSettings:false},
    observation:{versions:[...new Set(snapshots.map(s=>s.sourceVersion).filter(Boolean))],
      settings:[...new Map(snapshots.filter(s=>s.recordedSettings).map(s=>[JSON.stringify(s.recordedSettings),s.recordedSettings])).values()]},
    net:pending||curve.at(-1).unknownPositions?null:equity-initialBalance,maxDrawdown:pending||missingValuationSamples?null:maxDrawdown,
    valuationComplete:missingValuationSamples===0,missingValuationSamples,feesAndRounding,baselineNoTrade:initialBalance,
    capitalUsage,execution,orders,trades,positions,curve,assumptions:[
      '仅使用每个决策时点已出现的数据；输入必须是独立保存的历史快照。',
      `模拟按决策时固定股数下单，等待至少${executionDelayMs}毫秒后用首个已有快照的报价与规则评估整单成交；不插值、不缩单。实际等待及快照滞后另列，样本结束仍待定时不输出完整净收益或回撤。`,
      '成交只模拟公开手续费、取整、现金、单笔/日买入/持仓上限及卖出储备；规则不满足记未成交，不伪称真实服务器拒绝。市价可以超过下单前的报价预留，超额另记，不保证真实市场能按此价成交。',
      '买入成交超过原预留，或非自动资金模式累计买入超过设置额度时，沿用脚本的停止交易规则：保留实际成交及持仓，记录execution.halt，后续不自动买卖；继续观察估值和资金占用，不模拟人工恢复。暂停本身不等于缺少成交结果，execution.complete只表示没有待定订单。',
      '各快照的行情和系统储备视为外部条件；不模拟自身买卖对后续价格或储备的影响，也不复现服务器撮合与重试。',
      '持有期由输入holdMs指定，从模拟成交开始；每个快照最多一笔新决策，存在待定订单时不再下单。缺失或停牌报价暂按成本估值并标记。',
      '模拟从空仓开始，使用报告中的config；观察时的设置仅保留作对照，不自动代入或复现真实账号已有持仓。',
      '资金占用按含买入费用的剩余持仓成本计算，不含尚未成交的报价预留；部分卖出只释放对应成本。平均值按相邻快照的实际间隔加权，不按采样次数平均。仅一个时点时无法计算平均占用，不外推末点之后的持仓时间。',
      '预测未参与模拟；结果不能作为真实收益或未来盈利证明。'
    ]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: node arkengine-stock-replay.mjs input.json [output.json]');
  const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=replayStock({...input,snapshots:input.snapshots??stockSnapshotsFromLog(input)});
  const json=JSON.stringify(result,null,2)+'\n';
  if(process.argv[3])writeFileSync(process.argv[3],json);else process.stdout.write(json);
}
