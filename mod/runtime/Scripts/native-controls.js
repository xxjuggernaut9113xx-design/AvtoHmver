(function(){
 'use strict';
 const transport=globalThis.FanserviceNativeTransport,library=document.querySelector('#library');
 if(!transport||!library||globalThis.FanserviceNativeControls?.epoch===transport.epoch)return;
 globalThis.FanserviceNativeControls?.revoke();
 const panel=document.createElement('details'),title=document.createElement('summary'),message=document.createElement('p'),packs=document.createElement('div'),controls=document.createElement('div');
 title.textContent='Native music, offline storage and sync';panel.append(title,message,controls,packs);library.prepend(panel);
 let current=null,session=null,timer=null,closed=false,connectionForExport=null;
 const text=(tag,value)=>{const element=document.createElement(tag);element.textContent=value;return element;};
 function show(value){message.textContent=value;}
 function button(label,fn,parent=controls){const element=text('button',label);element.type='button';element.onclick=async()=>{element.disabled=true;try{await fn();}catch(error){show(error.message);}finally{element.disabled=false;}};parent.append(element);return element;}
 function input(label,type='text'){const row=text('label',label),field=document.createElement('input');field.type=type;row.append(field);controls.append(row);return field;}
 const track=input('Server soundtrack ID','number');track.min='1';track.step='1';track.value='1';
 const seek=input('Seek position in seconds','number');seek.min='0';seek.step='0.1';seek.value='0';
 const syncId=input('Companion sync ID'),syncKey=input('Companion sync key','password');syncKey.autocomplete='off';
 show('Start Start-FanserviceNative.cmd before using these controls. Audio transport is separate from rhythm-session integration, which remains pending. Purchases and Enable/Disable stay in original Unlocks.');
 async function configure(connection){
  if(!crypto.subtle)throw Error('Secure native sync requires the HTTPS or loopback page context.');
  const exchange=await transport.request('synchandshake',{}),from64=value=>Uint8Array.from(atob(value),byte=>byte.charCodeAt(0)),to64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),peer=await crypto.subtle.importKey('raw',from64(exchange.public_key),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits=await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256),key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',bits),'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(exchange.handshake_token)},key,new TextEncoder().encode(JSON.stringify(connection)));
  return transport.request('syncconfigure',{handshake_token:exchange.handshake_token,public_key:to64(await crypto.subtle.exportKey('raw',pair.publicKey)),iv:to64(iv),ciphertext:to64(ciphertext)});
 }
 async function release(){if(session){const token=session;await transport.request('sessionrelease',{session_id:token});if(session===token)session=null;}}
 async function watch(){
  clearTimeout(timer);if(closed)return;
  try{const state=await transport.request('musicstatus');if(closed)return;show(`Native audio: ${state.state} · ${state.position.toFixed(2)} / ${state.duration.toFixed(2)} seconds${state.error?' · '+state.error:''}. Rhythm-session integration remains pending.`);if(['stopped','error','ended'].includes(state.state)){await release();return;}timer=setTimeout(watch,750);}catch(error){if(!closed)show(error.message);}
 }
 async function prepare(payload){const result=await transport.request('musicprepare',payload);session=result.session_id;void watch();}
 async function refresh(){
  current=await transport.request('companionread');if(closed)return;packs.replaceChildren();
  packs.append(text('p',`Native Server ${current.server_origin}. Profile ${current.binding.slot} · user ${current.binding.user_index} · companion revision ${current.revision}. Native progression is unchanged.`));
  for(const pack of current.packs){
   const row=document.createElement('article');row.append(text('strong',pack.name),text('p',pack.id));
   button('Download snapshot with selected soundtrack',async()=>{show('Downloading a new immutable snapshot. The previous snapshot remains available until this finishes.');await transport.request('snapshotdownload',{pack_id:pack.id,track_id:Number(track.value),expected_revision:current.revision});await refresh();show('Snapshot saved. Existing sessions retain their pinned generation.');},row);
   if(current.snapshots[pack.id]){
    button('Play saved native soundtrack',()=>prepare({pack_id:pack.id}),row);
    button('Delete saved snapshot',async()=>{await transport.request('snapshotdelete',{pack_id:pack.id});await refresh();},row);
   }
   packs.append(row);
  }
  for(const id of Object.keys(current.pins))button('Release stopped session '+id,async()=>{if(!confirm('Release this stopped session snapshot pin? Keep it if its soundtrack is still playing.'))return;await transport.request('sessionrelease',{session_id:id});await refresh();},packs);
 }
 button('Read native companion profile',refresh);
 button('Save Server pack drafts to companion',async()=>{
  if(!current)await refresh();
  if(globalThis.FanserviceStore&&new URL(FanserviceStore.server()).origin!==current.server_origin)throw Error('Library connection differs from the configured native Server. Update its configuration before saving drafts.');
  if(typeof profile!=='object'||!Array.isArray(profile.packs))throw Error('Open Pack drafts and load the current library first.');
  const bytes=new TextEncoder().encode(JSON.stringify(profile.packs));
  if(bytes.length<48000)await transport.request('definitions',{expected_revision:current.revision,packs:profile.packs});
  else{const started=await transport.request('definitionsbegin',{expected_revision:current.revision,bytes:bytes.length});for(let offset=0;offset<bytes.length;offset+=24576){const chunk=btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576)));await transport.request('definitionschunk',{upload_token:started.upload_token,offset,chunk});}await transport.request('definitionscommit',{upload_token:started.upload_token});}await refresh();show('Portable Server definitions saved. Associate archives with the same custom ID using the pack bridge; native ownership remains required for snapshots.');
 });
 button('Play native soundtrack transport',()=>prepare({track_id:Number(track.value)}));
 button('Pause native soundtrack',async()=>{await transport.request('musicpause');void watch();});
 button('Resume native soundtrack',async()=>{await transport.request('musicresume');void watch();});
 button('Seek native soundtrack',async()=>{await transport.request('musicseek',{position:Number(seek.value)});void watch();});
 button('Reconnect native soundtrack',async()=>{await transport.request('musicreconnect');void watch();});
 button('Stop native soundtrack',async()=>{await transport.request('musicstop');await release();clearTimeout(timer);show('Native soundtrack stopped. Only original audio paused by this transport was restored.');});
 button('Create companion sync identity',async()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));const connection={id:crypto.randomUUID?crypto.randomUUID():'native-'+Date.now(),key:[...bytes].map(value=>value.toString(16).padStart(2,'0')).join(''),revision:0};await configure(connection);connectionForExport=connection;syncId.value=connection.id;syncKey.value='';await refresh();show('Companion identity created. Export its connection before closing this menu to connect another native profile.');});
 button('Export companion sync connection',async()=>{if(!connectionForExport)throw Error('Create an identity or configure/import its key before exporting. Existing private keys are not returned by profile queries.');const area=document.createElement('textarea');area.readOnly=true;area.value=JSON.stringify({...connectionForExport,revision:current?.sync?.revision??connectionForExport.revision,kind:'fanservice-native-companion'},null,2);area.setAttribute('aria-label','Companion sync connection to copy');controls.append(area);area.select();show('Copy this private connection JSON to the other native profile. It authorizes definition sync; keep it private.');});
 const importLabel=text('label','Import companion sync connection'),importFile=document.createElement('input');importFile.type='file';importFile.accept='application/json';importLabel.append(importFile);controls.append(importLabel);
 importFile.onchange=async()=>{try{const file=importFile.files[0];if(!file||file.size>10000)throw Error('Choose a small sync connection JSON file.');const connection=JSON.parse(await file.text());await configure({id:connection.id,key:connection.key,revision:connection.revision??0});connectionForExport=connection;syncId.value=connection.id;syncKey.value='';importFile.value='';await refresh();show('Companion connection imported. No definitions or native progression were replaced.');}catch(error){show(error.message);}};
 button('Configure companion sync',async()=>{const connection={id:syncId.value.trim(),key:syncKey.value.trim(),revision:0};await configure(connection);connectionForExport=connection;syncKey.value='';await refresh();show('Companion sync configured. Definitions sync separately from native UP, ownership and progression.');});
 button('Upload companion definitions',async()=>{if(!current)await refresh();const result=await transport.request('syncupload',{expected_revision:current.revision});show('Definitions uploaded at remote revision '+result.revision+'. Native progression was unchanged.');await refresh();});
 button('Review downloaded definitions',async()=>{const preview=await transport.request('syncpreview');if(!confirm(`Replace companion definitions with remote revision ${preview.remote_revision} (${preview.packs.length} packs)? Native saves, UP and ownership remain unchanged.`))return;await transport.request('syncapply',{preview_token:preview.preview_token,expected_revision:preview.local_revision});await refresh();show('Reviewed definitions applied. Native progression was unchanged.');});
 globalThis.FanserviceNativeControls={epoch:transport.epoch,revoke(){closed=true;clearTimeout(timer);connectionForExport=null;syncKey.value='';panel.replaceChildren();panel.remove();}};
})();
