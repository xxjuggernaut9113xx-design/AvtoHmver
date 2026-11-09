const test=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run');
const catalog=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json');
const restore=run=>Run.restore(catalog,JSON.parse(JSON.stringify(run.export())));

// These exercise the shared player runtime. Catalog targets and card queues remain
// reconstruction inputs; passing these cases does not establish original parity.
function finishObjective(run){
 const objective=run.roundObjective||run.objective.state;
 for(let attempts=0;attempts<1000&&run.phase==='playing';attempts++){
  if(objective.objective===6){run.climax();break;}
  if(objective.objective===7){run.tribute();continue;}
  if(run.player.isAllowedToCum){run.climax();break;}
  if(objective.objective===1){run.advance(Math.max(0,objective.target-(run.player.sessionLength-objective.baselineDuration))+.000001);continue;}
  const current=run.state.cardFlow;
  const flow=current&&!current.ended?current:run.startCard(objective.objective===8?'succubus':'slow');
  assert(flow);run.advance(Math.max(0,flow.queue.at(-1).TargetHitTime-(run.state.seconds-flow.started))+.000001);
 }
 assert.notEqual(run.phase,'playing','objective must finish through delivered gameplay');
}

test('Classic timer checkpoint retains release deadline and completion stays settled',()=>{
 let run=new Run(catalog,{cardRules,settings:{LastObjectiveIndex_Classic:1,LastObjective_Timer:300}});
 run.advance(299);run=restore(run);assert.equal(run.player.isAllowedToCum,false);
 assert(run.advance(1).some(event=>event.type==='release-window-opened'));
 run=restore(run);assert.equal(run.objective.releaseDeadline,360);
 assert.equal(run.climax()[0].type,'successful-cum');assert.equal(run.state.won,true);
 const settled=run.export();run=restore(run);
 assert.deepEqual(run.climax(),[]);assert.deepEqual(run.advance(100),[]);assert.deepEqual(run.export(),settled);
});

test('Classic stroke and Succu Slayer objectives finish from delivered card queues across reloads',()=>{
 for(const settings of [{LastObjectiveIndex_Classic:2,LastObjective_Strokes:100},{LastObjectiveIndex_Classic:6,LastObjective_SuccuSlayer:5}]){
  let run=new Run(catalog,{seed:137,cardRules,settings});
  const flow=run.startCard(settings.LastObjectiveIndex_Classic===6?'succubus':'slow');
  run.advance(flow.queue[Math.floor(flow.queue.length/2)].TargetHitTime);
  run=restore(run);finishObjective(run);
  assert.equal(run.state.won,true);assert.equal(run.phase,'complete');
  const settled=run.export();run=restore(run);assert.deepEqual(run.climax(),[]);assert.deepEqual(run.export(),settled);
 }
});

test('finite Tower objectives settle rewards once across draft, active-card and intermission checkpoints',()=>{
 let run=new Run(catalog,{mode:1,rounds:3,seed:1,cardRules});
 for(let round=1;round<=3;round++){
  run=restore(run);
  const index=run.tower.options.findIndex(option=>[1,2,6,7,8].includes(option.objective));
  assert(index>=0);run.select(index);
  const selected=structuredClone(run.tower.selected);
  if([2,8].includes(selected.objective)){
   const flow=run.startCard(selected.objective===8?'succubus':'slow');
   run.advance(flow.queue[Math.floor(flow.queue.length/2)].TargetHitTime);
   assert(run.state.cardFlow.completed>0);
  }
  run=restore(run);finishObjective(run);
  assert.deepEqual(run.redeemedRounds,Array.from({length:round},(_,i)=>i+1));
  assert.equal(run.tower.failed,0);assert(selected.native_rewards.length>=2);
  const currency=[run.state.coins,run.state.succuCoins],inventory=run.inventory.export();
  run=restore(run);run.advance(60);run.climax();
  assert.deepEqual([run.state.coins,run.state.succuCoins],currency);assert.deepEqual(run.inventory.export(),inventory);
  if(round<3){assert.equal(run.phase,'shop');run.continue();}
 }
 assert.equal(run.phase,'complete');assert.equal(run.state.won,true);assert.equal(run.state.BestTowerWinRounds,3);
});
