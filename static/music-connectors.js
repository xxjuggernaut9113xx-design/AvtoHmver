/* Official iframe APIs. Provider clocks remain independent of session time. */
(() => {
  'use strict';
  const scripts = new Map();
  const promised = callback => { try { return Promise.resolve(callback()); } catch (error) { return Promise.reject(error); } };
  function loadSDK(url, ready) {
    if (ready()) return Promise.resolve();
    if (scripts.has(url)) return scripts.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let poll, timeout;
      const finish = error => {
        clearTimeout(timeout); clearTimeout(poll);
        script.onload = script.onerror = null;
        if (error) { script.remove(); scripts.delete(url); reject(error); } else resolve();
      };
      const check = () => { if (ready()) finish(); else poll = setTimeout(check, 25); };
      script.src = url; script.onload = check;
      script.onerror = () => finish(new Error('Provider controls could not load. Retry or open the provider externally.'));
      timeout = setTimeout(() => finish(new Error('Provider controls timed out. Retry or open the provider externally.')), 8000);
      document.head.append(script);
    });
    scripts.set(url, promise); return promise;
  }
  async function create(provider, iframe, volume, report, signal) {
    const connected = () => iframe.isConnected && !signal?.aborted;
    const check = () => { if (!connected()) throw new Error('Music player was replaced or closed.'); };
    let player, running = false, disposed = false, unregister = () => {};
    const cleanup = [];
    const controller = {
      isEmbedded: true, capabilities: {play: true, pause: true, seek: true, volume: true},
      get isConnected() { return !disposed && connected(); },
      isRunning: () => running,
      play() { running = true; return promised(() => { if (!disposed) return provider === 'youtube' ? player.playVideo() : player.play(); }); },
      pause() { running = false; try { if (player) { if (provider === 'youtube') player.pauseVideo(); else player.pause(); } } catch (error) { if (!disposed) report(error.message); } },
      seek(seconds) { if (provider === 'youtube') player.seekTo(seconds, true); else player.seekTo(seconds * 1000); },
      volume(value) { player.setVolume(value * 100); },
      state: () => ({paused: !running, provider}), load() {},
      dispose() {
        if (disposed) return; disposed = true; running = false;
        unregister(); for (const release of cleanup) release();
        try { if (provider === 'youtube') player?.destroy(); else player?.pause(); }
        catch (error) { report(error.message); }
        finally { iframe.src = 'about:blank'; iframe.remove(); }
      },
    };
    const activity = playing => {
      if (disposed) return;
      running = playing;
      if (playing && avtoPlaybackClock.paused) avtoPlaybackClock.play(controller).catch(error => report(error.message));
    };
    const ready = attach => new Promise((resolve, reject) => {
      let timer;
      const abort = () => finish(new Error('Music player was replaced or closed.'));
      const finish = error => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => finish(new Error('Provider player timed out. Retry or open externally.')), 8000);
      attach(() => { try { check(); controller.volume(volume); finish(); } catch (error) { finish(error); } }, error => { report(error.message); finish(error); });
    });
    try {
      if (provider === 'youtube') {
        await loadSDK('https://www.youtube.com/iframe_api', () => !!globalThis.YT?.Player); check();
        await ready((done, fail) => {
          player = new YT.Player(iframe, {events: {
            onReady: event => { player = event.target; done(); },
            onStateChange: event => activity(event.data === 1 || event.data === 3),
            onError: event => { running = false; avtoPlaybackClock.forget(controller); fail(new Error(`YouTube player unavailable (${event.data}). Open the provider externally.`)); },
          }});
        });
      } else if (provider === 'soundcloud') {
        await loadSDK('https://w.soundcloud.com/player/api.js', () => !!globalThis.SC?.Widget); check();
        player = SC.Widget(iframe);
        const bind = (event, callback) => { player.bind(event, callback); cleanup.push(() => player.unbind(event)); };
        bind(SC.Widget.Events.PLAY, () => activity(true));
        bind(SC.Widget.Events.PAUSE, () => activity(false));
        bind(SC.Widget.Events.FINISH, () => activity(false));
        bind(SC.Widget.Events.ERROR, () => { running = false; avtoPlaybackClock.forget(controller); report('SoundCloud track unavailable. Open the provider externally.'); });
        await ready(done => bind(SC.Widget.Events.READY, done));
      } else throw new Error('Provider has no supported iframe controller.');
      check(); unregister = avtoPlaybackClock.registerController(controller);
      signal?.addEventListener('abort', controller.dispose, {once: true});
      cleanup.push(() => signal?.removeEventListener('abort', controller.dispose));
      return controller;
    } catch (error) { controller.dispose(); throw error; }
  }
  function createApple(instance, volume, report) {
    const playing = globalThis.MusicKit?.PlaybackStates?.playing;
    if (playing === undefined || !instance.addEventListener || !instance.removeEventListener) throw new Error('MusicKit playback controls are unavailable. Open Apple Music externally.');
    let disposed = false, requested = false, unregister = () => {};
    const controller = {
      isEmbedded: true, capabilities: {play: true, pause: true, seek: true, volume: true},
      get isConnected() { return !disposed; },
      isRunning: () => !disposed && (requested || instance.playbackState === playing),
      play: () => { requested = true; return promised(() => { if (!disposed) return instance.play(); }); },
      pause() { requested = false; promised(() => instance.pause()).catch(error => {if (!disposed) report(error.message);}); },
      seek: seconds => instance.seekToTime(seconds), volume: value => {instance.volume = value;},
      state: () => ({paused: !controller.isRunning(), provider: 'apple_music'}), load() {},
      dispose() {
        if (disposed) return; disposed = true;
        unregister(); instance.removeEventListener('playbackStateDidChange', changed);
        try { instance.stop(); } catch (error) { report(error.message); }
        Promise.resolve().then(() => instance.unauthorize()).catch(() => {});
      },
    };
    const changed = () => {
      const states = globalThis.MusicKit.PlaybackStates;
      if (instance.playbackState === playing) requested = true;
      else if ([states.paused, states.completed, states.ended, states.stopped, states.none].includes(instance.playbackState)) requested = false;
      if (!disposed && avtoPlaybackClock.paused && controller.isRunning()) avtoPlaybackClock.play(controller).catch(error => report(error.message));
    };
    instance.addEventListener('playbackStateDidChange', changed);
    controller.volume(volume); unregister = avtoPlaybackClock.registerController(controller);
    return controller;
  }
  globalThis.avtoMusicConnectors = {create, createApple};
})();
