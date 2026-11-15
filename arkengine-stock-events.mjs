import {createHash} from 'node:crypto';
import {stockResearchSignal} from './arkengine-stock-research.mjs';

const minute=60000,hour=60*minute;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>Number.isSafeInteger(x)&&x>0||typeof x==='string'&&x.trim().length>0;
const time=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const day=at=>new Date(at+8*hour).toISOString().slice(0,10);
const laneKey=(id,candidate)=>JSON.stringify([String(id),candidate]);

// Research episodes only. This does not suppress or enable orders in replayStrategy.
// A known failed predicate differs from an unreadable quote, absent stock or history.
export function createStockEventStudy(saved) {
  let state=saved?structuredClone(saved.state):{version:1,account:null,observations:[],histories:[],stocks:[],lanes:[],events:[],evaluations:[]};
  if(saved&&(saved.integrity!==hash(state)||state.version!==1))throw Error('Stock event checkpoint changed or unsupported');
  const histories=new Map(state.histories.map(([id,points])=>[id,new Map(points.map(p=>[p.at,p]))]));
  const stocks=new Map(state.stocks.map(s=>[String(s.id),s]));
  const lanes=new Map(state.lanes.map(l=>[laneKey(l.stockId,l.candidate),l]));
  const observations=new Map(state.observations.map(o=>[o.id,o]));
  const events=new Map(state.events.map(e=>[e.id,e]));
  if(saved&&(observations.size!==state.observations.length||events.size!==state.events.length||
    state.observations.some((o,i)=>!time(o.at)||i>0&&o.at<=state.observations[i-1].at)||
    state.lanes.some(l=>l.eventId!==null&&!events.has(l.eventId))))throw Error('Invalid stock event checkpoint');
  function observe(snapshot) {
    const at=typeof snapshot?.at==='number'?snapshot.at:Date.parse(snapshot?.at),v=snapshot?.view;
    if(!time(at)||!v||!validId(v.userId)||!Array.isArray(v.stocks)||!Array.isArray(v.ticks)||
      new Set(v.stocks.map(s=>String(s.id))).size!==v.stocks.length||v.stocks.some(s=>!validId(s.id)||typeof s.modelName!=='string'||!s.modelName))
      throw Error('Explicit stock observation identity and market required');
    if(state.account!==null&&state.account!==v.userId)throw Error('Stock event account changed');
    const id=snapshot.sourceObservation?.id??'at:'+at;
    if(typeof id!=='string'||!id.trim())throw Error('Invalid stock observation identity');
    const fingerprint=hash({at,account:v.userId,stocks:v.stocks,ticks:v.ticks,source:snapshot.sourceObservation??null});
    const previous=observations.get(id);
    if(previous){if(previous.fingerprint!==fingerprint)throw Error('Conflicting stock observation identity');return {duplicate:true,created:[]};}
    const last=state.observations.at(-1);
    if(last&&at<=last.at){
      if(at===last.at&&fingerprint===last.fingerprint)return {duplicate:true,created:[]};
      throw Error('Stock event observations must increase');
    }
    // Validate the whole input before mutating history, including conflicts within one read.
    const incoming=new Map();let ignoredFutureTicks=0;
    for(const t of v.ticks){
      const stamp=Date.parse(t.createdAt);
      if(!validId(t.stockId)||!time(stamp)||!positive(t.priceCents))throw Error('Invalid visible stock event tick');
      if(stamp>at){ignoredFutureTicks++;continue;}
      const key=String(t.stockId),token=JSON.stringify([key,stamp]);
      const old=incoming.get(token)??histories.get(key)?.get(stamp);
      if(old&&old.priceCents!==t.priceCents)throw Error('Conflicting visible stock event history');
      incoming.set(token,{stockId:key,at:stamp,priceCents:t.priceCents,firstSeenAt:old?.firstSeenAt??at});
    }
    for(const s of v.stocks)if(stocks.has(String(s.id))&&stocks.get(String(s.id)).modelName!==s.modelName)
      throw Error('Stock event model identity changed');
    state.account=v.userId;
    for(const p of incoming.values()){
      if(!histories.has(p.stockId))histories.set(p.stockId,new Map());
      const {stockId,...point}=p;histories.get(stockId).set(p.at,point);
    }
    for(const s of v.stocks)if(!stocks.has(String(s.id)))stocks.set(String(s.id),{id:s.id,modelName:s.modelName});
    const record={id,at,fingerprint,ignoredFutureTicks};observations.set(id,record);state.observations.push(record);
    const visible=new Map(v.stocks.map(s=>[String(s.id),s])),created=[];
    for(const [key,identity] of stocks)for(const candidate of ['S1','S2']){
      const token=laneKey(key,candidate);
      if(!lanes.has(token))lanes.set(token,{stockId:identity.id,candidate,armed:true,falseAt:null,eventId:null});
      const lane=lanes.get(token),stock=visible.get(key);
      const references=[...(histories.get(key)?.values()??[])].filter(p=>p.at>=at-80*minute).sort((a,b)=>a.at-b.at);
      const result=stock&&positive(stock.priceCents)?stockResearchSignal({...stock,
        status:stock.suspended?'suspended':stock.stale?'stale':stock.status??null},references,at,candidate):
        {eligible:false,reason:stock?'invalid-quote':'stock-not-observed'};
      const known=result.reason==='fixed-'+candidate+'-conditions';
      const outcome=known?(result.eligible?'true':'false'):'unknown';
      const gap=!!last&&at-last.at>10*minute;
      if(gap)lane.falseAt=null;
      let fresh=false,rearmed=false;
      if(outcome==='unknown')lane.falseAt=null;
      else if(outcome==='true'){
        if(lane.armed){
          const eventId='event:'+encodeURIComponent(String(v.userId))+':'+candidate+':'+encodeURIComponent(key)+':'+at;
          const event={id:eventId,stockId:identity.id,modelName:identity.modelName,candidate,at,observationId:id,
            priceCents:stock.priceCents,features:structuredClone(result.features),references:structuredClone(references),
            date:day(at),marketHour:new Date(Math.floor(at/hour)*hour).toISOString(),trueObservations:0,lastTrueAt:at,rearmedAt:null};
          events.set(eventId,event);state.events.push(event);created.push(eventId);lane.eventId=eventId;lane.armed=false;fresh=true;
        }
        const event=events.get(lane.eventId);event.trueObservations++;event.lastTrueAt=at;lane.falseAt=null;
      }else if(lane.falseAt===null)lane.falseAt=at;
      else if(at-lane.falseAt>=5*minute&&!lane.armed){
        lane.armed=true;rearmed=true;events.get(lane.eventId).rearmedAt=at;
      }
      state.evaluations.push({at,observationId:id,stockId:identity.id,candidate,outcome,reason:result.reason,
        eventId:lane.eventId,created:fresh,rearmed,observationGap:gap,
        featuresHash:result.features?hash(result.features):null});
    }
    return {duplicate:false,created};
  }
  function exportState(){
    const copy={...state,histories:[...histories].map(([id,points])=>[id,[...points.values()]]),stocks:[...stocks.values()],lanes:[...lanes.values()]};
    return {state:structuredClone(copy),integrity:hash(copy)};
  }
  function report(){
    const from=state.observations[0]?.at??null,to=state.observations.at(-1)?.at??null;
    return {kind:'independent-stock-signal-events',account:state.account,from,to,
      observations:structuredClone(state.observations),events:structuredClone(state.events),evaluations:structuredClone(state.evaluations),
      counts:['S1','S2'].map(candidate=>{const rows=state.evaluations.filter(e=>e.candidate===candidate),episodes=state.events.filter(e=>e.candidate===candidate);
        return {candidate,checks:rows.length,trueChecks:rows.filter(e=>e.outcome==='true').length,
          falseChecks:rows.filter(e=>e.outcome==='false').length,unknownChecks:rows.filter(e=>e.outcome==='unknown').length,
          events:episodes.length,dates:[...new Set(episodes.map(e=>e.date))]};}),
      qualifiedForLive:false,limitations:['Episodes are not statistically independent across stocks or dates.',
        'A quote/history uncertainty or observation gap over ten minutes breaks an incomplete reset pair.',
        'Event counting does not alter trading triggers, position limits, cooldown or order execution.']};
  }
  return {observe,exportState,report};
}

