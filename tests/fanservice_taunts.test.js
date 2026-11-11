const test=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run'),Taunts=require('../static/fanservice/taunts'),Punishment=require('../static/fanservice/punishment');
const modes=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json');
const session=config=>new Run(modes,{seed:137,cardRules,...config});

test('taunt guards follow the UI_Manager handler order',()=>{
 const run=session();
 run.state.card=6;assert.deepEqual(Taunts.guard(run),{reason:'cum'});
 run.state.card=5;assert.deepEqual(Taunts.guard(run),{reason:'edge'});
 run.state.card=2;assert.equal(Taunts.guard(run),null);
 run.state.finished=true;assert.deepEqual(Taunts.guard(run),{reason:'not-playing'});
});

test('normal taunt adds 25 heat, spawns the traced fast card, and counts once',()=>{
 const run=session(),result=Taunts.taunt(run);
 assert.equal(result.ok,true);assert.equal(result.branch,'normal');
 assert.equal(run.state.heat,25);
 assert.equal(run.state.TimesTaunted,1);assert.equal(run.state.TotalTauntsUsed,1);
 assert.equal(run.state.hasTaunted,true);assert.equal(run.state.tauntCooldownUntil,5);
 const flow=run.state.cardFlow;
 assert.equal(flow.pool,'fast');assert.equal(flow.card,2);assert.equal(flow.taunt,true);
 assert(flow.interval>=.28&&flow.interval<=.322);
 assert(flow.assigned>=20&&flow.assigned<=30);
 // Same seed: the traced [0.18,0.23] roll lands below the timing() 0.28
 // floor, so the delivered interval is exactly 0.28 with 20 strokes.
 assert.equal(flow.interval,0.28);
 assert.equal(flow.assigned,20);
 assert.equal(result.temptingFate,false);
});

test('the fifth taunt shows Tempting Fate',()=>{
 const run=session();run.state.TotalTauntsUsed=4;
 const result=Taunts.taunt(run);
 assert.equal(result.totalTaunts,5);assert.equal(result.temptingFate,true);
});

test('taunting during a succubus card changes no heat, spawns nothing, and counts only the metric',()=>{
 const run=session(),before=run.startCard('succubus'),generation=before.generation;
 const result=Taunts.taunt(run);
 assert.equal(result.ok,true);assert.equal(result.branch,'succubus');
 assert.equal(run.state.heat,0);
 assert.equal(run.state.TimesTaunted,1);assert.equal(run.state.TotalTauntsUsed,0);
 assert.equal(run.state.card,3);assert.equal(run.state.cardFlow.generation,generation);
 assert.equal(run.state.hasTaunted,true);assert.equal(run.state.tauntCooldownUntil,5);
 assert.equal(result.temptingFate,false);
});

test('Firemouth taunt adds 50 heat, summons a succubus, and counts only the metric',()=>{
 const run=session();run.ownedModifiers.push(15);
 const result=Taunts.taunt(run);
 assert.equal(result.ok,true);assert.equal(result.branch,'firemouth');
 assert.equal(run.state.heat,50);
 assert.equal(run.state.card,3);assert.equal(run.state.cardFlow.pool,'succubus');
 assert.equal(run.state.TimesTaunted,1);assert.equal(run.state.TotalTauntsUsed,0);
 assert.equal(run.state.hasTaunted,true);
});

test('Firemouth is recognised by name as well as by modifier index',()=>{
 const run=session({modifiers:['Firemouth']});
 assert.equal(Taunts.isFiremouth(run),true);
 assert.equal(Taunts.taunt(run).branch,'firemouth');
});

test('cooldown blocks before already-taunted, and a new card clears the once-per-card lock',()=>{
 const run=session();
 assert.equal(Taunts.taunt(run).ok,true);
 assert.deepEqual(Taunts.guard(run),{reason:'cooldown',seconds:5});
 assert.deepEqual(Taunts.taunt(run),{ok:false,reason:'cooldown',seconds:5});
 run.advance(2);
 assert.deepEqual(Taunts.guard(run),{reason:'cooldown',seconds:3});
 run.advance(3);
 assert.deepEqual(Taunts.guard(run),{reason:'already'});
 assert.deepEqual(Taunts.taunt(run),{ok:false,reason:'already'});
 run.startCard('slow');
 assert.equal(Taunts.guard(run),null);
 assert.equal(Taunts.taunt(run).ok,true);
});

test('a new card does not clear the lock after the player has came',()=>{
 const run=session();
 assert.equal(Taunts.taunt(run).ok,true);
 run.player.hasCame=true;run.startCard('slow');
 assert.equal(run.state.hasTaunted,true);
});

test('the punishment roll reads the taunt count, not the challenge metric',()=>{
 const run=session();run.ownedModifiers.push(15);
 Taunts.taunt(run);
 assert.equal(run.state.TimesTaunted,1);assert.equal(run.state.TotalTauntsUsed,0);
 assert.equal(Punishment.roll(run.state.TotalTauntsUsed||0,{fraction:()=>0}),false);
 assert.equal(Punishment.rate(run.state.TotalTauntsUsed||0),0);
 const plain=session();
 for(let i=0;i<5;i++){plain.startCard('slow');Taunts.taunt(plain);plain.advance(5);}
 assert.equal(plain.state.TotalTauntsUsed,5);assert.equal(Punishment.rate(plain.state.TotalTauntsUsed),20);
});
