import { farmMarkup } from './arkengine-farm.fixture.mjs';

// Local DOM reproduces the public stock page labels and useRequestIntent contract.
export const stockMarkup=farmMarkup+`<script>
window.km={reads:0,calls:[],busy:false,qty:{},stake:100,mode:'success',receipts:{},tokens:10000,search:'',
 view:{userId:77,enabled:true,stocks:[{id:1,modelName:'模型甲',priceCents:1200,volume24h:1000}],positions:[],
 ticks:[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(clock-(5-i)*300000).toISOString()})),
 rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000},rounds:[],myBets:[]}};
const priorStockFetch=window.fetch;
window.fetch=async(url,options)=>{
 if(url instanceof Request){const request=url;options={method:request.method,...options,body:options?.body??await request.text()};url=new URL(request.url).pathname;}
 else if(url instanceof URL)url=url.pathname;
 if(url==='/api/me/balance'){
  if(km.deferBalance)return new Promise((resolve,reject)=>{
   km.resolveBalance=()=>resolve(new Response(JSON.stringify({tokens:km.tokens,diamonds:10})));
   options?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  return new Response(JSON.stringify({tokens:km.tokens,diamonds:10}));
 }
 if(url!=='/api/stock')return priorStockFetch(url,options);
 if(options?.method!=='POST'){
  km.reads++;
  if(km.deferRead)return new Promise((resolve,reject)=>{km.resolveRead=()=>resolve(new Response(JSON.stringify(km.view)));
   options?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  if(km.readErrorsLeft>0){km.readErrorsLeft--;throw new TypeError('fixture temporary network');}
  if(km.readError)throw new TypeError('fixture network');
  return new Response(JSON.stringify({...km.view,...(km.hideBets?{myBets:[]}:{}),
    ...(km.hidePositions?{positions:[]}:km.zeroCosts?{positions:km.view.positions.map(p=>({...p,costBasisTokens:0}))}:{})}),{status:km.httpStatus||200});
 }
 const a=JSON.parse(options.body);km.calls.push(a);
 if(km.deferPost)return new Promise(resolve=>{km.resolvePost=()=>resolve(new Response('{}',{status:503}));});
 const existing=km.receipts[a.idempotencyKey];
 if(km.mode==='deferred'&&!existing)return new Response('{}',{status:503});
 let body=existing||{userId:km.view.userId,action:a.action,idempotencyKey:a.idempotencyKey,ok:true};
 let status=200;
 if(km.mode==='rejected'){body={...body,ok:false,executed:false,code:'fixture_rejection'};status=400;}
 else if(!existing){
  const v=km.view;
  if(a.action==='predict'){
   km.tokens-=a.betTokens;v.myBets.push({id:km.calls.length,roundId:a.roundId,direction:a.direction,betTokens:a.betTokens,settled:false,createdAt:new Date(clock).toISOString()});
  }else{
   const s=v.stocks.find(s=>s.modelName===a.modelName);let p=v.positions.find(p=>p.stockId===s.id);
   const price=km.fillPrice||s.priceCents,gross=price*a.shares,fee=Math[a.action==='buy'?'ceil':'floor'](gross*(a.action==='buy'?v.rules.buyFeePct:v.rules.sellFeePct)/100);
   if(a.action==='buy'){
    const cost=Math.ceil((gross+fee)/100);km.tokens-=cost;
    if(!p){p={stockId:s.id,shares:0,costBasisTokens:0,holdUntil:new Date(clock+3600000).toISOString()};v.positions.push(p);}
    p.shares+=a.shares;p.costBasisTokens+=cost;
   }else{const proceeds=Math.floor((gross-fee)/100);km.tokens+=proceeds;
    if(km.saleReceipt)body={...body,tradeId:km.calls.length,proceedsTokens:proceeds,balanceAfter:km.tokens};
    p.costBasisTokens=Math.ceil(p.costBasisTokens*(p.shares-a.shares)/p.shares);p.shares-=a.shares;}
  }
  km.receipts[a.idempotencyKey]=body;
 }
 if(km.mode==='lost'){throw new TypeError('receipt lost after execution');}
 if(km.mode==='unknown')return new Response('{}',{status:503});
 if(km.mode==='wrong-user')body={...body,userId:88};
 if(km.mode==='conflict'){body={...body,ok:false,executed:false,code:'idempotency_conflict'};status=400;}
 return new Response(JSON.stringify(body),{status});
};
window.stockTransport=(url,options)=>fetch(url,options);
window.stockAct=async(action,args)=>{
 if(km.busy)return;km.busy=true;
 const key='stock:request:'+km.view.userId;
 let intent=JSON.parse(sessionStorage.getItem(key)||'null');
 try{
  if(!intent){intent={idempotencyKey:crypto.randomUUID(),input:{...args,action,expectedUserId:km.view.userId}};sessionStorage.setItem(key,JSON.stringify(intent));}
  const response=await stockTransport('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...intent.input,idempotencyKey:intent.idempotencyKey})});
  const body=await response.json();
  if(body.userId===km.view.userId&&body.action===intent.input.action&&body.idempotencyKey===intent.idempotencyKey&&
    (response.ok&&body.ok===true||response.status===400&&body.executed===false&&body.code!=='idempotency_conflict'))sessionStorage.removeItem(key);
 }catch{}finally{km.busy=false;if(location.pathname==='/stock')renderStock();}
};
window.renderStock=()=>{
 game.innerHTML='<a href="/activities/expedition">远征</a><h1>模型股市</h1><button aria-label="刷新">刷新</button><section id="stock-list"><h2>上市模型</h2><input aria-label="搜索模型"></section><section id="prediction"><h2>涨跌预测</h2><input aria-label="预测下注代币数量"></section>';
 game.querySelector('a').onclick=e=>{e.preventDefault();navFarm('/activities/expedition');};
 game.querySelector('button').onclick=()=>renderStock();
 const search=game.querySelector('[aria-label="搜索模型"]');search.value=km.search;search.oninput=()=>{km.search=search.value;renderStock();};
 const pending=JSON.parse(sessionStorage.getItem('stock:request:'+km.view.userId)||'null');
 if(pending){const b=document.createElement('button');b.textContent='确认原交易';b.disabled=km.busy;b.onclick=()=>stockAct(pending.input.action,pending.input);game.prepend(b);}
 const blocked=km.busy||!!pending||!km.view.enabled;
 for(const s of km.view.stocks.filter(s=>s.modelName.includes(km.search))){
  const card=document.createElement('div');card.innerHTML='<p></p><div><label>数量<input></label><button></button></div>';
  card.querySelector('p').textContent=s.modelName;const input=card.querySelector('input');input.setAttribute('aria-label',s.modelName+' 交易数量');input.value=km.qty[s.id]||'1';
  input.oninput=()=>{km.qty[s.id]=input.value;renderStock();};
  const shares=Number(input.value),buy=card.querySelector('button');buy.textContent='买 '+shares;buy.disabled=blocked||s.suspended;
  buy.onclick=()=>stockAct('buy',{modelName:s.modelName,shares});
  const p=km.view.positions.find(p=>p.stockId===s.id&&p.shares>0);
  if(p){const sell=document.createElement('button');sell.textContent='卖 '+Math.min(shares,p.shares);sell.disabled=blocked||s.suspended||Date.parse(p.holdUntil)>clock||shares>p.shares;sell.onclick=()=>stockAct('sell',{modelName:s.modelName,shares:Math.min(shares,p.shares)});buy.parentElement.append(sell);}
  game.querySelector('#stock-list').append(card);
 }
 const stake=game.querySelector('[aria-label="预测下注代币数量"]');stake.value=km.stake;stake.oninput=()=>{km.stake=Number(stake.value);renderStock();};
 const fmt=s=>new Date(s).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
 for(const r of km.view.rounds){const s=km.view.stocks.find(s=>s.id===r.stockId),card=document.createElement('div');
  card.innerHTML='<div><div><p></p><span></span></div><div><button></button><button></button></div></div>';
  card.querySelector('p').textContent=s.modelName;card.querySelector('span').textContent='至少3笔行情 · 均价窗口 '+fmt(r.lockAt)+'～'+fmt(r.closeAt)+' 赔率 '+(r.oddsBp/100).toFixed(2)+'x';
  [...card.querySelectorAll('button')].forEach((b,i)=>{b.textContent=(i?'跌 ':'涨 ')+km.stake;b.disabled=blocked||clock>=Date.parse(r.lockAt);b.onclick=()=>stockAct('predict',{roundId:r.id,direction:i?'down':'up',betTokens:km.stake});});
  game.querySelector('#prediction').append(card);
 }
};
const stockExp=window.renderExp;
window.renderExp=()=>{stockExp();const a=document.createElement('a');a.href='/stock';a.textContent='模型股市';a.onclick=e=>{e.preventDefault();navFarm('/stock');};game.prepend(a);};
window.navFarm=path=>{history.pushState({},'',path);if(path==='/stock')renderStock();else if(path==='/farm')renderFarm();else renderExp();};
if(location.pathname==='/stock')renderStock();else renderExp();
</script>`;
