import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const valid=vm.runInNewContext(source.slice(source.indexOf('  const validShelterPending ='),source.indexOf('  // 同组只持有一把运行锁'))+'\nvalidShelterPending',{
  timedState:v=>v&&Number.isFinite(v.at),objectState:v=>v!==null&&typeof v==='object'&&!Array.isArray(v),
  shelterKinds:['assign','season'],constructionKind:()=>false,campaignKind:()=>false
});
const pending=()=>({at:1000,id:'intent',kind:'assign',vaultNo:77,targets:[5,6],before:{room:4,collected:0,day:'2026-11-12',month:'2026-11'}});
const prepared=()=>({...pending(),lifecycle:{version:1,phase:'prepared',page:'page-A'}});
const bound=()=>({...pending(),lifecycle:{version:1,phase:'request-bound',page:'page-A',requestKey:'native-key-123',boundAt:1001}});
test('确认记录：兼容旧格式，明确准备及绑定记录均有效',()=>{
  for(const p of [pending(),prepared(),bound()])assert.equal(valid(p),true);
});
for(const [name,change] of Object.entries({
  result:p=>p.result={status:200},campaignKey:p=>p.campaignKey='native-key-123',constructionKey:p=>p.constructionKey='native-key-123',
  requestKey:p=>p.lifecycle.requestKey='native-key-123',boundAt:p=>p.lifecycle.boundAt=1001,
  sentCount:p=>{p.kind='season';p.sentCount=1;},unknownPhase:p=>p.lifecycle.phase='maybe',unknownVersion:p=>p.lifecycle.version=2,
  emptyPage:p=>p.lifecycle.page=''
}))test('准备记录不能掩盖发送证据或未知格式：'+name,()=>{
  const p=prepared();change(p);assert.equal(valid(p),false);
});
test('绑定记录必须有合法请求标识和不早于准备的时间',()=>{
  for(const change of [p=>delete p.lifecycle.requestKey,p=>p.lifecycle.boundAt=999,p=>p.lifecycle.requestKey='?',p=>delete p.lifecycle.boundAt]){
    const p=bound();change(p);assert.equal(valid(p),false);
  }
});
