const test=require('node:test');
const assert=require('node:assert/strict');
const Punishment=require('../static/fanservice/punishment');

// RollPunishmentChance (reJOIce newer-20261017, functions/BP_GlobalManager/
// RollPunishmentChance.json): rate = (TotalTauntsUsed / 5, integer division)
// * 20, printed as "Risk of Punishment: {float}", then the "Roll Chance
// (0-100%)" helper decides WasPunishmentTriggered. The rate is not clamped:
// 30 taunts is 120%, which always triggers.
test('punishment rate is floor(taunts/5)*20 with no clamp',()=>{
 assert.equal(Punishment.rate(0),0);
 assert.equal(Punishment.rate(4),0);
 assert.equal(Punishment.rate(5),20);
 assert.equal(Punishment.rate(9),20);
 assert.equal(Punishment.rate(10),40);
 assert.equal(Punishment.rate(15),60);
 assert.equal(Punishment.rate(20),80);
 assert.equal(Punishment.rate(24),80);
 assert.equal(Punishment.rate(25),100);
 assert.equal(Punishment.rate(30),120);
 assert.equal(Punishment.rate(-3),0);
 assert.equal(Punishment.rate(undefined),0);
 assert.equal(Punishment.rate(NaN),0);
});

test('punishment roll uses the traced rate against a 0-100 roll',()=>{
 const at=(value)=>({fraction:()=>value});
 assert.equal(Punishment.roll(5,at(0.19)),true);
 assert.equal(Punishment.roll(5,at(0.20)),false);
 assert.equal(Punishment.roll(5,at(0)),true);
 assert.equal(Punishment.roll(0,at(0)),false);
 assert.equal(Punishment.roll(4,at(0)),false);
 assert.equal(Punishment.roll(25,at(0.999)),true);
 assert.equal(Punishment.roll(25,null),false);
 assert.equal(Punishment.roll(25,{}),false);
});

test('punishment spawn parameters are the traced SpawnCustomCardEvent args',()=>{
 // SpawnPunishmentEvent (GM ubergraph stmts 1440-1460):
 // SpawnCustomCardEvent(SuccubusCards, 30, 50, 0.28, 0.33, byte(3), 1.0,
 // Stroke Count Multiplier, SlateBrush, StrokeInterval), CurrentCardTypeEnum
 // = byte(3), Change Beat Background(8) -> 'tauntbackground'
 // (HandleBackGroundChange: 'tauntbackground' maps to byte 8), and the
 // "Punishment" notification "Your boasts have consequences."
 assert.deepEqual(Punishment.spawnParams,{
  pool:'succubus',cardType:3,minStrokes:30,maxStrokes:50,
  minInterval:0.28,maxInterval:0.33,timeMultiplier:1,travel:1.5,
  background:'tauntbackground',notificationTitle:'Punishment',
  notificationBody:'Your boasts have consequences.'
 });
 assert.ok(Punishment.sourceLedger.length>0);
 assert.ok(Punishment.sourceLedger.some(entry=>entry.includes('RollPunishmentChance')));
 assert.ok(Punishment.sourceLedger.some(entry=>entry.includes('1440')));
});
