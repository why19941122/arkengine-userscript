import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const minute=60000;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const sid=id=>typeof id==='string'&&id.length>0||positive(id);
const date=at=>new Date(at+8*60*minute).toISOString().slice(0,10);
const validFee=n=>Number.isFinite(n)&&n>=0&&n<100;

// 只还原诊断中确实保存的字段。没有账户、完整交易规则或回执，不伪造可交易的view。
export function stockDiagnosticsFromLog(log){
  const events=Array.isArray(log?.days)?log.days.flatMap(d=>d.events||[]):log?.events;
  if(!Array.isArray(events))throw Error('Expected script log events');
  const groups=new Map();
  for(const e of events){
    if(!['stock-decision','stock-decision-detail'].includes(e.type))continue;
    const d=e.data;if(!d||typeof d.diagnosticId!=='string')throw Error('Missing diagnostic identity');
    if(!groups.has(d.diagnosticId))groups.set(d.diagnosticId,{header:null,parts:new Map(),versions:new Set()});
    const group=groups.get(d.diagnosticId);group.versions.add(e.version??log.version??null);
    if(d.truncated)throw Error('Truncated stock diagnostic');
    if(e.type==='stock-decision'){
      if(group.header&&JSON.stringify(group.header)!==JSON.stringify(d))throw Error('Conflicting diagnostic headers');
      group.header=d;
    }else{
      if(!Number.isInteger(d.part)||d.part<0||!Array.isArray(d.rows))throw Error('Invalid diagnostic part');
      if(group.parts.has(d.part)&&JSON.stringify(group.parts.get(d.part))!==JSON.stringify(d))throw Error('Conflicting diagnostic parts');
      group.parts.set(d.part,d);
    }
  }
  const frames=[],gaps=[];
  for(const [id,g] of groups){
    const h=g.header;
    if(!h){gaps.push({id,reason:'missing-header'});continue;}
    if(!Number.isFinite(h.snapshotAt)||!Number.isInteger(h.totalParts)||h.totalParts<1||h.totalParts>1000||
      !Number.isInteger(h.stockCount)||h.stockCount<0)throw Error('Invalid diagnostic header');
    const parts=Array.from({length:h.totalParts},(_,i)=>g.parts.get(i));
    if(g.parts.size!==h.totalParts||parts.some(p=>!p)){gaps.push({id,at:h.snapshotAt,reason:'missing-parts'});continue;}
    if(g.versions.size!==1||parts.some(p=>p.totalParts!==h.totalParts||p.snapshotAt!==h.snapshotAt))throw Error('Conflicting diagnostic frame');
    const rows=parts.flatMap(p=>p.rows).filter(r=>r.kind==='stock');
    if(rows.length!==h.stockCount||new Set(rows.map(r=>String(r.stockId))).size!==rows.length)throw Error('Stock row count or identity mismatch');
    const stocks=rows.map(r=>{
      if(!sid(r.stockId)||typeof r.modelName!=='string'||!r.modelName||!positive(r.priceCents)||!Array.isArray(r.trend?.ticks))
        throw Error('Invalid diagnostic stock');
      return {id:r.stockId,modelName:r.modelName,priceCents:r.priceCents,status:r.trend.status,
        ticks:r.trend.ticks.map(t=>{
          if(!Number.isFinite(t.at)||!positive(t.priceCents))throw Error('Invalid diagnostic tick');
          return {at:t.at,priceCents:t.priceCents};
        }),baseline:{direction:r.trend.direction,changePct:r.trend.changePct,thresholdPct:r.trend.buyThresholdPct}};
    });
    frames.push({id,at:h.snapshotAt,sourceVersion:[...g.versions][0],policy:{buyFeePct:h.policy?.buyFeePct,sellFeePct:h.policy?.sellFeePct},stocks});
  }
  frames.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  for(let i=1;i<frames.length;i++)if(frames[i].at===frames[i-1].at)throw Error('Duplicate diagnostic snapshot timestamp');
  return {kind:'diagnostic-history',frames,gaps,rawObservationFrames:events.filter(e=>e.type==='stock-observation').length,
    missingContracts:['complete-trading-rules','initial-position-cost-and-lock','pending-orders-and-receipts','account-equity-and-external-flows']};
}

