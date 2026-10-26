const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(hostname = '127.0.0.1') {
  const nodes = {}, events = {}, timers = new Map(), calls = [];
  let sequence = 0;
  const document = {hidden: false, activeElement: null, getElementById: id => nodes[id], addEventListener: (name, fn) => {events[name] = fn;}};
  for (const id of ['open', 'modal', 'start', 'cancel', 'close', 'status', 'path', 'progress']) {
    nodes[`linked-package-${id}`] = {hidden: ['open', 'modal', 'cancel', 'path', 'progress'].includes(id), disabled: false, textContent: '', events: {},
      addEventListener(name, fn) {this.events[name] = fn;}, focus() {document.activeElement = this;}};
  }
  let job = null, responder = null;
  const context = {document, location: {hostname}, AbortController,
    setTimeout: fn => {const id = ++sequence; timers.set(id, fn); return id;}, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      calls.push({url, ...options});
      if (responder) return responder(url, options);
      if (options.method === 'POST') job = {id: 'job-1', phase: 'running'};
      if (options.method === 'DELETE') job = {...job, phase: 'cancelled'};
      return {ok: true, json: async () => ({job})};
    }
  };
  vm.runInNewContext(fs.readFileSync('static/linked-packages.js', 'utf8'), context);
  const node = id => nodes[`linked-package-${id}`];
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {node, calls, timers, document, events, flush,
    async click(id) {node(id).events.click?.(); await flush();},
    setJob(value) {job = value;}, setResponder(value) {responder = value;}};
}

test('linked staging continues when closed, reconnects to the same job, and cancels explicitly', async () => {
  const h = harness();
  assert.equal(h.node('open').hidden, false);
  await h.click('open'); await h.click('start');
  assert.match(h.node('status').textContent, /Staging library/);
  assert.equal(h.node('start').disabled, true);
  await h.click('close');
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.filter(call => call.method === 'DELETE').length, 0);
  await h.click('open');
  assert.equal(h.node('cancel').hidden, false);
  await h.click('cancel');
  assert.equal(h.calls.at(-1).url, '/api/export/chpack/linked/job-1');
  assert.match(h.node('status').textContent, /cancelled/);
  assert.equal(h.node('start').disabled, false);
  assert.equal(h.node('progress').hidden, true);
});

test('late status cannot overwrite a reopened dialog and local paths are inserted as text', async () => {
  const h = harness();
  let resolveOld;
  h.setResponder(() => new Promise(resolve => {resolveOld = resolve;}));
  await h.click('open');
  await h.click('close');
  h.setResponder(null);
  h.setJob({id: 'current', phase: 'complete', path: 'C:/library/<pack>.chpack'});
  await h.click('open');
  resolveOld({ok: true, json: async () => ({job: {id: 'old', phase: 'failed', error: 'stale'}})});
  await h.flush();
  assert.match(h.node('status').textContent, /Package ready/);
  assert.equal(h.node('path').textContent, 'C:/library/<pack>.chpack');
  assert.equal(h.node('path').hidden, false);
  h.node('start').focus();
  let prevented = false;
  h.node('modal').events.keydown({key: 'Tab', preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(h.document.activeElement, h.node('close'));
});

test('remote browsers do not expose same-computer staging or request local paths', async () => {
  const h = harness('100.64.0.2');
  assert.equal(h.node('open').hidden, true);
  await h.click('open');
  assert.equal(h.calls.length, 0);
});
