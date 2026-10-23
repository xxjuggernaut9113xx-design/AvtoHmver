'use strict';
let exportTask=null,exportURL=null;
const exportDialog=node('dialog'),exportTitle=node('h2','Export .chpack'),exportProgress=node('p');exportProgress.setAttribute('role','status');
const exportDownload=node('a','Download .chpack');exportDownload.hidden=true;
const exportCancel=button('Cancel',()=>{exportTask?.abort();exportDialog.close();});
exportDialog.append(exportTitle,exportProgress,exportDownload,exportCancel);document.body.append(exportDialog);
exportDialog.addEventListener('cancel',event=>{if(exportCancel.disabled)event.preventDefault();else exportTask?.abort();});
exportDialog.addEventListener('close',()=>{exportTask?.abort();if(exportURL){URL.revokeObjectURL(exportURL);exportURL=null;}});
async function exportPack(pack){
 if(exportTask)throw Error('Wait for the current export or cancel it.');
 const task=new AbortController();exportTask=task;exportDownload.hidden=true;exportCancel.textContent='Cancel';exportProgress.textContent='Resolving the selection…';exportDialog.showModal();
 try{
  const native=globalThis.Capacitor?.isNativePlatform?.();
  if(native&&!FanserviceArchiveSave.available())throw Error('This Android shell has no archive saving support. Update the APK or use the device browser.');
  const manifest=await resolve(pack);task.signal.throwIfAborted();
  if(manifest.missing_ids?.length||manifest.local_unavailable)throw Error('Some selected files are unavailable. Correct the selection or explicitly remove missing items before exporting.');
  if(!manifest.media.length)throw Error('The selection is empty.');
  let blob;
  if(manifest.media.some(m=>m.local)){
   blob=await FanserviceChpack.create(pack,manifest.media,{signal:task.signal,origin:FanserviceStore.server(),progress:text=>exportProgress.textContent=text});
  }else{
   exportProgress.textContent=`Staging ${manifest.media.length} selected items on the Server…`;
   const response=await fetch(new URL('/api/fanservice/v1/export/chpack',FanserviceStore.server()),{method:'POST',signal:task.signal,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({library_id:pack.library_id,ids:manifest.media.map(m=>m.id),name:pack.name,author:pack.author||'fanservice',description:pack.description||'',unlock_cost:pack.unlock_cost||0,cover_id:pack.cover_id||null})});
   if(!response.ok){let message=`Export failed (${response.status})`;try{message=(await response.json()).error||message;}catch{}throw Error(message);}
   const reader=response.body?.getReader(),parts=[];let size=0;
   if(reader){try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>FanserviceChpack.limit)throw Error('This browser export exceeds 512 MiB. Export a smaller selection.');parts.push(value);exportProgress.textContent=`Receiving archive: ${(size/1048576).toFixed(1)} MiB…`;}}finally{await reader.cancel().catch(()=>{});}blob=new Blob(parts,{type:'application/zip'});}
   else{blob=await response.blob();if(blob.size>FanserviceChpack.limit)throw Error('This browser export exceeds 512 MiB. Export a smaller selection.');}
  }
  task.signal.throwIfAborted();
  const filename=pack.name.trim().replace(/[^\p{L}\p{N}_. -]/gu,'_').replace(/ /g,'_').slice(0,150)+'.chpack';
  if(native){
   await FanserviceArchiveSave.save(blob,filename,{signal:task.signal,progress:text=>exportProgress.textContent=text,onChoose:()=>{exportCancel.disabled=true;}});
   exportProgress.textContent='Archive saved and verified on device. Live pack rules and ownership remain unchanged.';
  }else{
   exportURL=URL.createObjectURL(blob);exportDownload.href=exportURL;exportDownload.download=filename;exportDownload.hidden=false;exportProgress.textContent='Archive ready. Download it to finish exporting. This is a fixed snapshot; live pack rules and ownership remain unchanged.';
  }
  exportCancel.textContent='Close';
 }catch(error){exportProgress.textContent=error.name==='AbortError'?'Export cancelled.':error.message;status(exportProgress.textContent);exportCancel.textContent='Close';}
 finally{exportCancel.disabled=false;if(exportTask===task)exportTask=null;}
}
$('export-selection').onclick=()=>{
 const pack={name:$('pack-name').value.trim(),description:$('pack-description').value,unlock_cost:$('access').value==='priced'?Number($('price').value):0,cover_id:Number($('cover').value)||null,library_id:libraryId,device_id:FanserviceStore.device,selection:$('pack-dialog')._selection};
 if(!pack.name||!Number.isInteger(pack.unlock_cost)||pack.unlock_cost<0||($('access').value==='priced'&&pack.unlock_cost===0)){$('pack-error').textContent='Enter a name and a valid positive whole-number price for a locked pack.';return;}
 exportPack(pack).catch(error=>status(error.message));
};
