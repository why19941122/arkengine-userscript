import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stockInputReadiness,inspectMarketSchema,inspectStockFieldInventory} from './arkengine-stock-inputs.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const core=vm.runInNewContext(segment.slice(segment.indexOf('\n'))+'\nstockCore;');
const plain=x=>JSON.parse(JSON.stringify(x));
const start=Date.parse('2026-11-12T00:00:00Z'),minute=60000;
function fixture({n=53,version='1.17.92',edit=()=>{}}={}){
  const events=[];
  for(let i=0;i<n;i++){
    const at=start+i*5*minute,v={userId:7,enabled:true,
      stocks:[{id:1,modelName:'model',priceCents:1200,volume24h:100,openPriceCents:1000,high24hCents:1300,low24hCents:900}],
      positions:[],rounds:[],myBets:[],ticks:Array.from({length:12},(_,j)=>({stockId:1,priceCents:1200,
        createdAt:new Date(at-(11-j)*5*minute).toISOString()})),
      rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:1000000,reserveTokens:1000000}};
    edit(v,i);
    const m=core.model(v,{tokens:10000});assert.ok(m);
    const parts=plain(core.observationParts(m,{userId:7,owned:{},entries:[],pending:null}));
    if(version==='1.17.88')for(const p of parts){delete p.marketSchema;for(const s of p.stocks)
      for(const key of ['openPriceCents','high24hCents','low24hCents','invalidOptionalFields'])delete s[key];}
    for(const [part,snapshot] of parts.entries())events.push({version,type:'stock-observation',data:{observationVersion:2,
      observationId:'read-'+i,part,totalParts:parts.length,at,reading:{generation:i+1,phase:'scan',marketAt:at,balanceAt:at,freshnessAt:at},snapshot}});
  }
  return {version,events};
}
const states=(report,key)=>report.optionalPrices.find(p=>p.field===key).states;

test('input readiness: legacy missing values mean not collected, not absent at the API',()=>{
  const r=stockInputReadiness(fixture({version:'1.17.88'}));
  assert.equal(r.schema.states['not-collected'],53);assert.equal(states(r,'openPriceCents')['not-collected'],53);
  assert.equal(states(r,'openPriceCents')['not-returned'],undefined);
  assert.equal(r.horizons.find(h=>h.minutes===240).evaluable,5);
  assert.equal(r.horizons.find(h=>h.minutes===240).withOptionalPrices,0);
  assert.equal(r.readiness.priceInputCoverage,'insufficient-inputs');assert.equal(r.qualifiedForLive,false);
});

test('input readiness: known collector distinguishes absent, null, zero, invalid and valid prices',()=>{
  const r=stockInputReadiness(fixture({n:5,edit(v,i){const s=v.stocks[0];
    if(i===0)delete s.openPriceCents;if(i===1)s.openPriceCents=null;if(i===2)s.openPriceCents=0;if(i===3)s.openPriceCents='1000';
  }}));
  assert.deepEqual(states(r,'openPriceCents'),{'not-returned':1,null:1,'positive-integer':1,'reported-invalid':1,zero:1});
});

test('input readiness: 1.17.124 preserves the verified collector contract without trusting unknown future versions',()=>{
  for(const version of ['1.17.92','1.17.93','1.17.94','1.17.95','1.17.96','1.17.97','1.17.98','1.17.99','1.17.100','1.17.101','1.17.102','1.17.103','1.17.104','1.17.105','1.17.106','1.17.107','1.17.108','1.17.109','1.17.110','1.17.111','1.17.112','1.17.113','1.17.114','1.17.115','1.17.116','1.17.117','1.17.118','1.17.119','1.17.120','1.17.121','1.17.122','1.17.123','1.17.124','1.17.125']){
    const r=stockInputReadiness(fixture({n:1,version,edit(v){delete v.stocks[0].openPriceCents;}}));
    assert.deepEqual(states(r,'openPriceCents'),{[version==='1.17.125'?'not-collected':'not-returned']:1});
  }
});

test('input readiness: healthy inputs support only descriptive study, not semantic proof or live promotion',()=>{
  const input=fixture({edit(v){v.providerStats={requestCount:987654321,errorRate:.123456789};v.privateNote='do-not-copy';}}),before=JSON.stringify(input);
  const r=stockInputReadiness(input);
  assert.equal(r.readiness.priceInputCoverage,'available-for-descriptive-study');
  assert.equal(r.readiness.driverInputs,'unverified');assert.equal(r.readiness.livePromotion,false);
  const field=r.schema.fields.find(f=>f.path==='$.providerStats.requestCount');
  assert.deepEqual(field.types,['number']);assert.equal(field.valuesRetained,false);assert.equal(field.semanticMeaningVerified,false);
  assert.equal(r.schema.fields.find(f=>f.path==='$.rules.buyFeePct').valuesRetained,true);
  assert.equal(r.schema.fields.find(f=>f.path==='$.ticks[].createdAt').valuesRetained,true);
  for(const value of ['987654321','123456789','do-not-copy'])assert.ok(!JSON.stringify(r).includes(value));
  assert.equal(JSON.stringify(input),before);
});