export function stockEventsFromSnapshots(snapshots) {
  if(!Array.isArray(snapshots)||!snapshots.length)throw Error('Stock events require observed snapshots');
  const study=createStockEventStudy();for(const sample of snapshots)study.observe(sample);return study.report();
}

// Price evidence for every signal episode, independent of account size or ID-based
// stock selection. These fractional returns are not orders or portfolio P/L.
export function labelStockSignalHorizons(snapshots,{holdMinutes=60,executionDelayMs=5000}={}){
  if(![60,120,240].includes(holdMinutes)||!Number.isSafeInteger(executionDelayMs)||executionDelayMs<0||executionDelayMs>10*minute)
    throw Error('Signal labels require a fixed research horizon and bounded observation delay');
  const study=stockEventsFromSnapshots(snapshots),frames=snapshots.map(s=>({...s,at:typeof s.at==='number'?s.at:Date.parse(s.at)}));
  const index=new Map(frames.map((s,i)=>[s.at,i])),busy=new Map(),labels=[];
  const marketAt=s=>s.sourceObservation?.reading&&Object.hasOwn(s.sourceObservation.reading,'marketAt')?
    s.sourceObservation.reading.marketAt:s.at;
  const fee=n=>Number.isFinite(n)&&n>=0&&n<100;
  function quoteReason(s,stock,due){
    if(!time(marketAt(s))||marketAt(s)>s.at||marketAt(s)<due)return 'market-read-outside-window';
    if(!s.view.enabled)return 'market-closed';
    if(!stock)return 'stock-not-observed';
    if(!positive(stock.priceCents))return 'invalid-price';
    if(stock.suspended)return 'suspended';
    if(stock.stale)return 'stale';
    return null;
  }
  for(const event of study.events){
    const row={eventId:event.id,candidate:event.candidate,stockId:event.stockId,at:event.at,date:event.date,
      marketHour:event.marketHour,entryAt:null,exitDueAt:null,exitAt:null,grossChange:null,netChange:null,reason:null};
    const key=laneKey(event.stockId,event.candidate),prior=busy.get(key);
    if(prior&&event.at<prior.until){row.reason='overlapping-prior-horizon';row.overlappingEventId=prior.eventId;labels.push(row);continue;}
    const entryIndex=frames.findIndex(s=>s.at>=event.at+executionDelayMs),entry=frames[entryIndex];
    if(!entry){row.reason='log-ends-before-entry';labels.push(row);continue;}
    row.entryAt=entry.at;row.entryMarketAt=marketAt(entry);
    const stock=entry.view.stocks.find(s=>String(s.id)===String(event.stockId));
    const entryDue=executionDelayMs===0?marketAt(frames[index.get(event.at)]):event.at+executionDelayMs;
    let reason=entry.at-event.at>10*minute?'entry-observation-gap':quoteReason(entry,stock,entryDue);
    if(!reason&&!fee(entry.view.rules?.buyFeePct))reason='unknown-entry-fee';
    if(reason){row.reason=reason;labels.push(row);continue;}
    row.entryPriceCents=stock.priceCents;row.buyFeePct=entry.view.rules.buyFeePct;
    const due=entry.at+holdMinutes*minute,exitIndex=frames.findIndex(s=>s.at>=due),exit=frames[exitIndex];
    row.exitDueAt=due;row.exitAt=exit?.at??null;
    busy.set(key,{eventId:event.id,until:exit?.at??study.to+1});
    if(!exit){row.reason='log-ends-before-horizon';labels.push(row);continue;}
    row.exitMarketAt=marketAt(exit);
    const end=exit.view.stocks.find(s=>String(s.id)===String(event.stockId));
    reason=exit.at-due>5*minute?'late-horizon-observation':quoteReason(exit,end,due);
    if(!reason&&frames.slice(index.get(event.at)+1,exitIndex+1).some((s,j)=>s.at-frames[index.get(event.at)+j].at>10*minute))
      reason='internal-observation-gap';
    if(!reason&&!fee(exit.view.rules?.sellFeePct))reason='unknown-exit-fee';
    if(!reason){
      row.exitPriceCents=end.priceCents;row.sellFeePct=exit.view.rules.sellFeePct;
      row.grossChange=end.priceCents/stock.priceCents-1;
      row.netChange=end.priceCents*(1-row.sellFeePct/100)/(stock.priceCents*(1+row.buyFeePct/100))-1;
    }
    row.reason=reason;labels.push(row);
  }
  const summaries=['S1','S2'].map(candidate=>{
    const rows=labels.filter(l=>l.candidate===candidate),known=rows.filter(l=>l.netChange!==null);
    const average=key=>known.length?known.reduce((n,l)=>n+l[key],0)/known.length:null;
    return {candidate,events:rows.length,evaluable:known.length,positive:known.filter(l=>l.netChange>0).length,
      missing:rows.length-known.length,meanNetChange:average('netChange'),meanGrossChange:average('grossChange'),
      exclusions:Object.fromEntries([...new Set(rows.filter(l=>l.reason).map(l=>l.reason))].map(reason=>[reason,rows.filter(l=>l.reason===reason).length])),
      observedDates:[...new Set(known.map(l=>l.date))],marketHours:[...new Set(known.map(l=>l.marketHour))]};
  });
  return {kind:'stock-signal-horizon-labels',from:study.from,to:study.to,holdMinutes,executionDelayMs,
    eventCounts:study.counts,labels,summaries,tradeSimulation:false,qualifiedForLive:false,
    limitations:['Each visible S1/S2 episode contributes at most one non-overlapping horizon per stock. Cross-stock episodes may still be correlated.',
      'Entry uses the first observation after the fixed delay; the horizon starts at that observation. The first horizon quote is used, never a later favourable substitute.',
      'Missing fees, unavailable quotes, gaps over ten minutes and horizon observations over five minutes late remain unknown.',
      'Net price returns include proportional fees but exclude integer rounding, account limits, sale submission delay, price impact and actual fills.',
      'Recorded market-read times must belong to the measured window; legacy frames without them use observation time only.',
      'Already inspected data cannot become an untouched holdout by splitting timestamps. No label qualifies a live buy or certifies profit.']};
}

