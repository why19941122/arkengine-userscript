import { crossFeatureMarkup } from './arkengine-cross-feature.fixture.mjs';
import { dungeonScript } from './arkengine-dungeon.fixture.mjs';

export const singlePageMarkup = crossFeatureMarkup + `<script>sessionStorage.removeItem('fixture:dungeon');(()=>{${dungeonScript}})();
window.cm={remaining:24,cooldownAt:0,calls:[],reads:0};
const renderDungeonPage=window.renderDun;
window.renderDun=()=>{
  renderDungeonPage();
  if(location.pathname==='/cultivate'){
    const seek=document.getElementById('seek');
    seek.disabled=cm.remaining===0||cm.cooldownAt>clock||dm.encounter;
    const seconds=Math.max(0,Math.ceil((cm.cooldownAt-clock)/1000));
    seek.textContent=cm.remaining===0?'今日奇遇次数已用完':seconds?'奇遇冷却 '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'寻找奇遇';
    if(cm.quotaLabel){const quota=document.createElement('p');quota.textContent='今日奇遇剩余 '+cm.remaining+'/24 次';game.append(quota);seek.textContent='寻找奇遇';}
    if(cm.unavailable){seek.disabled=true;seek.textContent='寻找奇遇';}
    seek.onclick=()=>{if(seek.disabled)throw Error('Unavailable encounter');cm.calls.push('seek');cm.remaining--;dm.encounter=true;renderDun();};
    const panel=document.getElementById('cultivation-encounter');
    if(panel){const choose=panel.onclick;panel.onclick=event=>{cm.calls.push('choose');cm.cooldownAt=clock+300000;choose(event);};}
    document.querySelector('[aria-label="刷新修炼状态"]').onclick=()=>{cm.reads++;renderDun();};
  }
  addUnifiedLinks();
};
window.addUnifiedLinks=()=>{
  for(const [path,label] of [['/activities/expedition','远征'],['/farm','农场'],['/shelter','避难所'],['/stock','股市'],['/cultivate','奇遇'],['/cultivate/dungeon','秘境'],['/cultivate/fog','迷雾']]){
    const link=document.createElement('a');link.href=path;link.textContent=label;
    link.onclick=event=>{event.preventDefault();navFarm(path);};game.append(link);
  }
};
window.renderFeature=()=>{
  if(location.pathname==='/cultivate/fog'){game.innerHTML='<button id="fog-start">进入迷雾</button>';document.getElementById('fog-start').onclick=()=>cm.calls.push('fog');return;}
  if(location.pathname.startsWith('/cultivate')){renderDun();return;}
  if(location.pathname==='/stock')renderStock();else if(location.pathname==='/shelter')renderShelter();
  else if(location.pathname==='/farm')renderFarm();else renderExp();
  addUnifiedLinks();
};
window.goDun=path=>navFarm(path);
renderFeature();
</script>`;