test('input readiness: newer export version cannot relabel older observations as new collection',()=>{
  const log=fixture({n:2,version:'1.17.88'}),fresh=fixture({n:3});
  log.version='1.17.92';log.events.push(fresh.events[2]);
  const r=stockInputReadiness(log);
  assert.deepEqual(r.coverage.versions,{'1.17.88':2,'1.17.92':1});
  assert.equal(r.schema.states['not-collected'],2);assert.equal(r.schema.states.recorded,1);
  assert.equal(states(r,'openPriceCents')['not-collected'],2);assert.equal(states(r,'openPriceCents')['positive-integer'],1);
});

test('input readiness: truncated stock inventory never proves absence in unsampled stocks',()=>{
  const v={stocks:Array.from({length:10},(_,i)=>({id:i+1,...(i===9?{usageCount:987654321}:{})}))};
  const r=inspectMarketSchema(plain(core.marketShape(v)));
  assert.equal(r.status,'recorded');assert.ok(r.incompletePaths.includes('$.stocks[]'));
  assert.ok(!r.fields.some(f=>f.path.endsWith('.usageCount')));
});

test('input readiness: full stock inventory adds late and nested field evidence without metric values or double counting',()=>{
  const log=fixture({n:2,edit(v){v.stocks=Array.from({length:70},(_,i)=>({...v.stocks[0],id:i+1,modelName:'model-'+i,
    ...(i===69?{usageCount:987654321,metrics:{errorRate:.123456789}}:{})}));}});
  const r=stockInputReadiness(log);
  assert.deepEqual(r.schema.stockInventory.states,{complete:2});assert.equal(r.schema.stockInventory.completeObservations,2);
  for(const path of ['$.stocks[].usageCount','$.stocks[].metrics.errorRate']){
    const f=r.schema.fields.find(f=>f.path===path);assert.ok(f);assert.deepEqual(f.types,['number']);
    assert.equal(f.valuesRetained,false);assert.equal(f.semanticMeaningVerified,false);assert.equal(f.observations,2);
  }
  assert.equal(r.schema.fields.find(f=>f.path==='$.stocks[].priceCents').observations,2);
  assert.ok(!JSON.stringify(r).includes('987654321'));assert.ok(!JSON.stringify(r).includes('123456789'));
  assert.equal(r.readiness.driverInputs,'unverified');assert.equal(r.qualifiedForLive,false);
});

test('input readiness: older schema remains explicitly sampled and cannot acquire full coverage from export version',()=>{
  const log=fixture({n:1});delete log.events[0].data.snapshot.marketSchema.stockInventory;
  log.version='1.17.123';
  const r=stockInputReadiness(log);assert.deepEqual(r.schema.stockInventory.states,{'not-collected':1});
  assert.equal(r.schema.stockInventory.completeObservations,0);
});

test('input readiness: row limits, filtering and nested array samples remain incomplete',()=>{
  for(const view of [
    {stocks:Array.from({length:300},(_,i)=>({id:i+1}))},
    {stocks:[{id:1,accessToken:'private'}]},
    {stocks:[{id:1,metrics:Array.from({length:9},(_,i)=>({count:i}))}]}
  ]){
    const inventory=inspectMarketSchema(plain(core.marketShape(view))).stockInventory;
    assert.equal(inventory.status,'partial');assert.equal(inventory.complete,false);
  }
});

test('input readiness: exhausting the key budget exactly between rows cannot claim full coverage',()=>{
  const row=Object.fromEntries(Array.from({length:32},(_,i)=>['metric'+i,i]));
  const view={stocks:Array.from({length:129},(_,i)=>({...row,...(i===128?{lastRowMetric:123456789}:{})}))};
  const inventory=inspectMarketSchema(plain(core.marketShape(view))).stockInventory;
  assert.equal(inventory.status,'partial');assert.equal(inventory.complete,false);
  assert.ok(!inventory.fields.some(f=>f.path.endsWith('.lastRowMetric')));
});

