import { farmMarkup } from './arkengine-farm.fixture.mjs';

// 2026-11-03 公开前端的原生按钮/页签结构；只在本机模拟，不使用真实账户。
export const shelterMarkup = farmMarkup + `<script>
window.sm = { tab:'避难所', tabs:[], reads:0, calls:[], snapshots:[], busy:false, mode:'success', tutorial:true, filter:'all',
  view:{ vaultNo:77, serverTime:clock, progress:{level:2}, switches:{frozen:false}, nameRequired:false,
    env:{events:[]}, state:{lastSettledAt:clock, resources:{power:100,food:100,water:100,scrap:269,parts:0,stimpak:0},
      stats:{collected:0}, legacy:{perks:{}}, items:[], births:[], achievements:[], explorers:[], quests:[],
      tutorial:{claimed:[]}, daily:{day:'2026-10-10',claimed:[]}, season:{month:'2026-10',points:0,claimedFree:[]},
      rooms:[{id:1,type:'scrap',width:1,level:1,stored:30,builtAt:0,upgradeAt:null,incident:null,unpowered:false}],
      residents:[{id:1,name:'居民甲',parents:[],hp:100,roomId:1,away:null,deadAt:null,adultAt:0,xp:0,happiness:100,outfitId:null,weaponId:null,
        stats:{str:3,per:3,end:5,cha:3,int:3,agi:3,lck:3},romance:null,familyCooldownUntil:0}] } } };
const farmFetch=window.fetch;
window.shelterData=()=>({...structuredClone(sm.view),serverTime:sm.snapshotAt??clock});
window.fetch=async (url,options)=>{
 if(url instanceof Request){const request=url;options={method:request.method,...options,body:options?.body??await request.text()};url=new URL(request.url).pathname;}
 else if(url instanceof URL)url=url.pathname;
 if(url==='/api/shelter'){
   sm.reads++; if(sm.deferRead)return new Promise(resolve=>{sm.resolveRead=()=>resolve(new Response(JSON.stringify(shelterData())));});
   if(sm.readError)throw new TypeError('fixture network');
   if(sm.malformedRead)return new Response('{"state":',{status:200});
   return new Response(JSON.stringify(shelterData()),{status:sm.httpStatus||200});
 }
 if(url==='/api/shelter/action'&&options?.method==='POST'){
   const envelope=JSON.parse(options.body),a={...envelope.action,idempotencyKey:envelope.idempotencyKey};sm.calls.push(a);
   if(sm.mode==='unknown'||sm.assignUnknown&&a.type==='assign'||sm.equipUnknown&&a.type==='equip')return new Promise(()=>{});
   if(sm.mode==='error'||sm.mode==='partial'&&a.type==='claim_season'&&a.tier>1)return new Response('{}',{status:503});
   const s=sm.view.state;
   if(a.type==='collect_all'||a.type==='collect'){
     const types={scrap:['scrap',30],power:['power',30],diner:['food',25],water:['water',25],medbay:['stimpak',2],workshop:['parts',3]};
     for(const room of s.rooms.filter(r=>a.type==='collect_all'||r.id===a.roomId)){
       const def=types[room.type];if(!def)continue;
       const batch=def[1]*room.width*[0,1,1.5,2.1][room.level],amount=Math.floor(room.stored/batch+1e-9)*batch;
       room.stored-=amount;s.resources[def[0]]+=amount;s.stats.collected+=amount;
     }
   } else if(a.type==='explore_claim'){
     const e=s.explorers.find(e=>e.id===a.explorerId),p=e&&s.residents.find(p=>p.id===e.residentId);
     if(!e||!p||p.deadAt!==null||e.returnAt===null||e.returnAt>clock)throw Error('错误领取归来探险');
     for(const key of ['scrap','parts','stimpak'])s.resources[key]+=e.loot[key];
     if(sm.returnCarried!==false)s.resources.stimpak+=e.stimpaks;
     s.items.push(...e.loot.items);p.away=null;p.roomId=null;s.explorers=s.explorers.filter(r=>r.id!==e.id);
   } else if(a.type==='assign'){
     const p=s.residents.find(p=>p.id===a.residentId),r=s.rooms.find(r=>r.id===a.roomId);
     if(!p||a.roomId!==null&&!r||p.away||p.deadAt!==null||p.adultAt>clock)throw Error('错误调岗');
     if(r&&s.residents.filter(p=>p.deadAt===null&&p.adultAt<=clock&&p.roomId===r.id).length>=r.width*2)throw Error('房间满员');
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
     if(!p||p.away||!item||item.slot!==a.slot||a.slot!=='outfit')throw Error('错误穿衣');
     for(const other of s.residents)if(other.outfitId===item.id)other.outfitId=null;
     p.outfitId=item.id;
   } else if(a.type==='claim_tutorial'){s.tutorial??={claimed:[]};s.tutorial.claimed.push(a.step);s.resources.scrap+=50;}
   else if(a.type==='claim_objective'){s.daily.claimed.push(a.index);s.resources.scrap+=160;s.resources.parts++;}
   else if(a.type==='claim_season'){
     if(a.premium)throw Error('不应领取付费档');s.season.claimedFree.push(a.tier);
     if(a.tier%10===0)s.resources.scrap+=200*a.tier;
     else if(a.tier%5===0)s.items.push({id:100+a.tier});
     else{s.resources.scrap+=60*a.tier;s.resources.parts+=Math.ceil(a.tier/4);}
   } else if(a.type==='claim_achievement'){s.achievements.push(a.id);s.resources.scrap+=100;}
   else throw Error('意外写操作 '+a.type);
   s.lastSettledAt=clock;
   return new Response(JSON.stringify({view:shelterData(),result:{}}));
 }
 return farmFetch(url,options);
};
window.shelterTransport=(url,options)=>fetch(url,options);
window.shelterAct=async a=>{
 if(sm.busy)throw Error('重复避难所请求');sm.busy=true;renderShelter();
 try{const r=await shelterTransport('/api/shelter/action',{method:'POST',body:JSON.stringify({action:a,idempotencyKey:'fixture-key'})});return r.ok;}
 catch{return false;}finally{sm.busy=false;if(location.pathname==='/shelter')renderShelter();}
};
window.closeResident=()=>{document.querySelector('[data-staff-dialog]')?.remove();game.removeAttribute('inert');game.removeAttribute('aria-hidden');};
window.openResident=id=>{
 const p=sm.view.state.residents.find(p=>p.id===id),level=Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)));
 const d=document.createElement('div');d.setAttribute('role','dialog');d.dataset.staffDialog=id;
 d.innerHTML='<h2>'+p.name+' · '+level+' 级</h2><button aria-label="关闭">关闭</button><label>武器<select><option>不装备</option></select></label><label>服装<select><option value="">不装备</option></select></label><label>调去（也可以直接拖动小人）<select><option value="" disabled>选择房间</option></select></label><button>退休</button>';
 const outfit=d.querySelectorAll('select')[1];
 for(const item of sm.view.state.items.filter(item=>item.slot==='outfit'&&!sm.view.state.residents.some(other=>other.outfitId===item.id&&other.away))){
   const o=document.createElement('option');o.value=item.id;o.textContent=item.name||'生产服';outfit.append(o);
 }outfit.value=p.outfitId===null?'':String(p.outfitId);
 outfit.onchange=async()=>{outfit.disabled=true;await shelterAct({type:'equip',residentId:p.id,itemId:Number(outfit.value),slot:'outfit'});outfit.disabled=false;};
 const select=d.querySelectorAll('select')[2];
 if(p.roomId!==null){const rest=document.createElement('option');rest.value='rest';rest.textContent='去休息';select.append(rest);}
 for(const r of sm.view.state.rooms.filter(r=>r.id!==p.roomId&&r.type!=='elevator'&&r.type!=='storage'&&r.builtAt<=clock)){
   const o=document.createElement('option');o.value=r.id;o.textContent=r.type;select.append(o);
 }select.value='';
 select.onchange=async()=>{select.disabled=true;await shelterAct({type:'assign',residentId:p.id,roomId:select.value==='rest'?null:Number(select.value)});select.disabled=false;};
 d.querySelector('button').onclick=closeResident;d.querySelectorAll('button')[1].onclick=()=>sm.calls.push({type:'retire'});
 document.body.append(d);game.setAttribute('inert','');game.setAttribute('aria-hidden','true');
};
window.renderShelter=()=>{
 const s=sm.view.state;document.getElementById('fixture-resources')?.remove();
 game.innerHTML='<h1>方舟避难所</h1><a href="/activities/expedition">远征</a><div role="tablist" aria-label="避难所"></div><div id="shelter-content"></div>';
 game.querySelector('a').onclick=e=>{e.preventDefault();navFarm('/activities/expedition');};
 const tabs=game.querySelector('[role="tablist"]'),content=game.querySelector('#shelter-content');
 for(const label of ['避难所','目标','图鉴','居民','废土']){
   const b=document.createElement('button');b.setAttribute('role','tab');b.setAttribute('aria-selected',String(sm.tab===label));b.textContent=label;
   const count=label==='目标'?(!sm.dailyIncomplete?3-s.daily.claimed.length:0)+Math.max(0,Math.min(30,Math.floor(s.season.points/150))-s.season.claimedFree.length)+(sm.paidBadge||0):label==='图鉴'&&!sm.achievementIncomplete&&!s.achievements.includes('birth-1')?1:0;
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
     const label={scrap:'废料',power:'电力',diner:'食物',water:'净水',medbay:'治疗针',workshop:'零件'}[r.type];
     if(label&&r.stored>0){const b=button(room,'◆',{type:'collect',roomId:r.id});b.setAttribute('aria-label','收取'+label);}content.append(room);
   }
   for(const label of ['建造','往下挖','升级','安排工作','培养感情','星核汽水加速'])button(content,label,{type:label});
 } else if(sm.tab==='废土'){
   const root=document.createElement('section');root.innerHTML='<h2>单人探险（'+(s.explorers||[]).length+'/6）</h2><ul></ul>';
   button(root,'出发',{type:'explore_start'});content.append(root);
   for(const e of s.explorers||[]){
     const p=s.residents.find(p=>p.id===e.residentId);if(!p)continue;
     const row=document.createElement('li'),title=document.createElement('p'),status=document.createElement('p');
     const zone=['锈蚀街区','沉没港口','晶体平原','方舟残骸','静默高架'][e.tier]||'深渊裂谷 第 '+(e.tier-4)+' 段';
     title.textContent=p.name+' · '+(e.abyss?'深渊 ':'')+zone;
     const arrived=Number.isFinite(e.returnAt)&&e.returnAt<=clock;
     status.textContent=p.deadAt!==null?'已倒下':arrived?'到家了':'返程中';row.append(title,status);
     if(p.deadAt!==null)button(row,'花 100 废料救回（自动返程）',{type:'revive',residentId:p.id});
     else if(arrived)button(row,'领取',{type:'explore_claim',explorerId:e.id});
     else button(row,'召回',{type:'explore_recall',explorerId:e.id});root.querySelector('ul').append(row);
   }
   const quests=document.createElement('section');quests.innerHTML='<h2>本周废土任务</h2>';
   for(const q of s.quests||[])button(quests,'领取',{type:'quest_claim',runId:q.id});content.append(quests);
 } else if(sm.tab==='居民'){
   const root=document.createElement('section');root.innerHTML='<h2>居民 '+s.residents.length+'/20</h2><label>筛选<select><option value="all">全部</option><option value="idle">闲着</option></select></label><ul></ul>';
   const filter=root.querySelector('select');filter.value=sm.filter;filter.onchange=()=>{sm.filter=filter.value;renderShelter();};
   for(const p of s.residents.filter(p=>sm.filter==='all'||p.roomId===null)){
     const li=document.createElement('li'),b=document.createElement('button');b.textContent=p.name+' · '+Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))+' 级 · 闲着 力3 敏3';b.onclick=()=>openResident(p.id);li.append(b);root.querySelector('ul').append(li);
   }content.append(root);
 } else if(sm.tab==='目标'){
   const daily=document.createElement('section');daily.innerHTML='<h2>今日目标</h2><ul></ul>';
   for(let index=0;index<3;index++){
     const row=document.createElement('li');row.innerHTML='<div><p>今日目标 '+index+' 1/1</p><p>奖励 160 废料 · 1 零件 · 30 赛季积分</p></div>';
     button(row,s.daily.claimed.includes(index)?'已领':'领取',{type:'claim_objective',index},s.daily.claimed.includes(index)||sm.dailyIncomplete);daily.lastChild.append(row);
   }content.append(daily);
   const tiers=Array.from({length:Math.min(30,Math.floor(s.season.points/150))},(_,i)=>i+1).filter(i=>!s.season.claimedFree.includes(i));
   const free=button(content,'领取免费档（'+tiers.length+'）',{type:'unused'},!tiers.length);
   free.onclick=async()=>{for(const tier of tiers)if(!await shelterAct({type:'claim_season',tier,premium:false}))break;};
   button(content,'解锁通行证',{type:'buy_season_premium'});button(content,'领取通行证档（1）',{type:'claim_season',tier:1,premium:true});
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
