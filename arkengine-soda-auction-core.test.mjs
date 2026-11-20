import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const core=vm.runInNewContext(source.match(/^  function createSodaAuctionCore\(\) \{[^]*?^  }/m)[0]+'\ncreateSodaAuctionCore()');
const now=Date.parse('2026-11-20T20:10:00+08:00');
const view=(overrides={})=>({enabled:true,auction:{startsAt:'2026-11-20T20:00:00+08:00',endsAt:'2026-11-20T21:00:00+08:00',
  supply:18,sold:0,released:6,available:3,remaining:18,perUserDaily:10,boughtToday:0,live:true,price:399999,
  nextReleaseAt:'2026-11-20T20:20:00+08:00',...overrides}});
const state={rounds:[],rejected:''};

test('汽水拍卖：严格低于40万，一轮一瓶，每十分钟新批仍参与，不硬编码每日瓶数',()=>{
  for(const price of [0,400000,400001])assert.equal(core.decision(core.model(view({price})),state,2000000,now).kind,'wait');
  const first=core.decision(core.model(view()),state,2000000,now);assert.equal(first.kind,'buy');
  const bought={...state,rounds:[first.round]};
  assert.equal(core.decision(core.model(view({boughtToday:1})),bought,1600001,now+60000).kind,'wait');
  assert.equal(core.decision(core.model(view({released:9,boughtToday:4})),bought,500000,now+600000).kind,'buy');
  assert.equal(core.decision(core.model(view({boughtToday:10})),bought,2000000,now).kind,'done');
});
test('汽水拍卖：售罄仍等下一批，余额不足可以等降价，旧日行情不参与',()=>{
  assert.equal(core.decision(core.model(view({available:0})),state,900000,now).kind,'wait');
  assert.equal(core.decision(core.model(view()),state,399998,now).kind,'wait');
  assert.equal(core.decision(core.model(view({price:350000})),state,399998,now).kind,'buy');
  assert.equal(core.decision(core.model(view()),state,900000,now+86400000).kind,'read');
  assert.equal(core.decision(core.model(view()),state,900000,now+3600000).kind,'done');
  assert.equal(core.day(Date.parse('2026-11-20T16:00:00Z')),'2026-11-21');
  assert.equal(core.start(now),Date.parse('2026-11-20T20:00:00+08:00'));
});
test('汽水拍卖：明确拒绝不会反复提交同报价，新批或降价可继续',()=>{
  const rejected=core.decision(core.model(view()),state,900000,now).signature;
  assert.equal(core.decision(core.model(view()),{...state,rejected},900000,now).kind,'wait');
  for(const change of [{price:390000},{released:9},{available:2}])
    assert.equal(core.decision(core.model(view(change)),{...state,rejected},900000,now).kind,'buy');
});
test('汽水拍卖：只认原单有效成交，网络未知、503及retry不误记或重放',()=>{
  const pending={price:399999};
  assert.equal(core.outcome(pending,200,{quantity:1,unitPrice:399999}),'success');
  assert.equal(core.outcome(pending,400,{error:'本批已售罄'}),'rejected');
  assert.equal(core.outcome(pending,422,{error:'代币余额不足'}),'rejected');
  for(const [status,body] of [[null,null],[503,{error:'本批已售罄'}],[409,{code:'retry',error:'已售罄'}],
    [200,{quantity:2,unitPrice:390000}],[200,{quantity:1,unitPrice:400000}],[200,{}],[409,{error:'订单处理中'}]])
    assert.equal(core.outcome(pending,status,body),'unknown');
});
test('汽水拍卖：不完整、异常字段不会成为购买依据',()=>{
  for(const field of [{price:-1},{price:'399999'},{available:-1},{perUserDaily:null},{boughtToday:NaN},{startsAt:'bad'},
    {endsAt:'2026-11-20T19:00:00+08:00'},{nextReleaseAt:'bad'}])assert.equal(core.model(view(field)),null);
  assert.equal(core.model({enabled:false}),null);
});
