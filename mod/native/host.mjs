import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash,createECDH,createDecipheriv} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyGameIdentity} from './game-identity.mjs';
import {CompanionStore,sanitizeDefinitions,NATIVE_BUILD} from './companion-store.mjs';

const MARKER='FANSERVICE_COMPANION_1',LIMIT=65536,REPLY_LIMIT=4*1024*1024;
const actions=new Set(['companionread','definitions','definitionsbegin','definitionschunk','definitionscommit','snapshotdownload','snapshotdelete','synchandshake','syncconfigure','syncupload','syncpreview','syncapply','musicprepare','sessionrelease']);
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const token=value=>typeof value==='string'&&/^[0-9-]{1,160}$/.test(value)&&/[0-9]/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));

async function directory(value){
 if(typeof value!=='string'||!path.isAbsolute(value))throw Error('An absolute native companion directory is required.');
 let cursor=path.resolve(value);for(;;){const stat=await fs.lstat(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Native companion directories cannot contain links.');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}return path.resolve(value);
}
async function readRegular(file,maximum){
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw Error('IPC file is linked, non-regular or oversized.');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||opened.nlink!==1||!opened.isFile())throw Error('IPC file changed while opening.');const bytes=Buffer.alloc(maximum+1);let size=0;while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}if(size>maximum)throw Error('IPC file exceeds its limit.');return bytes.subarray(0,size).toString('utf8');}finally{await handle.close();}
}
async function atomicFile(directoryPath,name,contents,{replace=false}={}){
 await directory(directoryPath);const target=path.join(directoryPath,name),temporary=path.join(directoryPath,'.native-write-'+randomBytes(16).toString('hex'));let published=false;
 try{
  if(replace){try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Refusing a linked or non-regular destination.');}catch(error){if(error.code!=='ENOENT')throw error;}}
  else{try{await fs.lstat(target);throw Error('Existing companion output was retained.');}catch(error){if(error.code!=='ENOENT')throw error;}}
  const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(contents);await handle.sync();}finally{await handle.close();}
  if(replace)await fs.rename(temporary,target);else{await fs.link(temporary,target);await fs.unlink(temporary);}published=true;
 }finally{if(!published)await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function origin(value){const url=new URL(value);if(url.origin!==value||url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Configure an HTTPS Server origin or local HTTP origin.');return url.origin;}
function heartbeat(value,now){
 if(!object(value)||value.protocol!==1||value.build_id!==NATIVE_BUILD||typeof value.slot!=='string'||!value.slot.length||value.slot.length>512||/[\x00-\x1f]/.test(value.slot)||!integer(value.user_index)||!integer(value.generation)||!token(value.epoch)||!/^\d{1,30}$/.test(value.save_address)||!/^\d{1,30}$/.test(value.store_address)||!integer(value.updated_at)||Math.abs(now-value.updated_at)>3)throw Error('Native profile heartbeat is stale or invalid.');
 return value;
}
function identity(state){return JSON.stringify([state.build_id,state.slot,state.user_index,state.save_address,state.store_address,state.generation,state.epoch]);}
function parseRequest(packet){
 if(Buffer.byteLength(packet)>LIMIT)throw Error('Native companion request is oversized.');
 const match=/^FANSERVICE_COMPANION_1\n([0-9-]{1,160})\n([0-9]+)\n([0-9-]{1,160})\n([a-z]+)\n([\s\S]*)$/.exec(packet);if(!match||!token(match[1])||!token(match[3])||!integer(Number(match[2])))throw Error('Invalid native companion request packet.');
 const payload=JSON.parse(match[5]);if(!object(payload))throw Error('Native request payload must be an object.');return {nonce:match[1],generation:Number(match[2]),epoch:match[3],action:match[4],payload};
}
function musicManifest(value,trackId){
 if(!object(value)||value.protocol!==1||value.track_id!==trackId||typeof value.library_id!=='string'||!value.library_id||!/^sha1:[a-f0-9]{40}$/.test(value.recording_id)||!Number.isFinite(value.duration)||value.duration<=0||value.duration>86400||value.native_stream_url!==`/api/music/tracks/${trackId}/stream?native=true`||!object(value.beatmap)||!object(value.beatmap.meta)||!Array.isArray(value.beatmap.beats)||!value.beatmap.beats.length||value.beatmap.beats.length>100000||!Array.isArray(value.beatmap.events)||value.beatmap.events.length>10000)throw Error('Server returned an invalid confirmed native soundtrack manifest.');
 let previous=-1;for(const beat of value.beatmap.beats){if(!object(beat)||!Number.isFinite(beat.time)||beat.time<previous||beat.time<0||beat.time>value.duration||!['stroke','rest','accent'].includes(beat.type))throw Error('Invalid native soundtrack beatmap.');previous=beat.time;}
 previous=-1;const supported=new Set(['media_change','cycle_media','speed_change','background','text','disable_break','restore_break','grant_break','dialogue','edge','cum_event']);for(const event of value.beatmap.events){if(!object(event)||!Number.isFinite(event.time)||event.time<previous||event.time<0||event.time>value.duration||!supported.has(event.type)||event.value!==undefined&&(!['string','number','boolean'].includes(typeof event.value)||typeof event.value==='number'&&!Number.isFinite(event.value)||String(event.value).length>2000))throw Error('Invalid native soundtrack event.');previous=event.time;}
 if(!Number.isFinite(value.beatmap.meta.duration)||Math.abs(value.beatmap.meta.duration-value.duration)>.1||!Number.isFinite(value.beatmap.meta.bpm)||value.beatmap.meta.bpm<20||value.beatmap.meta.bpm>400||value.beatmap.meta.offset!==undefined&&value.beatmap.meta.offset!==0)throw Error('Native soundtrack metadata does not match its recording.');return value;
}

export class NativeCompanionHost {
 constructor({runtimeDir,gameRoot,storeRoot,fetch=globalThis.fetch,now=()=>Math.floor(Date.now()/1000),timeoutMs=15000,storeLimits={},verifyBuild=true}){this.runtimeDir=runtimeDir;this.gameRoot=gameRoot;this.storeRoot=storeRoot;this.fetch=fetch;this.now=now;this.timeoutMs=timeoutMs;this.storeLimits=storeLimits;this.verifyBuild=verifyBuild;this.processed=new Set();this.previews=new Map();this.handshakes=new Map();this.sessions=new Map();this.uploads=new Map();this.stores=new Map();}
 async initialize(){this.runtimeDir=await directory(this.runtimeDir);this.gameRoot=await directory(this.gameRoot);if(this.verifyBuild)await verifyGameIdentity(this.gameRoot,{signal:this.stopSignal});if(!path.isAbsolute(this.storeRoot))throw Error('An absolute companion storage root is required.');await this.serverOrigin();try{const sessions=JSON.parse(await readRegular(path.join(this.runtimeDir,'.fanservice-music-sessions.json'),65536));if(!object(sessions)||Object.keys(sessions).length>128)throw Error('Invalid native music session registry.');for(const [nonce,entry]of Object.entries(sessions)){if(!token(nonce)||!object(entry)||typeof entry.slot!=='string'||!entry.slot||entry.slot.length>512||!integer(entry.user_index)||entry.session_id!=='native-'+nonce)throw Error('Invalid native music session registry.');this.sessions.set(nonce,entry);}}catch(error){if(error.code!=='ENOENT')throw error;}return this;}
 async saveSessions(){await atomicFile(this.runtimeDir,'.fanservice-music-sessions.json',JSON.stringify(Object.fromEntries(this.sessions))+'\n',{replace:true});}
 async reapStopped(){
  if(!this.sessions.size)return;const {state}=await this.context();if(!Array.isArray(state.stopped_music)||state.stopped_music.length>128)return;
  for(const nonce of state.stopped_music){if(!token(nonce))continue;const entry=this.sessions.get(nonce);if(!entry)continue;
   const store=await CompanionStore.open({root:this.storeRoot,gameRoot:this.gameRoot,buildId:NATIVE_BUILD,slot:entry.slot,userIndex:entry.user_index,limits:this.storeLimits});
   await store.releaseSession(entry.session_id);this.sessions.delete(nonce);await this.saveSessions();
  }
 }
 async serverOrigin(){return origin((await readRegular(path.join(this.runtimeDir,'server-origin.txt'),2048)).trim());}
 async context(){const state=heartbeat(JSON.parse(await readRegular(path.join(this.runtimeDir,'.fanservice-companion.state'),REPLY_LIMIT)),this.now());return {state,identity:identity(state),origin:await this.serverOrigin(),started_at:this.now()};}
 async assertCurrent(captured){if(this.stopSignal?.aborted)throw Error('Native companion is stopping; local data was retained.');if(this.now()-captured.started_at>600)throw Error('Native companion operation timed out; previous local data was retained.');if(captured.request_packet&&await readRegular(path.join(this.runtimeDir,'.fanservice-companion.request'),LIMIT)!==captured.request_packet)throw Error('Native request was cancelled or replaced.');const current=await this.context();if(current.identity!==captured.identity||current.origin!==captured.origin)throw Error('Native profile, menu or Server changed; stale work was discarded.');}
 async authorize(context,packId,{enabled=false}={}){
  const catalog=context.state.native_catalog;if(!object(catalog)||!Array.isArray(catalog.packs)||catalog.packs.length>10000)throw Error('Authoritative native catalog is unavailable.');
  const packs=catalog.packs.filter(pack=>object(pack)&&typeof pack.id==='string'&&/^fanservice-[a-z0-9-]+$/.test(pack.id)&&pack.owned===true&&(!enabled||pack.enabled===true));
  if(packId===undefined){if(!packs.length)throw Error('Enable an owned fanservice pack in original Unlocks first.');return JSON.stringify(packs.map(pack=>pack.id).sort());}
  if(typeof packId!=='string'||!/^custom:[A-Za-z0-9_-]{1,128}$/.test(packId))throw Error('Invalid custom pack identity.');
  const packDirectory=await directory(path.join(this.gameRoot,'CockHero','Binaries','Win64','packs')),ledger=JSON.parse(await readRegular(path.join(packDirectory,'.fanservice-receipts.json'),REPLY_LIMIT));
  if(!object(ledger)||ledger.version!==1||!object(ledger.packs))throw Error('Native pack receipt ledger is invalid.');const filenames=new Set();
  for(const [id,receipt]of Object.entries(ledger.packs)){if(!/^custom:[A-Za-z0-9_-]{1,128}$/.test(id)||!object(receipt)||receipt.custom_id!==id||receipt.build_id!==NATIVE_BUILD||!/^fanservice-[a-z0-9-]+\.chpack$/.test(receipt.filename)||!(/^[a-f0-9]{64}$/).test(receipt.sha256)||filenames.has(receipt.filename))throw Error('Native pack receipt ledger is unsafe.');filenames.add(receipt.filename);}
  const receipt=Object.hasOwn(ledger.packs,packId)?ledger.packs[packId]:null;if(!receipt||!packs.some(pack=>pack.id===receipt.filename.slice(0,-7)))throw Error(enabled?'Enable this owned pack in original Unlocks first.':'Purchase this pack in original Unlocks first.');return JSON.stringify([receipt.filename,receipt.sha256]);
 }
 async authorizationGuard(context,packId,options){const authorization=await this.authorize(context,packId,options);return async()=>{await this.assertCurrent(context);const current=await this.context();if(await this.authorize(current,packId,options)!==authorization)throw Error('Native pack authorization changed; work was discarded.');};}
 async store(context){const key=JSON.stringify([context.state.slot,context.state.user_index]);if(!this.stores.has(key))this.stores.set(key,await CompanionStore.open({root:this.storeRoot,gameRoot:this.gameRoot,buildId:NATIVE_BUILD,slot:context.state.slot,userIndex:context.state.user_index,limits:this.storeLimits}));return this.stores.get(key);}
 async json(url,{method='GET',headers={},body,assertCurrent=async()=>{}}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{await assertCurrent();const response=await this.fetch(url,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:this.stopSignal?AbortSignal.any([controller.signal,this.stopSignal]):controller.signal,redirect:'error',credentials:'same-origin'});if(response.url&&new URL(response.url).origin!==new URL(url).origin)throw Error('Server request changed origin.');let bytes=0;const parts=[];if(response.body){for await(const chunk of response.body){bytes+=chunk.length;if(bytes>REPLY_LIMIT)throw Error('Server response exceeds 4 MiB.');parts.push(Buffer.from(chunk));}}else{const data=Buffer.from(await response.arrayBuffer());bytes=data.length;if(bytes>REPLY_LIMIT)throw Error('Server response exceeds 4 MiB.');parts.push(data);}const value=JSON.parse(Buffer.concat(parts).toString('utf8'));await assertCurrent();if(!response.ok)throw Error(value.error||`Server request failed (HTTP ${response.status}).`);return value;}catch(error){if(controller.signal.aborted)throw Error('Server request timed out. Local companion data was retained; inspect remote revision before retrying an upload.');throw error;}finally{clearTimeout(timer);}
 }
 async connection(store){const value=JSON.parse(await readRegular(path.join(store.directory,'sync-connection.json'),2048));if(!object(value)||!/^[A-Za-z0-9-]{1,80}$/.test(value.id)||!/^[a-fA-F0-9]{64}$/.test(value.key)||!integer(value.revision)||typeof value.origin!=='string')throw Error('Native sync connection is invalid.');return value;}
 async saveConnection(store,value){await atomicFile(store.directory,'sync-connection.json',JSON.stringify(value)+'\n',{replace:true});}
 async handle(request){
  if(!actions.has(request.action))throw Error('Unsupported native companion action.');const context=await this.context();if(request.source_packet)context.request_packet=request.source_packet;if(request.generation!==context.state.generation||request.epoch!==context.state.epoch)throw Error('Native request belongs to a stale generation.');
  const store=await this.store(context),payload=request.payload;let assertCurrent=()=>this.assertCurrent(context);if(['snapshotdownload','snapshotdelete','musicprepare'].includes(request.action))assertCurrent=await this.authorizationGuard(context,payload.pack_id,{enabled:request.action==='musicprepare'});await assertCurrent();
  if(request.action==='companionread'){const state=await store.read();let sync=null;try{const c=await this.connection(store);sync={id:c.id,revision:c.revision,configured:c.origin===context.origin};}catch(error){if(error.code!=='ENOENT')throw error;}await assertCurrent();return {...state,sync,server_origin:context.origin};}
  if(request.action==='definitionsbegin'){
   for(const [key,value]of this.uploads)if(value.expires<this.now())this.uploads.delete(key);if(this.uploads.size>=16)throw Error('Too many pending definition transfers.');
   const current=await store.read();if(!integer(payload.bytes,1)||payload.bytes>2*1024*1024||payload.expected_revision!==current.revision)throw Error('Invalid definition transfer size or revision.');const id=randomBytes(16).toString('hex');this.uploads.set(id,{identity:context.identity,origin:context.origin,revision:current.revision,size:payload.bytes,received:0,chunks:[],expires:this.now()+600});return {upload_token:id};
  }
  if(request.action==='definitionschunk'||request.action==='definitionscommit'){
   const upload=this.uploads.get(payload.upload_token);if(!upload||upload.identity!==context.identity||upload.origin!==context.origin||upload.expires<this.now())throw Error('Definition transfer is stale.');
   if(request.action==='definitionschunk'){
    if(typeof payload.chunk!=='string'||payload.chunk.length>48000||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.chunk)||payload.offset!==upload.received)throw Error('Definition transfer chunk is invalid or out of order.');const bytes=Buffer.from(payload.chunk,'base64');if(bytes.toString('base64')!==payload.chunk||!bytes.length||bytes.length>32768||upload.received+bytes.length>upload.size)throw Error('Definition transfer exceeds its declared size.');upload.chunks.push(bytes);upload.received+=bytes.length;return {received:upload.received};
   }
   this.uploads.delete(payload.upload_token);if(upload.received!==upload.size)throw Error('Definition transfer is incomplete.');return store.saveDefinitions(JSON.parse(Buffer.concat(upload.chunks).toString('utf8')),{expectedRevision:upload.revision,assertCurrent});
  }
  if(request.action==='definitions')return store.saveDefinitions(payload.packs,{expectedRevision:payload.expected_revision,assertCurrent});
  if(request.action==='snapshotdelete'){await assertCurrent();return store.deleteSnapshot(payload.pack_id,{assertCurrent});}
  if(request.action==='sessionrelease'){if(typeof payload.session_id!=='string'||!payload.session_id.startsWith('native-'))throw Error('Invalid native session release.');await assertCurrent();return store.releaseSession(payload.session_id,{assertCurrent});}
  if(request.action==='synchandshake'){
   for(const [key,value]of this.handshakes)if(value.expires<this.now())this.handshakes.delete(key);
   if(this.handshakes.size>=16)throw Error('Too many pending secure sync exchanges. Retry after their expiry.');
   const exchange=createECDH('prime256v1');exchange.generateKeys();const id=randomBytes(16).toString('hex');this.handshakes.set(id,{exchange,identity:context.identity,origin:context.origin,expires:this.now()+60});
   return {handshake_token:id,public_key:exchange.getPublicKey().toString('base64'),algorithm:'P-256/SHA-256/AES-256-GCM'};
  }
  if(request.action==='syncconfigure'){
   if(Object.hasOwn(payload,'key'))throw Error('Sync credentials must use the sealed transport.');
   const sealed=this.handshakes.get(payload.handshake_token);this.handshakes.delete(payload.handshake_token);
   if(!sealed||sealed.expires<this.now()||sealed.identity!==context.identity||sealed.origin!==context.origin)throw Error('Secure sync exchange is stale. Start a new exchange.');
   let connection;try{
    const decode=(value,length)=>{if(typeof value!=='string'||value.length>6000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error();const bytes=Buffer.from(value,'base64');if(length&&bytes.length!==length)throw Error();return bytes;};
    const peer=decode(payload.public_key,65),iv=decode(payload.iv,12),ciphertext=decode(payload.ciphertext);if(peer[0]!==4||ciphertext.length<=16||ciphertext.length>4096)throw Error();
    const key=createHash('sha256').update(sealed.exchange.computeSecret(peer)).digest(),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(payload.handshake_token));decipher.setAuthTag(ciphertext.subarray(-16));
    connection=JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]).toString('utf8'));
   }catch{throw Error('Secure sync credentials failed authentication.');}
   if(!object(connection)||!/^[A-Za-z0-9-]{1,80}$/.test(connection.id)||!/^[a-fA-F0-9]{64}$/.test(connection.key)||!integer(connection.revision))throw Error('Import a valid native sync connection.');
   await assertCurrent();await this.saveConnection(store,{id:connection.id,key:connection.key,revision:connection.revision,origin:context.origin});this.previews.clear();return {configured:true,id:connection.id,revision:connection.revision};
  }
  if(request.action.startsWith('sync'))return this.synchronize(request,context,store);
  if(request.action==='snapshotdownload'){
   const current=await store.read(),pack=current.packs.find(pack=>pack.id===payload.pack_id);if(!pack)throw Error('Read and save the native companion pack definition first.');if(payload.expected_revision!==current.revision)throw Error('Companion profile changed before snapshot download.');
   const url=new URL('/api/fanservice/v1/resolve',context.origin);url.searchParams.set('selection',JSON.stringify(pack.selection));const manifest=await this.json(url,{assertCurrent});let music=null;if(payload.track_id!==undefined){if(!integer(payload.track_id,1))throw Error('Choose a positive soundtrack identity.');music=musicManifest(await this.json(new URL(`/api/fanservice/v1/music/${payload.track_id}/manifest`,context.origin),{assertCurrent}),payload.track_id);}
   return store.downloadSnapshot(pack.id,{manifest,music,origin:context.origin,fetch:this.fetch,signal:this.stopSignal,expectedRevision:current.revision,assertCurrent});
  }
  if(request.action==='musicprepare')return this.prepareMusic(request,context,store,assertCurrent);
  throw Error('Unsupported native companion action.');
 }
 async synchronize(request,context,store){
  const payload=request.payload,current=await store.read(),connection=await this.connection(store),connectionTag=digest(JSON.stringify(connection));if(connection.origin!==context.origin)throw Error('Sync connection belongs to another Server; explicitly configure it for this Server.');
  const assertCurrent=async()=>{await this.assertCurrent(context);if(digest(JSON.stringify(await this.connection(store)))!==connectionTag)throw Error('Native sync connection changed; response was discarded.');};
  const url=new URL('/api/fanservice/v1/profiles/'+connection.id,context.origin),headers={'X-Fanservice-Profile-Key':connection.key};
  if(request.action==='syncupload'){
   if(payload.expected_revision!==current.revision)throw Error('Companion profile changed before upload.');const capabilities=await this.json(new URL('/api/fanservice/v1/capabilities',context.origin),{assertCurrent});if(typeof capabilities.library_id!=='string'||current.packs.some(pack=>pack.library_id!==capabilities.library_id))throw Error('Companion definitions belong to a different Server library.');const profile={version:1,kind:'fanservice-native-companion',unlock_points:0,packs:sanitizeDefinitions(current.packs)};
   const result=await this.json(url,{method:'PUT',headers,body:{expected_revision:connection.revision,profile},assertCurrent});if(!integer(result.revision)||result.revision!==connection.revision+1)throw Error('Server returned an invalid synchronization revision.');
   await assertCurrent();if((await store.read()).revision!==current.revision)throw Error('Local definitions changed during upload. Remote upload may have completed; review its revision.');await this.saveConnection(store,{...connection,revision:result.revision});return {revision:result.revision,definitions:profile.packs.length,native_progression_unchanged:true};
  }
  if(request.action==='syncpreview'){
   for(const [key,value]of this.previews)if(value.expires<this.now())this.previews.delete(key);if(this.previews.size>=16)throw Error('Too many pending sync previews. Review or wait for their expiry.');
   const result=await this.json(url,{headers,assertCurrent});if(!integer(result.revision)||!object(result.profile)||result.profile.version!==1)throw Error('Remote companion profile is unsupported.');const packs=sanitizeDefinitions(result.profile.packs),capabilities=await this.json(new URL('/api/fanservice/v1/capabilities',context.origin),{assertCurrent});if(typeof capabilities.library_id!=='string'||packs.some(pack=>pack.library_id!==capabilities.library_id))throw Error('Remote definitions belong to a different Server library.');await assertCurrent();if((await store.read()).revision!==current.revision)throw Error('Local definitions changed during download.');const preview=randomBytes(16).toString('hex');this.previews.set(preview,{profile_id:store.binding.profile_id,context:context.identity,origin:context.origin,localRevision:current.revision,remoteRevision:result.revision,packs,connectionTag,expires:this.now()+60});return {preview_token:preview,local_revision:current.revision,remote_revision:result.revision,packs,native_progression_unchanged:true};
  }
  if(request.action==='syncapply'){
   const preview=this.previews.get(payload.preview_token);if(!preview||preview.expires<this.now()||preview.profile_id!==store.binding.profile_id||preview.context!==context.identity||preview.origin!==context.origin||preview.localRevision!==payload.expected_revision||preview.localRevision!==current.revision||preview.connectionTag!==connectionTag)throw Error('Sync preview is stale. Download and review again.');
   const result=await store.saveDefinitions(preview.packs,{expectedRevision:current.revision,assertCurrent});await assertCurrent();await this.saveConnection(store,{...connection,revision:preview.remoteRevision});this.previews.delete(payload.preview_token);return {revision:result.revision,sync_revision:preview.remoteRevision,packs:result.packs,native_progression_unchanged:true};
  }
  throw Error('Unsupported native synchronization action.');
 }
 async prepareMusic(request,context,store,assertCurrent=()=>this.assertCurrent(context)){
  const payload=request.payload;let selected,location,sessionId;
  if(payload.pack_id!==undefined){
   if(payload.track_id!==undefined)throw Error('Choose a saved soundtrack or a live track, not both.');if(this.sessions.size>=128)throw Error('Too many retained native soundtrack sessions. Release stopped sessions before starting another.');sessionId='native-'+request.nonce;const snapshot=await store.pinSnapshot(payload.pack_id,sessionId,{assertCurrent});try{await assertCurrent();if(!snapshot.music)throw Error('Snapshot has no downloaded soundtrack.');selected=musicManifest({...snapshot.music,protocol:1,library_id:snapshot.library_id,native_stream_url:`/api/music/tracks/${snapshot.music.track_id}/stream?native=true`},snapshot.music.track_id);location=pathToFileURL(snapshot.music.path).href;}catch(error){await store.releaseSession(sessionId);throw error;}
  }else{
   if(!integer(payload.track_id,1))throw Error('Choose a positive soundtrack identity.');selected=musicManifest(await this.json(new URL(`/api/fanservice/v1/music/${payload.track_id}/manifest`,context.origin),{assertCurrent}),payload.track_id);location=new URL(selected.native_stream_url,context.origin).href;
  }
  try{await assertCurrent();if(sessionId){this.sessions.set(request.nonce,{slot:context.state.slot,user_index:context.state.user_index,session_id:sessionId});await this.saveSessions();}await assertCurrent();const packet='FANSERVICE_MUSIC_2\n'+request.nonce+'\n'+request.generation+'\n'+request.epoch+'\n'+encodeURIComponent(location)+'\n'+selected.duration+'\n'+JSON.stringify(selected.beatmap);if(Buffer.byteLength(packet)>REPLY_LIMIT)throw Error('Native soundtrack command exceeds 4 MiB.');await atomicFile(this.runtimeDir,'.fanservice-music-command.'+request.nonce,packet);return {command_nonce:request.nonce,track_id:selected.track_id,recording_id:selected.recording_id,duration:selected.duration,library_id:selected.library_id,session_id:sessionId||null,scope:'authorized native audio transport command; no game UI or wallet mutation'};}catch(error){if(sessionId){await store.releaseSession(sessionId);this.sessions.delete(request.nonce);await this.saveSessions();}throw error;}
 }
 async pollOnce(){
  let request;try{const packet=await readRegular(path.join(this.runtimeDir,'.fanservice-companion.request'),LIMIT);request={...parseRequest(packet),source_packet:packet};}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(this.processed.has(request.nonce))return false;this.processed.add(request.nonce);if(this.processed.size>2048)this.processed.delete(this.processed.values().next().value);
  let reply;try{reply={ok:true,data:await this.handle(request)};}catch(error){reply={ok:false,error:String(error.message).slice(0,2000)};}
  let bytes=JSON.stringify(reply);if(Buffer.byteLength(bytes)>REPLY_LIMIT)bytes=JSON.stringify({ok:false,error:'Companion reply exceeds 4 MiB.'});await atomicFile(this.runtimeDir,'.fanservice-companion.response.'+request.nonce,MARKER+'\n'+request.nonce+'\n'+request.generation+'\n'+bytes);return true;
 }
 async run({signal,initialize=false}={}){
  this.runtimeDir=await directory(this.runtimeDir);this.gameRoot=await directory(this.gameRoot);
  const lock=path.join(this.runtimeDir,'.fanservice-companion.host.lock'),owner=randomBytes(16).toString('hex'),handle=await fs.open(lock,'wx',0o600),stop=new AbortController();
  this.stopSignal=signal?AbortSignal.any([signal,stop.signal]):stop.signal;let checking=false;
  const shutdown=setInterval(async()=>{if(checking||stop.signal.aborted)return;checking=true;try{const file=path.join(this.runtimeDir,'.fanservice-companion.shutdown'),value=await readRegular(file,128);if(value==='FANSERVICE_COMPANION_STOP_1\n'+owner){stop.abort();await fs.unlink(file);}}catch(error){if(error.code!=='ENOENT'&&error.code!=='EACCES')process.stderr.write('Native companion shutdown request was retained.\n');}finally{checking=false;}},250);
  try{await handle.writeFile(owner);await handle.sync();if(initialize)await this.initialize();if(this.stopSignal.aborted)return;await atomicFile(this.runtimeDir,'.fanservice-companion.ready',owner);while(!this.stopSignal.aborted){try{if(this.lastReap!==this.now()){this.lastReap=this.now();await this.reapStopped();}await this.pollOnce();}catch(error){if(error.code!=='ENOENT'&&(this.lastError!==error.message||this.now()-(this.lastErrorAt||0)>=60)){this.lastError=error.message;this.lastErrorAt=this.now();process.stderr.write('Native companion: '+error.message+'\n');}}await delay(50,undefined,{signal:this.stopSignal}).catch(error=>{if(error.name!=='AbortError')throw error;});}}
  catch(error){if(!this.stopSignal.aborted)throw error;}
  finally{clearInterval(shutdown);try{const ready=path.join(this.runtimeDir,'.fanservice-companion.ready');if(await readRegular(ready,32)===owner)await fs.unlink(ready);}catch(error){if(error.code!=='ENOENT')throw error;}await handle.close();try{if(await readRegular(lock,32)===owner)await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
}

export async function main(args=process.argv.slice(2)){
 const options={};for(let index=0;index<args.length;index+=2){if(!['--runtime-dir','--game-root','--store-root'].includes(args[index])||!args[index+1])throw Error('Usage: node host.mjs --runtime-dir <absolute mod directory> --game-root <absolute game directory> [--store-root <absolute data directory>]');options[args[index]]=args[index+1];}
 const local=process.env.LOCALAPPDATA;if(!options['--store-root']&&!local)throw Error('LOCALAPPDATA or --store-root is required.');const host=new NativeCompanionHost({runtimeDir:options['--runtime-dir'],gameRoot:options['--game-root'],storeRoot:options['--store-root']||path.join(local,'fanservice','native')});const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());await host.run({signal:controller.signal,initialize:true});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
