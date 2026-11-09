const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../static/fanservice/store.js'), 'utf8');
const originA = 'https://server-a.invalid';
const originB = 'https://server-b.invalid';
const bundledOrigin = 'https://localhost';
const connectionsKey = 'fanservice-servers-v1';
const handoffKey = 'fanservice_servers';

function setup({ native = false, href = `${bundledOrigin}/`, values = new Map() } = {}) {
  let pageHref = href;
  const listeners = new Map();
  const location = {
    get href() { return pageHref; },
    set href(value) { pageHref = new URL(value, pageHref).href; },
    get origin() { return new URL(pageHref).origin; }
  };
  const context = {
    URL,
    location,
    history: { state: null, replaceState(_state, _title, value) { pageHref = new URL(value, pageHref).href; } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); }
    },
    crypto: { randomUUID: () => 'test-device' },
    indexedDB: { open: () => ({}) },
    Capacitor: { isNativePlatform: () => native }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { store: context.FanserviceStore, location, listeners, values, href: () => pageHref };
}

test('native server selection stays bundled and keeps each library profile with its server across reloads', () => {
  const values = new Map([[connectionsKey, JSON.stringify({ active: originA, servers: { [originA]: null } })]]);
  const first = setup({ native: true, href: `${bundledOrigin}/`, values });
  assert.equal(first.store.server(), originA);
  first.store.rememberLibrary('library-a');
  assert.equal(first.store.selectServer(originB), `${bundledOrigin}/`);
  assert.throws(() => first.store.assertServer(), /Server connection changed/,
    'the old page cannot keep using its captured server after selection changes');

  const second = setup({ native: true, href: `${bundledOrigin}/`, values });
  assert.equal(second.store.server(), originB);
  assert.equal(second.store.savedLibrary(), null, 'a new server starts with its own empty library profile');
  second.store.rememberLibrary('library-b');
  assert.equal(second.store.selectServer(originA), `${bundledOrigin}/`);
  assert.throws(() => second.store.assertServer(), /Server connection changed/);

  const returned = setup({ native: true, href: `${bundledOrigin}/`, values });
  assert.equal(returned.store.server(), originA);
  assert.equal(returned.store.savedLibrary(), 'library-a');
  assert.deepEqual([...returned.store.savedServers()], [bundledOrigin, originA, originB]);
  assert.doesNotThrow(() => returned.store.assertServer());
  returned.listeners.get('pagehide')();
  assert.throws(() => returned.store.assertServer(), /Server connection changed/);
});

test('native handoff query cannot select an arbitrary remote server', () => {
  const values = new Map();
  const href = `${bundledOrigin}/?${handoffKey}=${encodeURIComponent(JSON.stringify([originB]))}`;
  const native = setup({ native: true, href, values });
  assert.equal(native.store.server(), bundledOrigin);
  assert.deepEqual([...native.store.savedServers()], [bundledOrigin]);
  assert.equal(new URL(native.href()).searchParams.has(handoffKey), false);
});

test('native legacy profile migrates only to the server it belonged to', () => {
  const explicitValues = new Map([
    ['fanservice-server-origin', originA],
    ['fanservice-last-library', 'legacy-library']
  ]);
  const explicit = setup({ native: true, values: explicitValues });
  assert.equal(explicit.store.server(), originA);
  assert.equal(explicit.store.savedLibrary(), null);
  assert.equal(JSON.parse(explicitValues.get(connectionsKey)).servers[bundledOrigin], 'legacy-library');

  const defaultValues = new Map([['fanservice-last-library', 'app-library']]);
  const defaultServer = setup({ native: true, values: defaultValues });
  assert.equal(defaultServer.store.server(), bundledOrigin);
  assert.equal(defaultServer.store.savedLibrary(), 'app-library');
  assert.equal(JSON.parse(defaultValues.get(connectionsKey)).servers[bundledOrigin], 'app-library');
});

test('browser server selection keeps the origin handoff behavior', () => {
  const values = new Map();
  const browser = setup({ href: `${originA}/fanservice/`, values });
  const destination = browser.store.selectServer(originB);
  const url = new URL(destination);
  assert.equal(url.origin, originB);
  assert.equal(url.pathname, '/fanservice/');
  assert.deepEqual(JSON.parse(url.searchParams.get(handoffKey)), [originA, originB]);
});

test('server selection rejects URLs that are not bare HTTP(S) origins', () => {
  const native = setup({ native: true });
  for (const value of ['javascript:alert(1)', 'https://user:pass@server.invalid', 'https://server.invalid/path']) {
    assert.throws(() => native.store.selectServer(value), /HTTP\(S\) origin/);
  }
});
