import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stockDiagnosticsFromLog,stockResearchSignal,researchStockDiagnostics} from './arkengine-stock-research.mjs';

const start=Date.parse('2026-11-08T00:00:00Z'),minute=60000;
function logFor(prices){
  return {days:[{events:prices.flatMap((priceCents,i)=>{
    const at=start+i*5*minute,diagnosticId=`frame-${i}`;
    const stock={kind:'stock',stockId:1,modelName:'fixture',priceCents,trend:{status:'up',direction:'up',changePct:7,buyThresholdPct:5.5,
      ticks:prices.slice(Math.max(0,i-11),i+1).map((priceCents,j)=>({at:start+(Math.max(0,i-11)+j)*5*minute,priceCents}))}};
    return [{type:'stock-decision',version:'test',data:{diagnosticId,snapshotAt:at,totalParts:2,stockCount:1,policy:{buyFeePct:2,sellFeePct:2.5}}},
      ...[0,1].map(part=>({type:'stock-decision-detail',version:'test',data:{diagnosticId,snapshotAt:at,totalParts:2,part,rows:part?[]:[stock]}}))];
  })}]};
}
const increasing=()=>Array.from({length:50},(_,i)=>Math.round(10000*1.006**i));
const direct=prices=>({stock:{id:1,priceCents:prices.at(-1),status:'up'},now:start+(prices.length-1)*5*minute,
  ticks:prices.map((priceCents,i)=>({priceCents,at:start+i*5*minute,firstSeenAt:start+i*5*minute}))});

test('股市诊断研究：分片乱序和重复可还原，缺片显式报告，冲突不参与研究',()=>{
  const log=logFor(increasing()),events=log.days[0].events;
  assert.equal(stockDiagnosticsFromLog(log).frames.length,50);
  assert.deepEqual(stockDiagnosticsFromLog({events:[...events].reverse().concat(events[0])}).frames,stockDiagnosticsFromLog(log).frames);
  const incomplete=stockDiagnosticsFromLog({events:events.slice(1)});assert.equal(incomplete.frames.length,49);
  assert.equal(incomplete.gaps[0].reason,'missing-header');
  assert.equal(stockDiagnosticsFromLog({events:events.filter((e,i)=>i!==1)}).gaps[0].reason,'missing-parts');
  const changed=structuredClone(events[1]);changed.data.rows[0].priceCents++;
  assert.throws(()=>stockDiagnosticsFromLog({events:[...events,changed]}),/Conflicting/);
  const truncated=structuredClone(events[1]);truncated.data.truncated=true;
  assert.throws(()=>stockDiagnosticsFromLog({events:[events[0],truncated,events[2]]}),/Truncated/);
});

test('股市固定信号：S1分散上涨与S2确认反弹可触发，单次跳涨或仍下跌不能冒充',()=>{
  const s1=direct(increasing().slice(0,14));assert.equal(stockResearchSignal(s1.stock,s1.ticks,s1.now,'S1').eligible,true);
  const jump=direct([1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1200]);
  assert.equal(stockResearchSignal(jump.stock,jump.ticks,jump.now,'S1').eligible,false);
  const s2=direct([1000,990,980,970,960,950,940,930,920,910,900,890,880,890,901,912]);
  assert.equal(stockResearchSignal(s2.stock,s2.ticks,s2.now,'S2').eligible,true);
  s2.stock.priceCents=895;s2.ticks.at(-1).priceCents=895;
  assert.equal(stockResearchSignal(s2.stock,s2.ticks,s2.now,'S2').eligible,false);
  assert.equal(stockResearchSignal(s1.stock,s1.ticks,s1.now,'S3').eligible,false);
});

test('股市研究时序：首次可见之前的点无效，未来快照和后来补出的历史不改变过去信号',()=>{
  const {stock,ticks,now}=direct(increasing().slice(0,14));
  const delayed=ticks.map(t=>({...t,firstSeenAt:now+1}));
  assert.equal(stockResearchSignal(stock,delayed,now,'S1').eligible,false);
  const log=logFor(increasing()),prefix={events:log.days[0].events.slice(0,20*3)};
  const before=researchStockDiagnostics(prefix),full=researchStockDiagnostics(log),cutoff=start+19*5*minute;
  assert.deepEqual(full.signals.filter(s=>s.at<=cutoff),before.signals);
  for(const event of log.days[0].events.slice(20*3))if(event.type==='stock-decision-detail'&&event.data.rows.length){
    // 后来的样本多带一个更早历史点；不倒填到过去的特征窗口。
    event.data.rows[0].trend.ticks.unshift({at:start-5*minute,priceCents:5000});
  }
  assert.deepEqual(researchStockDiagnostics(log).signals.filter(s=>s.at<=cutoff),before.signals);
});

test('股市研究有效性：超十分钟断档、过时报价和未知费用不生成可信收益标签',()=>{
  const {stock,ticks,now}=direct(increasing().slice(0,14));
  assert.equal(stockResearchSignal(stock,ticks.filter((_,i)=>![3,4].includes(i)),now,'S1').reason,'history-gap');
  assert.equal(stockResearchSignal({...stock,status:'stale'},ticks,now,'S1').eligible,false);
  const log=logFor(increasing());for(const e of log.days[0].events)if(e.type==='stock-decision')delete e.data.policy.sellFeePct;
  const report=researchStockDiagnostics(log);assert.ok(report.opportunities.length);
  assert.ok(report.opportunities.every(o=>o.netChange===null));
  assert.ok(report.opportunities.some(o=>o.missingReason==='unknown-fees'));
});

test('股市诊断标签：扣实际比例费用、同股不重叠，末尾无报价也保留失败计数',()=>{
  const report=researchStockDiagnostics(logFor(increasing()));
  const rows=report.opportunities.filter(o=>o.candidate==='S1'&&o.holdMinutes===60);
  assert.ok(rows.some(o=>o.netChange!==null));assert.ok(rows.some(o=>o.missingReason==='no-observation-near-horizon'));
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].at>=rows[i-1].due);
  const o=rows.find(o=>o.netChange!==null),prices=increasing(),index=(o.labelAt-start)/(5*minute);
  assert.equal(o.netChange,prices[index]*.975/(o.priceCents*1.02)-1);
  const summary=report.reports.find(r=>r.candidate==='S1'&&r.holdMinutes===60);
  assert.equal(summary.opportunities,summary.evaluable+summary.missing);
  assert.equal(report.tradeSimulation,false);assert.equal(report.validation.status,'not-qualified');
  assert.equal(report.validation.capitalAndLossBudgetVerified,false);
});
