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
 // Interpolation between keys is linear. The 60 s release window is NOT
 // modeled here and NOT changed by this module: the countdown progress is
 // bound to the caller's window (objectives.js releaseDeadline), and the
 // window duration stays the player's hard-coded 60 s (objectives.js:52),
 // which the overlay decode does not settle.
 const tickRate=60000;
 const specs={
  spawnOverlay:{durationTicks:60000,loops:0,scaleX:[[0,1],[30041,1.1],[60000,1]],scaleY:[[0,1],[30041,1.1],[60000,1]],opacity:[[0,1],[30041,0.5],[60000,1]]},
  idle:{durationTicks:60233,loops:0,scaleX:[[0,1],[30117,1],[60233,1]],scaleY:[[0,1],[30117,1.05],[60233,1]],opacity:[[0,1],[60233,1]]},
  spawnAnim:{durationTicks:30000,loops:1,scaleX:[[0,1],[15000,1.05],[30000,1]],scaleY:[[0,1],[15000,1.05],[30000,1]],opacity:[[0,0],[30000,1]]}
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
  return {scaleX:channelValue(spec.scaleX,t),scaleY:channelValue(spec.scaleY,t),opacity:channelValue(spec.opacity,t)};
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
 const api={tickRate,specs,durationMs,sample,countdownSample,overlayState};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceOverlays=api;
})(globalThis);
