import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStockEventStudy,stockEventsFromSnapshots,labelStockReplay,labelStockSignalHorizons} from './arkengine-stock-events.mjs';
import {replayStock} from './arkengine-stock-replay.mjs';
import {compareStockStrategies} from './arkengine-stock-comparison.mjs';

const start=Date.parse('2026-11-01T00:00:00Z'),minute=60000;
const rising=(n=73)=>Array.from({length:n},(_,i)=>1000+10*i);
function market(prices=rising(),ids=[1]){
  return {initialBalance:10000,snapshots:prices.map((priceCents,i)=>({at:start+i*5*minute,
    sourceObservation:{id:'observed-'+i,version:2},view:{userId:7,enabled:true,
      stocks:ids.map(id=>({id,modelName:'model-'+id,priceCents,volume24h:1000})),positions:[],rounds:[],myBets:[],
      ticks:ids.flatMap(stockId=>prices.slice(Math.max(0,i-11),i+1).map((p,j)=>({stockId,priceCents:p,
        createdAt:new Date(start+(Math.max(0,i-11)+j)*5*minute).toISOString()}))),
      rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:400000,reserveTokens:1000000}}}))};
}
const policy={candidate:'S1',holdMinutes:60,exitMode:'fixed'};
function evidence(data=market(),strategy=policy,extra={}){
  const study=stockEventsFromSnapshots(data.snapshots),replay=replayStock({...data,strategy,...extra});
  return {study,replay,labels:labelStockReplay(study,replay)};
}
function stalled(){return [...rising(24),...Array(12).fill(1230),...Array.from({length:36},(_,i)=>1240+10*i)];}

test('signal horizons: all stocks contribute once per episode, with fees and the lock measured after observed entry',()=>{
  const data=market(rising(40),[1,2,3,4]),before=JSON.stringify(data),r=labelStockSignalHorizons(data.snapshots);
  const s=r.summaries.find(s=>s.candidate==='S1');assert.equal(s.events,4);assert.equal(s.evaluable,4);
  assert.ok(r.eventCounts.find(s=>s.candidate==='S1').trueChecks>4);
  for(const row of r.labels.filter(l=>l.candidate==='S1')){
    assert.equal(row.entryAt,start+65*minute);assert.equal(row.exitDueAt,start+125*minute);assert.equal(row.exitAt,row.exitDueAt);
    assert.equal(row.entryPriceCents,1130);assert.equal(row.exitPriceCents,1250);
    assert.equal(row.netChange,1250*.975/(1130*1.02)-1);
  }
  assert.equal(r.tradeSimulation,false);assert.equal(r.qualifiedForLive,false);assert.equal(JSON.stringify(data),before);
});

test('signal horizons: rearmed signals inside a prior lock cannot multiply its sample count',()=>{
  const prices=rising(40);prices[13]=1100;prices[14]=1110;
  const r=labelStockSignalHorizons(market(prices).snapshots),rows=r.labels.filter(l=>l.candidate==='S1');
  assert.ok(rows.length>=2);assert.equal(rows[1].at,start+75*minute);
  assert.equal(rows[1].reason,'overlapping-prior-horizon');assert.equal(rows[1].overlappingEventId,rows[0].eventId);
  assert.equal(rows[1].netChange,null);
});

test('signal horizons: an unavailable first exit is retained, never replaced with a later profitable quote',()=>{
  for(const [edit,reason] of [
    [v=>v.enabled=false,'market-closed'],[v=>v.stocks=[],'stock-not-observed'],
    [v=>v.stocks[0].suspended=true,'suspended'],[v=>v.stocks[0].stale=true,'stale']
  ]){
    const data=market(rising(40));edit(data.snapshots[25].view);
    const row=labelStockSignalHorizons(data.snapshots).labels[0];
    assert.equal(row.exitAt,start+125*minute);assert.equal(row.reason,reason);assert.equal(row.netChange,null);
  }
});

