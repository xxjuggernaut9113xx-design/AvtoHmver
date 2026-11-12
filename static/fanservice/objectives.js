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
 // Release-window duration (GM ubergraph, CumEventOverride decode,
 // 2026-11-11): Start Cum Window Timer notifies 'Cum Meter Filled' /
 // '60s Release Window\r\nFinish to Win' and Set and Display Cum Window
 // Timer (re)initializes CumWindowTime = 60.0. The 60 s is a constant in
 // the original, not the map's cum_event window (14.9–52.8 s) and not a
 // computed value; the override body itself (CumEventOverride, entry
 // 73198) spawns a Cum card and starts a beat pattern and carries no
 // duration or timer of its own.
 const RELEASE_WINDOW_SECONDS=60;
 // Card-type gate for the release window (Determine And Trigger Cum Meter
 // Override Event, BP_GlobalManager ubergraph, v0.05.1, live block
 // @92330-93214): when 'Is Succu Frenzy Active' is false the trigger
 // proceeds only when the current card type is NOT Edging (5), Cum (6) or
 // Succubus (3); when Frenzy is active it proceeds only for a Succubus card
 // (3). The dead trigger function has no frenzy type check; the live block
 // governs. A card type the player does not know yet (undefined) is not in
 // the excluded set, so it passes — the window is never blocked for lack of
 // a current card.
 const TRIGGER_GATE_EXCLUDED=new Set([3,5,6]);
 function cumWindowTriggerGate(context={}){
  if((context.modifiers||[]).includes('Succufrenzy'))return context.cardType===3;
  return !TRIGGER_GATE_EXCLUDED.has(context.cardType);
 }
 // Expiry notification titles (Set and Display Cum Window Timer, GM ubergraph,
 // v0.05.1): each objective case notifies '<Objective> Reset'.
 const RESET_NOTIFICATIONS={0:'Cum Meter Reset',1:'Timer Reset',2:'Strokes Reset',3:'Edges Reset',8:'Succubi Reset'};
 // GM-side objective clock (BP_GlobalManager, v0.05.1, cooked package —
 // docs/parity/evidence/ticket45-objective-clock-20261112.md). Two
 // separate 1 s looping timers share one integer counter,
 // PlayerVariablesStruct.SessionLength:
 // - SetSessionDurationHandle (rate 1.0, looping, first fire 1.0 s;
 //   ubergraph stmts 586-588, entry 92328 -> stmts 2327-2328) calls
 //   SetSessionDuration() once per second: the Devil guard counts the
 //   second ONLY when 'Deal with the Devil' is inactive, or the current
 //   card is Succubus (3); a guarded-out second also skips the
 //   PercentAtHighHeat / TimeAtHighHeat metric updates.
 // - FormatSessionDurationTextHandle (rate 1.0, looping, first fire 0.5 s;
 //   stmts 589-591, entry 94452 -> stmts 2364-2400) formats the duration
 //   text and checks completion against the same counter: Timer
 //   (stmts 2378-2380, SessionLength >= Objective_TimeRequired_Seconds)
 //   enters the trigger block at 92333, and Prejac (stmts 2381-2388)
 //   clears BOTH handles and calls EndSession() directly — no trigger
 //   block, no release window. The beat-driven trigger has no Timer or
 //   Prejac case, so neither completes on beat advance.
 // The player keeps a separate gmSeconds counter for this clock: the
 // wall-clock player.sessionLength stays the PM-side rewards clock
 // (unguarded, never stopped at Prejac expiry), which PrepareSessionRewards
 // / CalculateSessionXP use. The two clocks agree unless the Devil guard
 // holds seconds back or Prejac stops the GM clock.
 function gmSecondCounts(context={}){
  return !(context.modifiers||[]).includes('Deal With The Devil')||context.cardType===3;
 }
 function gmElapsed(state,gmSeconds){return gmSeconds-(state.baselineGmSeconds??state.baselineDuration??0);}
 function getSelectedIndex(settings={}){const v=settings.LastObjectiveIndex_Classic??0;return Number.isFinite(v)?round(clamp(v,0,specs.length-1)):0;}
 function getSavedTarget(settings={},index){const s=specs[index];if(!s)return 0;if(s.objective===0)return 1;const v=settings[s.saveKey]??s.defaultTarget;return Number.isFinite(v)?round(clamp(v,s.min,s.max)):s.defaultTarget;}
 function baselines(player={},stats={},gmSeconds){return {baselineDuration:player.sessionLength??0,baselineStrokes:stats.strokes??0,baselineEdges:stats.edges??0,baselineSuccubi:stats.succubiDefeated??0,baselineMilking:stats.milkingCount??0,baselineGmSeconds:gmSeconds??player.sessionLength??0};}
 function initialize(settings={},player={},stats={},gmSeconds){const index=getSelectedIndex(settings);return {active:true,objective:specs[index].objective,target:getSavedTarget(settings,index),...baselines(player,stats,gmSeconds)};}
 function isComplete(state,player,stats,meter,gmSeconds){if(gmSeconds===undefined)gmSeconds=player.sessionLength;if(!state.active)return false;switch(state.objective){
  case 0:return meter>=1;
  case 1:return gmElapsed(state,gmSeconds)>=state.target;
  case 2:return stats.strokes-state.baselineStrokes>=state.target;
  case 3:return stats.edges-state.baselineEdges>=state.target;
  case 7:return stats.milkingCount-state.baselineMilking>=state.target;
  case 8:return stats.succubiDefeated-state.baselineSuccubi>=state.target;
  default:return false;
 }}
 function isPrejacExpired(state,player,gmSeconds){if(gmSeconds===undefined)gmSeconds=player.sessionLength;return state.active&&state.objective===6&&gmElapsed(state,gmSeconds)>=state.target;}
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
  constructor(settings={},player={},stats={}){this.settings=settings;this.gmSeconds=0;this.gmStopped=false;this.state=initialize(settings,player,stats);this.releaseDeadline=null;player.isAllowedToCum=[6,7].includes(this.state.objective);}
  reset(){this.state={active:false,objective:0,target:1,...baselines()};this.releaseDeadline=null;this.gmSeconds=0;this.gmStopped=false;}
  resolveClimax(player,context={},gmSeconds){
   if(gmSeconds===undefined)gmSeconds=player.sessionLength;
   if(player.hasCame)return [];
   if(context.mode===2&&(!context.playing||context.awaitingNextTrack||context.paused))return [];
   if(context.mode===1&&!['playing','bossRound'].includes(context.phase))return [];
   const state=context.mode===1?context.state:this.state;
   if((context.mode===undefined||context.mode===0||context.mode===1)&&state&&state.active&&state.objective===6){
    if(context.mode===1)return gmElapsed(state,gmSeconds)<=state.target?[{type:'successful-cum'}]:[];
    if(player.hasCame)return [];
    return [{type:gmElapsed(state,gmSeconds)<=state.target?'successful-cum':'premature-cum'}];
   }
   if(context.cardType===5)return [{type:'premature-cum'}];
   return player.hasCame?[]:[{type:player.isAllowedToCum?'successful-cum':'premature-cum'}];
  }
  openReleaseWindow(player,stats,now){if(player.isAllowedToCum||player.hasCame)return [];player.isAllowedToCum=true;stats.cumWindowsHit=((stats.cumWindowsHit??0)+1)|0;this.releaseDeadline=now+RELEASE_WINDOW_SECONDS;return [{type:'release-window-opened',seconds:RELEASE_WINDOW_SECONDS,card:'CumEventOverride',notification:'60s Release Window\nFinish to Win'}];}
  finishCompleteObjective(player,stats,meter,now,context,state){
   const tower=context.mode===1;
   if(tower&&context.phase!=='bossRound'||state.objective===7)return [{type:tower?'round-complete':'successful-cum'}];
   if(!cumWindowTriggerGate(context))return [];
   return this.openReleaseWindow(player,stats,now);
  }
  tick(player,stats,meter,now,context={}){
   if(player.hasCame)return [];
   const tower=context.mode===1,eligible=tower?['playing','bossRound'].includes(context.phase):context.mode===undefined||context.mode===0;
   if(!eligible)return [];
   const state=tower?context.state:this.state;if(!state||!state.active)return [];
   // Timer (1) and Prejac (6) complete on the GM-side 1 s clock
   // (tickSecond), never on beat advance — the trigger function has no
   // case for either; only 0/2/3/7/8 complete here.
   if(state.objective===1||state.objective===6)return [];
   if(!isComplete(state,player,stats,meter,this.gmSeconds))return [];
   return this.finishCompleteObjective(player,stats,meter,now,context,state);
  }
  // One GM-clock second: the SetSessionDuration increment (Devil-guarded)
  // followed by the Format Session Duration Text completion checks, in
  // the native order (duration tick then format tick, half a second apart;
  // the player evaluates both at the same whole-second boundary — a
  // sub-second phase difference, not a threshold difference).
  // Returns {events, counted}: counted is 1 when the second counted
  // towards the GM clock, 0 when the Devil guard held it back or the
  // clock was already stopped. Callers use counted for the
  // TimeAtHighHeat metric, which the native tick updates only on a
  // counted second while Heat Level >= 70.
  tickSecond(player,stats,meter,now,context={}){
   if(player.hasCame||this.gmStopped)return {events:[],counted:0};
   const counted=gmSecondCounts(context)?1:0;
   if(counted)this.gmSeconds+=1;
   const tower=context.mode===1,eligible=tower?['playing','bossRound'].includes(context.phase):context.mode===undefined||context.mode===0;
   if(!eligible)return {events:[],counted};
   const state=tower?context.state:this.state;if(!state||!state.active)return {events:[],counted};
   if(state.objective===6){
    if(isPrejacExpired(state,player,this.gmSeconds)){this.gmStopped=true;return {events:[{type:tower?'round-failed':'premature-cum'}],counted};}
    return {events:[],counted};
   }
   if(state.objective!==1)return {events:[],counted};
   // While the release window is open the format tick only refreshes the
   // '{sec} Sec Left' text (ubergraph stmts 2373-2374 -> 2340-2352); it
   // does not re-check completion or re-trigger.
   if(player.isAllowedToCum)return {events:[],counted};
   if(!isComplete(state,player,stats,meter,this.gmSeconds))return {events:[],counted};
   return {events:this.finishCompleteObjective(player,stats,meter,now,context,state),counted};
  }
  expireReleaseWindow(player,stats,meter,now,context={}){
   if(this.releaseDeadline===null||now<this.releaseDeadline)return {meter,events:[]};
   this.releaseDeadline=null;if(player.hasCame)return {meter,events:[]};
   const tower=context.mode===1&&context.phase==='bossRound',classic=(context.mode===undefined||context.mode===0)&&this.state.active;
   if(!tower&&!classic)return {meter,events:[]};
   const state=tower?context.state:this.state;if(!state)return {meter,events:[]};
   player.isAllowedToCum=false;stats.missedCumWindows=((stats.missedCumWindows??0)+1)|0;
   const result=resetAfterMiss(state,this.settings['DoesNotCummingInWindowResetObjective?']??true,meter);
   return {meter:result.meter,events:result.reset?[{type:'objective-reset',overlay:'CumWindowClosedOverlay_Widget',notification:RESET_NOTIFICATIONS[state.objective]||'Release window closed. Objective reset.',requestNextCard:true}]:[{type:tower?'round-complete':'successful-cum'}]};
  }
 }
 const api={specs,getSelectedIndex,getSavedTarget,baselines,initialize,isComplete,isPrejacExpired,resetAfterMiss,gmSecondCounts,Runtime};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceObjectives=api;
})(globalThis);
