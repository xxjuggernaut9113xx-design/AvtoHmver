(function(){
 'use strict';
 const transport=globalThis.FanserviceNativeTransport,library=document.querySelector('#library');
 if(!transport||typeof transport.request!=='function'||typeof transport.epoch!=='string'||!transport.epoch||!library)return;
 const epoch=transport.epoch;
 if(globalThis.FanserviceNativeControls?.epoch===epoch)return;
 globalThis.FanserviceNativeControls?.revoke();
 const panel=document.createElement('details'),title=document.createElement('summary'),message=document.createElement('p'),packs=document.createElement('div'),controls=document.createElement('div');
 title.textContent='Game music, saved packs and sync';panel.append(title,message,controls,packs);library.prepend(panel);
 let current=null,closed=false,connectionForExport=null,monitor;
 const privateFields=new Set();
 const active=()=>!closed&&globalThis.FanserviceNativeTransport===transport&&transport.epoch===epoch;
 function revoke(){if(closed)return;closed=true;clearInterval(monitor);connectionForExport=null;current=null;for(const field of privateFields)field.value='';panel.replaceChildren();panel.remove();globalThis.removeEventListener('pagehide',revoke);}
 function ensure(){if(!active()){revoke();throw Error('The game connection changed. Reopen fanservice to continue.');}}
 async function request(action,payload={}){ensure();const result=await transport.request(action,payload);ensure();return result;}
 function show(value){if(active())message.textContent=String(value);else revoke();}
 const text=(tag,value)=>{const element=document.createElement(tag);element.textContent=value;return element;};
 function button(label,fn,parent=controls){const element=text('button',label);element.type='button';element.onclick=async()=>{if(!active()){revoke();return;}element.disabled=true;try{await fn();}catch(error){show(error.message);}finally{element.disabled=false;}};parent.append(element);return element;}
 function input(label,type='text'){const row=text('label',label),field=document.createElement('input');field.type=type;row.append(field);controls.append(row);return field;}
 const track=input('Server soundtrack ID','number');track.min='1';track.step='1';track.value='1';
 const syncId=input('Sync connection ID'),syncKey=input('Sync key','password');syncKey.autocomplete='off';privateFields.add(syncKey);
 function trackId(){const value=String(track.value).trim();if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Choose a positive soundtrack ID.');return Number(value);}
 function sameServer(){if(globalThis.FanserviceStore&&new URL(FanserviceStore.server()).origin!==current.server_origin)throw Error('Connect to the game’s configured Server first.');}
 show('Purchases and Enable/Disable stay in the original Unlocks menu. Delivered music plays from Playlist.');
 async function configure(connection){
  ensure();if(!crypto.subtle)throw Error('Secure sync requires HTTPS or a loopback connection.');
  const exchange=await request('synchandshake'),from64=value=>Uint8Array.from(atob(value),byte=>byte.charCodeAt(0)),to64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),peer=await crypto.subtle.importKey('raw',from64(exchange.public_key),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits=await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256),key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',bits),'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  const cleartext=new TextEncoder().encode(JSON.stringify(connection));let ciphertext;
  try{ensure();ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(exchange.handshake_token)},key,cleartext);}finally{cleartext.fill(0);}
  return request('syncconfigure',{handshake_token:exchange.handshake_token,public_key:to64(await crypto.subtle.exportKey('raw',pair.publicKey)),iv:to64(iv),ciphertext:to64(ciphertext)});
 }
 async function refresh(){
  const next=await request('companionread');
  if(!next||!Number.isSafeInteger(next.revision)||next.revision<0||!next.binding||typeof next.binding.slot!=='string'||!Array.isArray(next.packs)||next.packs.length>128||!next.snapshots||typeof next.snapshots!=='object'||Array.isArray(next.snapshots)||!next.pins||typeof next.pins!=='object'||Array.isArray(next.pins))throw Error('The saved game profile is unavailable.');
  current=next;packs.replaceChildren();packs.append(text('p',`Game profile: ${current.binding.slot}.`));
  for(const pack of current.packs){
   if(!pack||typeof pack.id!=='string'||typeof pack.name!=='string')throw Error('A saved pack is unavailable.');
   const row=document.createElement('article');row.append(text('strong',pack.name));
   button('Save pack with selected soundtrack',async()=>{const id=trackId();sameServer();show('Saving the selected media and soundtrack.');await request('snapshotdownload',{pack_id:pack.id,track_id:id,expected_revision:current.revision});await refresh();show('Saved copy ready. Existing sessions keep their current files.');},row);
   if(current.snapshots[pack.id]){
    row.append(text('p','A saved copy is available on this PC.'));
    button('Remove saved copy',async()=>{await request('snapshotdelete',{pack_id:pack.id});await refresh();show('Saved copy removed. Files used by active sessions are retained.');},row);
   }
   packs.append(row);
  }
  for(const id of Object.keys(current.pins))button('Release stopped session '+id,async()=>{if(!confirm('Release the saved files held for this stopped session? Keep them if the session is still running.'))return;ensure();await request('sessionrelease',{session_id:id});await refresh();},packs);
 }
 button('Refresh saved game profile',refresh);
 button('Save Server pack drafts',async()=>{
  if(!current)await refresh();
  sameServer();
  if(typeof profile!=='object'||!Array.isArray(profile.packs))throw Error('Open Pack drafts and load the current library first.');
  const bytes=new TextEncoder().encode(JSON.stringify(profile.packs));
  if(bytes.length<48000)await request('definitions',{expected_revision:current.revision,packs:profile.packs});
  else{
   const started=await request('definitionsbegin',{expected_revision:current.revision,bytes:bytes.length});
   for(let offset=0;offset<bytes.length;offset+=24576)await request('definitionschunk',{upload_token:started.upload_token,offset,chunk:btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576)))});
   await request('definitionscommit',{upload_token:started.upload_token});
  }
  await refresh();show('Pack drafts saved. Use the pack bridge to add their media, then purchase and enable them in original Unlocks.');
 });
 button('Deliver soundtrack to Playlist',async()=>{
  const id=trackId();if(!current)await refresh();sameServer();show('Preparing music for the original Playlist.');
  const result=await request('musicdeliver',{track_id:id,expected_revision:current.revision});
  if(typeof result?.title!=='string'||!result.title)throw Error('The game did not confirm a delivered soundtrack.');
  await refresh();show(`“${result.title}” saved. Open Start Game → Playlist → Manage. Refresh the library or restart the game to find newly delivered music.`);
 });
 button('Create sync connection',async()=>{
  const bytes=crypto.getRandomValues(new Uint8Array(32)),connection={id:crypto.randomUUID?crypto.randomUUID():'native-'+Date.now(),key:[...bytes].map(value=>value.toString(16).padStart(2,'0')).join(''),revision:0};
  await configure(connection);ensure();connectionForExport=connection;syncId.value=connection.id;syncKey.value='';await refresh();show('Sync connection created. Export it to connect another game profile.');
 });
 button('Export sync connection',async()=>{
  if(!connectionForExport)throw Error('Create or import a sync connection before exporting.');
  const area=document.createElement('textarea');area.readOnly=true;area.value=JSON.stringify({...connectionForExport,revision:current?.sync?.revision??connectionForExport.revision,kind:'fanservice-native-companion'},null,2);privateFields.add(area);area.setAttribute('aria-label','Private sync connection to copy');controls.append(area);area.select();show('Copy this private connection to the other game profile. Keep its key private.');
 });
 const importLabel=text('label','Import sync connection'),importFile=document.createElement('input');importFile.type='file';importFile.accept='application/json';privateFields.add(importFile);importLabel.append(importFile);controls.append(importLabel);
 importFile.onchange=async()=>{
  if(!active()){revoke();return;}
  try{
   const file=importFile.files[0];if(!file||file.size>10000)throw Error('Choose a sync connection JSON file smaller than 10 KB.');
   const connection=JSON.parse(await file.text());ensure();await configure({id:connection.id,key:connection.key,revision:connection.revision??0});ensure();connectionForExport=connection;syncId.value=connection.id;syncKey.value='';importFile.value='';await refresh();show('Sync connection imported. Review downloaded pack drafts before applying them.');
  }catch(error){show(error.message);}
 };
 button('Connect sync',async()=>{
  const connection={id:syncId.value.trim(),key:syncKey.value.trim(),revision:0};syncKey.value='';await configure(connection);ensure();connectionForExport=connection;await refresh();show('Sync connected. Purchases and game progress stay with the original game profile.');
 });
 button('Upload pack drafts',async()=>{if(!current)await refresh();const result=await request('syncupload',{expected_revision:current.revision});await refresh();show('Pack drafts uploaded at revision '+result.revision+'.');});
 button('Review downloaded pack drafts',async()=>{
  const preview=await request('syncpreview');if(!confirm(`Replace saved pack drafts with revision ${preview.remote_revision} (${preview.packs.length} packs)? Game purchases and progress stay unchanged.`))return;
  ensure();await request('syncapply',{preview_token:preview.preview_token,expected_revision:preview.local_revision});await refresh();show('Reviewed pack drafts applied.');
 });
 globalThis.FanserviceNativeControls={epoch,revoke};
 monitor=setInterval(()=>{if(!active())revoke();},500);globalThis.addEventListener('pagehide',revoke);
})();