test('signal horizons: missing or invalid fees remain unknown; actual endpoint fees are used',()=>{
  for(const value of [undefined,null,-1,100,'2'])for(const side of ['entry','exit']){
    const data=market(rising(40));data.snapshots[side==='entry'?13:25].view.rules[side==='entry'?'buyFeePct':'sellFeePct']=value;
    const r=labelStockSignalHorizons(data.snapshots),row=r.labels[0];
    assert.equal(row.reason,'unknown-'+side+'-fee');assert.equal(row.netChange,null);
    assert.equal(r.summaries[0].meanNetChange,null);
  }
  const data=market(rising(40));data.snapshots[25].view.rules.sellFeePct=10;
  assert.equal(labelStockSignalHorizons(data.snapshots).labels[0].netChange,1250*.9/(1130*1.02)-1);
});

test('signal horizons: entry delay, interior gaps and late horizons have distinct exclusions',()=>{
  for(const [omit,reason] of [
    [[13,14,15],'entry-observation-gap'],[[17,18],'internal-observation-gap'],[[25,26],'late-horizon-observation']
  ]){
    const data=market(rising(40));data.snapshots=data.snapshots.filter((s,i)=>!omit.includes(i));
    const row=labelStockSignalHorizons(data.snapshots).labels[0];assert.equal(row.reason,reason);assert.equal(row.netChange,null);
  }
});

test('signal horizons: incomplete entries and locks remain in denominators; future data cannot change completed labels',()=>{
  const data=market(rising(40)),pending=labelStockSignalHorizons(data.snapshots.slice(0,13));
  assert.equal(pending.labels[0].reason,'log-ends-before-entry');assert.equal(pending.summaries[0].missing,1);
  const locked=labelStockSignalHorizons(data.snapshots.slice(0,25));assert.equal(locked.labels[0].reason,'log-ends-before-horizon');
  const prefix=labelStockSignalHorizons(data.snapshots.slice(0,26));
  for(const s of data.snapshots.slice(26))s.view.ticks.push({stockId:1,priceCents:900,createdAt:new Date(start-minute).toISOString()});
  const full=labelStockSignalHorizons(data.snapshots);assert.deepEqual(full.labels[0],prefix.labels[0]);
  assert.equal(prefix.summaries[0].events,prefix.summaries[0].evaluable+prefix.summaries[0].missing);
});

test('signal horizons: late availability cannot turn a pre-unlock market read into an exit quote',()=>{
  const data=market(rising(40));data.snapshots[25].sourceObservation.reading={marketAt:start+124*minute};
  const row=labelStockSignalHorizons(data.snapshots).labels[0];assert.equal(row.reason,'market-read-outside-window');
  assert.equal(row.netChange,null);assert.equal(row.exitMarketAt,start+124*minute);
  assert.throws(()=>labelStockSignalHorizons(data.snapshots,{holdMinutes:5}),/fixed research horizon/);
});

test('signal horizons: zero delay uses the signal quote but explicit unknown read times never become current',()=>{
  const data=market(rising(40));data.snapshots[12].sourceObservation.reading={marketAt:start+60*minute-3};
  const row=labelStockSignalHorizons(data.snapshots,{executionDelayMs:0}).labels[0];
  assert.equal(row.entryAt,start+60*minute);assert.equal(row.exitAt,start+120*minute);assert.equal(row.reason,null);
  data.snapshots[24].sourceObservation.reading={marketAt:null};
  const unknown=labelStockSignalHorizons(data.snapshots,{executionDelayMs:0}).labels[0];
  assert.equal(unknown.reason,'market-read-outside-window');assert.equal(unknown.netChange,null);
});

test('stock events: twelve consecutive eligible reads create one event with causal reference evidence',()=>{
  const data=market(rising(24)),before=JSON.stringify(data),study=stockEventsFromSnapshots(data.snapshots);
  const row=study.counts.find(c=>c.candidate==='S1');assert.equal(row.trueChecks,12);assert.equal(row.events,1);
  const e=study.events.find(e=>e.candidate==='S1');assert.equal(e.at,start+60*minute);assert.equal(e.trueObservations,12);
  assert.ok(e.references.every(p=>p.at<=e.at&&p.firstSeenAt<=e.at));assert.equal(e.observationId,'observed-12');
  assert.equal(study.qualifiedForLive,false);assert.equal(JSON.stringify(data),before);
});

