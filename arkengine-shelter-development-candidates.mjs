import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterFamilySimulation} from './arkengine-shelter-family-simulation.mjs';
import {createShelterExchangeCandidates} from './arkengine-shelter-exchange-candidates.mjs';
import {createShelterMaterialCandidates} from './arkengine-shelter-material-candidates.mjs';

// D.14 common first-action input. This enumerates and checks proposals, not complete routes.
// A ready first action is never a seven-day winner or permission for a native request.
export function createShelterDevelopmentCandidates() {
  const routes=createShelterRouteSimulation(),resource=createShelterResourceSimulation(),family=createShelterFamilySimulation(),exchanges=createShelterExchangeCandidates(),
    materials=createShelterMaterialCandidates();
  const tick=600000,keys=['power','food','water','scrap','parts','stimpak'];
  const production={power:['power','str',100],diner:['food','agi',100],water:['water','per',100],
    scrap:['scrap','end',80],workshop:['parts','int',500],medbay:['stimpak','int',300]};
  const base={...Object.fromEntries(Object.entries(production).map(([k,v])=>[k,v[2]])),quarters:120,storage:80,
    training:400,armory:600,tailor:600,radio:800};
  const active=(r,at)=>r&&r.builtAt<=at&&r.upgradeAt===null&&!r.unpowered&&!r.incident;
  const present=(p,at)=>p.deadAt===null&&p.away===null&&p.adultAt<=at;
  const text=s=>typeof s==='string'&&s.trim().length>0;
  const status=blocked=>blocked.length?blocked.some(b=>/unknown|missing|needed|not-modeled|unmodeled/.test(b.kind+' '+(b.reason??'')))?'unknown':'blocked':'ready';
  const person=(n,residentId,from=n.view.serverTime)=>({residentId,from,until:n.book.windowEnd});
  const seat=(n,residentId,roomId,from=n.view.serverTime)=>({...person(n,residentId,from),roomId});
  const move=(p,r)=>({kind:'assign',residentId:p.id,fromRoomId:p.roomId,roomId:r.id});
  const signature=n=>JSON.stringify(n);
  const rates=view=>Object.fromEntries(keys.map(k=>[k,view.state.rooms.filter(r=>production[r.type]?.[0]===k)
    .reduce((sum,r)=>sum+resource.rate(view,r,view.serverTime),0)]));
  function eligible(n,p) {
    const why=[],at=n.view.serverTime,s=n.view.state;
    if(!present(p,at))why.push('not-present-adult');
    if(p.romance)why.push('active-romance');
    const maxHp=Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end));
    if(!Number.isFinite(p.hp))why.push('unknown-health');else if(p.hp<.6*maxHp)why.push('low-health');
    const role=n.existing?.roles.find(r=>r.residentId===p.id&&['active','preempted','return-due'].includes(r.status));
    const owners=n.book.entries.filter(e=>!['complete','cancelled'].includes(e.status)&&
      e.people.some(c=>c.residentId===p.id&&c.until>at));
    if(owners.some(e=>e.id!==role?.intentId))why.push('resident-reserved');
    if(role&&role.record.role!=='training')why.push('special-role-value-not-modeled');
    if(n.existing?.defense.some(d=>d.id===p.id))why.push('defense-recovery-not-modeled');
    const room=s.rooms.find(r=>r.id===p.roomId);
    if(room&&['medbay','workshop','radio','armory','tailor','door'].includes(room.type)&&!role)
      why.push('special-role-value-not-modeled');
    return {residentId:p.id,roomId:p.roomId,reasons:why,eligible:!why.length,intentId:role?.intentId??null};
  }
  function goals(n) {
    routes.inspect(n);const s=n.view.state,at=n.view.serverTime,result=[];
    const supply=routes.supply(n);
    for(const [key,v] of Object.entries(supply))if(v.deficit>1e-7||v.inventoryGap>1e-7)
      result.push({id:'supply:'+key,kind:'supply',resource:key,rate:v.need*1.2,inventory:v.need*2,
        source:'current roster, paid construction and shared family commitments'});
    const residents=s.residents.filter(p=>present(p,at)&&(!p.roomId||s.rooms.some(r=>r.id===p.roomId&&r.type==='quarters'))&&!p.romance).map(p=>p.id);
    if(residents.length)result.push({id:'employment:'+n.view.vaultNo+':'+at,kind:'employment',residentIds:residents,
      source:'observed unemployed adults; no projected children counted as employed'});
    return result;
  }
  function validateGoal(n,g) {
    if(!g||!text(g.id)||g.id.length>120||!text(g.source)||!['employment','supply','stock','unlock'].includes(g.kind))throw Error('Explicit common development goal required');
    if(g.kind==='employment'&&(!Array.isArray(g.residentIds)||!g.residentIds.length||
      new Set(g.residentIds).size!==g.residentIds.length||g.residentIds.some(x=>!n.view.state.residents.some(p=>p.id===x))))
      throw Error('Employment goal must bind observed residents');
    if(['supply','stock'].includes(g.kind)&&(!keys.includes(g.resource)||g.kind==='stock'&&(!Number.isFinite(g.amount)||g.amount<0)||
      g.kind==='supply'&&(!['power','food','water'].includes(g.resource)||![g.rate,g.inventory].every(x=>Number.isFinite(x)&&x>=0))))
      throw Error('Invalid resource goal');
    if(g.kind==='unlock'&&(!Number.isInteger(g.score)||g.score<0||!text(g.benefit)))throw Error('Unlock requires verified score and productive use');
  }
  function prepare(n,p) {
    if(p.blocked?.length)return {node:n,accepted:false,blocked:p.blocked};
    if(n.view.serverTime>=n.book.windowEnd)return {node:n,accepted:false,blocked:[{kind:'planning-window-ended'}]};
    if(n.pending)return {node:n,accepted:false,blocked:[{kind:'pending-action-timing-unknown'}]};
    if(n.existing?.native.length)return {node:n,accepted:false,blocked:[{kind:'inherited-native-pending',reason:'unknown original outcome'}]};
    if(p.kind==='wait')return {node:n,accepted:true,blocked:[],action:null};
    let next=n;
    if(p.intent){const held=routes.reserve(next,p.intent);if(!held.accepted)return held;next=held.node;}
    if(p.continuation?.kind==='material-upgrade'){
      const prepared=materials.prepare(next,p);if(!prepared.accepted)return prepared;next=prepared.node;
    }
    let sequenceCheck=null;
    if(p.continuation?.kind==='exchange-sequence'){
      sequenceCheck=exchanges.check(next,p);
      if(!sequenceCheck.accepted)return {node:n,accepted:false,blocked:sequenceCheck.blocked,sequenceCheck};
    }
    if(p.familyPlan){const linked=routes.registerFamily(next,p.intentId,p.familyPlan);if(!linked.accepted)return linked;next=linked.node;}
    if(p.familyPlan){
      const view=structuredClone(next.view),blocked=[];
      for(const e of next.book.entries.filter(e=>!['cancelled','complete'].includes(e.status)))for(const f of e.families)
        if(f.dueAt===null&&f.childId===null)for(const id of f.parents){const person=view.state.residents.find(p=>p.id===id);if(person)person.roomId=null;}
      for(const [key,value] of Object.entries(routes.supply({...next,view})))if(value.deficit>1e-7||value.inventoryGap>1e-7)
        blocked.push({kind:'family-supply-not-covered',resource:key,...value});
      if(blocked.length)return {node:n,accepted:false,blocked};
    }
    if(!p.action)return {node:next,accepted:true,blocked:[],action:null};
    const checked=routes.preview(next,p.intentId,p.action);
    const before=rates(n.view),after=checked.blocked.length?null:rates(checked.node.view);
    return {node:next,accepted:!checked.blocked.length,blocked:checked.blocked,action:p.action,sequenceCheck,
      cost:checked.cost,supplyAfter:checked.blocked.length?null:routes.supply(checked.node),
      productionDelta:after?Object.fromEntries(keys.map(k=>[k,after[k]-before[k]])):null};
  }
  function enumerate(n,{goal=goals(n)[0],familyOutcomes=[],constructionEvidence=[],maxChecks=2000}={}) {
    const inputSignature=signature(n),report=routes.inspect(n),at=n.view.serverTime,s=n.view.state;
    validateGoal(n,goal);
    if(!Number.isInteger(maxChecks)||maxChecks<1||maxChecks>2000||!Array.isArray(familyOutcomes)||!Array.isArray(constructionEvidence))
      throw Error('Invalid candidate evidence or bounded check budget');
    if(new Set(constructionEvidence.map(p=>p?.id)).size!==constructionEvidence.length||
      new Set(familyOutcomes.map(p=>[...(p?.parents??[])].sort((a,b)=>a-b).join('/'))).size!==familyOutcomes.length)
      throw Error('Duplicate candidate evidence identity');
    const groups=Object.fromEntries(['wait','assign','family','train','project'].map(k=>[k,[]]));
    const people=[...s.residents].sort((a,b)=>a.id-b.id).map(p=>({...eligible(n,p),p}));
    const workers=people.filter(x=>x.eligible),rooms=s.rooms.filter(r=>active(r,at)),jobs=rooms.filter(r=>production[r.type]);
    let checks=0,familyPairsWithoutOutcome=0;const identities=new Set();
    function add(p) {
      if(identities.has(p.id))throw Error('Duplicate candidate identity');identities.add(p.id);
      // A candidate label is reusable after a completed action; its reservation identity
      // is not. Keep old payments/receipts and give this occurrence a fresh bound intent.
      if(p.intent&&n.book.entries.some(e=>e.id===p.intent.id)){
        const stem=p.intent.id+'@'+at;let next=stem,index=1;
        while(n.book.entries.some(e=>e.id===next))next=stem+':'+index++;
        p.intent.id=next;p.intentId=next;
        if(p.familyPlan){p.familyPlan.key=next;if(p.action)p.action.familyKey=next;}
      }
      const row={...p,goalId:goal.id,routeComplete:false,blocked:p.blocked??[]};
      row.status=row.blocked.length?status(row.blocked):'unchecked';
      groups[row.kind].push(row);return row;
    }
    function intent(key,ids,seats=[],extra={}) {return {id:key,purpose:'common development goal '+goal.id,
      people:ids.map(x=>person(n,x)),seats,...extra};}
    const future=[...s.residents.map(p=>({kind:'adulthood',id:p.id,at:p.adultAt})),...s.births.map(b=>({kind:'birth',id:b.roomId,at:b.dueAt})),
      ...s.rooms.flatMap(r=>[{kind:'construction',id:r.id,at:r.builtAt},{kind:'upgrade',id:r.id,at:r.upgradeAt}]),
      ...(n.existing?.roles??[]).map(r=>({kind:'training-deadline',id:r.residentId,at:r.record.until}))]
      .filter(e=>Number.isSafeInteger(e.at)&&e.at>at).sort((a,b)=>a.at-b.at||a.id-b.id);
    add({id:'wait',kind:'wait',action:null,nextAt:Math.min(at+tick,future[0]?.at??Infinity,n.book.windowEnd),
      nextEvent:future[0]??{kind:'next-settlement',at:at+tick},blocked:[...report.blocked,...report.inherited],
      continuation:{kind:'observe-and-regenerate',originalWindowEnd:n.book.windowEnd}});
    if(n.existing?.swap&&!['complete','cancelled'].includes(n.existing.swap.status)){
      const next=routes.nextExistingSwap(n);
      add({id:'existing-swap:'+n.existing.swap.step,kind:'assign',intentId:next.intentId,intent:null,action:next.action,
        blocked:next.blocked,continuation:{kind:'inherited-swap',step:n.existing.swap.step,total:n.existing.swap.moves.length}});
    }
    // Interleave destinations across the entire roster so a check limit is never a hidden
    // prefix-of-16 resident pool. Unchecked proposals remain explicit, not zero-benefit losers.
    for(const r of jobs)for(const x of workers){const p=x.p;if(p.roomId===r.id)continue;
      const key='assign:'+p.id+':'+r.id;
      add({id:key,kind:'assign',intentId:x.intentId??key,intent:x.intentId?null:intent(key,[p.id],[seat(n,p.id,r.id)]),
        action:move(p,r),continuation:{kind:'recompute-after-confirmed-employment'}});
    }
    // Current-snapshot selection cannot simulate receipts or later settlements,
    // and only accepts independent assignments. Three-step exchange routes would
    // all be rejected while consuming the checks needed by later direct moves.
    const exchange=n.model==='native-snapshot-first-action-only'?
      {rows:[],coverage:{evaluated:false,reason:'native-current-assignment-only',emitted:0}}:
      exchanges.enumerate(n,{people,goal,maxCandidates:maxChecks});
    for(const row of exchange.rows)add(row);
    // Family evidence supplies uncertain offspring outcomes; the enumerator supplies pairs,
    // location and first move. It never invents child IDs, attributes or native confirmations.
    for(const r of rooms.filter(r=>r.type==='quarters'))for(let i=0;i<workers.length;i++)for(let j=i+1;j<workers.length;j++){
      const pair=[workers[i].p,workers[j].p],ids=pair.map(p=>p.id),key='family:'+ids.join('/')+':'+r.id;
      const proof=familyOutcomes.find(o=>Array.isArray(o.parents)&&o.parents.length===2&&ids.every(x=>o.parents.includes(x)));
      if(!proof){familyPairsWithoutOutcome++;continue;}
      const plan={key,parents:ids,roomId:r.id,stage:'planned',child:structuredClone(proof.child),source:proof.source};
      if(plan.child?.roomId!==null&&plan.child?.roomId!==r.id){
        add({id:key,kind:'family',blocked:[{kind:'child-room-outcome-mismatch',roomId:r.id}]});continue;}
      try{family.validate([plan],n.familyRules);}catch(error){add({id:key,kind:'family',blocked:[{kind:'unknown-family-outcome',reason:error.message}]});continue;}
      const blocked=family.eligibility(n.view,plan,{ignoreLocation:true});
      const first=pair.find(p=>p.roomId!==r.id);
      add({id:key,kind:'family',intentId:key,intent:intent(key,ids,ids.map(x=>seat(n,x,r.id)),
        {families:[{parents:ids,dueAt:null,childId:null}]}),familyPlan:plan,
        action:first?{...move(first,r),familyKey:key}:null,blocked,
        continuation:{kind:'family-through-employed-child',parents:ids,originalRooms:pair.map(p=>p.roomId),childId:plan.child.id}});
    }
    if(familyPairsWithoutOutcome||!groups.family.length)add({id:'family:evidence',kind:'family',
      blocked:[{kind:'missing-child-outcome-evidence',pairLocationsWithoutOutcome:familyPairsWithoutOutcome}]});
    const perk=s.legacy?.perks?.training??0;
    // Native local proposals have no future timing assumptions and only compare
    // current assignments. Training payoff routes belong to explicit offline inputs.
    for(const r of rooms.filter(r=>n.model!=='native-snapshot-first-action-only'&&r.type==='training'))for(const x of workers){const p=x.p;
      if(!['str','per','end','cha','int','agi','lck'].includes(r.trainStat)||!Number.isInteger(p.stats[r.trainStat])||!Number.isInteger(perk)||perk<0||perk>10){
        add({id:'train:'+p.id+':'+r.id,kind:'train',blocked:[{kind:'unknown-training-state'}]});continue;}
      if(p.stats[r.trainStat]>=10)continue;
      const progress=p.roomId===r.id?p.training:0;
      if(!Number.isFinite(progress)||progress<0||progress>=1){add({id:'train:'+p.id+':'+r.id,kind:'train',blocked:[{kind:'unknown-training-progress'}]});continue;}
      const duration=Math.max(1,Math.ceil((1-progress)/(r.level*(1+.05*perk)/(p.stats[r.trainStat]+1)/6)-1e-9))*tick;
      const readyAt=at+duration,role=n.existing?.roles.find(q=>q.intentId===x.intentId),deadline=Math.min(n.book.windowEnd,role?.record.until??Infinity,role?.record.windowEnd??Infinity);
      for(const dest of jobs.filter(q=>production[q.type][1]===r.trainStat)){
        const key='train:'+p.id+':'+r.id+':'+dest.id,blocked=[];
        if(readyAt>=deadline)blocked.push({kind:'training-cannot-return-before-deadline',readyAt,deadline});
        const claims=readyAt<n.book.windowEnd?[{...seat(n,p.id,r.id),until:readyAt},seat(n,p.id,dest.id,readyAt)]:[];
        if(x.intentId&&(!role||role.roomId!==r.id||role.record.destination!==dest.id))blocked.push({kind:'inherited-training-destination-mismatch'});
        if(role&&(p.stats[role.record.stat]>role.record.base||at>=deadline))blocked.push({kind:'inherited-training-return-due'});
        add({id:key,kind:'train',intentId:x.intentId??key,intent:x.intentId?null:intent(key,[p.id],claims),
          action:p.roomId===r.id?null:move(p,r),blocked,
          continuation:{kind:'one-stat-then-return',residentId:p.id,stat:r.trainStat,base:p.stats[r.trainStat],
            roomId:dest.id,readyAt,deadline,source:n.assumptions.source,needsFullPaybackComparison:true}});
      }
    }
    const materialCoverage=[];
    for(const proof of constructionEvidence){
      if(!proof||proof.goalId!==goal.id)continue;
      const a=structuredClone(proof.action),r=s.rooms.find(r=>r.id===a?.roomId),key='project:'+String(proof.id),blocked=[];
      if(!text(proof.id)||!a||!['build','upgrade','dig'].includes(a.kind)||!text(proof.source)||
        !Number.isSafeInteger(proof.durationMs)||proof.durationMs<=0)throw Error('Explicit bound construction outcome and duration required');
      a.source=proof.source;a.finishAt=at+proof.durationMs;
      const type=a.kind==='build'?a.type:r?.type;
      let useful=['stock','supply'].includes(goal.kind)&&production[type]?.[0]===goal.resource;
      if(goal.kind==='stock'&&type==='storage')useful=resource.capacities(n.view)[goal.resource]<goal.amount;
      if(goal.kind==='employment')useful=!!production[type]&&Array.isArray(proof.residentIds)&&proof.residentIds.length>0&&
        proof.residentIds.every(id=>goal.residentIds.includes(id));
      if(goal.kind==='unlock')useful=proof.benefit===goal.benefit;
      if(!useful)blocked.push({kind:'project-not-linked-to-goal'});
      let cost={scrap:0,parts:0};
      if(a.kind==='upgrade'&&r&&base[r.type])cost={scrap:Math.ceil(base[r.type]*r.width*(r.level===1?2.5:6)),parts:r.level===1?0:15*r.width};
      else if(a.kind==='build'&&base[a.type])cost.scrap=Math.ceil(base[a.type]*(1+.2*s.rooms.filter(q=>q.type===a.type).reduce((v,q)=>v+q.width,0)));
      else if(a.kind==='dig')cost.scrap=Math.ceil(120*(s.depth+1)**1.4);
      else blocked.push({kind:'invalid-project-target'});
      const shortage=Object.fromEntries(['scrap','parts'].map(k=>[k,Math.max(0,cost[k]-report.free[k])]));
      if(shortage.scrap>1e-7||shortage.parts>1e-7)blocked.push({kind:'project-needs-material-route',shortage});
      add({id:key,kind:'project',intentId:key,intent:intent(key,[],[],{resources:cost}),action:a,blocked,
        continuation:{kind:'completion-power-staff-then-use',goalId:goal.id,finishAt:a.finishAt,requiredCost:cost}});
      if(a.kind==='upgrade'&&r&&blocked.length===1&&blocked[0].kind==='project-needs-material-route'){
        const generated=materials.enumerate(n,{proof,goal,cost,people,maxCandidates:maxChecks});
        materialCoverage.push({proofId:proof.id,...generated.coverage});for(const row of generated.rows)add(row);
      }
    }
    if(!constructionEvidence.some(p=>p?.goalId===goal.id))add({id:'project:evidence',kind:'project',blocked:[{kind:'missing-goal-construction-evidence'}]});
    if(!groups.train.length)add({id:'train:none',kind:'train',blocked:[{kind:rooms.some(r=>r.type==='training')?
      'training-purpose-not-modeled':'no-existing-training-destination'}]});
    // Share checking capacity across first-action types before allocating extra checks to a
    // large assignment matrix. This is admission coverage, not beam-search ranking.
    const assignments=groups.assign.filter(p=>p.status==='unchecked'),moves=assignments.filter(p=>p.continuation?.kind!=='exchange-sequence'),
      swaps=assignments.filter(p=>p.continuation?.kind==='exchange-sequence'),interleaved=[];
    for(let i=0;i<Math.max(moves.length,swaps.length);i++){if(moves[i])interleaved.push(moves[i]);if(swaps[i])interleaved.push(swaps[i]);}
    const queues=Object.entries(groups).map(([kind,rows])=>kind==='assign'?interleaved:rows.filter(p=>p.status==='unchecked'));
    for(let index=0;queues.some(q=>q[index]);index++)for(const queue of queues){const row=queue[index];if(!row)continue;
      if(checks>=maxChecks){row.status='truncated';row.blocked=[{kind:'candidate-check-budget'}];continue;}
      checks++;const trial=prepare(n,row);row.blocked=trial.blocked;row.status=status(row.blocked);
      if(trial.sequenceCheck)row.sequenceCheck=trial.sequenceCheck;
      row.cost=trial.cost??null;row.supplyAfter=trial.supplyAfter??null;row.productionDelta=trial.productionDelta??null;
    }
    return {version:1,goal:structuredClone(goal),basis:inputSignature,from:at,windowEnd:n.book.windowEnd,
      people:people.map(({p,...x})=>x),groups,checks,maxChecks,selected:null,
      summary:Object.entries(groups).map(([kind,rows])=>({kind,counts:Object.fromEntries(['ready','blocked','unknown','truncated']
        .map(state=>[state,rows.filter(p=>p.status===state).length])),firstReady:rows.find(p=>p.status==='ready')?.id??null,
        completeRoutes:0})),
      coverage:{familyPairsWithoutOutcome,checkedByKind:Object.fromEntries(Object.entries(groups)
        .map(([k,rows])=>[k,rows.filter(p=>p.cost!==undefined).length])),
        completeRoutes:0,fullRoomExchangeGenerated:exchange.rows.length>0,exchange:exchange.coverage,materials:materialCoverage,
        exchangeCheckedMoves:groups.assign.reduce((sum,p)=>sum+(p.sequenceCheck?.checkedMoves??0),0)},
      limitations:['First-action admissibility only; no complete 168-hour comparison or optimal selection.',
        'Two-person exchanges and new upgrade material candidates are bounded; larger cycles, other special roles and full route selection remain incomplete.',
        'Family and construction outcomes are explicit conditional evidence, not invented server results.']};
  }
  function prepareFirst(n,report,candidateId) {
    if(report?.version!==1||report.basis!==signature(n))throw Error('Candidate snapshot changed; regenerate before preparation');
    const row=Object.values(report.groups).flat().find(p=>p.id===candidateId);
    if(!row)throw Error('Unknown development candidate');
    if(row.status==='truncated')return {node:n,accepted:false,blocked:row.blocked};
    return prepare(n,row);
  }
  return {goals,enumerate,prepareFirst};
}
