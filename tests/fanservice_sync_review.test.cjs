const test=require('node:test'),assert=require('node:assert/strict');
const sync=require('../static/fanservice/profile-sync.js');
const pack=(id,name,extra={})=>({id:`custom:${id}`,name,description:'',library_id:'lib',device_id:'device',unlock_cost:5,selection:{ids:[1],rules:[],local_ids:[]},owned:true,enabled:true,...extra});
test('portable upload excludes game authority and saved bytes',()=>{
 const portable=sync.portableProfile({version:1,profile_id:'native-profile',unlock_points:91,progression:{level:9},packs:[pack('a','A',{device_id:'device',cover_id:'local:cover',preview_local_id:'cover',selection:{ids:[1],rules:[],local_ids:['private-file']},snapshot:{media:['bytes']},manifest:{media:['bytes']},use_offline:true})]});
 assert.equal(portable.unlock_points,0);assert.equal(portable.profile_id,undefined);assert.equal(portable.progression,undefined);
 assert.equal(portable.packs[0].owned,undefined);assert.equal(portable.packs[0].enabled,undefined);assert.equal(portable.packs[0].snapshot,undefined);assert.equal(portable.packs[0].manifest,undefined);assert.equal(portable.packs[0].use_offline,undefined);
 assert.deepEqual(portable.packs[0].selection,{ids:[1],rules:[]});assert.equal(portable.packs[0].device_id,undefined);assert.equal(portable.packs[0].preview_local_id,undefined);assert.equal(portable.packs[0].cover_id,undefined);
});
test('per-pack review detects only definition changes and additions/removals',()=>{
 const local={version:1,packs:[pack('same','Same',{owned:true,enabled:true}),pack('changed','Old'),pack('local','Local')]};
 const remote={version:1,packs:[pack('same','Same',{owned:false,enabled:false,snapshot:{id:'ignored'}}),pack('changed','New'),pack('remote','Remote')]};
 const differences=sync.diff(local,remote);
 assert.deepEqual(differences.map(item=>[item.id,item.kind]),[['custom:changed','changed'],['custom:local','local-only'],['custom:remote','remote-only']]);
});
test('apply requires a choice for each difference and preserves local authority',()=>{
 const local={version:1,unlock_points:73,profile_id:'local-id',packs:[pack('changed','Local changed'),pack('owned','Owned',{owned:true,enabled:true}),pack('remove','Remove')]};
 const remote={version:1,unlock_points:0,packs:[pack('changed','Remote changed',{owned:true,enabled:true}),pack('owned','Owned',{owned:false,enabled:false}),pack('new','New',{owned:true,enabled:true})]};
 const differences=sync.diff(local,remote);
 assert.throws(()=>sync.applyChoices(local,remote,differences,{}),/Choose a version/);
 const result=sync.applyChoices(local,remote,differences,{'custom:changed':'remote','custom:remove':'remove','custom:new':'remote'});
 assert.equal(result.unlock_points,73);assert.equal(result.profile_id,'local-id');
 const byId=new Map(result.packs.map(item=>[item.id,item]));
 assert.equal(byId.get('custom:changed').name,'Remote changed');assert.equal(byId.get('custom:changed').owned,true);assert.equal(byId.get('custom:changed').enabled,true);
 assert.equal(byId.get('custom:owned').name,'Owned');assert.equal(byId.get('custom:owned').owned,true);assert.equal(byId.get('custom:owned').enabled,true);
 assert.equal(byId.get('custom:new').owned,false);assert.equal(byId.get('custom:new').enabled,false);assert.equal(byId.has('custom:remove'),false);
});
