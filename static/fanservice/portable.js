'use strict';
const store=FanserviceStore;
const archiveInput=$('archive-file'),archiveButton=$('archive-import');
archiveButton.onclick=async()=>{
 let added=[];
 archiveButton.disabled=true;
 try {
  await profileReady;
  profileLocked=true;
  if(bridge())throw Error('Use the original game pack importer.');
  const file=archiveInput.files[0];
  if(!file)throw Error('Choose a saved pack from Files.');
  status('Checking pack integrity…');
  const {manifest,files,coverIndex,preview}=await FanserviceChpack.unpack(file);
  const candidate={
   id:'custom:'+newId(),name:manifest.name,description:manifest.description,
   author:typeof manifest.author==='string'?manifest.author:undefined,
   unlock_cost:manifest.unlock_cost,library_id:libraryId,device_id:store.device,
   selection:{ids:[],rules:[],local_ids:['validation']},
  };
  model.validate(candidate);
  if(profile.packs.length>=128)throw Error('A profile can contain at most 128 custom packs.');
  added=await store.importFiles(files);
  if(preview){
   added[0].archivePreview=preview;
   candidate.preview_local_id=added[0].id;
  }
  for(const record of added){
   record.tags=record.name.replace(/\.[^.]+$/,'').split('_').slice(1).filter(Boolean);
   await store.put('files',record.id,record);
  }
  candidate.selection.local_ids=added.map(record=>record.id);
  if(coverIndex>=0)candidate.cover_id='local:'+added[coverIndex].id;
  await commit({action:'create',pack:candidate,manifest:{library_id:libraryId,media:added.map(record=>({id:'local:'+record.id}))}});
  added=[];
  archiveInput.value='';
  await renderLocalMedia();
  await showUnlocks();
  status('Pack imported with local media. Enable it in Unlocks.');
 }catch(error){
  for(const record of added)await store.remove('files',record.id).catch(()=>{});
  status('Pack import failed: '+error.message);
 }finally{archiveButton.disabled=false;}
};
$('preview-dialog').addEventListener('close',()=>{for(const media of $('preview').querySelectorAll('video,audio'))media.pause();$('preview').replaceChildren();});
const localPoolChoices=node('details');localPoolChoices.append(node('summary','Gameplay pools for selected phone files'),node('p','Reuse these files in the checked gameplay pools. This choice stays on this device and does not edit the Server library.'));
for(const pool of ['slow','medium','fast','succubus','cum','ass','boobs']){const label=node('label'),input=node('input');input.type='checkbox';input.name='local-pool';input.value=pool;input.checked=true;label.append(input,document.createTextNode(pool));localPoolChoices.append(label);}$('local-controls').append(localPoolChoices);
async function renderLocalMedia(){
 if(bridge()){$('local-controls').hidden=true;return;}
 for(const old of document.querySelectorAll('[data-local-tile]')){if(old._url)URL.revokeObjectURL(old._url);old.remove();}
 for(const file of await store.localFiles()){
  const tile=node('article',undefined,'tile');tile.dataset.localTile=file.id;const url=URL.createObjectURL(file.blob);tile._url=url;
  const img=node(file.type==='video'?'video':'img');img.src=url;img.preload='metadata';img.alt='';tile.append(img);
  const label=node('label'),check=node('input');check.type='checkbox';check.checked=selectedLocal.has(file.id);check.setAttribute('aria-label',`Select local ${file.name}`);check.onchange=()=>{check.checked?selectedLocal.add(file.id):selectedLocal.delete(file.id);selectionCount();};label.append(check,document.createTextNode(file.name));tile.append(label,node('small','Device-local · never uploaded'));
  tile.append(button('Preview',()=>{const media=node(file.type==='video'?'video':'img'),result=node('p','Reading saved media.');result.setAttribute('role','status');FanserviceMedia.observe(media,text=>result.textContent=text);if(file.type==='video'){media.controls=true;media.playsInline=true;media.preload='auto';}media.src=url;$('preview').replaceChildren(media,result);$('preview-dialog').showModal();}),button('Remove local copy',async()=>{await store.remove('files',file.id);selectedLocal.delete(file.id);selectionCount();await renderLocalMedia();}));$('grid').append(tile);
 }
}
$('local-import').onclick=async()=>{try{const pools=[...document.querySelectorAll('input[name="local-pool"]:checked')].map(input=>input.value);if(!pools.length)throw Error('Choose at least one gameplay pool for these phone files');const added=await store.importFiles($('local-files').files,pools);for(const f of added)selectedLocal.add(f.id);$('local-files').value='';selectionCount();await renderLocalMedia();status('Selected media and its gameplay-pool choices are saved only on this device.');}catch(e){status(e.message);}};
$('connection-setup').onclick=()=>{
 const list=$('saved-servers');
 list.replaceChildren(...store.savedServers().map(origin=>new Option(origin===location.origin?'Local Host · '+origin:origin,origin)));
 list.value=store.server();
 $('server-origin').value=store.server();
 $('connection-status').textContent='';
 $('connection-dialog').showModal();
};
function openServer(value){
 try{
  location.assign(store.selectServer(value));
 }catch(error){$('connection-status').textContent=error.message;}
}
$('connect-server').onclick=()=>openServer($('server-origin').value);
$('select-server').onclick=()=>openServer($('saved-servers').value);
async function refreshMusic(){const selectedTrack=$('soundtrack').value;const data=await api('/api/music/tracks');$('soundtrack').replaceChildren(new Option('Classic · no soundtrack','0'),...data.tracks.map(t=>new Option(t.title,String(t.id))));$('soundtrack').value=selectedTrack||'0';}
$('refresh-music').onclick=()=>refreshMusic().catch(e=>status(e.message));
$('play-session').onclick=async()=>{try{if(globalThis.FanserviceNativeTransport)throw Error('Use Back and start playback from the original game menu.');if(!profile.packs.some(p=>p.owned&&p.enabled))throw Error('Enable an available pack first.');const track=Number($('soundtrack').value);if(bridge()){if(!track)throw Error('Close import and choose Classic from the game menu, or select a soundtrack here.');const result=JSON.parse(await bridge().dispatch(JSON.stringify({action:'play_music',server_url:store.server(),track_id:track})));if(result.error)throw Error(result.error);status('Preparing soundtrack session…');}else location.href=`play.html?library=${encodeURIComponent(libraryId)}&track=${track}`;}catch(e){status(e.message);}};
let syncRevision=0;
function syncSettings(){const raw=localStorage.getItem('fanservice-sync:'+(bridge()?profile.profile_id:libraryId));return raw?JSON.parse(raw):{id:'',key:'',revision:0};}
function saveSync(){const data={id:$('sync-id').value.trim(),key:$('sync-key').value.trim(),revision:syncRevision};localStorage.setItem('fanservice-sync:'+(bridge()?profile.profile_id:libraryId),JSON.stringify(data));return data;}
function fillSync(){const c=syncSettings();$('sync-id').value=c.id;$('sync-key').value=c.key;syncRevision=c.revision;}
const profileSync=new FanserviceProfileSync.Transport({binding:()=>({server:store.server(),identity:bridge()?profile.profile_id:libraryId,id:$('sync-id').value.trim(),key:$('sync-key').value.trim(),revision:syncRevision,profile:JSON.stringify(profile),stored:localStorage.getItem(key())})});
async function syncRequest(method,body){if(globalThis.FanserviceNativeTransport)throw Error('Profile sync is not available in the original game adapter.');saveSync();return profileSync.request(method,body);}
function assertProfileStored(binding){if(bridge())return;const persisted=localStorage.getItem(key());if(!persisted&&profile.version===1&&profile.packs.length===0)return;if(persisted!==JSON.stringify(profile))throw Error('This device profile changed in another tab. Reload it before reviewing or applying sync; local work was preserved.');}
$('sync-new').onclick=()=>{$('sync-id').value=store.id();$('sync-key').value=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');syncRevision=0;saveSync();status('New sync identity created. Export its connection to another device explicitly.');};
$('sync-upload').onclick=async()=>{try{const portable=FanserviceProfileSync.portableProfile(profile);const {data,binding}=await syncRequest('PUT',{expected_revision:syncRevision,profile:portable});profileSync.assertCurrent(binding);syncRevision=data.revision;saveSync();status('Portable pack definitions synchronized. UP, ownership, enablement, local files and snapshots stayed on this device.');}catch(e){status(e.message);}};
let reviewedSync=null;
function validSyncProfile(value){if(value?.version!==1||!Array.isArray(value.packs)||value.packs.length>128)throw Error('Unsupported remote profile.');const ids=new Set(),packs=[];for(const incoming of value.packs){const pack=FanserviceProfileSync.portablePack(incoming);if(!pack)continue;model.validate(pack);if(typeof pack.id!=='string'||!/^custom:[a-zA-Z0-9-]{1,80}$/.test(pack.id)||ids.has(pack.id))throw Error('Remote profile contains an invalid or duplicate pack identity.');ids.add(pack.id);packs.push(pack);}return {version:1,unlock_points:0,packs};}
function renderSyncReview(review){
 const root=$('sync-review-packs'),diffs=FanserviceProfileSync.diff(profile,review.profile);review.differences=diffs;root.replaceChildren();$('sync-review-error').textContent='';
 $('sync-review-summary').textContent=diffs.length?`${diffs.length} pack difference(s) at remote revision ${review.revision}. Choose which definition to keep for each difference. UP, ownership, enablement, phone files and snapshots remain local.`:`No pack differences at remote revision ${review.revision}. Applying will only update the reviewed sync revision.`;
 for(const item of diffs){const section=node('section',undefined,'sync-review-pack'),title=node('h3',item.local?.name||item.remote?.name||item.id),detail=node('p');
  detail.textContent=item.kind==='changed'?'Both devices have this pack with different definitions.':item.kind==='local-only'?'This pack exists only on this device.': 'This pack exists only in the downloaded profile.';
  const describe=pack=>pack?`${pack.name} · ${pack.selection.ids.length} fixed items · ${pack.selection.rules.length} live rules · ${pack.unlock_cost} UP`: 'Pack absent';
  const versions=node('ul');versions.append(node('li','This device: '+describe(item.local)),node('li','Downloaded: '+describe(item.remote)));
  const label=node('label','Keep for this device'),select=node('select');select.dataset.packId=item.id;select.add(new Option('Choose a version…',''));
  if(item.local)select.add(new Option('This device version','local'));
  if(item.remote)select.add(new Option('Downloaded version','remote'));
  if(item.local&&!item.remote)select.add(new Option('Remove this pack','remove'));
  if(item.remote&&!item.local)select.add(new Option('Skip this pack','skip'));
  label.append(select);section.append(title,detail,versions,label);root.append(section);
 }
 reviewedSync=review;$('sync-review-dialog').showModal();
}
$('sync-download').onclick=async()=>{try{const {data,binding}=await syncRequest('GET');validSyncProfile(data.profile);profileSync.assertCurrent(binding);assertProfileStored(binding);renderSyncReview({revision:data.revision,profile:data.profile,binding});}catch(e){status(e.message);}};
$('sync-apply').onclick=async()=>{const review=reviewedSync;if(!review)return;const choices={};for(const select of $('sync-review-packs').querySelectorAll('select[data-pack-id]'))choices[select.dataset.packId]=select.value;
 try{$('sync-apply').disabled=true;profileSync.assertCurrent(review.binding);assertProfileStored(review.binding);const latest=await syncRequest('GET');validSyncProfile(latest.data.profile);profileSync.assertCurrent(review.binding);assertProfileStored(review.binding);if(latest.data.revision!==review.revision){reviewedSync=null;$('sync-review-dialog').close();status(`The remote profile changed from revision ${review.revision} to ${latest.data.revision} while you reviewed it. Your local profile was preserved; review the new revision.`);return;}
  const merged=FanserviceProfileSync.applyChoices(profile,review.profile,review.differences,choices);for(const pack of merged.packs)model.validate(pack);profileSync.assertCurrent(review.binding);
  if(bridge()){const result=JSON.parse(await bridge().dispatch(JSON.stringify({action:'sync_import',profile:merged})));if(result.error)throw Error(result.error);profileSync.assertCurrent(review.binding);profile=result;}
  else{const saved=model.portableProfile(merged);localStorage.setItem(key(),JSON.stringify(saved));profile=saved;}
  syncRevision=review.revision;saveSync();reviewedSync=null;$('sync-review-dialog').close();await showUnlocks();status('Reviewed pack choices applied at revision '+syncRevision+'. Local UP, ownership, enablement, files and snapshots were preserved.');
 }catch(e){$('sync-review-error').textContent=e.message;}finally{$('sync-apply').disabled=false;}
};
$('sync-export').onclick=()=>{const blob=new Blob([JSON.stringify(saveSync(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='fanservice-sync-connection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('sync-import').onchange=async()=>{try{const file=$('sync-import').files[0];if(!file||file.size>10000)throw Error('Select a small sync connection JSON file.');const c=JSON.parse(await file.text());if(!/^[a-zA-Z0-9-]{1,80}$/.test(c.id)||!/^[a-fA-F0-9]{64}$/.test(c.key))throw Error('Invalid sync connection.');$('sync-id').value=c.id;$('sync-key').value=c.key;syncRevision=Number.isSafeInteger(c.revision)&&c.revision>=0?c.revision:0;saveSync();status('Sync connection imported; no profile was overwritten.');}catch(e){status(e.message);}};
const baseUnlocks=showUnlocks;
showUnlocks=async()=>{await baseUnlocks();if(globalThis.FanserviceNativeTransport)return;fillSync();await refreshMusic().catch(()=>{});const rows=[...$('packs').querySelectorAll('.pack')];for(let i=0;i<rows.length;i++){const pack=profile.packs[i],row=rows[i],actions=row.querySelector('.toolbar');const local=pack.selection.local_ids?.length||0;if(local)row.append(node('small',`${local} device-local members · ${pack.device_id===store.device?'this device':'unavailable on this device'}`));if(bridge()&&pack.owned){
 const send=async operation=>{const result=JSON.parse(await bridge().dispatch(JSON.stringify(operation)));if(result.error)throw Error(result.error);profile=result;status(result.snapshot_status||'Snapshot mode updated.');};
 actions.append(button('Download snapshot',async()=>{await send({action:'snapshot_download',id:pack.id,track_id:Number($('soundtrack').value)});}),button(pack.use_offline?'Use live Server contents':'Use saved snapshot',async()=>{await send({action:'snapshot_mode',id:pack.id,offline:!pack.use_offline});await showUnlocks();}),button('Download status',async()=>{await loadProfile();status(profile.snapshot_status||'No download is running.');}));
 if(pack.snapshot?.music)actions.append(button('Play saved soundtrack',async()=>{await send({action:'play_snapshot',id:pack.id});}));actions.append(button('Delete saved snapshot',async()=>{await send({action:'snapshot_delete',id:pack.id});await showUnlocks();}));
 if(pack.snapshot)row.append(node('small',`Saved snapshot ${pack.snapshot.saved_at} · ${pack.use_offline?'selected for playback':'live Server contents selected'}`));
 }else if(!bridge()&&pack.owned){actions.append(button('Download snapshot',async()=>{status('Downloading explicit offline snapshot…');const manifest=await resolve(pack),track=Number($('soundtrack').value),music=track?await api(`/api/fanservice/v1/music/${track}/manifest`):null;const saved=await store.download(pack,manifest,store.server(),music,store.assertServer);status(`Snapshot saved ${saved.saved_at}. Refresh only by downloading again.`);}),button('Play saved snapshot',()=>{location.href=`play.html?library=${encodeURIComponent(libraryId)}&snapshot=${encodeURIComponent(pack.id)}`;}),button('Delete saved snapshot',async()=>{await store.deleteSnapshot(pack.library_id,pack.id);status('Downloaded snapshot removed; library media and ownership retained.');}));}}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
