const test=require('node:test');
const assert=require('node:assert/strict');
const {check}=require('../static/fanservice/spawn_eligibility.js');

const base={heatCategory:1,combo:0,canSuccubiSpawn:false,shieldToggled:true,shieldCharges:2,shieldBlockCount:0,enhancedPlating:false,demonProof:false,exorcistRemaining:0};
test('default false flag routes a charged active shield through consumption',()=>{
 assert.deepEqual(check(base),{eligible:false,shieldCharges:1,shieldBlockCount:0,shieldToggled:true,blocked:true});
 assert.deepEqual(check({...base,shieldCharges:1}),{eligible:false,shieldCharges:0,shieldBlockCount:0,shieldToggled:false,blocked:true});
});
test('Enhanced Plating blocks once without a charge then consumes and resets count',()=>{
 assert.deepEqual(check({...base,enhancedPlating:true}),{eligible:false,shieldCharges:2,shieldBlockCount:1,shieldToggled:true,blocked:true});
 assert.deepEqual(check({...base,enhancedPlating:true,shieldBlockCount:1}),{eligible:false,shieldCharges:1,shieldBlockCount:0,shieldToggled:true,blocked:true});
 assert.deepEqual(check({...base,enhancedPlating:true,shieldBlockCount:1,shieldCharges:1}),{eligible:false,shieldCharges:0,shieldBlockCount:0,shieldToggled:false,blocked:true});
 assert.throws(()=>check({...base,enhancedPlating:true,shieldBlockCount:undefined}),/shieldBlockCount/);
});
test('true spawn flag bypasses shield but still checks heat and combo',()=>{
 assert.deepEqual(check({...base,canSuccubiSpawn:true,heatCategory:0}),{eligible:true,shieldCharges:2,shieldBlockCount:0,shieldToggled:true,blocked:false});
 assert.equal(check({...base,canSuccubiSpawn:true}).eligible,false);
 assert.equal(check({...base,canSuccubiSpawn:true,combo:2000}).eligible,true);
});
test('without a shielding route heat category zero or combo threshold grants eligibility',()=>{
 assert.equal(check({...base,shieldToggled:false,heatCategory:0}).eligible,true);
 assert.equal(check({...base,shieldCharges:0,combo:1999}).eligible,false);
 assert.equal(check({...base,shieldCharges:0,combo:2000}).eligible,true);
});
test('Demon Proof and exorcist cooldown stop before shield effects',()=>{
 for(const guard of [{demonProof:true},{exorcistRemaining:1}]){
  assert.deepEqual(check({...base,...guard,heatCategory:0}),{eligible:false,shieldCharges:2,shieldBlockCount:0,shieldToggled:true,blocked:false});
 }
});
