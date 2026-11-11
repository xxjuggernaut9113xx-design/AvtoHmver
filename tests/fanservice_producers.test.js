const test=require('node:test'),assert=require('node:assert/strict');
const economy=require('../static/fanservice/economy.js');
const progression=require('../static/fanservice/progression.js');
const contract=require('../static/fanservice/data/native-contract.json');
// #50 producers — native UProgressionManager disassembly (v0.05.1), see
// docs/parity/evidence/ticket50-producers-native-20261111.md. The six
// Record* producers wrap UpdateMetricWithConditions with a zeroed
// conditions struct; the session stat is applied by the RecordSessionMetric
// jump-table mode (add most; max 4/17/18/42/43; set 24; no-op 5/9/15/20/21).
// Challenge fan-out (§2 phase 3) flows through the existing settlement
// path: the producer records into run state, sessionMetrics copies the
// field by name, updateChallenges fans out by metric id.
const run=(state={})=>({state:{modifiers:[],...state},config:{mode:0},ownedModifiers:[],inventory:{state:()=>null}});
const fresh=()=>({version:1,packs:[{id:'custom:a',owned:true,enabled:true,device_id:'private-device'}],unlock_points:0});

test('metricIds covers the full 47-value EMetricType enum, including 42-46',()=>{
 assert.equal(Object.keys(economy.metricIds).length,47);
 assert.equal(economy.metricIds[42],'BestMusicModeWinRounds');
 assert.equal(economy.metricIds[43],'BestTowerWinRounds');
 assert.equal(economy.metricIds[44],'MusicBreaksUsed');
 assert.equal(economy.metricIds[45],'DisabledBreakSectionFailures');
 assert.equal(economy.metricIds[46],'BountyCollectionFailures');
 assert.equal(economy.metricIds[0],'Strokes');
 assert.equal(economy.metricIds[24],'PercentAtHighHeat');
});

test('applySessionMetric adds most metrics',()=>{
 const r=run({Strokes:5,MusicBreaksUsed:1});
 assert.equal(economy.applySessionMetric(r,0,3),true);assert.equal(r.state.Strokes,8);
 assert.equal(economy.applySessionMetric(r,44,1),true);assert.equal(r.state.MusicBreaksUsed,2);
 assert.equal(economy.applySessionMetric(r,39,1),true);assert.equal(r.state.ComboCrunchersUsed,1);
});

test('applySessionMetric maxes 4/17/18/42/43 and calls the lifetime-best update at settlement',()=>{
 const r=run({MaxCombo:5,EdgeStreak:2,ConsecutiveSuccubiSurvived:1,BestMusicModeWinRounds:2,BestTowerWinRounds:3});
 assert.equal(economy.applySessionMetric(r,4,3),true);assert.equal(r.state.MaxCombo,5);
 assert.equal(economy.applySessionMetric(r,4,9),true);assert.equal(r.state.MaxCombo,9);
 assert.equal(economy.applySessionMetric(r,17,1),true);assert.equal(r.state.EdgeStreak,2);
 assert.equal(economy.applySessionMetric(r,17,7),true);assert.equal(r.state.EdgeStreak,7);
 assert.equal(economy.applySessionMetric(r,18,4),true);assert.equal(r.state.ConsecutiveSuccubiSurvived,4);
 assert.equal(economy.applySessionMetric(r,42,1),true);assert.equal(r.state.BestMusicModeWinRounds,2);
 assert.equal(economy.applySessionMetric(r,42,5),true);assert.equal(r.state.BestMusicModeWinRounds,5);
 assert.equal(economy.applySessionMetric(r,43,2),true);assert.equal(r.state.BestTowerWinRounds,3);
 // The lifetime-best update (native UpdateLifetimeBest tail-call) is the
 // settlement max: two sessions with MaxCombo 10 then 6 must leave the
 // lifetime best at 10, not the sum 16.
 let p=progression.settleSession(fresh(),{seconds:60,won:true,MaxCombo:10,EdgeStreak:4},'s1',contract,()=>0);
 p=progression.settleSession(p,{seconds:60,won:true,MaxCombo:6,EdgeStreak:2},'s2',contract,()=>0);
 assert.equal(p.progression.lifetime_metrics.MaxCombo,10);
 assert.equal(p.progression.lifetime_metrics.EdgeStreak,4);
});

