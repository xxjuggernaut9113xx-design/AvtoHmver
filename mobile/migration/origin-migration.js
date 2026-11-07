'use strict';

const chunkBytes = 192 * 1024;
const schemas = {
  'fanservice-local-v1': ['files', 'snapshots'],
  'fanservice-voices-v1': ['packs'],
};

function asBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

async function hash(bytes) {
  return asBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function stageArtifact(bridge, blob) {
  const { id } = await bridge.beginArtifact({ size: blob.size });
  const hashes = [];
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + chunkBytes).arrayBuffer());
    const digest = await hash(bytes);
    await bridge.append({ data: asBase64(bytes), hash: digest });
    hashes.push(digest);
  }
  await bridge.sealArtifact();
  return { id, size: blob.size, type: blob.type, hashes };
}

async function verifyBlob(blob, descriptor) {
  if (!(blob instanceof Blob) || blob.size !== descriptor.size
      || descriptor.hashes.length !== Math.ceil(blob.size / chunkBytes)) {
    throw Error('A saved file has an unexpected length.');
  }
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    const bytes = await blob.slice(offset, offset + chunkBytes).arrayBuffer();
    if (await hash(bytes) !== descriptor.hashes[offset / chunkBytes]) {
      throw Error('A saved file did not pass its integrity check.');
    }
  }
}

async function readArtifact(descriptor) {
  const response = await fetch('/api/_origin_migration/' + descriptor.id, { cache: 'no-store' });
  if (!response.ok) throw Error('A staged migration file is unavailable.');
  const received = await response.blob();
  const blob = received.slice(0, received.size, descriptor.type);
  await verifyBlob(blob, descriptor);
  return blob;
}

async function stageValue(bridge, value) {
  if (value instanceof File) {
    return ['file', await stageArtifact(bridge, value), value.name, value.lastModified];
  }
  if (value instanceof Blob) return ['blob', await stageArtifact(bridge, value)];
  if (value === undefined) return ['undefined'];
  if (value === null || ['boolean', 'string'].includes(typeof value) || Number.isFinite(value)) {
    return ['value', value];
  }
  if (Array.isArray(value)) {
    const entries = [];
    for (const entry of value) entries.push(await stageValue(bridge, entry));
    return ['array', entries];
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const entries = [];
    for (const [key, entry] of Object.entries(value)) {
      entries.push([key, await stageValue(bridge, entry)]);
    }
    return ['object', entries];
  }
  throw Error('Saved data contains an unsupported record. The original was kept.');
}

async function restoreValue([kind, payload, name, modified]) {
  switch (kind) {
    case 'file': return new File([await readArtifact(payload)], name, {
      type: payload.type, lastModified: modified,
    });
    case 'blob': return readArtifact(payload);
    case 'undefined': return undefined;
    case 'value': return payload;
    case 'array': {
      const values = [];
      for (const entry of payload) values.push(await restoreValue(entry));
      return values;
    }
    case 'object': {
      const values = [];
      for (const [key, entry] of payload) values.push([key, await restoreValue(entry)]);
      return Object.fromEntries(values);
    }
    default: throw Error('Invalid staged record.');
  }
}

async function verifyValue([kind, payload, name, modified], value) {
  if (kind === 'file' || kind === 'blob') {
    await verifyBlob(value, payload);
    if (value.type === payload.type && (kind === 'blob'
        || value instanceof File && value.name === name && value.lastModified === modified)) return;
  } else if (kind === 'undefined' && value === undefined || kind === 'value' && Object.is(value, payload)) {
    return;
  } else if (kind === 'array' && Array.isArray(value) && value.length === payload.length) {
    for (let index = 0; index < payload.length; index++) await verifyValue(payload[index], value[index]);
    return;
  } else if (kind === 'object' && value && Object.keys(value).length === payload.length) {
    for (const [key, entry] of payload) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) throw Error('A copied record is missing a field.');
      await verifyValue(entry, value[key]);
    }
    return;
  }
  throw Error('A copied record failed verification.');
}

function openDatabase(name, stores) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close the other Viewer+ window and retry.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function operation(database, store, method, args = [], write = false) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, write ? 'readwrite' : 'readonly', { durability: 'strict' });
    const request = tx.objectStore(store)[method](...args);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || request.error || Error('Saved-data transaction aborted.'));
  });
}

