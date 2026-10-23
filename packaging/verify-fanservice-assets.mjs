import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('../static/fanservice/assets/', import.meta.url);
const entries = JSON.parse(readFileSync(new URL('provenance.json', root)));
assert(entries.length > 0, 'Asset provenance must not be empty');
const names = new Set();
for (const entry of entries) {
  assert(/^[\w.-]+$/.test(entry.file), 'Unsafe asset filename');
  assert(!names.has(entry.file), `Duplicate asset: ${entry.file}`);
  names.add(entry.file);
  assert(entry.license, `Missing license: ${entry.file}`);
  const hash = createHash('sha256').update(readFileSync(new URL(entry.file, root))).digest('hex');
  assert.equal(hash, entry.sha256, `Asset checksum mismatch: ${entry.file}`);
}
for (const entry of entries) {
  if (entry.derived_from) assert(names.has(entry.derived_from), `Missing original: ${entry.file}`);
}
for (const name of ['ui-pack-LICENSE.txt', 'interface-sounds-LICENSE.txt', 'game-icons-LICENSE.txt', 'Rajdhani-LICENSE.txt', 'Orbitron-LICENSE.txt', 'fanservice-original-LICENSE.txt']) {
  assert(readFileSync(new URL(name, root), 'utf8').trim(), `Empty license: ${name}`);
}
console.log(`Verified ${entries.length} fanservice assets and bundled licenses.`);