test('stock events: unknown between two failed reads breaks reset evidence and a later confirmed pair rearms',()=>{
  const data=market(stalled()),base=stockEventsFromSnapshots(data.snapshots);
  const failed=base.evaluations.find(e=>e.candidate==='S1'&&e.eventId&&e.outcome==='false');
  const index=(failed.at-start)/(5*minute);data.snapshots[index+1].view.stocks[0].stale=true;
  const study=stockEventsFromSnapshots(data.snapshots),checks=study.evaluations.filter(e=>e.candidate==='S1');
  assert.equal(checks[index+1].outcome,'unknown');assert.equal(checks[index+2].rearmed,false);
  assert.equal(checks[index+3].rearmed,true);assert.ok(study.events.filter(e=>e.candidate==='S1').length>=2);
  assert.equal(study.events.find(e=>e.candidate==='S1').rearmedAt,start+(index+3)*5*minute);
});

test('stock events: missing stocks and long observation gaps do not count as a failed predicate',()=>{
  const data=market(stalled()),base=stockEventsFromSnapshots(data.snapshots);
  const failed=base.evaluations.find(e=>e.candidate==='S1'&&e.eventId&&e.outcome==='false');
  const i=(failed.at-start)/(5*minute),missing=structuredClone(data);missing.snapshots[i+1].view.stocks=[];
  const a=stockEventsFromSnapshots(missing.snapshots).evaluations.filter(e=>e.candidate==='S1');
  assert.equal(a[i+1].reason,'stock-not-observed');assert.equal(a[i+2].rearmed,false);assert.equal(a[i+3].rearmed,true);
  const skipped=data.snapshots.filter((_,j)=>j!==i+1&&j!==i+2),b=stockEventsFromSnapshots(skipped).evaluations;
  const after=b.find(e=>e.candidate==='S1'&&e.at===data.snapshots[i+3].at);
  assert.equal(after.observationGap,true);assert.equal(after.rearmed,false);
});

test('stock events: duplicate observations and JSON continuation preserve the exact event stream',()=>{
  const data=market(stalled()),full=stockEventsFromSnapshots(data.snapshots);let study=createStockEventStudy();
  data.snapshots.slice(0,30).forEach(s=>study.observe(s));const checkpoint=study.exportState();
  assert.equal(study.observe(data.snapshots[29]).duplicate,true);assert.deepEqual(study.exportState(),checkpoint);
  study=createStockEventStudy(JSON.parse(JSON.stringify(checkpoint)));data.snapshots.slice(30).forEach(s=>study.observe(s));
  assert.deepEqual(study.report(),full);
  const bad=structuredClone(checkpoint);bad.state.lanes[0].armed=true;bad.state.lanes[0].falseAt=0;
  assert.throws(()=>createStockEventStudy(bad),/checkpoint/);
});

test('stock events: conflicting frames, identities and histories fail before mutating the checkpoint',()=>{
  const data=market(),study=createStockEventStudy();data.snapshots.slice(0,15).forEach(s=>study.observe(s));const before=study.exportState();
  const cases=[structuredClone(data.snapshots[14]),structuredClone(data.snapshots[15]),structuredClone(data.snapshots[15]),structuredClone(data.snapshots[15])];
  cases[0].view.stocks[0].priceCents++;
  cases[1].view.ticks[0].priceCents++;cases[2].view.stocks[0].modelName='changed';cases[3].view.userId=8;
  for(const sample of cases){assert.throws(()=>study.observe(sample),/Conflicting|identity|account/);assert.deepEqual(study.exportState(),before);}
});

test('stock events: late history and future points cannot manufacture past events',()=>{
  const data=market();for(const s of data.snapshots.slice(0,13))s.view.ticks=s.view.ticks.filter(t=>Date.parse(t.createdAt)!==start);
  // The old first point becomes visible only with observation 13.
  data.snapshots[13].view.ticks.unshift({stockId:1,priceCents:1000,createdAt:new Date(start).toISOString()});
  data.snapshots[0].view.ticks.push({stockId:1,priceCents:2000,createdAt:new Date(start+24*60*minute).toISOString()});
  const prefix=stockEventsFromSnapshots(data.snapshots.slice(0,13)),full=stockEventsFromSnapshots(data.snapshots);
  assert.equal(prefix.events.filter(e=>e.candidate==='S1').length,0);
  assert.ok(full.events.find(e=>e.candidate==='S1').at>start+60*minute);
  assert.deepEqual(full.evaluations.filter(e=>e.at<=prefix.to),prefix.evaluations);
  assert.equal(full.observations[0].ignoredFutureTicks,1);
});

