const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(autoReady = true) {
  const players = [], reports = [], widgets = [];
  class Player {
    constructor(iframe, config) {
      this.iframe = iframe; this.events = config.events; this.plays = 0; this.pauses = 0; this.destroyed = 0;
      players.push(this); if (autoReady) queueMicrotask(() => this.events.onReady({target: this}));
    }
    playVideo() {this.plays++; this.events.onStateChange({data: 1});}
    pauseVideo() {this.pauses++; this.events.onStateChange({data: 2});}
    setVolume(value) {this.volume = value;}
    seekTo(value) {this.seek = value;}
    destroy() {this.destroyed++;}
  }
  function Widget() {
    const events = {};
    const widget = {events, plays: 0, pauses: 0,
      bind(name, callback) {events[name] = callback; if(name === 'ready' && autoReady) queueMicrotask(callback);},
      unbind(name) {delete events[name];},
      play() {this.plays++; events.play?.();}, pause() {this.pauses++; events.pause?.();},
      setVolume(value) {this.volume = value;}, seekTo(value) {this.seek = value;},
    };
    widgets.push(widget); return widget;
  }
  Widget.Events = {READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', ERROR: 'error'};
  const context = vm.createContext({YT: {Player}, SC: {Widget}, MusicKit: {PlaybackStates: {playing: 1, paused: 2, stopped: 3}}, Set, Map, Math, Promise,
    setTimeout, clearTimeout, queueMicrotask, performance,
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    document: {querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {}},
  });
  for (const name of ['playback-clock', 'music-connectors']) vm.runInContext(fs.readFileSync(`static/${name}.js`, 'utf8'), context);
  const iframe = () => ({isConnected: true, src: 'provider', remove() {this.isConnected = false;}});
  return {players, widgets, reports, iframe, clock: context.avtoPlaybackClock,
    createApple: instance => context.avtoMusicConnectors.createApple(instance, 0.4, message => reports.push(message)),
    create: (provider, frame, signal) => context.avtoMusicConnectors.create(provider, frame, 0.4, message => reports.push(message), signal)};
}

test('YouTube shared Pause resumes only previously running controllers and drops disposed activity', async () => {
  const f = fixture(), first = await f.create('youtube', f.iframe()), second = await f.create('youtube', f.iframe());
  await f.clock.play(first); assert.equal(f.players[0].volume, 40);
  f.clock.setPaused(true); assert.equal(f.players[0].pauses, 1); assert.equal(f.players[1].pauses, 0);
  f.clock.setPaused(false); assert.equal(f.players[0].plays, 2); assert.equal(f.players[1].plays, 0);
  f.clock.setPaused(true); first.dispose(); f.clock.setPaused(false);
  assert.equal(f.players[0].plays, 2); assert.equal(f.players[0].destroyed, 1);
  second.dispose();
});

test('Apple Music pauses immediately, keeps manual pauses, interrupts late playback, and unauthorizes on teardown', async () => {
  const f = fixture(), events = {};
  const instance = {playbackState: 2, plays: 0, pauses: 0, stops: 0, revoked: 0,
    addEventListener(name, callback) {events[name] = callback;}, removeEventListener(name) {delete events[name];},
    play() {this.plays++; this.playbackState = 1; events.playbackStateDidChange?.(); return Promise.resolve();},
    pause() {this.pauses++; this.playbackState = 2; events.playbackStateDidChange?.();},
    stop() {this.stops++; this.playbackState = 3;}, unauthorize() {this.revoked++; return Promise.resolve();},
    seekToTime(seconds) {this.seek = seconds;},
  };
  const controller = f.createApple(instance);
  assert.equal(instance.volume, 0.4); controller.seek(2.5); assert.equal(instance.seek, 2.5);
  await f.clock.play(controller); f.clock.setPaused(true); assert.equal(instance.pauses, 1);
  instance.playbackState = 1; events.playbackStateDidChange(); assert.equal(instance.pauses, 2);
  f.clock.setPaused(false); assert.equal(instance.plays, 2);
  controller.pause(); f.clock.setPaused(true); f.clock.setPaused(false); assert.equal(instance.plays, 2);
  controller.dispose(); await new Promise(setImmediate);
  assert.equal(instance.stops, 1); assert.equal(instance.revoked, 1); assert.equal(Object.keys(events).length, 0);
});

test('A late provider play during Pause is stopped and an explicit manual pause remains paused on Resume', async () => {
  const f = fixture(), controller = await f.create('youtube', f.iframe());
  f.clock.setPaused(true); f.players[0].events.onStateChange({data: 1});
  assert.equal(f.players[0].pauses, 1); assert.equal(controller.state().paused, true);
  f.clock.setPaused(false); assert.equal(f.players[0].plays, 1);
  f.clock.setPaused(true); f.clock.forget(controller); controller.pause(); f.clock.setPaused(false);
  assert.equal(f.players[0].plays, 1); controller.dispose();
});

test('SoundCloud uses documented volume and millisecond seek units and removes all listeners on teardown', async () => {
  const f = fixture(), controller = await f.create('soundcloud', f.iframe()), widget = f.widgets[0];
  assert.equal(widget.volume, 40); controller.seek(2.5); assert.equal(widget.seek, 2500);
  await f.clock.play(controller); f.clock.setPaused(true); assert.equal(widget.pauses, 1);
  f.clock.setPaused(false); assert.equal(widget.plays, 2);
  widget.events.error(); assert.match(f.reports[0], /unavailable/);
  controller.dispose(); assert.equal(Object.keys(widget.events).length, 0);
});

test('Closing a player before SDK readiness destroys the pending player and never registers resume activity', async () => {
  const f = fixture(false), frame = f.iframe(), abort = new AbortController();
  const pending = f.create('youtube', frame, abort.signal);
  await new Promise(setImmediate); abort.abort();
  await assert.rejects(pending, /replaced or closed/);
  assert.equal(frame.isConnected, false); assert.equal(f.players[0].destroyed, 1);
  f.clock.setPaused(true); f.clock.setPaused(false); assert.equal(f.players[0].plays, 0);
});
