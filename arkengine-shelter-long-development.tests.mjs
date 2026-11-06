import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {upperStageView,workshopChurnView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const sourceSHA256=createHash('sha256').update(source).digest('hex');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function recordShelterCampaign(','  function shelterFormValue('),
  segment('  function reconcileShelterDefense(','  function closeShelterRecall('),
  segment('  function shelterConstructionChoice(','  function shelterBuildTitle(')].join('\n');
// Independent public cost/production equations. Digging duration below is explicitly hypothetical.
const baseCost={power:100,diner:100,water:100,scrap:80,quarters:120,storage:80,medbay:300,workshop:500,training:400,radio:800};
const productionRules={power:['str','power',12,30],diner:['agi','food',8,25],water:['per','water',8,25],
  scrap:['end','scrap',8,30],medbay:['int','stimpak',.5,2],workshop:['int','parts',.6,3]},mult=[0,1,1.5,2.1];
const stepMs=600000;

function simulate(assumedDigMinutes,mixed=false,growth=false,inheritanceOffset=0,finishLevel=0){
  const v=(growth?workshopChurnView:upperStageView)(Date.parse('2026-11-06T00:00:00Z')),s=v.state,start=v.serverTime;
  const developmentTarget=finishLevel||10;
  if(!growth)s.resources.stimpak=60;
  if(growth)s.residents.find(p=>p.id===35).parents=[13,14];
  if(mixed&&!growth){
    // Independent scenario input: seventeen adults and one pregnancy already in progress, not new automatic population authority.
    for(const id of [16,17])s.residents.push({...structuredClone(s.residents[0]),id,name:`居民${id}`,roomId:null});
    s.births=[{id:1,roomId:5,parents:[13,14],dueAt:start+3*3600000}];
    v.progress.score+=4;
  }
  if(mixed)s.rooms.push({...s.rooms[0],id:900,type:'door',floor:1,col:0,width:1,level:1});
  const initial=structuredClone(s.resources),people=JSON.stringify(s.residents.map(p=>({...p,roomId:null})));
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:growth?'population':'production',shelterStaffHold:'',shelterOptimize:growth,shelterGear:false,shelterPopulationTarget:growth?30:14,shelterLevelTarget:developmentTarget,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0},
    shelterState:{campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},shelterPending:null,shelterRead:null,
    shelterCaravanNote:'',shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',
    Date:class extends Date{constructor(...args){super(...(args.length?args:[v.serverTime]));}static now(){return v.serverTime;}},
    crypto:{randomUUID:()=>String(v.serverTime)},log:{add:()=>{}},workshopAutomatic:()=>true,shelterRaidTiming:()=>{}};
  context.saveShelter=x=>context.shelterState=x;
  context.holdShelterStaff=message=>{context.shelterStaffHold=message;context.shelterState.swap=null;};
  if(growth){context.shelterState.families=[{a:13,b:14,room:5}];context.shelterState.campaign.roles=[{id:21,room:50,role:'workshop',at:start}];}
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults,defense:${mixed},medical:${mixed},dailyGoals:${mixed}};
    ({model:shelterModel,staff:shelterStaffPlan,campaign:shelterCampaignSchedule,record:recordShelterCampaign,
      construction:shelterConstructionChoice,development:shelterDevelopmentPlan,valid:validCampaignRecord,
      daily:shelterDailyGoals,reconcile:reconcileShelterDefense})`,context);
  const initialScore=v.progress.score,levels=[{level:v.progress.level,score:initialScore,at:start}],
    collected=Object.fromEntries(Object.keys(initial).map(k=>[k,0])),used={power:0,food:0,water:0,scrap:0,parts:0,stimpak:0},
    projects=[],pendingBuilds=new Set(),digs=[];
  const rewards={scrap:0,parts:0},claims=[],raids=[],heals=[],born=[],restarts=[],seenRaidLevels=new Set();
  const pregnancies=[],assignments=[],merges=[],firstProduction=[],productiveResidents=new Set();
  let nextResident=Math.max(...s.residents.map(p=>p.id))+1,nextBirth=1,targetAt=null,adultTargetAt=null;
  const ancestors=id=>{const p=s.residents.find(p=>p.id===id);return new Set([id,...(p?.parents||[]).flatMap(id=>[...ancestors(id)])]);};
  const related=(a,b)=>[...ancestors(a.id)].some(id=>ancestors(b.id).has(id));
  const startRomances=()=>{
    for(const room of s.rooms.filter(r=>r.type==='quarters'&&r.builtAt<=v.serverTime&&r.upgradeAt===null&&!r.incident&&!r.unpowered)){
      const ready=s.residents.filter(p=>p.roomId===room.id&&p.deadAt===null&&p.away===null&&p.adultAt<=v.serverTime&&
        p.happiness>=50&&!p.romance&&!(p.familyCooldownUntil>v.serverTime));
      for(let i=0;i<ready.length;i++)for(let j=i+1;j<ready.length;j++){
        const a=ready[i],b=ready[j];if(a.romance||b.romance||related(a,b))continue;
        a.romance={partnerId:b.id,progress:0};b.romance={partnerId:a.id,progress:0};
      }
    }
  };
  const maxHp=p=>Math.round(100+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*(2+.5*p.stats.end));
  let raid=null;
  let nextId=1000,completedBuilds=0,completedUpgrades=0,completedDigs=0,feedSpent=0,partsMade=0,scoreGain=0;
  for(let tick=0;tick<2000*6&&(growth?targetAt===null||v.serverTime<targetAt+12*3600000||v.progress.level<finishLevel:v.progress.level<10);tick++){
    if(growth){
      context.shelterStaffHold='';
      for(const b of [...s.births])if(b.dueAt<=v.serverTime){
        const parents=b.parents.map(id=>s.residents.find(p=>p.id===id));
        const child={...structuredClone(parents[0]),id:nextResident++,name:'子女'+nextResident,roomId:b.roomId,xp:0,hp:100,
          adultAt:v.serverTime+3*3600000,parents:[...b.parents],romance:null,familyCooldownUntil:0,
          weaponId:null,outfitId:null,stats:Object.fromEntries(Object.keys(parents[0].stats).map(k=>[k,Math.max(0,Math.floor((parents[0].stats[k]+parents[1].stats[k])/2)+inheritanceOffset)]))};
        s.residents.push(child);s.births=s.births.filter(x=>x!==b);scoreGain+=2;v.progress.score+=2;
        born.push({id:child.id,parents:child.parents,at:v.serverTime,adultAt:child.adultAt});
        process.stdout.write(JSON.stringify({kind:'population-checkpoint',population:s.residents.length,pending:s.births.length,
          hours:(v.serverTime-start)/3600000,level:v.progress.level,projects:projects.length})+'\n');
      }
      startRomances();
    }
    if(mixed){
      const day=new Date(v.serverTime+8*3600000).toISOString().slice(0,10);
      if(s.daily.day!==day){
        const level=v.progress.level;s.daily={day,claimed:[],counters:{},picks:[['build',2],['collect_scrap',150*level],['collect_food',60*level]]
          .map(([key,target])=>({key,target,reward:{scrap:80+40*level,parts:Math.ceil(level/3),points:30}}))};
      }
      for(const b of growth?[]:[...s.births])if(b.dueAt<=v.serverTime){
        const child={...structuredClone(s.residents[0]),id:18,name:'居民18',roomId:null,xp:0,hp:100,
          adultAt:v.serverTime+3*3600000,parents:[...b.parents]};
        s.residents.push(child);s.births=s.births.filter(x=>x!==b);scoreGain+=2;v.progress.score+=2;born.push({at:v.serverTime,adultAt:child.adultAt});
      }
      if(!raid&&!seenRaidLevels.has(v.progress.level)&&tick>=12&&
        !context.shelterState.campaign.defense?.length){
        const material=context.shelterState.campaign.materials;
        raid={level:v.progress.level,tick,original:s.residents.map(p=>({id:p.id,room:p.roomId})),
          material:material?structuredClone(material):null,startedProjects:projects.length,assignments:0,pursuits:0,releases:0};
        raids.push(raid);seenRaidLevels.add(v.progress.level);
        s.rooms.find(r=>r.id===900).incident={kind:'raiders',hp:80,maxHp:80};
      }
      if(raid){
        const elapsed=tick-raid.tick;
        if(elapsed===1||elapsed===5){
          const injured=s.residents.find(p=>p.roomId===(elapsed===1?900:4)&&p.adultAt<=v.serverTime);
          assert.ok(injured,'a defender must already have reached the injected incident');injured.hp=maxHp(injured)*.35;
        }
        if(elapsed===4){s.rooms.find(r=>r.id===900).incident=null;s.rooms.find(r=>r.id===4).incident={kind:'raiders',hp:30,maxHp:80};}
        // Explicit external event outcome. No simulated damage equation, guaranteed victory, or measured battle duration.
        if(elapsed===7)s.rooms.find(r=>r.id===4).incident=null;
        if(elapsed>=7&&!context.shelterState.campaign.defense?.length){
          assert.ok(raid.assignments>0&&raid.pursuits>0&&raid.releases>0,'each incident must include reinforcement, pursuit and restoration');
          raid.endedAt=v.serverTime;raid=null;
        }
      }
      api.reconcile(api.model(v));
      if(!s.rooms.some(r=>r.incident)){
        const m=api.model(v);
        for(const g of api.daily(m).goals.filter(g=>!g.claimed&&!g.remaining)){
          if(['scrap','parts'].some(k=>s.resources[k]+g.reward[k]>m.caps[k]))continue;
          assert.ok(!claims.some(x=>x.day===day&&x.index===g.index),'daily claims cannot be replayed');
          for(const k of ['scrap','parts']){s.resources[k]+=g.reward[k];rewards[k]+=g.reward[k];}
          s.season.points+=g.reward.points;s.daily.claimed.push(g.index);claims.push({day,index:g.index,key:g.key,at:v.serverTime,...g.reward});
        }
      }
    }
    const visitStates=new Set();
    for(let decision=0;decision<(mixed||growth?12:10);decision++){
      if(growth){
        const fingerprint=JSON.stringify({rooms:s.residents.map(p=>[p.id,p.roomId,p.romance]),schedule:context.shelterState});
        if(visitStates.has(fingerprint)&&process.env.ARKENGINE_POPULATION_SNAPSHOT)writeFileSync(process.env.ARKENGINE_POPULATION_SNAPSHOT,
          JSON.stringify({failure:'staff-cycle',sourceSHA256,view:v,state:context.shelterState,assignments,born,pregnancies,projects,merges,
            recent:assignments.filter(a=>a.at===v.serverTime),staff:context.shelterStaffNote,populationNote:context.shelterPopulationNote},null,2));
        assert.ok(!visitStates.has(fingerprint),'same unchanged population state cannot repeatedly alternate staffing');visitStates.add(fingerprint);
      }
      const m=api.model(v),a=api.campaign(m).choice||api.staff(m);if(!a)break;
      if(!mixed&&!growth)assert.ok(decision<9,'unchanged state must not alternate staffing indefinitely');
      assert.ok(!a.kind||a.kind==='assign'||mixed&&a.kind==='stimpak','only staffing and configured medical actions are simulated');
      const p=s.residents.find(p=>p.id===a.id);assert.ok(p.adultAt<=v.serverTime,'a child cannot work or defend before adulthood');
      if(a.kind==='stimpak'){
        assert.ok(s.resources.stimpak>2);assert.ok(!heals.some(h=>h.id===p.id&&v.serverTime-h.at<1800000));
        s.resources.stimpak--;used.stimpak++;p.hp=Math.min(maxHp(p),p.hp+.4*maxHp(p));heals.push({id:p.id,at:v.serverTime});
      }else {
        if(growth){
          const room=s.rooms.find(r=>r.id===a.room);
          // Public t_ permits raid reinforcement before its ordinary availability/capacity checks.
          // Keep ordinary production/return assignments subject to completed, available rooms.
          const emergency=room?.incident?.kind==='raiders'&&a.role==='defense';
          if(room&&(room.builtAt>v.serverTime||room.upgradeAt!==null&&!emergency)&&process.env.ARKENGINE_POPULATION_SNAPSHOT)
            writeFileSync(process.env.ARKENGINE_POPULATION_SNAPSHOT,JSON.stringify({failure:'assign-unavailable-room',sourceSHA256,
              view:v,state:context.shelterState,action:a,room,assignments,born,pregnancies,projects,merges,raids,heals},null,2));
          assert.ok(!room||room.builtAt<=v.serverTime&&(room.upgradeAt===null||emergency),JSON.stringify({action:a,room}));
          // The public incident rules allow reinforcement beyond normal staffing capacity.
          assert.ok(!room||emergency||
            s.residents.filter(other=>other.id!==p.id&&other.deadAt===null&&other.adultAt<=v.serverTime&&other.roomId===room.id).length<room.width*2);
          assignments.push({id:p.id,from:p.roomId,room:a.room,at:v.serverTime,reason:a.reason});
        }
        p.roomId=a.room;if(growth)startRomances();
      }
      if(raid&&a.role?.startsWith('defense')){
        assert.equal(a.original,raid.original.find(r=>r.id===p.id).room,'pursuit must preserve the pre-raid job');
        raid[a.role==='defense-release'?'releases':a.room===900?'assignments':'pursuits']++;
      }
      if(a.role)api.record({kind:a.kind||'assign',targets:a.targets||[a.id,a.room],before:{campaign:{choice:a}},
        result:{campaignProof:{at:v.serverTime}}},api.model(v));
    }
    if(tick%36===0||mixed&&raid&&tick-raid.tick===5){
      context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
      assert.ok(api.valid(context.shelterState.campaign),'material ownership must survive serialization');
      if(mixed||growth)restarts.push({at:v.serverTime,defenders:context.shelterState.campaign.defense?.length||0,
        ...(growth?{pair:context.shelterState.pair?.step??null,swap:context.shelterState.swap?.step??null}: {})});
    }
    if(raid?.material&&s.rooms.some(r=>r.incident))
      assert.deepEqual(context.shelterState.campaign.materials,raid.material,'reinforcement and medical records must not replace the original material project');
    const c=api.construction(api.model(v));
    if(c){
      assert.ok(!s.rooms.some(r=>r.incident),'construction must wait until an incident has ended');
      const room=s.rooms.find(r=>r.id===c.id);
      const cost=c.kind==='dig'?Math.ceil(120*(s.depth+1)**1.4):c.kind==='upgrade'?
        Math.ceil(baseCost[c.type]*room.width*(room.level===1?2.5:6)):
        Math.ceil(baseCost[c.type]*(1+.2*s.rooms.filter(r=>r.type===c.type).reduce((n,r)=>n+r.width,0)));
      const parts=c.kind==='upgrade'&&room.level===2?15*room.width:0;
      assert.equal(c.cost.scrap,cost,'construction cost must agree with independently supplied public equations');
      assert.equal(c.cost.parts,parts);
      assert.ok(s.resources.scrap>=cost&&s.resources.parts>=parts);
      const recent=(context.shelterState.constructionLedger||[]).filter(e=>e.at>v.serverTime-86400000);
      assert.ok(recent.reduce((n,e)=>n+e.scrap,0)+cost<=10000,'rolling construction budget must remain binding');
      assert.ok(recent.reduce((n,e)=>n+e.parts,0)+parts<=100);
      s.resources.scrap-=cost;s.resources.parts-=parts;used.scrap+=cost;used.parts+=parts;
      (context.shelterState.constructionLedger??=[]).push({id:String(v.serverTime),at:v.serverTime,...c.cost});
      projects.push({kind:c.kind,type:c.type,floor:c.floor,at:v.serverTime,scrap:cost,parts});
      if(c.kind==='dig'){
        assert.equal(s.digging,null);assert.equal(c.floor,s.depth+1);
        s.digging={floor:c.floor,doneAt:v.serverTime+assumedDigMinutes*60000};
        digs.push({floor:c.floor,at:v.serverTime,doneAt:s.digging.doneAt});
      }else if(c.kind==='upgrade'){
        assert.equal(room.upgradeAt,null);assert.ok(room.level<3);assert.ok(room.builtAt<=v.serverTime);
        room.upgradeAt=v.serverTime+room.width*(room.level===1?1:3)*3600000;
        const material=context.shelterState.campaign.materials;
        if(material&&c.id===material.id&&c.type===material.type&&c.level===material.level)
          delete context.shelterState.campaign.materials;
      }else{
        assert.equal(c.kind,'build');assert.ok(c.floor<=s.depth,'uncompleted digging cannot supply a floor');
        assert.ok(!s.rooms.some(r=>r.floor===c.floor&&r.col<=c.col&&r.col+r.width>c.col));
        const id=nextId++;pendingBuilds.add(id);
        s.rooms.push({id,type:c.type,floor:c.floor,col:c.col,width:1,level:1,builtAt:v.serverTime+stepMs,
          upgradeAt:null,stored:0,incident:null,unpowered:false,trainStat:c.trainStat});
      }
    }
    const m=api.model(v);
    if(growth)for(const a of s.residents.filter(p=>p.romance&&p.id<p.romance.partnerId)){
      const b=s.residents.find(p=>p.id===a.romance.partnerId),room=s.rooms.find(r=>r.id===a.roomId);
      if(!b||a.roomId!==b.roomId||room?.type!=='quarters'||room.builtAt>v.serverTime||room.upgradeAt!==null||room.incident||room.unpowered||
        [a,b].some(p=>p.away!==null||p.deadAt!==null||p.adultAt>v.serverTime||p.happiness<50||p.familyCooldownUntil>v.serverTime))continue;
      const progress=Math.min(1,a.romance.progress+(a.stats.cha+b.stats.cha)/120);
      a.romance.progress=progress;b.romance.progress=progress;
      if(progress>=1&&s.residents.length+s.births.length<m.populationCap){
        const birth={id:nextBirth++,roomId:room.id,parents:[a.id,b.id],dueAt:v.serverTime+stepMs+3*3600000};
        s.births.push(birth);pregnancies.push({at:v.serverTime+stepMs,...birth});
        for(const p of [a,b]){p.romance=null;p.familyCooldownUntil=v.serverTime+stepMs+6*3600000;}
      }
    }
    for(const [k,n] of Object.entries(m.demand)){s.resources[k]-=n/6;used[k]+=n/6;}
    for(const r of s.rooms){
      const rule=productionRules[r.type];if(!rule||r.builtAt>v.serverTime||r.upgradeAt!==null||r.incident||r.unpowered)continue;
      const [stat,k,base,batchBase]=rule,batch=batchBase*r.width*mult[r.level];
      const workers=s.residents.filter(p=>p.roomId===r.id&&p.away===null&&p.deadAt===null&&p.adultAt<=v.serverTime).slice(0,r.width*2);
      let made=Math.min(4*batch-r.stored,workers.reduce((n,p)=>n+base*mult[r.level]*(.5+p.stats[stat]/10)*
        (.6+.4*p.happiness/100)*(1+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*.01),0)/6);
      if(k==='parts'){made=Math.min(made,Math.max(0,s.resources.scrap)/6);s.resources.scrap-=6*made;feedSpent+=6*made;partsMade+=made;}
      // Raid reinforcement in a production room is not employment while the incident stops output.
      // Require an independently simulated positive production tick after the child's adulthood.
      if(growth&&made>0)for(const p of workers)if(born.some(child=>child.id===p.id)&&!productiveResidents.has(p.id)){
        productiveResidents.add(p.id);firstProduction.push({id:p.id,room:r.id,type:r.type,at:v.serverTime});
      }
      r.stored+=made;const take=Math.floor((r.stored+1e-9)/batch)*batch;
      if(s.resources[k]+take<=m.caps[k]){s.resources[k]+=take;r.stored-=take;collected[k]+=take;
        assert.ok(r.stored>=-1e-8,'whole-batch rounding cannot remove unproduced resources');
        if(r.stored<0)r.stored=0;
        if(mixed&&['scrap','food'].includes(k))s.daily.counters['collect_'+k]=(s.daily.counters['collect_'+k]||0)+take;}
    }
    v.serverTime+=stepMs;s.lastSettledAt=v.serverTime;
    for(const r of s.rooms)if(r.upgradeAt!==null&&r.upgradeAt<=v.serverTime){
      r.upgradeAt=null;r.level++;completedUpgrades++;scoreGain+=r.width;if(mixed)s.daily.counters.build=(s.daily.counters.build||0)+1;
    }
    if(s.digging){
      if(s.digging.doneAt<=v.serverTime){
        s.depth=s.digging.floor;s.digging=null;completedDigs++;scoreGain+=3;
        s.rooms.push({id:nextId++,type:'elevator',floor:s.depth,col:1,width:1,level:1,builtAt:v.serverTime,
          upgradeAt:null,stored:0,incident:null,unpowered:false});
      }else assert.equal(s.depth,s.digging.floor-1,'digging cannot increase depth before the supplied deadline');
    }
    for(const id of [...pendingBuilds]){
      const r=s.rooms.find(r=>r.id===id);if(r.builtAt>v.serverTime)continue;
      pendingBuilds.delete(id);completedBuilds++;scoreGain+=r.width;if(mixed)s.daily.counters.build=(s.daily.counters.build||0)+1;
      const left=s.rooms.find(l=>l.id!==r.id&&l.floor===r.floor&&l.col+l.width===r.col&&l.type===r.type&&l.level===r.level&&
        l.width+r.width<=3&&l.builtAt<v.serverTime&&l.upgradeAt===null&&(r.type!=='training'||l.trainStat===r.trainStat));
      if(left){left.width+=r.width;left.stored+=r.stored;s.rooms.splice(s.rooms.indexOf(r),1);if(growth)merges.push({at:v.serverTime,id:r.id,into:left.id,type:r.type});}
    }
    const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>r.builtAt<=v.serverTime&&!['door','elevator'].includes(r.type))
      .reduce((n,r)=>n+r.width*r.level,0);let level=1;while(score>=30+Math.ceil(2.25*level*level))level++;
    assert.equal(score,initialScore+scoreGain,'only completed projects and the explicitly supplied birth may increase level score');
    if(level!==v.progress.level){
      assert.equal(level,v.progress.level+1);levels.push({level,score,at:v.serverTime});
      if(mixed)process.stdout.write(JSON.stringify({kind:'mixed-checkpoint',level,score,hours:(v.serverTime-start)/3600000,
        population:s.residents.length,projects:projects.length,claims:claims.length,raids:raids.filter(r=>r.endedAt).length})+'\n');
    }
    v.progress={level,score,next:30+Math.ceil(2.25*level*level)};
    if(growth){
      assert.ok(s.residents.length+s.births.length<=30,'real pregnancies and births must stay within the selected target');
      assert.ok(s.residents.length+s.births.length<=api.model(v).populationCap,'future beds do not count as completed capacity');
      if(s.residents.length===30&&!s.births.length&&s.residents.every(p=>p.adultAt<=v.serverTime)){
        adultTargetAt??=v.serverTime;
        // 人口达标后还需完成岗位建设；达到人数不结束验证，所有新成人实际就业后再验证12小时供应。
        if(born.every(child=>productiveResidents.has(child.id)&&assignments.some(a=>a.id===child.id&&a.at>=child.adultAt&&s.rooms.some(r=>r.id===a.room&&productionRules[r.type]))))
          targetAt??=v.serverTime;
      }
      if(tick%144===0){
        const observed=api.model(v),next=api.development(observed,30,api.campaign(observed),developmentTarget).next;
        process.stdout.write(JSON.stringify({kind:'population-state',hours:(v.serverTime-start)/3600000,
          population:s.residents.length,pending:s.births.length,level,projects:projects.length,assignments:assignments.length,
          production:observed.production,demand:observed.demand,next:next.title,reason:next.reason,
          staff:context.shelterStaffNote,populationNote:context.shelterPopulationNote})+'\n');
      }
    }
    for(const [k,value] of Object.entries(s.resources)){
      assert.ok(value>=-1e-6,`${k} cannot run below zero`);
      assert.ok(Math.abs(value-(initial[k]+collected[k]+(rewards[k]||0)-(used[k]||0)-(k==='scrap'?feedSpent:0)))<1e-4,`${k} must be conserved`);
    }
  }
  if(growth){
    const final=api.model(v),campaign=api.campaign(final),plan=api.development(final,30,campaign,developmentTarget);
    if(process.env.ARKENGINE_POPULATION_SNAPSHOT)writeFileSync(process.env.ARKENGINE_POPULATION_SNAPSHOT,JSON.stringify({sourceSHA256,inheritanceOffset,
      view:v,state:context.shelterState,assignments,firstProduction,born,pregnancies,projects,merges,production:final.production,demand:final.demand,next:plan.next,
      staff:context.shelterStaffNote,populationNote:context.shelterPopulationNote,
      ...(mixed?{rewards,claims,raids,heals,restarts}: {})},null,2));
    assert.equal(s.residents.length,30,JSON.stringify({hours:(v.serverTime-start)/3600000,production:final.production,demand:final.demand,
      plan:plan.next,notes:plan.notes,staff:context.shelterStaffNote,population:context.shelterPopulationNote,state:context.shelterState}));
    assert.equal(s.births.length,0);assert.equal(pregnancies.length,13);assert.equal(born.length,13);assert.ok(targetAt!==null);
    assert.ok(s.residents.every(p=>p.adultAt<=v.serverTime));assert.ok(!s.residents.some(p=>p.romance),'no additional romances beyond the target');
    assert.ok(Object.keys(final.demand).every(k=>final.production[k]>=final.demand[k]*1.2-1e-9),'thirty adults must have sustainable supply with the configured margin');
    for(const child of born)assert.ok(assignments.some(a=>a.id===child.id&&a.at>=child.adultAt&&s.rooms.some(r=>r.id===a.room&&productionRules[r.type])),`child ${child.id} must work after adulthood`);
    for(const child of born)assert.ok(firstProduction.some(p=>p.id===child.id&&p.at>=child.adultAt),`child ${child.id} must actually produce after adulthood, not merely defend a production room`);
    assert.ok(merges.length>0);assert.ok(restarts.length>1);assert.equal(context.shelterPopulationTarget,30);
    if(finishLevel){assert.ok(v.progress.level>=finishLevel,'thirty-person development must reach the requested level with actual completed projects');
      assert.deepEqual(levels.map(x=>x.level),Array.from({length:finishLevel-4},(_,i)=>i+5),'every stage must be reached through actual births or completed projects');}
    if(mixed){
      assert.equal(raids.length,finishLevel-5);assert.ok(raids.every(r=>r.endedAt));assert.equal(raid,null);
      assert.ok(heals.length>0,'injured defenders must exercise the configured medical action');
      assert.ok(restarts.filter(r=>r.defenders>0).length>=raids.length,'each active incident must survive serialization');
      assert.equal(context.shelterState.campaign.defense.length,0);
      assert.ok(claims.some(c=>c.key==='build')&&claims.some(c=>c.key==='collect_scrap')&&claims.some(c=>c.key==='collect_food'));
      assert.ok(new Set(claims.map(c=>c.day)).size>=2);
    }
    return {kind:'conditional-population-continuity',sourceSHA256,assumedDigMinutes,inheritanceOffset,finishLevel,hours:(v.serverTime-start)/3600000,
      targetAt,adultTargetAt,hoursUntilEmployment:(targetAt-adultTargetAt)/3600000,hoursAfterEmployment:(v.serverTime-targetAt)/3600000,levels,pregnancies,born,merges,firstProduction,
      completedBuilds,completedUpgrades,completedDigs,assignmentCount:assignments.length,restarts:restarts.length,
      collected,used,feedSpent,finalResources:s.resources,production:final.production,demand:final.demand,
      ...(mixed?{scenario:'population-growth-with-injected-raids-and-earned-rewards',rewards,claims,raids,heals}: {})};
  }
  assert.deepEqual(levels.map(x=>x.level),[6,7,8,9,10],'the planner must reach every stage through completed projects');
  assert.equal(s.residents.length,mixed?18:15);assert.equal(context.shelterPopulationTarget,14);
  if(!mixed)assert.equal(JSON.stringify(s.residents.map(p=>({...p,roomId:null}))),people,'no simulated birth, training, XP or happiness boost');
  else{
    assert.equal(born.length,1);assert.equal(s.births.length,0);assert.ok(v.serverTime>born[0].adultAt);
    assert.equal(raids.length,4);assert.ok(raids.every(r=>r.endedAt));assert.equal(raid,null);
    assert.ok(heals.length>=8);assert.ok(claims.some(c=>c.key==='build')&&claims.some(c=>c.key==='collect_scrap')&&claims.some(c=>c.key==='collect_food'));
    assert.ok(new Set(claims.map(c=>c.day)).size>=2,'real completed daily goals must span multiple simulated days');
    assert.ok(restarts.filter(r=>r.defenders>0).length>=4,'each active raid must survive saved-state serialization');
    assert.equal(context.shelterState.campaign.defense.length,0);
  }
  if(!mixed)assert.ok(completedDigs>=3);
  else assert.ok(digs.length>0,'the mixed scenario must exercise expansion, without prescribing the fixed-population route');
  assert.equal(completedDigs,digs.length,'every paid excavation must finish once');
  assert.equal(new Set(digs.map(d=>d.floor)).size,digs.length);
  assert.ok(digs.every(d=>d.doneAt-d.at===assumedDigMinutes*60000));
  assert.equal(s.digging,null);assert.ok(Math.abs(feedSpent-6*partsMade)<1e-6);
  const finalPlan=api.development(api.model(v),14,api.campaign(api.model(v)),10);
  assert.equal(finalPlan.levelProgress.finalTarget,10);
  return {kind:'hypothetical-continuity-simulation',sourceSHA256,assumedDigMinutes,
    hours:(v.serverTime-start)/3600000,levels,completedBuilds,completedUpgrades,completedDigs,
    collected,used,feedSpent,finalResources:s.resources,score:v.progress.score,
    ...(mixed?{scenario:'injected-raids-birth-and-earned-daily-rewards',rewards,claims,born,heals,raids,restarts}: {})};
}

test('连续人口发展：等价5级17人向30增长，出生成年复岗、建设合并与六资源守恒',t=>{
  t.diagnostic(JSON.stringify(simulate(360,false,true)));
});
test('连续人口低遗传：新生儿属性取均值减1，17→30后仍有持续供应和成年复岗',t=>{
  t.diagnostic(JSON.stringify(simulate(360,false,true,-1)));
});
test('连续人口追级：5级17人分批发展到30人，成年就业后继续建设到10级',t=>{
  t.diagnostic(JSON.stringify(simulate(360,false,true,0,10)));
});

test('连续人口十三：同一起点和30人阶段上限，持续建设逐级到13级',t=>{
  t.diagnostic(JSON.stringify(simulate(360,false,true,0,13)));
});

test('连续人口防守：5级17人分批到30人，五次来袭医疗复岗及实际奖励后持续到10级',t=>{
  t.diagnostic(JSON.stringify(simulate(360,true,true,0,10)));
});

test('连续发展混合：17人口已有待产、按实际目标领取跨日奖励，四次注入来袭和医疗复岗后持续6→10',t=>{
  t.diagnostic(JSON.stringify(simulate(360,true)));
});

for(const assumedDigMinutes of [30,360,1440]){
  test(`连续发展工期敏感性：假设下挖${assumedDigMinutes}分钟，固定人口自产资源逐级6→10，不作为真实工期`,t=>{
    // This is a conditional continuity test, not a measured duration, strategy efficiency or real-account result.
    t.diagnostic(JSON.stringify(simulate(assumedDigMinutes)));
  });
}
