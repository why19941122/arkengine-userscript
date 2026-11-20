import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const text=vm.runInNewContext(source.match(/^  function logIncomeText\([^]*?^  }/m)[0]+'\nlogIncomeText');
const day='2026-11-20';
test('统一收益：汽水拍卖记录代币支出，不混入股市盈亏或远征收益',()=>{
  const summary=text({expedition:{day,totals:{避难所汽水:2,汽水拍卖支出:399999}}},day);
  assert.match(summary,/避难所：汽水 2 · 拍卖支出 399999 代币/);
  assert.match(summary,/股市：已实现盈亏 0 代币/);
  assert.match(summary,/远征\/农场：钻石 0 · 代币 0/);
});
test('统一收益：两组同日汇总，汽水、修仙货币和已实现盈亏只记一次',()=>{
  const groups={cultivate:{day,totals:{钻石:260,代币:6.25,修为:192180,秘境扫荡钻石:260}},
    expedition:{day,totals:{代币:1250,股市返还:1000,避难所商队代币:50,钻石:12,避难所汽水:2,避难所零件:100,
      股市已实现盈亏:-22,股市预测净盈亏:5}}};
  assert.equal(text(groups,day),'今日收益\n避难所：汽水 2\n修仙：钻石 260 · 代币 6.25\n股市：已实现盈亏 -17 代币\n远征/农场：钻石 12 · 代币 200');
});
test('统一收益：旧日不混入今日，缺失和存储异常保留简短提示',()=>{
  const groups={cultivate:{day:'2026-11-19',totals:{钻石:999},failed:true},
    expedition:{day,totals:{股市已实现盈亏:12,股市卖出成本待核对:1}}};
  assert.match(text(groups,day),/修仙：钻石 0 · 代币 0/);
  assert.match(text(groups,day),/已实现盈亏 \+12 代币（部分待核对）/);
  assert.match(text(groups,day),/日志存储失败/);
  assert.equal(text({},day).split('\n').length,5);
});
