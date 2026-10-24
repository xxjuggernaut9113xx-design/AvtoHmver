const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../mod/runtime/Scripts/bridge.js'), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.open = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Unsafe HTML insertion'); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { if (name === 'open') this.open = true; this[name] = value; }
  removeAttribute(name) { if (name === 'open') this.open = false; delete this[name]; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  dispatch(name) { for (const listener of this.listeners[name] || []) listener({preventDefault() {}}); }
  click() { this.dispatch('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
function setup({pathname = '/fanservice/index.html', epoch = '123-456'} = {}) {
  const header = new Element('header');
  const body = new Element('body');
  body.append(header);
  const timers = new Map();
  const titles = [];
  let title = '';
  let timerId = 0;
  const document = {body, createElement: tag => new Element(tag), querySelector: selector => selector === 'header' ? header : null};
  Object.defineProperty(document, 'title', {get: () => title, set: value => { title = value; titles.push(value); }});
  const globalEvents = {};
  const sandbox = {document, location: {pathname}, __fanserviceNativeEpoch: epoch,
    setTimeout(callback, delay) { assert.equal(delay, 10000); timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, listener) { globalEvents[name] = listener; },
    removeEventListener(name) { delete globalEvents[name]; }};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {sandbox, document, body, header, timers, titles, globalEvents,
    get transport() { return sandbox.FanserviceNativeTransport; },
    get requestId() { return Number(document.title.split(':')[2]); },
    reply(state, id) { return this.transport.receive(id || this.requestId, {ok: true, state}); },
    reinject(epoch) { sandbox.__fanserviceNativeEpoch = epoch; vm.runInContext(source, sandbox); }};
}
function state(packs = [], unlock_points = 5) { return {unlock_points, packs}; }
function pack(overrides = {}) {
  return {id: 'fanservice-test-123', name: 'Test pack', description: 'Native pack', unlock_cost: 2,
    owned: false, enabled: false, media_count: 3, ...overrides};
}
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children) { const result = find(child, predicate); if (result) return result; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('queues read-only requests serially with numeric IDs and title cleanup', async () => {
  const h = setup();
  const first = h.transport.request('state');
  const firstId = h.requestId;
  const second = h.transport.request('state');
  assert.equal(h.document.title, `FANSERVICE_RPC:123-456:${firstId}:state:`);
  assert.equal(h.timers.size, 1);
  assert.equal(h.reply(state()), true);
  await first;
  assert.match(h.document.title, /:state:$/);
  assert.notEqual(h.requestId, firstId);
  h.reply(state([pack({owned: true})], 3));
  assert.equal((await second).unlock_points, 3);
  assert.equal(h.document.title, '');
  assert.equal(h.timers.size, 0);
});

test('bounds total queued and pending requests at sixteen', async () => {
  const h = setup();
  const requests = Array.from({length: 16}, () => h.transport.request('state'));
  const outcomes = Promise.allSettled(requests);
  await assert.rejects(h.transport.request('state'), /queue is full/);
  assert.equal(h.timers.size, 1);
  h.transport.revoke();
  assert.equal((await outcomes).filter(result => result.status === 'rejected').length, 16);
});

test('stale, unknown and nonnumeric reply IDs cannot resolve a request', async () => {
  const h = setup();
  const pending = h.transport.request('state');
  const id = h.requestId;
  for (const stale of [id + 1, String(id), '122-456-1', null]) {
    assert.equal(h.transport.receive(stale, {ok: true, state: state()}), false);
  }
  assert.equal(h.timers.size, 1);
  h.reply(state(), id);
  await pending;
  assert.equal(h.transport.receive(id, {ok: true, state: state()}), false);
});

test('timeout rejects current request and advances the queue', async () => {
  const h = setup();
  const first = h.transport.request('state');
  const rejected = assert.rejects(first, /10 seconds/);
  const id = h.requestId;
  const second = h.transport.request('state');
  [...h.timers.values()][0]();
  await rejected;
  assert.notEqual(h.requestId, id);
  assert.equal(h.transport.receive(id, {ok: true, state: state()}), false);
  h.reply(state());
  await second;
});

test('revocation cancels all requests, removes UI and rejects future work', async () => {
  const h = setup();
  const outcomes = Promise.allSettled([h.transport.request('state'), h.transport.request('state')]);
  h.transport.revoke();
  h.transport.revoke();
  assert.equal((await outcomes).every(result => result.status === 'rejected'), true);
  assert.equal(h.header.children.length, 0);
  assert.equal(h.body.children.length, 1);
  assert.equal(h.document.title, '');
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.transport.request('state'), /connection is closed/);
});

test('reinjecting with a new epoch revokes the previous connection', async () => {
  const h = setup();
  const old = h.transport;
  const rejected = assert.rejects(old.request('state'), /closed/);
  h.reinject('124-789');
  await rejected;
  assert.equal(h.header.children.length, 0);
  const pending = h.transport.request('state');
  assert.match(h.document.title, /^FANSERVICE_RPC:124-789:1:state:/);
  assert.equal(old.receive(1, {ok: true, state: state()}), false);
  h.reply(state());
  await pending;
});

test('repeated same-epoch injection preserves transport, title and increasing request IDs', async () => {
  const h = setup();
  const transport = h.transport;
  const first = transport.request('state');
  const title = h.document.title;
  h.reinject('123-456');
  assert.equal(h.transport, transport);
  assert.equal(h.document.title, title);
  assert.equal(h.header.children.length, 0);
  h.reply(state());
  await first;
  const second = transport.request('state');
  assert.equal(h.requestId, 2);
  h.reply(state());
  await second;
});

test('rejects invalid paths, epochs, request actions and malformed native state', async () => {
  assert.equal(setup({pathname: '/other/'}).transport, undefined);
  assert.equal(setup({epoch: 'unsafe:epoch'}).transport, undefined);
  const h = setup();
  await assert.rejects(h.transport.request('eval', 'anything'), /Invalid/);
  await assert.rejects(h.transport.request('purchase'), /Invalid/);
  await assert.rejects(h.transport.request('state', 'unexpected'), /Invalid/);
  for (const invalid of [state([], -1), state([pack({owned: 'true'})]), state([pack(), pack()])]) {
    const request = h.transport.request('state');
    const rejected = assert.rejects(request, /invalid pack/);
    h.reply(invalid);
    await rejected;
    assert.equal(h.document.title, '');
  }
});

test('changing epoch without reinjection revokes old requests', async () => {
  const h = setup();
  const pending = h.transport.request('state');
  const rejected = assert.rejects(pending, /closed/);
  h.sandbox.__fanserviceNativeEpoch = '999-888';
  assert.equal(h.transport.receive(h.requestId, {ok: true, state: state()}), false);
  await rejected;
  await assert.rejects(h.transport.request('state'), /closed/);
});

test('native transport adds no duplicate purchase or enable controls', async () => {
  const h = setup();
  assert.equal(h.header.children.length, 0);
  assert.equal(h.body.children.length, 1);
  for (const action of ['purchase', 'enable', 'disable']) {
    await assert.rejects(h.transport.request(action, 'fanservice-test-123'), /Invalid/);
  }
  assert.equal(h.document.title, '');
  assert.equal(h.timers.size, 0);
});

test('page close revokes read-only work without modifying native ownership', async () => {
  const h = setup();
  const pending = h.transport.request('state');
  const rejected = assert.rejects(pending, /closed/);
  const oldId = h.requestId;
  h.globalEvents.pagehide();
  await rejected;
  assert.equal(h.transport.receive(oldId, {ok: true, state: state()}), false);
  assert.equal(h.document.title, '');
  assert.equal(h.timers.size, 0);
});
