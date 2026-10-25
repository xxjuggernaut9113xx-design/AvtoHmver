import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NativeCompanionHost} from './host.mjs';
import {sealConnection} from './sealed-test.mjs';
const pack={id:'custom:test',name:'Synthetic',description:'Neutral fixture',library_id:'library-one',unlock_cost:1,selection:{ids:[1],rules:[]}};
const music={protocol:1,library_id:'library-one',track_id:1,recording_id:'sha1:'+'a'.repeat(40),duration:12,native_stream_url:'/api/music/tracks/1/stream?native=true',beatmap:{meta:{duration:12,bpm:120},beats:[{time:0,type:'stroke'},{time:1,type:'rest'}],events:[]}};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function fixture(t,fetch=async()=>json({})){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'native-host-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const runtimeDir=path.join(base,'runtime'),gameRoot=path.join(base,'game'),packs=path.join(gameRoot,'CockHero/Binaries/Win64/packs');await fs.mkdir(runtimeDir);await fs.mkdir(packs,{recursive:true});
 await fs.writeFile(path.join(runtimeDir,'server-origin.txt'),'http://127.0.0.1:42169\n');
 const state={protocol:1,build_id:'v004-exclusive-c645757d',slot:'PlayerSave',user_index:0,save_address:'101',store_address:'202',generation:1,epoch:'123-1',updated_at:1000,native_catalog:{unlock_points:4,packs:[{id:'fanservice-test-123',owned:true,enabled:true}]}};
 const pulse=()=>fs.writeFile(path.join(runtimeDir,'.fanservice-companion.state'),JSON.stringify(state));await pulse();
 await fs.writeFile(path.join(packs,'.fanservice-receipts.json'),JSON.stringify({version:1,packs:{[pack.id]:{custom_id:pack.id,build_id:state.build_id,filename:'fanservice-test-123.chpack',sha256:'b'.repeat(64)}}}));
 const host=await new NativeCompanionHost({verifyBuild:false,runtimeDir,gameRoot,storeRoot:path.join(base,'data'),fetch:(url,options)=>String(url).endsWith('/capabilities')?json({library_id:'library-one'}):fetch(url,options),now:()=>1000,timeoutMs:50}).initialize();let sequence=0;
 const request=(action,payload={})=>({action,payload,nonce:'123-1-'+(++sequence),generation:state.generation,epoch:state.epoch});
 const call=async(action,payload)=>{if(action==='syncconfigure'&&payload?.key){const exchange=await host.handle(request('synchandshake'));payload=await sealConnection(exchange,payload);}return host.handle(request(action,payload));};
 return {base,runtimeDir,gameRoot,state,pulse,host,request,call};
}
test('native file IPC binds profile and nonce and retains its request for the native sender',async t=>{
 const f=await fixture(t),request=f.request('companionread');const packet=`FANSERVICE_COMPANION_1\n${request.nonce}\n1\n123-1\ncompanionread\n{}`;
 await fs.writeFile(path.join(f.runtimeDir,'.fanservice-companion.request'),packet);assert.equal(await f.host.pollOnce(),true);
 const response=await fs.readFile(path.join(f.runtimeDir,'.fanservice-companion.response.'+request.nonce),'utf8');assert.ok(response.startsWith(`FANSERVICE_COMPANION_1\n${request.nonce}\n1\n`));assert.equal(JSON.parse(response.split('\n').slice(3).join('\n')).data.binding.slot,'PlayerSave');assert.equal(await f.host.pollOnce(),false);assert.equal(await fs.readFile(path.join(f.runtimeDir,'.fanservice-companion.request'),'utf8'),packet);
});
test('definition writes strip all native authority and reject stale native generations',async t=>{
 const f=await fixture(t);await f.call('definitions',{expected_revision:0,packs:[{...pack,owned:true,enabled:true,unlock_points:999,progression:{level:30}}]});const result=await f.call('companionread');assert.deepEqual(result.packs,[pack]);assert.equal(result.unlock_points,undefined);
 const old=f.request('definitions',{expected_revision:1,packs:[]});f.state.generation++;await f.pulse();await assert.rejects(f.host.handle(old),/stale generation/);assert.equal((await f.call('companionread')).revision,1);
 f.state.updated_at=900;await f.pulse();await assert.rejects(f.call('companionread'),/stale or invalid/);
});
test('sync upload has neutral wire wallet and never exports native ownership',async t=>{
 let body;const f=await fixture(t,async(url,options)=>{body=JSON.parse(options.body);return json({revision:1});});await f.call('definitions',{expected_revision:0,packs:[pack]});await f.call('syncconfigure',{id:'native-fixture',key:'a'.repeat(64),revision:0});await f.call('syncupload',{expected_revision:1});assert.deepEqual(body.profile,{version:1,kind:'fanservice-native-companion',unlock_points:0,packs:[pack]});assert.equal((await f.call('companionread')).sync.revision,1);
});
test('remote sync requires preview and optimistic apply, ignores remote wallet and preserves conflicts',async t=>{
 const f=await fixture(t,async()=>json({revision:7,profile:{version:1,unlock_points:999,progression:{level:999},packs:[{...pack,owned:true,enabled:true}]}}));await f.call('syncconfigure',{id:'fixture',key:'a'.repeat(64),revision:0});const preview=await f.call('syncpreview');assert.equal((await f.call('companionread')).packs.length,0);assert.deepEqual(preview.packs,[pack]);
 await f.call('definitions',{expected_revision:0,packs:[]});await assert.rejects(f.call('syncapply',{preview_token:preview.preview_token,expected_revision:0}),/stale/);assert.equal((await f.call('companionread')).packs.length,0);
 const latest=await f.call('syncpreview');await f.call('syncapply',{preview_token:latest.preview_token,expected_revision:1});const saved=await f.call('companionread');assert.deepEqual(saved.packs,[pack]);assert.equal(saved.progression,undefined);assert.equal(saved.sync.revision,7);
});
test('profile changes while HTTP is pending discard remote sync data',async t=>{
 let release;const f=await fixture(t,()=>new Promise(resolve=>release=resolve));await f.call('syncconfigure',{id:'fixture',key:'a'.repeat(64),revision:0});const pending=f.call('syncpreview');while(!release)await new Promise(resolve=>setTimeout(resolve,1));f.state.slot='AnotherSave';await f.pulse();release(json({revision:1,profile:{version:1,packs:[pack]}}));await assert.rejects(pending,/stale work/);assert.deepEqual((await f.call('companionread')).packs,[]);
});
test('music command accepts only fixed Server manifests and authoritative owned enabled packs',async t=>{
 const f=await fixture(t,async()=>json(music));f.state.native_catalog.packs[0].enabled=false;await f.pulse();await assert.rejects(f.call('musicprepare',{track_id:1}),/Enable an owned/);
 f.state.native_catalog.packs[0].enabled=true;await f.pulse();const result=await f.call('musicprepare',{track_id:1});const command=await fs.readFile(path.join(f.runtimeDir,'.fanservice-music-command.'+result.command_nonce),'utf8');assert.equal(decodeURIComponent(command.split('\n')[4]),'http://127.0.0.1:42169/api/music/tracks/1/stream?native=true');assert.equal(JSON.parse(command.split('\n').slice(5).join('\n')).meta.bpm,120);
 await assert.rejects(f.call('musicprepare',{url:'https://foreign.invalid/track'}),/positive soundtrack/);
});
test('native snapshot authorization requires the exact bridge receipt and retains snapshots on failure',async t=>{
 let fail=false;const f=await fixture(t,async url=>{if(String(url).includes('/resolve'))return json({library_id:'library-one',media:[{id:1,type:'image',file:'neutral.png',tags:['slow'],url:'/api/media/1'}]});return fail?new Response('failed',{status:503}):new Response('synthetic',{headers:{'content-length':'9'}});});await f.call('definitions',{expected_revision:0,packs:[pack]});await f.call('snapshotdownload',{pack_id:pack.id,expected_revision:1});const first=await f.call('companionread');fail=true;await assert.rejects(f.call('snapshotdownload',{pack_id:pack.id,expected_revision:first.revision}),/HTTP 503/);assert.deepEqual((await f.call('companionread')).snapshots,first.snapshots);
 f.state.native_catalog.packs[0].owned=false;await f.pulse();await assert.rejects(f.call('snapshotdelete',{pack_id:pack.id}),/Purchase/);
});
test('worker refuses unknown operations and linked roots',async t=>{
 const f=await fixture(t);await assert.rejects(f.call('purchase',{unlock_points:999}),/Unsupported/);const linked=path.join(f.base,'linked');await fs.symlink(f.runtimeDir,linked,process.platform==='win32'?'junction':'dir');await assert.rejects(new NativeCompanionHost({verifyBuild:false,runtimeDir:linked,gameRoot:f.gameRoot,storeRoot:path.join(f.base,'another')}).initialize(),/links/);
});


