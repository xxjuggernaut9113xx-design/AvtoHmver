const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  let time = 0, id = 0;
  const scheduled = new Map(), media = [], listeners = {};
  const context = vm.createContext({Set, Map, Math, Promise,
    performance: {now: () => time},
    setTimeout(callback, delay) { scheduled.set(++id, {callback, at: time + delay}); return id; },
    clearTimeout(handle) { scheduled.delete(handle); },
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    document: {querySelectorAll: selector => selector === 'video, audio' ? media : [],
      addEventListener(type, callback) { listeners[type] = callback; }, dispatchEvent() {}},
  });
  vm.runInContext(fs.readFileSync('static/playback-clock.js', 'utf8'), context);
  const clock = context.avtoPlaybackClock;
  function tick(amount) {
    const end = time + amount;
    while (true) {
      const due = [...scheduled].filter(([,task]) => task.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = due[1].at; scheduled.delete(due[0]); due[1].callback();
    }
    time = end;
  }
  function video(paused = false, tagName = 'VIDEO') {
    const node = {paused, tagName, isConnected: true, ended: false, plays: 0, pauses: 0,
      play() {this.plays++; this.paused = false; return Promise.resolve();},
      pause() {this.pauses++; this.paused = true;}};
    media.push(node); return node;
  }
  return {clock, tick, video, listeners};
}

test('Local audio freezes track-end advancement and late play requests without reviving manually paused tracks', () => {
  const {clock, video, listeners} = fixture();
  const audio = video(false, 'AUDIO'), manual = video(true, 'AUDIO');
  clock.setPaused(true);
  assert.equal(audio.paused, true);
  let advanced = 0;
  clock.end(audio, () => advanced++);
  const arriving = video(false, 'AUDIO');
  listeners.play({target: arriving});
  assert.equal(arriving.paused, true);
  assert.equal(advanced, 0);
  clock.setPaused(false);
  assert.equal(advanced, 1);
  assert.equal(audio.plays, 0);
  assert.equal(arriving.plays, 1);
  assert.equal(manual.plays, 0);
});

test('Pause freezes image dwell and review countdown; repeated pause is idempotent', () => {
  const {clock, tick} = fixture(); let advances = 0, countdown = 10;
  clock.timeout(() => advances++, 10000);
  const interval = clock.interval(() => countdown--, 1000);
  tick(2500); clock.setPaused(true); clock.setPaused(true); tick(60000);
  assert.equal(advances, 0); assert.equal(countdown, 8);
  clock.setPaused(false); tick(7499); assert.equal(advances, 0);
  tick(1); assert.equal(advances, 1); assert.equal(countdown, 0);
  clock.cancel(interval);
});

test('EOF during Pause remains pending, and explicit replacement cancels the old boundary', () => {
  const {clock, video} = fixture(); const old = video(); let advances = 0;
  clock.setPaused(true); clock.end(old, () => advances++); clock.end(old, () => advances++);
  assert.equal(advances, 0);
  clock.forget(old); clock.setPaused(false); assert.equal(advances, 0);
  clock.setPaused(true); clock.end(old, () => advances++); clock.setPaused(false);
  assert.equal(advances, 1);
});

test('Resume only restarts running or requested media and never restarts detached media', async () => {
  const {clock, video, listeners} = fixture();
  const running = video(), manuallyPaused = video(true), removed = video();
  clock.setPaused(true); removed.isConnected = false;
  const arrived = video(true); await clock.play(arrived);
  const late = video(false); listeners.play({target: {...late, tagName: 'VIDEO'}});
  assert.equal(running.paused, true); assert.equal(arrived.plays, 0);
  clock.setPaused(false);
  assert.equal(running.plays, 1); assert.equal(manuallyPaused.plays, 0);
  assert.equal(removed.plays, 0); assert.equal(arrived.plays, 1);
});

test('Next during Pause starts a fresh dwell on resume without resurrecting an old timer', () => {
  const {clock, tick} = fixture(); let advances = 0;
  const old = clock.timeout(() => advances++, 10000);
  tick(9999); clock.setPaused(true); clock.cancel(old);
  clock.timeout(() => advances++, 10000); tick(60000);
  clock.setPaused(false); tick(9999); assert.equal(advances, 0);
  tick(1); assert.equal(advances, 1);
});
