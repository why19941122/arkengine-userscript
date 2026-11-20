import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const coreSource=source.match(/^  function createSodaAuctionCore\(\) \{[^]*?^  }/m)[0];
const runtime=source.slice(source.indexOf("  const AUCTION_PREF="),source.indexOf('  function auctionPanel()'));
const now=Date.parse('2026-11-20T20:00:00+08:00');
function setup(){
  const storage=new Map(),reads=[],events=[];
  const context={clock:now,URL,location:{origin:'https://fixture.invalid',pathname:'/shelter'},
    document:{baseURI:'https://fixture.invalid/'},objectState:value=>value!==null&&typeof value==='object'&&!Array.isArray(value),
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    shadow:{getElementById:()=>({})},loadState:(store,key,fallback)=>JSON.parse(store.getItem(key)||'null')??fallback,
    PREF:'automation-enabled',enabled:true,active:true,pageFrozen:false,sharedGroupPaused:()=>false,accountStopReason:()=>'',stateFault:()=>'',
    inShelter:()=>true,auctionExclusive:true,schedule(){},captureShelterAction:null,continueShelterAction:null,
    captureStockAction:null,captureShelterCaravan:null,captureShelterHelp:null,
    log:{add:async(...args)=>{events.push(args);return true;}},
    createReadSession:()=>({fetch:async path=>{reads.push({path,at:context.clock});return {};},json:async()=>({}),close(){}})};
  context.Date=class extends Date{static now(){return context.clock;}};
  const api=vm.runInNewContext(coreSource+'\n'+runtime+`\n({
    core:auctionCore,read:auctionContext,receive:auctionObserveRead,observe:observeAuctionRequest,result:auctionRequestResult,
    get state(){return auctionState;},get work(){return auctionWindow;},get issue(){return auctionIssue;},
    restore(value){auctionSave(value);auctionWindow=null;},
    prepare(){const choice=auctionCore.decision(auctionView.model,auctionState,auctionBalance.tokens,Date.now());
      const pending={id:'pending-1',at:Date.now(),phase:'opening',vault:77,day:auctionCore.day(Date.now()),round:choice.round,batch:choice.batch,price:choice.price,signature:choice.signature};
      auctionSave({...auctionState,vault:77,day:pending.day,pending});auctionWindow={id:pending.id,confirming:true};return pending;
    }
  })`,context);
  const body={enabled:true,auction:{startsAt:'2026-11-20T20:00:00+08:00',endsAt:'2026-11-20T21:00:00+08:00',
    supply:18,sold:0,released:3,remaining:18,available:3,perUserDaily:10,boughtToday:0,live:true,price:399999,nextReleaseAt:'2026-11-20T20:10:00+08:00'}};
  let sequence=0;
  const refresh=()=>{
    api.receive('/api/shelter',++sequence,context.clock,200,{vaultNo:77});
    api.receive('/api/me/balance',++sequence,context.clock,200,{tokens:3000000});
    api.receive('/api/shelter/auction',++sequence,context.clock,200,body);
  };
  refresh();
  return {api,context,body,refresh,reads,events,
    request:()=>api.observe(['/api/shelter/auction',{method:'POST',body:JSON.stringify({quantity:1,maxUnitPrice:399999,idempotencyKey:'original-key-123'})}],context.clock)};
}
const drain=()=>new Promise(resolve=>setImmediate(resolve));

test('拍卖加固：每次上下文刷新包含行情，读间隔不跨过开拍时刻',async()=>{
  const state=setup();state.context.clock=now-1000;state.api.read();await drain();
  assert.equal(state.reads.filter(read=>read.path==='/api/shelter/auction').length,1);
  state.context.clock=now;state.api.read();await drain();
  assert.equal(state.reads.filter(read=>read.path==='/api/shelter/auction').length,2);
  state.context.clock=now+15000;state.api.read();await drain();
  assert.equal(state.reads.filter(read=>read.path==='/api/shelter/auction').length,3);
});

for(const reason of ['round','quote-age','balance','sold','price','quota'])test('拍卖加固：确认后发请求前重新核对 '+reason,()=>{
  const state=setup();state.api.prepare();
  if(reason==='round'){state.context.clock+=600000;state.body.auction.released=6;state.refresh();}
  if(reason==='quote-age')state.context.clock+=21000;
  if(reason==='balance')state.api.receive('/api/me/balance',50,state.context.clock,200,{tokens:0});
  if(reason==='sold'){state.body.auction.available=0;state.refresh();}
  if(reason==='price'){state.body.auction.price=400000;state.refresh();}
  if(reason==='quota'){state.body.auction.boughtToday=10;state.refresh();}
  assert.throws(()=>state.request());assert.notEqual(state.api.state.pending?.phase,'submitted');
});

test('拍卖加固：有效原请求先持久保存，迟到或重复成功回执只计一次',async()=>{
  const state=setup(),pending=state.api.prepare(),receive=state.request();
  assert.equal(state.api.state.pending.key,'original-key-123');assert.equal(state.api.work.sent,true);
  receive(200,{quantity:1,unitPrice:390000});receive(200,{quantity:1,unitPrice:390000});await drain();
  assert.equal(state.api.state.pending,null);
  assert.equal(state.events.filter(event=>event[0]==='soda-auction-bought').length,1);
  assert.ok(state.api.state.rounds.includes(pending.round));
  assert.ok(state.api.state.rounds.includes(pending.batch));
});

test('拍卖加固：发送前暂停、冻结或失去锁不提交',()=>{
  for(const reason of ['enabled','active','pageFrozen']){
    const state=setup();state.api.prepare();state.context[reason]=reason==='pageFrozen';
    assert.throws(()=>state.request());assert.equal(state.api.state.pending.phase,'opening');
  }
});

test('拍卖加固：旧版未知原单迟到成交按原轮次防重，不占用下一轮',async()=>{
  const state=setup(),pending=state.api.prepare(),startsAt=Date.parse(state.body.auction.startsAt);
  state.api.restore({...state.api.state,pending:{...pending,round:`${startsAt}:3`,batch:undefined,phase:'submitted',key:'old-request-123'}});
  state.context.clock+=600000;state.body.auction.released=6;state.refresh();
  state.api.result(pending.id,200,{quantity:1,unitPrice:399999});await drain();
  assert.ok(state.api.state.rounds.includes(`${startsAt}:slot:0`));
  assert.ok(state.api.state.rounds.includes(`${startsAt}:3`));
  assert.equal(state.api.core.decision(state.api.core.model(state.body),state.api.state,2600001,state.context.clock).kind,'buy');
  assert.equal(state.api.core.decision(state.api.core.model(state.body),state.api.state,2600001,now+1000).kind,'wait');
});

for(const mode of ['throw','silent'])test('拍卖加固：订单持久保存失败时不放行原生请求 '+mode,()=>{
  const state=setup();state.api.prepare();
  state.context.localStorage.setItem=()=>{if(mode==='throw')throw Error('fixture storage failure');};
  assert.throws(()=>state.request());
  assert.equal(state.api.state.pending.phase,'opening');assert.notEqual(state.api.work.sent,true);
});
