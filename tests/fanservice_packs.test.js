const {test}=require('node:test');const assert=require('node:assert/strict');
const m=require('../static/fanservice/model.js');
const manifest={library_id:'a',media:[{id:1,tags:['slow']}]};
const pack=(id='custom:one',cost=0)=>({id,name:'My pack',description:'',library_id:'a',unlock_cost:cost,selection:{ids:[1],rules:[{source_id:2}]}});
test('immediate creation is owned; fixed IDs and live rules retained without library mutation',()=>{
 const p=m.change(m.fresh(),{action:'create',pack:pack(),manifest});assert.equal(p.packs[0].owned,true);assert.equal(p.packs[0].enabled,false);assert.deepEqual(p.packs[0].selection,pack().selection);assert.equal(p.packs[0].manifest,undefined);
});
test('UP purchase fails safely, debits once and survives serialization',()=>{
 let p=m.change({...m.fresh(),unlock_points:4},{action:'create',pack:pack('custom:paid',5),manifest});assert.throws(()=>m.change(p,{action:'purchase',id:'custom:paid',manifest}),/Not enough/);assert.equal(p.unlock_points,4);
 p.unlock_points=10;p=m.change(p,{action:'purchase',id:'custom:paid',manifest});assert.equal(p.unlock_points,5);p=JSON.parse(JSON.stringify(p));p=m.change(p,{action:'purchase',id:'custom:paid',manifest});assert.equal(p.unlock_points,5);
});
test('empty/wrong-library packs cannot be bought and profile operations are isolated',()=>{
 const p=m.change({...m.fresh(),unlock_points:20},{action:'create',pack:pack('custom:paid',5),manifest});assert.throws(()=>m.change(p,{action:'purchase',id:'custom:paid',manifest:{...manifest,media:[]}}),/available/);assert.throws(()=>m.change(p,{action:'purchase',id:'custom:paid',manifest:{...manifest,library_id:'b'}}),/available/);assert.equal(m.fresh().packs.length,0);assert.equal(p.unlock_points,20);
});
test('rename/rule edits preserve ownership and enabled session membership is frozen',()=>{
 let p=m.change(m.fresh(),{action:'create',pack:pack(),manifest});p=m.change(p,{action:'enable',id:'custom:one',enabled:true,manifest});const session=m.freezeSession(p,{'custom:one':manifest});
 p=m.change(p,{action:'edit',id:'custom:one',pack:{...pack(),name:'Renamed',selection:{ids:[],rules:[{tag:'new'}]}}});assert.equal(p.packs[0].owned,true);assert.equal(p.packs[0].enabled,true);assert.equal(p.packs[0].id,'custom:one');manifest.media.push({id:2});assert.equal(session.media.length,1);manifest.media.pop();
});
test('union deduplicates and deletion never mutates the resolved library',()=>{
 let p=m.change(m.fresh(),{action:'create',pack:pack(),manifest});p=m.change(p,{action:'enable',id:'custom:one',enabled:true,manifest});p=m.change(p,{action:'create',pack:pack('custom:two'),manifest});p=m.change(p,{action:'enable',id:'custom:two',enabled:true,manifest});assert.equal(m.freezeSession(p,{'custom:one':manifest,'custom:two':manifest}).media.length,1);p=m.change(p,{action:'delete',id:'custom:one'});assert.equal(p.packs.length,1);assert.equal(manifest.media.length,1);
});
test('reject invalid names, identities and fractional prices',()=>{for(const change of [{name:''},{unlock_cost:1.1},{id:'../../bad'}])assert.throws(()=>m.change(m.fresh(),{action:'create',pack:{...pack(),...change},manifest}));});
