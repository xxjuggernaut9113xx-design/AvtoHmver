/* ZIP32 portable pack writer. No phone-selected bytes are sent to a Server. */
(function(root){
 'use strict';
 const encoder=new TextEncoder(),limit=512*1024*1024;
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
 function header(size,values){const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);for(const [offset,value,width] of values)width===2?view.setUint16(offset,value,true):view.setUint32(offset,value,true);return bytes;}
 function leaf(text){return String(text).replace(/[\x00-\x1f\x7f/\\:<>"|?*]/g,'-').replace(/^[ .]+|[ .]+$/g,'');}
 function filename(index,item){const ext=String(item.file||item.name||'').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();if(!ext||!['png','jpg','jpeg','bmp','gif','webp','mp4','mov','webm'].includes(ext))throw Error('Unsupported media filename: '+(item.name||item.file));const tags=[...new Set((item.tags||[]).map(leaf).filter(Boolean))].sort();const result=[index,...tags].join('_')+'.'+ext;if(encoder.encode(result).length>240)throw Error('Media tags exceed the portable filename limit.');return result;}
 async function read(response,signal,onBytes){if(!response.ok)throw Error('Selected media download failed ('+response.status+').');const reader=response.body?.getReader();if(!reader){const bytes=new Uint8Array(await response.arrayBuffer());signal?.throwIfAborted();onBytes(bytes.length);return bytes;}const parts=[];let length=0;try{for(;;){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;onBytes(value.length);length+=value.length;parts.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(length);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;}
 async function create(pack,media,{signal,progress=()=>{},fetchMedia=fetch,origin=location.origin}={}){
  if(!media.length||media.length>10000)throw Error('Export requires 1–10000 available media items.');
  if(!pack.name?.trim()||pack.name.length>120||!Number.isInteger(pack.unlock_cost||0)||pack.unlock_cost<0||pack.unlock_cost>2147483647)throw Error('Enter a pack name and a valid whole-number UP price.');
  const files=[],entries=[];let total=0;
  const onBytes=n=>{total+=n;if(total>limit)throw Error('This on-device export exceeds 512 MiB. Export a smaller selection; phone files will not be uploaded.');};
  for(let i=0;i<media.length;i++){
   signal?.throwIfAborted();const item=media[i],name=filename(i,item),url=new URL(item.url,origin);
   if(item.local ? url.protocol!=='blob:' : url.origin!==new URL(origin).origin)throw Error('Media access does not match its library or local device.');
   progress(`Reading item ${i+1} of ${media.length}…`);
   const bytes=await read(await fetchMedia(url,{signal,credentials:'same-origin'}),signal,onBytes);
   files.push({name:'media/'+name,bytes});entries.push({file:name,type:item.type==='video'?'video':'image'});
  }
  let preview;const coverIndex=media.findIndex(m=>String(m.id)===String(pack.cover_id));
  if(coverIndex>=0){if(media[coverIndex].type!=='image')throw Error('Cover must be an image.');preview='preview.'+entries[coverIndex].file.split('.').pop();files.push({name:preview,bytes:files[coverIndex].bytes});}
  const manifest={version:'0.02a',name:pack.name.trim(),author:pack.author||'fanservice',description:pack.description||'',...(preview?{preview}:{}),unlock_cost:pack.unlock_cost||0,required_challenge:'',patreon_exclusive:false,image_count:entries.filter(e=>e.type==='image').length,video_count:entries.filter(e=>e.type==='video').length,total_media:entries.length,media:entries,social_links:{onlyfans:'',fansly:'',twitter:'',linktree:'',manyvids:'',redgifs:'',discord:'',patreon:'',subscribestar:'',kofi:''}};
  files.push({name:'manifest.json',bytes:encoder.encode(JSON.stringify(manifest,null,2))});return zip(files,signal);
 }
 async function zip(files,signal){const parts=[],central=[];let offset=0,centralSize=0;
  for(const file of files){signal?.throwIfAborted();const name=encoder.encode(file.name),size=file.bytes.length;
   if(offset+centralSize+size+76+name.length*2>limit)throw Error('This on-device archive exceeds 512 MiB including its cover. Export a smaller selection.');
   let crc=0xffffffff;
   for(let at=0;at<size;at+=1048576){for(let i=at;i<Math.min(at+1048576,size);i++)crc=crcTable[(crc^file.bytes[i])&255]^(crc>>>8);if(at&&at%16777216===0){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}}
   crc=(crc^0xffffffff)>>>0;
   const local=header(30,[[0,0x04034b50],[4,20,2],[6,0x800,2],[12,33,2],[14,crc],[18,size],[22,size],[26,name.length,2]]);
   const directory=header(46,[[0,0x02014b50],[4,20,2],[6,20,2],[8,0x800,2],[14,33,2],[16,crc],[20,size],[24,size],[28,name.length,2],[42,offset]]);
   parts.push(local,name,file.bytes);central.push(directory,name);centralSize+=directory.length+name.length;offset+=local.length+name.length+size;
  }
  if(offset+centralSize>0xffffffff||files.length>65535)throw Error('Portable archive exceeds ZIP32 limits.');
  return new Blob([...parts,...central,header(22,[[0,0x06054b50],[8,files.length,2],[10,files.length,2],[12,centralSize],[16,offset]])],{type:'application/zip'});
 }
 async function unpack(file){
  if(!file.size||file.size>limit)throw Error('Select a pack up to 512 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer),decoder=new TextDecoder('utf-8',{fatal:true}),entries=new Map();
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw Error('Invalid or multipart ZIP pack.');
  const count=v.getUint16(end+10,true);let at=v.getUint32(end+16,true),total=0;
  if(count>10002||at+v.getUint32(end+12,true)!==end)throw Error('Invalid ZIP directory.');
  for(let i=0;i<count;i++){
   if(at+46>end||v.getUint32(at,true)!==0x02014b50)throw Error('Invalid ZIP entry.');
   const flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),crc=v.getUint32(at+16,true),compressed=v.getUint32(at+20,true),size=v.getUint32(at+24,true),n=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true),offset=v.getUint32(at+42,true);
   if(at+46+n+extra+comment>end)throw Error('Truncated ZIP directory.');
   const name=decoder.decode(bytes.subarray(at+46,at+46+n));at+=46+n+extra+comment;
   if(flags&1||![0,8].includes(method)||/[\x00-\x1f]/.test(name)||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||entries.has(name))throw Error('Unsafe or unsupported ZIP entry.');
   total+=size;if(total>limit||size>256*1024*1024||offset+30>bytes.length||v.getUint32(offset,true)!==0x04034b50)throw Error('Pack entry exceeds limits or is damaged.');
   const localNameSize=v.getUint16(offset+26,true),start=offset+30+localNameSize+v.getUint16(offset+28,true);if(start+compressed>v.getUint32(end+16,true))throw Error('Truncated ZIP data.');
   if(decoder.decode(bytes.subarray(offset+30,offset+30+localNameSize))!==name||v.getUint16(offset+8,true)!==method||v.getUint16(offset+6,true)!==flags)throw Error('Conflicting ZIP entry headers.');
   let data=bytes.subarray(start,start+compressed);
   if(method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),parts=[];let length=0;try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>size)throw Error('ZIP expansion exceeds declared size.');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}data=new Uint8Array(await new Blob(parts).arrayBuffer());}
   if(data.length!==size||crc32(data)!==crc)throw Error('Pack integrity check failed: '+name);entries.set(name,data);
  }
  if(at!==end||!entries.has('manifest.json'))throw Error('Missing manifest or invalid ZIP directory length.');
  const manifest=JSON.parse(decoder.decode(entries.get('manifest.json')));
  if(typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>120||typeof manifest.description!=='string'||manifest.description.length>2000||!Array.isArray(manifest.media)||!manifest.media.length||manifest.media.length>500||!Number.isSafeInteger(manifest.unlock_cost)||manifest.unlock_cost<0||manifest.unlock_cost>2147483647)throw Error('Unsupported pack manifest or more than 500 media items.');
  const seen=new Set(),files=manifest.media.map(item=>{if(typeof item.file!=='string'||item.file.includes('/')||item.file.includes('\\')||seen.has(item.file))throw Error('Invalid media entry.');seen.add(item.file);const data=entries.get('media/'+item.file),ext=item.file.split('.').pop().toLowerCase(),mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',webp:'image/webp',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'}[ext];if(!data||!mime||!mime.startsWith(item.type+'/'))throw Error('Missing or unsupported pack media.');return new File([data],item.file,{type:mime});});
  return {manifest,files};
 }
 root.FanserviceChpack={create,filename,crc32,limit,unpack};
 if(typeof module!=='undefined')module.exports=root.FanserviceChpack;
})(globalThis);
