import assert from 'node:assert/strict';

export async function farmRecoveryTests({t,setupFarm,evaluate,drive,pulse}) {
  const state="JSON.parse(localStorage.getItem('arkengine:auto-farm:schedule:v1'))";
  const noDialog="!document.querySelector('[role=dialog],[role=alertdialog]')";
  const twoClosers=`const open=openSeeds;window.openSeeds=()=>{open();const dialog=document.querySelector('[role=dialog]');
    const header=document.createElement('header');const close=document.createElement('button');
    close.setAttribute('aria-label','关闭');close.onclick=closeSeeds;header.append(close);dialog.prepend(header);};`;
  await t.test('农场阻塞修复：双关闭按钮缺种时退出，补足库存后重新开启可种植',async()=>{
    await setupFarm(`addRuns(6);for(const key in fm.inventory)fm.inventory[key]=0;${twoClosers}`,'/farm');
    await drive("localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'",'missing seed pauses');
    assert.equal(await evaluate(noDialog),true);
    assert.match(await evaluate(`${state}.note`),/没有足够免费存货/);
    assert.doesNotMatch(await evaluate(`${state}.note`),/无法自动关闭/);
    assert.equal(await evaluate("fm.calls.filter(call=>call.type==='plant').length"),0);
    await evaluate(`for(const key in fm.inventory)fm.inventory[key]=100;
      document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
    await drive('fm.crops.length===12','plant after replenishing seeds');
    assert.equal(await evaluate("fm.calls.filter(call=>call.type==='plant').length"),1);
  });
  await t.test('农场阻塞修复：隐藏或禁用关闭按钮不挡住另一个可用关闭按钮',async()=>{
    for(const mode of ['hidden','disabled']) {
      await setupFarm(`addRuns(6);${twoClosers}const original=openSeeds;window.openSeeds=()=>{original();
        const dialog=document.querySelector('[role=dialog]');dialog.querySelector('h2').textContent='新版目录';
        dialog.querySelector('header button').${mode}=true;};`,'/farm');
      await drive(`${noDialog}&&location.pathname==='/activities/expedition'`,'changed sheet dismissed');
      assert.equal(await evaluate("fm.calls.filter(call=>call.type==='plant').length"),0);
      assert.notEqual(await evaluate("localStorage.getItem('arkengine:auto-farm:enabled:v1')"),'false');
    }
  });
  await t.test('农场阻塞修复：关闭也失败时日志仍保留选种失败原因，且只记录一次',async()=>{
    await setupFarm(`addRuns(6);for(const key in fm.inventory)fm.inventory[key]=0;
      const open=openSeeds;window.openSeeds=()=>{open();document.querySelector('[role=dialog] [aria-label="关闭"]').remove();};`,'/farm');
    await drive("localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'",'unclosable seed sheet pauses');
    assert.match(await evaluate(`${state}.note`),/没有足够免费存货.*无法自动关闭/);
    await pulse(60000);
    const events=await evaluate("(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='farm-seed-blocked')");
    assert.equal(events.length,1);
    assert.match(events[0].data.reason,/没有足够免费存货/);
    assert.equal(await evaluate("fm.calls.filter(call=>call.type==='plant').length"),0);
  });
  await t.test('农场阻塞修复：按当前种源核对库存，不把其他品质或种子袋当作可用库存',async()=>{
    for(const source of ['safe','normal','fine','rare','shop','changed']) {
      await setupFarm(`addRuns(6);const open=openSeeds;window.openSeeds=()=>{open();const label=document.createElement('label');
        label.innerHTML='种源与品质<select><option value="${source}">${source}</option></select>';document.querySelector('[role=dialog]').append(label);};
        const read=farmData;window.farmData=()=>{const data=read();data.seedPouch=Object.fromEntries(fc.map(crop=>[crop.key,100]));
          data.inventory=data.inventory.map(item=>({...item,quality:${JSON.stringify(source==='fine'?'rare':'fine')}}));
          if('${source}'==='safe')data.seedPouch={};return data;};`,'/farm');
      await drive("localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'",'selected source cannot supply seeds');
      assert.equal(await evaluate("fm.calls.filter(call=>call.type==='plant').length"),0,source);
      assert.equal(await evaluate(noDialog),true,source);
    }
  });
  await t.test('农场阻塞修复：安全种源合并种子袋和普通库存，满足一轮后只种一次',async()=>{
    await setupFarm(`addRuns(6);const open=openSeeds;window.openSeeds=()=>{open();const label=document.createElement('label');
      label.innerHTML='种源与品质<select><option value="safe">安全种源</option></select>';document.querySelector('[role=dialog]').append(label);};
      const read=farmData;window.farmData=()=>{const data=read();data.seedPouch=Object.fromEntries(fc.map(crop=>[crop.key,7]));
        data.inventory=data.inventory.map(item=>({...item,quality:'normal',quantity:5}));return data;};`,'/farm');
    await drive('fm.crops.length===12','combined safe inventory plants');
    assert.equal(await evaluate("fm.calls.filter(call=>call.type==='plant').length"),1);
    assert.notEqual(await evaluate("localStorage.getItem('arkengine:auto-farm:enabled:v1')"),'false');
  });
}
