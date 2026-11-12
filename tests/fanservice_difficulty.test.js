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

// #50 SetCumMeterDifficultyModifier (BP_GlobalManager, v0.05.1, 72 stmts):
// Classic branch switches on CurrentDifficulty 0/1/2 -> CumMeterMultiplier
// 8.0 / 1.0 / 0.5 and never touches BaseCumGain (stays the CDO 0.00025).
// Tower branch switches on the selected option's DifficultyTier 0-6 and
// sets both values; Playlist returns without touching either.
test('Classic cum meter multiplier is set per difficulty and survives draws',()=>{
 for(const [difficulty,multiplier] of [[0,8],[1,1],[2,0.5]]){
  const run=session({difficulty});
  assert.equal(run.state.meterMultiplier,multiplier,`difficulty ${difficulty}`);
  assert.equal(run.state.sessionMeterMultiplier,multiplier,`difficulty ${difficulty}`);
  assert.equal(run.state.baseGain,0.00025,`difficulty ${difficulty}`);
  economy.draw(run);
  assert.equal(run.state.meterMultiplier,multiplier,`difficulty ${difficulty} after draw`);
  // One beat from an empty meter gains baseGain * multiplier, nothing else.
  run.beat();
  assert(Math.abs(run.state.meter-0.00025*multiplier)<1e-12,`difficulty ${difficulty} meter`);
 }
 assert.deepEqual([economy.cumMeterDifficulty(0),economy.cumMeterDifficulty(1),economy.cumMeterDifficulty(2)],[
  {meterMultiplier:8,baseGain:0.00025},{meterMultiplier:1,baseGain:0.00025},{meterMultiplier:0.5,baseGain:0.00025}]);
 assert.equal(economy.cumMeterDifficulty(3),null);
 assert.equal(economy.cumMeterDifficulty(-1),null);
});
test('Tower cum meter values come from the first selected option tier, once',()=>{
 const tiers={0:{meterMultiplier:10,baseGain:0.01},1:{meterMultiplier:10,baseGain:0.01},2:{meterMultiplier:8.5,baseGain:0.006667},3:{meterMultiplier:5,baseGain:0.004},4:{meterMultiplier:4,baseGain:0.002857},5:{meterMultiplier:3,baseGain:0.002},6:{meterMultiplier:2,baseGain:0.001111}};
 for(const tier of [0,1,2,3,4,5,6])assert.deepEqual(economy.towerCumMeterDifficulty(tier),tiers[tier],`tier ${tier}`);
 assert.equal(economy.towerCumMeterDifficulty(7),null);
 assert.equal(economy.towerCumMeterDifficulty(-1),null);
 const run=new Run(modes,{mode:1,rounds:3,seed:137});
 assert.equal(run.state.meterMultiplier,1);
 assert.equal(run.state.baseGain,0.00025);
 const selected=run.select(0),first=tiers[selected.tier];
 assert.equal(run.state.meterMultiplier,first.meterMultiplier,`tier ${selected.tier}`);
 assert.equal(run.state.baseGain,first.baseGain,`tier ${selected.tier}`);
 assert.equal(run.state.sessionMeterMultiplier,first.meterMultiplier);
 economy.draw(run);
 assert.equal(run.state.meterMultiplier,first.meterMultiplier,'after draw');
 // A second round's option must not re-apply the setter.
 run.completeRound(true);run.continue();run.select(0);
 assert.equal(run.state.meterMultiplier,first.meterMultiplier,'second round');
 assert.equal(run.state.baseGain,first.baseGain,'second round');
});
test('Playlist cum meter values are untouched by the difficulty setter',()=>{
 const run=session({mode:2});
 assert.equal(run.state.meterMultiplier,1);
 assert.equal(run.state.baseGain,0.00025);
 economy.draw(run);
 assert.equal(run.state.meterMultiplier,1);
});