// ticks.firstSeenAt 是首次快照看见该点的时刻，后来补出的历史点不能参与过去信号。
export function stockResearchSignal(stock,ticks,now,kind){
  if(!['S0','S1','S2','S3'].includes(kind))throw Error('Unknown research candidate');
  if(kind==='S3')return {eligible:false,reason:'no-new-position-control'};
  if(['stale','suspended','invalid'].includes(stock.status))return {eligible:false,reason:stock.status};
  const points=ticks.filter(t=>t.at<=now&&t.firstSeenAt<=now).sort((a,b)=>a.at-b.at);
  const latest=points.at(-1);
  if(!latest||now-latest.at>10*minute)return {eligible:false,reason:'stale-or-missing-history'};
  if(kind==='S0')return {eligible:stock.baseline?.direction==='up'&&Number.isFinite(stock.baseline.changePct)&&
    Number.isFinite(stock.baseline.thresholdPct)&&stock.baseline.changePct>=stock.baseline.thresholdPct,reason:'recorded-baseline-signal'};
  if(latest.priceCents!==stock.priceCents)return {eligible:false,reason:'quote-history-mismatch'};
  const reference=minutes=>{
    const target=now-minutes*minute,p=points.findLast(p=>p.at<=target);
    return p&&target-p.at<=5*minute?p:null;
  };
  const horizon=kind==='S1'?60:75,old=reference(horizon),p15=reference(15),p30=reference(30),p60=reference(60);
  if(!old||!p15||kind==='S1'&&(!p30||!p60))return {eligible:false,reason:'insufficient-visible-history'};
  const window=points.filter(p=>p.at>=old.at);
  if(window.some((p,i)=>i>0&&(p.at<=window[i-1].at||p.at-window[i-1].at>10*minute)))return {eligible:false,reason:'history-gap'};
  const deltas=window.slice(1).map((p,i)=>p.priceCents/window[i].priceCents-1);
  const r=ref=>stock.priceCents/ref.priceCents-1;
  if(kind==='S1'){
    const positives=deltas.filter(d=>d>0),sum=positives.reduce((a,b)=>a+b,0);
    const features={r15:r(p15),r30:r(p30),r60:r(p60),positiveFraction:positives.length/deltas.length,
      largestPositiveFraction:sum?Math.max(...positives)/sum:null};
    return {features,eligible:features.r15>0&&features.r30>0&&features.r60>=.06&&features.positiveFraction>=.65&&
      features.largestPositiveFraction!==null&&features.largestPositiveFraction<=.5,reason:'fixed-S1-conditions'};
  }
  const features={priorDrop:p15.priceCents/old.priceCents-1,r15:r(p15),lastTwo:deltas.slice(-2),signalLowCents:Math.min(...window.map(p=>p.priceCents))};
  return {features,eligible:features.priorDrop<=-.08&&features.r15>=.02&&features.lastTwo.length===2&&
    features.lastTwo.every(d=>d>=0)&&features.lastTwo.some(d=>d>0),reason:'fixed-S2-conditions'};
}

