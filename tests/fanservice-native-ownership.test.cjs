const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '../static/fanservice/app.js'), 'utf8');
const commit = app.slice(app.indexOf('async function commit(operation)'), app.indexOf('\nfunction selectionCount()'));

function setup(native) {
  const writes = [];
  const changes = [];
  const context = {
    profileReady: Promise.resolve(), profile: {packs: []}, busy: false,
    profileLocked: false, bridge: () => undefined, key: () => 'test-profile',
    model: {
      change(profile, operation) { changes.push(operation); return {...profile, last: operation.action}; },
      portableProfile: value => value
    },
    localStorage: {setItem(key, value) { writes.push({key, value}); }},
    ...(native ? {FanserviceNativeTransport: {request() { throw Error('No native mutation transport.'); }}} : {})
  };
  vm.createContext(context);
  vm.runInContext(commit, context);
  return {context, changes, writes};
}

test('embedded page cannot mutate ownership or import a portable wallet', async () => {
  const h = setup(true);
  for (const action of ['purchase', 'enable', 'sync_import']) {
    await assert.rejects(h.context.commit({action, id: 'custom:test', enabled: true}), /original game Unlocks/);
  }
  assert.equal(h.changes.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.busy, false);
});

test('embedded pack drafts remain editable without purchasing native ownership', async () => {
  const h = setup(true);
  for (const action of ['create', 'edit', 'delete']) await h.context.commit({action});
  assert.deepEqual(h.changes.map(item => item.action), ['create', 'edit', 'delete']);
  assert.equal(h.writes.length, 3);
  assert.equal(h.context.busy, false);
});

test('standalone browser keeps its existing portable purchase and enable flow', async () => {
  const h = setup(false);
  await h.context.commit({action: 'purchase', id: 'custom:test'});
  await h.context.commit({action: 'enable', id: 'custom:test', enabled: true});
  assert.deepEqual(h.changes.map(item => item.action), ['purchase', 'enable']);
  assert.equal(h.writes.length, 2);
});
