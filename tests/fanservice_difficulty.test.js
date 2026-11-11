const test=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run'),economy=require('../static/fanservice/economy');
const modes=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json'),Rules=require('../static/fanservice/rules');
function session(config={}){const run=new Run(modes,{seed:137,...config});economy.draw(run);return run;}

// #50 tier mapping, settled 2026-11-11 from the v0.05.1 cooked packages
// (BP_GlobalManager legacy ubergraph, DifficultySelections_ENUM):
// session difficulty is the 3-value Blueprint enum EasyMode/NormalMode/
// InsaneMode (0/1/2) — NOT native EDifficultyTier (0-3) and NOT the
// DifficultyTiers_DT 1-6 Tower tiers. The player's 0/1/2 scale is already
// that enum, so there is no mapping to add. The four
// Difficulty*Multiplier values are set per CurrentDifficulty by
// SetCoinMultiplierBasedOnDifficulty / SetHeatGainDifficultyModifier /
// SetStrokeCountAndSpeedDifficultyModifiers, cases 0/1/2:
//   CoinEarn [2.0, 1.0, 0.5] — set and printed, but NO consumer exists in
//     any v0.05.1 package, so beat coins do not scale with difficulty.
//   HeatGain [0.75, 1.0, 2.0] — consumed by AddHeat:
//     HeatToAdd = HeatAdd * DifficultyHeatGainMultiplier.
//   StrokeCounter [1.0, 1.0, 2.0], StrokeSpeed [1.25, 1.0, 0.6] —
//     consumed by BP_DrawManager Determine Time and Stroke Multiplier
//     Basedon Combo, the same role as the player's drawMultipliers.
test('session difficulty tables match the native DifficultySelections setters',()=>{
 assert.deepEqual(cardRules.difficulty_count,[1,1,2]);
 assert.deepEqual(cardRules.difficulty_speed,[1.25,1,0.6]);
});
test('beat heat scales by the native DifficultyHeatGainMultiplier',()=>{
 // draw() leaves heat at 0, heat category 2, so one beat adds .2 * multiplier.
 for(const [difficulty,heat] of [[0,.15],[1,.2],[2,.4]]){
  const run=session({difficulty});run.beat();assert(Math.abs(run.state.heat-heat)<1e-12,`difficulty ${difficulty}`);
 }
});
test('Easy draws use the native stroke count/speed multipliers',()=>{
 // combo tier 0: count .8 * count-mult, time 1.4 * speed-mult.
 assert.deepEqual(Rules.drawMultipliers(0,cardRules.difficulty_count[0],cardRules.difficulty_speed[0]),{count:.8,time:1.75});
 assert.deepEqual(Rules.drawMultipliers(0,cardRules.difficulty_count[2],cardRules.difficulty_speed[2]),{count:1.6,time:.84});
});
test('beat coins do not scale with session difficulty (CoinEarn has no native consumer)',()=>{
 for(const difficulty of [0,1,2]){const run=session({difficulty});run.beat();assert.equal(run.state.coins,1,`difficulty ${difficulty}`);}
});
