(function(root){
 'use strict';
 // Cum overlays (v0.05.1 cooked packages — see
 // docs/parity/evidence/ticket44-loops-overlay-20261111.md). Tick resolution
 // is 60000/1 in every section. AllowedToCumLoopBackground is a Texture2D
 // image, NOT an animation — it is not modeled here; only the animations
 // are. NumLoopsToPlay=0 means loop infinitely in UMG PlayAnimation.
 //
 // - SpawnOverlay (AllowedToCumOverlayLoop_Widget): 1.0 s loop, uniform 10%
 //   scale pulse 1.0 → 1.1 → 1.0 with the peak at tick 30041 (~0.501 s),
 //   opacity 1.0 → 0.5 → 1.0 with the trough at the same point, RGB
 //   constant. Played on Construct, loops infinitely while visible.
 // - Idle (CumInXSec / CumWithinXSec overlays): 60233 ticks ≈ 1.004 s,
 //   infinite loop, vertical-only 5% pulse — ScaleY 1.0 → 1.05 → 1.0,
 //   ScaleX constant 1.0. The 60233-tick duration is recorded verbatim;
 //   do not round it to 60000.
 // - SpawnAnim (same widgets): 30000 ticks = 0.5 s, plays once — uniform
 //   5% scale pulse 1.0 → 1.05 → 1.0 plus an opacity fade-in 0.0 → 1.0,
 //   plus the engine SoundWave Enter_Simulate on spawn (audio is not
 //   modeled — the player has no sound asset for it).
 //
 // Favorite Frenzy overlay (FavoriteFrenzySpawnOverlay_Widget, v0.05.1 —
 // see docs/parity/evidence/ticket44-favorites-blueprint-20261111.md).
 // SpawnOverlay 105000 ticks = 1.75 s, plays once (NumLoopsToPlay=1); the
 // event-trigger section fires SequenceEvent at 105000 ticks and the
 // widget's handler removes it from the parent, so the banner lives for
 // exactly 1.75 s. Two layers, both bound in the MovieScene:
 // - Background (the speed-lines image): uniform scale 1.0 → 1.2 → 1.0
 //   over 0.5 s, opacity 0.25 → 1.0 at 0.15 s, then a 0.8/1.0 oscillation
 //   every 0.15 s, fading to 0.0 at 1.75 s. RGB constant 1.0.
 // - Text (the "FAVORITE FRENZY" image, baked black letters decoded from
 //   the DXT5 texture): uniform scale 0.5 → 1.0 → 1.2 → 1.0 → 0.9 → 1.1
 //   over 1.55 s, opacity 0.25 → 1.0 → 0.9 → 1.0 → 0.9 → 1.0 → 0.0 at
 //   1.75 s. RGB dips to 0.9 at 0.5 s and back to 1.0 — a tint dim with no
 //   visible effect on the black letters, so it is recorded, not modeled.
 // FastPaceAnim (UI_Manager, 45281 ticks ≈ 0.7547 s, plays once) animates
 // the "Fast!" text block (TextBlock_2): uniform scale 0.1 → 1.0 → 0.75 →
 // 1.0, rotation 0° → 5° → 1° → -2° → -1° (the near-duplicate keys at
 // 0.25 s / 0.2514 s and 0.5 s / 0.5029 s are sharp jumps, kept verbatim),
 // opacity 1.0 → 0.75 → 1.0 → 0.0, RGB constant (1.0, 0.5, 0.8) — a pink
 // tint. The animation ends at opacity 0, so the label stays invisible
 // until the next special event plays it again.
 //
 // Interpolation between keys is linear. The 60 s release window is NOT
 // modeled here and NOT changed by this module: the countdown progress is
 // bound to the caller's window (objectives.js releaseDeadline), and the
 // window duration stays the player's hard-coded 60 s (objectives.js:52),
 // which the overlay decode does not settle.
 const tickRate=60000;
 const specs={
  spawnOverlay:{durationTicks:60000,loops:0,scaleX:[[0,1],[30041,1.1],[60000,1]],scaleY:[[0,1],[30041,1.1],[60000,1]],opacity:[[0,1],[30041,0.5],[60000,1]]},
  idle:{durationTicks:60233,loops:0,scaleX:[[0,1],[30117,1],[60233,1]],scaleY:[[0,1],[30117,1.05],[60233,1]],opacity:[[0,1],[60233,1]]},
  spawnAnim:{durationTicks:30000,loops:1,scaleX:[[0,1],[15000,1.05],[30000,1]],scaleY:[[0,1],[15000,1.05],[30000,1]],opacity:[[0,0],[30000,1]]},
  frenzyBackground:{durationTicks:105000,loops:1,scaleX:[[0,1],[9000,1.2],[30000,1]],scaleY:[[0,1],[9000,1.2],[30000,1]],opacity:[[0,0.25],[9000,1],[18000,0.8],[27000,1],[36000,0.8],[45000,1],[54000,0.8],[63000,1],[72000,0.8],[105000,0]]},
  frenzyText:{durationTicks:105000,loops:1,scaleX:[[0,0.5],[9000,1],[18000,1.2],[30000,1],[60000,0.9],[93000,1.1]],scaleY:[[0,0.5],[9000,1],[18000,1.2],[30000,1],[60000,0.9],[93000,1.1]],opacity:[[0,0.25],[9000,1],[30000,0.9],[51000,1],[72000,0.9],[93000,1],[105000,0]]},
  fastPace:{durationTicks:45281,loops:1,scaleX:[[0,0.1],[15094,1],[30188,0.75],[45281,1]],scaleY:[[0,0.1],[15094,1],[30188,0.75],[45281,1]],rotation:[[0,0],[15000,5],[15086,1],[30000,-2],[30171,-1]],opacity:[[0,1],[15094,0.75],[30188,1],[45281,0]]}
 };
 function durationMs(name){return specs[name].durationTicks*1000/tickRate;}
 function channelValue(keys,tick){
  if(tick<=keys[0][0])return keys[0][1];
  for(let i=1;i<keys.length;i++){
   if(tick<=keys[i][0]){
    const [t0,v0]=keys[i-1],[t1,v1]=keys[i];
    return v0+(v1-v0)*(tick-t0)/(t1-t0);
   }
  }
  return keys[keys.length-1][1];
 }
 function sample(name,tick){
  const spec=specs[name];if(!spec)throw Error('Unknown overlay animation: '+name);
  let t=tick;
  if(spec.loops===0)t=((t%spec.durationTicks)+spec.durationTicks)%spec.durationTicks;
  else t=Math.min(Math.max(t,0),spec.durationTicks);
  const result={scaleX:channelValue(spec.scaleX,t),scaleY:channelValue(spec.scaleY,t),opacity:channelValue(spec.opacity,t)};
  // Rotation exists only on FastPaceAnim; the older specs have no rotation
  // channel, so their sample shape stays {scaleX, scaleY, opacity}.
  if(spec.rotation)result.rotation=channelValue(spec.rotation,t);
  return result;
 }
 function countdownSample(tick){
  if(tick<specs.spawnAnim.durationTicks)return sample('spawnAnim',tick);
  return sample('idle',tick-specs.spawnAnim.durationTicks);
 }
 function overlayState({isAllowedToCum,releaseDeadline,now,windowSeconds=60,hasCame=false}={}){
  const allowed=!!isAllowedToCum&&!hasCame;
  const countdown=releaseDeadline!==null&&releaseDeadline!==undefined&&now<releaseDeadline&&!hasCame;
  if(!countdown)return {allowed,countdown:false,progress:null,seconds:null};
  const remaining=releaseDeadline-now;
  return {allowed,countdown:true,progress:Math.max(0,Math.min(1,remaining/windowSeconds)),seconds:Math.ceil(remaining)};
 }
 // Favorite Frenzy presentation state (see the header comment): the overlay
 // and the Fast! flash both start at the frenzy draw (startedAt, session
 // seconds) and end at their decoded durations — 1.75 s for the overlay,
 // 45281 ticks for the flash. The CSS keyframes in play.css carry the
 // curves; these functions only say whether each element is visible, with
 // the layer samples returned for testing.
 function frenzyOverlayState({startedAt,now}={}){
  const elapsed=Number.isFinite(startedAt)&&Number.isFinite(now)?now-startedAt:NaN;
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=specs.frenzyText.durationTicks/tickRate)return {visible:false,background:null,text:null};
  const tick=elapsed*tickRate;
  return {visible:true,background:sample('frenzyBackground',tick),text:sample('frenzyText',tick)};
 }
 function fastPaceState({startedAt,now}={}){
  const elapsed=Number.isFinite(startedAt)&&Number.isFinite(now)?now-startedAt:NaN;
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=specs.fastPace.durationTicks/tickRate)return {visible:false,sample:null};
  return {visible:true,sample:sample('fastPace',elapsed*tickRate)};
 }
 // Map-window warnings (UMusicModeManager, v0.05.1 — see
 // docs/parity/evidence/ticket51-queue-consumer-20261111.md). The countdown
 // text is the original's exact wording, recovered from the native getters
 // (GetCumInText / GetCumWithinText / GetBreakDisableWarningText) — see the
 // exact-text functions below.
 //
 // - Warning leads (constructor 0x1482ce640, verified in the v0.05.1 exe):
 //   +0x60 = 30.0 s for the cum window, +0x68 = 10.0 s for break-disable.
 //   EvaluateNotificationWarnings (0x1482decf0) copies them to +0x580 /
 //   +0x5b0 when it schedules a warning (+0x570/+0x578 = window start/end,
 //   +0x5a8 = next disable_break time).
 // - CumIn (GetCumWindowWarningProgress 0x1482e94e0): the progress fills as
 //   the window approaches: clamp(1 - max(start-now,0)/30, 0, 1), 0 when
 //   there is no window (start < 0) or the lead is <= 0.
 //   GetCumWindowWarningRemainingSeconds 0x1482e9570: start < 0 ? -1 :
 //   max(start-now, 0).
 // - CumWithin (GetCumWithinProgress 0x1482e96e0 / RemainingSeconds
 //   0x1482e9870): over the event-history entry containing now, the
 //   progress drains: clamp(max(end-now,0)/(end-start), 0, 1); the
 //   remaining seconds are max(end-now, 0), or -1 / 0 when no entry
 //   contains now.
 // - BreakDisable (GetBreakDisableWarningProgress 0x1482e6de0): the same
 //   shape as CumIn over the next disable_break time and its 10 s lead.
 const CUM_WARNING_LEAD_SECONDS=30,BREAK_DISABLE_WARNING_LEAD_SECONDS=10;
 const clamp01=value=>Math.max(0,Math.min(1,value));
 function cumInWarning({now,windowStart}={}){
  if(!Number.isFinite(now)||!Number.isFinite(windowStart))return {active:false,seconds:-1,progress:0};
  const remaining=windowStart-now;
  return {active:windowStart>=0&&remaining>=0&&remaining<=CUM_WARNING_LEAD_SECONDS,seconds:windowStart<0?-1:Math.max(remaining,0),progress:windowStart<0?0:clamp01(1-Math.max(remaining,0)/CUM_WARNING_LEAD_SECONDS)};
 }
 function cumWithinWarning({now,windowStart,windowEnd}={}){
  if(![now,windowStart,windowEnd].every(Number.isFinite))return {active:false,seconds:-1,progress:0};
  const inside=windowStart>=0&&windowEnd>=windowStart&&now>=windowStart&&now<=windowEnd;
  const remaining=windowEnd-now,length=windowEnd-windowStart;
  return {active:inside,seconds:inside?Math.max(remaining,0):-1,progress:inside&&length>0?clamp01(Math.max(remaining,0)/length):0};
 }
 function breakDisableWarning({now,disableTime}={}){
  if(!Number.isFinite(now)||!Number.isFinite(disableTime))return {active:false,seconds:-1,progress:0};
  const remaining=disableTime-now;
  return {active:disableTime>=0&&remaining>=0&&remaining<=BREAK_DISABLE_WARNING_LEAD_SECONDS,seconds:disableTime<0?-1:Math.max(remaining,0),progress:disableTime<0?0:clamp01(1-Math.max(remaining,0)/BREAK_DISABLE_WARNING_LEAD_SECONDS)};
 }
 function nextMapWindow(events=[],now=0){
  const starts=[],ends=[];let disableTime=-1;
  for(const event of events||[]){
   if(!event||!Number.isFinite(event.time))continue;
   if(event.type==='cum_event'&&event.value==='start')starts.push(event.time);
   else if(event.type==='cum_event'&&event.value==='end')ends.push(event.time);
   else if(event.type==='disable_break'&&event.value==='start'&&event.time>=now&&(disableTime<0||event.time<disableTime))disableTime=event.time;
  }
  starts.sort((a,b)=>a-b);ends.sort((a,b)=>a-b);
  let windowStart=-1,windowEnd=-1;
  for(const start of starts){
   const end=ends.find(time=>time>=start);
   if(end===undefined)continue;
   if(now<=end){windowStart=start;windowEnd=end;break;}
  }
  return {windowStart,windowEnd,disableTime};
 }
 function mapWindowWarnings({now,events}={}){
  const {windowStart,windowEnd,disableTime}=nextMapWindow(events,now);
  return {cumIn:cumInWarning({now,windowStart}),cumWithin:cumWithinWarning({now,windowStart,windowEnd}),breakDisable:breakDisableWarning({now,disableTime})};
 }
 // Exact warning text (UMusicModeManager native getters, v0.05.1 exe
 // a8f46896 — see docs/parity/evidence/ticket51-queue-consumer-20261111.md).
 // The widget bindings are GetText -> GetCumInText / GetCumWithinText
 // (CumInXSecWidgetOverlay / CumWithinXSecWidgetOverlay, cooked packages);
 // both getters are native UMusicModeManager methods returning FString.
 //
 // - GetCumInText 0x1482e8f40: '' when +0x570 < 0 or (start - now) <= 0,
 //   else FString::PrintfImpl('CUM IN: %d SEC', n).
 // - GetCumWithinText 0x1482e99b0: '' unless the internal gate holds
 //   (+0x2f0 != 0, +0x4e9 != 0, +0x4eb == 0, +0x4f0 > 0, +0x4f0 >= +0x4ec)
 //   and a +0x238 history entry contains now and (end - now) > 0, else
 //   FString::PrintfImpl('CUM WITHIN: %d SEC', n). The gate's internal
 //   flags have no player-observable counterpart, so the player's
 //   containing-window condition is the observable equivalent.
 // - GetBreakDisableWarningText 0x1482e6ed0: '' when +0x5a8 < 0;
 //   'BREAKS DISABLED IN %s' while (disable - now) > 0; 'BREAKS DISABLED'
 //   once the disable is in effect. The %s is the duration helper below.
 // - The %d in both cum getters is floor(remaining + 0.75): both getters
 //   compute it as cvtsd2si(-0.5 - 2r), arithmetic shift right 1, negate,
 //   clamp at 0, with the -0.5 double at 0x14bf8d1d8. Verified equal to
 //   floor(r + 0.75) on a 200k random sweep (0 mismatches).
 // - Duration helper 0x1482dfe90: same floor(r + 0.75) total seconds, then
 //   '%d:%02d:%02d' (H:MM:SS) when hours > 0, '%02d:%02d' (MM:SS) otherwise.
 //   Also used by GetCumWindowWarningText ('CUM WINDOW IN %s' /
 //   'CUM WINDOW OPEN: %s', 0x1482e95d0) and GetCumWindowCountdownString
 //   ('CUM NOW: %s' / 'CUE %d/%d IN/OPEN: %s' / 'FINAL CUE IN/OPEN: %s',
 //   0x1482e8fe0) — those getters have no retained Blueprint caller and no
 //   player surface, so they are recorded, not wired.
 function displaySeconds(remaining){return Math.max(0,Math.floor(remaining+0.75));}
 function durationText(remaining){
  const total=displaySeconds(remaining);
  const hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
  const mm=String(minutes).padStart(2,'0'),ss=String(seconds).padStart(2,'0');
  return hours>0?`${hours}:${mm}:${ss}`:`${mm}:${ss}`;
 }
 function cumInText({now,windowStart}={}){
  if(!Number.isFinite(now)||!Number.isFinite(windowStart))return '';
  if(windowStart<0||windowStart-now<=0)return '';
  return `CUM IN: ${displaySeconds(windowStart-now)} SEC`;
 }
 function cumWithinText({now,windowStart,windowEnd}={}){
  if(![now,windowStart,windowEnd].every(Number.isFinite))return '';
  if(!(windowStart>=0&&windowEnd>=windowStart&&now>=windowStart&&now<=windowEnd))return '';
  return `CUM WITHIN: ${displaySeconds(windowEnd-now)} SEC`;
 }
 function breakDisableText({now,disableTime}={}){
  if(!Number.isFinite(now)||!Number.isFinite(disableTime))return '';
  if(disableTime<0)return '';
  const remaining=disableTime-now;
  return remaining>0?`BREAKS DISABLED IN ${durationText(remaining)}`:'BREAKS DISABLED';
 }
 function mapWindowWarningTexts({now,events}={}){
  const {windowStart,windowEnd,disableTime}=nextMapWindow(events,now);
  return {cumIn:cumInText({now,windowStart}),cumWithin:cumWithinText({now,windowStart,windowEnd}),breakDisable:breakDisableText({now,disableTime})};
 }
 const api={tickRate,specs,durationMs,sample,countdownSample,overlayState,frenzyOverlayState,fastPaceState,CUM_WARNING_LEAD_SECONDS,BREAK_DISABLE_WARNING_LEAD_SECONDS,cumInWarning,cumWithinWarning,breakDisableWarning,nextMapWindow,mapWindowWarnings,displaySeconds,durationText,cumInText,cumWithinText,breakDisableText,mapWindowWarningTexts};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceOverlays=api;
})(globalThis);
