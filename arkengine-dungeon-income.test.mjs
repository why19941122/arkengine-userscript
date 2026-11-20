import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const start=source.indexOf('  function dungeonSweepIncome('),end=source.indexOf('  function validDungeonReceipt(',start);
const income=start<0?()=>null:vm.runInNewContext(source.slice(start,end)+'\ndungeonSweepIncome',{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x)});
const read=trips=>JSON.parse(JSON.stringify(income(trips)));
test('秘境扫荡收益：五趟完整回执累计实发金额，保留代币小数，不读材料描述内的折算数字',()=>{
  const trip={finished:true,rewards:{exp:38436,diamonds:52,tokens:1.25,stamina:96,techniqueFragment:'功法残页（已折算12000修为）'}};
  assert.deepEqual(read(Array(5).fill(trip)),{修为:192180,钻石:260,代币:6.25,灵力:480,'秘境扫荡通关':5});
});
test('秘境扫荡收益：只计完成趟数，半途所得留待该趟最终累计，零完成不产生收入',()=>{
  assert.deepEqual(read([{finished:true,rewards:{exp:100,diamonds:20}},{finished:false,rewards:{exp:999,diamonds:999}}]),
    {修为:100,钻石:20,代币:0,灵力:0,'秘境扫荡通关':1});
  assert.equal(read([{finished:false,rewards:{exp:999}}]),null);
});
test('秘境扫荡收益：缺失和畸形奖励明确待核对，不猜金额、不丢其他完整趟',()=>{
  for(const rewards of [undefined,null,{exp:-1},{diamonds:'52'},{exp:Infinity},{tokens:Number.MAX_SAFE_INTEGER+1}]){
    assert.deepEqual(read([{finished:true,rewards},{finished:true,rewards:{exp:100}}]),
      {修为:100,钻石:0,代币:0,灵力:0,'秘境扫荡通关':2,'秘境金额待核对':1});
  }
});
test('秘境扫荡收益：奖励零值有效，累计越过安全数值上限的趟数待核对',()=>{
  assert.deepEqual(read([{finished:true,rewards:{}}]),{修为:0,钻石:0,代币:0,灵力:0,'秘境扫荡通关':1});
  assert.deepEqual(read([{finished:true,rewards:{exp:Number.MAX_SAFE_INTEGER}},{finished:true,rewards:{exp:1}}]),
    {修为:Number.MAX_SAFE_INTEGER,钻石:0,代币:0,灵力:0,'秘境扫荡通关':2,'秘境金额待核对':1});
});
