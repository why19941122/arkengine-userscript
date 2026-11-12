import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const core=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const plain=x=>JSON.parse(JSON.stringify(x));
const now=Date.parse('2026-11-12T00:00:00Z');
function fixture(){
  const v={userId:7,enabled:true,stocks:[{id:1,modelName:'model',priceCents:1200,volume24h:100}],
    positions:[],rounds:[],myBets:[],ticks:[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>
      ({stockId:1,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()})),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:50000,maxPositionTokens:400000,reserveTokens:1000000}};
  return {v,m:core.model(v,{tokens:10000}),ledger:{userId:7,owned:{},entries:[],pending:null}};
}
const field=(shape,name)=>shape.fields?.find(f=>f.name===name);

test('market evidence: actual response fields/types are recorded without unknown field values or credentials',()=>{
  const {v}=fixture();v.providerStats={requestCount:987654321,errorRate:.123456789,note:'private-value'};
  v.apiKey='secret-key';v.stocks[0].accessToken='private-token';v.stocks[0].unverifiedMetric=87654321;
  const before=JSON.stringify(v),schema=plain(core.marketShape(v)),serialized=JSON.stringify(schema);
  assert.equal(schema.version,1);assert.deepEqual(field(field(schema.shape,'providerStats'),'requestCount').types,['number']);
  assert.deepEqual(field(field(schema.shape,'stocks').items,'unverifiedMetric').types,['number']);
  for(const text of ['987654321','123456789','87654321','private-value','secret-key','private-token','apiKey','accessToken'])
    assert.ok(!serialized.includes(text),text);
  assert.equal(JSON.stringify(v),before);
});

test('market evidence: optional public prices preserve absent, zero, null and invalid without inventing values',()=>{
  const {v,m,ledger}=fixture();
  assert.equal(Object.hasOwn(core.observationParts(m,ledger)[0].stocks[0],'openPriceCents'),false);
  Object.assign(v.stocks[0],{openPriceCents:0,high24hCents:1600,low24hCents:null});
  let s=core.observationParts(m,ledger)[0].stocks[0];assert.equal(s.openPriceCents,0);assert.equal(s.high24hCents,1600);
  assert.equal(s.low24hCents,null);assert.equal(s.invalidOptionalFields,undefined);
  for(const value of ['1500',-1,1.5,Infinity,undefined,Number.MAX_SAFE_INTEGER+1,{private:'must-not-copy'}]){
    v.stocks[0].openPriceCents=value;s=core.observationParts(m,ledger)[0].stocks[0];
    assert.equal(s.openPriceCents,null);assert.deepEqual(plain(s.invalidOptionalFields),['openPriceCents']);
  }
});

test('market evidence: mixed sample types are merged and sampling limits are explicit',()=>{
  const {v}=fixture();v.stocks=Array.from({length:10},(_,i)=>({id:i+1,modelName:'s'+i,priceCents:1200,
    metric:i%2?null:12,...(i===9?{unseenMetric:999}:{})}));
  const schema=plain(core.marketShape(v)),stocks=field(schema.shape,'stocks');
  assert.equal(stocks.sampledItems,8);assert.equal(stocks.arrayItems,10);assert.equal(stocks.truncated,true);
  assert.deepEqual(field(stocks.items,'metric').types,['null','number']);
  assert.equal(field(stocks.items,'unseenMetric'),undefined);
});

test('market evidence: sampling uses no accessors and depth/field limits bound pathological responses',()=>{
  const {v}=fixture();let reads=0;Object.defineProperty(v,'privateGetter',{enumerable:true,get(){reads++;throw Error('getter');}});
  v.nested={next:{next:{value:'private'}}};
  const schema=core.marketShape(v);assert.ok(schema);assert.equal(reads,0);
  assert.equal(field(schema.shape,'privateGetter'),undefined);
  const wide=Object.fromEntries(Array.from({length:5000},(_,i)=>['field'+String(i).padStart(40,'0'),{number:12345678}]));
  assert.ok(Buffer.byteLength(JSON.stringify(core.marketShape(wide)))<20000);
});

test('market evidence: complete split snapshot survives replay import and does not affect order selection',()=>{
  const {v,m,ledger}=fixture(),cfg={trade:true,predict:false,tradeLimit:3000,predictionLimit:0,stake:0,reserve:100};
  const before=plain(core.choose(m,cfg,ledger,now));
  Object.assign(v.stocks[0],{openPriceCents:1100,high24hCents:1300,low24hCents:900,unverifiedMetric:12345678});
  const parts=plain(core.observationParts(m,ledger)),events=parts.map((snapshot,part)=>({type:'stock-observation',
    data:{observationVersion:2,observationId:'read',part,totalParts:parts.length,at:now,
      reading:{generation:1,phase:'scan',marketAt:now,balanceAt:now,freshnessAt:now},snapshot}}));
  const restored=stockSnapshotsFromLog({events})[0];
  assert.equal(restored.view.stocks[0].openPriceCents,1100);assert.equal(restored.view.marketSchema.version,1);
  assert.equal(restored.view.stocks[0].unverifiedMetric,undefined);
  assert.deepEqual(plain(core.choose(m,cfg,ledger,now)),before);
  const roundTrip=core.model(restored.view,{tokens:10000});assert.deepEqual(plain(core.choose(roundTrip,cfg,ledger,now)),before);
});

test('market evidence: 70 long names with extra fields still split below the per-event byte limit',()=>{
  const {v,m,ledger}=fixture();v.stocks=Array.from({length:70},(_,i)=>({id:i+1,modelName:'模型'.repeat(80)+i,
    priceCents:1200,volume24h:100,openPriceCents:1100,high24hCents:1400,low24hCents:900}));
  v.ticks=v.stocks.flatMap(s=>Array.from({length:24},(_,i)=>({stockId:s.id,priceCents:900+i*13,
    createdAt:new Date(now-(23-i)*300000).toISOString()})));
  const parts=plain(core.observationParts(m,ledger));assert.ok(parts.length>1);
  assert.equal(parts.filter(p=>Object.hasOwn(p,'marketSchema')).length,1);
  assert.equal(parts.flatMap(p=>p.stocks).length,70);assert.equal(parts.flatMap(p=>p.ticks).length,840);
  assert.ok(parts.every(p=>Buffer.byteLength(JSON.stringify(p))<24000));
});
