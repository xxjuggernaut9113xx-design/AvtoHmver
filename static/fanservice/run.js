(function(root){
 'use strict';
 const load=(name,global)=>typeof module!=='undefined'&&module.exports?require('./'+name+'.js'):root[global];
 const Objectives=load('objectives','FanserviceObjectives'),Tower=load('tower','FanserviceTower'),Inventory=load('inventory','FanserviceInventory'),Items=load('items','FanserviceItems'),Economy=load('economy','FanserviceEconomy'),Cards=load('cards','FanserviceCards'),Edge=load('edge','FanserviceEdge');
 const copy=value=>JSON.parse(JSON.stringify(value));
 class Run {
  constructor(catalog,config={}){
   this.catalog=catalog;this.config={mode:0,rounds:3,endless:false,settings:{},seed:1,difficulty:1,lootEnabled:false,...copy(config)};
   if(![0,1,2].includes(this.config.mode))throw Error('Choose a supported gameplay mode.');
   if(![0,1,2].includes(this.config.difficulty)||typeof this.config.lootEnabled!=='boolean')throw Error('Choose a supported difficulty and loot setting.');
   if(!Number.isSafeInteger(this.config.rounds)||this.config.rounds<1||this.config.rounds>1000)throw Error('Choose between 1 and 1000 Tower rounds.');
   this.random=new Tower.Random(this.config.seed);
   this.inventory=Items.prepare(catalog,this.config.mode,this.random,{hotbar:this.config.hotbar});
   this.ownedModifiers=[];this.redeemedRounds=[];
   this.state={strokes:0,combo:0,maxCombo:0,coins:0,succuCoins:0,heat:0,meter:0,baseGain:.00025,meterMultiplier:1,seconds:0,edges:0,succubi:0,milkingCount:0,card:0,modifiers:[...(this.config.modifiers||[])],finished:false,canUseItems:true,canUseSlowdown:true,canUseBonerPill:true,coinMultiplier:1,lootBarMultiplier:1,metrics:{},effects:{}};
   this.player={sessionLength:0,hasCame:false,isAllowedToCum:false};
   this.objective=new Objectives.Runtime(this.config.settings,this.player,this.objectiveStats());
   this.phase=this.config.mode===1?'selection':'playing';
   Economy.initialize(this);
   if(this.config.mode===1){
    this.tower=new Tower.Tower(catalog,this.config.rounds,this.config.seed,this.config.endless,{inventory:this.inventory,ownedModifiers:this.ownedModifiers,rewardRules:Inventory});
    this.shopEvery=this.config.rounds<=3?1:Math.max(1,Math.min(4,Math.floor(Math.sqrt(this.config.rounds)+.5)));
   }
  }
  objectiveStats(){const s=this.state;return {strokes:s.strokes,edges:s.edges,succubiDefeated:s.succubi,milkingCount:s.milkingCount,cumWindowsHit:s.CumWindowsHit||0,missedCumWindows:s.MissedCumWindows||0};}
  context(){return {mode:this.config.mode,phase:this.tower&&!this.tower.endless&&this.tower.round>=this.tower.rounds?'bossRound':this.phase,state:this.roundObjective,playing:this.phase==='playing',cardType:this.state.card};}
  select(index){
   if(!this.tower||this.phase!=='selection')throw Error('No Tower draft is active.');
   const selected=this.tower.select(index);
   this.roundStart=copy(this.state);this.roundObjective={active:true,objective:selected.objective,target:selected.parameter,...Objectives.baselines(this.player,this.objectiveStats())};
   this.state.meter=0;this.state.modifiers=[...selected.modifiers];this.player.hasCame=false;this.player.isAllowedToCum=[6,7].includes(selected.objective);this.objective.releaseDeadline=null;this.phase='playing';return selected;
  }
  advance(seconds){
   if(this.phase!=='playing'||this.state.finished||!Number.isFinite(seconds)||seconds<0)return [];
   Economy.advance(this,seconds);this.state.seconds+=seconds;this.player.sessionLength=this.state.seconds;
   const edge=Edge.advance(this),cards=Cards.advance(this);
   const stats=this.objectiveStats(),context=this.context();
   const expired=this.objective.expireReleaseWindow(this.player,stats,this.state.meter,this.state.seconds,context);
   this.state.meter=expired.meter;
   const events=expired.events.length?expired.events:this.objective.tick(this.player,stats,this.state.meter,this.state.seconds,context);
   this.state.CumWindowsHit=stats.cumWindowsHit;this.state.MissedCumWindows=stats.missedCumWindows;
   return [...edge,...cards,...this.applyEvents(events)];
  }
  beat(){return Economy.beat(this);}
  edge(){return [...Edge.trigger(this),...this.advance(0)];}
  continueEdgeRest(){return Edge.continueRest(this);}
  mercy(accept){return Edge.mercy(this,accept);}
  cancelEdge(){return Edge.cancel(this);}
  startCard(pool){return Cards.start(this,pool);}
  delayCard(seconds){return Cards.delay(this,seconds);}
  modifyCard(speed,factor=1){return Cards.rebuild(this,speed,factor);}
  tribute(){
   const objective=this.roundObjective||this.objective.state;
   if(this.phase!=='playing'||this.state.finished||this.player.hasCame||objective?.objective!==7||this.state.modifiers.includes('Deal With The Devil')&&this.state.card!==3)return [];
   this.state.milkingCount=((this.state.milkingCount||0)+1)|0;
   return [{type:'tribute-recorded'},...this.advance(0)];
  }
  climax(){if((this.roundObjective||this.objective.state)?.objective===7)return this.tribute();return this.applyEvents(this.objective.resolveClimax(this.player,this.context()));}
  applyEvents(events){
   for(const event of events){
    if(event.type==='release-window-opened'){Edge.cancel(this);this.state.card=6;}
    else if(event.type==='round-complete'||event.type==='round-failed')this.completeRound(event.type==='round-complete');
    else if(event.type==='successful-cum'||event.type==='premature-cum'){
     if(this.tower)this.completeRound(event.type==='successful-cum');
     else{Edge.cancel(this);this.player.hasCame=true;this.state.won=event.type==='successful-cum';this.phase='complete';}
    }
   }
   return events;
  }
  completeRound(success){
   if(!this.tower||this.phase!=='playing')return false;
   const start=this.roundStart,s=this.state,metric=key=>(s[key]||0)-(start[key]||0);
   Edge.cancel(this);
   this.tower.complete(success,{seconds:metric('seconds'),edges:metric('edges'),defensive:metric('DefensiveItemsUsed'),offensive:metric('OffensiveItemsUsed'),taunts:metric('TimesTaunted'),temptations:metric('AcceptedTemptation')});
   if(success&&!this.redeemedRounds.includes(this.tower.round)){
    for(const reward of this.tower.selected.native_rewards||[]){
     if(reward.type===0)s.coins=(s.coins+reward.amount)|0;
     else if(reward.type===1)s.succuCoins=(s.succuCoins+reward.amount)|0;
     else if(reward.type===2)this.inventory.unlock(reward.item);
     else if(reward.type===3)this.inventory.upgrade(reward.item);
     else if(reward.type===5&&!this.ownedModifiers.includes(reward.modifier))this.ownedModifiers.push(reward.modifier);
    }
    this.redeemedRounds.push(this.tower.round);
   }
   if(this.tower.phase==='complete'){
    s.won=this.tower.failed===0;if(s.won)s.BestTowerWinRounds=this.tower.completed;this.phase='complete';
   }else this.phase=this.tower.round%this.shopEvery===0?'shop':'round-complete';
   return true;
  }
  continue(){if(!this.tower||!['shop','round-complete'].includes(this.phase))throw Error('Complete the current round first.');this.tower.continue();this.phase='selection';return this.tower.options;}
  export(){
   const tower=this.tower?copy({rounds:this.tower.rounds,endless:this.tower.endless,round:this.tower.round,history:this.tower.history,recent:this.tower.recent,completed:this.tower.completed,failed:this.tower.failed,phase:this.tower.phase,options:this.tower.options,selected:this.tower.selected,seed:this.tower.random.seed}):null;
   return copy({version:1,config:this.config,state:this.state,player:this.player,phase:this.phase,inventory:this.inventory.export(),ownedModifiers:this.ownedModifiers,redeemedRounds:this.redeemedRounds,randomSeed:this.random.seed,tower,shopEvery:this.shopEvery,roundStart:this.roundStart,roundObjective:this.roundObjective,objective:{settings:this.objective.settings,state:this.objective.state,releaseDeadline:this.objective.releaseDeadline}});
  }
  static restore(catalog,saved){
   if(saved?.version!==1||!saved.config||!saved.state||!saved.player||!Array.isArray(saved.inventory?.ownedItems))throw Error('Saved mobile session is invalid or unsupported.');
   const run=Object.create(Run.prototype);Object.assign(run,copy(saved));run.catalog=catalog;
   run.inventory=new Inventory.Inventory(saved.inventory);run.inventory.catalog=Items.catalog(catalog);run.random=new Tower.Random(saved.randomSeed);
   run.objective=Object.assign(Object.create(Objectives.Runtime.prototype),copy(saved.objective));
   if(saved.tower){run.tower=Object.assign(Object.create(Tower.Tower.prototype),copy(saved.tower),{catalog,inventory:run.inventory,ownedModifiers:run.ownedModifiers,rewardRules:Inventory,random:new Tower.Random(saved.tower.seed)});}
   return run;
  }
 }
 const api={Run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceRun=api;
})(globalThis);