// Bind episode evidence to the first actually simulated lot in that episode. Repeated
// trades remain in the portfolio and in the performance cohort, but cannot inflate N.
// [from,to) is an evaluation cutoff, not a claim that the data is an untouched holdout.
export function labelStockReplay(study,replay,{from=study?.from,to=(study?.to??-1)+1}={}) {
  const policy=replay?.simulation?.strategy;
  if(study?.kind!=='independent-stock-signal-events'||!policy||!time(from)||!time(to)||from>=to||
    from<study.from||to>study.to+1||replay.simulation.from!==study.from||replay.simulation.to!==study.to)
    throw Error('Matching event and replay coverage with a valid cutoff required');
  if(!['S1','S2'].includes(policy.candidate))return {kind:'stock-event-labels',policy,applicable:false,reason:'control-has-no-research-event-labels'};
  const episodes=study.events.filter(e=>e.candidate===policy.candidate&&e.at<to);
  const labels=new Map(episodes.map(e=>[e.id,{eventId:e.id,stockId:e.stockId,at:e.at,date:e.date,marketHour:e.marketHour,
    policy,origin:e.at<from?'prior-segment-event':'segment-event',orders:[],lotIds:[],blockingReasons:[]} ]));
  const evaluations=new Map(study.evaluations.filter(e=>e.candidate===policy.candidate&&e.at<to)
    .map(e=>[JSON.stringify([String(e.stockId),e.at]),e]));
  const orderEvent=new Map(),orders=new Map(replay.orders.filter(o=>o.decisionAt<to).map(o=>[o.id,o]));
  for(const o of orders.values())if(o.action==='buy'&&o.research){
    const e=evaluations.get(JSON.stringify([String(o.stockId),o.decisionAt]));
    if(!e||e.outcome!=='true'||!labels.has(e.eventId)||o.research.signalAt!==o.decisionAt||
      o.research.candidate!==policy.candidate||o.research.holdMinutes!==policy.holdMinutes||o.research.exitMode!==policy.exitMode||
      hash(o.research.features)!==e.featuresHash)
      throw Error('Research order has no matching visible signal event');
    const resolved=o.resolvedAt!==undefined&&o.resolvedAt<to;
    orderEvent.set(o.id,e.eventId);labels.get(e.eventId).orders.push({id:o.id,at:o.decisionAt,
      status:resolved?o.status:'pending',resolvedAt:resolved?o.resolvedAt:null,
      reason:resolved&&o.status!=='filled'?o.reason:null,reservedTokens:o.reservedTokens});
  }
  for(const c of replay.strategy.checks)if(c.stage==='entry'&&c.at<to){
    const e=evaluations.get(JSON.stringify([String(c.stockId),c.at]));
    if(e?.outcome==='true'&&labels.has(e.eventId))for(const reason of c.reasons??[]){
      const row=labels.get(e.eventId);if(!row.blockingReasons.includes(reason))row.blockingReasons.push(reason);
    }
  }
  const lots=[],active=new Map((replay.simulation.initialPositions??[]).map(p=>[String(p.stockId),
    {id:'opening:'+p.stockId,stockId:p.stockId,remainingShares:p.shares,remainingCost:p.costBasisTokens,origin:'opening'}]));
  let last=-Infinity;
  for(const t of replay.trades){
    if(!time(t.at)||t.at<last)throw Error('Replay trades must be chronological');last=t.at;if(t.at>=to)continue;
    const key=String(t.stockId);
    if(t.action==='buy'){
      if(active.has(key)||!positive(t.shares)||!positive(t.debit))throw Error('Conflicting replay lot');
      const eventId=orderEvent.get(t.id)??null;
      const lot={id:t.id,stockId:t.stockId,eventId,decisionAt:t.decisionAt,enteredAt:t.at,closedAt:null,
        cost:t.debit,remainingShares:t.shares,remainingCost:t.debit,proceeds:0,releasedCost:0,sales:[]};
      active.set(key,lot);if(eventId){lots.push(lot);labels.get(eventId).lotIds.push(t.id);}
    }else if(t.action==='sell'){
      const lot=active.get(key);
      if(!lot||!positive(t.shares)||t.shares>lot.remainingShares||!Number.isSafeInteger(t.releasedCost)||t.releasedCost<0||
        t.releasedCost>lot.remainingCost||!Number.isSafeInteger(t.proceeds)||t.proceeds<0)throw Error('Unbound or invalid replay sale');
      lot.remainingShares-=t.shares;lot.remainingCost-=t.releasedCost;
      if(lot.origin!=='opening'){
        lot.proceeds+=t.proceeds;lot.releasedCost+=t.releasedCost;lot.sales.push({id:t.id,at:t.at,shares:t.shares,proceeds:t.proceeds,releasedCost:t.releasedCost});
      }
      if(!lot.remainingShares){if(lot.remainingCost!==0)throw Error('Closed lot retained cost');lot.closedAt=t.at;active.delete(key);}
    }else throw Error('Unknown replay trade');
  }
  const lotById=new Map(lots.map(l=>[l.id,l])),busy=new Map();
  for(const label of labels.values()){
    const lot=lotById.get(label.lotIds[0]),previous=busy.get(String(label.stockId));
    label.primaryLot=lot??null;label.repeatLots=label.lotIds.slice(1);
    label.status=lot?(lot.closedAt!==null?'closed':lot.sales.length?'partially-sold':'still-held'):
      label.orders.some(o=>o.status==='pending')?'entry-pending':label.orders.length?'entry-rejected':'not-traded';
    label.net=lot&&lot.closedAt!==null?lot.proceeds-lot.cost:null;
    label.overlap=!!lot&&previous!==undefined&&label.at<previous;
    if(lot)busy.set(String(label.stockId),Math.max(...label.lotIds.map(id=>lotById.get(id).closedAt??Infinity)));
    label.counted=label.origin==='segment-event'&&label.status==='closed'&&!label.overlap;
    label.exclusion=label.counted?null:label.origin==='prior-segment-event'?'event-started-before-segment':
      label.overlap?'overlapping-prior-label':label.status;
  }
  const rows=[...labels.values()],counted=rows.filter(l=>l.counted);
  const cohort=lots.filter(l=>l.decisionAt>=from&&l.closedAt!==null),totalCost=cohort.reduce((n,l)=>n+l.cost,0);
  const winners=cohort.filter(l=>l.proceeds>l.cost),losers=cohort.filter(l=>l.proceeds<l.cost),flat=cohort.filter(l=>l.proceeds===l.cost);
  const sum=(ls,fn)=>ls.reduce((n,l)=>n+fn(l),0),winCost=sum(winners,l=>l.cost),lossCost=sum(losers,l=>l.cost);
  return {kind:'stock-event-labels',applicable:true,policy,from,to,labels:rows,lots,
    summary:{events:rows.length,countedNonOverlappingClosed:counted.length,dates:[...new Set(counted.map(l=>l.date))],
      byStatus:Object.fromEntries([...new Set(rows.map(l=>l.status))].map(status=>[status,rows.filter(l=>l.status===status).length])),
      overlapping:rows.filter(l=>l.overlap).length,priorSegment:rows.filter(l=>l.origin==='prior-segment-event').length,
      repeatedTrades:rows.reduce((n,l)=>n+l.repeatLots.length,0),remainingSignalCost:sum(lots,l=>l.remainingCost),
      accountHeldCostAtCutoff:sum([...active.values()],l=>l.remainingCost)},
    closedNewLotsPerformance:{cohort:'new decisions inside [from,to), fully sold before to; not window equity return',
      lots:cohort.length,cost:totalCost,net:sum(cohort,l=>l.proceeds-l.cost),
      capitalWeightedReturn:totalCost?sum(cohort,l=>l.proceeds-l.cost)/totalCost:null,
      winCapitalFraction:totalCost?winCost/totalCost:null,lossCapitalFraction:totalCost?lossCost/totalCost:null,
      flatCapitalFraction:totalCost?sum(flat,l=>l.cost)/totalCost:null,
      meanWinReturn:winCost?sum(winners,l=>l.proceeds-l.cost)/winCost:null,
      meanLossMagnitude:lossCost?sum(losers,l=>l.cost-l.proceeds)/lossCost:null},
    marketGroups:[...new Set(rows.map(l=>l.marketHour))].map(marketHour=>({marketHour,
      events:rows.filter(l=>l.marketHour===marketHour).length,counted:counted.filter(l=>l.marketHour===marketHour).length})),
    qualifiedForLive:false,limitations:['One first filled lot per event and policy may count; subsequent trades remain in portfolio results.',
      'No forced liquidation, invented quote label or removal of incomplete positions; costs of unclosed lots remain visible.',
      'The cutoff masks later fills and sales. Segment selection, freezing, true website rules and independent holdout validation are still separate gates.']};
}