test('input readiness: malformed or failed full inventory does not taint the original schema',()=>{
  const original=plain(core.marketShape({stocks:[{id:1}]}));
  for(const edit of [
    v=>v.totalRows++,v=>v.inspectedRows=257,v=>v.shape.objectSamples=2,
    v=>v.shape.fields[0].name='accessToken',v=>v.keyLimit=999999
  ]){
    const schema=structuredClone(original);edit(schema.stockInventory);
    const r=inspectMarketSchema(schema);assert.equal(r.status,'recorded');assert.ok(r.fields.length);
    assert.equal(r.stockInventory.status,'invalid-inventory');assert.deepEqual(r.stockInventory.fields,[]);
  }
  assert.equal(inspectStockFieldInventory(null).status,'capture-failed');
  const limited={...original.stockInventory,shape:null,issue:'size-limit'};
  assert.equal(inspectStockFieldInventory(limited).status,'size-limited');
});

test('input readiness: full inventory counts must match the complete snapshot stocks',()=>{
  const log=fixture({n:1}),snapshot=log.events[0].data.snapshot;
  snapshot.marketSchema.stockInventory=plain(core.marketShape({stocks:[{id:1},{id:2}]})).stockInventory;
  const r=stockInputReadiness(log);assert.deepEqual(r.schema.stockInventory.states,{'stock-count-mismatch':1});
  assert.equal(r.schema.stockInventory.completeObservations,0);
});

test('input readiness: malformed, failed and unsupported schemas are separate and cannot contribute field evidence',()=>{
  assert.equal(inspectMarketSchema(null).status,'capture-failed');
  assert.equal(inspectMarketSchema({version:2}).status,'unsupported-schema');
  const base=plain(core.marketShape({metric:1})),bad=structuredClone(base);bad.shape.fields[0].name='accessToken';
  assert.equal(inspectMarketSchema(bad).status,'invalid-schema');assert.deepEqual(inspectMarketSchema(bad).fields,[]);
  const wrong=structuredClone(base);wrong.shape.fields[0].presentInSamples=2;
  assert.equal(inspectMarketSchema(wrong).status,'invalid-schema');
  const log=fixture({n:1});log.events[0].data.snapshot.marketSchema=bad;
  assert.equal(stockInputReadiness(log).schema.states['invalid-schema'],1);
});

test('input readiness: range inconsistencies are retained and stale quotes cannot become fresh entry inputs',()=>{
  const r=stockInputReadiness(fixture({n:4,edit(v,i){
    if(i===0){v.stocks[0].low24hCents=1500;v.stocks[0].high24hCents=1000;}
    if(i===1)v.stocks[0].high24hCents=1100;
    if(i===2)v.stocks[0].stale=true;
  }}));
  assert.equal(r.rangeStates['reversed-range'],1);assert.equal(r.rangeStates['quote-outside-range'],1);
  assert.equal(r.coverage.quoteStates.stale,1);assert.equal(r.horizons[0].starts,3);
});

test('input readiness: gaps, a suspended first endpoint and end-of-log are never replaced or filled',()=>{
  const log=fixture({n:16,edit(v,i){if(i===12)v.stocks[0].suspended=true;}});
  let r=stockInputReadiness(log),h=r.horizons[0];
  assert.equal(h.exclusions.suspended,1);assert.ok(h.exclusions['log-ends-before-horizon']>0);
  log.events=log.events.filter(e=>![3,4,5].includes((e.data.at-start)/(5*minute)));
  r=stockInputReadiness(log);assert.ok(r.horizons[0].exclusions['internal-observation-gap']>0);
  assert.ok(r.coverage.maxGapMs>10*minute);
});

test('input readiness: future ticks cannot turn missing visible history into a current quote',()=>{
  const log=fixture({n:1});log.events[0].data.snapshot.ticks=[{stockId:1,priceCents:1200,createdAt:new Date(start+minute).toISOString()}];
  const r=stockInputReadiness(log);assert.equal(r.coverage.ignoredFutureTicks,1);
  assert.equal(r.coverage.quoteStates['missing-history'],1);assert.equal(r.horizons[0].starts,0);
});

test('input readiness: snapshot identity and incomplete parts fail instead of generating misleading coverage',()=>{
  const missing=fixture({n:1});missing.events[0].data.totalParts=2;assert.throws(()=>stockInputReadiness(missing),/Incomplete observation/);
  const mixed=fixture({n:2});mixed.events[1].data.snapshot.userId=8;mixed.events[1].data.snapshot.accountSnapshot.userId=8;
  assert.throws(()=>stockInputReadiness(mixed),/Mixed accounts/);
  const identity=fixture({n:2});identity.events[1].data.snapshot.stocks[0].modelName='changed';assert.throws(()=>stockInputReadiness(identity),/identity/);
  const conflict=fixture({n:2});conflict.events[1].data.snapshot.ticks[0].priceCents++;
  assert.throws(()=>stockInputReadiness(conflict),/Conflicting historical/);
});
