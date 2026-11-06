const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/fanservice/vibration.js');

test('the default warns once when active gameplay crosses three seconds before an eligible event',()=>{
 const calls=[],vibration=create(duration=>{calls.push(duration);return true;});
 vibration.advance(1,1.99,[5]);
 assert.deepEqual(calls,[]);
 vibration.advance(1.99,2,[5]);
 vibration.advance(2,2.1,[5]);
 vibration.advance(2.1,6,[6]);
 vibration.beat();
 assert.deepEqual(calls,[100]);
});

test('beat mode pulses only delivered beats and Off cancels the active cue',()=>{
 const calls=[],vibration=create(duration=>{calls.push(duration);return true;},'beat');
 vibration.advance(1,2,[5]);
 vibration.beat();
 vibration.beat();
 vibration.mode('off');
 vibration.beat();
 vibration.advance(1,2,[5]);
 assert.deepEqual(calls,[25,25,0]);
});

test('interruption cancels a pulse and resuming after the warning point does not replay it',()=>{
 const calls=[],vibration=create(duration=>{calls.push(duration);return true;});
 vibration.advance(1,2,[5]);
 vibration.cancel();
 vibration.advance(2.2,2.3,[5]);
 vibration.advance(1.8,2,[4]);
 vibration.advance(2,3,[6]);
 assert.deepEqual(calls,[100,0,100]);
});