test('stock event labels: repeated trades stay in the account but only the first closed lot counts as an independent opportunity',()=>{
  const {study,replay,labels}=evidence();const buys=replay.trades.filter(t=>t.action==='buy');assert.ok(buys.length>=3);
  assert.equal(study.counts.find(c=>c.candidate==='S1').events,1);assert.equal(labels.summary.countedNonOverlappingClosed,1);
  assert.equal(labels.summary.repeatedTrades,buys.length-1);assert.equal(labels.lots.length,buys.length);
  assert.equal(labels.closedNewLotsPerformance.net,replay.turnover.realized);
  assert.equal(labels.closedNewLotsPerformance.capitalWeightedReturn,replay.turnover.capitalWeightedClosedReturn);
  assert.equal(labels.summary.remainingSignalCost,0);assert.equal(labels.qualifiedForLive,false);
});

test('stock event labels: partial exits and later fills are masked at the evaluation boundary',()=>{
  const data=market(rising(29));data.snapshots[24].view.rules.reserveTokens=50;data.snapshots[25].view.rules.reserveTokens=0;
  const {study,replay}=evidence(data),to=start+125*minute+1,cut=labelStockReplay(study,replay,{to});
  assert.equal(cut.labels[0].status,'partially-sold');assert.equal(cut.labels[0].net,null);
  assert.equal(cut.summary.countedNonOverlappingClosed,0);assert.ok(cut.summary.remainingSignalCost>0);
  assert.ok(cut.lots[0].sales.every(s=>s.at<to));
  const prefix=market(rising(29));prefix.snapshots=data.snapshots.slice(0,26);
  const early=evidence(prefix).labels;assert.deepEqual(cut.labels,early.labels);assert.deepEqual(cut.lots,early.lots);
  const complete=labelStockReplay(study,replay);assert.equal(complete.labels[0].status,'closed');assert.equal(complete.summary.remainingSignalCost,0);
});

test('stock event labels: an entry unresolved at the boundary cannot reveal a later rejection',()=>{
  const data=market(rising(28));data.snapshots[18].view.enabled=false;
  const {study,replay}=evidence(data,policy,{executionDelayMs:30*minute});assert.equal(replay.orders[0].status,'unfilled');
  const cut=labelStockReplay(study,replay,{to:start+70*minute+1}),order=cut.labels[0].orders[0];
  assert.equal(order.status,'pending');assert.equal(order.resolvedAt,null);assert.equal(order.reason,null);
  assert.equal(cut.labels[0].status,'entry-pending');assert.equal(cut.labels[0].net,null);assert.deepEqual(cut.lots,[]);
});

test('stock event labels: missing exit quotes retain unresolved cost and do not create completed samples',()=>{
  const data=market(rising(29));for(const s of data.snapshots.slice(24))s.view.stocks[0].suspended=true;
  const {replay,labels}=evidence(data);assert.equal(labels.labels[0].status,'still-held');
  assert.equal(labels.summary.remainingSignalCost,replay.account.ending.heldCost);assert.ok(labels.summary.remainingSignalCost>0);
  assert.equal(labels.summary.countedNonOverlappingClosed,0);assert.equal(labels.labels[0].net,null);
});

test('stock event labels: cross-segment lots are not turned into prior-segment returns or new events',()=>{
  const {study,replay}=evidence(),sale=replay.trades.find(t=>t.action==='sell');
  const before=labelStockReplay(study,replay,{to:sale.at});assert.equal(before.labels[0].net,null);
  assert.equal(before.labels[0].status,'still-held');assert.equal(before.summary.countedNonOverlappingClosed,0);
  const next=labelStockReplay(study,replay,{from:sale.at});assert.equal(next.summary.priorSegment,1);
  assert.equal(next.labels[0].exclusion,'event-started-before-segment');assert.equal(next.summary.countedNonOverlappingClosed,0);
  assert.ok(next.closedNewLotsPerformance.lots>0,'later repeated trades remain in the execution cohort');
});

test('stock event labels: a rearmed event starting before the previous legal exit remains an overlapping sample',()=>{
  const prices=[...rising(24),...Array(12).fill(1230),...Array.from({length:109},(_,i)=>1240+10*i)];
  const {labels}=evidence(market(prices),{...policy,holdMinutes:240});
  assert.ok(labels.labels.length>=2);const second=labels.labels[1];assert.ok(second.primaryLot);
  assert.equal(second.overlap,true);assert.equal(second.counted,false);assert.equal(second.exclusion,'overlapping-prior-label');
});

