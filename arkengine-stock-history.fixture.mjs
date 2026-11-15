// Start the browser after an old request was persisted. No new automatic order
// is executed to arrange a recovery/settlement test, and no live policy is bypassed.
export function stockHistoricalRequest({action='buy',result=null,age=120000}={}) {
  if(!['buy','predict'].includes(action)||![null,'success','rejected'].includes(result))throw Error('invalid historical request');
  return `{
    const action=${JSON.stringify(action)},result=${JSON.stringify(result)},at=clock-${age};
    const input=action==='buy'?{action,modelName:'模型甲',shares:10,expectedUserId:77}:
      {action,roundId:42,direction:'up',betTokens:100,expectedUserId:77};
    const choice=action==='buy'?{action,stockId:1,modelName:'模型甲',shares:10,debit:123,estimate:123,reason:'历史买单'}:
      {action,stockId:1,modelName:'模型甲',roundId:42,direction:'up',betTokens:100,debit:100,reason:'历史预测'};
    const pending={id:'old-'+action,at,retries:0,input,choice,key:'old-'+action+'-request',result,
      beforeShares:0,beforeCost:0,beforeBets:[],beforeOwned:null,...(result?{responseAt:clock-1000}:{})};
    if(result==='success'){
      km.tokens-=choice.debit;
      km.receipts[pending.key]={userId:77,action,idempotencyKey:pending.key,ok:true};
      if(action==='buy')km.view.positions=[{stockId:1,shares:10,costBasisTokens:123,holdUntil:new Date(clock+3600000).toISOString()}];
      else km.view.myBets=[{id:1,roundId:42,direction:'up',betTokens:100,settled:false,createdAt:new Date(at).toISOString()}];
    }
    if(result===null)sessionStorage.setItem('stock:request:77',JSON.stringify({input,idempotencyKey:pending.key}));
    else sessionStorage.removeItem('stock:request:77');
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'历史原请求',hold:false,owned:{},
      entries:[{id:pending.id,at,action,stockId:1,modelName:'模型甲',shares:choice.shares,roundId:choice.roundId,
        debit:choice.debit,result:'reserved'}],pending}));
  }`;
}
