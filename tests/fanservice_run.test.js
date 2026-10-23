const {test}=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run');
const catalog=require('../static/fanservice/data/modes.json');
test('Classic objective opens the native release window and reset preserves session counters',()=>{
 const run=new Run(catalog,{settings:{LastObjectiveIndex_Classic:2,LastObjective_Strokes:100}});
 run.state.strokes=100;assert.equal(run.advance(1)[0].type,'release-window-opened');
 assert(run.player.isAllowedToCum);assert.equal(run.state.CumWindowsHit,1);
 assert.equal(run.advance(60)[0].type,'objective-reset');assert(!run.player.isAllowedToCum);
 assert.equal(run.objective.state.baselineStrokes,100);assert.equal(run.state.strokes,100);
});
test('Tower full lifecycle grants native rewards once and persists inventory, draft and random cursor',()=>{
 const run=new Run(catalog,{mode:1,rounds:3,seed:319});
 for(let round=1;round<=3;round++){
  run.select(0);const selected=run.tower.selected;
  assert(run.completeRound(true));const coins=run.state.coins;assert(!run.completeRound(true));assert.equal(run.state.coins,coins);
  if(round<3){assert.equal(run.phase,'shop');run.continue();}
  else{assert.equal(run.phase,'complete');assert(run.state.won);assert.equal(run.state.BestTowerWinRounds,3);}
  assert(selected.native_rewards.length>=2);
 }
 const restored=Run.restore(catalog,run.export());assert.deepEqual(restored.export(),run.export());
});
test('Tower shop cadence matches native square-root interval and failed rounds prevent overall win',()=>{
 const run=new Run(catalog,{mode:1,rounds:5,seed:42});assert.equal(run.shopEvery,2);
 for(let round=1;round<=5;round++){run.select(0);run.completeRound(round!==2);if(round<5){assert.equal(run.phase,round%2===0?'shop':'round-complete');run.continue();}}
 assert.equal(run.state.won,false);assert.equal(run.tower.failed,1);
});
test('restoring a mid-round objective preserves release deadline and Tower next-draft sequence',()=>{
 const run=new Run(catalog,{mode:1,rounds:4,seed:7});run.select(1);run.state.seconds=10;run.completeRound(true);
 const restored=Run.restore(catalog,JSON.parse(JSON.stringify(run.export())));
 assert.deepEqual(restored.continue(),run.continue());
 const classic=new Run(catalog);classic.state.meter=1;classic.advance(3);
 const resumed=Run.restore(catalog,classic.export());assert.equal(resumed.objective.releaseDeadline,63);
 assert.equal(resumed.advance(60)[0].type,'objective-reset');
});
