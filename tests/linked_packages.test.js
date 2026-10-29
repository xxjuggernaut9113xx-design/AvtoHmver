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

test('a status poll started before staging cannot replace the new job', async () => {
  const h = harness();
  let resolvePoll;
  h.setResponder((url, options) => options.method === 'POST'
    ? Promise.resolve({ok: true, json: async () => ({job: {id: 'new', phase: 'running'}})})
    : new Promise(resolve => {resolvePoll = resolve;}));
  await h.click('open');
  await h.click('start');
  resolvePoll({ok: true, json: async () => ({job: null})});
  await h.flush();
  assert.match(h.node('status').textContent, /Staging library/);
  assert.equal(h.node('start').disabled, true);
  assert.equal(h.node('cancel').hidden, false);
});

test('remote browsers do not expose same-computer staging or request local paths', async () => {
  const h = harness('100.64.0.2');
  assert.equal(h.node('open').hidden, true);
  await h.click('open');
  assert.equal(h.calls.length, 0);
});

test('Organization exposes working transfer actions and limits linked staging to this computer', () => {
  const source = fs.readFileSync('static/library.js', 'utf8');
  const render = source.slice(source.indexOf('function renderGroupsPanel('), source.indexOf('async function reviewSourceTag('));
  for (const hostname of ['127.0.0.1', '100.64.0.2']) {
    const calls = [];
    const node = () => ({children: [], events: {}, classList: {add() {}},
      append(...items) {this.children.push(...items);}, replaceChildren(...items) {this.children = items;},
      addEventListener(name, fn) {this.events[name] = fn;}});
    const panel = node();
    const context = {location: {hostname}, document: {createElement: node}, state: {groups: []},
      makePanelHeading: node, panelButton(label) {return {...node(), label};},
      explorerEl(target) {return {click() {calls.push(target);}};}};
    vm.createContext(context); vm.runInContext(render, context);
    context.renderGroupsPanel(panel);
    const actions = panel.children.flatMap(item => item.children);
    for (const action of actions) action.events.click();
    assert.deepEqual(calls, ['#export-btn', '#import-trigger-btn', '#chpack-export-btn',
      ...(hostname === '127.0.0.1' ? ['#linked-package-open'] : [])]);
  }
});
