import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export const NATIVE_BUILD='v004-exclusive-c645757d';
const DEFAULTS=Object.freeze({itemBytes:256*1024*1024,totalBytes:2*1024*1024*1024,mediaCount:10000,metadataBytes:16*1024*1024,timeoutMs:120000});
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const packId=value=>typeof value==='string'&&/^custom:[A-Za-z0-9_-]{1,128}$/.test(value);
const hex=(value,size)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+size+'}$').test(value);

export class RevisionConflict extends Error {constructor(){super('Companion profile changed; read its current revision before retrying.');this.name='RevisionConflict';}}
export class StoreBusy extends Error {constructor(){super('Companion storage is busy. Retry after the current operation.');this.name='StoreBusy';}}

export function sanitizeDefinitions(packs){
 if(!Array.isArray(packs)||packs.length>128)throw Error('Expected at most 128 portable pack definitions.');
 const ids=new Set();
 const result=packs.map(pack=>{
  if(!object(pack)||!packId(pack.id)||ids.has(pack.id)||!text(pack.name,120)||!pack.name.trim()||typeof pack.description!=='string'||pack.description.length>2000||!text(pack.library_id,512)||!integer(pack.unlock_cost,0,2147483647)||!object(pack.selection))throw Error('Invalid portable pack definition.');
  ids.add(pack.id);const selection=pack.selection;
  if(!Array.isArray(selection.ids)||selection.ids.length>500||selection.ids.some(id=>!integer(id,1))||!Array.isArray(selection.rules)||selection.rules.length>32||(!selection.ids.length&&!selection.rules.length))throw Error('Portable selection requires Server media IDs or live rules within protocol limits.');
  const rules=selection.rules.map(rule=>{
   if(!object(rule))throw Error('Invalid portable live rule.');
   const clean={};
   for(const key of ['source_id','group_id','rating_min','rating_max','human_rating_min','human_rating_max'])if(rule[key]!==undefined){if(!integer(rule[key],key.endsWith('_id')?1:0))throw Error('Invalid numeric live rule.');clean[key]=rule[key];}
   for(const key of ['search','tags','media_type','sort'])if(rule[key]!==undefined){if(typeof rule[key]!=='string'||rule[key].length>2000||/[\x00-\x1f]/.test(rule[key]))throw Error('Invalid text live rule.');clean[key]=rule[key];}
   if(!Object.keys(clean).length)throw Error('A live rule has no supported fields.');
   return clean;
  });
  const clean={id:pack.id,name:pack.name.trim(),description:pack.description,library_id:pack.library_id,unlock_cost:pack.unlock_cost,selection:{ids:[...new Set(selection.ids)],rules}};
  if(pack.cover_id!==undefined&&pack.cover_id!==null){if(!integer(pack.cover_id,1))throw Error('Invalid Server cover identity.');clean.cover_id=pack.cover_id;}
  return clean;
 });
 if(Buffer.byteLength(JSON.stringify(result))>2*1024*1024)throw Error('Portable definitions exceed 2 MiB.');
 return result;
}

async function directoryChain(directory,{create=false}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('An absolute local directory is required.');
 const absolute=path.resolve(directory),parts=[];let cursor=absolute;
 for(;;){parts.unshift(cursor);const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 for(const part of parts){
  let stat;try{stat=await fs.lstat(part);}catch(error){if(error.code!=='ENOENT'||!create)throw error;await fs.mkdir(part);stat=await fs.lstat(part);}
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Companion directories cannot contain links or non-directories.');
 }
 return absolute;
}

async function regular(file,maximum){
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw Error('Companion file is linked, non-regular or oversized.');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||!opened.isFile()||opened.nlink!==1)throw Error('Companion file changed while opening.');const buffer=Buffer.alloc(Math.min(maximum+1,opened.size+1));let size=0;for(;;){const read=await handle.read(buffer,size,buffer.length-size,null);size+=read.bytesRead;if(!read.bytesRead||size===buffer.length)break;}if(size>maximum)throw Error('Companion file exceeds its size limit.');return buffer.subarray(0,size);}finally{await handle.close();}
}

