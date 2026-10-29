import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createECDH,webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../runtime-v005/Scripts/native-controls.js',import.meta.url),'utf8');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.textContent='';this.value='';this.files=[];this.disabled=false;}
 append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
 prepend(child){child.parent=this;this.children.unshift(child);}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
 setAttribute(name,value){this[name]=value;}
 select(){this.selected=true;}
}
function descendants(element){return [element,...element.children.flatMap(descendants)];}
function profile(){return {binding:{slot:'PlayerSave',user_index:0,build_id:'v0051-hotfix-public-a8f46896'},server_origin:'http://127.0.0.1:42169',revision:7,packs:[{id:'custom:neutral',name:'Neutral'}],snapshots:{},pins:{},sync:null};}
function setup({transport=true,library=true,state=profile(),handler,confirm=true,definitions=[]}={}){
 const root=new Element('main'),calls=[],intervals=new Map(),listeners=new Map(),logs=[];let interval=0;
 const sandbox={document:{querySelector:selector=>selector==='#library'&&library?root:null,createElement:tag=>new Element(tag)},
  crypto:webcrypto,TextEncoder,Uint8Array,URL,atob,btoa,Date,
  setInterval(fn){intervals.set(++interval,fn);return interval;},clearInterval(id){intervals.delete(id);},
  addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
  confirm:question=>typeof confirm==='function'?confirm(question):confirm,console:{log:(...values)=>logs.push(values),error:(...values)=>logs.push(values)},
  FanserviceStore:{server:()=>state.server_origin},profile:{packs:definitions}};
 if(transport)sandbox.FanserviceNativeTransport={epoch:'123-1',async request(action,payload){calls.push({action,payload:JSON.parse(JSON.stringify(payload))});if(handler)return handler(action,payload,state);if(action==='companionread')return state;if(action==='musicdeliver')return {title:'Server neutral'};return {};}};
 sandbox.globalThis=sandbox;const context=vm.createContext(sandbox);vm.runInContext(source,context);
 const button=label=>{const value=descendants(root).find(element=>element.tag==='button'&&element.textContent===label);assert.ok(value,'Missing button '+label);return value;};
 const input=label=>{const row=descendants(root).find(element=>element.tag==='label'&&element.textContent===label);assert.ok(row,'Missing input '+label);return row.children[0];};
 const message=()=>root.children[0]?.children[1]?.textContent;
 return {sandbox,context,root,state,calls,logs,button,input,message,tick:()=>{for(const fn of [...intervals.values()])fn();},runAgain:()=>vm.runInContext(source,context),intervals};
}

