import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const core=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const now=Date.parse('2026-11-20T12:00:00+08:00');
const config={trade:true,predict:false,newBuy:false};
function fixture(){
  const view={userId:77,enabled:true,stocks:[{id:1,modelName:'停滞旧仓',priceCents:1000,volume24h:100,stale:true}],
    positions:[{stockId:1,shares:100,costBasisTokens:1000,holdUntil:null}],ticks:[],rounds:[],myBets:[],
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000}};
  return {model:core.model(view,{tokens:10000}),ledger:{userId:77,hold:false,pending:null,entries:[],owned:{'1':{shares:100,cost:1000,modelName:'停滞旧仓',manual:false}}}};
}
test('股市空转：停滞旧仓无变化按5、15、30分钟退避，刷新保留，价格变化恢复5分钟',()=>{
  const {model,ledger}=fixture();let at=now;
  for(const delay of [300000,900000,1800000,1800000]){
    const before=JSON.stringify(ledger),next=core.idleRecheck(model,config,ledger,at);
    assert.equal(next.delay,delay);assert.equal(JSON.stringify(ledger),before);
    ledger.idleCheck=JSON.parse(JSON.stringify(next));at+=delay;
  }
  model.view.stocks[0].priceCents=1010;
  assert.equal(core.idleRecheck(model,config,ledger,at).delay,300000);
  assert.equal(core.idleRecheck(model,config,ledger,now-1).delay,300000);
});
test('股市空转：未决原单、结算、人工持仓与观察模式不降频',()=>{
  for(const change of [state=>state.ledger.pending={id:'pending'},state=>state.ledger.hold=true,
    state=>state.ledger.periodRequest={},state=>state.ledger.accountingWait='unconfirmed',
    state=>state.ledger.entries.push({result:'reserved'}),state=>state.ledger.entries.push({action:'predict',result:'success'}),
    state=>state.ledger.owned['1'].manual=true,state=>state.ledger.userId=88,
    state=>state.model.view.positions[0].shares++,state=>state.model.view.stocks[0].stale=false,
    state=>state.model.view.stocks[0].suspended=true,state=>state.model.view.enabled=false,
    state=>state.model.view.positions[0].holdUntil=new Date(now+60000).toISOString()]){
    const state=fixture();change(state);assert.equal(core.idleRecheck(state.model,config,state.ledger,now),null);
  }
  const {model,ledger}=fixture();
  for(const change of [{observeOnly:true},{newBuy:true},{predict:true},{trade:false}])
    assert.equal(core.idleRecheck(model,{...config,...change},ledger,now),null);
});
test('股市空转：可盈利兑现或触发止损时不降频，仍按原退出规则卖出',()=>{
  for(const price of [1027,900]){
    const {model,ledger}=fixture();model.view.stocks[0].priceCents=price;
    assert.equal(core.idleRecheck(model,config,ledger,now),null);
    assert.equal(core.choose(model,config,ledger,now)?.action,'sell');
  }
});
test('股市空转：无脚本持仓且无网页持仓时每小时核对，未知人工仓仍需正常核对',()=>{
  const {model,ledger}=fixture();ledger.owned={};model.view.positions=[];
  assert.equal(core.idleRecheck(model,config,ledger,now).delay,3600000);
  model.view.positions=[{stockId:2,shares:1}];assert.equal(core.idleRecheck(model,config,ledger,now),null);
});
