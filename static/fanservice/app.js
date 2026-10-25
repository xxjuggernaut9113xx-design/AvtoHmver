'use strict';
const $ = id => document.getElementById(id);
const model = FanserviceModel;
let libraryId, pageCursor, query = {}, items = new Map(), selected = new Set(), rules = [], profile = model.fresh(), editing = null;
let selectedLocal = new Set();
let manifests = {}, generation = 0, busy = false, profileLocked = false;
const sounds = Object.fromEntries(['click_001','confirmation_001','back_001'].map(name=>[name,new Audio('assets/'+name+'.wav')]));
document.addEventListener('click',event=>{if(event.target.closest('button')){const sound=sounds.click_001;sound.currentTime=0;sound.play().catch(()=>{});}});
function newId() { if (crypto.randomUUID) return crypto.randomUUID(); const bytes=crypto.getRandomValues(new Uint8Array(16)); return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''); }
const status = text => { $('status').textContent = text; };
function node(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function button(text, action) { const b = node('button', text); b.type = 'button'; b.onclick = () => Promise.resolve().then(action).catch(e => status(e.message)); return b; }
function key() { return 'fanservice-profile-v1:' + libraryId; }
async function api(path, params) {
  const url = new URL(path, FanserviceStore.server());
  for (const [k,v] of Object.entries(params || {})) if (v !== null && v !== undefined) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch(url,{credentials:'same-origin',signal:controller.signal});
    if (!response.ok) { let message = `Server returned ${response.status}`; try { message = (await response.json()).error || message; } catch(error) { if(controller.signal.aborted)throw error; } throw Error(message); }
    return await response.json();
  } catch(error) { if(controller.signal.aborted)throw Error('Server request timed out. Saved phone files remain available.');throw error; }
  finally { clearTimeout(timer); }
}
function bridge() { return globalThis.ue?.fanservice; }
async function loadProfile() {
  const b = bridge();
  if (b) profile = JSON.parse(await b.readprofile());
  else { const stored = localStorage.getItem(key()); profile = stored ? JSON.parse(stored) : model.fresh(); }
  if (profile.version !== 1 || !Array.isArray(profile.packs)) throw Error('Unsupported game profile; existing data retained.');
}
async function commit(operation) {
  await profileReady;
  if (globalThis.FanserviceNativeTransport && ['purchase','enable','sync_import'].includes(operation.action)) throw Error('Use the original game Unlocks menu to purchase or enable packs.');
  profileLocked=true;
  if (busy) throw Error('Wait for the current operation.'); busy = true;
  try {
    const next = model.change(profile, operation);
    if (bridge()) {
      const result = JSON.parse(await bridge().dispatch(JSON.stringify(operation)));
      if (result.error) throw Error(result.error);
      profile = result;
    } else { const saved=model.portableProfile(next);localStorage.setItem(key(), JSON.stringify(saved)); profile = saved; }
  } finally { busy = false; }
}
function selectionCount() { $('selection-count').textContent = `${selected.size + selectedLocal.size} explicit items · ${rules.length} live selections`; }
function currentQuery() { return {...query, search:$('search').value.trim() || undefined, tags:$('tags').value.trim() || undefined, media_type:$('kind').value || undefined, sort:$('sort').value}; }
async function browse(more = false) {
  const token = ++generation; status('Loading library…');
  const data = await api('/api/fanservice/v1/library', {query:currentQuery(),cursor:more ? pageCursor : null});
  if (token !== generation) return;
  if (!more) $('grid').replaceChildren();
  for (const item of data.items) {
    items.set(item.id,item);
    const tile = node('article',undefined,'tile'); const img = node('img'); img.src = new URL(item.thumbnail,FanserviceStore.server()); img.loading = 'lazy'; img.alt = ''; tile.append(img);
    const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.checked = selected.has(item.id); check.setAttribute('aria-label',`Select ${item.name}`);
    check.onchange = () => { check.checked ? selected.add(item.id) : selected.delete(item.id); selectionCount(); };
    label.append(check,document.createTextNode(item.name)); tile.append(label,node('small',`${item.type} · rating ${item.rating || 0}`),node('small',item.tags.join(', ')));
    tile.append(button('Preview',()=>{ const media = node(item.type === 'video' ? 'video' : 'img'); media.src = new URL(item.url,FanserviceStore.server()); if (item.type === 'video') media.controls = true; $('preview').replaceChildren(media); $('preview-dialog').showModal(); }));
    $('grid').append(tile);
  }
  await renderLocalMedia();
  pageCursor = data.next_cursor; $('more').hidden = !data.has_more;
  $('scope').textContent = query.source_id ? `Source ${query.source_id}` : query.group_id !== undefined ? `Group ${query.group_id}` : 'All included sources';
  status(data.items.length ? 'Select individual files or save the view as a live selection.' : 'No available media matches this view.');
}
async function organization() {
  const [groups,sources,tags] = await Promise.all([api('/api/groups'),api('/api/sources'),api('/api/tags')]);
  const list = (v,k) => Array.isArray(v) ? v : v[k] || [];
  const root = $('tree'); root.replaceChildren();
  function collection(title,rows,field) {
    root.append(node('h2',title));
    for (const row of rows) {
      const line = node('div',undefined,'organization-row');
      const caption = (row.parent_id ? `Parent ${row.parent_id} / ` : '') + (row.name || row.url || row.id);
      line.append(button(caption,async()=>{ query = field === 'tag' ? {} : {[field]:row.id}; $('tags').value = field === 'tag' ? row.name : ''; tab('library'); await browse(); }));
      if (row.group_id) line.append(node('small',`Group ${row.group_id}`)); root.append(line);
    }
  }
  collection('Groups',list(groups,'groups'),'group_id'); collection('Sources',list(sources,'sources'),'source_id'); collection('Tags',list(tags,'tags'),'tag');
}
function tab(name) { for (const t of ['library','organization']) { $(t).hidden = t !== name; $('tab-'+t).setAttribute('aria-selected',String(t === name)); } }
async function resolve(pack) {
  if (pack.library_id !== libraryId) throw Error('This pack belongs to another library.');
  if(bridge()&&pack.use_offline&&pack.snapshot)return pack.snapshot;
  if((pack.selection.ids.length||pack.selection.rules.length)&&!await serverReady)throw Error('Server unavailable for this library. Local phone files remain on this device.');
  const manifest=pack.selection.ids.length || pack.selection.rules.length ? await api('/api/fanservice/v1/resolve',{selection:{ids:pack.selection.ids,rules:pack.selection.rules}}) : {library_id:libraryId,media:[]};
  const local=await FanserviceStore.resolveLocal(pack.selection,pack.device_id);
  return {...manifest,media:[...manifest.media,...local.media],local_unavailable:local.unavailable};
}
async function openCreate(pack) {
  await profileReady;
  profileLocked=true;
  $('pack-error').textContent='';
  editing = pack || null;
  const selection = pack ? pack.selection : {ids:[...selected],rules,local_ids:[...selectedLocal]};
  const manifest = await resolve(pack||{library_id:libraryId,device_id:FanserviceStore.device,selection});
  if (!manifest.media.length) throw Error('Select available media before creating a pack.');
  $('pack-title').textContent = pack ? 'Edit Pack' : 'Create Pack';
  $('pack-name').value = pack?.name || ''; $('pack-description').value = pack?.description || '';
  $('access').value = pack?.unlock_cost ? 'priced' : 'immediate'; $('price').value = pack?.unlock_cost || 5;
  $('price-label').hidden = $('access').value !== 'priced';
  $('review').textContent = `${manifest.media.length} available items now · live rules refresh before new sessions.`;
  $('cover').replaceChildren(new Option('Generated cover',''));
  for (const m of manifest.media.filter(m=>m.type==='image' && !m.local)) $('cover').add(new Option(m.name,String(m.id)));
  $('cover').value = pack?.cover_id || '';
  $('pack-dialog')._selection = JSON.parse(JSON.stringify(selection)); $('pack-dialog').showModal();
  reviewSelection();
}
function reviewSelection() {
  const selection=$('pack-dialog')._selection;const root=$('pack-selection-review');root.replaceChildren();
  root.append(node('p',`${selection.ids.length} Server items · ${selection.local_ids?.length||0} device-local items`));
  selection.rules.forEach((rule,index)=>{
    const label=Object.entries(rule).filter(([,v])=>v!==undefined && v!=='').map(([k,v])=>({source_id:'Source',group_id:'Group',tag:'Tag',tags:'Tags',search:'Search',media_type:'Media type'}[k]||k)+': '+v).join(' · ')||'All included library media';
    const row=node('div',undefined,'toolbar');row.append(node('span','Live: '+label),button('Remove selection',()=>{selection.rules.splice(index,1);reviewSelection();}));root.append(row);
  });
}
$('use-selection').onclick=async()=>{
  const selection={ids:[...selected],rules:JSON.parse(JSON.stringify(rules)),local_ids:[...selectedLocal]};
  try {
    const manifest=await resolve({library_id:libraryId,device_id:FanserviceStore.device,selection});if(!manifest.media.length)throw Error('The current library selection is empty.');
    $('pack-dialog')._selection=selection;reviewSelection();$('review').textContent=`${manifest.media.length} available items now · live rules refresh before new sessions.`;
  }catch(error){$('pack-error').textContent=error.message;}
};
async function showUnlocks() {
  await profileReady;
  profileLocked=true;
  await loadProfile();
  const native = !!globalThis.FanserviceNativeTransport;
  $('unlocks-dialog').querySelector('h2').textContent = native ? 'Pack drafts' : 'Unlocks';
  $('balance').textContent = native ? 'Saved pack drafts · export and install, then use the original game Unlocks menu.' : `${profile.unlock_points} UP · custom game packs`;
  $('soundtrack').closest('.toolbar').hidden = native;
  $('sync-id').closest('details').hidden = native;
  $('packs').replaceChildren(); if (!$('unlocks-dialog').open) $('unlocks-dialog').showModal();
  for (const pack of profile.packs) {
    const row = node('article',undefined,'pack');
    const cover=node('img');cover.src=pack.cover_id ? new URL(`/api/thumb/${pack.cover_id}`,FanserviceStore.server()) : 'assets/pack-cover.svg';cover.alt='';cover.width=72;cover.height=72;cover.onerror=()=>{cover.onerror=null;cover.src='assets/pack-cover.svg';};
    row.append(cover,node('h3',pack.name+' · Custom'),node('p',pack.description));
    const availability = node('p','Resolving live selection…'); row.append(availability); const actions = node('div',undefined,'toolbar'); row.append(actions); $('packs').append(row);
    let manifest;
    try { manifest = await resolve(pack); manifests[pack.id] = manifest; availability.textContent = native ? `${manifest.media.length} available · ${pack.unlock_cost} native UP · Draft` : `${manifest.media.length} available · ${pack.owned ? 'Owned' : `${pack.unlock_cost} UP`} · ${pack.enabled ? 'Enabled' : 'Disabled'}`; }
    catch (error) { availability.textContent = 'Unavailable: '+error.message; }
    actions.append(button('Export .chpack',()=>exportPack(pack)));
    if (!native) {
    const available = model.available(pack,manifest);
    const action = button(pack.owned ? pack.enabled ? 'Disable' : 'Enable' : `Unlock (${pack.unlock_cost} UP)`,async()=>{
      const fresh = pack.owned && pack.enabled ? undefined : await resolve(pack);
      await commit(pack.owned ? {action:'enable',id:pack.id,enabled:!pack.enabled,manifest:fresh} : {action:'purchase',id:pack.id,manifest:fresh}); await showUnlocks();
    }); action.disabled = !available && !pack.enabled; actions.append(action);
    }
    actions.append(button('Edit',()=>openCreate(pack)),button('Delete',async()=>{ if (confirm(`Delete custom pack "${pack.name}"? Library media will be kept.`)) { await commit({action:'delete',id:pack.id}); await showUnlocks(); } }));
  }
}
for (const name of ['library','organization']) $('tab-'+name).onclick = () => { tab(name); if (name==='organization') organization().catch(e=>status(e.message)); };
$('filters').onsubmit = e => { e.preventDefault(); browse().catch(e=>status(e.message)); };
$('more').onclick = ()=>browse(true).catch(e=>status(e.message));
$('clear-scope').onclick = ()=>{query={};browse().catch(e=>status(e.message));};
$('live').onclick = ()=>{const q=currentQuery();delete q.sort;const encoded=JSON.stringify(q);if(!rules.some(r=>JSON.stringify(r)===encoded))rules.push(q);selectionCount();status('Live selection added. Matching library additions will join the pack.');};
$('clear-selection').onclick = ()=>{selected.clear();selectedLocal.clear();rules=[];selectionCount();browse().catch(e=>status(e.message));};
$('create').onclick = ()=>openCreate().catch(e=>status(e.message));
$('access').onchange = ()=>$('price-label').hidden = $('access').value!=='priced';
$('unlocks').onclick = ()=>showUnlocks().catch(e=>status(e.message));
for (const b of document.querySelectorAll('[data-close]')) b.onclick=()=>{const d=$(b.dataset.close);d.close();if(d.id==='preview-dialog')$('preview').replaceChildren();};
$('preview-dialog').addEventListener('close',()=>$('preview').replaceChildren());
$('pack-form').onsubmit = async e => {
  e.preventDefault(); $('save-pack').disabled=true;
  try {
    const pack={id:editing?.id || 'custom:'+newId(),name:$('pack-name').value.trim(),description:$('pack-description').value,cover_id:Number($('cover').value)||null,
      unlock_cost:$('access').value==='priced' ? Number($('price').value) : 0,library_id:libraryId,server_url:FanserviceStore.server(),device_id:FanserviceStore.device,selection:$('pack-dialog')._selection};
    if ($('access').value==='priced' && pack.unlock_cost<=0) throw Error('Enter a positive whole-number UP price.');
    const manifest=await resolve(pack);
    await commit(editing ? {action:'edit',id:editing.id,pack,manifest} : {action:'create',pack,manifest});
    $('pack-dialog').close();status(globalThis.FanserviceNativeTransport ? 'Pack draft saved. Export and install it for the original Unlocks menu.' : 'Custom pack saved to Unlocks.');await showUnlocks();
  } catch(error) {status(error.message);$('pack-error').textContent=error.message;} finally {$('save-pack').disabled=false;}
};
const profileReady=(async()=>{if(document.readyState!=='complete')await new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));libraryId=localStorage.getItem('fanservice-last-library')||'device:'+FanserviceStore.device;await loadProfile();await renderLocalMedia();$('connection').textContent='Saved phone media · library '+libraryId;})();
profileReady.catch(error=>status(error.message));
const serverReady=profileReady.then(async()=>{try{const caps=await api('/api/fanservice/v1/capabilities');if(typeof caps.library_id!=='string'||!caps.library_id)throw Error('Server returned an invalid library identity.');if(caps.library_id!==libraryId){if(profileLocked){status('Connected to a different library. Reload to switch libraries; saved phone media and the current profile were retained.');return false;}libraryId=caps.library_id;localStorage.setItem('fanservice-last-library',libraryId);await loadProfile();}$('connection').textContent=location.host+' · library '+libraryId;await browse();return true;}catch(error){status('Server unavailable: '+error.message+'. Local files and explicitly downloaded snapshots remain available.');return false;}},()=>false);
