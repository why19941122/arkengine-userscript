import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_OBSERVATION_CODEC_BEGIN')[1].split('// STOCK_OBSERVATION_CODEC_END')[0];
const make=extra=>vm.runInNewContext(code+';createStockObservationCodec();',{
  TextEncoder,TextDecoder,crypto:webcrypto,Blob,CompressionStream,DecompressionStream,Uint8Array,atob,btoa,...extra});
const common={settings:{observeOnly:true},parts:[{userId:7,enabled:true,rules:{buyFeePct:2},
  stocks:Array.from({length:67},(_,i)=>({id:i+1,modelName:'模型'+i,priceCents:1000})),
  ticks:Array.from({length:804},(_,i)=>({stockId:i%67+1,createdAt:1000,priceCents:1000})),
  accountSnapshot:{userId:7,balanceTokens:10000,positions:[],pendingKnown:true,pending:null}}]};
const reading=(at,id)=>({at,observationId:id,visibility:'hidden',reading:{generation:1,phase:'scan',marketAt:at-1000,balanceAt:at,freshnessAt:at-1000}});
const normalized=x=>JSON.parse(JSON.stringify(x));
test('observation compression: lossless Unicode round trip and independent content integrity',async()=>{
  const c=make(),p=await c.encode(common);assert.equal(p.encoding,'gzip-base64');assert.ok(p.payload.length<p.rawBytes/5);
  assert.deepEqual(normalized(await c.decode(p)),common);
  await assert.rejects(c.decode({...p,sha256:'0'.repeat(64)}),/integrity/);
  await assert.rejects(c.decode({...p,rawBytes:20}),/size exceeded/);
  await assert.rejects(c.decode({...p,payload:'not base64!'}),/base64/);
  console.log(JSON.stringify({kind:'stock-compression-size',rawBytes:p.rawBytes,base64Bytes:p.payload.length,encoding:p.encoding}));
});
test('observation compression: raw fallback remains self contained without compression support',async()=>{
  const c=make({CompressionStream:undefined}),p=await c.encode(common);assert.equal(p.encoding,'utf8');
  assert.deepEqual(normalized(await c.decode(p)),common);
  await assert.rejects(c.decode({...p,payload:p.payload+' '}),/integrity/);
});
test('observation compression: merged readings retain each availability time and complete parts',async()=>{
  const c=make(),content=await c.encode({...common,parts:[common.parts[0],{...common.parts[0],accountSnapshot:undefined,stocks:[],ticks:[]}]}),
    event={at:2000,pageId:'page',version:'local',group:'expedition',type:'stock-observation-block',
      data:{blockVersion:1,content,readings:[reading(2000,'a'),reading(302000,'b')]}};
  const restored=await c.expand(event);assert.equal(restored.length,4);
  assert.deepEqual(normalized(restored.map(e=>[e.at,e.data.observationId,e.data.part])),[[2000,'a',0],[2000,'a',1],[302000,'b',0],[302000,'b',1]]);
  assert.ok(restored.every(e=>e.data.totalParts===2&&e.data.observationVersion===2&&e.visibility==='hidden'));
  assert.equal(event.data.readings.length,2);
});
test('observation compression: metadata tampering cannot invent coverage, ages or duplicate observations',async()=>{
  const c=make(),content=await c.encode(common),base={at:2000,type:'stock-observation-block',data:{blockVersion:1,content,readings:[reading(2000,'a')]}};
  for(const readings of [[],[null],[reading(2001,'a')],[reading(2000,'a'),reading(2000,'a')],
    [reading(2000,'a'),reading(4000000,'b')],[{...reading(2000,'a'),reading:{...reading(2000,'a').reading,marketAt:3000}}]])
    await assert.rejects(c.expand({...base,data:{...base.data,readings}}),/Invalid/);
  await assert.rejects(c.expand({...base,data:{...base.data,content:{...content,sha256:'1'.repeat(64)}}}),/integrity/);
});
test('observation compression: equal snapshots yield equal fingerprints, changed account or rules do not',async()=>{
  const c=make(),a=await c.encode(common),b=await c.encode(structuredClone(common));
  assert.equal(a.sha256,b.sha256);assert.equal(a.payload,b.payload);
  const changed=structuredClone(common);changed.parts[0].accountSnapshot.balanceTokens--;
  assert.notEqual((await c.encode(changed)).sha256,a.sha256);
  changed.parts[0].accountSnapshot.balanceTokens++;changed.parts[0].rules.buyFeePct++;
  assert.notEqual((await c.encode(changed)).sha256,a.sha256);
});
