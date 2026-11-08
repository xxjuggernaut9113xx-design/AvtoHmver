const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../static/fanservice/rules.js');
const map={meta:{duration:4},beats:[{time:0,type:'stroke'},{time:1,type:'rest'},{time:2,type:'accent'},{time:4,type:'stroke'}],events:[{time:0,type:'disable_break',value:'start'},{time:2,type:'restore_break'},{time:4,type:'grant_break'}]};
function fixture(){const clock={},order=[];let seconds=0;return {clock,order,get seconds(){return seconds;},callbacks:{advance:elapsed=>{seconds+=elapsed;},beat:beat=>order.push('beat:'+beat.time),event:event=>order.push(event.type)}};}
test('sparse recording callbacks drain every crossed row through natural end once',()=>{
 const f=fixture();rules.recordingSample(map,0,f.clock,f.callbacks,{active:true});
 rules.recordingSample(map,3.5,f.clock,f.callbacks,{active:true});
 assert.equal(f.seconds,3.5);assert.deepEqual(f.order,['disable_break','beat:0','restore_break','beat:2']);
 assert.equal(rules.recordingSample(map,4,f.clock,f.callbacks,{ended:true}).complete,true);
 assert.deepEqual(f.order,['disable_break','beat:0','restore_break','beat:2','grant_break','beat:4']);
 rules.recordingSample(map,4,f.clock,f.callbacks,{ended:true});assert.equal(f.seconds,4);assert.equal(f.order.length,6);
});
test('pause, lead-in and buffering samples cannot advance recording time or cursors',()=>{
 const f=fixture();for(const position of [0,1,2,4])assert.equal(rules.recordingSample(map,position,f.clock,f.callbacks),null);
 assert.equal(f.seconds,0);assert.deepEqual(f.clock,{});assert.deepEqual(f.order,[]);
 rules.recordingSample(map,0,f.clock,f.callbacks,{active:true});
 for(let i=0;i<4;i++)rules.recordingSample(map,0,f.clock,f.callbacks,{active:true});
 assert.equal(f.seconds,0);assert.deepEqual(f.order,['disable_break','beat:0']);
});
test('explicit seek and restored high-water ledger cannot duplicate music rewards',()=>{
 const f=fixture();rules.recordingSample(map,2,f.clock,f.callbacks,{active:true});
 const restored=JSON.parse(JSON.stringify(f.clock));rules.seek(map,0,restored);
 rules.recordingSample(map,2,restored,f.callbacks,{active:true});
 assert.equal(f.order.filter(value=>value.startsWith('beat:')).length,2);
 rules.seek(map,4,restored);rules.recordingSample(map,4,restored,f.callbacks,{ended:true});
 assert.equal(f.order.filter(value=>value==='beat:4').length,1);
});
test('premature recording end is not a completed song',()=>{
 const f=fixture();assert.equal(rules.recordingSample(map,2,f.clock,f.callbacks,{ended:true}).complete,false);
 assert.equal(rules.recordingSample(map,3.99,f.clock,f.callbacks,{ended:true}).complete,false);
});
test('a frame stall preserves event and beat effects at each recording timestamp',()=>{
 let seconds=0,disabled=false;const beats=[],controls=[],clock={};
 const fixtureMap={meta:{duration:4},beats:[{time:1,type:'stroke'},{time:2,type:'stroke'},{time:3,type:'stroke'}],events:[{time:1,type:'disable_break'},{time:3,type:'restore_break'}]};
 rules.recordingSample(fixtureMap,4,clock,{advance:delta=>seconds+=delta,event:event=>{disabled=event.type==='disable_break';controls.push([seconds,disabled]);},beat:()=>beats.push([seconds,disabled])},{active:true});
 assert.deepEqual(controls,[[1,true],[3,false]]);assert.deepEqual(beats,[[1,true],[2,true],[3,false]]);assert.equal(seconds,4);
});
