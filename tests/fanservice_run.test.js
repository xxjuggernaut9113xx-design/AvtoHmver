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
test('GM clock: Classic Timer completion takes the override path and a missed window re-arms only after another full target',()=>{
 // Determine And Trigger Cum Meter Override Event (GM ubergraph, v0.05.1):
 // Timer completion enters the live trigger block from the 1 s format
 // timer (stmts 2378-2380) and, IsCumRound?, takes Spawn100Percent +
 // Start Cum Window Timer + the flag — never the direct session end or a
 // round win. The expiry case ('Timer Reset') grows the target by the
 // original target, so the next window needs another full 300 s.
 const run=new Run(catalog,{settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300}});
 assert.equal(run.advance(300).filter(e=>e.type==='release-window-opened').length,1);
 assert(run.player.isAllowedToCum);assert.equal(run.state.CumWindowsHit,1);
 assert.equal(run.objective.releaseDeadline,360);
 assert.equal(run.advance(60)[0].type,'objective-reset');
 assert(!run.player.isAllowedToCum);
 assert.equal(run.objective.state.baselineGmSeconds,300);
 // The reset requests the next card; the trigger gate reads the current
 // card, so model that ordinary draw (type 0) — without it the card is
 // still the Cum card (6) the window opened with and the gate correctly
 // holds the re-arm for the next card.
 run.state.card=0;
 // One second past expiry must not re-fire: the re-arm needs gmSeconds 600.
 assert.deepEqual(run.advance(1),[]);
 assert.equal(run.objective.gmSeconds,361);
 assert(run.advance(239).some(e=>e.type==='release-window-opened'));
 assert.equal(run.objective.gmSeconds,600);
});
test('GM clock: Devil guard holds Classic Timer progress until a Succubus card, wall clock keeps rewards time',()=>{
 // SetSessionDuration (GM ubergraph, v0.05.1): with 'Deal With The Devil'
 // active a second counts only on a Succubus card (3). The format tick's
 // Timer check still runs on a guarded-out second, so a banked completion
 // opens on the next ordinary card without counting.
 const run=new Run(catalog,{settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300},modifiers:['Deal With The Devil']});
 run.advance(299);
 assert.equal(run.objective.gmSeconds,0);assert.equal(run.player.sessionLength,299);
 run.state.card=3;run.advance(1);
 assert.equal(run.objective.gmSeconds,1);
 run.state.card=0;run.advance(299);
 assert.equal(run.objective.gmSeconds,1);assert.equal(run.player.sessionLength,599);
 run.state.card=3;run.advance(299);
 assert.equal(run.objective.gmSeconds,300);assert.equal(run.objective.releaseDeadline,null);
 run.state.card=0;run.advance(1);
 assert.equal(run.objective.gmSeconds,300);assert.equal(run.objective.releaseDeadline,959);
 assert.equal(run.player.sessionLength,899);assert.equal(run.effectiveStats().seconds,899);
});
test('GM clock: Prejac expiry through run.advance stops the clock and ends the session',()=>{
 const run=new Run(catalog,{settings:{LastObjectiveIndex_Classic:4,LastObjective_Prejac:30}});
 run.advance(29);
 assert.equal(run.objective.gmSeconds,29);assert.equal(run.phase,'playing');
 assert.equal(run.advance(1)[0].type,'premature-cum');
 assert.equal(run.phase,'complete');assert.equal(run.state.won,false);
 assert.equal(run.objective.gmSeconds,30);assert.equal(run.objective.gmStopped,true);
 assert.equal(run.player.sessionLength,30);
 run.advance(1);assert.equal(run.objective.gmSeconds,30);assert.equal(run.state.seconds,30);
});
test('GM clock survives export/restore and All or Nothing zeroes it for Timer',()=>{
 const run=new Run(catalog,{settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300}});
 run.advance(100);
 assert.equal(run.objective.gmSeconds,100);
 const restored=Run.restore(catalog,run.export());
 assert.equal(restored.objective.gmSeconds,100);assert.equal(restored.objective.gmStopped,false);
 assert.deepEqual(restored.export(),run.export());
 // ApplyAllOrNothingModifierEffects_IfToggled (GM, v0.05.1) zeroes
 // SessionLength for objective 1; the player zeroes the GM clock and its
 // baseline with it, so the Timer restarts from zero.
 restored.resetObjective();
 assert.equal(restored.objective.gmSeconds,0);assert.equal(restored.objective.state.baselineGmSeconds,0);
 assert.equal(restored.effectiveStats().sessionLength,0);
 // Saves from before the clock restore to the wall clock as the fallback.
 const legacy=run.export();delete legacy.objective.gmSeconds;delete legacy.objective.gmStopped;
 const old=Run.restore(catalog,legacy);
 assert.equal(old.objective.gmSeconds,100);assert.equal(old.objective.gmStopped,false);
});
test('GM clock: TimeAtHighHeat counts only Devil-counted seconds',()=>{
 // SetSessionDuration updates the high-heat metrics only on a counted
 // second while Heat Level >= 70; a Devil-guarded second counts neither.
 const run=new Run(catalog,{modifiers:['Deal With The Devil']});
 run.state.heat=70;
 run.advance(2);assert.equal(run.state.TimeAtHighHeat||0,0);
 run.state.card=3;run.advance(2);assert.equal(run.state.TimeAtHighHeat,2);
 run.state.card=0;run.advance(2);assert.equal(run.state.TimeAtHighHeat,2);
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
test('endless Tower continues past its configured count after a failed round',()=>{
 const run=new Run(catalog,{mode:1,rounds:1,endless:true,seed:42});
 run.select(0);run.completeRound(false);assert.equal(run.phase,'shop');assert.equal(run.state.won,undefined);
 run.continue();run.select(0);run.completeRound(true);assert.equal(run.tower.round,2);assert.equal(run.phase,'shop');assert.equal(run.state.won,undefined);assert.equal(run.tower.failed,1);
});
test('restoring a mid-round objective preserves release deadline and Tower next-draft sequence',()=>{
 const run=new Run(catalog,{mode:1,rounds:4,seed:7});run.select(1);run.state.seconds=10;run.completeRound(true);
 const restored=Run.restore(catalog,JSON.parse(JSON.stringify(run.export())));
 assert.deepEqual(restored.continue(),run.continue());
 const classic=new Run(catalog);classic.state.meter=1;classic.advance(3);
 const resumed=Run.restore(catalog,classic.export());assert.equal(resumed.objective.releaseDeadline,63);
 assert.equal(resumed.advance(60)[0].type,'objective-reset');
});
