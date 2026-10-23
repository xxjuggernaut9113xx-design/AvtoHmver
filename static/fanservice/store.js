(function(root){
 'use strict';
 const id=()=>crypto.randomUUID?crypto.randomUUID():[...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const device=localStorage.getItem('fanservice-device')||id();localStorage.setItem('fanservice-device',device);
 const db=new Promise((resolve,reject)=>{const r=indexedDB.open('fanservice-local-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('files');r.result.createObjectStore('snapshots');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 async function operation(store,mode,fn){const d=await db;return new Promise((resolve,reject)=>{const tx=d.transaction(store,mode,mode==='readwrite'?{durability:'strict'}:undefined),request=fn(tx.objectStore(store));let value;request.onsuccess=()=>value=request.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||Error('Local storage transaction aborted'));});}
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
 async function boundedBlob(response){if(!response.ok)throw Error(`Download failed (${response.status})`);const limit=256*1024*1024;const size=Number(response.headers.get('content-length'));if(size>limit)throw Error('This item exceeds the 256 MiB snapshot item limit.');const reader=response.body?.getReader();if(!reader)return response.blob();const parts=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit)throw Error('This item exceeds the 256 MiB snapshot item limit.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}return new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'});}
 async function download(pack,manifest,origin,music){
  if(navigator.storage?.persist)await navigator.storage.persist();const keys=[];const snapshot={id:id(),pack_id:pack.id,library_id:pack.library_id,saved_at:new Date().toISOString(),device_id:device,media:[],music:null};
  try{for(const item of manifest.media){const key=snapshot.id+':'+keys.length;const blob=await boundedBlob(await fetch(new URL(item.url,origin)));await put('files',key,{blob,local:false});keys.push(key);snapshot.media.push({...item,url:undefined,storage_key:key});}
   if(music){const key=snapshot.id+':music';const blob=await boundedBlob(await fetch(new URL(music.stream_url,origin)));await put('files',key,{blob,local:false});keys.push(key);snapshot.music={...music,storage_key:key};}
   await snapshotTransaction(ctx=>{const previous=ctx.current.find(item=>item.pack_id===pack.id);ctx.snapshots.put(snapshot,pack.id);ctx.current=ctx.current.filter(item=>item.pack_id!==pack.id);ctx.current.push(snapshot);
    if(previous){const retired={kind:'fanservice-retired-snapshot',snapshot:previous};ctx.files.put(retired,retiredPrefix+previous.id);ctx.records.push(retired);}collectRetired(ctx);
   });
   return snapshot;
  }catch(e){for(const key of keys)await remove('files',key).catch(()=>{});throw Error(e.name==='QuotaExceededError'?'Storage is full. The previous offline snapshot was retained.':e.message);}
 }
 async function hydrateSnapshot(saved){if(!saved)throw Error('No downloaded snapshot exists on this device.');const result={...saved,media:[]};for(const item of saved.media){const file=await get('files',item.storage_key);if(!file?.blob)throw Error('Downloaded media is unavailable; it may have been removed or evicted. Download the snapshot again.');result.media.push({...item,url:blobURL(item.storage_key,file.blob)});}if(saved.music){const file=await get('files',saved.music.storage_key);if(!file?.blob)throw Error('Downloaded music is unavailable or evicted.');result.music={...saved.music,url:blobURL(saved.music.storage_key,file.blob)};}return result;}
 async function snapshot(packId,sessionId){if(sessionId===undefined)return hydrateSnapshot(await get('snapshots',packId));const pin=await get('files',sessionKey(sessionId));if(pin?.kind!=='fanservice-session-pin'||pin.snapshot.pack_id!==packId)throw Error('The saved session snapshot pin is unavailable.');return hydrateSnapshot(pin.snapshot);}
 async function pinSnapshot(packId,sessionId){const key=sessionKey(sessionId);const saved=await snapshotTransaction(ctx=>{const existing=ctx.records.find(record=>record?.kind==='fanservice-session-pin'&&record.sessionId===sessionId);if(existing){if(existing.snapshot.pack_id!==packId)throw Error('Session pin belongs to a different pack.');return existing.snapshot;}
   const saved=ctx.current.find(item=>item.pack_id===packId);if(!saved)throw Error('No downloaded snapshot exists on this device.');ctx.files.put({kind:'fanservice-session-pin',sessionId,snapshot:saved},key);return saved;
  });return hydrateSnapshot(saved);}
 async function releaseSession(sessionId){const key=sessionKey(sessionId);return snapshotTransaction(ctx=>{ctx.files.delete(key);ctx.records=ctx.records.filter(record=>!(record?.kind==='fanservice-session-pin'&&record.sessionId===sessionId));collectRetired(ctx);});}
 async function deleteSnapshot(packId){return snapshotTransaction(ctx=>{const saved=ctx.current.find(item=>item.pack_id===packId);if(!saved)return;ctx.snapshots.delete(packId);ctx.current=ctx.current.filter(item=>item.pack_id!==packId);const retired={kind:'fanservice-retired-snapshot',snapshot:saved};ctx.files.put(retired,retiredPrefix+saved.id);ctx.records.push(retired);collectRetired(ctx);});}
 function server(){return localStorage.getItem('fanservice-server-origin')||location.origin;}
 root.FanserviceStore={device,id,get,put,remove,localFiles,importFiles,resolveLocal,download,snapshot,pinSnapshot,releaseSession,deleteSnapshot,server};
})(globalThis);
