import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CompanionStore,sanitizeDefinitions,RevisionConflict,StoreBusy,NATIVE_BUILD} from './companion-store.mjs';

const pack=(id='custom:first')=>({id,name:'Test pack',description:'Synthetic fixture',library_id:'library-one',unlock_cost:2,selection:{ids:[1],rules:[]}});
const manifest=(id=1)=>({library_id:'library-one',media:[{id,type:'image',file:'sample.png',tags:['slow'],url:'/api/media/'+id}]});
const response=(value='synthetic')=>new Response(value,{headers:{'content-length':String(Buffer.byteLength(value))}});
async function fixture(t,limits={}){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'fanservice-companion-'));await fs.mkdir(path.join(base,'game'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const options={root:path.join(base,'data'),gameRoot:path.join(base,'game'),slot:'PlayerSave',userIndex:0,limits},store=await CompanionStore.open(options);return {base,options,store};
}
async function prepared(t,limits){const result=await fixture(t,limits);await result.store.saveDefinitions([pack()],{expectedRevision:0});return result;}
async function download(store,extra={}){return store.downloadSnapshot('custom:first',{manifest:manifest(),origin:'http://127.0.0.1:1234',fetch:async()=>response(),...extra});}

test('durable identity separates install, slot and user and refuses unsupported builds',async t=>{
 const {base,options,store}=await fixture(t);const reopened=await CompanionStore.open(options);assert.deepEqual(reopened.binding,store.binding);
 const slot=await CompanionStore.open({...options,slot:'OtherSave'}),user=await CompanionStore.open({...options,userIndex:1});assert.notEqual(slot.binding.profile_id,store.binding.profile_id);assert.notEqual(user.binding.profile_id,store.binding.profile_id);
 await fs.mkdir(path.join(base,'other-game'));const install=await CompanionStore.open({...options,gameRoot:path.join(base,'other-game')});assert.notEqual(install.binding.install_id,store.binding.install_id);
 await assert.rejects(CompanionStore.open({...options,buildId:'unverified'}),/exact native build/);assert.equal(store.binding.build_id,NATIVE_BUILD);
});
test('portable sanitation cannot apply wallet, ownership, progression, local files or paths',()=>{
 const input={...pack(),owned:true,enabled:true,unlock_points:999,progression:{level:20},snapshot:{path:'C:/secret'},path:'C:/secret',server_url:'https://secret',selection:{ids:[1,1],rules:[{source_id:1,path:'C:/secret',enabled:true}],local_ids:['device-file']}};
 assert.deepEqual(sanitizeDefinitions([input]),[{...pack(),selection:{ids:[1],rules:[{source_id:1}]}}]);
 for(const bad of [[pack(),pack()], [{...pack(),selection:{ids:[],rules:[],local_ids:['only-local']}}], [{...pack(),id:'../../escape'}]])assert.throws(()=>sanitizeDefinitions(bad));
});
test('optimistic saves persist through reopen and never overwrite a conflicting revision',async t=>{
 const {store,options}=await fixture(t);const saved=await store.saveDefinitions([pack()],{expectedRevision:0});assert.equal(saved.revision,1);
 await assert.rejects(store.saveDefinitions([],{expectedRevision:0}),RevisionConflict);const reopened=await CompanionStore.open(options);assert.deepEqual((await reopened.read()).packs,[pack()]);
 await assert.rejects(store.saveDefinitions([],{expectedRevision:1,assertCurrent:()=>{throw Error('Profile switched');}}),/switched/);assert.equal((await store.read()).revision,1);
});
test('atomic metadata retains invalid or linked files without replacing them',async t=>{
 const {store}=await prepared(t);const profile=path.join(store.directory,'profile.json'),bytes=await fs.readFile(profile);await fs.writeFile(profile,'invalid-json');await assert.rejects(store.read());assert.equal(await fs.readFile(profile,'utf8'),'invalid-json');await fs.writeFile(profile,bytes);
 const foreign=path.join(store.directory,'foreign.json');await fs.writeFile(foreign,'preserve');await fs.unlink(profile);await fs.link(foreign,profile);await assert.rejects(store.read(),/linked/);assert.equal(await fs.readFile(foreign,'utf8'),'preserve');
});
test('links in the root or installation chain are refused',async t=>{
 const {base,options}=await fixture(t),link=path.join(base,'linked-game');await fs.symlink(options.gameRoot,link,process.platform==='win32'?'junction':'dir');await assert.rejects(CompanionStore.open({...options,gameRoot:link}),/links/);
 const dataLink=path.join(base,'linked-data');await fs.symlink(options.root,dataLink,process.platform==='win32'?'junction':'dir');await assert.rejects(CompanionStore.open({...options,root:dataLink}),/links/);
});
test('immutable generations survive restart and active pins retain exact old bytes',async t=>{
 const {store,options}=await prepared(t);const first=await download(store),pinned=await store.pinSnapshot('custom:first','session-one');assert.equal(pinned.generation,first.generation);
 const second=await download(store,{manifest:manifest(2),fetch:async()=>response('updated')});assert.notEqual(second.generation,first.generation);assert.equal(await fs.readFile(first.media[0].path,'utf8'),'synthetic');
 const reopened=await CompanionStore.open(options);assert.equal((await reopened.pinSnapshot('custom:first','session-one')).generation,first.generation);assert.equal((await reopened.currentSnapshot('custom:first')).generation,second.generation);
 await reopened.releaseSession('session-one');await assert.rejects(fs.stat(first.media[0].path),{code:'ENOENT'});assert.equal(await fs.readFile(second.media[0].path,'utf8'),'updated');
});
test('failed, interrupted, empty, oversized and cross-library replacements retain the old snapshot',async t=>{
 const {store}=await prepared(t,{itemBytes:32,totalBytes:48});const original=await download(store);
 const cases=[{fetch:async()=>new Response('',{status:503})},{fetch:async()=>response('')},{fetch:async()=>response('x'.repeat(33))},{fetch:async()=>new Response('short',{headers:{'content-length':'20'}})},{fetch:async()=>{throw Error('network interruption');}},{manifest:{...manifest(),library_id:'foreign'}}];
 for(const config of cases){await assert.rejects(download(store,config));assert.equal((await store.currentSnapshot('custom:first')).generation,original.generation);}
 assert.deepEqual((await fs.readdir(path.join(store.directory,'snapshots'))),[original.generation]);
});
test('streamed body total limits and cancellation remove only the owned staging files',async t=>{
 const {store}=await prepared(t,{itemBytes:32,totalBytes:12});const original=await download(store);const two={...manifest(),media:[...manifest().media,...manifest(2).media]};await assert.rejects(download(store,{manifest:two}),/total size/);
 const controller=new AbortController();await assert.rejects(download(store,{signal:controller.signal,fetch:async()=>{controller.abort();return response();}}),/abort/i);assert.equal((await store.currentSnapshot('custom:first')).generation,original.generation);
 const names=await fs.readdir(path.join(store.directory,'snapshots'));assert.deepEqual(names,[original.generation]);
});
test('a stale profile guard cancels before snapshot publication',async t=>{
 const {store}=await prepared(t);const first=await download(store);let current=true;
 await assert.rejects(download(store,{fetch:async()=>{current=false;return response();},assertCurrent:()=>{if(!current)throw Error('Profile changed');}}),/Profile changed/);assert.equal((await store.currentSnapshot('custom:first')).generation,first.generation);
});
test('deletion retains pinned generations and unrelated files block cleanup safely',async t=>{
 const {store}=await prepared(t),first=await download(store);await store.pinSnapshot('custom:first','pin');await store.deleteSnapshot('custom:first');await assert.rejects(store.currentSnapshot('custom:first'),/No downloaded/);assert.equal((await store.pinSnapshot('custom:first','pin')).generation,first.generation);
 const unrelated=path.join(path.dirname(first.media[0].path),'user-notes.txt');await fs.writeFile(unrelated,'preserve');const result=await store.releaseSession('pin');assert.equal(result.cleanup_issues.length,1);assert.equal(await fs.readFile(unrelated,'utf8'),'preserve');assert.equal(await fs.readFile(first.media[0].path,'utf8'),'synthetic');
});
test('tampered and evicted media is unavailable rather than silently replaced',async t=>{
 const {store}=await prepared(t),first=await download(store);await fs.writeFile(first.media[0].path,'changed');await assert.rejects(store.currentSnapshot('custom:first'),/changed/);await fs.unlink(first.media[0].path);await assert.rejects(store.currentSnapshot('custom:first'),{code:'ENOENT'});
});
test('another process lock is retained and cannot be stolen',async t=>{
 const {store}=await prepared(t),lock=path.join(store.directory,'.lock');await fs.writeFile(lock,'foreign-owner');await assert.rejects(store.read(),StoreBusy);assert.equal(await fs.readFile(lock,'utf8'),'foreign-owner');await fs.unlink(lock);
});
test('matching native music is stored with its beatmap and media without remote URLs',async t=>{
 const {store}=await prepared(t),music={protocol:1,library_id:'library-one',track_id:1,recording_id:'sha1:synthetic',duration:2,native_stream_url:'/api/music/tracks/1/stream?native=true',beatmap:{meta:{bpm:120},beats:[{time:0,type:'stroke'}],events:[]}};
 const snapshot=await download(store,{music});assert.equal(snapshot.music.recording_id,music.recording_id);assert.deepEqual(snapshot.music.beatmap,music.beatmap);assert.equal(snapshot.music.native_stream_url,undefined);assert.equal(await fs.readFile(snapshot.music.path,'utf8'),'synthetic');
 await assert.rejects(download(store,{music:{...music,library_id:'foreign'}}),/different/);assert.equal((await store.currentSnapshot('custom:first')).generation,snapshot.generation);
});
test('failed staging never removes an unrelated colliding file',async t=>{
 const {store}=await prepared(t),first=await download(store);let foreign;
 await assert.rejects(download(store,{fetch:async()=>{const base=path.join(store.directory,'snapshots'),stage=(await fs.readdir(base)).find(name=>name.startsWith('.stage-'));foreign=path.join(base,stage,'000000.png');await fs.writeFile(foreign,'unrelated');return response();}}),{code:'EEXIST'});
 assert.equal(await fs.readFile(foreign,'utf8'),'unrelated');assert.equal((await store.currentSnapshot('custom:first')).generation,first.generation);
});
test('snapshot body deadlines abort the transfer and retain the old generation',async t=>{
 const {store}=await prepared(t,{timeoutMs:25}),first=await download(store);
 await assert.rejects(download(store,{fetch:async(url,{signal})=>({status:200,url:url.href,headers:new Headers(),body:new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('body timeout')),{once:true});}})})}),/timeout/);
 assert.equal((await store.currentSnapshot('custom:first')).generation,first.generation);
});
test('normalized URL traversal cannot escape the Server API namespace',async t=>{
 const {store}=await prepared(t);let called=false;const source=manifest();source.media[0].url='/api/%2e%2e/private';await assert.rejects(download(store,{manifest:source,fetch:async()=>{called=true;return response();}}),/Server API/);assert.equal(called,false);
});
