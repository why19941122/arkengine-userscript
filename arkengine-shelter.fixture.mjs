import { farmMarkup } from './arkengine-farm.fixture.mjs';

// 2026-11-03 公开前端的原生按钮/页签结构；只在本机模拟，不使用真实账户。
export const shelterMarkup = farmMarkup + `<script>
window.sm = { tab:'避难所', reads:0, calls:[], busy:false, mode:'success', tutorial:true,
  view:{ vaultNo:77, serverTime:clock, progress:{level:2}, switches:{frozen:false}, nameRequired:false,
    env:{events:[]}, state:{lastSettledAt:clock, resources:{power:100,food:100,water:100,scrap:269,parts:0,stimpak:0},
      stats:{collected:0}, legacy:{perks:{}}, items:[], births:[], achievements:[],
      tutorial:{claimed:[]}, daily:{day:'2026-10-10',claimed:[]}, season:{month:'2026-10',points:0,claimedFree:[]},
      rooms:[{id:1,type:'scrap',width:1,level:1,stored:30,builtAt:0,upgradeAt:null,incident:null,unpowered:false}],
      residents:[{id:1,roomId:1,away:null,deadAt:null,adultAt:0,xp:0,happiness:100,outfitId:null,
        stats:{str:3,per:3,end:5,cha:3,int:3,agi:3,lck:3},romance:null,familyCooldownUntil:0}] } } };
const farmFetch=window.fetch;
window.shelterData=()=>({...structuredClone(sm.view),serverTime:clock});
window.fetch=async (url,options)=>{
 if(url==='/api/shelter'){
   sm.reads++; if(sm.deferRead)return new Promise(resolve=>{sm.resolveRead=()=>resolve(new Response(JSON.stringify(shelterData())));});
   if(sm.readError)throw new TypeError('fixture network');
   return new Response(JSON.stringify(shelterData()),{status:sm.httpStatus||200});
 }
 if(url==='/api/shelter/action'&&options?.method==='POST'){
   const a=JSON.parse(options.body);sm.calls.push(a);
   if(sm.mode==='unknown')return new Promise(()=>{});
   if(sm.mode==='error'||sm.mode==='partial'&&a.type==='claim_season'&&a.tier>1)return new Response('{}',{status:503});
   const s=sm.view.state;
   if(a.type==='collect_all'||a.type==='collect'){
     const types={scrap:['scrap',30],power:['power',30],diner:['food',25],water:['water',25],medbay:['stimpak',2],workshop:['parts',3]};
     for(const room of s.rooms.filter(r=>a.type==='collect_all'||r.id===a.roomId)){
       const def=types[room.type];if(!def)continue;
       const batch=def[1]*room.width*[0,1,1.5,2.1][room.level],amount=Math.floor(room.stored/batch+1e-9)*batch;
       room.stored-=amount;s.resources[def[0]]+=amount;s.stats.collected+=amount;
     }
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
window.shelterAct=async a=>{
 if(sm.busy)throw Error('重复避难所请求');sm.busy=true;renderShelter();
 const r=await fetch('/api/shelter/action',{method:'POST',body:JSON.stringify({...a,idempotencyKey:'fixture-key'})});
 sm.busy=false;if(location.pathname==='/shelter')renderShelter();return r.ok;
};
window.renderShelter=()=>{
 const s=sm.view.state;document.getElementById('fixture-resources')?.remove();
 game.innerHTML='<h1>方舟避难所</h1><a href="/activities/expedition">远征</a><div role="tablist" aria-label="避难所"></div><div id="shelter-content"></div>';
 game.querySelector('a').onclick=e=>{e.preventDefault();navFarm('/activities/expedition');};
 const tabs=game.querySelector('[role="tablist"]'),content=game.querySelector('#shelter-content');
 for(const label of ['避难所','目标','图鉴','居民','废土']){
   const b=document.createElement('button');b.setAttribute('role','tab');b.setAttribute('aria-selected',String(sm.tab===label));b.textContent=label;
   b.onclick=()=>{sm.tab=label;renderShelter();};tabs.append(b);
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
