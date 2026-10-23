(function (root) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  function fresh() { return { version: 1, packs: [], unlock_points: 0 }; }
  function validate(pack) {
    if (!pack || typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 120) throw Error('Enter a pack name (1–120 characters).');
    if (typeof pack.library_id !== 'string' || !pack.library_id) throw Error('Connect to a library first.');
    if (!pack.selection || !Array.isArray(pack.selection.ids) || !Array.isArray(pack.selection.rules)) throw Error('Invalid selection.');
    if (!pack.selection.ids.length && !pack.selection.rules.length && !pack.selection.local_ids?.length) throw Error('Select media or add a live selection.');
    if (pack.selection.local_ids && (!Array.isArray(pack.selection.local_ids) || pack.selection.local_ids.length>500 || pack.selection.local_ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)))) throw Error('Invalid device-local selection.');
    if (pack.selection.ids.length > 500 || pack.selection.rules.length > 32) throw Error('Selection is too large.');
    if (pack.selection.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('Invalid media ID.');
    if (!Number.isSafeInteger(pack.unlock_cost) || pack.unlock_cost < 0 || pack.unlock_cost > 2147483647) throw Error('Unlock price must be a whole number of UP.');
    if (typeof pack.description !== 'string' || pack.description.length > 2000) throw Error('Description is too long.');
  }
  function available(pack, manifest) {
    return manifest && manifest.library_id === pack.library_id && Array.isArray(manifest.media) && manifest.media.length > 0;
  }
  function change(profile, operation) {
    const next = copy(profile);
    if (next.version !== 1 || !Array.isArray(next.packs) || !Number.isSafeInteger(next.unlock_points) || next.unlock_points < 0) throw Error('Invalid profile.');
    if (operation.action === 'create') {
      if(next.packs.length>=128)throw Error('A profile can contain at most 128 custom packs.');
      const pack = copy(operation.pack); validate(pack);
      if (typeof pack.id !== 'string' || !/^custom:[a-zA-Z0-9-]{1,80}$/.test(pack.id) || next.packs.some(p => p.id === pack.id)) throw Error('Invalid or duplicate pack identity.');
      if (!available(pack, operation.manifest)) throw Error('The selection has no available playable media.');
      pack.owned = pack.unlock_cost === 0; pack.enabled = false;
      delete pack.manifest;
      next.packs.push(pack);
    } else {
      const pack = next.packs.find(p => p.id === operation.id);
      if (!pack) throw Error('Pack not found.');
      if (operation.action === 'purchase') {
        if (pack.owned) return next;
        if (!available(pack, operation.manifest)) throw Error('Resolve available media before purchasing.');
        if (next.unlock_points < pack.unlock_cost) throw Error('Not enough Unlock Points.');
        next.unlock_points -= pack.unlock_cost; pack.owned = true; pack.enabled = true;
      } else if (operation.action === 'enable') {
        if (!pack.owned) throw Error('Unlock this pack first.');
        if (operation.enabled && !available(pack, operation.manifest)) throw Error('This pack has no available media.');
        pack.enabled = !!operation.enabled;
      } else if (operation.action === 'edit') {
        const edit = copy(operation.pack); validate(edit);
        if (edit.library_id !== pack.library_id) throw Error('Create a new pack for a different library.');
        Object.assign(pack, { name: edit.name.trim(), description: edit.description, selection: edit.selection, cover_id: edit.cover_id, unlock_cost: edit.unlock_cost, device_id:edit.device_id });
      } else if (operation.action === 'delete') {
        next.packs = next.packs.filter(p => p.id !== operation.id);
      } else throw Error('Unknown profile operation.');
    }
    return next;
  }
  function freezeSession(profile, manifests) {
    const seen = new Set(); const media = [];
    for (const pack of profile.packs.filter(p => p.owned && p.enabled)) {
      const manifest = manifests[pack.id];
      if (!available(pack, manifest)) throw Error(`Pack unavailable: ${pack.name}`);
      for (const item of manifest.media) {
        const key = pack.library_id + ':' + item.id;
        if (!seen.has(key)) { seen.add(key); media.push(copy(item)); }
      }
    }
    if (!media.length) throw Error('Enable a pack with available media.');
    return copy({ media });
  }
  function portableProfile(profile) { const result=copy(profile);delete result.snapshot_status;for(const pack of result.packs){delete pack.manifest;delete pack.snapshot;delete pack.use_offline;}return result; }
  const api = { fresh, change, validate, available, freezeSession, portableProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FanserviceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
