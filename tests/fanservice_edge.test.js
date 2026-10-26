const test=require('node:test'),assert=require('node:assert/strict');
const Edge=require('../static/fanservice/edge'),Cards=require('../static/fanservice/cards'),{Run}=require('../static/fanservice/run');
const modes=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json');
function session(config={}){const run=new Run(modes,{seed:137,cardRules,...config});run.startCard('slow');return run;}
function handoff(run){const e=run.state.edge,seconds=e.postBreak>=2?e.perfect?.9:.9+Math.trunc(e.postBreak)-1:1;return run.advance(seconds+.00001);}
function reachMercy(run){for(let n=1;n<=5;n++){assert(run.edge().some(e=>e.type==='edge-recorded'));handoff(run);if(n<5){assert.equal(run.state.edge.phase,'rest');run.continueEdgeRest();}}assert.equal(run.state.edge.phase,'mercy');}

test('newer direct Edge action records without requiring or fabricating an inventory charge',()=>{
 const run=session(),items=run.inventory.export(),events=run.edge(),e=run.state.edge;
 assert(events.some(e=>e.type==='edge-recorded'));assert.equal(run.state.edges,1);assert.equal(e.streak,1);assert.equal(e.lastCount,25);assert.equal(e.breakScaled,10);assert.equal(e.postBreak,1.75);assert.equal(e.deadline,1);assert.equal(e.bank,0);assert.equal(run.state.EdgeStreak,1);assert.deepEqual(run.inventory.export(),items);
});

test('edge handoff uses the source one-second boundary before a ten-second rest',()=>{
 const run=session();run.edge();run.advance(.999);assert.equal(run.state.edge.phase,'handoff');run.advance(.001);assert.equal(run.state.edge.phase,'rest');assert.equal(run.state.edge.until,4);assert.equal(run.state.edge.deadline,11);const strokes=run.state.strokes;
 run.advance(9.999);assert.equal(run.state.edge.phase,'rest');assert.equal(run.state.strokes,strokes);run.advance(.001);assert.equal(run.state.edge.phase,'sequence');assert.equal(run.state.card,5);assert.equal(run.state.cardFlow.started,11);assert.equal(run.state.canUseItems,false);
});

test('G-style rest cancellation starts a bounded source edge pattern without skipping a metric',()=>{
 const run=session();run.edge();run.advance(1);const events=run.continueEdgeRest(),flow=run.state.cardFlow;
 assert(events.some(e=>e.type==='edge-card-started'));assert.equal(flow.card,5);assert(flow.assigned>=15&&flow.assigned<=75);assert(flow.interval>=.28&&flow.interval<=5);assert.equal(run.state.edges,1);assert.equal(Edge.active(run),true);
});

test('normal repeat edge banks thirty and adds .05 meter from the measured ratio',()=>{
 const run=session();run.edge();handoff(run);run.continueEdgeRest();const meter=run.state.meter,events=run.edge();assert.equal(events[0].ratio,0);assert.equal(events[0].perfect,false);assert.equal(run.state.edge.bank,30);assert.equal(run.state.meter,meter+.05);assert.equal(run.state.edges,2);assert.equal(run.state.PerfectEdges,undefined);assert(run.state.edge.breakScaled>=9&&run.state.edge.breakScaled<=9.5);
});

test('perfect repeat edge uses the source .85 boundary, fifty bank and .08 meter',()=>{
 const run=session();run.edge();handoff(run);run.continueEdgeRest();const flow=run.state.cardFlow,index=Math.ceil(flow.assigned*.85)-1;
 run.advance(flow.started+flow.queue[index].TargetHitTime-run.state.seconds+.00001);const meter=run.state.meter,events=run.edge();assert(events[0].ratio>=.85);assert.equal(events[0].perfect,true);assert.equal(run.state.edge.bank,50);assert.equal(run.state.PerfectEdges,1);assert.equal(run.state.meter,meter+.08);
});

test('Deal With The Devil retains edge metrics and bank without adding edge meter',()=>{
 const run=session({modifiers:['Deal With The Devil']});run.edge();handoff(run);run.continueEdgeRest();const meter=run.state.meter;run.edge();assert.equal(run.state.meter,meter);assert.equal(run.state.edge.bank,30);assert.equal(run.state.edges,2);
});

