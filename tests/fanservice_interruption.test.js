const test=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run');
const modes=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json');

test('one Classic return edge resumes the interrupted ordinary task without draining its frozen queue',()=>{
 let run=new Run(modes,{seed:137,cardRules,settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300}});
 run.startCard('slow');run.advance(2);
 const before=run.export();run.interrupt();run=Run.restore(modes,run.export());run.resumeInterrupted();
 run.advance(3);run.edge();run.advance(1);
 assert.equal(run.returnEdge,null);
 assert.equal(run.state.edge.phase,'idle');
 assert.equal(run.state.cardFlow.pool,'slow');
 assert.equal(run.state.canUseItems,true);
 assert.equal(run.state.cardFlow.completed,before.state.cardFlow.completed);
 run.advance(0);
 assert.equal(run.state.cardFlow.completed,before.state.cardFlow.completed,'Return time cannot deliver the frozen task beats');
 run.advance(3);
 assert.ok(run.state.cardFlow.completed>before.state.cardFlow.completed);
});

test('reloading an interrupted Classic refocus edge retains the original task and replays only that edge',()=>{
 let run=new Run(modes,{seed:137,cardRules,settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300}});
 run.startCard('medium');run.advance(2);const before=run.export();
 run.interrupt();run.resumeInterrupted();run.advance(3);run.edge();
 run.interrupt();run=Run.restore(modes,run.export());run.resumeInterrupted();
 run.advance(3);run.edge();run.advance(1);
 assert.equal(run.returnEdge,null);assert.equal(run.state.edges,1);
 assert.equal(run.state.edge.phase,'idle');assert.equal(run.state.cardFlow.pool,'medium');
 assert.equal(run.state.cardFlow.completed,before.state.cardFlow.completed);
 assert.equal(run.state.canUseItems,true);
});

test('interrupted current edge rolls back its beats and reward while retaining the completed edge',()=>{
 const run=new Run(modes,{seed:137,cardRules});run.startCard('slow');
 run.edge();run.advance(1);run.continueEdgeRest();
 const start=run.export();
 run.advance(5);run.edge();
 assert.equal(run.state.edges,2);assert.equal(run.state.edge.bank,20);
 run.interrupt();const restored=Run.restore(modes,run.export());
 restored.resumeInterrupted();
 assert.equal(restored.state.edge.phase,'sequence');
 assert.equal(restored.state.edges,1);assert.equal(restored.state.edge.streak,1);assert.equal(restored.state.edge.bank,0);
 assert.equal(restored.state.meter,start.state.meter);assert.equal(restored.state.strokes,start.state.strokes);
 assert.deepEqual(restored.state.cardFlow,start.state.cardFlow);
 restored.advance(5);restored.edge();
 assert.equal(restored.state.edges,2);assert.equal(restored.state.edge.bank,20);
});

test('legacy session without an edge-start snapshot retains saved earnings and begins a fresh return edge',()=>{
 const run=new Run(modes,{seed:137,cardRules});run.startCard('slow');run.edge();run.advance(1);run.continueEdgeRest();run.advance(5);
 const legacy=run.export();delete legacy.edgeCheckpoint;
 const restored=Run.restore(modes,legacy);restored.interrupt();restored.resumeInterrupted();
 assert.equal(restored.state.strokes,legacy.state.strokes);assert.equal(restored.state.meter,legacy.state.meter);
 assert.equal(restored.state.edges,legacy.state.edges);assert.equal(restored.state.cardFlow.nextHit,0);
 assert.equal(restored.state.cardFlow.started,legacy.state.seconds);
});

test('objective completion discards the old edge checkpoint before a later interruption',()=>{
 const run=new Run(modes,{seed:137,cardRules,settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300}});
 run.startCard('slow');run.edge();run.advance(1);run.continueEdgeRest();run.advance(300);
 assert.equal(run.objective.releaseDeadline,361);
 run.interrupt();run.resumeInterrupted();
 assert.equal(run.objective.releaseDeadline,361);assert.equal(run.state.seconds,301);
});

test('music return edge runs real beats and survives repeated reload without compounding its effects',()=>{
 let run=new Run(modes,{mode:2,seed:137,cardRules});run.advance(12);run.beat();
 const before=run.export();run.interrupt();run.resumeInterrupted();
 assert.equal(run.state.card,5);assert.ok(run.state.cardFlow.assigned>=15);assert.ok(run.returnEdge);
 const start=run.export();
 for(let n=0;n<3;n++){
  run.advance(5);run.edge();assert.equal(run.state.edges,1);
  run.interrupt();run=Run.restore(modes,run.export());run.resumeInterrupted();
  assert.equal(run.state.edges,0);assert.equal(run.state.strokes,before.state.strokes);
  assert.equal(run.state.meter,before.state.meter);assert.deepEqual(run.state.cardFlow,start.state.cardFlow);
  assert.ok(JSON.stringify(run.export()).length<100000);
 }
 run.advance(5);run.edge();run.advance(1);
 assert.equal(run.state.edges,1);assert.equal(run.returnEdge,null);assert.equal(run.state.card,before.state.card);
 assert.equal(run.state.edge.phase,'idle');
});
