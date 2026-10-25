const test=require('node:test'),assert=require('node:assert/strict');
const Cards=require('../static/fanservice/cards'),{Run}=require('../static/fanservice/run'),Economy=require('../static/fanservice/economy');
const modes=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json');
const timingTraces=require('./fixtures/fanservice/card-timing-traces.json'),queueTraces=require('./fixtures/fanservice/beat-queue-traces.json');
const session=config=>new Run(modes,{seed:137,cardRules,...config});
const last=flow=>flow.queue.at(-1)?.TargetHitTime||0;

test('card timing matches all 128 retained numeric Blueprint fixtures',()=>{
 assert.equal(timingTraces.fixtures.length,128);
 for(const row of timingTraces.fixtures){const i=row.inputs,expected=row.writes,result=Cards.timing(i['call:RandomIntegerInRange'],i['call:RandomFloatInRange'],i.StrokeCountMultiplier,i['GlobalManager.UserStrokeCountMultiplier'],i.TimeSpeedMultiplier);assert.equal(result.count,expected['GlobalManager.PlayerVariablesStruct.CurrentStrokeCount']);assert.equal(result.interval,expected['GlobalManager.PlayerVariablesStruct.BeatSpawnInterval']);}
});

test('pattern construction matches every field in 186 retained native queue fixtures',()=>{
 assert.equal(queueTraces.fixtures.length,186);
 for(const row of queueTraces.fixtures){const actual=Cards.queue(row.multipliers,row.base_interval,row.stroke_count,row.speed,row.travel_time,row.minimum_interval);assert.equal(actual.length,row.queue.length);for(let i=0;i<actual.length;i++)for(const key of Object.keys(row.queue[i]))assert.ok(Math.abs(actual[i][key]-row.queue[i][key])<1e-10,`${row.bank}/${row.pattern_slot}/${i}/${key}`);}
});

test('source pattern banks create bounded cards with travel time and exact stroke completion',()=>{
 const run=session(),flow=run.startCard('slow');assert(flow.assigned>0);assert.equal(flow.nextHit,0);run.advance(flow.travel-.001);assert.equal(run.state.strokes,0);
 const events=run.advance(last(flow)+.001);assert.equal(run.state.strokes,flow.assigned);assert.equal(run.state.enemies,1);assert.equal(flow.remaining,0);assert(flow.ended);assert.equal(events.filter(e=>e.type==='card-complete').length,1);
 const coins=run.state.coins;run.advance(100);assert.equal(run.state.coins,coins);assert.equal(run.state.enemies,1);
});

test('encounter completion produces actual objective metrics and source run-currency rewards',()=>{
 const run=session({settings:{LastObjectiveIndex_Classic:6,LastObjective_SuccuSlayer:5}});
 for(let n=0;n<5;n++){const flow=run.startCard('succubus');run.advance(last(flow)+.001);assert.equal(run.state.succubi,n+1);}
 assert.equal(run.state.succuCoins,5);assert.equal(run.state.ConsecutiveSuccubiSurvived,5);assert(run.player.isAllowedToCum);assert(run.objective.releaseDeadline>run.state.seconds);
 assert.equal(run.climax()[0].type,'successful-cum');assert.equal(run.phase,'complete');assert(run.state.won);
});

test('ordinary card completion resets consecutive encounters without changing their total',()=>{
 const run=session();let flow=run.startCard('succubus');run.advance(last(flow)+.001);assert.equal(run.state.succubi,1);assert.equal(run.state.ConsecutiveSuccubiSurvived,1);
 flow=run.startCard('fast');run.advance(last(flow)+.001);assert.equal(run.state.succubi,1);assert.equal(run.state.enemies,1);assert.equal(run.state.ConsecutiveSuccubiSurvived,0);
});

test('mid-card restore retains exact queue, next hit, random stream and once-only completion',()=>{
 const run=session();const flow=run.startCard('succubus');run.advance(flow.queue[5].TargetHitTime+.001);const restored=Run.restore(modes,run.export());
 for(const current of [run,restored])current.advance(last(current.state.cardFlow));
 assert.deepEqual(restored.export(),run.export());assert.equal(run.state.succubi,1);assert.equal(run.state.succuCoins,1);
 for(const current of [run,restored])current.startCard('medium');assert.deepEqual(restored.export(),run.export());
});

test('source encounter modifiers apply bounded currency, cooldown and equipped-item reward',()=>{
 const run=session();run.ownedModifiers=[10,12,18];run.inventory.equip(1,0);const result=Economy.succubusDefeated(run,1);
 assert.equal(result.succuCoins,3);assert.equal(run.state.succuCoins,3);assert.equal(result.item,1);assert.equal(run.inventory.state(1).charges,1);assert.equal(run.state.economy.exorcistRemaining,30);
 run.inventory.hotbarItems=[8,8,8,8,8];const fallback=Economy.succubusDefeated(run,1);assert.equal(fallback.coins,75);assert.equal(run.state.coins,75);
});

