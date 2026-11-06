import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  function shelterCanIsolateDefense('),source.indexOf('  function shelterPendingWait('));
const api=vm.runInNewContext(code+'\n({ready:shelterCanIsolateDefense,allows:shelterIndependentDefense})');
const pending=(extra={})=>({id:'original',kind:'collect',targets:['all'],at:1000,vaultNo:77,before:{serverTime:1000},
  result:{status:503,outcome:'http-error',responseFinishedAt:2000},...extra});
const model=()=>({now:3000,view:{vaultNo:77,switches:{frozen:false},nameRequired:false},state:{resources:{stimpak:5},rooms:[
  {id:90,type:'door',incident:{kind:'raiders'}},{id:4,type:'scrap',floor:1,col:3,width:1,incident:null}]}});
const defense={kind:'assign',role:'defense',id:2,room:90};

test('隔离防守凭据：正文读取结束且后发快照才能放行，旧记录、在途和网络中断不猜结束',()=>{
  const p=pending(),m=model();assert.equal(api.ready(p,m,2000),true);
  for(const result of [null,{status:503,outcome:'http-error'},
    {...p.result,responseFinishedAt:999},{...p.result,status:null,outcome:'network-error'},
    {...p.result,status:200,outcome:'login-redirect'}])assert.equal(api.ready({...p,result},m,3000),false);
  assert.equal(api.ready(p,m,1999),false);assert.equal(api.ready(p,m,undefined),false);
  for(const status of [401,403,429])assert.equal(api.ready({...p,result:{...p.result,status}},m,3000),false);
});
test('隔离防守身份：跨避难所、过时服务端快照、冻结及未命名均不能发送',()=>{
  const p=pending();
  for(const change of [m=>m.view.vaultNo=78,m=>m.now=999,m=>m.view.switches.frozen=true,m=>m.view.nameRequired=true]){
    const m=model();change(m);assert.equal(api.allows(p,defense,m,{reserve:2},3000),false);
  }
});
test('隔离防守人员：原调岗、装备、用针、探险和小队涉及者不被另一动作接管',()=>{
  const m=model(),cfg={reserve:2};
  const cases=[['assign',[2,4],{}],['equip',[2,99],{}],['stimpak',[2],{}],['explore-start',[2,0,2],{}],
    ['explore',[11,2],{}],['explore-recall',[11],{campaign:{choice:{id:2}}}],
    ['quest-start',['w1',1,2],{}],['quest-claim',[42],{campaign:{choice:{team:[1,2]}}}]];
  for(const [kind,targets,before] of cases){
    const p=pending({kind,targets,before:{serverTime:1000,...before}});
    assert.equal(api.allows(p,defense,m,cfg,3000),false,kind);
    assert.equal(api.allows(p,{...defense,id:3},m,cfg,3000),true,kind);
  }
  assert.equal(api.allows(pending({kind:'quest-claim',targets:[42]}),defense,m,cfg,3000),false);
});
test('隔离防守资源：未知用针和探险携针继续预留，不拿同一份针补第二笔',()=>{
  const m=model(),heal={kind:'stimpak',role:'medical',id:2};
  const p=pending({kind:'explore-start',targets:[1,0,2]});
  assert.equal(api.allows(p,heal,m,{reserve:2},3000),true);
  m.state.resources.stimpak=4;assert.equal(api.allows(p,heal,m,{reserve:2},3000),false);
  assert.equal(api.allows(p,defense,m,{reserve:2},3000),true,'针数不影响独立调岗');
  const needle=pending({kind:'stimpak',targets:[1]});
  assert.equal(api.allows(needle,heal,m,{reserve:2},3000),true);
  m.state.resources.stimpak=3;assert.equal(api.allows(needle,heal,m,{reserve:2},3000),false);
});
test('隔离防守复岗：未知升级或相邻合并目标仍等待，其他原岗位可以恢复',()=>{
  const m=model();m.state.rooms[0].incident=null;const release={...defense,role:'defense-release',room:4};
  assert.equal(api.allows(pending({kind:'upgrade',targets:[4]}),release,m,{reserve:2},3000),false);
  const build=pending({kind:'build',targets:['scrap',1,4],before:{serverTime:1000,construction:{project:{type:'scrap',floor:1,col:4}}}});
  assert.equal(api.allows(build,release,m,{reserve:2},3000),false);
  assert.equal(api.allows(build,{...release,room:null},m,{reserve:2},3000),true);
  assert.equal(api.allows(pending(),release,m,{reserve:2},3000),true);
});
test('隔离防守范围：赛季未发完不能让位，普通任务和无来袭治疗不能混入',()=>{
  const m=model(),cfg={reserve:2};
  assert.equal(api.allows(pending({kind:'season',targets:[1,2],sentCount:1}),defense,m,cfg,3000),false);
  assert.equal(api.allows(pending({kind:'season',targets:[1,2],sentCount:2}),defense,m,cfg,3000),true);
  for(const c of [{...defense,role:'workshop'},{...defense,kind:'equip'},{kind:'collect',targets:['all']},
    {...defense,room:999}])assert.equal(api.allows(pending(),c,m,cfg,3000),false);
  assert.equal(api.allows(pending({kind:'unknown-new-action'}),defense,m,cfg,3000),false);
  m.state.rooms[0].incident=null;
  assert.equal(api.allows(pending(),{kind:'stimpak',role:'medical',id:2},m,cfg,3000),false);
});
