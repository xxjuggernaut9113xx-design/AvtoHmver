(function(root){
 'use strict';
 const id=()=>crypto.randomUUID?crypto.randomUUID():[...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const device=localStorage.getItem('fanservice-device')||id();localStorage.setItem('fanservice-device',device);
 const db=new Promise((resolve,reject)=>{const r=indexedDB.open('fanservice-local-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('files');r.result.createObjectStore('snapshots');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 async function operation(store,mode,fn){const d=await db;return new Promise((resolve,reject)=>{const tx=d.transaction(store,mode,mode==='readwrite'?{durability:'strict'}:undefined);let request,value;try{request=fn(tx.objectStore(store));}catch(error){tx.abort();reject(error);return;}request.onsuccess=()=>value=request.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||Error('Local storage transaction aborted'));});}
 const urls=new Map();function blobURL(key,blob){if(!urls.has(key))urls.set(key,URL.createObjectURL(blob));return urls.get(key);}
 const get=(store,key)=>operation(store,'readonly',s=>s.get(key));const put=(store,key,value)=>operation(store,'readwrite',s=>s.put(value,key));const remove=(store,key)=>{if(store==='files'&&urls.has(key)){URL.revokeObjectURL(urls.get(key));urls.delete(key);}return operation(store,'readwrite',s=>s.delete(key));};
 const pinPrefix='fanservice:session-pin:',retiredPrefix='fanservice:retired-snapshot:';
 const snapshotKeys=saved=>[...(saved?.media||[]),saved?.music].filter(Boolean).map(item=>item.storage_key);
 function sessionKey(sessionId){if(typeof sessionId!=='string'||!sessionId.length||sessionId.length>512)throw Error('A valid session pin token is required.');return pinPrefix+sessionId;}
 async function snapshotTransaction(change){const d=await db;return new Promise((resolve,reject)=>{
  const tx=d.transaction(['files','snapshots'],'readwrite'),files=tx.objectStore('files'),snapshots=tx.objectStore('snapshots'),allFiles=files.getAll(),allKeys=files.getAllKeys(),allSnapshots=snapshots.getAll();let result,deleted=[];
  let ready=0;const loaded=()=>{if(++ready!==3)return;try{result=change({files,snapshots,records:allFiles.result,fileMap:new Map(allKeys.result.map((key,index)=>[key,allFiles.result[index]])),current:allSnapshots.result,deleted});}catch(e){reject(e);tx.abort();}};
  allFiles.onsuccess=loaded;allKeys.onsuccess=loaded;allSnapshots.onsuccess=loaded;tx.oncomplete=()=>{for(const key of deleted)if(urls.has(key)){URL.revokeObjectURL(urls.get(key));urls.delete(key);}resolve(result);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Snapshot transaction aborted'));
 });}
 function collectRetired(ctx){const protectedKeys=new Set(ctx.current.flatMap(snapshotKeys));for(const record of ctx.records)if(record?.kind==='fanservice-session-pin')for(const key of snapshotKeys(record.snapshot))protectedKeys.add(key);
  for(const record of ctx.records)if(record?.kind==='fanservice-retired-snapshot'){
   const keys=snapshotKeys(record.snapshot);if(keys.some(key=>protectedKeys.has(key)))continue;
   for(const key of keys){if(typeof key!=='string'||!key.startsWith(record.snapshot.id+':')||ctx.fileMap.get(key)?.local!==false)continue;ctx.files.delete(key);ctx.deleted.push(key);}
   ctx.files.delete(retiredPrefix+record.snapshot.id);
  }
 }
 async function localFiles(){const all=await operation('files','readonly',s=>s.getAll());return all.filter(f=>f.local);}
 async function importFiles(files,pools=[]){
  if(pools.some(pool=>!['slow','medium','fast','succubus','cum','ass','boobs'].includes(pool)))throw Error('Invalid local gameplay pool');
  const selected=[...files],result=[];let total=0;
  for(const file of selected){if(!/^(image|video)\//.test(file.type))throw Error('Select images or videos from Files or Photos.');if(file.size<=0||file.size>256*1024*1024)throw Error('Select nonempty images or videos up to 256 MiB each.');total+=file.size;if(total>512*1024*1024)throw Error('Import up to 512 MiB at a time.');}
  if(selected.length&&navigator.storage?.persist)await navigator.storage.persist().catch(()=>false);
  for(const file of selected){let bytes;try{bytes=await file.arrayBuffer();}catch(e){throw Error(`Cannot copy ${file.name} from Files or Photos: ${e.message}`);}if(bytes.byteLength!==file.size)throw Error(`The selected file ${file.name} could not be copied completely. Select it again.`);result.push({id:id(),device_id:device,name:file.name,type:file.type.startsWith('image/')?'image':'video',blob:new Blob([bytes],{type:file.type}),local:true,tags:[...new Set(pools)]});}
  if(!result.length)return [];
  try{await operation('files','readwrite',s=>{let request;for(const file of result)request=s.put(file,file.id);return request;});}
  catch(e){throw Error(e.name==='QuotaExceededError'?'Phone storage is full; none of the selected files were saved.':`Local file access failed: ${e.message}`);}return result;
 }

 async function resolveLocal(selection,owner){const media=[];let unavailable=0;for(const key of selection.local_ids||[]){const entry=owner===device?await get('files',key):null;if(!entry){unavailable++;continue;}media.push({id:'local:'+entry.id,file:entry.name,name:entry.name,type:entry.type,tags:entry.tags,url:blobURL(entry.id,entry.blob),device_id:device,local:true});}return {media,unavailable};}
 async function boundedBlob(response){
  if(!response.ok)throw Error(`Download failed (${response.status})`);
  const limit=256*1024*1024,raw=response.headers.get('content-length'),size=raw===null?null:Number(raw),encoding=response.headers.get('content-encoding');
  if(size!==null&&(!Number.isSafeInteger(size)||size<0))throw Error('Download returned an invalid content length.');
  if(size>limit)throw Error('This item exceeds the 256 MiB snapshot item limit.');
  const verify=blob=>{if(!blob.size)throw Error('Downloaded media is empty. The previous snapshot was retained.');if(blob.size>limit)throw Error('This item exceeds the 256 MiB snapshot item limit.');if(size!==null&&(!encoding||encoding==='identity')&&blob.size!==size)throw Error('Downloaded media is incomplete. The previous snapshot was retained.');return blob;};
  const reader=response.body?.getReader();if(!reader)return verify(await response.blob());
  const parts=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit)throw Error('This item exceeds the 256 MiB snapshot item limit.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return verify(new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'}));
 }
 async function downloadBlob(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);try{return await boundedBlob(await fetch(url,{credentials:'same-origin',signal:controller.signal}));}catch(error){if(controller.signal.aborted)throw Error('Snapshot download timed out. The previous snapshot was retained.');throw error;}finally{clearTimeout(timer);}}
 function validateMusic(value,{libraryId,trackId}={}){
  const object=item=>item!==null&&typeof item==='object'&&!Array.isArray(item),finite=Number.isFinite;
  if(!object(value)||value.protocol!==1||typeof value.library_id!=='string'||!value.library_id||libraryId!==undefined&&value.library_id!==libraryId||!Number.isSafeInteger(value.track_id)||value.track_id<1||trackId!==undefined&&value.track_id!==trackId||!/^sha1:[a-f0-9]{40}$/.test(value.recording_id)||!finite(value.duration)||value.duration<=0||value.stream_url!==`/api/music/tracks/${value.track_id}/stream?browser=true`||value.native_stream_url!==undefined&&value.native_stream_url!==`/api/music/tracks/${value.track_id}/stream?native=true`||value.offset!==undefined&&(!finite(value.offset)||Math.abs(value.offset)>60))throw Error('Soundtrack identity or stream does not match its confirmed recording.');
  const map=value.beatmap;
  if(!object(map)||!object(map.meta)||!finite(map.meta.duration)||Math.abs(map.meta.duration-value.duration)>.1||!finite(map.meta.bpm)||map.meta.bpm<20||map.meta.bpm>400||map.meta.offset!==undefined&&map.meta.offset!==0||!Array.isArray(map.beats)||!map.beats.length||map.beats.length>100000||!Array.isArray(map.events)||map.events.length>10000)throw Error('Soundtrack beatmap metadata does not match its recording.');
  let previous=-1;
  for(const beat of map.beats){if(!object(beat)||!finite(beat.time)||beat.time<previous||beat.time<0||beat.time>value.duration||!['stroke','rest','accent'].includes(beat.type))throw Error('Soundtrack beats must be sorted and remain inside the recording.');previous=beat.time;}
  const supported=new Set(['media_change','cycle_media','speed_change','background','text','disable_break','restore_break','grant_break','dialogue','edge','cum_event']);previous=-1;
  for(const event of map.events){if(!object(event)||!finite(event.time)||event.time<previous||event.time<0||event.time>value.duration||!supported.has(event.type)||event.value!==undefined&&(!['string','number','boolean'].includes(typeof event.value)||typeof event.value==='number'&&!finite(event.value)||String(event.value).length>2000))throw Error('Soundtrack controls must be supported and remain inside the recording.');previous=event.time;}
  return value;
 }
 async function download(pack,manifest,origin,music){
  if(manifest.library_id!==undefined&&manifest.library_id!==pack.library_id||music?.library_id!==undefined&&music.library_id!==pack.library_id)throw Error('Snapshot belongs to a different library. The previous snapshot was retained.');
  if(music)validateMusic(music,{libraryId:pack.library_id});
  if(navigator.storage?.persist)await navigator.storage.persist();const keys=[];const snapshot={id:id(),pack_id:pack.id,library_id:pack.library_id,saved_at:new Date().toISOString(),device_id:device,media:[],music:null};
  try{for(const item of manifest.media){const key=snapshot.id+':'+keys.length;const blob=await downloadBlob(new URL(item.url,origin));await put('files',key,{blob,local:false});keys.push(key);snapshot.media.push({...item,url:undefined,storage_key:key});}
   if(music){const key=snapshot.id+':music';const blob=await downloadBlob(new URL(music.stream_url,origin));await put('files',key,{blob,local:false});keys.push(key);snapshot.music={...music,storage_key:key};}
   await snapshotTransaction(ctx=>{const previous=ctx.current.find(item=>item.pack_id===pack.id);ctx.snapshots.put(snapshot,pack.id);ctx.current=ctx.current.filter(item=>item.pack_id!==pack.id);ctx.current.push(snapshot);
    if(previous){const retired={kind:'fanservice-retired-snapshot',snapshot:previous};ctx.files.put(retired,retiredPrefix+previous.id);ctx.records.push(retired);}collectRetired(ctx);
   });
   return snapshot;
  }catch(e){for(const key of keys)await remove('files',key).catch(()=>{});throw Error(e.name==='QuotaExceededError'?'Storage is full. The previous offline snapshot was retained.':e.message);}
 }
 async function hydrateSnapshot(saved){if(!saved)throw Error('No downloaded snapshot exists on this device.');const result={...saved,media:[]};for(const item of saved.media){const file=await get('files',item.storage_key);if(!file?.blob)throw Error('Downloaded media is unavailable; it may have been removed or evicted. Download the snapshot again.');result.media.push({...item,url:blobURL(item.storage_key,file.blob)});}if(saved.music){validateMusic(saved.music,{libraryId:saved.library_id});const file=await get('files',saved.music.storage_key);if(!file?.blob)throw Error('Downloaded music is unavailable or evicted.');result.music={...saved.music,url:blobURL(saved.music.storage_key,file.blob)};}return result;}
 async function snapshot(packId,sessionId){if(sessionId===undefined)return hydrateSnapshot(await get('snapshots',packId));const pin=await get('files',sessionKey(sessionId));if(pin?.kind!=='fanservice-session-pin'||pin.snapshot.pack_id!==packId)throw Error('The saved session snapshot pin is unavailable.');return hydrateSnapshot(pin.snapshot);}
 async function pinSnapshot(packId,sessionId){const key=sessionKey(sessionId);const saved=await snapshotTransaction(ctx=>{const existing=ctx.records.find(record=>record?.kind==='fanservice-session-pin'&&record.sessionId===sessionId);if(existing){if(existing.snapshot.pack_id!==packId)throw Error('Session pin belongs to a different pack.');return existing.snapshot;}
   const saved=ctx.current.find(item=>item.pack_id===packId);if(!saved)throw Error('No downloaded snapshot exists on this device.');ctx.files.put({kind:'fanservice-session-pin',sessionId,snapshot:saved},key);return saved;
  });return hydrateSnapshot(saved);}
 async function releaseSession(sessionId){const key=sessionKey(sessionId);return snapshotTransaction(ctx=>{ctx.files.delete(key);ctx.records=ctx.records.filter(record=>!(record?.kind==='fanservice-session-pin'&&record.sessionId===sessionId));collectRetired(ctx);});}
 async function deleteSnapshot(packId){return snapshotTransaction(ctx=>{const saved=ctx.current.find(item=>item.pack_id===packId);if(!saved)return;ctx.snapshots.delete(packId);ctx.current=ctx.current.filter(item=>item.pack_id!==packId);const retired={kind:'fanservice-retired-snapshot',snapshot:saved};ctx.files.put(retired,retiredPrefix+saved.id);ctx.records.push(retired);collectRetired(ctx);});}
 function server(){return localStorage.getItem('fanservice-server-origin')||location.origin;}
 root.FanserviceStore={device,id,validateMusic,get,put,remove,localFiles,importFiles,resolveLocal,download,snapshot,pinSnapshot,releaseSession,deleteSnapshot,server};
})(globalThis);
