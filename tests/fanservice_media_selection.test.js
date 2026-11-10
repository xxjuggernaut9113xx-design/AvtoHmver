const test=require('node:test'),assert=require('node:assert/strict');
const {heatBand,weightedEvents}=require('../static/fanservice/media_selection');
const rows=require('../static/fanservice/data/special-events.json').rows;

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
