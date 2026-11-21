import { farmMarkup } from './arkengine-farm.fixture.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';

// Delay only GET reconciliation after a claim; its POST still returns the actual
// success snapshot. Tests release the read after installing the intended state.
export const holdShelterClaimReads=`sm.holdClaimReads=true;const priorClaimFetch=window.fetch,claimReadWaiters=[];
  window.fetch=(url,options)=>url==='/api/shelter'&&sm.holdClaimReads&&sm.calls.some(c=>c.type==='explore_claim')?
    new Promise((resolve,reject)=>claimReadWaiters.push(()=>Promise.resolve(priorClaimFetch(url,options)).then(resolve,reject))):priorClaimFetch(url,options);
  sm.releaseClaimReads=()=>{sm.holdClaimReads=false;claimReadWaiters.splice(0).forEach(release=>release());};`;

// 2026-11-03 公开前端的原生按钮/页签结构；只在本机模拟，不使用真实账户。
export const shelterMarkup = farmMarkup + `<script>
window.sm = { tab:'避难所', tabs:[], reads:0, calls:[], receipts:{}, snapshots:[], busy:false, mode:'success', tutorial:true, filter:'all',
  view:{ vaultNo:77, serverTime:clock, progress:{level:2}, switches:{frozen:false}, nameRequired:false,
    env:{events:[]}, state:{lastSettledAt:clock, resources:{power:100,food:100,water:100,scrap:269,parts:0,stimpak:0},
      stats:{collected:0}, legacy:{perks:{}}, items:[], births:[], achievements:[], explorers:[], quests:[],
      tutorial:{claimed:[]}, daily:{day:'2026-10-10',claimed:[]}, season:{month:'2026-10',points:0,claimedFree:[]},
      rooms:[{id:1,type:'scrap',width:1,level:1,stored:30,builtAt:0,upgradeAt:null,incident:null,unpowered:false}],
      residents:[{id:1,name:'居民甲',parents:[],hp:100,roomId:1,away:null,deadAt:null,adultAt:0,xp:0,happiness:100,outfitId:null,weaponId:null,
        stats:{str:3,per:3,end:5,cha:3,int:3,agi:3,lck:3},romance:null,familyCooldownUntil:0}] } } };
const farmFetch=window.fetch;
const shelterResources=(${createShelterResourceSimulation.toString()})();
window.settleShelterResources=()=>{
 if(!sm.simulateResources)return;
 const result=shelterResources.advance(sm.view,sm.snapshotAt??clock);
 sm.view=result.view;
 if(result.ledger.ticks){sm.resourceLedger??=[];sm.resourceLedger.push(result.ledger);}
};
window.shelterData=()=>{settleShelterResources();return {...structuredClone(sm.view),serverTime:sm.snapshotAt??clock};};
window.fetch=async (url,options)=>{
 if(url instanceof Request){const request=url;options={method:request.method,...options,body:options?.body??await request.text()};url=new URL(request.url).pathname;}
 else if(url instanceof URL)url=url.pathname;
 if(String(url).startsWith('/api/shelter/social/leaderboard'))return new Response(JSON.stringify({rows:sm.neighbors||[],me:{userId:777,vaultNo:sm.view.vaultNo}}));
 if(String(url).startsWith('/api/shelter/social/visit')){
   const id=Number(new URL(url,'http://fixture').searchParams.get('userId')),v=(sm.neighbors||[]).find(n=>n.userId===id);
   return new Response(JSON.stringify(v||{}));
 }
 if(url==='/api/shelter/social/help'&&options?.method==='POST'){
   const body=JSON.parse(options.body);sm.calls.push({type:'help',target:body.targetId,idempotencyKey:body.idempotencyKey});
   const receiptKey='help:'+body.idempotencyKey;if(sm.receipts[receiptKey])return new Response(JSON.stringify(sm.receipts[receiptKey]));
   if(sm.helpUnknown)return new Promise(()=>{});
   const v=sm.neighbors.find(n=>n.userId===body.targetId);v.helpedToday=true;
   const reason=v.reason||null,rewarded=!reason;
   if(rewarded)sm.view.state.resources.scrap+=v.helpScrap;
   sm.receipts[receiptKey]={rewarded,scrap:rewarded?v.helpScrap:0,targetScrap:25,reason,text:'检修了电站'};
   return new Response(JSON.stringify(sm.receipts[receiptKey]));
 }
  if(url==='/api/shelter/caravan'){
   if(options?.method!=='POST')return new Response(JSON.stringify(sm.caravan));
   const body=JSON.parse(options.body);sm.calls.push({type:'caravan',...body});
   const receiptKey='caravan:'+body.idempotencyKey;if(sm.receipts[receiptKey])return new Response(JSON.stringify(sm.receipts[receiptKey]));
   if(sm.caravanUnknown)return new Response('{}',{status:503});
   const offer=sm.caravan.offers.find(o=>o.slot===body.slot);
   if(!offer||offer.delivered)throw Error('重复交付');
   offer.delivered=true;sm.view.state.resources.scrap-=offer.scrap;sm.view.state.resources.parts-=offer.parts;
   sm.view.state.daily.counters.caravan++;sm.receipts[receiptKey]={tokens:offer.reward,...(sm.caravanFallback?{fallback:sm.caravanFallback}:{})};
   return new Response(JSON.stringify(sm.receipts[receiptKey]));
  }
  if(url==='/api/shelter'){
   sm.reads++; if(sm.deferRead)return new Promise(resolve=>{sm.resolveRead=()=>resolve(new Response(JSON.stringify(shelterData())));});
   if(sm.readError)throw new TypeError('fixture network');
   if(sm.malformedRead)return new Response('{"state":',{status:200});
   return new Response(JSON.stringify(shelterData()),{status:sm.httpStatus||200});
 }
 if(url==='/api/shelter/action'&&options?.method==='POST'){
   const envelope=JSON.parse(options.body),a={...envelope.action,idempotencyKey:envelope.idempotencyKey};sm.calls.push(a);
   if(a.type==='assign')(sm.assignmentOrigins??=[]).push({...a,from:sm.view.state.residents.find(p=>p.id===a.residentId)?.roomId});
   if(sm.receipts[envelope.idempotencyKey])return new Response(JSON.stringify(sm.receipts[envelope.idempotencyKey]));
   if(sm.mode==='unknown'||sm.assignUnknown&&a.type==='assign'||sm.equipUnknown&&a.type==='equip'||sm.inspectionUnknown&&a.type==='safety_inspection')return new Promise(()=>{});
   if(sm.mode==='error'||sm.mode==='partial'&&a.type==='claim_season'&&a.tier>1)return new Response('{}',{status:503});
   settleShelterResources();const s=sm.view.state;
   if(a.type==='collect_all'||a.type==='collect'){
     if(sm.simulateResources){
       const result=shelterResources.collect(sm.view,a.type==='collect_all'?null:a.roomId);
       Object.assign(s,result.view.state);sm.resourceLedger??=[];sm.resourceLedger.push(result.ledger);
     }else{
     const types={scrap:['scrap',30],power:['power',30],diner:['food',25],water:['water',25],medbay:['stimpak',2],workshop:['parts',3]};
     for(const room of s.rooms.filter(r=>a.type==='collect_all'||r.id===a.roomId)){
       const def=types[room.type];if(!def)continue;
       const batch=def[1]*room.width*[0,1,1.5,2.1][room.level],amount=Math.floor(room.stored/batch+1e-9)*batch;
       room.stored-=amount;s.resources[def[0]]+=amount;s.stats.collected+=amount;
     }
     }
   } else if(a.type==='explore_claim'){
     const e=s.explorers.find(e=>e.id===a.explorerId),p=e&&s.residents.find(p=>p.id===e.residentId);
     if(!e||!p||p.deadAt!==null||e.returnAt===null||e.returnAt>clock)throw Error('错误领取归来探险');
     for(const key of ['scrap','parts','stimpak'])s.resources[key]+=e.loot[key];
     if(sm.returnCarried!==false)s.resources.stimpak+=e.stimpaks;
     s.items.push(...e.loot.items);p.away=null;p.roomId=null;s.explorers=s.explorers.filter(r=>r.id!==e.id);
   } else if(a.type==='explore_start'){
     const p=s.residents.find(p=>p.id===a.residentId);
     if(!p||p.away||a.abyss!==false||s.resources.stimpak<a.stimpaks||s.explorers.length>=(sm.exploreSlots??Math.min(6,1+Math.floor(s.depth/8))))throw Error('错误普通出发');
     s.resources.stimpak-=a.stimpaks;p.away={kind:'explore'};p.roomId=null;
     s.explorers.push({id:Math.max(10,...s.explorers.map(e=>e.id))+1,residentId:p.id,tier:a.tier,abyss:false,startedAt:clock,
       recalledAt:null,returnAt:null,stimpaks:a.stimpaks,loot:{scrap:0,parts:0,stimpak:0,items:[]}});
   } else if(a.type==='explore_recall'){
     const e=s.explorers.find(e=>e.id===a.explorerId);if(!e||e.recalledAt!==null)throw Error('错误召回');
     e.recalledAt=clock;e.returnAt=clock+Math.floor((clock-e.startedAt)/2);
   } else if(a.type==='quest_start'){
     const q=sm.view.env.quests.find(q=>q.id===a.questId),team=a.team.map(id=>s.residents.find(p=>p.id===id));
     if(!q||team.length<1||team.length>3||team.some(p=>!p||p.away)||s.quests.some(r=>r.questId===q.id))throw Error('错误周任务');
     for(const p of team){p.away={kind:'quest'};p.roomId=null;}
     s.quests.push({id:Math.max(20,...s.quests.map(r=>r.id))+1,questId:q.id,team:a.team,status:'active',stage:0,nextStageAt:clock+q.stageMinutes*60000,returnAt:null,snapshot:structuredClone(q)});
   } else if(a.type==='quest_claim'){
     const q=s.quests.find(q=>q.id===a.runId);if(!q||q.returnAt===null||q.returnAt>clock)throw Error('小队未归来');
     if(q.status!=='failed'){s.resources.scrap+=q.snapshot.rewards.scrap;s.resources.parts+=q.snapshot.rewards.parts;s.weekly.completed.push(q.questId);}
     for(const id of q.team){const p=s.residents.find(p=>p.id===id);p.away=null;p.roomId=null;}
     s.quests=s.quests.filter(r=>r.id!==q.id);
   } else if(a.type==='revive'){
     // Native UI contract: level quote, 24h deadline, revive/residentId.
     // HP and return duration here are test observations, not backend claims.
     const p=s.residents.find(p=>p.id===a.residentId),price=100+40*Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)));
     if(p.deadAt===null||clock>=p.deadAt+86400000||s.resources.scrap<price)throw Error('错误废料救回');
     s.resources.scrap-=price;p.deadAt=null;p.hp=40;
     const e=s.explorers.find(e=>e.residentId===p.id);if(e){e.recalledAt=clock;e.returnAt=clock+3600000;}
   } else if(a.type==='stimpak'){
     const p=s.residents.find(p=>p.id===a.residentId),max=Math.round(100+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*(2+.5*p.stats.end));
     if(p.away||p.hp>=max||s.resources.stimpak<1)throw Error('错误用针');p.hp=Math.min(max,p.hp+max*.4);s.resources.stimpak--;
   } else if(a.type==='assign'){
     const p=s.residents.find(p=>p.id===a.residentId),r=s.rooms.find(r=>r.id===a.roomId);
     if(!p||a.roomId!==null&&!r||p.away||p.deadAt!==null||p.adultAt>clock)throw Error('错误调岗');
     if(r&&!r.incident&&s.residents.filter(p=>p.deadAt===null&&p.adultAt<=clock&&p.roomId===r.id).length>=r.width*2)throw Error('房间满员');
     p.roomId=a.roomId;
     sm.snapshots.push(s.residents.map(p=>({id:p.id,room:p.roomId})));
     // 仅模拟网站明确确认感情的回执，不模拟或假定遗传公式。
     if(sm.confirmFamily&&r?.type==='quarters'){
       const adults=s.residents.filter(p=>p.roomId===r.id&&p.deadAt===null&&p.away===null&&p.adultAt<=clock);
       if(adults.length===2&&adults.every(p=>!p.romance&&p.happiness>=50&&!(p.familyCooldownUntil>clock)))
         adults.forEach((p,i)=>{p.romance={partnerId:adults[1-i].id,progress:.01};});
     }
   } else if(a.type==='equip'){
     const p=s.residents.find(p=>p.id===a.residentId),item=s.items.find(item=>item.id===a.itemId);
     if(!p||p.away||!item||item.slot!==a.slot||!['outfit','weapon'].includes(a.slot))throw Error('错误穿戴');
     for(const other of s.residents)if(other[a.slot+'Id']===item.id)other[a.slot+'Id']=null;
     p[a.slot+'Id']=item.id;
   } else if(a.type==='build'){
     const base={power:100,diner:100,water:100,scrap:80,quarters:120,storage:80,medbay:300,workshop:500,training:400,radio:800}[a.room];
     if(!base||(a.room==='training'?!['str','per','end','cha','int','agi','lck'].includes(a.trainStat):a.trainStat!==null)||s.rooms.some(r=>r.floor===a.floor&&r.col<=a.col&&r.col+r.width>a.col))throw Error('错误建造');
     const cost=Math.ceil(base*(1+.2*s.rooms.filter(r=>r.type===a.room).reduce((n,r)=>n+r.width,0)));
     if(s.resources.scrap<cost)throw Error('建造资金不足');s.resources.scrap-=cost;
     s.rooms.push({id:Math.max(...s.rooms.map(r=>r.id))+1,type:a.room,trainStat:a.trainStat,floor:a.floor,col:a.col,width:1,level:1,stored:0,builtAt:clock+600000,upgradeAt:null,incident:null,unpowered:false});
   } else if(a.type==='upgrade'){
     const r=s.rooms.find(r=>r.id===a.roomId),base={power:100,diner:100,water:100,scrap:80,quarters:120,storage:80,medbay:300,workshop:500,training:400}[r?.type];
     if(!r||!base||r.level>=3||r.upgradeAt!==null)throw Error('错误升级');
     const scrap=Math.ceil(base*r.width*(r.level===1?2.5:6)),parts=r.level===1?0:15*r.width;
     if(s.resources.scrap<scrap||s.resources.parts<parts)throw Error('升级资金不足');
     s.resources.scrap-=scrap;s.resources.parts-=parts;r.upgradeAt=clock+r.width*(r.level===1?1:3)*3600000;
   } else if(a.type==='craft'){
     const r=s.rooms.find(r=>r.id===a.roomId);
     if(!r||!['armory','tailor'].includes(r.type)||r.craft||a.tier!==0||s.resources.scrap<80)throw Error('错误制作');
     s.resources.scrap-=80;r.craft={tier:0,doneAt:clock+3600000};
   } else if(a.type==='dig'){
     const cost=Math.ceil(120*(s.depth+1)**1.4);if(s.digging||s.resources.scrap<cost)throw Error('错误下挖');
     s.resources.scrap-=cost;s.digging={floor:s.depth+1,doneAt:clock+3600000};
   } else if(a.type==='claim_tutorial'){s.tutorial??={claimed:[]};s.tutorial.claimed.push(a.step);s.resources.scrap+=50;}
   else if(a.type==='rescue_incident'){
     const room=s.rooms.find(room=>room.id===a.roomId);if(!room?.incident)throw Error('目标房间没有事件');
     if(!sm.rescueNoProgress)for(const person of s.residents.filter(person=>person.deadAt===null&&person.away===null&&person.adultAt<=clock&&person.hp>0&&person.roomId!==room.id).slice(0,3)){
       (sm.rescueOrigins??={})[person.id]=person.roomId;person.roomId=room.id;
     }
     if(sm.endRescue){room.incident=null;for(const person of s.residents)if(Object.hasOwn(sm.rescueOrigins,person.id))person.roomId=sm.rescueOrigins[person.id];sm.rescueOrigins={};}
   }
   else if(a.type==='safety_inspection'){
     const d=s.daily,goal=d.picks?.find(p=>p.key==='incident'),count=d.counters?.incident??0;
     if(!goal||count>=goal.target||clock<(d.counters.safety_inspection_at??0)+600000||s.rooms.some(r=>r.incident)||
       !s.residents.some(p=>p.away===null&&p.deadAt===null&&p.adultAt<=clock&&p.hp>=.5*Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end))))throw Error('错误安全巡检');
     d.counters.incident=count+1;d.counters.safety_inspection_at=clock;
   }
   else if(a.type==='claim_objective'){
     const goal=sm.dailyGoalRows?s.daily.picks[a.index]:null;
     if(goal&&(s.daily.counters[goal.key]??0)<goal.target)throw Error('目标未完成');
     s.daily.claimed.push(a.index);s.resources.scrap+=goal?.reward.scrap??160;s.resources.parts+=goal?.reward.parts??1;
     if(goal)s.season.points+=goal.reward.points;
   }
   else if(a.type==='claim_season'){
     if(a.premium)throw Error('不应领取付费档');s.season.claimedFree.push(a.tier);
     if(a.tier%10===0)s.resources.scrap+=200*a.tier;
     else if(a.tier%5===0)s.items.push({id:100+a.tier});
     else{s.resources.scrap+=60*a.tier;s.resources.parts+=Math.ceil(a.tier/4);}
   } else if(a.type==='claim_achievement'){s.achievements.push(a.id);s.resources.scrap+=100;}
   else throw Error('意外写操作 '+a.type);
   if(!sm.simulateResources)s.lastSettledAt=clock;
 const receipt={view:shelterData(),result:sm.resultMessages?.[a.type]?{message:sm.resultMessages[a.type]}:a.type==='rescue_incident'?{message:'已核对房间救援'}:{}};
   sm.receipts[envelope.idempotencyKey]=receipt;return new Response(JSON.stringify(receipt));
 }
 return farmFetch(url,options);
};
window.shelterTransport=(url,options)=>fetch(url,options);
// Opt-in contract fixture transcribed from cached-f_001161.js (2026-11-09).
const residentName=p=>sm.ui20261109?'#'+p.id+' '+p.name:p.name;
const fixturePager=(root,count,key)=>{
 if(!sm.ui20261109||count<=12)return;
 const pages=Math.ceil(count/12),page=Math.min(sm[key]||0,pages-1),pager=document.createElement('div');pager.setAttribute('aria-label','分页');
 const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
 prev.textContent='上一页';next.textContent='下一页';label.textContent=(page+1)+'/'+pages+' 页 · 共 '+count+' 项';
 prev.disabled=page<=0;next.disabled=page>=pages-1;
 prev.onclick=()=>{sm[key]=page-1;renderShelter();};next.onclick=()=>{sm[key]=page+1;renderShelter();};pager.append(prev,label,next);root.append(pager);
};
const fixturePage=(rows,key)=>sm.ui20261109?rows.slice(12*(sm[key]||0),12*((sm[key]||0)+1)):rows;
window.fixtureConfirm=async(title,description)=>{
 // Native ConfirmDialog renders Description as a div, linked by aria-describedby.
 const d=document.createElement('div');d.setAttribute('role','alertdialog');d.innerHTML='<h2></h2><div></div><button>取消</button><button>确认</button>';
 d.children[1].id='fixture-confirm-description';d.setAttribute('aria-describedby',d.children[1].id);
 d.children[0].textContent=title;d.children[1].textContent=description;document.body.append(d);
 const prior=[...document.querySelectorAll('[role="dialog"]')];prior.forEach(el=>el.setAttribute('inert',''));
 const yes=await new Promise(resolve=>{d.children[2].onclick=()=>resolve(false);d.children[3].onclick=()=>resolve(true);});
 d.remove();prior.forEach(el=>el.removeAttribute('inert'));return yes;
};
window.shelterAct=async a=>{
 if(sm.ui20261121&&a.type==='upgrade'){
   const room=sm.view.state.rooms.find(room=>room.id===a.roomId),base={power:100,diner:100,water:100,scrap:80,quarters:120,storage:80,medbay:300,workshop:500,training:400}[room.type];
   const scrap=Math.ceil(base*room.width*(room.level===1?2.5:6)),parts=room.level===1?0:15*room.width;
   if(!await fixtureConfirm('确认升级房间？','将扣除 '+scrap.toLocaleString('en-US')+' 废料和 '+parts+' 零件，施工期间暂停生产。'))return false;
 }
 if(sm.ui20261109){
   const s=sm.view.state,p=s.residents.find(p=>p.id===a.residentId),reasons=[];
   if(a.type==='assign'&&p){
     const from=s.rooms.find(r=>r.id===p.roomId),to=s.rooms.find(r=>r.id===a.roomId);
     if(from?.type==='training')reasons.push('正在训练室·'+({str:'力量',per:'感知',end:'耐力',cha:'魅力',int:'智力',agi:'敏捷',lck:'幸运'}[from.trainStat])+(from.width>1?' ×'+from.width:'')+'训练（'+(100*(p.training||0)).toFixed(1)+'%），调离后暂停，进度保留；'+(sm.ui20261121?'换属性后仍可回来继续':'换训练属性时从 0 开始'));
     if(to?.type==='quarters'&&!to.incident){
       const others=s.residents.filter(o=>o.id!==p.id&&o.roomId===to.id&&o.away===null&&o.deadAt===null&&o.adultAt<=clock);
       if(p.romance&&!others.some(o=>o.id===p.romance.partnerId))reasons.push('本人已与其他居民培养感情，调岗会暂停原感情');
       if(p.familyCooldownUntil>clock)reasons.push('本人尚在生育冷却中，剩余 '+Math.ceil((p.familyCooldownUntil-clock)/60000)+' 分钟');
       if(p.happiness<50)reasons.push('本人心情低于 50，暂不能培养感情');
     }
     if(reasons.length&&!await fixtureConfirm('确认调动 '+residentName(p)+'？',reasons.join('；')+'。'))return false;
   }
   if(a.type==='equip'){
     const owner=s.residents.find(o=>o.weaponId===a.itemId||o.outfitId===a.itemId);
     if(owner&&owner.id!==p.id&&!await fixtureConfirm('转交 '+residentName(owner)+' 的装备？','原持有者会卸下这件装备，当前居民换下的装备放入仓库。'))return false;
   }
 }
 if(sm.busy)throw Error('重复避难所请求');sm.busy=true;renderShelter();
 try{const r=await shelterTransport('/api/shelter/action',{method:'POST',body:JSON.stringify({action:a,idempotencyKey:crypto.randomUUID()})});return r.ok;}
 catch{return false;}finally{sm.busy=false;if(location.pathname==='/shelter')renderShelter();}
};
window.closeResident=()=>{document.querySelector('[data-staff-dialog]')?.remove();game.removeAttribute('inert');game.removeAttribute('aria-hidden');};
const shelterLabels={door:'大门',power:'发电站',diner:'餐厅',water:'净水站',scrap:'废料回收站',quarters:'宿舍',storage:'仓库',medbay:'医务室',workshop:'工坊',training:'训练室',radio:'电台',armory:'武器工坊',tailor:'服装工坊'};
window.openConstruction=(kind,target)=>{
 const s=sm.view.state,r=kind==='upgrade'?s.rooms.find(r=>r.id===target):null;
 const d=document.createElement('div');d.setAttribute('role',kind==='dig'?'alertdialog':'dialog');d.dataset.constructionDialog=kind;
 const training=r?.type==='training'?'·'+({str:'力量',per:'感知',end:'耐力',cha:'魅力',int:'智力',agi:'敏捷',lck:'幸运'}[r.trainStat]):'';
 const title=kind==='build'?'在第 '+target.floor+' 层建造':kind==='dig'?(sm.ui20261109?'往下挖第 ':'向下挖到第 ')+(s.depth+1)+' 层？':shelterLabels[r.type]+training+(r.width>1?' ×'+r.width:'')+' · '+r.level+' 级';
 d.innerHTML='<h2>'+title+'</h2><button aria-label="关闭">关闭</button>';
 const close=()=>{d.remove();game.removeAttribute('inert');game.removeAttribute('aria-hidden');};d.querySelector('button').onclick=close;
 const actionButton=(root,text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{if(await shelterAct(sm.constructionWrong?{...action,roomId:999}:action))close();};root.append(b);};
 if(kind==='build'){
   const ul=document.createElement('ul');d.append(ul);
   for(const [type,base] of Object.entries({power:100,diner:100,water:100,scrap:80,quarters:120,storage:80,medbay:300,workshop:500,training:400,radio:800})){
     const row=document.createElement('li');row.innerHTML='<p>'+shelterLabels[type]+'</p>';ul.append(row);
     const cost=Math.ceil(base*(1+.2*s.rooms.filter(r=>r.type===type).reduce((n,r)=>n+r.width,0)));
     const action={type:'build',room:type,...target,trainStat:type==='training'?'str':null};
     if(type==='training'){
       const group=document.createElement('div');group.setAttribute('role','radiogroup');group.setAttribute('aria-label','训练属性');row.append(group);
       for(const [stat,label] of Object.entries({str:'力量',per:'感知',end:'耐力',cha:'魅力',int:'智力',agi:'敏捷',lck:'幸运'})){
         const b=document.createElement('button');b.textContent=label;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(action.trainStat===stat));group.append(b);
         b.onclick=()=>{action.trainStat=stat;for(const child of group.children)child.setAttribute('aria-checked',String(child===b));};
       }
     }
     actionButton(row,(cost+(sm.wrongConstructionPrice||0))+' 废料',action);
   }
 }else if(kind==='upgrade'){
   if(r.incident&&!sm.hideRescue){const rescue=document.createElement('button');rescue.textContent='一键救援（最多 3 人）';rescue.onclick=()=>shelterAct({type:'rescue_incident',roomId:r.id});d.append(rescue);}
   if(['armory','tailor'].includes(r.type)&&!r.craft)actionButton(d,'0 档 · 80 废料',{type:'craft',roomId:r.id,tier:0});
   const base={power:100,diner:100,water:100,scrap:80,quarters:120,storage:80,medbay:300,workshop:500,training:400}[r.type],parts=r.level===1?0:15*r.width;
   actionButton(d,'升到 '+(r.level+1)+' 级 · '+(Math.ceil(base*r.width*(r.level===1?2.5:6))+(sm.wrongConstructionPrice||0))+' 废料'+(parts?' '+parts+' 零件':'')+' · 1小时0分',{type:'upgrade',roomId:r.id});
 }else{
   const cost=Math.ceil(120*(s.depth+1)**1.4),p=document.createElement(sm.ui20261109?'div':'p');
   p.dataset.constructionDescription='';p.textContent='花 '+cost.toLocaleString('en-US')+' 废料，把电梯井延伸一层。';d.append(p);
   if(sm.ui20261109){p.id='shelter-dig-description';d.setAttribute('aria-describedby',p.id);}
   const cancel=d.querySelector('button');cancel.removeAttribute('aria-label');cancel.textContent='取消';
   const b=document.createElement('button');b.textContent='确认';d.append(b);
   // 对应网站 Q 的确认 Promise：点击后在微任务发送原请求。
   (async()=>{const confirmed=await new Promise(resolve=>{b.onclick=()=>resolve(true);cancel.onclick=()=>resolve(false);});close();if(confirmed)await shelterAct({type:'dig'});})();
 }
 document.body.append(d);game.setAttribute('inert','');game.setAttribute('aria-hidden','true');
};
window.openResident=id=>{
 sm.residentOpens=(sm.residentOpens||0)+1;
 const p=sm.view.state.residents.find(p=>p.id===id),level=Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)));
 const d=document.createElement('div');d.setAttribute('role','dialog');d.dataset.staffDialog=id;
 d.innerHTML='<h2>'+residentName(p)+' · '+level+' 级</h2><button aria-label="关闭">关闭</button><label>武器<select><option>不装备</option></select></label><label>服装<select><option value="">不装备</option></select></label><label>调去（也可以直接拖动小人）<select><option value="" disabled>选择房间</option></select></label><button>退休</button>';
 const room=sm.view.state.rooms.find(r=>r.id===p.roomId),description=document.createElement('p');
 const statKeys=['str','per','end','cha','int','agi','lck'],statLabels=['力量','感知','耐力','魅力','智力','敏捷','幸运'];
 const roomLabel=r=>shelterLabels[r.type]+(r.type==='training'&&r.trainStat?'·'+statLabels[statKeys.indexOf(r.trainStat)]:'')+(r.width>1?' ×'+r.width:'');
 description.textContent=room?'在'+(sm.ui20261109?room.floor+' 层·第 '+Math.max(0,room.col-1)+' 格 '+roomLabel(room)+' #'+room.id:roomLabel(room)+'（'+room.floor+' 层）'):'在休息';d.append(description);
 const stats=document.createElement('ul');stats.setAttribute('aria-label','属性');
 for(const [i,key] of statKeys.entries()){const li=document.createElement('li');li.innerHTML='<span>'+statLabels[i]+'</span><span>'+p.stats[key]+'</span>';stats.append(li);}d.append(stats);
 const outfit=d.querySelectorAll('select')[1];
 const weapon=d.querySelectorAll('select')[0];weapon.options[0].value='';
 for(const item of sm.view.state.items.filter(i=>i.slot==='weapon')){const o=document.createElement('option');o.value=item.id;o.textContent=item.name||'武器';weapon.append(o);}
 weapon.value=p.weaponId==null?'':String(p.weaponId);weapon.onchange=async()=>{weapon.disabled=true;await shelterAct({type:'equip',residentId:p.id,itemId:Number(weapon.value),slot:'weapon'});weapon.disabled=false;};
 for(const item of sm.view.state.items.filter(item=>item.slot==='outfit'&&!sm.view.state.residents.some(other=>other.outfitId===item.id&&other.away))){
   const o=document.createElement('option');o.value=item.id;o.textContent=item.name||'生产服';outfit.append(o);
 }outfit.value=p.outfitId===null?'':String(p.outfitId);
 outfit.onchange=async()=>{outfit.disabled=true;await shelterAct({type:'equip',residentId:p.id,itemId:Number(outfit.value),slot:'outfit'});outfit.disabled=false;};
 const select=d.querySelectorAll('select')[2];
 if(p.roomId!==null){const rest=document.createElement('option');rest.value='rest';rest.textContent='去休息';select.append(rest);}
 for(const r of sm.view.state.rooms.filter(r=>r.id!==p.roomId&&r.type!=='elevator'&&(r.type!=='storage'||r.incident)&&(r.builtAt<=clock||r.incident))){
   const o=document.createElement('option');o.value=r.id;o.textContent=r.type;select.append(o);
 }select.value='';
 select.onchange=async()=>{select.disabled=true;await shelterAct({type:'assign',residentId:p.id,roomId:select.value==='rest'?null:Number(select.value)});select.disabled=false;};
 d.querySelector('button').onclick=closeResident;d.querySelectorAll('button')[1].onclick=()=>sm.calls.push({type:'retire'});
 const heal=document.createElement('button');heal.textContent='用治疗针（'+(sm.ui20261109?'恢复最大血量 40%，':'')+'剩 '+Math.floor(sm.view.state.resources.stimpak)+'）';
 heal.onclick=async()=>{heal.disabled=true;await shelterAct({type:'stimpak',residentId:p.id});heal.disabled=false;};d.append(heal);
 if(p.deadAt!==null){
   const revive=document.createElement('button'),price=100+40*Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)));
   revive.dataset.revive='';revive.textContent='花 '+(price+(sm.revivalQuoteDelta||0))+' 废料救回';
   revive.disabled=sm.view.state.resources.scrap<price||Boolean(sm.revivalDisabled);
   revive.onclick=async()=>{revive.disabled=true;await shelterAct({type:'revive',residentId:p.id});};d.append(revive);
   const bury=document.createElement('button');bury.textContent='安葬';bury.onclick=()=>sm.calls.push({type:'bury',residentId:p.id});d.append(bury);
 }
 document.body.append(d);game.setAttribute('inert','');game.setAttribute('aria-hidden','true');
};
window.renderShelter=()=>{
 const s=sm.view.state;document.getElementById('fixture-resources')?.remove();
 game.innerHTML='<h1>方舟避难所</h1><a href="/activities/expedition">远征</a><div role="tablist" aria-label="避难所"></div><div id="shelter-content"></div>';
 game.querySelector('a').onclick=e=>{e.preventDefault();navFarm('/activities/expedition');};
 const tabs=game.querySelector('[role="tablist"]'),content=game.querySelector('#shelter-content');
 for(const label of ['避难所','目标','图鉴','居民','废土',...(sm.neighbors?['排行']:[]),...(sm.caravan?['商队']:[])]){
   const b=document.createElement('button');b.setAttribute('role','tab');b.setAttribute('aria-selected',String(sm.tab===label));b.textContent=label;
   const count=label==='目标'?(!sm.dailyIncomplete?3-s.daily.claimed.length:0)+Math.max(0,Math.min(30,Math.floor(s.season.points/(sm.ui20261109?60:150)))-s.season.claimedFree.length)+(sm.paidBadge||0):label==='图鉴'&&!sm.achievementIncomplete&&!s.achievements.includes('birth-1')?1:0;
   if(count){const badge=document.createElement('span');badge.textContent=count;b.append(badge);}
   b.onclick=()=>{sm.tabs.push(label);sm.tab=label;renderShelter();};tabs.append(b);
 }
 const button=(root,label,a,disabled=false)=>{
   const b=document.createElement('button');b.textContent=label;b.disabled=sm.busy||disabled;b.onclick=()=>shelterAct(a);root.append(b);return b;
 };
 if(sm.tab==='避难所'){
   if(sm.tutorial&&!(s.tutorial?.claimed||[]).includes(1)){
     const panel=document.createElement('section');panel.innerHTML='<h2><span>新手引导 · 0/8</span></h2><p>第 1 步：收取产出</p><p>收满一批再领取</p><p>奖励 50 废料</p>';
     button(panel,'收起',{type:'dismiss_tutorial'});button(panel,'领取',{type:'claim_tutorial',step:1});content.append(panel);
   }
   button(content,'全部收取',{type:'collect_all'});
   for(const r of s.rooms){
     const room=document.createElement('div');room.dataset.room=r.id;room.setAttribute('role','button');room.setAttribute('aria-label','废料回收站 可收取 1 批');
     if(r.incident)room.append(shelterLabels[r.type]||'房间');
     if(shelterLabels[r.type])room.onclick=e=>{if(!e.target.closest('button'))openConstruction('upgrade',r.id);};
     const label={scrap:'废料',power:'电力',diner:'食物',water:'净水',medbay:'治疗针',workshop:'零件'}[r.type];
     if(label&&r.stored>0){const b=button(room,'◆',{type:'collect',roomId:r.id});b.setAttribute('aria-label','收取'+label);}content.append(room);
   }
   const build=button(content,'建造',{type:'建造'});build.onclick=()=>{sm.buildMode=!sm.buildMode;renderShelter();};
   if(sm.buildMode)for(let floor=1;floor<=s.depth;floor++){
     const rooms=s.rooms.filter(r=>r.floor===floor),col=Math.max(2,...rooms.map(r=>r.col+r.width));if(col>=8)continue;
     const spot=document.createElement('button');spot.setAttribute('aria-label','在第 '+floor+' 层建造');spot.textContent='+';
     spot.onclick=()=>openConstruction('build',{floor,col});content.append(spot);
   }
   const dig=button(content,Number.isInteger(s.depth)?'往下挖 · '+Math.ceil(120*(s.depth+1)**1.4)+' 废料':'往下挖',{type:'往下挖'});dig.onclick=()=>openConstruction('dig');
   for(const label of ['升级','安排工作','培养感情','星核汽水加速'])button(content,label,{type:label});
 } else if(sm.tab==='废土'){
   const root=document.createElement('section');root.innerHTML='<h2>单人探险（'+(s.explorers||[]).length+'/'+(sm.exploreSlots??Math.min(6,1+Math.floor((s.depth||1)/8)))+'）</h2><ul></ul>';
   const select=(label,options,value)=>{const l=document.createElement('label');l.append(label);const input=document.createElement('select');
     for(const [v,text] of options){const o=document.createElement('option');o.value=v;o.textContent=text;input.append(o);}l.append(input);root.append(l);input.value=String(value);return input;};
   const people=s.residents.filter(p=>p.away===null&&p.deadAt===null&&p.adultAt<=clock);
   const person=select('探险者',people.map(p=>[p.id,residentName(p)+(sm.ui20261109?' · '+Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))+' 级 · 战力 99':'')]),sm.explorePerson??people[0]?.id);
   const tier=select('区域',Array.from({length:1+Math.floor((s.depth||0)/10)},(_,i)=>[i,'区域'+i]),sm.exploreTier??Math.floor((s.depth||0)/10));
   const supply=document.createElement('label');supply.textContent='带治疗针（库存 '+s.resources.stimpak+'）';supply.innerHTML+='<input type="number">';root.append(supply);
   const needles=supply.querySelector('input');needles.value=sm.exploreStimpaks??2;
   const abyssLabel=document.createElement('label');abyssLabel.innerHTML='深渊门票<input type="checkbox">';root.append(abyssLabel);const abyss=abyssLabel.querySelector('input');abyss.checked=Boolean(sm.abyss);
   person.onchange=()=>sm.explorePerson=Number(person.value);tier.onchange=()=>sm.exploreTier=Number(tier.value);needles.oninput=()=>sm.exploreStimpaks=Number(needles.value);abyss.onchange=()=>sm.abyss=abyss.checked;
   if(sm.ui20261121){const commission=select('废土委托 · 每周可选一种，走满时长并安全返回才取得补给',[
     ['','普通探险'],['salvage','短途回收 · 2 小时后返程'],['survey','长途勘查 · 12 小时后返程']],sm.commission||'');commission.onchange=()=>sm.commission=commission.value;}
   const start=button(root,'出发',{type:'explore_start'});start.onclick=()=>shelterAct({type:'explore_start',residentId:Number(person.value),tier:Number(tier.value),stimpaks:Number(needles.value),abyss:abyss.checked,...(sm.ui20261121&&sm.commission?{commission:sm.commission}:{})});content.append(root);
   for(const e of s.explorers||[]){
     const p=s.residents.find(p=>p.id===e.residentId);if(!p)continue;
     const row=document.createElement('li'),title=document.createElement('p'),status=document.createElement('p');
     const zone=['锈蚀街区','沉没港口','晶体平原','方舟残骸','静默高架'][e.tier]||'深渊裂谷 第 '+(e.tier-4)+' 段';
     title.textContent=residentName(p)+' · '+(e.abyss?'深渊 ':'')+zone;
     const arrived=Number.isFinite(e.returnAt)&&e.returnAt<=clock;
     status.textContent=p.deadAt!==null?'已倒下':arrived?'到家了':'返程中';row.append(title,status);
     if(p.deadAt!==null)button(row,'花 100 废料救回（自动返程）',{type:'revive',residentId:p.id});
     else if(arrived)button(row,'领取',{type:'explore_claim',explorerId:e.id});
     else if(e.recalledAt===null||e.recalledAt===undefined){const recall=button(row,'召回',{type:'explore_recall',explorerId:e.id});recall.onclick=()=>{
       const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<h2>召回 '+residentName(p)+'？</h2><p>返程需要 3小时（已出门时间的一半），到家后领取。</p><button>取消</button><button>确认</button>';document.body.append(d);
       game.setAttribute('inert','');(async()=>{const yes=await new Promise(resolve=>{d.children[2].onclick=()=>resolve(false);d.children[3].onclick=()=>resolve(true);});d.remove();game.removeAttribute('inert');if(yes)await shelterAct({type:'explore_recall',explorerId:e.id});})();
     };}root.querySelector('ul').append(row);
   }
   const quests=document.createElement('section');quests.innerHTML='<h2>本周废土任务</h2>';
   const runs=document.createElement('ul');quests.append(runs);
   for(const q of s.quests||[]){const row=document.createElement('li');row.innerHTML='<p>'+(q.snapshot?.title||'任务')+' · '+(q.team||[]).map(id=>residentName(s.residents.find(p=>p.id===id))).join('、')+'</p><p>'+(q.status==='failed'?'失败':'完成')+'了，小队已回家</p>';runs.append(row);button(row,'领取',{type:'quest_claim',runId:q.id},!Number.isFinite(q.returnAt)||q.returnAt>clock);}
   const field=document.createElement('fieldset');field.innerHTML='<legend>选择小队（0/3） · 小队战力0</legend>';quests.append(field);sm.questTeam??=[];
   field.querySelector('legend').textContent='选择小队（'+sm.questTeam.length+'/3） · 小队战力0';
   for(const p of fixturePage(people,'questPage')){const label=document.createElement('label');label.textContent=residentName(p)+' '+Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))+'级 · 战力 99';const input=document.createElement('input');input.type='checkbox';input.checked=sm.questTeam.includes(p.id);input.disabled=!input.checked&&sm.questTeam.length>=3;input.onchange=()=>{sm.questTeam=input.checked?[...sm.questTeam,p.id]:sm.questTeam.filter(id=>id!==p.id);field.querySelector('legend').textContent='选择小队（'+sm.questTeam.length+'/3） · 小队战力0';if(sm.ui20261109)renderShelter();};label.prepend(input);field.append(label);}
   fixturePager(field,people.length,'questPage');
   const offers=document.createElement('ul');quests.append(offers);
   for(const q of sm.view.env.quests||[]){const row=document.createElement('li');row.innerHTML='<p>'+q.title+' ★</p>';offers.append(row);const b=button(row,'派小队出发',{type:'quest_start'});b.onclick=async()=>{if(await shelterAct({type:'quest_start',questId:q.id,team:[...sm.questTeam]}))sm.questTeam=[];};}
   content.append(quests);
 } else if(sm.tab==='居民'){
   const root=document.createElement('section');root.innerHTML='<h2>居民 '+s.residents.length+'/20</h2><label>筛选<select><option value="all">全部</option><option value="idle">闲着</option></select></label><ul></ul>';
   const filter=root.querySelector('select');filter.value=sm.filter;filter.onchange=()=>{sm.filter=filter.value;sm.residentPage=0;renderShelter();};
   if(sm.ui20261109){const select=document.createElement('select');select.setAttribute('aria-label','按房间筛选');
     for(const [value,label] of [['all','全部房间'],['rest','休息'],...s.rooms.map(r=>[r.id,shelterLabels[r.type]])]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
     select.value=sm.roomFilter||'all';select.onchange=()=>{sm.roomFilter=select.value;sm.residentPage=0;renderShelter();};root.insertBefore(select,root.querySelector('ul'));
   }
   const residents=s.residents.filter(p=>(sm.filter==='all'||p.roomId===null)&&(!sm.ui20261109||!sm.roomFilter||sm.roomFilter==='all'||(sm.roomFilter==='rest'?p.roomId===null:String(p.roomId)===sm.roomFilter)));
   for(const p of fixturePage(residents,'residentPage')){
     const li=document.createElement('li'),b=document.createElement('button'),room=s.rooms.find(r=>r.id===p.roomId);
     const statKeys=['str','per','end','cha','int','agi','lck'],statLabels=['力量','感知','耐力','魅力','智力','敏捷','幸运'];
     const position=p.deadAt!==null?'已倒下':p.away?(p.away.kind==='explore'?'探险中':'任务中'):p.adultAt>clock?'儿童':room?
       room.floor+' 层 '+shelterLabels[room.type]+(room.type==='training'&&room.trainStat?'·'+statLabels[statKeys.indexOf(room.trainStat)]:'')+(room.width>1?' ×'+room.width:''):'闲着';
     const avatar=document.createElement('img'),body=document.createElement('span'),title=document.createElement('span'),location=document.createElement('span'),attributes=document.createElement('span');
     title.className='block truncate';attributes.className='block text-caption text-muted-foreground';
     title.append(residentName(p)+' · '+Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))+' 级 · ');location.textContent=position;title.append(location);
     attributes.textContent=statKeys.map((k,i)=>statLabels[i][0]+p.stats[k]).join(' ')+' · 血 100% · 心情 '+Math.round(p.happiness);
     if(sm.ui20261109){attributes.textContent='';for(const [i,key] of statKeys.entries()){const span=document.createElement('span');span.textContent=statLabels[i][0]+p.stats[key];attributes.append(span);}}
     body.append(title,attributes);if(sm.ui20261109){const health=document.createElement('span');health.textContent='战力 99 · 血 100% · 心情 '+Math.round(p.happiness);body.append(health);}b.append(avatar,body);
     b.onclick=()=>openResident(p.id);li.append(b);
     if(sm.ui20261109&&sm.quickAssign!==false&&p.away===null&&p.deadAt===null&&p.adultAt<=clock){
       const select=document.createElement('select');select.setAttribute('aria-label','调动 '+residentName(p));select.disabled=sm.busy;
       const placeholder=document.createElement('option');placeholder.value='';placeholder.disabled=true;placeholder.textContent='调换岗位';select.append(placeholder);
       if(p.roomId!==null){const rest=document.createElement('option');rest.value='rest';rest.textContent='休息';select.append(rest);}
       for(const r of s.rooms.filter(r=>r.id!==p.roomId&&r.type!=='elevator'&&(r.type!=='storage'||r.incident)&&(r.builtAt<=clock||r.incident))){
         const o=document.createElement('option');o.value=r.id;o.textContent=r.floor+' 层·第 '+Math.max(0,r.col-1)+' 格 '+shelterLabels[r.type]+' #'+r.id;select.append(o);
       }select.value='';select.onchange=()=>select.value&&shelterAct({type:'assign',residentId:p.id,roomId:select.value==='rest'?null:Number(select.value)});li.append(select);
     }
     root.querySelector('ul').append(li);
   }fixturePager(root,residents.length,'residentPage');content.append(root);
 } else if(sm.tab==='目标'){
   const daily=document.createElement('section');daily.innerHTML='<h2>今日目标</h2><ul></ul>';
   for(let index=0;index<3;index++){
     const goal=sm.dailyGoalRows?s.daily.picks[index]:null;
     const row=document.createElement('li');row.innerHTML='<div><p>今日目标 '+index+' '+(goal?(s.daily.counters[goal.key]??0)+'/'+goal.target:'1/1')+'</p><p>奖励 '+
       (goal?goal.reward.scrap+' 废料 · '+goal.reward.parts+' 零件 · '+goal.reward.points+' 赛季积分':'160 废料 · 1 零件 · 30 赛季积分')+'</p></div>';
     const incomplete=sm.inspectionGoals||sm.dailyGoalRows?(s.daily.counters[s.daily.picks[index].key]??0)<s.daily.picks[index].target:sm.dailyIncomplete;
     button(row,s.daily.claimed.includes(index)?'已领':'领取',{type:'claim_objective',index},s.daily.claimed.includes(index)||incomplete);daily.lastChild.append(row);
   }
   if(sm.ui20261109){
     const d=s.daily,goal=d.picks?.find(p=>p.key==='incident');
     const disabled=!goal||(d.counters?.incident??0)>=goal.target||clock<(d.counters?.safety_inspection_at??0)+600000||s.rooms.some(r=>r.incident)||
       !s.residents.some(p=>p.away===null&&p.deadAt===null&&p.adultAt<=clock&&p.hp>=.5*Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end)));
     button(daily,'安全巡检',{type:'safety_inspection'},disabled);
   }content.append(daily);
   const tiers=Array.from({length:Math.min(30,Math.floor(s.season.points/(sm.ui20261109?60:150)))},(_,i)=>i+1).filter(i=>!s.season.claimedFree.includes(i));
   const free=button(content,'领取免费档（'+tiers.length+'）',{type:'unused'},!tiers.length);
   free.onclick=async()=>{for(const tier of tiers)if(!await shelterAct({type:'claim_season',tier,premium:false}))break;};
   button(content,'解锁通行证',{type:'buy_season_premium'});button(content,'领取通行证档（1）',{type:'claim_season',tier:1,premium:true});
 } else if(sm.tab==='商队'){
   const root=document.createElement('section');root.innerHTML='<h2>今日商队</h2><ul></ul>';
   for(const offer of sm.caravan.offers){
     const li=document.createElement('li');li.textContent='★ 交付 '+offer.scrap+' 废料'+(offer.parts?' + '+offer.parts+' 零件':'')+' 报酬最多 '+offer.reward+' 代币';
     const b=document.createElement('button');b.textContent=offer.delivered?'已交付':'交付';b.disabled=offer.delivered;li.append(b);root.lastChild.append(li);
     b.onclick=async()=>{sm.beforeCaravan?.();
       if(sm.delayCaravanSend)await new Promise(resolve=>{sm.releaseCaravanSend=resolve;});
       const send=()=>fetch('/api/shelter/caravan',{method:'POST',body:JSON.stringify({slot:offer.slot,idempotencyKey:crypto.randomUUID()})});
       const requests=[send()];if(sm.caravanDuplicate)requests.push(send());
       await Promise.allSettled(requests);renderShelter();};
   }content.append(root);
 } else if(sm.tab==='排行'){
   const root=document.createElement('section');root.innerHTML='<h2>排行榜</h2><div role="group" aria-label="排行方式"><button aria-pressed="true">等级</button></div><ol></ol>';
   for(const v of sm.neighbors||[]){
     if(sm.hiddenNeighbors?.includes(v.userId))continue;
     const li=document.createElement('li'),b=document.createElement('button');b.textContent=v.shelterName+' 第 '+v.vaultNo+' 号 · 邻居';
     b.onclick=()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.dataset.socialDialog='true';
       const h=document.createElement('h2');h.textContent=v.shelterName;d.append(h);
       const label=document.createElement('p');label.textContent='第 '+v.vaultNo+' 号避难所';d.append(label);
       const close=document.createElement('button');close.setAttribute('aria-label','关闭');close.onclick=()=>{d.remove();game.removeAttribute('inert');};d.append(close);
       const help=document.createElement('button');help.textContent=v.helpedToday?'今天已帮过忙':'帮忙 · 双方各得废料';help.disabled=v.helpedToday||v.helpBlocked!==null;
       help.onclick=async()=>{help.disabled=true;if(sm.delayHelpSend)await new Promise(resolve=>{sm.releaseHelpSend=resolve;});
         await fetch('/api/shelter/social/help',{method:'POST',body:JSON.stringify({targetId:sm.helpWrongTarget||v.userId,deviceFp:'fixture-fingerprint',idempotencyKey:crypto.randomUUID()})});help.textContent='今天已帮过忙';};d.append(help);
       if(sm.socialLoadDelay){h.textContent='加载中…';label.textContent='';help.disabled=true;
         sm.completeSocialLoad=()=>{h.textContent=v.shelterName;label.textContent='第 '+v.vaultNo+' 号避难所';help.disabled=v.helpedToday||v.helpBlocked!==null;};
         if(sm.socialLoadDelay>0)setTimeout(sm.completeSocialLoad,sm.socialLoadDelay);}
       game.setAttribute('inert','');document.body.append(d);};li.append(b);root.querySelector('ol').append(li);
   }content.append(root);
 } else if(sm.tab==='图鉴'){
   const root=document.createElement('section');root.setAttribute('aria-label','铜成就');root.innerHTML='<h3>铜成就</h3><ul><li><div><p>新生命</p><p>出生一个孩子</p><p>1/1 · 奖励 100 废料</p></div></li></ul>';
   const claimed=s.achievements.includes('birth-1');button(root.querySelector('li'),claimed?'已领':'领取',{type:'claim_achievement',id:'birth-1'},claimed||sm.achievementIncomplete);content.append(root);
 }
};
const renderFarmExp=window.renderExp;
window.renderExp=()=>{renderFarmExp();const a=document.createElement('a');a.href='/shelter';a.textContent='方舟避难所';a.onclick=e=>{e.preventDefault();navFarm('/shelter');};game.prepend(a);};
window.navFarm=path=>{fm.calls.push({type:'navigate',path});history.pushState({},'',path);if(path==='/farm')renderFarm();else if(path==='/shelter')renderShelter();else renderExp();};
if(location.pathname==='/shelter')renderShelter();else if(location.pathname==='/farm')renderFarm();else renderExp();
</script>`;
