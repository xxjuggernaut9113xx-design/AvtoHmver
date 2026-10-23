const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('image and video tiles use lazy cached previews and retain opening after preview failure', () => {
  const source = fs.readFileSync('static/app.js', 'utf8');
  const build = source.slice(source.indexOf('function buildTile('), source.indexOf('function shuffleCurrentGrid('));
  const context = {
    document: {
      createElement(tag) {
        return { tag, children: [], events: {}, appendChild(child) { this.children.push(child); },
          addEventListener(name, handler) { this.events[name] = handler; } };
      },
    },
    mediaUnavailable: () => false,
    mediaThumbSrc: item => `/api/thumb/${item.id}`,
    pad4: value => String(value).padStart(4, '0'),
    openLightbox: index => { context.opened = index; },
  };
  vm.createContext(context);
  vm.runInContext(build, context);
  for (const type of ['image', 'video']) {
    const tile = context.buildTile({ id: 7, type, filename: `sample.${type}`, rating: 0 }, 3);
    const preview = tile.children[0];
    assert.equal(preview.tag, 'img');
    assert.equal(preview.src, '/api/thumb/7');
    assert.equal(preview.loading, 'lazy');
    assert.equal(preview.decoding, 'async');
    preview.events.error();
    assert.equal(preview.hidden, true);
    assert.equal(tile.children.at(-1).textContent, 'Preview unavailable');
    tile.events.click();
    assert.equal(context.opened, 3);
  }
});
