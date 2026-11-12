import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';

const minute=60000;
const prices=['openPriceCents','high24hCents','low24hCents'];
const positive=n=>Number.isSafeInteger(n)&&n>0;
const count=values=>Object.fromEntries([...new Set(values)].sort().map(k=>[k,values.filter(v=>v===k).length]));
const safeName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name)&&
  !/key|auth|secret|password|cookie|session|credential|signature|access|refresh|bearer|token|email|phone/i.test(name);
const retainedValue=path=>/^\$\.(userId|enabled|dailyBoughtTokens)$/.test(path)||
  /^\$\.rules\.(buyFeePct|sellFeePct|maxTradeTokens|maxDailyBuyTokens|maxPositionTokens|reserveTokens)$/.test(path)||
  /^\$\.stocks\[\]\.(id|modelName|priceCents|volume24h|stale|suspended|openPriceCents|high24hCents|low24hCents)$/.test(path)||
  /^\$\.ticks\[\]\.(stockId|priceCents|createdAt)$/.test(path)||
  /^\$\.positions\[\]\.(stockId|shares|costBasisTokens|holdUntil)$/.test(path);

// Read only the bounded schema vocabulary, never arbitrary response values. An
// absent field in a sampled schema cannot establish absence in the API response.
export function inspectMarketSchema(schema,present=true){
  if(!present)return {status:'not-collected',fields:[],incompletePaths:[]};
  if(schema===null)return {status:'capture-failed',fields:[],incompletePaths:[]};
  if(!schema||schema.version!==1)return {status:'unsupported-schema',fields:[],incompletePaths:[]};
  const fields=[],incompletePaths=[];let nodes=0;
  const types=new Set(['null','array','object','number','string','boolean','undefined','bigint','function','symbol']);
  try{
    assert.equal(schema.arraySampleLimit,8);assert.equal(schema.fieldLimit,96);
    function visit(node,path,depth){
      assert.ok(node&&typeof node==='object'&&!Array.isArray(node)&&++nodes<=384&&depth<=3);
      assert.ok(Array.isArray(node.types)&&node.types.length>0&&node.types.every(t=>types.has(t))&&new Set(node.types).size===node.types.length);
      if(Object.hasOwn(node,'truncated'))assert.equal(typeof node.truncated,'boolean');
      if(Object.hasOwn(node,'omitted'))assert.ok(Number.isSafeInteger(node.omitted)&&node.omitted>=0);
      if(node.truncated||node.omitted)incompletePaths.push(path);
      if(node.fields!==undefined){
        assert.ok(node.types.includes('object')&&Array.isArray(node.fields)&&Number.isSafeInteger(node.objectSamples)&&node.objectSamples>0);
        assert.equal(new Set(node.fields.map(f=>f.name)).size,node.fields.length);
        for(const field of node.fields){
          assert.ok(safeName(field.name)&&Number.isSafeInteger(field.presentInSamples)&&field.presentInSamples>0&&field.presentInSamples<=node.objectSamples);
          const next=path+'.'+field.name;
          assert.ok(fields.length<96);fields.push({path:next,types:[...field.types],presentInSamples:field.presentInSamples,objectSamples:node.objectSamples});
          visit(field,next,depth+1);
        }
      }
      if(node.arrayItems!==undefined||node.sampledItems!==undefined||node.items!==undefined){
        assert.ok(node.types.includes('array')&&Number.isSafeInteger(node.arrayItems)&&node.arrayItems>=0&&
          Number.isSafeInteger(node.sampledItems)&&node.sampledItems>=0&&node.sampledItems<=8&&node.sampledItems<=node.arrayItems);
        if(node.sampledItems<node.arrayItems)incompletePaths.push(path+'[]');
        if(node.sampledItems>0){assert.ok(node.items);visit(node.items,path+'[]',depth+1);}
        else assert.equal(node.items,undefined);
      }
    }
    visit(schema.shape,'$',0);
    return {status:'recorded',fields,incompletePaths:[...new Set(incompletePaths)]};
  }catch{return {status:'invalid-schema',fields:[],incompletePaths:[]};}
}

function fieldState(stock,key,collectorEvidence){
  if(Array.isArray(stock.invalidOptionalFields)&&stock.invalidOptionalFields.includes(key))return 'reported-invalid';
  if(!Object.hasOwn(stock,key))return collectorEvidence?'not-returned':'not-collected';
  if(stock[key]===null)return 'null';
  if(stock[key]===0)return 'zero';
  return positive(stock[key])?'positive-integer':'invalid-value';
}

