(function(root){
 'use strict';
 let active,context,source,generation=0;
 let settings={pack:'',pronoun:'Male',volume:.8};try{settings={...settings,...JSON.parse(localStorage.getItem('fanservice-voice-settings-v1')||'{}')};}catch{}
 const database=new Promise((resolve,reject)=>{const request=indexedDB.open('fanservice-voices-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('packs');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 async function record(value){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('packs',value===undefined?'readonly':'readwrite'),request=value===undefined?tx.objectStore('packs').get('active'):tx.objectStore('packs').put(value,'active');let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||Error('Voice-pack storage failed'));});}
 const ready=record().then(value=>active=value).catch(()=>{});
 function pcm(bytes){
  if(bytes.byteLength<44)throw Error('A recording is not a PCM WAV file');const data=new DataView(bytes),word=(at,n)=>String.fromCharCode(...new Uint8Array(bytes,at,n));if(word(0,4)!=='RIFF'||word(8,4)!=='WAVE')throw Error('Recordings must be PCM WAV');let format,duration;
  for(let at=12;at+8<=bytes.byteLength;){const tag=word(at,4),size=data.getUint32(at+4,true),end=at+8+size;if(end>bytes.byteLength)throw Error('Truncated WAV recording');if(tag==='fmt '&&size>=16)format={type:data.getUint16(at+8,true),channels:data.getUint16(at+10,true),rate:data.getUint32(at+12,true),bits:data.getUint16(at+22,true)};if(tag==='data')duration=size;at=end+(size%2);}
  if(!format||format.type!==1||![1,2].includes(format.channels)||format.bits!==16||format.rate<8000||format.rate>48000||!duration||duration/(format.rate*format.channels*2)>60)throw Error('Use 16-bit mono/stereo PCM WAV at 8–48 kHz, up to 60 seconds');
 }
 async function importPack(files){
  const all=[...files],json=all.filter(file=>/\.json$/i.test(file.name));if(json.length!==1||json[0].size>256*1024)throw Error('Select one manifest JSON and its WAV files');const manifest=JSON.parse(await json[0].text());if(manifest.version!==1||(!manifest.lines&&!manifest.packs))throw Error('Unsupported voice-pack manifest');
  const audio=[];let total=0;for(const file of all.filter(file=>file!==json[0])){total+=file.size;if(!/\.wav$/i.test(file.name)||file.size>8*1024*1024||total>256*1024*1024||audio.length>=1000)throw Error('Use WAV recordings up to 8 MiB each and 256 MiB per pack');pcm(await file.arrayBuffer());if(audio.some(([name])=>name===file.name))throw Error('Recording filenames must be unique');audio.push([file.name,file]);}
  const next={manifest,audio};try{await record(next);}catch(error){throw Error(error.name==='QuotaExceededError'?'Storage is full; the previous voice pack was retained':error.message);}active=next;return audio.length;
 }
 function stop(){generation++;if(source){try{source.stop();}catch{}source=null;}}
 async function unlock(){context??=new (root.AudioContext||root.webkitAudioContext)();await context.resume();}
 async function say(id,caption){stop();const token=generation;await ready;if(token!==generation)return false;const definition=active?.manifest.packs?.[settings.pack]||active?.manifest,line=definition?.lines?.[id],selected=line?.pronouns?.[settings.pronoun]||line;
  caption(typeof selected?.caption==='string'?selected.caption.slice(0,1000):selected?id:`Voice recording unavailable: ${id}`);const file=active?.audio.find(([name])=>name===selected?.file)?.[1];if(!file){if(selected)caption(`Voice recording unavailable: ${id}`);return false;}
  try{await unlock();const buffer=await context.decodeAudioData(await file.arrayBuffer());if(token!==generation)return false;source=context.createBufferSource();source.buffer=buffer;const gain=context.createGain();gain.gain.value=Math.max(0,Math.min(1,Number(settings.volume)||0));source.connect(gain).connect(context.destination);source.start();return true;}catch(error){if(token===generation)caption(`Voice recording unavailable: ${id} (${error.message})`);return false;}
 }
 function save(){localStorage.setItem('fanservice-voice-settings-v1',JSON.stringify(settings));}
 root.FanserviceVoice={importPack,unlock,say,stop,pcm};
 const dialog=document.getElementById('connection-dialog');if(!dialog)return;
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Local voice pack';details.append(summary);dialog.append(details);
 if(typeof bridge==='function'&&bridge()){const note=document.createElement('p');note.textContent='The native Viewer loads recordings from your device’s fanservice VoicePacks/active folder. See the included voice-pack instructions.';details.append(note);return;}
 const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.json,.wav';input.setAttribute('aria-label','Voice manifest and recordings');const button=document.createElement('button');button.textContent='Import local voice pack';const result=document.createElement('p');result.setAttribute('role','status');details.append(input,button,result);
 const pack=document.createElement('select');pack.setAttribute('aria-label','Voice variant');const pronoun=document.createElement('select');pronoun.setAttribute('aria-label','Voice pronouns');for(const name of ['Male','Female','Neutral']){const option=document.createElement('option');option.value=name;option.textContent=name;pronoun.append(option);}pronoun.value=settings.pronoun;const volume=document.createElement('input');volume.type='range';volume.min=0;volume.max=1;volume.step=.05;volume.value=settings.volume;volume.setAttribute('aria-label','Voice volume');details.append(pack,pronoun,volume);
 function fill(){pack.replaceChildren();for(const name of ['',...Object.keys(active?.manifest.packs||{})]){const option=document.createElement('option');option.value=name;option.textContent=name||'Default voice lines';pack.append(option);}pack.value=settings.pack;}
 button.onclick=async()=>{try{const count=await importPack(input.files);fill();result.textContent=`Imported ${count} recordings. Voice files stay on this device; missing lines retain captions.`;}catch(error){result.textContent=error.message;}};
 pack.onchange=()=>{settings.pack=pack.value;save();};pronoun.onchange=()=>{settings.pronoun=pronoun.value;save();};volume.oninput=()=>{settings.volume=Number(volume.value);save();};ready.then(fill);
})(globalThis);
