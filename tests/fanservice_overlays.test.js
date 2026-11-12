const test=require('node:test'),assert=require('node:assert/strict');
const overlays=require('../static/fanservice/overlays');
// Decoded values: docs/parity/evidence/ticket44-loops-overlay-20261111.md.
// Tick resolution 60000/1 in every section; SpawnOverlay 1.0 s infinite loop
// (NumLoopsToPlay=0); CumInXSec/CumWithinXSec Idle 60233 ticks ≈ 1.004 s
// infinite loop; SpawnAnim 30000 ticks = 0.5 s, plays once.
function near(actual,expected,epsilon=1e-9){assert.ok(Math.abs(actual-expected)<=epsilon,`expected ${expected}, got ${actual}`);}
test('SpawnOverlay spec pins the decoded 1 s pulse exactly',()=>{
 assert.equal(overlays.tickRate,60000);
 assert.equal(overlays.specs.spawnOverlay.durationTicks,60000);
 assert.equal(overlays.specs.spawnOverlay.loops,0);
 assert.deepEqual(overlays.specs.spawnOverlay.scaleX,[[0,1],[30041,1.1],[60000,1]]);
 assert.deepEqual(overlays.specs.spawnOverlay.scaleY,[[0,1],[30041,1.1],[60000,1]]);
 assert.deepEqual(overlays.specs.spawnOverlay.opacity,[[0,1],[30041,0.5],[60000,1]]);
 assert.equal(overlays.durationMs('spawnOverlay'),1000);
});
test('Idle spec pins the decoded vertical-only 5% pulse and its 60233-tick duration',()=>{
 assert.equal(overlays.specs.idle.durationTicks,60233);
 assert.equal(overlays.specs.idle.loops,0);
 assert.deepEqual(overlays.specs.idle.scaleX,[[0,1],[30117,1],[60233,1]]);
 assert.deepEqual(overlays.specs.idle.scaleY,[[0,1],[30117,1.05],[60233,1]]);
 near(overlays.durationMs('idle'),60233/60);
});
test('SpawnAnim spec pins the decoded 0.5 s entrance, played once',()=>{
 assert.equal(overlays.specs.spawnAnim.durationTicks,30000);
 assert.equal(overlays.specs.spawnAnim.loops,1);
 assert.deepEqual(overlays.specs.spawnAnim.scaleX,[[0,1],[15000,1.05],[30000,1]]);
 assert.deepEqual(overlays.specs.spawnAnim.scaleY,[[0,1],[15000,1.05],[30000,1]]);
 assert.deepEqual(overlays.specs.spawnAnim.opacity,[[0,0],[30000,1]]);
 assert.equal(overlays.durationMs('spawnAnim'),500);
});
test('sample interpolates SpawnOverlay linearly and wraps the infinite loop',()=>{
 assert.deepEqual(overlays.sample('spawnOverlay',0),{scaleX:1,scaleY:1,opacity:1});
 assert.deepEqual(overlays.sample('spawnOverlay',30041),{scaleX:1.1,scaleY:1.1,opacity:0.5});
 assert.deepEqual(overlays.sample('spawnOverlay',60000),{scaleX:1,scaleY:1,opacity:1});
 const mid=overlays.sample('spawnOverlay',15000);
 near(mid.scaleX,1+0.1*(15000/30041));near(mid.opacity,1-0.5*(15000/30041));
 const wrapped=overlays.sample('spawnOverlay',60000+30041);
 assert.deepEqual(wrapped,{scaleX:1.1,scaleY:1.1,opacity:0.5});
});
test('sample pins Idle as vertical-only and wraps at 60233 ticks',()=>{
 assert.deepEqual(overlays.sample('idle',0),{scaleX:1,scaleY:1,opacity:1});
 assert.deepEqual(overlays.sample('idle',30117),{scaleX:1,scaleY:1.05,opacity:1});
 assert.deepEqual(overlays.sample('idle',60233),{scaleX:1,scaleY:1,opacity:1});
 const mid=overlays.sample('idle',15000);
 assert.equal(mid.scaleX,1);near(mid.scaleY,1+0.05*(15000/30117));
});
test('sample clamps SpawnAnim at its 0.5 s end because it plays once',()=>{
 assert.deepEqual(overlays.sample('spawnAnim',0),{scaleX:1,scaleY:1,opacity:0});
 assert.deepEqual(overlays.sample('spawnAnim',15000),{scaleX:1.05,scaleY:1.05,opacity:0.5});
 assert.deepEqual(overlays.sample('spawnAnim',30000),{scaleX:1,scaleY:1,opacity:1});
 assert.deepEqual(overlays.sample('spawnAnim',45000),{scaleX:1,scaleY:1,opacity:1});
});
test('countdownSample plays the entrance first, then the Idle loop',()=>{
 assert.deepEqual(overlays.countdownSample(0),{scaleX:1,scaleY:1,opacity:0});
 assert.deepEqual(overlays.countdownSample(15000),{scaleX:1.05,scaleY:1.05,opacity:0.5});
 assert.deepEqual(overlays.countdownSample(30000),{scaleX:1,scaleY:1,opacity:1});
 assert.deepEqual(overlays.countdownSample(30000+30117),{scaleX:1,scaleY:1.05,opacity:1});
 assert.deepEqual(overlays.countdownSample(30000+60233),{scaleX:1,scaleY:1,opacity:1});
});
test('overlayState shows the allowed overlay whenever cum is allowed',()=>{
 assert.deepEqual(overlays.overlayState({isAllowedToCum:false,releaseDeadline:null,now:0}),{allowed:false,countdown:false,progress:null,seconds:null});
 assert.deepEqual(overlays.overlayState({isAllowedToCum:true,releaseDeadline:null,now:0}),{allowed:true,countdown:false,progress:null,seconds:null});
 assert.deepEqual(overlays.overlayState({isAllowedToCum:true,releaseDeadline:null,now:0,hasCame:true}),{allowed:false,countdown:false,progress:null,seconds:null});
});
test('overlayState binds the countdown to the release-window remainder',()=>{
 assert.deepEqual(overlays.overlayState({isAllowedToCum:true,releaseDeadline:100,now:40,windowSeconds:60}),{allowed:true,countdown:true,progress:1,seconds:60});
 assert.deepEqual(overlays.overlayState({isAllowedToCum:true,releaseDeadline:100,now:70,windowSeconds:60}),{allowed:true,countdown:true,progress:0.5,seconds:30});
 assert.deepEqual(overlays.overlayState({isAllowedToCum:true,releaseDeadline:100,now:100,windowSeconds:60}),{allowed:true,countdown:false,progress:null,seconds:null});
 assert.deepEqual(overlays.overlayState({isAllowedToCum:true,releaseDeadline:100,now:130,windowSeconds:60}),{allowed:true,countdown:false,progress:null,seconds:null});
});
test('map-window warning leads pin the v0.05.1 UMusicModeManager constructor defaults',()=>{
 // UMusicModeManager constructor 0x1482ce640 (v0.05.1 exe a8f46896, verified
 // in the binary): movabs 30.0 -> +0x60, movabs 10.0 -> +0x68. The cum-window
 // lead is copied to +0x580 and the break-disable lead to +0x5b0 by
 // EvaluateNotificationWarnings (0x1482decf0) when it schedules a warning.
 assert.equal(overlays.CUM_WARNING_LEAD_SECONDS,30);
 assert.equal(overlays.BREAK_DISABLE_WARNING_LEAD_SECONDS,10);
});
test('cumInWarning fills as the next cum window approaches within 30 s',()=>{
 // GetCumWindowWarningProgress 0x1482e94e0: clamp(1 - max(start-now,0)/30, 0, 1),
 // 0 when there is no window (start < 0) or the lead is <= 0.
 // GetCumWindowWarningRemainingSeconds 0x1482e9570: start < 0 ? -1 : max(start-now, 0).
 assert.deepEqual(overlays.cumInWarning({now:0,windowStart:-1}),{active:false,seconds:-1,progress:0});
 assert.deepEqual(overlays.cumInWarning({now:0,windowStart:60}),{active:false,seconds:60,progress:0});
 assert.deepEqual(overlays.cumInWarning({now:30,windowStart:60}),{active:true,seconds:30,progress:0});
 assert.deepEqual(overlays.cumInWarning({now:45,windowStart:60}),{active:true,seconds:15,progress:0.5});
 assert.deepEqual(overlays.cumInWarning({now:60,windowStart:60}),{active:true,seconds:0,progress:1});
 assert.deepEqual(overlays.cumInWarning({now:61,windowStart:60}),{active:false,seconds:0,progress:1});
});
test('cumWithinWarning drains over the running cum window',()=>{
 // GetCumWithinProgress 0x1482e96e0: over the history entry containing now,
 // clamp(max(end-now,0)/(end-start), 0, 1); 0 when no entry contains now.
 // GetCumWithinRemainingSeconds 0x1482e9870: the containing entry's
 // max(end-now, 0), or -1 when no entry contains now.
 assert.deepEqual(overlays.cumWithinWarning({now:0,windowStart:60,windowEnd:90}),{active:false,seconds:-1,progress:0});
 assert.deepEqual(overlays.cumWithinWarning({now:60,windowStart:60,windowEnd:90}),{active:true,seconds:30,progress:1});
 assert.deepEqual(overlays.cumWithinWarning({now:75,windowStart:60,windowEnd:90}),{active:true,seconds:15,progress:0.5});
 assert.deepEqual(overlays.cumWithinWarning({now:90,windowStart:60,windowEnd:90}),{active:true,seconds:0,progress:0});
 assert.deepEqual(overlays.cumWithinWarning({now:91,windowStart:60,windowEnd:90}),{active:false,seconds:-1,progress:0});
});
test('breakDisableWarning fills as the next disable_break approaches within 10 s',()=>{
 // GetBreakDisableWarningProgress 0x1482e6de0: same shape as the cum-in getter
 // over the next disable_break time (+0x5a8) and its 10 s lead (+0x5b0).
 assert.deepEqual(overlays.breakDisableWarning({now:0,disableTime:-1}),{active:false,seconds:-1,progress:0});
 assert.deepEqual(overlays.breakDisableWarning({now:0,disableTime:20}),{active:false,seconds:20,progress:0});
 assert.deepEqual(overlays.breakDisableWarning({now:10,disableTime:20}),{active:true,seconds:10,progress:0});
 assert.deepEqual(overlays.breakDisableWarning({now:15,disableTime:20}),{active:true,seconds:5,progress:0.5});
 assert.deepEqual(overlays.breakDisableWarning({now:20,disableTime:20}),{active:true,seconds:0,progress:1});
});
test('mapWindowWarnings picks the next cum window and disable_break from beatmap events',()=>{
 const events=[
  {time:10,type:'cum_event',value:'start'},{time:25,type:'cum_event',value:'end'},
  {time:40,type:'disable_break',value:'start'},{time:50,type:'disable_break',value:'end'},
  {time:70,type:'cum_event',value:'start'},{time:100,type:'cum_event',value:'end'}];
 const at0=overlays.mapWindowWarnings({now:0,events});
 assert.equal(at0.cumIn.active,true);near(at0.cumIn.progress,1-10/30);
 assert.equal(at0.cumIn.seconds,10);
 assert.equal(at0.breakDisable.active,false);
 const at5=overlays.mapWindowWarnings({now:5,events});
 assert.equal(at5.cumIn.active,true);near(at5.cumIn.progress,1-5/30);
 const at15=overlays.mapWindowWarnings({now:15,events});
 assert.equal(at15.cumWithin.active,true);near(at15.cumWithin.progress,2/3);
 const at35=overlays.mapWindowWarnings({now:35,events});
 assert.equal(at35.breakDisable.active,true);near(at35.breakDisable.progress,0.5);
 assert.equal(at35.cumIn.active,false);
 const at110=overlays.mapWindowWarnings({now:110,events});
 assert.deepEqual(at110.cumIn,{active:false,seconds:-1,progress:0});
 assert.deepEqual(at110.breakDisable,{active:false,seconds:-1,progress:0});
});
test('displaySeconds matches the GetCumInText/GetCumWithinText disassembly exactly',()=>{
 // Both native getters (0x1482e8f40 / 0x1482e99b0, v0.05.1 exe a8f46896)
 // compute the %d from the double remaining r as: cvtsd2si(-0.5 - 2r),
 // arithmetic shift right 1, negate, clamp at 0 (constant -0.5 at
 // 0x14bf8d1d8). That equals floor(r + 0.75): verified 0 mismatches on a
 // 200k random sweep against the literal integer computation below.
 const literal=r=>{const t=Math.trunc(-0.5-2*r);return Math.max(0,-Math.floor(t/2));};
 for(let r=0;r<4000;r+=0.25)assert.equal(overlays.displaySeconds(r),literal(r),`remaining ${r}`);
 let seed=12345;const next=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296*4000;};
 for(let i=0;i<5000;i++){const r=next();assert.equal(overlays.displaySeconds(r),literal(r),`remaining ${r}`);}
 assert.equal(overlays.displaySeconds(30.1),30);
 assert.equal(overlays.displaySeconds(30.24),30);
 assert.equal(overlays.displaySeconds(30.25),31);
 assert.equal(overlays.displaySeconds(0.24),0);
 assert.equal(overlays.displaySeconds(0.25),1);
 assert.equal(overlays.displaySeconds(59.99),60);
});
test('durationText pins the native seconds-to-MM:SS/H:MM:SS helper',()=>{
 // Duration helper 0x1482dfe90: total seconds n (same floor(r+0.75)
 // rounding), '%d:%02d:%02d' when hours > 0, '%02d:%02d' otherwise.
 assert.equal(overlays.durationText(5), '00:05');
 assert.equal(overlays.durationText(61), '01:01');
 assert.equal(overlays.durationText(3599.24), '59:59');
 assert.equal(overlays.durationText(3600), '1:00:00');
 assert.equal(overlays.durationText(3661), '1:01:01');
 assert.equal(overlays.durationText(90061), '25:01:01');
});
test('cumInText renders the exact GetCumInText format string',()=>{
 // GetCumInText 0x1482e8f40: '' when +0x570 < 0 or remaining <= 0, else
 // FString::PrintfImpl('CUM IN: %d SEC', displaySeconds(remaining)).
 assert.equal(overlays.cumInText({now:0,windowStart:-1}),'');
 assert.equal(overlays.cumInText({now:60,windowStart:60}),'');
 assert.equal(overlays.cumInText({now:61,windowStart:60}),'');
 assert.equal(overlays.cumInText({now:30,windowStart:60}),'CUM IN: 30 SEC');
 assert.equal(overlays.cumInText({now:29.9,windowStart:60}),'CUM IN: 30 SEC');
 assert.equal(overlays.cumInText({now:29.75,windowStart:60}),'CUM IN: 31 SEC');
 assert.equal(overlays.cumInText({now:0,windowStart:0.24}),'CUM IN: 0 SEC');
});
test('cumWithinText renders the exact GetCumWithinText format string',()=>{
 // GetCumWithinText 0x1482e99b0: '' outside the containing history entry,
 // else FString::PrintfImpl('CUM WITHIN: %d SEC', displaySeconds(end-now)).
 assert.equal(overlays.cumWithinText({now:0,windowStart:60,windowEnd:90}),'');
 assert.equal(overlays.cumWithinText({now:91,windowStart:60,windowEnd:90}),'');
 assert.equal(overlays.cumWithinText({now:60,windowStart:60,windowEnd:90}),'CUM WITHIN: 30 SEC');
 assert.equal(overlays.cumWithinText({now:75,windowStart:60,windowEnd:90}),'CUM WITHIN: 15 SEC');
 assert.equal(overlays.cumWithinText({now:90,windowStart:60,windowEnd:90}),'CUM WITHIN: 0 SEC');
 assert.equal(overlays.cumWithinText({now:59.75,windowStart:60,windowEnd:90}),'');
});
test('breakDisableText renders the exact GetBreakDisableWarningText strings',()=>{
 // GetBreakDisableWarningText 0x1482e6ed0: '' when +0x5a8 < 0,
 // 'BREAKS DISABLED IN %s' (duration helper) while remaining > 0,
 // 'BREAKS DISABLED' once the disable is in effect.
 assert.equal(overlays.breakDisableText({now:0,disableTime:-1}),'');
 assert.equal(overlays.breakDisableText({now:10,disableTime:20}),'BREAKS DISABLED IN 00:10');
 assert.equal(overlays.breakDisableText({now:19,disableTime:20}),'BREAKS DISABLED IN 00:01');
 assert.equal(overlays.breakDisableText({now:20,disableTime:20}),'BREAKS DISABLED');
 assert.equal(overlays.breakDisableText({now:25,disableTime:20}),'BREAKS DISABLED');
});
test('mapWindowWarningTexts picks the exact text for each beatmap warning',()=>{
 const events=[
  {time:10,type:'cum_event',value:'start'},{time:25,type:'cum_event',value:'end'},
  {time:40,type:'disable_break',value:'start'},{time:50,type:'disable_break',value:'end'},
  {time:70,type:'cum_event',value:'start'},{time:100,type:'cum_event',value:'end'}];
 // (The break-disable text has no lead in the native getter — it reads
 // 'BREAKS DISABLED IN 00:40' at now 0 even though the warning only becomes
 // active within 10 s; play.js shows a text only when its warning is active.)
 assert.deepEqual(overlays.mapWindowWarningTexts({now:0,events}),{cumIn:'CUM IN: 10 SEC',cumWithin:'',breakDisable:'BREAKS DISABLED IN 00:40'});
 assert.deepEqual(overlays.mapWindowWarningTexts({now:15,events}),{cumIn:'',cumWithin:'CUM WITHIN: 10 SEC',breakDisable:'BREAKS DISABLED IN 00:25'});
 assert.deepEqual(overlays.mapWindowWarningTexts({now:35,events}),{cumIn:'CUM IN: 35 SEC',cumWithin:'',breakDisable:'BREAKS DISABLED IN 00:05'});
 assert.deepEqual(overlays.mapWindowWarningTexts({now:110,events}),{cumIn:'',cumWithin:'',breakDisable:''});
});
