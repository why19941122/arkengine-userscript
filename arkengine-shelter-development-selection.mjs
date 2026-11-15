import {createShelterSelectionDigest} from './arkengine-shelter-selection-digest.mjs';
import {createShelterDevelopmentCandidates} from './arkengine-shelter-development-candidates.mjs';
import {createShelterDevelopmentContinuation} from './arkengine-shelter-development-continuation.mjs';
import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';

const tick=600000,hour=3600000,keys=['power','food','water','scrap','parts','stimpak'];
const kinds=['wait','assign','family','train','project'],copy=structuredClone,eps=1e-6;
const hash=createShelterSelectionDigest();
const text=x=>typeof x==='string'&&x.trim().length>0;
const merge=(a,b)=>{const values=new Map(a.map(x=>[x.at,x]));for(const x of b){const old=values.get(x.at);
  values.set(x.at,old?{...x,minimumInventory:Object.fromEntries(keys.map(k=>[k,Math.min(old.minimumInventory[k],x.minimumInventory[k])]))}:x);
}return [...values.values()].sort((a,b)=>a.at-b.at);};

// Reuses actual conditional continuations. No invented offspring, construction times,
// simultaneous swaps, market conversion, or native receipts are introduced here.
export function createShelterDevelopmentSelection(){
  const candidates=createShelterDevelopmentCandidates(),continuation=createShelterDevelopmentContinuation(),routes=createShelterRouteSimulation();
  let localReport=null;
  function options(n,o,local=false){
    if(!o||!o.goal||!o.execution)throw Error('A common goal and explicit execution assumptions are required');
    if(n.book.windowEnd-n.book.startedAt!==168*hour||n.view.serverTime<n.book.startedAt||
      n.view.serverTime>=n.book.windowEnd||!local&&(n.book.windowEnd-n.view.serverTime)%tick!==0)
      throw Error('Selection requires a remaining tick-aligned horizon in the original fixed 168-hour window');
    const p={familyOutcomes:[],constructionEvidence:[],completions:{},surplus:[],goalDeadline:null,
      beamWidth:8,maxProjects:8,maxExpansions:2000,maxChecks:2000,checksPerNode:64,...copy(o)};
    for(const [key,limit] of Object.entries({beamWidth:8,maxProjects:8,maxExpansions:2000,maxChecks:2000,checksPerNode:2000}))
      if(!Number.isInteger(p[key])||p[key]<1||p[key]>limit)throw Error('Invalid bounded selection budget: '+key);
    if(p.beamWidth<kinds.length)throw Error('Beam width must preserve all five first-action classes');
    if(!Array.isArray(p.surplus)||new Set(p.surplus.map(x=>x.resource)).size!==p.surplus.length||
      p.surplus.some(x=>!['power','food','water'].includes(x.resource)||x.resource===p.goal.resource||!text(x.source)||
        !Number.isSafeInteger(x.through)||x.through<n.book.windowEnd||x.knownLaterCommitmentsCovered!==true))
      throw Error('Surplus needs explicit purpose evidence through the window and known later commitments');
    if(p.goalDeadline!==null&&(!Number.isSafeInteger(p.goalDeadline)||p.goalDeadline<n.view.serverTime||p.goalDeadline>n.book.windowEnd))
      throw Error('Invalid common goal deadline');
    if(!p.completions||typeof p.completions!=='object'||Array.isArray(p.completions))throw Error('Completion plans must be bound by candidate ID');
    return p;
  }
  function compact(s){return {at:s.at,employed:s.employedIds.length,free:s.free,stored:s.stored,rates:s.rates,
    supply:s.supply,minimumInventory:s.minimumInventory,recoveringSupply:s.recoveringSupply,goal:s.goalAchieved};}
  function evaluate(branch,p){
    const run=continuation.advance(branch.state,branch.state.origin.windowEnd,{collectTrajectory:true});
    const report=continuation.report(run.state),trajectory=merge(branch.trace,run.trajectory.map(compact));
    const supplySafe=Object.fromEntries(['power','food','water'].map(k=>[k,trajectory.every(t=>
      t.supply[k].deficit<=eps&&t.supply[k].inventoryGap<=eps)]));
    const unserved=Object.values(report.metrics.unserved).some(x=>x>eps);
    const supplyViolation=trajectory.some(t=>Object.entries(t.supply).some(([k,v])=>
      t.minimumInventory[k]+eps<2*v.need||v.deficit>eps&&!t.recoveringSupply.includes(k)));
    const complete=report.simulationComplete&&report.obligationsFulfilled&&report.goalAtEnd!==null&&!unserved&&!supplyViolation;
    const deadlineOk=p.goalDeadline===null||report.goalFirstAt!==null&&report.goalFirstAt<=p.goalDeadline;
    return {report,trajectory,supplySafe,status:!report.simulationComplete?
      report.blocked.some(b=>/unknown|missing|not.modeled|boundary/.test(b.kind))?'unknown':'blocked':
      !report.obligationsFulfilled?'unfinished':unserved||supplyViolation||!deadlineOk?'blocked':report.goalAtEnd===null?'unknown':'comparable',
      comparable:complete&&deadlineOk,deadlineOk,supplyViolation,
      trajectoryMinimum:Object.fromEntries(keys.map(k=>[k,Math.min(...trajectory.map(t=>t.minimumInventory[k]))]))};
  }
  function relevant(a,b,p){return keys.filter(k=>!p.surplus.some(x=>x.resource===k&&a.supplySafe[k]&&b.supplySafe[k]));}
  function vector(s,resources){return [s.employed,s.goal===true?1:0,...resources.flatMap(k=>[s.free[k],s.stored[k],s.rates[k]])];}
  function relation(av,bv){return {ge:av.every((x,i)=>x+eps>=bv[i]),strict:av.some((x,i)=>x>bv[i]+eps),equal:av.every((x,i)=>Math.abs(x-bv[i])<=eps)};}
  function compare(a,b,p){
    if(!a.comparable||!b.comparable)return {better:false,reason:'incomplete-or-unknown'};
    const resources=relevant(a,b,p),end=relation(vector(a.trajectory.at(-1),resources),vector(b.trajectory.at(-1),resources));
    if(!end.ge)return {better:false,reason:'useful-resource-or-production-tradeoff'};
    const ta=a.report.goalFirstAt??Infinity,tb=b.report.goalFirstAt??Infinity;
    if(end.equal){
      if(ta<tb)return {better:true,reason:'same-effective-end-earlier-goal',advanceMs:tb-ta};
      if(ta!==tb)return {better:false,reason:'later-goal-without-end-benefit'};
      const cost=r=>keys.map(k=>r.report.ending.accounting.paid[k]+r.report.ending.accounting.feed[k]);
      const costs=relation(cost(b),cost(a));
      if(!costs.equal)return {better:costs.ge&&costs.strict,reason:'equivalent-outcome-resource-cost-tie'};
      return {better:a.report.actions.length<b.report.actions.length,reason:'equivalent-outcome-action-tie',equivalent:a.report.actions.length===b.report.actions.length};
    }
    if(ta<=tb)return {better:true,reason:'earlier-or-equal-goal-and-better-effective-end',advanceMs:tb-ta};
    const other=new Map(b.trajectory.map(t=>[t.at,t]));let catchup=null;
    for(let i=a.trajectory.length-1;i>=0;i--){const x=a.trajectory[i],y=other.get(x.at);
      if(!y||!relation(vector(x,resources),vector(y,resources)).ge)break;catchup=x.at;}
    return {better:catchup!==null,reason:catchup===null?'unproved-payback':'later-goal-with-realized-window-payback',catchupAt:catchup};
  }
  function ordered(report){
    const queues=kinds.map(k=>report.groups[k]),result=[];
    for(let i=0;queues.some(q=>q[i]);i++)for(const q of queues)if(q[i])result.push(q[i]);
    return result;
  }
  function frontier(rows,p){return rows.filter(a=>!rows.some(b=>a!==b&&compare(b.evaluation,a.evaluation,p).better));}
  function choose(rows,p){
    const valid=rows.filter(x=>x.evaluation.comparable);if(!valid.length)return null;
    const best=frontier(valid,p).sort((a,b)=>a.id.localeCompare(b.id,'en'));
    if(best.length===1)return best[0];
    const first=best[0];return best.every(x=>x===first||compare(first.evaluation,x.evaluation,p).equivalent)?first:null;
  }
  function independentAssignment(n,report,p){
    const before=routes.supply(n),local=report.groups.assign.filter(row=>row.status==='ready'&&row.action?.kind==='assign'&&
      row.continuation?.kind==='recompute-after-confirmed-employment'&&row.productionDelta&&
      keys.every(k=>row.productionDelta[k]>=-eps)&&keys.some(k=>row.productionDelta[k]>eps)&&
      Object.entries(row.supplyAfter).every(([k,v])=>v.deficit<=before[k].deficit+eps&&v.inventoryGap<=before[k].inventoryGap+eps));
    local.sort((a,b)=>(b.productionDelta[p.goal.resource]??0)-(a.productionDelta[p.goal.resource]??0)||a.id.localeCompare(b.id,'en'));
    const row=local[0];return row?{routeId:null,firstCandidate:{at:n.view.serverTime,id:row.id,kind:row.kind},
      firstAction:{at:n.view.serverTime,action:copy(row.action)},report:null,choices:[]}:null;
  }
  function selectLocal(n,o){
    localReport=null;
    routes.inspect(n);const p=options(n,o,true),report=candidates.enumerate(n,{goal:p.goal,familyOutcomes:p.familyOutcomes,
      constructionEvidence:p.constructionEvidence,maxChecks:Math.min(p.checksPerNode,p.maxChecks)});
    const selected=independentAssignment(n,report,p);
    const body={kind:'bounded-development-selection',basis:hash(n),options:p,from:n.view.serverTime,
      windowStart:n.book.startedAt,windowEnd:n.book.windowEnd,selected,
      outcome:selected?'independent-local-improvement':'no-independent-local-improvement',
      budget:{checks:report.checks,expansions:0,terminalEvaluations:0},coverage:report.coverage,
      comparisons:[],qualifiedForNativeExecution:false,
      limitations:['Current non-worsening assignment only; no future simulation, seven-day winner or native receipt.']};
    const result={body,integrity:hash(body)};
    // The Worker immediately prepares this same result. Keep only its private
    // report; preparation still verifies both hashes and rechecks the one action.
    localReport={result,integrity:result.integrity,report};
    return result;
  }
  function select(input,o,resume=null){
    localReport=null;
    if(resume){
      continuation.report(resume);
      if(JSON.stringify(resume.node)!==JSON.stringify(input)||JSON.stringify(resume.goal)!==JSON.stringify(o?.goal)||
        JSON.stringify(resume.execution)!==JSON.stringify(o?.execution))throw Error('Replanning must preserve its continuation, goal and execution assumptions');
    }
    routes.inspect(input);const n=copy(input),p=options(n,o),basis=hash(n),all=[],rejected=[],coverage=[];
    const budget={expansions:0,checks:0,admissions:0,terminalEvaluations:0,beamPruned:0,projectPruned:0,unexpanded:0};
    let queue=[{id:'root',state:resume?copy(resume):null,node:n,trace:[],choices:[],projects:0,firstKind:null}],rootReport=null,depth=0;
    const makeReport=node=>{
      const allowed=Math.min(p.checksPerNode,p.maxChecks-budget.checks);
      if(allowed<1)return null;
      const report=candidates.enumerate(node,{goal:p.goal,familyOutcomes:p.familyOutcomes,
        constructionEvidence:p.constructionEvidence,maxChecks:allowed});budget.checks+=report.checks;
      coverage.push({at:node.view.serverTime,checks:report.checks,summary:report.summary,coverage:report.coverage});return report;
    };
    while(queue.length&&budget.expansions<p.maxExpansions&&budget.checks<p.maxChecks){
      const next=[];
      for(const parent of queue){
        if(budget.expansions>=p.maxExpansions||budget.checks>=p.maxChecks){budget.unexpanded++;continue;}
        const report=makeReport(parent.node);if(!report){budget.unexpanded++;continue;}
        rootReport??=report;
        for(const row of ordered(report)){
          if(budget.expansions>=p.maxExpansions){budget.unexpanded++;break;}
          budget.expansions++;
          const id=parent.id+'/'+row.id,firstKind=parent.firstKind??row.kind;
          if(row.status!=='ready') {rejected.push({id,firstKind,kind:row.kind,status:row.status,blocked:row.blocked});continue;}
          if(row.kind==='project'&&parent.projects>=p.maxProjects){budget.projectPruned++;rejected.push({id,firstKind,status:'truncated',blocked:[{kind:'route-project-budget'}]});continue;}
          if(parent.state?.workflows.some(w=>w.stage!=='done'&&w.candidateId===row.id))continue;
          const opt={execution:p.execution,completion:p.completions[row.id]??{}};
          budget.admissions++;
          const admitted=parent.state?continuation.append(parent.state,report,row.id,opt):continuation.start(n,report,row.id,opt);
          if(!admitted.accepted){rejected.push({id,firstKind,status:admitted.blocked.some(b=>/unknown|missing/.test(b.kind))?'unknown':'blocked',blocked:admitted.blocked});continue;}
          const immediate=continuation.advance(admitted.state,parent.node.view.serverTime,{collectTrajectory:true});
          const branch={id,state:immediate.state,node:immediate.state.node,firstKind,
            projects:parent.projects+(row.kind==='project'?1:0),choices:[...parent.choices,{at:parent.node.view.serverTime,id:row.id,kind:row.kind}],
            trace:merge(parent.trace,immediate.trajectory.map(compact))};
          branch.evaluation=evaluate(branch,p);budget.terminalEvaluations++;all.push(branch);
          if(branch.node.view.serverTime<n.book.windowEnd&&!immediate.blocked.length){
            const step=continuation.advance(branch.state,Math.min(n.book.windowEnd,branch.node.view.serverTime+tick),{collectTrajectory:true});
            if(!step.blocked.length&&step.state.node.view.serverTime<n.book.windowEnd)
              next.push({...branch,state:step.state,node:step.state.node,trace:merge(branch.trace,step.trajectory.map(compact))});
          }
        }
      }
      // Keep a representative of every first-action class before filling the remaining beam.
      // Unknown and short-prefix branches are retained as search candidates, never scored as zero.
      const kept=[];
      for(const kind of kinds){const group=next.filter(x=>x.firstKind===kind);if(!group.length)continue;
        kept.push(choose(group,p)??frontier(group,p).sort((a,b)=>a.id.localeCompare(b.id,'en'))[0]);}
      for(const row of frontier(next,p).sort((a,b)=>a.id.localeCompare(b.id,'en')))
        if(kept.length<p.beamWidth&&!kept.includes(row))kept.push(row);
      budget.beamPruned+=Math.max(0,next.length-Math.min(kept.length,p.beamWidth));
      queue=kept.slice(0,p.beamWidth);depth++;
    }
    budget.unexpanded+=queue.length;
    const baseline=all.find(x=>x.id==='root/wait'),winner=choose(all,p);
    let selected=winner?{routeId:winner.id,firstCandidate:winner.choices[0],
      firstAction:null,comparisonToWait:baseline?compare(winner.evaluation,baseline.evaluation,p):null,
      report:winner.evaluation.report,choices:winner.choices}:null;
    let outcome=selected?(selected.firstCandidate.kind==='wait'?'wait':'complete-route-selected'):'no-comparable-winner';
    if(!selected&&baseline?.evaluation.comparable){selected={routeId:baseline.id,firstCandidate:baseline.choices[0],firstAction:null,
      report:baseline.evaluation.report,choices:baseline.choices};outcome='retain-feasible-wait';}
    if(!selected&&rootReport){
      selected=independentAssignment(n,rootReport,p);if(selected)outcome='independent-local-improvement';
    }
    // Earlier confirmations and a future move after a wait are not the current first action.
    if(selected){const first=Object.values(rootReport.groups).flat().find(r=>r.id===selected.firstCandidate.id);
      selected.firstAction=first?.action?{at:n.view.serverTime,action:copy(first.action)}:null;}
    const body={kind:'bounded-development-selection',basis,options:p,from:n.view.serverTime,windowStart:n.book.startedAt,windowEnd:n.book.windowEnd,
      outcome,selected,budget,depth,coverage,rejected,comparisons:kinds.map(kind=>{
        const group=all.filter(x=>x.firstKind===kind),best=choose(group,p);
        return {kind,completeRoutes:group.filter(x=>x.evaluation.comparable).length,
          routes:group.map(x=>({id:x.id,status:x.evaluation.status,choices:x.choices,report:x.evaluation.report,trajectoryMinimum:x.evaluation.trajectoryMinimum,
            selectedOverThisRoute:winner?compare(winner.evaluation,x.evaluation,p):null})),
          representative:best?.id??null,rejections:rejected.filter(x=>x.firstKind===kind)};
      }),nextCheckAt:rootReport?.groups.wait[0]?.nextAt??null,
      qualifiedForNativeExecution:false,limitations:['Bounded conditional search; not a global optimum or real seven-day efficiency proof.',
        'Surplus is excluded only with explicit purpose evidence and safe supply throughout both compared trajectories.',
        'Unknown, unfinished and truncated routes remain visible; a selected route is best only among comparable evaluated routes.',
        'Original snapshot, requests and receipts must be checked by the native executor; simulated confirmations are not native receipts.']};
    return {body,integrity:hash(body)};
  }
  function prepareSelected(n,result){
    if(result?.integrity!==hash(result.body)||result.body.kind!=='bounded-development-selection')throw Error('Selection integrity changed');
    if(hash(n)!==result.body.basis)throw Error('Selection snapshot changed; replan before execution');
    const chosen=result.body.selected;if(!chosen)return {node:n,accepted:false,blocked:[{kind:'no-selected-development-action'}]};
    const p=result.body.options,report=localReport?.result===result&&localReport.integrity===result.integrity?localReport.report:
      candidates.enumerate(n,{goal:p.goal,familyOutcomes:p.familyOutcomes,
        constructionEvidence:p.constructionEvidence,maxChecks:Math.min(p.checksPerNode,p.maxChecks)});
    return candidates.prepareFirst(n,report,chosen.firstCandidate.id);
  }
  return {select,selectLocal,prepareSelected,continueSelection:(state,o)=>select(state.node,o,state)};
}
