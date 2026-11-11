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
 // Same seed: the traced [0.18,0.23] roll lands below the timing() 0.28
 // floor, so the delivered interval is exactly 0.28; the assigned count is
 // the HighHeat 20-30 roll times the tier-0 count multiplier (0.8), so 20.
 assert.equal(flow.interval,0.28);
 assert(flow.assigned>=16&&flow.assigned<=24);
 assert.equal(flow.assigned,20);
 assert.equal(result.temptingFate,false);
});

test('every accepted taunt adds TauntCumAdd (0.01) to the cum meter',()=>{
 // UI_Manager CDO Default__UI_Manager_C: TauntCumAdd is property #227
 // (DoubleProperty), value 0.01 (0x3F847AE147AE147B). The TauntButton
 // handler calls AddToCumMeter(TauntCumAdd) in the shared epilogue
 // (StartTauntCooldown -> AddToCumMeter) after Taunt() / Firemouth
 // Taunt(); the succubus branch falls through to the same Taunt() call,
 // so the add applies on all three branches, once per accepted taunt.
 const run=session();
 assert.equal(run.state.meter,0);
 assert.equal(Taunts.taunt(run).ok,true);
 assert.equal(run.state.meter,0.01);
 assert.equal(Taunts.tauntCumAdd,0.01);
});

test('Firemouth and succubus taunts add the same cum-meter increment, capped at 1',()=>{
 const fire=session();fire.ownedModifiers.push(15);
 fire.state.meter=0.995;
 assert.equal(Taunts.taunt(fire).branch,'firemouth');
 assert.equal(fire.state.meter,1);
 const succ=session();succ.startCard('succubus');
 succ.state.meter=0.5;
 assert.equal(Taunts.taunt(succ).branch,'succubus');
 assert.equal(succ.state.meter,0.51);
});

test('a blocked taunt does not touch the cum meter',()=>{
 const run=session();run.state.meter=0.4;
 run.state.card=6;
 assert.equal(Taunts.taunt(run).ok,false);
 assert.equal(run.state.meter,0.4);
});

test('the fifth taunt shows Tempting Fate',()=>{
 const run=session();run.state.TotalTauntsUsed=4;
 const result=Taunts.taunt(run);
 assert.equal(result.totalTaunts,5);assert.equal(result.temptingFate,true);
});

test('taunting during a succubus card multiplies the remaining strokes by 4 and runs them 5x faster',()=>{
 const run=session(),before=run.startCard('succubus'),generation=before.generation;
 const assigned=before.assigned,length=before.queue.length;
 const result=Taunts.taunt(run);
 assert.equal(result.ok,true);assert.equal(result.branch,'succubus');
 assert.equal(run.state.heat,0);
 assert.equal(run.state.TimesTaunted,1);assert.equal(run.state.TotalTauntsUsed,0);
 assert.equal(run.state.card,3);
 // Native ApplyStrokeCountModifier(4) (0x14831bc60): card-end index =
 // currentIndex + remaining*4 — the remaining strokes quadruple.
 // ApplySpeedModifier(5.0) (0x14831bb10): the rebuilt beats' intervals are
 // divided by 5 (interval = |pattern| * base * (1/5), floored at minimum).
 assert.equal(result.modifiersApplied,true);
 assert.equal(before.speed,5);
 assert.equal(before.assigned,assigned*4);
 assert.equal(before.remaining,assigned*4);
 assert.equal(before.queue.length,length*4);
 assert.equal(before.generation,generation+1);
 assert.equal(before.queue[0].AbsoluteFireTime,0.1);
 for(const entry of before.queue)assert.equal(entry.Interval,Math.max(Math.abs(entry.CustomMultiplier)*before.interval*(1/before.speed),before.minimum));
 assert.equal(run.state.hasTaunted,true);assert.equal(run.state.tauntCooldownUntil,5);
 assert.equal(result.temptingFate,false);
});

test('a mid-card succubus taunt leaves fired beats untouched and quadruples only the remainder',()=>{
 const run=session(),flow=run.startCard('succubus');
 run.advance(2);
 const fired=flow.nextFire,prefix=structuredClone(flow.queue.slice(0,fired));
 const remaining=flow.remaining,length=flow.queue.length,completed=flow.completed;
 const result=Taunts.taunt(run);
 assert.equal(result.ok,true);assert.equal(result.branch,'succubus');
 assert.equal(result.modifiersApplied,true);
 assert.equal(flow.speed,5);
 assert.deepEqual(flow.queue.slice(0,fired),prefix);
 assert.equal(flow.queue.length,fired+(length-fired)*4);
 // The native multiplies from the fire cursor (currentIndex), not the hit
 // cursor: beats already spawned but still travelling (fired - completed)
 // are preserved, not multiplied; only the unfired entries quadruple.
 assert.equal(flow.queue.length-flow.nextFire,(length-fired)*4);
 assert.equal(flow.remaining,(fired-completed)+(length-fired)*4);
 assert.equal(flow.remaining,remaining+(length-fired)*3);
 assert.equal(flow.queue[fired].AbsoluteFireTime,run.state.seconds-flow.started+.1);
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