export function researchStockDiagnostics(log){
  const evidence=stockDiagnosticsFromLog(log),history=new Map(),names=new Map(),signals=[],visibility=new Map();
  for(const frame of evidence.frames){
    for(const stock of frame.stocks){
      const id=String(stock.id);
      if(names.has(id)&&names.get(id)!==stock.modelName)throw Error('Stock identity changed');
      names.set(id,stock.modelName);
      if(!history.has(id))history.set(id,new Map());
      const series=history.get(id);
      for(const t of stock.ticks){
        if(t.at>frame.at)continue;
        const old=series.get(t.at);
        if(old&&old.priceCents!==t.priceCents)throw Error('Conflicting historical tick prices');
        if(!old)series.set(t.at,{...t,firstSeenAt:frame.at});
      }
      if(!visibility.has(id))visibility.set(id,[]);
      visibility.get(id).push({at:frame.at,priceCents:stock.priceCents,status:stock.status,
        quoteAt:stock.ticks.length?Math.max(...stock.ticks.filter(t=>t.at<=frame.at).map(t=>t.at)):null,policy:frame.policy});
      for(const candidate of ['S0','S1','S2']){
        const signal=stockResearchSignal(stock,[...series.values()],frame.at,candidate);
        if(signal.eligible)signals.push({candidate,stockId:stock.id,modelName:stock.modelName,at:frame.at,
          priceCents:stock.priceCents,policy:frame.policy,features:signal.features??null});
      }
    }
  }
  const opportunities=[],reports=[];
  for(const candidate of ['S0','S1','S2','S3'])for(const holdMinutes of [60,120,240]){
    const busyUntil=new Map(),selected=[];
    for(const signal of signals.filter(s=>s.candidate===candidate)){
      const id=String(signal.stockId);if(signal.at<(busyUntil.get(id)??-Infinity))continue;
      const due=signal.at+holdMinutes*minute;
      const next=visibility.get(id).find(p=>p.at>=due&&p.at<=due+5*minute);
      const available=next&&!['stale','suspended','invalid'].includes(next.status)&&Number.isFinite(next.quoteAt)&&next.at-next.quoteAt<=10*minute;
      const fees=validFee(signal.policy.buyFeePct)&&validFee(next?.policy.sellFeePct);
      const end=next?.at??due+5*minute;busyUntil.set(id,end);
      const opportunity={...signal,holdMinutes,due,labelAt:available?next.at:null,
        netChange:available&&fees?next.priceCents*(1-next.policy.sellFeePct/100)/(signal.priceCents*(1+signal.policy.buyFeePct/100))-1:null,
        missingReason:!next?'no-observation-near-horizon':!available?'unavailable-exit-quote':!fees?'unknown-fees':null};
      selected.push(opportunity);opportunities.push(opportunity);
    }
    const known=selected.filter(o=>o.netChange!==null),values=known.map(o=>o.netChange).sort((a,b)=>a-b);
    reports.push({candidate,holdMinutes,opportunities:selected.length,evaluable:known.length,missing:selected.length-known.length,
      positive:known.filter(o=>o.netChange>0).length,meanNetChange:known.length?values.reduce((a,b)=>a+b,0)/known.length:null,
      lowerQuartile:values.length?values[Math.floor((values.length-1)*.25)]:null,
      dates:[...new Set(selected.map(o=>date(o.at)))],byDate:[...new Set(selected.map(o=>date(o.at)))].map(day=>{
        const rows=selected.filter(o=>date(o.at)===day),valid=rows.filter(o=>o.netChange!==null);
        return {day,opportunities:rows.length,missing:rows.length-valid.length,meanNetChange:valid.length?valid.reduce((n,o)=>n+o.netChange,0)/valid.length:null};
      })});
  }
  return {kind:'diagnostic-signal-study',tradeSimulation:false,from:evidence.frames[0]?.at??null,to:evidence.frames.at(-1)?.at??null,
    frames:evidence.frames.length,stocks:names.size,sourceVersions:[...new Set(evidence.frames.map(f=>f.sourceVersion))],
    gaps:evidence.gaps,missingContracts:evidence.missingContracts,reports,signals,opportunities,
    validation:{status:'not-qualified',holdoutPerformed:false,capitalAndLossBudgetVerified:false,requiredDates:5,requiredNonOverlappingOpportunities:30,
      reason:'诊断标签只评价信号后续价格；缺少完整交易契约、组合成交模拟及独立留出验证，不能启用自动买入。'},
    limitations:['所有缺失标签保留计数；正收益只表示报价情景，未模拟整数股取整、额度、锁仓后的实际可卖性或系统储备。',
      '同股标签时间不重叠；不同股票可能共同涨跌，不能视为独立收益。',
      'S3不产生新信号；已有持仓的管理与收益需组合回放，不在本报告内。',
      '全部数据仅用于首轮描述性研究，不以本次结果选择参数或宣称40万本金下日均净赚10万。']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: node arkengine-stock-research.mjs log.json [report.json]');
  const report=researchStockDiagnostics(JSON.parse(readFileSync(process.argv[2],'utf8'))),json=JSON.stringify(report,null,2)+'\n';
  if(process.argv[3])writeFileSync(process.argv[3],json);else process.stdout.write(json);
}