async function fileIntegrity(file,maximum){
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw Error('Snapshot file is linked, non-regular or oversized.');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||!opened.isFile()||opened.nlink!==1)throw Error('Snapshot file changed while opening.');const buffer=Buffer.alloc(65536),digest=createHash('sha256');let size=0;for(;;){const result=await handle.read(buffer,0,buffer.length,null);if(!result.bytesRead)break;size+=result.bytesRead;if(size>maximum)throw Error('Snapshot file exceeds its size limit.');digest.update(buffer.subarray(0,result.bytesRead));}return {bytes:size,sha256:digest.digest('hex')};}finally{await handle.close();}
}

async function atomicJSON(directory,name,value,limit,exclusive=false){
 await directoryChain(directory);const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>limit)throw Error('Companion metadata exceeds its size limit.');
 const target=path.join(directory,name),temporary=path.join(directory,'.write-'+randomBytes(16).toString('hex'));
 try{try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Refusing to replace a linked or non-regular companion file.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}if(exclusive)await fs.link(temporary,target);else await fs.rename(temporary,target);
 }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

function safeOrigin(origin){const url=new URL(origin);if(url.origin!==origin||url.username||url.password||url.hash||url.search||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Server origin must be HTTPS or local HTTP without a path or credentials.');return url;}
function mediaURL(value,origin){if(typeof value!=='string'||!value.startsWith('/api/')||value.length>4096)throw Error('Snapshot media needs a relative Server API URL.');const url=new URL(value,origin);if(url.origin!==origin.origin||!url.pathname.startsWith('/api/')||url.username||url.password||url.hash)throw Error('Snapshot URL does not belong to its Server API.');return url;}
function refValid(ref){return object(ref)&&packId(ref.pack_id)&&hex(ref.generation,32)&&hex(ref.manifest_sha256,64)&&text(ref.library_id,512);}
async function publishDirectory(source,target){
 for(let attempt=0;;attempt++){
  await directoryChain(source);try{await fs.lstat(target);throw Error('Snapshot generation already exists; it was retained.');}catch(error){if(error.code!=='ENOENT')throw error;}
  try{await fs.rename(source,target);return;}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=7)throw error;await delay(25*(attempt+1));}
 }
}

