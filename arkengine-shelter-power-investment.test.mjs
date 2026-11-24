import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {powerInvestmentScene as unbackedPowerInvestmentScene,setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function powerInvestmentScene(){
  const f=unbackedPowerInvestmentScene(),s=f.view.state;
  // Isolate funded infrastructure after three recorded children have real jobs.
  // Keep current power above its reserve but below the proposed upgrade's need.
  s.rooms.push({...s.rooms.find(r=>r.type==='scrap'),id:9000,floor:10,col:2,width:2,level:1,stored:0});
  s.residents.find(p=>p.roomId===5&&p.stats.str<10).stats.str++;
  return f;
}
const setup=(seed=powerInvestmentScene(),mode)=>setupPowerInvestment(source,seed,mode);

test('补电投资前置：原快照儿童缺岗时先建设就业岗位，不越过已承诺人口去追等级',()=>{
  const x=setup(unbackedPowerInvestmentScene()),{campaign,development}=x.plan();
  assert.equal(campaign.futureEmployment.missing.length,3);
  assert.equal(development.next.project.kind,'build');assert.equal(development.next.project.type,'scrap');
  assert.equal(development.next.project.employment,true);
});

test('补电投资：现有电站一步可补足时，先打通生产房升级，不攒钱连续挖探险位',()=>{
  const x=setup(),before=JSON.stringify(x.f),{m,development:d}=x.plan(),p=d.next.project;
  assert.equal(p.kind,'upgrade');assert.equal(p.id,9);assert.equal(p.levelGain,3);
  assert.equal(p.cost.scrap,1440);assert.equal(p.cost.parts,45);assert.equal(d.next.status,'blocked');
  assert.equal(p.powerStaffing.scrapLoss,0);assert.ok(p.powerStaffing.netScrapGain>25);
  assert.ok(p.powerStaffing.digSavingHours>p.hours+1/6,'原下挖光攒料就比这次施工加检查窗口更久');
  assert.equal(x.api.construction(m),null,'补电只是前提，不能缺电开工');
  const move=x.api.staff(m);assert.equal(move.id,p.powerStaffing.id);assert.equal(move.room,5);
  assert.equal(JSON.stringify(x.f),before,'规划不能假装已经调岗或付款');
  x.f.view.state.residents.find(p=>p.id===move.id).roomId=move.room;
  const updated=x.plan(),build=x.api.construction(updated.m);
  assert.ok(build);assert.equal(build.kind,'upgrade');assert.ok(['diner','water','scrap'].includes(build.type));
  assert.ok(build.cost.scrap+6*build.cost.parts<4353);
  assert.equal(x.api.staff(updated.m),null,'补电后不能立即抽回同一工人');
  assert.ok(updated.m.production.food>=41*1.2&&updated.m.production.water>=41*1.2);
});
test('补电投资：原始历史快照不再预留训练返岗，空岗仍须核对实际工程用途',()=>{
  const seed=JSON.parse(readFileSync(new URL('./arkengine-shelter-latest-maintenance.fixture.json',import.meta.url),'utf8'));
  const x=setup(seed),{campaign,development}=x.plan();
  assert.equal(campaign.trainingDestinations.length,0);
  assert.ok(!development.next.project?.powerStaffing);
});
test('补电投资：预算、保留量、材料、暂停、未决操作与无安全人手不允许提出补电支线',()=>{
  for(const change of ['budget','parts','reserve','disabled','hold','pending','injured','full','supply','parents','construction']){
    const x=setup(),s=x.f.view.state;
    if(change==='budget')x.context.shelterConstruction.scrapLimit=100;
    if(change==='parts')s.resources.parts=0;
    if(change==='reserve')x.context.shelterConstruction.scrapReserve=s.resources.scrap;
    if(change==='disabled')x.context.shelterConstruction.upgrade=false;
    if(change==='hold')x.context.shelterStaffHold=true;
    if(change==='pending')x.context.shelterPending={id:'unknown',kind:'assign'};
    if(change==='injured')s.residents.filter(p=>p.roomId!==5).forEach(p=>p.hp=1);
    if(change==='full')s.residents.find(p=>p.id===41).roomId=5;
    if(change==='supply')s.resources.food=1;
    if(change==='parents')s.residents.forEach(p=>{p.parents=s.residents.map(q=>q.id);});
    if(change==='construction')s.rooms.filter(r=>['diner','water','scrap'].includes(r.type)).forEach(r=>r.upgradeAt=x.f.view.serverTime+3600000);
    assert.ok(!x.plan().development.next.project?.powerStaffing,change);
  }
});
test('补电投资：已确认备料不换目标，下一层直接解锁探险位也不被低价加分覆盖',()=>{
  const x=setup(),{m,campaign}=x.plan();
  const milestone=campaign.projects.find(p=>p.type==='elevator');assert.ok(milestone);
  milestone.milestone=m.state.depth+1;
  assert.ok(!x.api.development(m,50,campaign,10).next.project?.powerStaffing);
  campaign.materials={vaultNo:m.view.vaultNo,id:9,type:'scrap',level:3,targetLevel:10,finalTarget:10};
  const retained=x.api.development(m,50,campaign,10);
  assert.equal(retained.next.project.id,9);assert.ok(!retained.next.project.powerStaffing);
});
test('补电投资：下挖已经有钱或很快可攒齐时不因升级便宜而宣称更快',()=>{
  for(const scrap of [3518,10000]){
    const seed=powerInvestmentScene();seed.view.state.resources.scrap=scrap;
    const x=setup(seed),d=x.plan().development;
    assert.equal(d.next.project.kind,'dig');assert.ok(!d.next.project.powerStaffing);
  }
});
test('补电投资：不能抽原升级房工人或让补电损失吃掉回收净增产',()=>{
  const x=setup(),{m,campaign}=x.plan();
  const room=m.state.rooms.find(r=>r.id===9),allowed=new Set(m.state.residents.filter(p=>p.roomId===room.id).map(p=>p.id));
  campaign.reserved=m.state.residents.filter(p=>!allowed.has(p.id)).map(p=>p.id);
  const project={kind:'upgrade',id:9,type:'scrap',level:3};
  assert.equal(x.api.powerStaffing(m,project,campaign,x.api.growth(m).demand),null,'只有原回收房工人可调不成立');
  const donor=m.state.residents.find(p=>p.id===134);donor.stats.str=10;
  campaign.reserved=m.state.residents.filter(p=>p.id!==donor.id).map(p=>p.id);
  // Remove lower-output supply upgrades: isolate a tiny recycler whose gain is below this donor's loss.
  m.state.rooms.filter(r=>['diner','water'].includes(r.type)).forEach(r=>r.level=3);
  m.state.residents.filter(p=>p.roomId===9).forEach(p=>{p.stats.end=0;p.happiness=0;});
  const changed=x.api.model(x.f.view);
  assert.equal(x.api.powerStaffing(changed,project,campaign,x.api.growth(changed).demand),null,
    '补电常驻损失超过这个回收工程增量时必须拒绝');
});
test('补电投资：人口模式有可接替原家庭时先完成家庭，不因新增工程余量跳过家庭准备',()=>{
  const seed=powerInvestmentScene();
  // The isolated infrastructure seed had three adults in a two-seat training
  // room. Settle the extra adult into a real job before testing family priority.
  seed.view.state.residents.find(p=>p.id===115).roomId=9000;
  const x=setup(seed,'population'),{m}=x.plan(),move=x.api.staff(m);
  assert.match(move.reason,/原家庭.*净水/);assert.equal(move.room,7);
  assert.equal(move.id,65,'直接补水接替父母，不能抢先把41号调去准备等级工程');
});
