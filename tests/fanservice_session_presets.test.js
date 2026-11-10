'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Presets=require('../static/fanservice/session_presets');
const specs=[{min:1,max:1},{min:300,max:10800},{min:50,max:20000},{min:1,max:100},{min:30,max:600},{min:1,max:20},{min:5,max:100}];
const settings={mode:1,difficulty:2,objective:3,target:12,rounds:4,loot:true,holding:'left',vibration:'beat',wake:false};

test('normalizes versioned preset records and drops untrusted fields',()=>{
 const stored={version:1,presets:[{name:'  Evening run ',settings:{...settings,mediaUrl:'https://bad.test',profileToken:'secret'},url:'https://bad.test'}],token:'secret'};
 const normalized=Presets.normalize(stored,specs);
 assert.deepEqual(normalized,{version:1,presets:[{name:'Evening run',settings}]});
});

test('rejects invalid selector and target outside selected objective spec',()=>{
 for(const candidate of [{...settings,objective:7},{...settings,target:101},{...settings,objective:0,target:2}]){
  assert.deepEqual(Presets.normalize([{name:'Bad',settings:candidate}],specs),{version:1,presets:[]});
 }
});

test('save replaces names case insensitively and refuses a ninth new preset',()=>{
 let rows=Presets.save([],'Practice',settings,specs);
 rows=Presets.save(rows,' practice ',{...settings,target:15},specs);
 assert.equal(rows.length,1);assert.equal(rows[0].name,'practice');assert.equal(rows[0].settings.target,15);
 for(let i=1;i<8;i++)rows=Presets.save(rows,`Preset ${i}`,settings,specs);
 assert.equal(rows.length,8);assert.throws(()=>Presets.save(rows,'Ninth',settings,specs),RangeError);
});

test('rejects invalid names and settings when saving',()=>{
 assert.throws(()=>Presets.save([],'   ',settings,specs),TypeError);
 assert.throws(()=>Presets.save([],'Valid',{...settings,wake:1},specs),TypeError);
});
