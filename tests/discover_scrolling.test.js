const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser(api) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.hidden = false; this.isConnected = true; this.scrollTop = 0; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    addEventListener(name, handler) { this.events[name] = handler; }
    find(id) { if (this.id === id) return this; for (const child of this.children) { const found = child.find(id); if (found) return found; } }
  }
  const panel = new Node('section'); panel.id = 'explorer-panel';
  for (const id of ['discover-query', 'discover-status', 'discover-selection-count', 'discover-select-all']) { const node = new Node('input'); node.id = id; node.value = id === 'discover-query' ? 'sample' : ''; panel.append(node); }
  const explorer = { nav: 'search', searchResults: [], searchSelected: new Set(), searchGeneration: 0, searchPending: false, searchCursor: null, searchErrors: [] };
  const context = vm.createContext({ explorer, api, URLSearchParams, Set,
    document: { createElement: tag => new Node(tag) },
    explorerEl: (selector, root = panel) => root.find(selector.slice(1)), explorerAll: () => [],
    panelButton: text => { const node = new Node('button'); node.textContent = text; return node; },
    formatBytes: value => `${value} B`, formatDate: value => value,
    IntersectionObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
  });
  const source = fs.readFileSync('static/library.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('function normalizeSearchResult('), source.indexOf('function previewSearchResult(')), context);
  return { panel, explorer, run: code => vm.runInContext(code, context) };
}

test('Discover appends once, keeps selected rows and scroll, and reports known and unknown totals', async () => {
  const calls = [];
  const app = browser(async url => {
    calls.push(url);
    if (url.includes('cursor=')) { await new Promise(resolve => setTimeout(resolve, 5)); return { results: [{ title: 'Second', item_count: null, total_bytes: null }], next_cursor: null }; }
    return { results: [{ title: 'First', item_count: 2, total_bytes: 1024 }], next_cursor: 'snapshot:1' };
  });
  await app.run('runUnifiedSearch()');
  const first = app.panel.find('discover-results').children[0];
  first.children[0].checked = true; first.children[0].events.change();
  app.panel.scrollTop = 777;
  await Promise.all([app.run('loadMoreDiscovery()'), app.run('loadMoreDiscovery()')]);
  assert.equal(calls.length, 2);
  assert.equal(app.panel.find('discover-results').children[0], first);
  assert.equal(app.panel.scrollTop, 777);
  assert.equal(app.explorer.searchSelected.has(0), true);
  assert.equal(app.explorer.searchResults.length, 2);
  assert.match(app.panel.find('discover-status').textContent, /2 known files/);
  assert.match(app.panel.find('discover-status').textContent, /1024 B known/);
  assert.match(app.panel.find('discover-status').textContent, /Unknown for 1 results/);
});

test('a late Discover page cannot paint another workspace', async () => {
  let release;
  const app = browser(() => new Promise(resolve => { release = resolve; }));
  const request = app.run('runUnifiedSearch()');
  app.explorer.nav = 'activity';
  release({ results: [{ title: 'Stale' }] }); await request;
  assert.equal(app.explorer.searchResults.length, 0);
  assert.equal(app.panel.find('discover-results'), undefined);
});
