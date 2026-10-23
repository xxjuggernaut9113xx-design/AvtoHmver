/* One pause boundary for visual playback and its automatic work. */
(() => {
  'use strict';
  const tasks = new Set(), resumeMedia = new Set(), pendingEnds = new Map(), controllers = new Set();
  let paused = false;
  const now = () => performance.now();
  function arm(task) {
    if (paused || !tasks.has(task)) return;
    task.started = now();
    task.handle = setTimeout(() => {
      task.handle = null;
      if (paused || !tasks.has(task)) return;
      if (!task.interval) tasks.delete(task);
      task.callback();
      if (task.interval && tasks.has(task)) { task.remaining = task.interval; arm(task); }
    }, task.remaining);
  }
  function schedule(callback, delay, interval = 0) {
    const task = { callback, remaining: Math.max(0, delay), interval, handle: null, started: now() };
    tasks.add(task); arm(task); return task;
  }
  function cancel(task) { if (!task) return; clearTimeout(task.handle); tasks.delete(task); }
  function forget(media) { resumeMedia.delete(media); pendingEnds.delete(media); }
  function play(media) {
    if (paused) { resumeMedia.add(media); media.pause(); return Promise.resolve(); }
    return media.play();
  }
  function end(media, callback) {
    if (paused) pendingEnds.set(media, callback);
    else callback();
  }
  function setPaused(value) {
    value = !!value;
    if (value === paused) return;
    paused = value;
    if (paused) {
      for (const task of tasks) {
        if (task.handle !== null) task.remaining = Math.max(0, task.remaining - (now() - task.started));
        clearTimeout(task.handle); task.handle = null;
      }
      for (const media of document.querySelectorAll('video, audio')) {
        if (!media.paused && !media.ended) { resumeMedia.add(media); media.pause(); }
      }
      for (const controller of controllers) {
        if (controller.isRunning()) { resumeMedia.add(controller); controller.pause(); }
      }
    } else {
      for (const task of tasks) arm(task);
      const ended = new Map(pendingEnds); pendingEnds.clear();
      for (const media of resumeMedia) {
        if (media.isConnected && !ended.has(media)) media.play().catch(() => {});
      }
      resumeMedia.clear();
      for (const [media, callback] of ended) if (media.isConnected) callback();
    }
    for (const button of document.querySelectorAll('[data-playback-pause]')) {
      button.textContent = paused ? 'Resume' : 'Pause'; button.setAttribute('aria-pressed', String(paused));
    }
    document.dispatchEvent(new CustomEvent('avto-playback-pause', { detail: { paused } }));
  }
  globalThis.avtoPlaybackClock = {
    get paused() { return paused; }, setPaused, play, end, forget,
    registerController(controller) {
      controllers.add(controller);
      if (paused && controller.isRunning()) { resumeMedia.add(controller); controller.pause(); }
      return () => { controllers.delete(controller); forget(controller); };
    },
    timeout: (callback, delay) => schedule(callback, delay),
    interval: (callback, delay) => schedule(callback, delay, delay), cancel,
  };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-playback-pause]')) setPaused(!paused);
  });
  // A play promise can resolve after Pause or a queued item can arrive during
  // Pause. Stop that playback immediately and remember its intended activity.
  document.addEventListener('play', event => {
    if (paused && ['VIDEO', 'AUDIO'].includes(event.target.tagName)) { resumeMedia.add(event.target); event.target.pause(); }
  }, true);
})();