test('stock event labels: simultaneous stocks are grouped as one market period instead of independent market regimes',()=>{
  const data=market(rising(29),[1,2]);data.initialBalance=20000;data.config={tradeLimit:20000,perStockLimit:1000};
  const {labels}=evidence(data);assert.equal(labels.summary.events,2);assert.equal(labels.summary.countedNonOverlappingClosed,2);
  assert.equal(labels.marketGroups.length,1);assert.equal(labels.marketGroups[0].events,2);assert.equal(labels.summary.dates.length,1);
});

test('stock event labels: changed signal features, policy or coverage cannot be attached to another study',()=>{
  const {study,replay}=evidence();
  for(const change of [r=>r.orders[0].research.features.r60=999,r=>r.orders[0].research.holdMinutes=240,r=>r.simulation.from+=1]){
    const bad=structuredClone(replay);change(bad);assert.throws(()=>labelStockReplay(study,bad),/matching|Matching/);
  }
  assert.throws(()=>labelStockReplay(study,replay,{from:study.to,to:study.from}),/cutoff/);
  assert.equal(labelStockReplay(study,replayStock({...market(),strategy:{candidate:'S3'}})).applicable,false);
});

test('stock event labels: a profitable primary sample cannot hide losses in repeat trades',()=>{
  const prices=Array.from({length:49},(_,i)=>i<=36?1000+10*i:1360-40*(i-36));
  const {replay,labels}=evidence(market(prices)),p=labels.closedNewLotsPerformance;
  assert.equal(labels.summary.countedNonOverlappingClosed,1);assert.ok(labels.labels[0].net>0);
  assert.equal(labels.summary.repeatedTrades,1);assert.ok(p.net<0);assert.equal(p.net,replay.turnover.realized);
  assert.ok(p.winCapitalFraction>0&&p.lossCapitalFraction>0);assert.equal(p.flatCapitalFraction,0);
  assert.ok(Math.abs(p.capitalWeightedReturn-(p.winCapitalFraction*p.meanWinReturn-p.lossCapitalFraction*p.meanLossMagnitude))<1e-10);
});

test('stock event labels: old manual holdings remain visible separately from new signal exposure',()=>{
  const data=market(rising(29),[1,2]);data.initialPositions=[{stockId:1,shares:100,costBasisTokens:1000,holdUntil:null}];
  const {replay,labels}=evidence(data);assert.equal(labels.summary.remainingSignalCost,0);
  assert.equal(labels.summary.accountHeldCostAtCutoff,1000);assert.equal(labels.summary.accountHeldCostAtCutoff,replay.account.ending.heldCost);
  assert.equal(labels.labels.find(l=>l.stockId===1).status,'not-traded');
});

test('stock comparison: each scenario exports one event study while twelve policy groups retain separate actual labels',()=>{
  const data=market(rising(29)),studies=[],reports=[];
  const r=compareStockStrategies(data,{stress:true,missingStartIndex:13,onEventStudy:(id,s)=>studies.push([id,s]),
    onReport:(id,s)=>reports.push([id,s])});
  assert.equal(studies.length,6);assert.equal(r.runs.length,84);assert.equal(r.eventStudies.length,6);
  assert.equal(reports.filter(([,v])=>v.researchEvidence.eventLabels.applicable).length,72);
  const row=r.runs.find(r=>r.id==='normal-S1-60-fixed');assert.equal(row.independentOpportunities.countedNonOverlappingClosed,1);
  assert.ok(row.eligibleSignalEvaluations>row.independentOpportunities.events);
  assert.equal(row.eventStudySha256,r.eventStudies.find(e=>e.scenario==='normal').sha256);
  assert.equal(r.validation.holdoutPerformed,false);assert.equal(r.validation.qualifiedForLive,false);
  console.log(JSON.stringify({kind:'stock-event-matrix-conditional',scenarios:r.eventStudies.length,runs:r.runs.length,
    trueSignalChecks:studies[0][1].counts.find(c=>c.candidate==='S1').trueChecks,
    events:row.independentOpportunities.events,completedIndependent:row.independentOpportunities.countedNonOverlappingClosed,
    conditionalOnly:true}));
});
