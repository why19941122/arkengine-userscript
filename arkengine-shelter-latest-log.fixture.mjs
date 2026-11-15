import {readFileSync} from 'node:fs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

export const latestDiagnostic=JSON.parse(readFileSync(new URL('./arkengine-shelter-latest-log.fixture.json',import.meta.url),'utf8'));
export function latestFamilyScene(trainStat){
  const data=structuredClone(latestDiagnostic),view=campaignView(data.source.snapshotAt),s=view.state;
  // 诊断重建而非原始view回放：未记录的生产加成设0，活动/装备留空，结算时点固定为快照。
  // 仅隔离人员接替，关闭新外出/养成/建设；训练属性由用例明确注入，不猜原账号的训练属性。
  s.residents=data.residents.map(p=>({...p,romance:p.romance?.partnerId?p.romance:null}));
  s.rooms=data.rooms;s.resources=data.summary.resources;s.births=data.births;s.items=[];
  s.depth=Math.max(...s.rooms.map(r=>r.floor));s.legacy={perks:{}};view.env.events=[];
  view.progress=data.summary.levelProgress;
  if(trainStat)s.rooms.find(r=>r.id===44).trainStat=trainStat;
  const families=[...new Map(s.residents.filter(p=>p.family).map(p=>[`${p.family.a}/${p.family.b}`,p.family])).values()];
  return {view,state:{families,campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}}};
}
