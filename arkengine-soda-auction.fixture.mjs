import {singlePageMarkup} from './arkengine-single-page.fixture.mjs';

export const auctionMarkup=singlePageMarkup+`<script>
window.am={tokens:3000000,posts:[],clicks:[],reads:[],tabs:[],market:0,quantity:1,mode:'success',confirmDisabled:false,
  view:{enabled:true,auction:{startsAt:'2026-11-20T20:00:00+08:00',endsAt:'2026-11-20T21:00:00+08:00',
    supply:18,sold:0,released:3,remaining:18,available:3,perUserDaily:10,boughtToday:0,live:true,price:399999,
    floorPrice:100000,nextReleaseAt:'2026-11-20T20:10:00+08:00',cooldownHours:24}}};
const nativeFetch=window.fetch;
window.fetch=async(input,options)=>{
  if(input==='/api/me/balance'){
    const response=new Response(JSON.stringify({tokens:am.tokens}));
    if(am.holdBalance)return new Promise(resolve=>{window.finishOldAuctionBalance=()=>resolve(response);});
    return response;
  }
  if(input!=='/api/shelter/auction')return nativeFetch(input,options);
  if(options?.method!=='POST'){
    am.reads.push(clock);return new Response(JSON.stringify(am.view));
  }
  const body=JSON.parse(options.body);am.posts.push({at:clock,body,wall:performance.now(),
    pending:JSON.parse(localStorage.getItem('arkengine:auto-soda-auction:state:v1'))?.pending});
  if(am.mode==='network')throw Error('fixture network');
  if(am.mode==='retry')return new Response(JSON.stringify({code:'retry',error:'结果未确认'}),{status:503});
  if(am.mode==='sold')return new Response(JSON.stringify({error:'本批已售罄'}),{status:400});
  if(am.mode==='empty')return new Response('{}');
  const respond=()=>{
    am.view.auction.sold++;am.view.auction.boughtToday++;am.view.auction.available--;am.view.auction.remaining--;
    am.tokens-=body.maxUnitPrice;
    return new Response(JSON.stringify({quantity:body.quantity,unitPrice:body.maxUnitPrice}));
  };
  if(am.mode==='hold')return new Promise(resolve=>{window.finishAuction=()=>resolve(respond());});
  return respond();
};
const nativeShelter=window.renderShelter;
const auctionKeys=new Map();
window.auctionConfirmNative=(price,quantity)=>new Promise(resolve=>{
  const dialog=document.createElement('div');dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-describedby','auction-description');
  const amount=am.wrongAmount?price+1:price;
  dialog.innerHTML='<h2>'+ (am.title||('以 '+price.toLocaleString('en-US')+' 代币/瓶买入 '+quantity+' 瓶')) +
    '</h2><div id="auction-description">合计 '+amount.toLocaleString('en-US')+' 代币。价格只会往下走，成交价不会高于这个数。买到的汽水 24 小时后才能上架。</div>'+
    '<button id="auction-cancel">取消</button><button id="auction-confirm">确认</button>';
  document.body.append(dialog);game.setAttribute('aria-hidden','true');
  const close=accepted=>{
    const finish=()=>{dialog.remove();game.removeAttribute('aria-hidden');resolve(accepted);};
    if(am.animationClose&&!globalThis.BASE_UI_ANIMATIONS_DISABLED)requestAnimationFrame(finish);else finish();
  };
  document.getElementById('auction-cancel').onclick=()=>{am.clicks.push({type:'cancel',at:clock});close(false);};
  document.getElementById('auction-confirm').disabled=am.confirmDisabled;
  document.getElementById('auction-confirm').onclick=()=>{
    am.clicks.push({type:'confirm',at:clock,wall:performance.now()});
    if(am.holdConfirm){window.finishAuctionConfirm=()=>close(true);return;}
    close(true);
  };
});
window.refreshAuction=async()=>{
  const response=await fetch('/api/shelter/auction',{cache:'no-store'});am.visible=await response.json();
  if(location.pathname==='/shelter'&&sm.tab==='汽水交易')renderAuction();
};
window.renderAuction=()=>{
  const auction=am.visible?.auction;
  game.innerHTML='<button role="tab" aria-selected="true">汽水交易</button>'+
    '<section id="auction-panel"><h2>每日拍卖</h2></section><section><h2>玩家市场</h2><button id="market-buy">买入</button></section>';
  document.getElementById('market-buy').onclick=()=>am.market++;
  const panel=document.getElementById('auction-panel');
  if(auction){
    const available=Math.max(0,Math.min(auction.available??auction.remaining,auction.perUserDaily-auction.boughtToday));
    panel.innerHTML+='<p>今日投放 '+auction.supply+' 瓶，已售 '+auction.sold+'，目前释放 '+auction.released+' 瓶。每人每天最多拍 '+auction.perUserDaily+' 瓶，你今天已拍 '+auction.boughtToday+' 瓶。</p>';
    if(auction.live){
      panel.innerHTML+='<p>当前 '+auction.price.toLocaleString('en-US')+' 代币/瓶</p><p>本批可拍 '+available+' 瓶</p>'+
        '<input type="number" min="1" max="'+Math.max(1,available)+'" aria-label="购买数量" value="'+am.quantity+'">'+
        '<button id="auction-buy" '+(am.busy||available<=0?'disabled':'')+'>'+(auction.boughtToday>=auction.perUserDaily?'今天已拍满':available<=0?'等待下一批':'买入')+'</button>';
      const quantity=panel.querySelector('input');quantity.oninput=()=>{am.quantity=Number(quantity.value);};
      document.getElementById('auction-buy').onclick=async()=>{
        am.clicks.push({type:'buy',at:clock,wall:performance.now()});
        const count=Math.min(am.quantity,available),price=auction.price;
        if(!await auctionConfirmNative(price,count))return;
        if(am.holdBeforeRequest)await new Promise(resolve=>{window.sendHeldAuction=resolve;});
        am.busy=true;
        const input={quantity:count,maxUnitPrice:price,...am.requestPatch};
        const fingerprint=JSON.stringify(input),key=auctionKeys.get(fingerprint)||crypto.randomUUID();auctionKeys.set(fingerprint,key);
        try{
          const response=await fetch(am.requestPath||'/api/shelter/auction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,idempotencyKey:key})});
          const result=await response.json();
          if(response.status===503||result.code==='retry')return;
          auctionKeys.delete(fingerprint);
          if(response.ok){await fetch('/api/me/balance');await refreshAuction();}
        }catch{}finally{am.busy=false;if(sm.tab==='汽水交易')renderAuction();}
      };
    }
  }
  addUnifiedLinks();
};
window.renderShelter=()=>{
  if(sm.tab==='汽水交易'){renderAuction();return;}
  nativeShelter();
  const tab=document.createElement('button');tab.textContent='汽水交易';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');
  tab.onclick=()=>{sm.tab='汽水交易';am.tabs.push(clock);renderAuction();void refreshAuction();};game.append(tab);
};
</script>`;