function settings() {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index);
    return [key, localStorage.getItem(key)];
  });
}

const jsonBlob = value => new Blob([JSON.stringify(value)], { type: 'application/json' });
const readJson = async artifact => JSON.parse(await (await readArtifact(artifact)).text());
function supportedKey(key) {
  if (typeof key === 'string') return true;
  if (typeof key === 'number') return Number.isFinite(key);
  return Array.isArray(key) && key.length > 0 && key.every(supportedKey);
}

async function exportOrigin(bridge) {
  await bridge.resetExport();
  const manifest = { version: 1, records: [], settings: settings() };
  for (const [name, stores] of Object.entries(schemas)) {
    const database = await openDatabase(name, stores);
    try {
      for (const store of stores) {
        for (const key of await operation(database, store, 'getAllKeys')) {
          if (!supportedKey(key)) throw Error('Unsupported saved-data key.');
          const value = await operation(database, store, 'get', [key]);
          const record = await stageValue(bridge, value);
          manifest.records.push(await stageArtifact(bridge, jsonBlob({ name, store, key, record })));
        }
      }
    } finally { database.close(); }
  }
  const artifact = await stageArtifact(bridge, jsonBlob(manifest));
  await bridge.finishExport({ id: artifact.id, manifest: JSON.stringify(artifact) });
}

async function importOrigin(bridge, state) {
  const manifest = await readJson(JSON.parse(state.manifest));
  if (manifest.version !== 1) throw Error('Unsupported saved-data migration version.');
  if (!manifest.records.length && !manifest.settings.length && !state.ownsDestination) {
    await bridge.finishImport();
    return;
  }
  const databases = {};
  try {
    let occupied = localStorage.length !== 0;
    for (const [name, stores] of Object.entries(schemas)) {
      const database = databases[name] = await openDatabase(name, stores);
      for (const store of stores) {
        if (await operation(database, store, 'count')) occupied = true;
      }
    }
    if (occupied && !state.ownsDestination) {
      throw Error('Both origins have saved Viewer+ data. The original data was kept.');
    }
    await bridge.claimDestination();
    if (state.ownsDestination) {
      for (const [name, stores] of Object.entries(schemas)) {
        for (const store of stores) await operation(databases[name], store, 'clear', [], true);
      }
      localStorage.clear();
    }
    for (const artifact of manifest.records) {
      const { name, store, key, record } = await readJson(artifact);
      if (!Object.prototype.hasOwnProperty.call(schemas, name) || !schemas[name].includes(store)) {
        throw Error('Unknown saved-data store.');
      }
      await operation(databases[name], store, 'put', [await restoreValue(record), key], true);
      await verifyValue(record, await operation(databases[name], store, 'get', [key]));
    }
    for (const [key, value] of manifest.settings) {
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw Error('A copied setting failed verification.');
    }
    await bridge.finishImport();
  } finally {
    for (const database of Object.values(databases)) database.close();
  }
}

async function runMigration(bridge, status) {
  try {
    const state = await bridge.status();
    if (state.phase === 'exporting' && location.protocol === 'https:') {
      status.textContent = 'Staging your profile, settings, media and snapshots…';
      await exportOrigin(bridge);
    } else if (state.phase === 'importing' && location.protocol === 'http:') {
      status.textContent = 'Verifying and restoring your saved Viewer+ data…';
      await importOrigin(bridge, state);
    } else {
      throw Error('Viewer+ cannot access the expected migration origin.');
    }
  } catch (error) {
    const reason = error.name === 'QuotaExceededError'
      ? 'Device storage is too low to restore saved data.' : error.message;
    status.textContent = reason + ' Opening compatibility mode…';
    await bridge.fallback({ reason });
  }
}

if (typeof document !== 'undefined') {
  const status = document.getElementById('migration-status');
  const bridge = globalThis.Capacitor?.Plugins?.OriginMigration;
  if (bridge) runMigration(bridge, status).catch(error => { status.textContent = error.message; });
  else status.textContent = 'The Android migration bridge is unavailable. Restart Viewer+ to retry.';
}
