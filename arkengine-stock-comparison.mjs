import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {replayStock,stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';
import {stockEventsFromSnapshots,labelStockReplay} from './arkengine-stock-events.mjs';

// Each run has its own account. Stream optional full reports instead of retaining 84 event ledgers.
export function compareStockStrategies(input,{stress=false,missingStartIndex,onReport,onEventStudy}={}){
  if(!input||!Array.isArray(input.snapshots)||!input.snapshots.length||typeof stress!=='boolean'||
    onReport!==undefined&&typeof onReport!=='function'||onEventStudy!==undefined&&typeof onEventStudy!=='function'||
    input.strategy!==undefined||input.exitPriceHaircutBps!==undefined)
    throw Error('Invalid stock comparison input; candidate and haircut are fixed by the matrix');
  if(stress&&(!Number.isInteger(missingStartIndex)||missingStartIndex<1||missingStartIndex+1>=input.snapshots.length-1))
    throw Error('Stress comparison requires a predeclared interior pair of missing observations');
  const strategies=[{candidate:'S0'},{candidate:'S3'},...['fixed','risk'].flatMap(exitMode=>
    ['S1','S2'].flatMap(candidate=>[60,120,240].map(holdMinutes=>({candidate,holdMinutes,exitMode}))))];
  const scenarios=[{id:'normal',extraDelayMs:0,haircutBps:0,drop:[]},...(stress?[
    {id:'delay-5m',extraDelayMs:300000,haircutBps:0,drop:[]},
    {id:'delay-10m',extraDelayMs:600000,haircutBps:0,drop:[]},
    {id:'exit-minus-1pct',extraDelayMs:0,haircutBps:100,drop:[]},
    {id:'exit-minus-3pct',extraDelayMs:0,haircutBps:300,drop:[]},
    {id:'missing-two',extraDelayMs:0,haircutBps:0,drop:[missingStartIndex,missingStartIndex+1]}
  ]:[])],runs=[],eventStudies=[];
  const hash=x=>createHash('sha256').update(x).digest('hex');
  const at=s=>typeof s.at==='number'?s.at:Date.parse(s.at);
  for(const scenario of scenarios){
    const snapshots=input.snapshots.filter((_,i)=>!scenario.drop.includes(i));
    const events=stockEventsFromSnapshots(snapshots),eventStudySha256=hash(JSON.stringify(events));
    eventStudies.push({scenario:scenario.id,sha256:eventStudySha256,counts:events.counts,observations:events.observations.length});
    if(onEventStudy)onEventStudy(scenario.id,events);
    for(const strategy of strategies){
      const id=[scenario.id,strategy.candidate,...(strategy.holdMinutes?[strategy.holdMinutes,strategy.exitMode]:[])].join('-');
      const result=replayStock({...input,snapshots,strategy,executionDelayMs:(input.executionDelayMs??0)+scenario.extraDelayMs,
        exitPriceHaircutBps:scenario.haircutBps});
      result.researchEvidence={eventStudySha256,eventLabels:labelStockReplay(events,result)};
      const row={id,scenario:scenario.id,strategy:result.simulation.strategy,net:result.net,netInterval:result.netInterval,
        capitalExposure:result.capitalExposure,holdingExposure:result.holdingExposure,turnover:result.turnover,
        feesAndRounding:result.feesAndRounding,execution:result.execution,endingLoss:result.account.ending.loss,
        peakLoss:Math.max(...result.account.curve.map(c=>c.loss)),
        eligibleSignalEvaluations:result.strategy.checks.filter(c=>c.stage==='entry').length,
        blockedSignalEvaluations:result.strategy.checks.filter(c=>c.stage==='entry'&&!c.allowed).length,
        rollingWindows:result.account.rollingWindows,sourceHashes:result.simulation.sourceHashes,eventStudySha256,
        independentOpportunities:result.researchEvidence.eventLabels.summary??null,
        closedNewLotsPerformance:result.researchEvidence.eventLabels.closedNewLotsPerformance??null,
        omittedAt:scenario.drop.map(i=>at(input.snapshots[i])),samples:result.samples,
        longestObservationGapMs:snapshots.slice(1).reduce((n,s,i)=>Math.max(n,at(s)-at(snapshots[i])),0)};
      if(onReport)onReport(id,result);
      runs.push(row);
    }
  }
  for(const row of runs){
    const control=runs.find(c=>c.scenario===row.scenario&&c.strategy.candidate==='S3');
    const known=row.execution.complete&&control.execution.complete;
    row.relativeToS3={lower:known&&row.netInterval.lower!==null&&control.netInterval.upper!==null?row.netInterval.lower-control.netInterval.upper:null,
      upper:known&&row.netInterval.upper!==null&&control.netInterval.lower!==null?row.netInterval.upper-control.netInterval.lower:null};
  }
  return {kind:'offline-candidate-comparison',inputSha256:hash(JSON.stringify(input)),
    comparisonSourceSha256:hash(readFileSync(new URL('./arkengine-stock-comparison.mjs',import.meta.url))),
    eventSourceSha256:hash(readFileSync(new URL('./arkengine-stock-events.mjs',import.meta.url))),eventStudies,
    coverage:{from:at(input.snapshots[0]),to:at(input.snapshots.at(-1)),samples:input.snapshots.length,
      dates:[...new Set(input.snapshots.map(s=>new Date(at(s)+8*3600000).toISOString().slice(0,10)))]},
    scenarios,runs,validation:{qualifiedForLive:false,holdoutPerformed:false,
      reason:'固定候选及压力矩阵仅产生离线组合证据；尚未证明网站日额度、独立留出、样本充分性或实号七天收益。'},
    limitations:['S0退出沿用原源码；研究候选超预留后允许风险退出，差异明确保留。',
      '每组原有仓均用S0退出；候选排序按稳定ID研究假设，无已验证经验收益排序。',
      '缺失两次观察的起点必须事先指定，不能按结果挑选；恢复时快照自带的历史可以从恢复时开始使用。',
      '压力项分别施加，没有声称覆盖组合压力或市场最大损失；eligibleSignalEvaluations仍是刷新次数。独立事件与首笔已完成标签另列，重复交易仍进入组合账本。',
      '汇总只保留结果和区间，完整订单/拒绝/轨迹由onReport或CLI逐组写出，不将所有详细账本同时保留在内存。']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2]||!process.argv[3])throw Error('Usage: node arkengine-stock-comparison.mjs input.json output-directory');
  const input=JSON.parse(readFileSync(process.argv[2],'utf8')),directory=resolve(process.argv[3]);
  const {comparison={},...replay}=input;
  const snapshots=replay.snapshots??stockSnapshotsFromLog(replay);
  mkdirSync(directory,{recursive:true});
  const summary=compareStockStrategies({...replay,snapshots},{...comparison,
    onEventStudy:(id,study)=>writeFileSync(join(directory,id+'-events.json'),JSON.stringify(study,null,2)+'\n'),
    onReport:(id,report)=>writeFileSync(join(directory,id+'.json'),JSON.stringify(report,null,2)+'\n')});
  writeFileSync(join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
}
