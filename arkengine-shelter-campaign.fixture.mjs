export function campaignView(time=2_000_000_000){
  const room=(id,type,col,floor=1,level=3)=>({id,type,col,floor,width:1,level,builtAt:0,upgradeAt:null,stored:0,incident:null,unpowered:false});
  const residents=Array.from({length:6},(_,i)=>({id:i+1,name:`居民${i+1}`,roomId:i<4?i+1:null,away:null,deadAt:null,adultAt:0,xp:i<3?0:147,happiness:100,
    hp:i<3?100:142,stats:{str:8,per:8,end:8,cha:8,int:8,agi:8,lck:8},parents:[],romance:null,familyCooldownUntil:0,weaponId:null,outfitId:null}));
  return {vaultNo:77,serverTime:time,progress:{level:8},switches:{frozen:false},nameRequired:false,
    drops:{enabled:true,minMinutes:360,tierPermille:[50,70],perUserDaily:2},
    env:{week:'2026-W45',events:[],quests:[{id:'w1',title:'旧地铁站',difficulty:1,stages:3,stageMinutes:60,recommendedLevel:1,rewards:{scrap:30,parts:1,itemTier:null,seasonPoints:20}}]},
    state:{lastSettledAt:time,depth:7,digging:null,resources:{scrap:3000,power:400,food:400,water:400,parts:10,stimpak:9},
      stats:{collected:0},legacy:{perks:{}},items:[],births:[],achievements:[],explorers:[],quests:[],weekly:{completed:[]},
      daily:{day:'2026-10-10',claimed:[]},season:{month:'2026-10',points:0,claimedFree:[]},residents,
      rooms:[room(1,'power',2),room(2,'diner',3),room(3,'water',4),room(4,'scrap',5),{...room(5,'quarters',2,2),width:2},room(6,'storage',6),
        ...Array.from({length:7},(_,i)=>room(10+i,'elevator',1,i+1,1))]}};
}