test('controls require the native bridge and library and initialize once per epoch',()=>{
 assert.equal(setup({transport:false}).root.children.length,0);assert.equal(setup({library:false}).root.children.length,0);
 const f=setup();f.runAgain();assert.equal(f.root.children.length,1);assert.equal(f.intervals.size,1);
});
test('music delivery uses a positive ID and the current revision, then directs original Playlist',async()=>{
 const f=setup();f.input('Server soundtrack ID').value='3';await f.button('Deliver soundtrack to Playlist').onclick();
 assert.deepEqual(f.calls,[{action:'companionread',payload:{}},{action:'musicdeliver',payload:{track_id:3,expected_revision:7}},{action:'companionread',payload:{}}]);
 assert.match(f.message(),/Server neutral/);assert.match(f.message(),/Playlist → Manage/);assert.match(f.message(),/restart/);
 assert.equal(descendants(f.root).some(element=>/Pause|Seek|Play saved|Reconnect/.test(element.textContent)),false);
});
test('invalid soundtrack IDs fail before any game or worker request',async()=>{
 for(const value of ['','0','-1','1.5','1e3','NaN','9007199254740992']){
  const f=setup();f.input('Server soundtrack ID').value=value;await f.button('Deliver soundtrack to Playlist').onclick();
  assert.equal(f.calls.length,0);assert.match(f.message(),/positive soundtrack ID/);
 }
});
test('a browser connected to another Server cannot deliver an ambiguous numeric track ID',async()=>{
 const f=setup();f.sandbox.FanserviceStore.server=()=> 'https://other.example';await f.button('Deliver soundtrack to Playlist').onclick();
 assert.deepEqual(f.calls.map(call=>call.action),['companionread']);assert.match(f.message(),/configured Server/);
});
test('changed epoch revokes controls and blocks a pending delivery from continuing',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});
 const f=setup({handler:action=>action==='companionread'?pending:{title:'Wrong session'}});
 const panel=f.root.children[0],key=f.input('Sync key');key.value='private';
 const click=f.button('Deliver soundtrack to Playlist').onclick();f.sandbox.FanserviceNativeTransport={epoch:'456-2',request:async()=>{throw Error('Must not call replacement');}};
 resolve(profile());await click;assert.equal(f.root.children.length,0);assert.equal(key.value,'');assert.equal(panel.parent,null);
 assert.deepEqual(f.calls.map(call=>call.action),['companionread']);
});
test('idle epoch monitoring removes controls and clears private text fields',()=>{
 const f=setup(),key=f.input('Sync key');key.value='secret';f.sandbox.FanserviceNativeTransport.epoch='123-2';f.tick();
 assert.equal(f.root.children.length,0);assert.equal(key.value,'');assert.equal(f.intervals.size,0);
});
test('snapshot actions carry current revision and expose no unverified native playback',async()=>{
 const state=profile();state.snapshots['custom:neutral']={};state.pins['native-123-1']={};const f=setup({state});
 await f.button('Refresh saved game profile').onclick();f.input('Server soundtrack ID').value='4';await f.button('Save pack with selected soundtrack').onclick();
 assert.deepEqual(f.calls.find(call=>call.action==='snapshotdownload').payload,{pack_id:'custom:neutral',track_id:4,expected_revision:7});
 await f.button('Remove saved copy').onclick();assert.deepEqual(f.calls.find(call=>call.action==='snapshotdelete').payload,{pack_id:'custom:neutral'});
 await f.button('Release stopped session native-123-1').onclick();assert.deepEqual(f.calls.find(call=>call.action==='sessionrelease').payload,{session_id:'native-123-1'});
 assert.equal(f.calls.some(call=>['musicprepare','musicpause','musicseek','musicresume'].includes(call.action)),false);
});
test('large portable definitions use bounded ordered frames without purchase or enable calls',async()=>{
 const definitions=Array.from({length:100},(_,id)=>({id:'custom:pack'+id,name:'Neutral '+id,description:'x'.repeat(500),unlock_cost:1,library_id:'neutral',selection:{ids:[1],rules:[]}}));
 const f=setup({definitions,handler:(action,_,state)=>action==='companionread'?state:action==='definitionsbegin'?{upload_token:'upload-token'}:{}});
 await f.button('Save Server pack drafts').onclick();const begin=f.calls.find(call=>call.action==='definitionsbegin'),chunks=f.calls.filter(call=>call.action==='definitionschunk');
 const bytes=Buffer.concat(chunks.map(call=>Buffer.from(call.payload.chunk,'base64')));
 assert.equal(bytes.length,begin.payload.bytes);assert.equal(bytes.toString(),JSON.stringify(definitions));
 assert.ok(chunks.every((call,index)=>call.payload.offset===index*24576&&Buffer.from(call.payload.chunk,'base64').length<=24576));
 assert.deepEqual(f.calls.find(call=>call.action==='definitionscommit').payload,{upload_token:'upload-token'});
 assert.equal(f.calls.some(call=>['purchase','enable'].includes(call.action)),false);
});
test('downloaded definitions require review and bind apply to the preview revision',async()=>{
 for(const approve of [false,true]){
  const f=setup({confirm:approve,handler:(action,_,state)=>action==='companionread'?state:action==='syncpreview'?{preview_token:'preview-token',local_revision:7,remote_revision:9,packs:[{}]}:{}});
  await f.button('Review downloaded pack drafts').onclick();const apply=f.calls.find(call=>call.action==='syncapply');
  if(approve)assert.deepEqual(apply.payload,{preview_token:'preview-token',expected_revision:7});else assert.equal(apply,undefined);
 }
});
test('sync controls send a sealed payload and clear exported secrets on revocation',async()=>{
 const exchange=createECDH('prime256v1');exchange.generateKeys();
 const f=setup({handler:(action,_,state)=>action==='synchandshake'?{handshake_token:'a'.repeat(32),public_key:exchange.getPublicKey().toString('base64')}:action==='companionread'?state:{}});
 const secret='b'.repeat(64);f.input('Sync connection ID').value='neutral-sync';f.input('Sync key').value=secret;
 await f.button('Connect sync').onclick();assert.equal(f.input('Sync key').value,'');
 const configured=f.calls.find(call=>call.action==='syncconfigure');assert.ok(configured?.payload.ciphertext);assert.equal(configured.payload.key,undefined);assert.equal(JSON.stringify(configured.payload).includes(secret),false);assert.deepEqual(f.logs,[]);
 await f.button('Export sync connection').onclick();const area=descendants(f.root).find(element=>element.tag==='textarea');assert.equal(JSON.parse(area.value).key,secret);
 f.sandbox.FanserviceNativeTransport.epoch='next';f.tick();assert.equal(area.value,'');assert.equal(f.root.children.length,0);
});