test('sync secrets are sealed, authenticated, bound to context and one-use',async t=>{
 const f=await fixture(t);const connection={id:'fixture',key:'a'.repeat(64),revision:0};
 await assert.rejects(f.host.handle(f.request('syncconfigure',connection)),/sealed transport/);
 const exchange=await f.call('synchandshake'),sealed=await sealConnection(exchange,connection);assert.equal(JSON.stringify(sealed).includes(connection.key),false);assert.equal(sealed.key,undefined);
 await f.host.handle(f.request('syncconfigure',sealed));await assert.rejects(f.host.handle(f.request('syncconfigure',sealed)),/stale/);
 const another=await f.call('synchandshake'),tampered=await sealConnection(another,connection);tampered.ciphertext=Buffer.alloc(Buffer.from(tampered.ciphertext,'base64').length).toString('base64');await assert.rejects(f.host.handle(f.request('syncconfigure',tampered)),/authentication/);
 const old=await f.call('synchandshake'),pending=await sealConnection(old,connection);f.state.slot='NewSlot';f.state.generation++;await f.pulse();await assert.rejects(f.host.handle(f.request('syncconfigure',pending)),/stale/);assert.equal((await f.call('companionread')).sync,null);
});


test('native stop acknowledgements release only matching pins after worker restart and profile change',async t=>{
 const f=await fixture(t,async url=>String(url).includes('/resolve')?json({library_id:'library-one',media:[{id:1,type:'image',file:'sample.png',tags:['slow'],url:'/api/media/1'}]}):String(url).includes('/manifest')?json(music):new Response('neutral',{headers:{'content-length':'7'}}));
 await f.call('definitions',{expected_revision:0,packs:[pack]});await f.call('snapshotdownload',{pack_id:pack.id,track_id:1,expected_revision:1});const prepared=await f.call('musicprepare',{pack_id:pack.id});
 const packet=await fs.readFile(path.join(f.runtimeDir,'.fanservice-music-command.'+prepared.command_nonce),'utf8'),file=new URL(decodeURIComponent(packet.split('\n')[4]));await f.call('snapshotdelete',{pack_id:pack.id});assert.ok((await fs.stat(file)).size>0);
 const restarted=await new NativeCompanionHost({verifyBuild:false,runtimeDir:f.runtimeDir,gameRoot:f.gameRoot,storeRoot:path.join(f.base,'data'),now:()=>1000}).initialize();assert.equal(restarted.sessions.size,1);
 f.state.slot='OtherProfile';f.state.generation++;f.state.stopped_music=['999-99'];await f.pulse();await restarted.reapStopped();assert.ok((await fs.stat(file)).size>0);
 f.state.stopped_music=[prepared.command_nonce];await f.pulse();await restarted.reapStopped();assert.equal(restarted.sessions.size,0);await assert.rejects(fs.stat(file),{code:'ENOENT'});assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.runtimeDir,'.fanservice-music-sessions.json'),'utf8')),{});
});