// Offline input readiness, not a strategy, yield estimate or automatic trading gate.
// Reuse the strict snapshot reassembler: missing/conflicting parts must fail before
// this report exists, rather than allowing partial data to masquerade as coverage.
export function stockInputReadiness(log){
  const snapshots=stockSnapshotsFromLog(log),frames=[],names=new Map(),ticks=new Map(),inventory=new Map();
  let user=null,previous=null;
  for(const sample of snapshots){
    const at=sample.at,view=sample.view;
    assert.ok(Number.isSafeInteger(at)&&at>=0&&(previous===null||at>previous),'Increasing unique observations required');
    assert.ok(positive(view.userId)&&typeof view.enabled==='boolean','Verified market identity/status required');
    user??=view.userId;assert.equal(view.userId,user,'Mixed accounts cannot share input coverage');
    assert.equal(new Set(view.stocks.map(s=>String(s.id))).size,view.stocks.length,'Duplicate stock identity');
    assert.equal(new Set(view.stocks.map(s=>s.modelName)).size,view.stocks.length,'Duplicate model identity');
    const schema=inspectMarketSchema(view.marketSchema,Object.hasOwn(view,'marketSchema'));
    for(const field of schema.fields){
      if(!inventory.has(field.path))inventory.set(field.path,{path:field.path,types:new Set(),observations:0,
        firstSeenAt:at,lastSeenAt:at,valuesRetained:false,semanticMeaningVerified:false});
      const item=inventory.get(field.path);field.types.forEach(t=>item.types.add(t));item.observations++;item.lastSeenAt=at;
      item.valuesRetained=retainedValue(field.path);
    }
    const latest=new Map();let ignoredFutureTicks=0;
    for(const tick of view.ticks){
      const stamp=Date.parse(tick.createdAt);assert.ok(Number.isSafeInteger(stamp)&&stamp>=0&&positive(tick.priceCents),'Invalid tick');
      if(stamp>at){ignoredFutureTicks++;continue;}
      const id=String(tick.stockId),key=JSON.stringify([id,stamp]);
      if(ticks.has(key))assert.equal(ticks.get(key),tick.priceCents,'Conflicting historical price');
      else ticks.set(key,tick.priceCents);
      if(!latest.has(id)||latest.get(id)<stamp)latest.set(id,stamp);
    }
    // The explicit 1.17.92 contract copies optional prices for every stock. Its
    // sampled field inventory alone cannot prove that a particular stock omitted one.
    const collectorEvidence=sample.sourceVersion==='1.17.92'&&Object.hasOwn(view,'marketSchema');
    const rows=view.stocks.map(stock=>{
      const id=String(stock.id);assert.ok((positive(stock.id)||typeof stock.id==='string'&&stock.id.trim())&&
        typeof stock.modelName==='string'&&stock.modelName&&positive(stock.priceCents),'Invalid stock');
      if(names.has(id))assert.equal(names.get(id),stock.modelName,'Stock identity changed');else names.set(id,stock.modelName);
      const fields=Object.fromEntries(prices.map(key=>[key,fieldState(stock,key,collectorEvidence)]));
      const quoteAt=latest.get(id),age=quoteAt===undefined?null:at-quoteAt;
      const quoteStatus=!view.enabled?'market-closed':stock.suspended?'suspended':stock.stale?'stale':
        age===null?'missing-history':age>10*minute?'old-history':'current';
      const rangePresent=fields.low24hCents==='positive-integer'&&fields.high24hCents==='positive-integer';
      const rangeStatus=!rangePresent?'missing-or-invalid-range':stock.low24hCents>stock.high24hCents?'reversed-range':
        stock.priceCents<stock.low24hCents||stock.priceCents>stock.high24hCents?'quote-outside-range':'consistent';
      return {stockId:stock.id,quoteStatus,quoteAgeMs:age,fields,rangeStatus,
        allOptionalPricesUsable:quoteStatus==='current'&&rangeStatus==='consistent'&&fields.openPriceCents==='positive-integer'};
    });
    frames.push({at,version:sample.sourceVersion??'unknown',schema,rows,view,ignoredFutureTicks});previous=at;
  }
  const horizons=[60,240].map(minutes=>{
    const checks=[];
    for(let i=0;i<frames.length;i++){
      const start=frames[i],due=start.at+minutes*minute;
      const endIndex=frames.findIndex((f,j)=>j>i&&f.at>=due),end=frames[endIndex];
      const gap=end?frames.slice(i+1,endIndex+1).some((f,j)=>f.at-frames[i+j].at>10*minute):false;
      for(const row of start.rows.filter(r=>r.quoteStatus==='current')){
        const exit=end?.view.stocks.find(s=>String(s.id)===String(row.stockId));
        const reason=due>frames.at(-1).at?'log-ends-before-horizon':!end||end.at>due+5*minute?'no-read-within-5m':
          !end.view.enabled?'market-closed':!exit?'stock-not-observed':exit.suspended?'suspended':gap?'internal-observation-gap':null;
        checks.push({at:start.at,stockId:row.stockId,reason,optionalPricesUsable:row.allOptionalPricesUsable});
      }
    }
    return {minutes,starts:checks.length,evaluable:checks.filter(c=>c.reason===null).length,
      withOptionalPrices:checks.filter(c=>c.reason===null&&c.optionalPricesUsable).length,
      exclusions:count(checks.filter(c=>c.reason!==null).map(c=>c.reason))};
  });
  const allRows=frames.flatMap(f=>f.rows),schemaStates=count(frames.map(f=>f.schema.status));
  const reasons=[];
  if(!schemaStates.recorded)reasons.push('no-usable-response-schema');
  if(!allRows.some(r=>r.allOptionalPricesUsable))reasons.push('no-current-consistent-optional-price-inputs');
  if(!horizons.find(h=>h.minutes===240).withOptionalPrices)reasons.push('no-continuous-four-hour-labels-with-optional-inputs');
  return {kind:'stock-input-readiness',qualifiedForLive:false,tradeSimulation:false,
    coverage:{observations:frames.length,from:frames[0].at,to:frames.at(-1).at,stocks:names.size,stockRows:allRows.length,
      versions:count(frames.map(f=>f.version)),maxGapMs:Math.max(0,...frames.slice(1).map((f,i)=>f.at-frames[i].at)),
      ignoredFutureTicks:frames.reduce((n,f)=>n+f.ignoredFutureTicks,0),quoteStates:count(allRows.map(r=>r.quoteStatus))},
    schema:{states:schemaStates,observationsWithSamplingLimits:frames.filter(f=>f.schema.incompletePaths.length>0).length,
      fields:[...inventory.values()].map(f=>({...f,types:[...f.types].sort()})).sort((a,b)=>a.path.localeCompare(b.path)),
      absenceProven:false,meaning:'Presence is evidence of a field name/type only; absence in an incomplete inventory proves nothing.'},
    optionalPrices:prices.map(key=>({field:key,states:count(allRows.map(r=>r.fields[key]))})),
    rangeStates:count(allRows.map(r=>r.rangeStatus)),horizons,
    readiness:{priceInputCoverage:reasons.length===0?'available-for-descriptive-study':'insufficient-inputs',reasons,
      driverInputs:'unverified',predictiveValue:'unverified',livePromotion:false},
    limitations:['Field names/types cannot establish model-call-count or error-rate semantics; unknown values were not collected.',
      'Absence is classified as not-returned only under the explicit 1.17.92 full-stock optional-price copying contract; other collector versions remain unknown.',
      'Valid optional prices are observed inputs, not validated predictors or proof of a profitable strategy.',
      'Horizon counts are overlapping coverage checks, not independent trading opportunities; 60/240m are fixed existing research horizons.',
      'The first read after the horizon is used; missing, suspended and gapped evidence is never filled or replaced with a later favourable quote.',
      'This report does not establish cycle recovery, actual budget enforcement, live fills, holdout separation or seven-day profit.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: node arkengine-stock-inputs.mjs log.json [report.json]');
  const raw=readFileSync(process.argv[2]),log=JSON.parse(raw),report=stockInputReadiness(log);
  report.input={path:process.argv[2],sha256:createHash('sha256').update(raw).digest('hex'),exportedVersion:log.version??null,
    exportedAt:log.exportedAt??null};
  const json=JSON.stringify(report,null,2)+'\n';
  if(process.argv[3]){writeFileSync(process.argv[3],json);console.log(JSON.stringify({coverage:report.coverage,
    schemaStates:report.schema.states,optionalPrices:report.optionalPrices,horizons:report.horizons,readiness:report.readiness},null,2));}
  else process.stdout.write(json);
}