test('Hivemind, Infernal Clause, Double Devil and Molasses affect source card timing',()=>{
 const a=session({modifiers:['Hivemind','Double Devil']}),b=session({modifiers:['Hivemind','Double Devil']});a.state.succubi=b.state.succubi=5;b.ownedModifiers=[7,6];
 const left=a.startCard('succubus'),right=b.startCard('succubus');assert(right.assigned<left.assigned);assert.equal(right.interval,left.interval*2);assert.equal(right.travel,1.5);
});

test('breaks delay existing queue hits rather than discarding or scoring them',()=>{
 const run=session(),flow=run.startCard('medium');run.advance(flow.travel/2);const before=run.state.strokes;assert(run.delayCard(5));run.advance(5);assert.equal(run.state.strokes,before);
 run.advance(last(flow)+.01);assert.equal(run.state.strokes,flow.assigned);assert.equal(run.state.enemies,1);
});

test('source future-queue rebuild retains fired entries and supports bounded item speed/count edits',()=>{
 const run=session(),flow=run.startCard('fast');run.advance(.1);const fired=flow.queue.slice(0,flow.nextFire),count=flow.queue.length-flow.nextFire;
 assert(run.modifyCard(.5,2));assert.deepEqual(flow.queue.slice(0,flow.nextFire),fired);assert.equal(flow.queue.length,fired.length+count*2);assert.equal(flow.queue[flow.nextFire].AbsoluteFireTime,run.state.seconds-flow.started+.1);
 const snapshot=JSON.stringify(flow);assert.equal(run.modifyCard(0),false);assert.equal(run.modifyCard(1,1000001),false);assert.equal(JSON.stringify(flow),snapshot);
});

test('Tribute requires explicit presses until the exact objective target, with no early settlement',()=>{
 const run=session({settings:{LastObjectiveIndex_Classic:5,LastObjective_Tribute:2}});assert.equal(run.climax()[0].type,'tribute-recorded');assert.equal(run.state.milkingCount,1);assert.equal(run.phase,'playing');assert(!run.player.hasCame);
 const restored=Run.restore(modes,run.export());const events=restored.climax();assert.equal(restored.state.milkingCount,2);assert(events.some(e=>e.type==='successful-cum'));assert.equal(restored.phase,'complete');assert(restored.player.hasCame);assert.deepEqual(restored.climax(),[]);
});

test('Tribute respects Devil media restriction and active phase without fabricating progress',()=>{
 const run=session({settings:{LastObjectiveIndex_Classic:5},modifiers:['Deal With The Devil']});assert.deepEqual(run.tribute(),[]);assert.equal(run.state.milkingCount,0);
 run.state.card=3;assert.equal(run.tribute()[0].type,'tribute-recorded');assert.equal(run.state.milkingCount,1);run.phase='shop';assert.deepEqual(run.tribute(),[]);assert.equal(run.state.milkingCount,1);
});

test('Tower Tribute completes from the real producer and rewards its selected round once',()=>{
 let run,index;for(let seed=1;seed<100;seed++){const candidate=session({mode:1,rounds:1,seed}),found=candidate.tower.options.findIndex(o=>o.objective===7);if(found>=0){run=candidate;index=found;break;}}
 assert(run);run.select(index);const target=run.roundObjective.target;for(let n=0;n<target;n++)run.tribute();assert.equal(run.phase,'complete');assert.equal(run.state.milkingCount,target);const coins=run.state.coins;assert.deepEqual(run.tribute(),[]);assert.equal(run.state.coins,coins);
});

test('invalid patterns fail boundedly and music mode does not create a second card clock',()=>{
 for(const pattern of [[],[-1,-2],[NaN]])assert.throws(()=>Cards.queue(pattern,.5,1,1,1,.1));assert.throws(()=>Cards.queue([1],.5,1000001,1,1,.1));
 const run=session({mode:2});assert.equal(run.startCard('slow'),null);run.advance(10);assert.equal(run.state.strokes,0);
});


test('doubling a pattern with rests counts actual strokes and completes exactly once',()=>{
 const run=session();run.config.cardRules=structuredClone(run.config.cardRules);run.config.cardRules.patterns.slow=[[-1,1]];
 const flow=run.startCard('slow');run.advance(flow.queue[1].TargetHitTime+.001);assert.equal(run.state.strokes,1);
 assert.equal(run.modifyCard(1,2),true);const strokes=flow.queue.filter(entry=>entry.CustomMultiplier>=0).length;assert.equal(flow.assigned,strokes);
 const events=run.advance(last(flow)+.001);assert.equal(flow.remaining,0);assert.equal(run.state.strokes,strokes);assert.equal(events.filter(event=>event.type==='card-complete').length,1);
 run.advance(100);assert.equal(run.state.enemies,1);
});
