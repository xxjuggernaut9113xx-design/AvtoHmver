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