test('helper shutdown is scoped to its own lock token and cleans its readiness files',async t=>{
 const f=await fixture(t),controller=new AbortController(),running=f.host.run({signal:controller.signal});
 try{
  const lock=path.join(f.runtimeDir,'.fanservice-companion.host.lock'),ready=path.join(f.runtimeDir,'.fanservice-companion.ready');let owner;
  for(let attempt=0;attempt<100;attempt++){try{owner=await fs.readFile(ready,'utf8');break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  assert.match(owner,/^[a-f0-9]{32}$/);const stop=path.join(f.runtimeDir,'.fanservice-companion.shutdown');await fs.writeFile(stop,'FANSERVICE_COMPANION_STOP_1\n'+'0'.repeat(32));await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await fs.readFile(lock,'utf8'),owner);assert.ok(await fs.stat(stop));
  await fs.writeFile(stop,'FANSERVICE_COMPANION_STOP_1\n'+owner);await running;await assert.rejects(fs.stat(lock),{code:'ENOENT'});await assert.rejects(fs.stat(ready),{code:'ENOENT'});await assert.rejects(fs.stat(stop),{code:'ENOENT'});
 }finally{controller.abort();await running;}
});


test('large definitions use bounded ordered frames and preserve data on incomplete transfer',async t=>{
 const f=await fixture(t),packs=Array.from({length:40},(_,index)=>({...pack,id:'custom:large-'+index,description:'x'.repeat(2000)})),bytes=Buffer.from(JSON.stringify(packs));assert.ok(bytes.length>65536);
 const upload=await f.call('definitionsbegin',{expected_revision:0,bytes:bytes.length});await assert.rejects(f.call('definitionschunk',{upload_token:upload.upload_token,offset:10,chunk:bytes.subarray(0,100).toString('base64')}),/out of order/);
 for(let offset=0;offset<bytes.length;offset+=24576)await f.call('definitionschunk',{upload_token:upload.upload_token,offset,chunk:bytes.subarray(offset,offset+24576).toString('base64')});await f.call('definitionscommit',{upload_token:upload.upload_token});assert.equal((await f.call('companionread')).packs.length,40);
 const incomplete=await f.call('definitionsbegin',{expected_revision:1,bytes:2});await assert.rejects(f.call('definitionscommit',{upload_token:incomplete.upload_token}),/incomplete/);assert.equal((await f.call('companionread')).revision,1);
});
