const {test}=require('node:test'),assert=require('node:assert/strict');
const SessionMetrics=require('../static/fanservice/session_metrics');
const {Run}=require('../static/fanservice/run');
const catalog=require('../static/fanservice/data/modes.json');
const Progression=require('../static/fanservice/progression');
const contract=require('../static/fanservice/data/native-contract.json');

function runFor(objective){
 const state={coins:19,meter:.8,seconds:73,strokes:240,edges:5,succubi:3,milkingCount:2};
 const run={state,player:{sessionLength:73},roundObjective:{objective,baselineDuration:12,baselineStrokes:100,baselineEdges:1,baselineSuccubi:1,baselineMilking:1}};
 return run;
}

test('All-or-Nothing resets only the selected source session metric and keeps absolute time',()=>{
 const cases=[
  [1,'sessionLength',73,'baselineDuration'],
  [2,'strokes',240,'baselineStrokes'],
  [3,'edges',5,'baselineEdges'],
  [7,'milkingCount',2,'baselineMilking'],
  [8,'succubi',3,'baselineSuccubi'],
 ];
 for(const [objective,metric,raw,baseline] of cases){
  const run=runFor(objective);SessionMetrics.resetObjective(run);
  assert.equal(run.state.coins,0);assert.equal(run.state.seconds,73);
  assert.equal(run.state.metricResetOffsets[metric],raw);assert.equal(run.roundObjective[baseline],0);
  const current=SessionMetrics.effective(run.state,run.player);
  assert.equal(metric==='sessionLength'?current.sessionLength:current[metric],0);
  assert.equal(current.strokes,objective===2?0:240);
  assert.equal(current.edges,objective===3?0:5);
  assert.equal(current.milkingCount,objective===7?0:2);
  assert.equal(current.succubi,objective===8?0:3);
 }
});

test('objective 0 zeros only the meter and objective 6 leaves all progress untouched',()=>{
 const meter=runFor(0);SessionMetrics.resetObjective(meter);
 assert.equal(meter.state.meter,0);assert.deepEqual(meter.state.metricResetOffsets,{});
 const prejac=runFor(6);SessionMetrics.resetObjective(prejac);
 assert.equal(prejac.state.coins,0);assert.equal(prejac.state.seconds,73);
 assert.equal(prejac.state.metricResetOffsets&&Object.keys(prejac.state.metricResetOffsets).length,0);
 assert.equal(prejac.roundObjective.baselineDuration,12);
});

test('effective counters continue from zero and their offsets survive checkpoint serialization',()=>{
 const run=runFor(3);SessionMetrics.resetObjective(run);
 run.state.edges+=2;run.state.seconds+=14;run.player.sessionLength=run.state.seconds;
 const resumed=JSON.parse(JSON.stringify(run));
 const effective=SessionMetrics.effective(resumed.state,resumed.player);
 assert.equal(effective.edges,2);assert.equal(effective.seconds,87);assert.equal(effective.sessionLength,87);
 assert.equal(resumed.state.edges,7);assert.equal(resumed.state.seconds,87);
});

test('a stroke reset leaves the captured Bounty start unchanged while projecting progress from zero',()=>{
 const run=runFor(2);run.state.effects={bountyRemaining:10,bountyStartStrokes:200};
 SessionMetrics.resetObjective(run);
 assert.equal(run.state.effects.bountyStartStrokes,200);
 assert.equal(SessionMetrics.effective(run.state,run.player).strokes,0);
});

test('Run keeps the raw gameplay clock while duration resets and restored counters continue effectively',()=>{
 const run=new Run(catalog);run.state.seconds=73;run.player.sessionLength=73;
 run.roundObjective={active:true,objective:1,target:300,baselineDuration:20};run.resetObjective();
 assert.equal(run.state.seconds,73);assert.equal(run.player.sessionLength,0);
 run.advance(4);assert.equal(run.state.seconds,77);assert.equal(run.player.sessionLength,4);
 run.state.strokes=240;run.roundObjective.objective=2;run.resetObjective();
 assert.equal(run.state.strokes,240);assert.equal(run.effectiveStats().strokes,0);
 run.state.strokes+=9;
 const restored=Run.restore(catalog,JSON.parse(JSON.stringify(run.export())));
 assert.equal(restored.state.seconds,77);assert.equal(restored.effectiveStats().seconds,4);
 assert.equal(restored.effectiveStats().strokes,9);assert.equal(restored.objectiveStats().strokes,9);
});

test('a second duration reset uses absolute elapsed time instead of the already effective duration',()=>{
 const run=new Run(catalog);run.state.seconds=100;run.player.sessionLength=100;
 run.roundObjective={active:true,objective:1,target:300,baselineDuration:0};run.resetObjective();
 run.advance(50);assert.equal(run.player.sessionLength,50);
 run.resetObjective();assert.equal(run.player.sessionLength,0);
 assert.equal(run.state.seconds,150);assert.equal(run.effectiveStats().seconds,0);
});

test('meter gain uses effective edges and elapsed session duration after their resets',()=>{
 const run=new Run(catalog);run.state.seconds=300;run.state.edges=4;run.state.metricResetOffsets={edges:4,sessionLength:300};
 run.player.sessionLength=0;run.beat();assert.equal(run.state.meter,.00025);
 run.state.edges++;run.beat();assert.equal(run.state.meter,.00025+.00025+1/3/2000);
});

test('session settlement and challenge metrics receive effective post-reset values',()=>{
 const run=new Run(catalog);run.state.seconds=73;run.player.sessionLength=73;run.state.strokes=240;
 run.roundObjective={active:true,objective:1,target:300,baselineDuration:0};run.resetObjective();
 run.state.seconds+=12;run.roundObjective.objective=2;run.resetObjective();run.state.strokes+=9;
 const stats={...run.effectiveStats(),mode:0,difficulty:1,objective:2,won:true};let xpInput;
 const profile=Progression.settleSession({version:1,packs:[],unlock_points:0},stats,'metrics-reset',contract,value=>{xpInput=value;return 0;});
 assert.equal(xpInput.seconds,12);assert.equal(xpInput.strokes,9);
 assert.equal(profile.progression.lifetime_metrics.SessionDuration,12);
 assert.equal(profile.progression.lifetime_metrics.Strokes,9);
 assert.equal(run.state.seconds,85);assert.equal(run.state.strokes,249);
});
