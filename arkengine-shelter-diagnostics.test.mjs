import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  const routineLog ='),source.indexOf('  // STOCK_OBSERVATION_CODEC_BEGIN'));
const api=vm.runInNewContext(code+'\n({priority:logPriority,coverage:shelterDiagnosticCoverage,stockCoverage:typeof stockDiagnosticCoverage===\'function\'?stockDiagnosticCoverage:null})');
const summary={type:'shelter-decision',pageId:'p',at:1,data:{diagnosticId:'d',totalParts:2}};
const part=n=>({type:'shelter-decision-detail',pageId:'p',data:{diagnosticId:'d',part:n,totalParts:2,rows:[]}});
test('诊断留存：摘要和人员房间分片同等保留，失效现场为关键记录',()=>{
  assert.equal(api.priority(summary),1.5);assert.equal(api.priority(part(0)),1.5);
  assert.equal(api.priority({type:'shelter-execution-evidence'}),2);
  assert.equal(api.priority({type:'shelter-check-detail'}),1.5);
  assert.equal(api.priority(summary),api.priority({type:'stock-observation-block'}));
  assert.equal(api.priority({type:'state'}),0);
});

test('诊断覆盖：摘要被整体淘汰也报告损失，旧桶缺汇总时保持未知',()=>{
  const complete=api.coverage([{counts:{'shelter-decision':3,'shelter-check':2},events:[summary,part(0),part(1)]}]);
  assert.equal(complete.completeRounds,1);
  assert.ok(complete.summaries,'必须核对包括已丢失摘要在内的每日计数');
  assert.deepEqual(JSON.parse(JSON.stringify(complete.summaries)),{recorded:5,retained:1,missing:4,unknownBuckets:0});
  const unknown=api.coverage([{events:[summary,part(0),part(1)]}]);
  assert.equal(unknown.summaries.unknownBuckets,2);
  assert.equal(unknown.summaries.missing,0,'缺少每日计数不能编造损失数量');
});

test('股市诊断：摘要、明细与原始行情同等保留，操作回执优先',()=>{
  for(const type of ['stock-decision','stock-decision-detail','stock-observation-block'])assert.equal(api.priority({type}),1.5);
  assert.ok(api.priority({type:'stock-decision-detail'})>api.priority({type:'heartbeat'}));
  assert.ok(api.priority({type:'stock-confirmed'})>api.priority({type:'stock-observation-block'}));
});

test('股市诊断：缺片、重复、截断和跨页混片均明确报告',()=>{
  assert.equal(typeof api.stockCoverage,'function');
  const s={...summary,type:'stock-decision'},p=n=>({...part(n),type:'stock-decision-detail'});
  for(const [parts,complete,missing] of [[[p(0),p(1)],1,0],[[p(0)],0,1],[[],0,2],
    [[p(0),p(0),p(1)],0,0],[[p(0),{...p(1),pageId:'other'}],0,1],
    [[p(0),{...p(1),data:{...p(1).data,rows:undefined,truncated:true}}],0,1]]){
    const c=api.stockCoverage([{events:[s,...parts]}]);assert.equal(c.completeRounds,complete);assert.equal(c.missingParts,missing);
  }
  const midnight=api.stockCoverage([{events:[s,p(0)]},{events:[p(1)]}]);
  assert.equal(midnight.completeRounds,1,'one diagnostic may finish writing after midnight');
});
test('诊断覆盖：完整、缺片、重复、截断与不同页面不可混算',()=>{
  for(const [name,parts,complete,missing] of [
    ['complete',[part(0),part(1)],1,0],['missing',[part(0)],0,1],['empty',[],0,2],
    ['duplicate',[part(0),part(0),part(1)],0,0],
    ['truncated',[part(0),{...part(1),data:{...part(1).data,rows:undefined,truncated:true}}],0,1],
    ['other-page',[part(0),{...part(1),pageId:'other'}],0,1]
  ]){
    const result=api.coverage([{events:[summary,...parts]}]);
    assert.equal(result.completeRounds,complete,name);assert.equal(result.missingParts,missing,name);
  }
});
