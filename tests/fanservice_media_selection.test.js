const test=require('node:test'),assert=require('node:assert/strict');
const {heatBand,weightedEvents,eligibleSpecialEvents}=require('../static/fanservice/media_selection');
const rows=require('../static/fanservice/data/special-events.json').rows;
const baseState=()=>({heat:50,totalDraws:2,coins:0,mode:0,succubusEligible:false,assFrenzyEligible:false,boobFrenzyEligible:false,favoriteFrenzyEligible:false});
const names=list=>list.map(row=>row.name);

test('heat modifier column follows the native category boundaries',()=>{
 for(const [heat,pool] of [[0,'slow'],[30,'slow'],[30.001,'medium'],[70,'medium'],[70.001,'fast'],[100,'fast']])
  assert.equal(heatBand({heat}),pool);
});

test('heat modifier column changes with run heat',()=>{
 const state={heat:10};
 assert.equal(heatBand(state),'slow');
 state.heat=50;assert.equal(heatBand(state),'medium');
 state.heat=90;assert.equal(heatBand(state),'fast');
 state.heat=25;assert.equal(heatBand(state),'slow');
});

test('invalid heat never silently selects a media pool',()=>{
 for(const heat of [undefined,NaN,Infinity,-1,101,'50'])
  assert.throws(()=>heatBand({heat}),RangeError);
});

test('native heat and combo modifiers produce weighted ordinary and Succubus events',()=>{
 const selected=rows.filter(row=>['SlowStrokeEvent','MediumStrokeEvent','FastStrokeEvent','SuccubusEvent'].includes(row.name));
 // Slow/F: weights 85,25,0,0. High/S: weights 0,15,100,65.
 assert.equal(weightedEvents(selected,{heat:0,comboTier:0},0).name,'SlowStrokeEvent');
 assert.equal(weightedEvents(selected,{heat:0,comboTier:0},85/110).name,'MediumStrokeEvent');
 assert.equal(weightedEvents(selected,{heat:100,comboTier:5},0).name,'MediumStrokeEvent');
 assert.equal(weightedEvents(selected,{heat:100,comboTier:5},116/180).name,'SuccubusEvent');
});

test('weighted selection respects caller eligibility and zero weights',()=>{
 const slow=rows.find(row=>row.name==='SlowStrokeEvent');
 const fast=rows.find(row=>row.name==='FastStrokeEvent');
 assert.equal(weightedEvents([fast],{heat:0,comboTier:0},0),null);
 assert.equal(weightedEvents([slow],{heat:100,comboTier:5},0),null);
 assert.equal(weightedEvents([fast],{heat:100,comboTier:5},.5).name,'FastStrokeEvent');
});

test('eligible special events mirror CheckEventConditions&ReturnArray in native order',()=>{
 // Speed rows are unconditional (switch cases 0/1/2 append with no check);
 // CoinFlip (3), FeetFrenzy (9) and BossSpawn (10) have no switch case at
 // all, so they are never eligible. Caller gates start off.
 assert.deepEqual(names(eligibleSpecialEvents(rows,baseState())),['SlowStrokeEvent','MediumStrokeEvent','FastStrokeEvent']);
 const allOn={...baseState(),heat:20,coins:500,succubusEligible:true,assFrenzyEligible:true,boobFrenzyEligible:true,favoriteFrenzyEligible:true};
 assert.deepEqual(names(eligibleSpecialEvents(rows,allOn)),['SlowStrokeEvent','MediumStrokeEvent','FastStrokeEvent','TemptationEvent','SuccubusEvent','AssFrenzyEvent','BoobFrenzyEvent','StoreEvent','NewRow']);
});

test('MercyEvent is never eligible: the native switch discards its check result',()=>{
 // CheckEventConditions&ReturnArray case 6 calls MercyEligibilityCheck and
 // then PopExecutionFlowIfNot(EX_False) — a constant false, so the branch
 // always pops before the append. The check runs (it prints its debug
 // string) but its result is never used; the row can never be drawn.
 const state={...baseState(),heat:20,coins:500};
 assert.ok(!names(eligibleSpecialEvents(rows,state)).includes('MercyEvent'));
});

test('TemptationEvent needs more than one draw, no cooldown, and heat at most 35',()=>{
 const ok={...baseState(),heat:35};
 assert.ok(names(eligibleSpecialEvents(rows,ok)).includes('TemptationEvent'));
 for(const change of [s=>{s.totalDraws=1;},s=>{s.heat=35.0001;},s=>{s.temptationOnCooldown=true;}]){
  const state={...baseState(),heat:35};change(state);
  assert.ok(!names(eligibleSpecialEvents(rows,state)).includes('TemptationEvent'));
 }
});

test('StoreEvent is Classic-only and needs 200 coins with no cooldown',()=>{
 const ok={...baseState(),coins:200};
 assert.ok(names(eligibleSpecialEvents(rows,ok)).includes('StoreEvent'));
 for(const change of [s=>{s.mode=1;},s=>{s.mode=2;},s=>{s.coins=199;},s=>{s.storeOnCooldown=true;}]){
  const state={...baseState(),coins:200};change(state);
  assert.ok(!names(eligibleSpecialEvents(rows,state)).includes('StoreEvent'));
 }
});

test('AdjustStoreWeight scales the store row from coins, time since last shop and multiplier',()=>{
 // (BaseWeight + 1) * clamp(StoreChanceMultiplier +
 // clamp(TimeSinceLastShop/60*0.04, 0, 2) + floor(PlayerCoins/250)*0.08, 1, 5).
 const store=rows.find(row=>row.name==='StoreEvent');
 const weight=state=>eligibleSpecialEvents(rows,state).find(row=>row.name==='StoreEvent').baseWeight;
 assert.equal(weight({...baseState(),coins:200}),1);
 assert.equal(weight({...baseState(),coins:25000}),5);
 assert.equal(weight({...baseState(),coins:200,timeSinceLastShop:3600}),2);
 assert.equal(weight({...baseState(),coins:200,storeChanceMultiplier:3}),3);
 assert.equal(weight({...baseState(),coins:200,storeChanceMultiplier:-5}),1);
 assert.equal(store.baseWeight,0);
});

test('eligible store row feeds the weighted pick through the native weight pipeline',()=>{
 // Heat slow, combo F: slow 85, medium 25, temptation 15, store 1
 // (adjusted base 1 + slow heat 5 + F combo -5); total 126.
 const state={...baseState(),heat:0,coins:200};
 const eligible=eligibleSpecialEvents(rows,state);
 assert.equal(weightedEvents(eligible,{heat:0,comboTier:0},125.5/126).name,'StoreEvent');
 assert.equal(weightedEvents(eligible,{heat:0,comboTier:0},0).name,'SlowStrokeEvent');
});