test('pending edge handoff/rest/hold rejects repeated activation instead of duplicate rewards',()=>{
 const run=session();run.edge();assert.deepEqual(Edge.trigger(run),[]);assert.equal(run.state.edges,1);run.advance(1);assert.deepEqual(Edge.trigger(run),[]);assert.equal(run.state.edges,1);
});

test('fifth normal edge uses .9-second handoff and the truncated hold before Mercy',()=>{
 const run=session();for(let n=1;n<5;n++){run.edge();handoff(run);run.continueEdgeRest();}
 run.edge();assert.equal(run.state.edge.postBreak,2.75);run.advance(.899);assert.equal(run.state.edge.phase,'handoff');run.advance(.00101);assert.equal(run.state.edge.phase,'hold');assert.equal(run.state.edge.holdRemaining,1);run.advance(.999);assert.equal(run.state.edge.phase,'hold');run.advance(.001);assert.equal(run.state.edge.phase,'mercy');assert.equal(run.state.edge.bank,120);
});

test('Mercy acceptance pays the bank exactly once and starts cancellable sixty-second rest',()=>{
 const run=session();reachMercy(run);const before=run.state.coins,meter=run.state.meter;run.state.heat=70;const events=run.mercy(true);assert.equal(events[0].earned,120);assert.equal(run.state.coins,before+120);assert.equal(run.state.edge.bank,0);assert.equal(run.state.heat,0);assert.equal(run.state.meter,meter+.01);assert.equal(run.state.edge.deadline,run.state.seconds+60);assert.deepEqual(run.mercy(true),[]);assert.equal(run.state.coins,before+120);
 const strokes=run.state.strokes;run.advance(59);assert.equal(run.state.strokes,strokes);assert.equal(run.state.edge.phase,'mercy-rest');assert(run.continueEdgeRest().some(e=>e.type==='edge-streak-ended'));assert.equal(run.state.edge.phase,'idle');
});

test('Mercy rejection retains the bank and increases source edges-until-Mercy by truncated 1.25',()=>{
 const run=session();reachMercy(run);const coins=run.state.coins;assert(run.mercy(false).some(e=>e.type==='mercy-declined'));assert.equal(run.state.edge.masterUntil,6);assert.equal(run.state.edge.until,6);assert.equal(run.state.edge.bank,120);assert.equal(run.state.coins,coins);assert.equal(run.state.card,5);assert.equal(run.state.edge.phase,'sequence');assert.deepEqual(run.mercy(false),[]);
});

test('edge hold and rest restore exact deadlines, pattern and RNG through checkpoint reload',()=>{
 const run=session();run.edge();run.advance(.5);const resumed=Run.restore(modes,run.export());for(const current of [run,resumed]){current.advance(.5);current.continueEdgeRest();current.advance(2);current.edge();handoff(current);}assert.deepEqual(resumed.export(),run.export());
});

test('Edge objective reaches its actual count producer and opens a release window without synthetic counters',()=>{
 const run=session({settings:{LastObjectiveIndex_Classic:3,LastObjective_Edges:2}});run.edge();handoff(run);run.continueEdgeRest();const events=run.edge();assert.equal(run.state.edges,2);assert(events.some(e=>e.type==='release-window-opened'));assert(run.player.isAllowedToCum);run.climax();assert.equal(run.phase,'complete');assert.equal(run.state.edge.phase,'idle');assert(run.state.won);
});

test('music and inactive phases reject direct Edge and its UI cannot manufacture metrics',()=>{
 const music=new Run(modes,{mode:2,cardRules});assert.deepEqual(Edge.trigger(music),[]);assert.equal(music.state.edges,0);
 const run=session();run.phase='shop';assert.deepEqual(Edge.trigger(run),[]);run.phase='complete';assert.deepEqual(Edge.trigger(run),[]);assert.equal(run.state.edges,0);
});

test('source 999-tail remains compact through the bounded handoff and never completes as a reward',()=>{
 const run=session();const assigned=run.state.cardFlow.assigned;run.edge();const flow=run.state.cardFlow;assert(flow.assigned>=assigned);assert(flow.queue.length<200);assert(JSON.stringify(run.export()).length<100000);handoff(run);assert.equal(run.state.enemies,undefined);assert.equal(run.state.succubi,0);assert(flow.suspended);
});
