(function(root){
 'use strict';
 const specs=Object.freeze([
  [0,'Cum meter','',1,1,1,1],
  [1,'Timer (seconds)','LastObjective_Timer',300,300,300,10800],
  [2,'Strokes','LastObjective_Strokes',1000,50,100,20000],
  [3,'Edges','LastObjective_Edges',2,1,2,100],
  [6,'Prejac (seconds)','LastObjective_Prejac',60,30,30,600],
  [7,'Tribute','LastObjective_Tribute',2,1,2,20],
  [8,'Succu Slayer','LastObjective_SuccuSlayer',5,5,5,100]
 ].map(([objective,title,saveKey,defaultTarget,sliderStep,min,max])=>Object.freeze({objective,title,saveKey,defaultTarget,sliderStep,min,max})));
 const round=value=>Math.floor(value+.5),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function getSelectedIndex(settings={}){const v=settings.LastObjectiveIndex_Classic??0;return Number.isFinite(v)?round(clamp(v,0,specs.length-1)):0;}
 function getSavedTarget(settings={},index){const s=specs[index];if(!s)return 0;if(s.objective===0)return 1;const v=settings[s.saveKey]??s.defaultTarget;return Number.isFinite(v)?round(clamp(v,s.min,s.max)):s.defaultTarget;}
 function baselines(player={},stats={}){return {baselineDuration:player.sessionLength??0,baselineStrokes:stats.strokes??0,baselineEdges:stats.edges??0,baselineSuccubi:stats.succubiDefeated??0,baselineMilking:stats.milkingCount??0};}
 function initialize(settings={},player={},stats={}){const index=getSelectedIndex(settings);return {active:true,objective:specs[index].objective,target:getSavedTarget(settings,index),...baselines(player,stats)};}
 function isComplete(state,player,stats,meter){if(!state.active)return false;switch(state.objective){
  case 0:return meter>=1;
  case 1:return player.sessionLength-state.baselineDuration>=state.target;
  case 2:return stats.strokes-state.baselineStrokes>=state.target;
  case 3:return stats.edges-state.baselineEdges>=state.target;
  case 7:return stats.milkingCount-state.baselineMilking>=state.target;
  case 8:return stats.succubiDefeated-state.baselineSuccubi>=state.target;
  default:return false;
 }}
 function isPrejacExpired(state,player){return state.active&&state.objective===6&&player.sessionLength-state.baselineDuration>=state.target;}
 function resetAfterMiss(state,resetSetting,meter){let key;switch(state.objective){
  case 0:return {reset:true,meter:0};
  case 1:key='baselineDuration';break;
  case 3:key='baselineEdges';break;
  case 2:if(resetSetting)key='baselineStrokes';break;
  case 8:if(resetSetting)key='baselineSuccubi';break;
 }
 if(!key)return {reset:false,meter};state[key]=(state[key]+state.target)|0;return {reset:true,meter};
 }
 class Runtime {
  constructor(settings={},player={},stats={}){this.settings=settings;this.state=initialize(settings,player,stats);this.releaseDeadline=null;player.isAllowedToCum=[6,7].includes(this.state.objective);}
  reset(){this.state={active:false,objective:0,target:1,...baselines()};this.releaseDeadline=null;}
  resolveClimax(player,context={}){
   if(context.mode===2&&(!context.playing||context.awaitingNextTrack||context.paused))return [];
   if(context.mode===1&&!['playing','bossRound'].includes(context.phase))return [];
   const state=context.mode===1?context.state:this.state;
   if((context.mode===undefined||context.mode===0||context.mode===1)&&state&&state.active&&state.objective===6){
    if(context.mode===1)return player.sessionLength-state.baselineDuration<=state.target?[{type:'successful-cum'}]:[];
    if(player.hasCame)return [];
    return [{type:player.sessionLength-state.baselineDuration<=state.target?'successful-cum':'premature-cum'}];
   }
   if(context.cardType===5)return [{type:'premature-cum'}];
   return player.hasCame?[]:[{type:player.isAllowedToCum?'successful-cum':'premature-cum'}];
  }
  openReleaseWindow(player,stats,now){if(player.isAllowedToCum||player.hasCame)return [];player.isAllowedToCum=true;stats.cumWindowsHit=((stats.cumWindowsHit??0)+1)|0;this.releaseDeadline=now+60;return [{type:'release-window-opened',seconds:60,card:'CumEventOverride',notification:'Objective complete. 60 second release window.'}];}
  tick(player,stats,meter,now,context={}){
   if(player.hasCame)return [];
   const tower=context.mode===1,eligible=tower?['playing','bossRound'].includes(context.phase):context.mode===undefined||context.mode===0;
   if(!eligible)return [];
   const state=tower?context.state:this.state;if(!state||!state.active)return [];
   if(isPrejacExpired(state,player))return [{type:tower?'round-failed':'premature-cum'}];
   if(!isComplete(state,player,stats,meter))return [];
   if(tower&&context.phase!=='bossRound'||state.objective===7)return [{type:tower?'round-complete':'successful-cum'}];
   return this.openReleaseWindow(player,stats,now);
  }
  expireReleaseWindow(player,stats,meter,now,context={}){
   if(this.releaseDeadline===null||now<this.releaseDeadline)return {meter,events:[]};
   this.releaseDeadline=null;if(player.hasCame)return {meter,events:[]};
   const tower=context.mode===1&&context.phase==='bossRound',classic=(context.mode===undefined||context.mode===0)&&this.state.active;
   if(!tower&&!classic)return {meter,events:[]};
   const state=tower?context.state:this.state;if(!state)return {meter,events:[]};
   player.isAllowedToCum=false;stats.missedCumWindows=((stats.missedCumWindows??0)+1)|0;
   const result=resetAfterMiss(state,this.settings['DoesNotCummingInWindowResetObjective?']??true,meter);
   return {meter:result.meter,events:result.reset?[{type:'objective-reset',overlay:'CumWindowClosedOverlay_Widget',notification:'Release window closed. Objective reset.',requestNextCard:true}]:[{type:tower?'round-complete':'successful-cum'}]};
  }
 }
 const api={specs,getSelectedIndex,getSavedTarget,baselines,initialize,isComplete,isPrejacExpired,resetAfterMiss,Runtime};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceObjectives=api;
})(globalThis);
