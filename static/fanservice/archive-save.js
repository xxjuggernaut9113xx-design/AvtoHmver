'use strict';
(function(root){
 const chunkSize=192*1024;
 let cachedCap,cachedNative;
 function plugin(){const cap=root.Capacitor;if(!cap?.isNativePlatform?.()||!cap.isPluginAvailable?.('ArchiveSave'))return null;if(cachedCap!==cap){cachedCap=cap;cachedNative=cap.Plugins?.ArchiveSave||cap.registerPlugin?.('ArchiveSave');}return cachedNative||null;}
 async function save(blob,name,{signal,progress=()=>{},onChoose=()=>{},native=plugin()}={}){
  if(!native)throw Error('This Android shell has no archive saving support. Update the APK or use the device browser.');
  signal?.throwIfAborted();
  let token;
  try{
   ({token}=await native.begin({name,size:blob.size}));
   for(let offset=0;offset<blob.size;offset+=chunkSize){
    signal?.throwIfAborted();
    const bytes=new Uint8Array(await blob.slice(offset,offset+chunkSize).arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    await native.append({token,offset,data:btoa(binary)});
    progress(`Saving archive on device: ${Math.min(100,Math.floor((offset+bytes.length)*100/blob.size))}%.`);
   }
   signal?.throwIfAborted();progress('Choose where to save the .chpack archive.');
   onChoose();
   const result=await native.finish({token});
   if(result.cancelled)throw new DOMException('Export cancelled.','AbortError');
   if(result.bytes!==blob.size||!result.verified)throw Error('Saved archive verification failed.');
   return result;
  }finally{if(token)await native.abort({token}).catch(()=>{});}
 }
 root.FanserviceArchiveSave={save,available:()=>!!plugin()};
 if(typeof module!=='undefined')module.exports=root.FanserviceArchiveSave;
})(globalThis);
