const test=require('node:test'),assert=require('node:assert/strict');
const {Transport}=require('../static/fanservice/profile-sync.js');
function setup(fetch,timeout){const binding={server:'https://fixture.invalid',identity:'library-one',id:'test',key:'ab'.repeat(32),revision:0,profile:'original',stored:'original'};return {binding,transport:new Transport({binding:()=>binding,fetch,timeout})};}
const reply=(revision=1)=>({ok:true,json:async()=>({revision})});
test('upload binds the expected revision, connection and original profile',async()=>{
 let sent;const {transport}=setup(async(url,options)=>{sent={url,options};return reply();});
 const result=await transport.request('PUT',{expected_revision:0,profile:{version:1,packs:[]}});
 assert.equal(result.data.revision,1);assert.equal(sent.url.href,'https://fixture.invalid/api/fanservice/v1/profiles/test');assert.equal(sent.options.headers['X-Fanservice-Profile-Key'],'ab'.repeat(32));
 assert.equal(transport.pending,false);
});
test('late replies cannot cross library, server, connection or local-edit boundaries',async()=>{
 for(const field of ['server','identity','id','key','revision','profile','stored']){
  let release;const {binding,transport}=setup(()=>new Promise(resolve=>release=resolve));const pending=transport.request('GET');binding[field]='changed';release(reply());await assert.rejects(pending,/response was discarded/);assert.equal(transport.pending,false);
 }
});
test('download binding must still match after user review',async()=>{
 const {binding,transport}=setup(async()=>reply());const {binding:captured}=await transport.request('GET');binding.stored='another-tab-edit';assert.throws(()=>transport.assertCurrent(captured),/discarded/);
});
test('concurrent synchronization is rejected and next request can retry',async()=>{
 let release;const {transport}=setup(()=>new Promise(resolve=>release=resolve));const pending=transport.request('GET');await assert.rejects(transport.request('GET'),/Wait/);release(reply());await pending;assert.equal(transport.pending,false);
});
test('timeout covers response body and retains revision after ambiguous upload',async()=>{
 const {binding,transport}=setup(async(url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),15);
 await assert.rejects(transport.request('PUT',{expected_revision:0}),/check the remote revision/);assert.equal(binding.revision,0);assert.equal(transport.pending,false);
});
test('conflicts, unauthorized replies and invalid revisions do not advance state',async()=>{
 for(const response of [{ok:false,json:async()=>({error:'revision conflict'})},{ok:false,json:async()=>({error:'unauthorized'})},reply(-1),reply(2),reply(Number.MAX_SAFE_INTEGER+1)]){
  const {binding,transport}=setup(async()=>response);await assert.rejects(transport.request('PUT',{expected_revision:0}));assert.equal(binding.revision,0);
 }
});
test('invalid identities and mismatched upload revisions never send requests',async()=>{
 let calls=0;const {binding,transport}=setup(async()=>{calls++;return reply();});await assert.rejects(transport.request('PUT',{expected_revision:3}),/revision changed/);binding.key='invalid';await assert.rejects(transport.request('GET'),/valid sync/);assert.equal(calls,0);
});