test('applySessionMetric sets 24 and no-ops 5/9/15/20/21',()=>{
 const r=run({PercentAtHighHeat:30,StrokeCombo:4,AvgStrokesPerEdge:2,TotalXPEarned:100,PerfectRounds:1,TimesLost:1});
 assert.equal(economy.applySessionMetric(r,24,55),true);assert.equal(r.state.PercentAtHighHeat,55);
 for(const id of [5,9,15,20,21])assert.equal(economy.applySessionMetric(r,id,7),false);
 assert.equal(r.state.StrokeCombo,4);assert.equal(r.state.AvgStrokesPerEdge,2);
 assert.equal(r.state.TotalXPEarned,100);assert.equal(r.state.PerfectRounds,1);assert.equal(r.state.TimesLost,1);
 assert.equal(economy.applySessionMetric(r,99,1),false);
});

test('the six producers record the exact metric, value and guard',()=>{
 const r=run();
 economy.recordComboCruncherUsed(r);economy.recordComboCruncherUsed(r);
 assert.equal(r.state.ComboCrunchersUsed,2);
 economy.recordMusicBreakUsed(r);assert.equal(r.state.MusicBreaksUsed,1);
 economy.recordBountyCollectionFailure(r);assert.equal(r.state.BountyCollectionFailures,1);
 economy.recordDisabledBreakSectionFailure(r);assert.equal(r.state.DisabledBreakSectionFailures,1);
 // Best* producers record nothing for 0 rounds and keep the max.
 economy.recordTowerWinRounds(r,0);assert.equal(r.state.BestTowerWinRounds,undefined);
 economy.recordTowerWinRounds(r,3);assert.equal(r.state.BestTowerWinRounds,3);
 economy.recordTowerWinRounds(r,2);assert.equal(r.state.BestTowerWinRounds,3);
 economy.recordTowerWinRounds(r,5);assert.equal(r.state.BestTowerWinRounds,5);
 economy.recordMusicModeWinRounds(r,0);assert.equal(r.state.BestMusicModeWinRounds,undefined);
 economy.recordMusicModeWinRounds(r,1);assert.equal(r.state.BestMusicModeWinRounds,1);
 economy.recordMusicModeWinRounds(r,1);assert.equal(r.state.BestMusicModeWinRounds,1);
});

test('itemUsed type 13 still records producer 39',()=>{
 const r=run();economy.itemUsed(r,13,'Defensive');
 assert.equal(r.state.ComboCrunchersUsed,1);assert.equal(r.state.ItemsUsed,1);assert.equal(r.state.DefensiveItemsUsed,1);
});

test('producer records fan out to challenges at settlement by metric id',()=>{
 // Session scope: 2 combo crunchers complete pump_and_dump; a 1000 combo
 // completes strokeaholic; 3 consecutive succubi complete demon_proof.
 let p=progression.settleSession(fresh(),{seconds:60,won:true,ComboCrunchersUsed:2,MaxCombo:1000,ConsecutiveSuccubiSurvived:3},'s1',contract,()=>0);
 assert.equal(p.progression.challenge_progress.pump_and_dump.completed,true);
 assert.equal(p.progression.challenge_progress.strokeaholic.completed,true);
 assert.equal(p.progression.challenge_progress.demon_proof.completed,true);
 // Lifetime scope: MusicBreaksUsed accumulates 3 + 2 across sessions to
 // complete not_quite_my_tempo (target 5); one disabled-break failure
 // completes aint_got_rhythm (target 1).
 p=progression.settleSession(fresh(),{seconds:60,won:true,MusicBreaksUsed:3},'s1',contract,()=>0);
 p=progression.settleSession(p,{seconds:60,won:true,MusicBreaksUsed:2,DisabledBreakSectionFailures:1},'s2',contract,()=>0);
 assert.equal(p.progression.challenge_progress.not_quite_my_tempo.completed,true);
 assert.equal(p.progression.challenge_progress.aint_got_rhythm.completed,true);
 assert.equal(p.progression.lifetime_metrics.MusicBreaksUsed,5);
 assert.equal(p.progression.lifetime_metrics.DisabledBreakSectionFailures,1);
 // Lifetime Best* challenges use the max: 20 tower rounds complete
 // test_your_might; 15 music-mode rounds complete the_whole_record.
 p=progression.settleSession(fresh(),{seconds:60,won:true,BestTowerWinRounds:20,BestMusicModeWinRounds:15},'s1',contract,()=>0);
 assert.equal(p.progression.challenge_progress.test_your_might.completed,true);
 assert.equal(p.progression.challenge_progress.the_whole_record.completed,true);
});
