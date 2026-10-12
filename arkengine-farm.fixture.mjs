import { expeditionMarkup } from './arkengine-expedition.fixture.mjs';

// 同一文档中模拟农场与远征的 SPA 导航；所有请求、资源消耗都留在本机。
export const farmMarkup = expeditionMarkup + `<script>
const realFixtureTimeout = window.setTimeout.bind(window);
window.fm = {
  crops: [], stamina: 100, nextRegen: 240, inventory: {}, prices: {}, calls: [], reads: 0,
  tab:'plots', view:'scene', all:false, busy:false, filter:'0', result:'success', requestError:false,
  message:'', error:false, date:clock, harvestStale:false
};
window.fc = [
 ['小麦',12,6,1.81],['胡萝卜',24,6,3.56],['番茄',48,7,6.14],['玉米',96,8,7.91],
 ['草莓',192,8,16.35],['南瓜',288,9,22.47],['蓝莓',288,12,16.67],['葡萄',432,10,21.73],
 ['黄金苹果',576,10,23.1],['西瓜',576,12,24.13],['可可豆',864,14,28.76],['星辉果',1152,15,33.31]
].map(([name,minutes,yieldQuantity,price],index)=>({name,minutes,yieldQuantity,price,key:'crop-'+index,id:index+1}));
fc.forEach(c=>{fm.inventory[c.key]=100;fm.prices[c.id]=c.price;});
window.farmData=()=>({
 userId:77, seeds:fc.map(c=>({...c,growSeconds:c.minutes*60*2.5,minSoilLevel:0})),
 prices:fc.map(c=>({seedId:c.id,priceMilli:Math.round(fm.prices[c.id]*1000)})),
 plots:Array.from({length:12},(_,plotIndex)=>({plotIndex,growthPct:20,yieldPct:10})),
 crops:fm.crops.map(c=>({plotIndex:c.plot-1,maturesAt:new Date(c.at).toISOString(),seedKey:c.key})),
 stamina:{current:fm.apiStamina??fm.stamina,max:100,regenMinutes:4,nextRegenSeconds:fm.nextRegen},
 staminaCosts:{plant:1,harvest:1},inventory:fc.map(c=>({seedKey:c.key,quantity:fm.inventory[c.key]})),
 seedPouch:{},soilLevel:10,growthMultiplier:.5,growSpeedMultiplier:1
});
window.fetch=async (url,options)=>{
 if(url!=='/api/farm' || options?.method && options.method!=='GET') throw Error('意外的请求: '+url);
 fm.reads++;fm.calls.push({type:'read',prices:{...fm.prices}});
 if(fm.requestError) throw Error('fixture network failure');
 return new Response(JSON.stringify(farmData()),{status:fm.httpStatus||200,headers:{'Content-Type':'application/json'}});
};
window.closeSeeds=()=>{document.querySelector('[role="dialog"]')?.remove(); game.removeAttribute('inert');game.removeAttribute('aria-hidden');};
window.openSale=()=>{
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
 dialog.innerHTML='<h2>卖出作物</h2><p>报价 9,999 代币，最终以实际到账为准</p><button>获取报价</button><button>确认卖出</button>';
 dialog.querySelectorAll('button')[0].onclick=()=>fm.calls.push({type:'quote'});
 dialog.querySelectorAll('button')[1].onclick=()=>{
   fm.calls.push({type:'sell'});fm.message='';renderFarm();
   realFixtureTimeout(()=>{
     fm.message=fm.saleMessage||'卖出成功，实际获得 123.5 代币（产出系数 80%）';
     fm.error=!!fm.saleError;closeSeeds();renderFarm();
   },30);
 };
 document.body.append(dialog);game.setAttribute('inert','');game.setAttribute('aria-hidden','true');
};
window.finishPlant=()=>{
 const pending=fm.pendingPlant;
 if(!pending) throw Error('没有待完成的种植');
 const c=fc.find(c=>c.key===pending.key);
 fm.stamina-=pending.plots.length;fm.inventory[c.key]-=pending.plots.length;
 pending.plots.forEach(plot=>fm.crops.push({plot,key:c.key,name:c.name,at:clock+c.minutes*60000}));
 fm.pendingPlant=null;fm.busy=false;fm.message='种下了 '+pending.plots.length+' 块';
 closeSeeds();renderFarm();
};
window.plantFarm = c=>{
 if(fm.busy) throw Error('重复种植请求');
 const empty=Array.from({length:12},(_,i)=>i+1).filter(plot=>!fm.crops.some(c=>c.plot===plot));
 const target=fm.all?empty:empty.slice(0,1);
 if(fm.stamina<target.length || fm.inventory[c.key]<target.length) throw Error('资源不足');
 fm.calls.push({type:'plant',name:c.name,count:target.length,at:clock}); fm.busy=true;
 fm.pendingPlant={key:c.key,plots:target};
 // 与网站一致：种植请求结束后才关闭窗口；处理中仍可手动关闭。
 document.querySelectorAll('#seed-buttons button').forEach(b=>b.disabled=true);
 renderFarm();
 if(fm.result==='pending') return;
 realFixtureTimeout(finishPlant,30);
};
window.openSeeds=()=>{
 fm.calls.push({type:'open'});fm.all=false;
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
 dialog.innerHTML='<h2>选择种子</h2><button aria-label="关闭">关闭</button><button id="all-plots"></button><label>希望多久内收获<select><option value="0">不限</option><option value="1">1小时</option></select></label><div id="seed-buttons"></div>';
 const update=()=>{
  const empty=12-fm.crops.length;
  const all=dialog.querySelector('#all-plots');all.textContent=fm.all?'种满全部 '+empty+' 块空地':'只种这一块（点此改为种满 '+empty+' 块）';all.setAttribute('aria-pressed',String(fm.all));
  dialog.querySelector('select').value=fm.filter;
  const container=dialog.querySelector('#seed-buttons');container.innerHTML='';
  for(const c of fc.filter(c=>fm.filter==='0'||c.minutes<=60)){
    const b=document.createElement('button');
    const quantity=c.yieldQuantity*1.1;
    const yieldText=Number.isInteger(quantity)?quantity:Math.floor(quantity)+'~'+Math.ceil(quantity)+'（均值 '+quantity.toFixed(1)+'）';
    const duration=c.minutes<60?c.minutes+'分':Math.floor(c.minutes/60)+'时'+c.minutes%60+'分';
    b.innerHTML='<img alt=""><div><div><span class="font-semibold">'+c.name+'</span><span>免费 · 存货 '+fm.inventory[c.key]+'</span></div><p>预计 '+duration+' 成熟（已含当前地块加速） · 预计产量 '+yieldText+' · 基准价 999</p></div><span title="种植消耗 1 体力">1</span>';
    b.onclick=()=>plantFarm(c);container.append(b);
    const pin=document.createElement('button');pin.textContent='☆';pin.setAttribute('aria-label','置顶'+c.name);pin.onclick=()=>fm.calls.push({type:'pin'});container.append(pin);
  }
 };
 dialog.querySelector('#all-plots').onclick=()=>{fm.all=!fm.all;update();};
 dialog.querySelector('select').onchange=e=>{fm.filter=e.target.value;update();};
 dialog.querySelector('[aria-label="关闭"]').onclick=closeSeeds;
 update();document.body.append(dialog);game.setAttribute('inert','');game.setAttribute('aria-hidden','true');
};
window.harvestFarm=()=>{
 if(fm.busy) throw Error('重复收获请求');
 const ready=fm.crops.filter(c=>c.at<=clock);
 if(fm.stamina<ready.length) throw Error('收获体力不足');
 fm.calls.push({type:'harvest',count:ready.length});fm.busy=true;renderFarm();
 if(fm.result==='pending') return;
 realFixtureTimeout(()=>{
   fm.stamina-=ready.length;fm.crops=fm.crops.filter(c=>!ready.includes(c));
   ready.forEach(c=>fm.inventory[c.key]+=10);fm.busy=false;fm.message='收获了 '+ready.length+' 块';renderFarm();
 },30);
};
window.navFarm=path=>{fm.calls.push({type:'navigate',path});history.pushState({},'',path);if(path==='/farm')renderFarm();else renderExp();};
window.addFarmLink=()=>{
 const a=document.createElement('a');a.href='/farm';a.textContent='农场';a.onclick=e=>{e.preventDefault();navFarm('/farm');};game.prepend(a);
};
const originalRenderExp=window.renderExp;
window.renderFarmHeader=()=>{
 document.getElementById('fixture-resources')?.remove();
 const header=document.createElement('header');header.id='fixture-resources';
 header.innerHTML='<div role="group" aria-label="我的资源"><span role="group" aria-label="体力 '+(fm.headerStamina??fm.stamina)+'/100，每 4 分钟恢复 1 点"><span>'+(fm.headerStamina??fm.stamina)+'</span><span>/100</span></span></div>';
 document.body.prepend(header);
};
window.renderExp=()=>{originalRenderExp();addFarmLink();renderFarmHeader();};
window.renderFarm=()=>{
 renderFarmHeader();
 const ready=fm.crops.filter(c=>c.at<=clock);
 game.innerHTML='<a href="/activities/expedition">远征</a><div role="tablist" aria-label="农场功能"><button role="tab">田地</button><button role="tab">交易所</button></div><span title="每 4 分钟自然恢复 1 点体力">体力 '+fm.stamina+'/100（'+Math.floor(fm.nextRegen/60)+':'+String(fm.nextRegen%60).padStart(2,'0')+' 恢复 1 点）</span>';
 game.querySelector('a').onclick=e=>{e.preventDefault();navFarm('/activities/expedition');};
 game.querySelectorAll('[role="tab"]').forEach((b,i)=>{b.setAttribute('aria-selected',String(fm.tab===(i?'market':'plots')));b.onclick=()=>{fm.tab=i?'market':'plots';renderFarm();};});
 if(fm.message){const p=document.createElement('div');p.setAttribute('role','status');p.className=fm.error?'bg-destructive':'text-primary';p.textContent=fm.message;game.append(p);}
 if(fm.tab!=='plots')return;
 const timeline=document.createElement('details');
 timeline.innerHTML='<summary>全场成熟时间轴 · '+ready.length+' 块可收获 / '+fm.crops.length+' 块种植中</summary><ol></ol>';
 fm.crops.forEach(c=>{
  const li=document.createElement('li');li.innerHTML='<span>'+c.plot+' 号地 · '+c.name+'<time datetime="'+new Date(c.at).toISOString()+'">'+(c.at<=clock?'已成熟':'10/10 16:00 · 生长中')+'</time></span><button>收获 · 1 体力</button>';
  li.querySelector('button').disabled=true;timeline.querySelector('ol').append(li);
 });game.append(timeline);
 if(ready.length){const b=document.createElement('button');b.textContent='一键收获 ('+ready.length+')';b.disabled=fm.busy||fm.harvestStale;b.onclick=harvestFarm;game.append(b);}
 const plots=document.createElement(fm.view==='compact'?'section':'div');
 if(fm.view==='compact')plots.setAttribute('aria-label','紧凑经营视图');
 for(let i=1;i<=12;i++)if(!fm.crops.some(c=>c.plot===i)){
  const b=document.createElement('button');
  if(fm.view!=='compact')b.setAttribute('aria-label','空地块，点击种植');
  b.textContent=fm.view==='compact'?'选择种子':'点击种植';b.disabled=fm.busy;b.onclick=openSeeds;plots.append(b);
 }game.append(plots);
 const other=document.createElement('button');other.textContent='升级地块';other.onclick=()=>fm.calls.push({type:'upgrade'});game.append(other);
};
if(location.pathname==='/farm')renderFarm();else renderExp();
</script>`;
