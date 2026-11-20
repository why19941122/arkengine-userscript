import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const selectSeed=source.match(/^  function bestFarmSeed\([^]*?^  }/m)[0];
function setup(plantingSource='safe',count=3) {
  const seeds=Array.from({length:count},(_,index)=>({id:index+1,key:`crop-${index}`,name:`作物${index}`,growSeconds:3600,yieldQuantity:10}));
  const data={seeds,prices:seeds.map(seed=>({seedId:seed.id,priceMilli:1000})),
    crops:[],plots:[{plotIndex:0,growthPct:0,yieldPct:0}],stamina:{current:10,regenMinutes:4},seedPouch:{},
    inventory:seeds.map(seed=>({seedKey:seed.key,quality:'normal',quantity:10}))};
  const buttons=seeds.map(seed=>({textContent:'免费 · 存货 10',querySelector(selector){
    return selector==='span.font-semibold'?{textContent:seed.name}:{title:'种植消耗 1 体力'};
  }}));
  const labels=plantingSource===null?[]:[{textContent:'种源与品质',querySelector:()=>({value:plantingSource})}];
  const dialog={querySelectorAll:selector=>selector==='label'?labels:buttons};
  const context={farmMarket:{data},farmCrop:'auto',usable:()=>true,textOf:element=>element?.textContent||''};
  const choose=vm.runInNewContext(selectSeed+'\nbestFarmSeed',context);
  return {data,context,buttons,choose:()=>choose(dialog,{entries:[],empty:[{}],total:1})};
}

test('农场选种：当前种源分别核对品质与种子袋，库存不足不点击',()=>{
  const scenarios=[['safe','normal',0,true],['safe','rare',0,false],['safe','rare',1,true],
    ['normal','normal',0,true],['normal','fine',1,false],['fine','fine',0,true],['fine','rare',1,false],
    ['rare','rare',0,true],['rare','fine',1,false],['shop','normal',1,false],
    ['auto','rare',0,true],['inventory','fine',0,true],[null,'rare',0,true]];
  for(const [mode,quality,pouch,allowed] of scenarios) {
    const state=setup(mode,1);state.data.inventory[0].quality=quality;state.data.seedPouch['crop-0']=pouch;
    assert.equal(Boolean(state.choose().button),allowed,JSON.stringify({mode,quality,pouch}));
  }
});

test('农场选种：最高收益与同收益顺序保持，指定作物不被自动替换',()=>{
  const state=setup();assert.equal(state.choose().name,'作物0');
  state.data.prices[2].priceMilli=2000;assert.equal(state.choose().name,'作物2');
  state.context.farmCrop='作物1';assert.equal(state.choose().name,'作物1');
  state.data.inventory[1].quantity=0;assert.match(state.choose().error,/免费存货不足/);
});

test('农场选种：同名种子、缺价与地块变化仍不猜测',()=>{
  for(const mode of ['duplicate','price','plot']) {
    const state=setup();
    if(mode==='duplicate')state.data.seeds.push({...state.data.seeds[0],id:30});
    if(mode==='price')state.data.prices=[];
    if(mode==='plot')state.data.crops.push({plotIndex:0});
    assert.equal(state.choose().button,undefined,mode);
    assert.ok(state.choose().error,mode);
  }
});

test('农场精简：每轮库存和作物目录各遍历一次，作物增加不重复全表匹配',testContext=>{
  const state=setup('safe',80),counts={inventory:0,seeds:0};
  for(const [field,key] of [['inventory','seedKey'],['seeds','name']]) {
    for(const item of state.data[field]) {
      const value=item[key];Object.defineProperty(item,key,{get(){counts[field]++;return value;}});
    }
  }
  assert.equal(state.choose().name,'作物0');
  testContext.diagnostic(JSON.stringify(counts));
  assert.ok(counts.inventory<=160,`inventory reads: ${counts.inventory}`);
  assert.ok(counts.seeds<=240,`seed name reads: ${counts.seeds}`);
});
