'use strict';
const $ = id => document.getElementById(id);
const player = $('player');
let selected, objectUrl;
let records;
try { records = JSON.parse(localStorage.getItem('media-probe-results') || '[]'); } catch { records = []; }
function log(event, detail = '') {
  records.push({at: new Date().toISOString(), event, detail});
  records = records.slice(-300);
  try { localStorage.setItem('media-probe-results', JSON.stringify(records)); } catch {}
  $('log').textContent = records.map(r => `${r.at} ${r.event} ${r.detail}`).join('\n');
}
function show(blob) {
  player.pause(); player.removeAttribute('src'); player.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  selected = blob; objectUrl = URL.createObjectURL(blob);
  const photo = blob.type.startsWith('image/');
  $('picture').hidden = !photo; player.hidden = photo;
  if (photo) $('picture').src = objectUrl; else player.src = objectUrl;
  $('status').textContent = `Selected ${blob.size} bytes (${blob.type || 'unknown format'}). Not verified offline.`;
  log('selected', `${blob.size} bytes; ${blob.type}`); // Never log names or paths.
}
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fanservice-media-probe', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('media');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function stored(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('media', mode);
      const request = action(tx.objectStore('media'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || request.error || new Error('Storage operation failed'));
    });
  } finally { db.close(); }
}
function bind(id, action) { $(id).onclick = async () => { try { await action(); } catch (error) { $('status').textContent = error.message; log('error', `${id}: ${error.name}: ${error.message}`); } }; }
for (const id of ['files', 'photos']) $(id).onchange = event => { if (event.target.files[0]) show(event.target.files[0]); };
bind('play', async () => { await player.play(); log('play-request-accepted'); });
bind('seek', () => { if (!Number.isFinite(player.duration)) throw new Error('Wait for playable metadata'); player.currentTime = Math.min(player.duration, player.currentTime + 10); });
bind('save', async () => {
  if (!selected) throw new Error('Select media first');
  const original = selected;
  await stored('readwrite', store => store.put(original, 'selected'));
  const copy = await stored('readonly', store => store.get('selected'));
  if (!(copy instanceof Blob) || copy.size !== original.size) throw new Error('Saved copy readback failed');
  show(copy); $('status').textContent = 'Saved copy reopened from browser storage. Verify playback offline and after restart.';
  log('saved-copy-readback', `${copy.size} bytes; playback remains unverified`);
});
bind('reopen', async () => { const blob = await stored('readonly', store => store.get('selected')); if (!blob) throw new Error('No saved media: not saved, removed, or browser storage cleared/evicted'); show(blob); log('saved-copy-reopened'); });
bind('remove', async () => { await stored('readwrite', store => store.delete('selected')); player.pause(); player.removeAttribute('src'); player.load(); $('picture').removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; selected = null; $('status').textContent = 'Saved copy removed.'; log('saved-copy-removed'); });
bind('persist', async () => { if (!navigator.storage?.persist) throw new Error('Persistent storage request unavailable'); log('persistent-storage', String(await navigator.storage.persist())); });
bind('install', async () => { if (!('serviceWorker' in navigator)) throw new Error('Offline page requires a supported secure HTTPS origin'); await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; log('offline-page-ready', 'Verify airplane-mode reload on this same address'); });
for (const outcome of ['pass','fail']) bind(outcome, () => log('physical-observation', `${$('case').value}: ${outcome}`));
bind('export', () => {
  const blob = new Blob([JSON.stringify({version:1, userAgent:navigator.userAgent, secureContext:isSecureContext, records},null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download='media-feasibility.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
});
for (const event of ['loadedmetadata','playing','pause','seeking','seeked','waiting','stalled','ended','error']) player.addEventListener(event, () => log(event, player.error ? `media error ${player.error.code}` : `time ${player.currentTime.toFixed(2)}`));
document.addEventListener('visibilitychange', () => log('visibility', document.visibilityState));
window.addEventListener('online', () => log('network','online'));
window.addEventListener('offline', () => log('network','offline'));
log('opened', `secure=${isSecureContext}; online=${navigator.onLine}`);
if (navigator.storage?.estimate) navigator.storage.estimate().then(s => log('storage-estimate', JSON.stringify(s))).catch(error => log('storage-estimate-error', error.message));
