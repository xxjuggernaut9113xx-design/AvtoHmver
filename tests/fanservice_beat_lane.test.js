'use strict';
const assert=require('node:assert/strict');
const BeatLane=require('../static/fanservice/beat_lane.js');

{
 const projected=BeatLane.project([9.2,9.8,10.6],10);
 assert.deepEqual(projected.map(({time})=>time),[9.8,10.6]);
 assert.ok(Math.abs(projected[0].x-(50-(-.2/3)*50))<1e-10);
 assert.ok(Math.abs(projected[1].x-(50-(.6/3)*50))<1e-10);
}
{
 const projected=BeatLane.project([10,10.2,10.8,11.6],10.8);
 assert.deepEqual(projected.map(({time})=>time),[10.8,11.6]);
 assert.equal(projected[0].x,50);
 assert.ok(projected[1].x<50);
 assert.deepEqual(BeatLane.project([10],10.25).map(({x})=>x),[50+(.25/3)*50]);
}
{
 const flow={started:4,queue:[
  {TargetHitTime:1,CustomMultiplier:1},
  {TargetHitTime:.2,CustomMultiplier:-1},
  {TargetHitTime:.5,CustomMultiplier:0},
  {TargetHitTime:Infinity,CustomMultiplier:2},
  {TargetHitTime:2,CustomMultiplier:NaN}
 ]};
 assert.deepEqual(BeatLane.cardTimes(flow),[5,4.5]);
 const held=BeatLane.project(BeatLane.cardTimes(flow),4);
 assert.deepEqual(BeatLane.project(BeatLane.cardTimes(flow),4),held);
}
{
 assert.deepEqual(BeatLane.project([NaN,Infinity,0,0,1],0,{lead:1,trail:0,limit:1}),[{time:0,x:50}]);
 assert.deepEqual(BeatLane.project([0],0,{trail:0}),[{time:0,x:50}]);
 assert.deepEqual(BeatLane.project([0],0,{lead:0}),[{time:0,x:50}]);
}
console.log('Fanservice beat lane tests passed');