export class CompanionStore {
 static async open({root,gameRoot,buildId=NATIVE_BUILD,slot,userIndex,limits={}}){
  if(buildId!==NATIVE_BUILD||!text(slot,512)||!integer(userIndex,0,2147483647))throw Error('Invalid exact native build/profile binding.');
  const canonical=await directoryChain(gameRoot),install=hash(JSON.stringify([process.platform==='win32'?canonical.toLowerCase():canonical,buildId]));
  const binding={install_id:install,build_id:buildId,slot,user_index:userIndex};binding.profile_id=hash(JSON.stringify(binding));
  const base=await directoryChain(root,{create:true}),directory=await directoryChain(path.join(base,install,binding.profile_id),{create:true});
  const store=new CompanionStore(directory,binding,limits);await store._locked(async()=>{try{await store._read();}catch(error){if(error.code!=='ENOENT')throw error;await store._write({schema:1,binding,revision:0,packs:[],snapshots:{},pins:{},retired:[]});}});return store;
 }
 constructor(directory,binding,limits){this.directory=directory;this.binding=Object.freeze({...binding});this.limits={...DEFAULTS,...limits};for(const [key,value]of Object.entries(this.limits))if(!(key in DEFAULTS)||!integer(value,1,DEFAULTS[key]))throw Error('Invalid companion storage limit.');}
 async _locked(operation){
  await directoryChain(this.directory);const lock=path.join(this.directory,'.lock'),owner=randomBytes(16).toString('hex');let handle;
  try{handle=await fs.open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new StoreBusy();throw error;}
  try{await handle.writeFile(owner);await handle.sync();return await operation();}finally{await handle.close();try{if((await regular(lock,32)).toString()===owner)await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 async _read(){
  const state=JSON.parse((await regular(path.join(this.directory,'profile.json'),this.limits.metadataBytes)).toString('utf8'));
  if(!object(state)||state.schema!==1||JSON.stringify(state.binding)!==JSON.stringify(this.binding)||!integer(state.revision)||!object(state.snapshots)||!object(state.pins)||!Array.isArray(state.retired)||Object.entries(state.snapshots).some(([id,ref])=>!refValid(ref)||id!==ref.pack_id)||Object.values(state.pins).some(ref=>!refValid(ref))||state.retired.some(ref=>!refValid(ref)))throw Error('Companion metadata is invalid; existing data was retained.');
  state.packs=sanitizeDefinitions(state.packs);return state;
 }
 async _write(state){await atomicJSON(this.directory,'profile.json',state,this.limits.metadataBytes);}
 async read(){return this._locked(async()=>clone(await this._read()));}
 _revision(state,expected){if(!integer(expected)||state.revision!==expected)throw new RevisionConflict();if(state.revision===Number.MAX_SAFE_INTEGER)throw Error('Companion revision exhausted.');}
 async saveDefinitions(packs,{expectedRevision,assertCurrent=()=>{}}={}){
  const clean=sanitizeDefinitions(packs);return this._locked(async()=>{const state=await this._read();this._revision(state,expectedRevision);await assertCurrent();const keep=new Set(clean.map(pack=>pack.id));for(const [id,ref]of Object.entries(state.snapshots))if(!keep.has(id)){state.retired.push(ref);delete state.snapshots[id];}state.packs=clean;state.revision++;await this._write(state);await this._collect(state);return clone(state);});
 }
 async _download(file,url,{fetch,signal,total,assertCurrent,onCreated}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.limits.timeoutMs),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let handle;
  try{
   combined.throwIfAborted();await assertCurrent();const response=await fetch(url,{signal:combined,redirect:'error',credentials:'same-origin'});if(response.status!==200)throw Error('Snapshot download failed (HTTP '+response.status+').');
   if(response.url&&new URL(response.url).origin!==url.origin)throw Error('Snapshot download changed Server origin.');
   const header=response.headers.get('content-length'),length=header===null?null:Number(header),encoding=response.headers.get('content-encoding');if(length!==null&&(!integer(length)||length>this.limits.itemBytes))throw Error('Snapshot item has an invalid or oversized content length.');
   handle=await fs.open(file,'wx',0o600);onCreated();const digest=createHash('sha256');let size=0;
   let checkedAt=0;const write=async chunk=>{combined.throwIfAborted();if(Date.now()-checkedAt>=500){await assertCurrent();checkedAt=Date.now();}const data=Buffer.from(chunk);size+=data.length;total.bytes+=data.length;if(size>this.limits.itemBytes||total.bytes>this.limits.totalBytes)throw Error('Snapshot item or total size limit exceeded.');digest.update(data);let at=0;while(at<data.length){const result=await handle.write(data,at,data.length-at,null);if(!result.bytesWritten)throw Error('Snapshot storage write was incomplete.');at+=result.bytesWritten;}};
   if(response.body)for await(const chunk of response.body)await write(chunk);else await write(new Uint8Array(await response.arrayBuffer()));
   if(!size||length!==null&&(!encoding||encoding==='identity')&&size!==length)throw Error('Snapshot download was empty or incomplete.');
   await assertCurrent();await handle.sync();return {bytes:size,sha256:digest.digest('hex')};
  }finally{clearTimeout(timer);await handle?.close();}
 }
 async downloadSnapshot(id,{manifest,music=null,origin,fetch=globalThis.fetch,signal,expectedRevision,assertCurrent=()=>{}}={}){
  if(!packId(id)||!object(manifest)||!Array.isArray(manifest.media)||!manifest.media.length||manifest.media.length>this.limits.mediaCount)throw Error('Invalid or empty snapshot manifest.');const server=safeOrigin(origin);
  return this._locked(async()=>{
   const state=await this._read();if(expectedRevision!==undefined)this._revision(state,expectedRevision);const pack=state.packs.find(pack=>pack.id===id);if(!pack||manifest.library_id!==pack.library_id||music&&music.library_id!==pack.library_id)throw Error('Snapshot manifest belongs to a different or missing library.');
   await assertCurrent();signal?.throwIfAborted();const generation=randomBytes(16).toString('hex'),base=await directoryChain(path.join(this.directory,'snapshots'),{create:true}),staging=path.join(base,'.stage-'+generation),target=path.join(base,generation),created=[];await fs.mkdir(staging);let published=false,committed=false;
   try{
    const total={bytes:0},records=[],seen=new Set();
    for(const [index,item]of manifest.media.entries()){
     if(!object(item)||!integer(item.id,1)||!['image','video'].includes(item.type)||seen.has(item.id)||!Array.isArray(item.tags)||item.tags.some(tag=>typeof tag!=='string'||tag.length>256))throw Error('Invalid or duplicate snapshot media entry.');seen.add(item.id);
     const source=mediaURL(item.url,server),extension=/\.(png|jpg|jpeg|gif|webp|bmp|mp4|m4v|webm|mov|mkv|avi)$/i.exec(item.file||'')?.[0].toLowerCase()||'.bin',filename=String(index).padStart(6,'0')+extension;
     const integrity=await this._download(path.join(staging,filename),source,{fetch,signal,total,assertCurrent,onCreated:()=>created.push(filename)});records.push({id:item.id,type:item.type,tags:[...item.tags],file:filename,...integrity});
    }
    let soundtrack=null;
    if(music){
     if(music.protocol!==1||!integer(music.track_id,1)||!text(music.recording_id,128)||!Number.isFinite(music.duration)||music.duration<=0||!object(music.beatmap)||!object(music.beatmap.meta)||!Array.isArray(music.beatmap.beats)||!Array.isArray(music.beatmap.events)||music.native_stream_url!==`/api/music/tracks/${music.track_id}/stream?native=true`)throw Error('Snapshot soundtrack lacks a matching native recording manifest.');
     const filename='soundtrack.m4a';const integrity=await this._download(path.join(staging,filename),mediaURL(music.native_stream_url,server),{fetch,signal,total,assertCurrent,onCreated:()=>created.push(filename)});soundtrack={track_id:music.track_id,recording_id:music.recording_id,duration:music.duration,beatmap:clone(music.beatmap),file:filename,...integrity};
    }
    const descriptor={schema:1,generation,pack_id:id,library_id:pack.library_id,created_at:new Date().toISOString(),media:records,music:soundtrack};await atomicJSON(staging,'manifest.json',descriptor,this.limits.metadataBytes,true);created.push('manifest.json');
    const bytes=await regular(path.join(staging,'manifest.json'),this.limits.metadataBytes),ref={generation,pack_id:id,library_id:pack.library_id,manifest_sha256:hash(bytes)};await assertCurrent();signal?.throwIfAborted();await publishDirectory(staging,target);published=true;
    const resolved=await this._resolve(ref),current=await this._read();if(current.revision!==state.revision)throw new RevisionConflict();if(current.snapshots[id])current.retired.push(current.snapshots[id]);current.snapshots[id]=ref;current.revision++;await assertCurrent();await this._write(current);committed=true;await this._collect(current);return resolved;
   }catch(error){if(!committed){const directory=published?target:staging;await directoryChain(directory);for(const name of created)await fs.unlink(path.join(directory,name)).catch(()=>{});await fs.rmdir(directory).catch(()=>{});}throw error;}
  });
 }
 async _resolve(ref){
  if(!refValid(ref))throw Error('Invalid snapshot reference.');const directory=await directoryChain(path.join(this.directory,'snapshots',ref.generation)),bytes=await regular(path.join(directory,'manifest.json'),this.limits.metadataBytes);if(hash(bytes)!==ref.manifest_sha256)throw Error('Snapshot manifest integrity failed.');const snapshot=JSON.parse(bytes.toString('utf8'));
  if(snapshot.schema!==1||snapshot.generation!==ref.generation||snapshot.pack_id!==ref.pack_id||snapshot.library_id!==ref.library_id||!Array.isArray(snapshot.media)||!snapshot.media.length||snapshot.media.length>this.limits.mediaCount)throw Error('Snapshot binding is invalid.');
  for(const item of [...snapshot.media,...(snapshot.music?[snapshot.music]:[])]){
   if(!object(item)||typeof item.file!=='string'||!/^([0-9]{6}\.(png|jpg|jpeg|gif|webp|bmp|mp4|m4v|webm|mov|mkv|avi|bin)|soundtrack\.m4a)$/.test(item.file)||!integer(item.bytes,1,this.limits.itemBytes)||!hex(item.sha256,64))throw Error('Snapshot file metadata is invalid.');
   const file=path.join(directory,item.file),actual=await fileIntegrity(file,this.limits.itemBytes);if(actual.bytes!==item.bytes||actual.sha256!==item.sha256)throw Error('Snapshot file is missing, changed or incomplete.');item.path=file;
  }
  return snapshot;
 }
 async resolveSnapshot(ref){return this._locked(async()=>{const state=await this._read();if(![...Object.values(state.snapshots),...Object.values(state.pins)].some(saved=>JSON.stringify(saved)===JSON.stringify(ref)))throw Error('Snapshot is not current or pinned by this profile.');return this._resolve(ref);});}
 async currentSnapshot(id){return this._locked(async()=>{const state=await this._read();if(!state.snapshots[id])throw Error('No downloaded snapshot exists.');return this._resolve(state.snapshots[id]);});}
 async pinSnapshot(id,sessionId,{assertCurrent=()=>{}}={}){
  if(!text(sessionId,256)||!/^[A-Za-z0-9:_-]+$/.test(sessionId))throw Error('Invalid native session token.');
  return this._locked(async()=>{const state=await this._read(),existing=state.pins[sessionId];if(existing&&existing.pack_id!==id)throw Error('Session pin belongs to a different pack.');const ref=existing||state.snapshots[id];if(!ref)throw Error('No downloaded snapshot exists.');const snapshot=await this._resolve(ref);if(!existing){await assertCurrent();state.pins[sessionId]=ref;state.revision++;await this._write(state);}return snapshot;});
 }
 async releaseSession(sessionId,{assertCurrent=()=>{}}={}){return this._locked(async()=>{const state=await this._read();await assertCurrent();if(state.pins[sessionId]){delete state.pins[sessionId];state.revision++;await this._write(state);}return this._collect(state);});}
 async deleteSnapshot(id,{assertCurrent=()=>{}}={}){return this._locked(async()=>{const state=await this._read();await assertCurrent();if(state.snapshots[id]){state.retired.push(state.snapshots[id]);delete state.snapshots[id];state.revision++;await this._write(state);}return this._collect(state);});}
 async _collect(state){
  const protectedIds=new Set([...Object.values(state.snapshots),...Object.values(state.pins)].map(ref=>ref.generation)),kept=[],issues=[];
  for(const ref of state.retired){
   if(protectedIds.has(ref.generation)){kept.push(ref);continue;}
   try{
    const snapshot=await this._resolve(ref),directory=path.join(this.directory,'snapshots',ref.generation),files=[...snapshot.media,...(snapshot.music?[snapshot.music]:[])].map(item=>item.file);files.push('manifest.json');const actual=await fs.readdir(directory);if(actual.length!==files.length||actual.some(name=>!files.includes(name)))throw Error('Retired snapshot contains unrelated files.');
    for(const name of files)await fs.unlink(path.join(directory,name));await fs.rmdir(directory);
   }catch(error){kept.push(ref);issues.push({generation:ref.generation,error:error.message});}
  }
  if(kept.length!==state.retired.length){state.retired=kept;try{await this._write(state);}catch(error){issues.push({generation:null,error:'Retired metadata cleanup failed: '+error.message});}}return {cleanup_issues:issues};
 }
}
