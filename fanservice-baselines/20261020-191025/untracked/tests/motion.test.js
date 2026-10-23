const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(reduced = false) {
  const listeners = {}, preference = {matches: reduced, addEventListener(_, callback) {this.change = callback;}};
  let observe;
  vm.runInNewContext(fs.readFileSync('static/motion.js', 'utf8'), {
    Set, window: {matchMedia: () => preference},
    document: {body: {}, addEventListener(type, callback) {listeners[type] = callback;}},
    MutationObserver: class {constructor(callback) {observe = callback;} observe() {}},
  });
  const animations = [];
  const element = {nodeType: 1, hidden: false, matches: () => true,
    getAnimations: () => animations.filter(animation => !animation.cancelled),
    animate(frames, options) {
      const animation = {frames, options, finished: new Promise(() => {}), cancel() {this.cancelled = true;}};
      animations.push(animation); return animation;
    }};
  return {preference, listeners, animations, element, observe};
}

test('reveal motion is interrupted immediately by Pause and reduced motion changes', () => {
  const f = fixture();
  f.observe([{type: 'attributes', target: f.element}]);
  assert.equal(f.animations.length, 1);
  f.observe([{type: 'attributes', target: f.element}]);
  assert.equal(f.animations[0].cancelled, true);
  f.listeners['avto-playback-pause']();
  assert.equal(f.animations[1].cancelled, true);
  f.observe([{type: 'attributes', target: f.element}]);
  f.preference.matches = true; f.preference.change();
  assert.equal(f.animations[2].cancelled, true);
  f.observe([{type: 'attributes', target: f.element}]);
  assert.equal(f.animations.length, 3);
});

test('reduced motion skips arrivals and hidden elements never delay teardown', () => {
  const f = fixture(true);
  f.observe([{type: 'childList', target: f.element, addedNodes: [f.element]}]);
  assert.equal(f.animations.length, 0);
  f.preference.matches = false; f.element.hidden = true;
  f.observe([{type: 'attributes', target: f.element}]);
  assert.equal(f.animations.length, 0);
});

test('status motion keeps text fully opaque and has no completion-driven command', () => {
  const f = fixture();
  f.element.matches = selector => selector.includes('[role="status"]');
  f.observe([{type: 'childList', target: f.element, addedNodes: []}]);
  assert.equal(f.animations.length, 1);
  assert.ok(f.animations[0].frames.every(frame => frame.opacity === undefined));
  assert.equal(f.animations[0].options.fill, undefined);
});
