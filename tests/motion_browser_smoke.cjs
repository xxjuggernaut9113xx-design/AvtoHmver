const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.AVTOH_PLAYWRIGHT_MODULE || './browser/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const motion = fs.readFileSync(path.join(root, 'static/motion.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'static/style.css'), 'utf8');
const shell = '<main id="workspace"></main>';
const populated = `
  <section id="explorer-panel">Workspace panel</section>
  <section id="playback-stage">Playback mode</section>
  <section id="feed"><article class="feed-review-card">Review decision</article></section>
  <article class="discover-result">Discover result</article>
  <h2 id="goon-stage-title">GOON: Intro</h2>
  <img class="pw-media" alt="synthetic still" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%2375dfbd'/%3E%3C/svg%3E">
  <video class="pw-media" preload="none" poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%2375dfbd'/%3E%3C/svg%3E"></video>
  <p id="error-status" role="status" aria-live="assertive">Ready</p>
  <button id="critical">Next</button>`;

async function runCase(browser, reduceMotion) {
  const page = await browser.newPage({reducedMotion: reduceMotion ? 'reduce' : 'no-preference'});
  await page.setContent(`<style>${styles}</style>${shell}`);
  await page.addScriptTag({content: motion});
  await page.evaluate(content => { document.querySelector('#workspace').innerHTML = content; }, populated);
  const result = await page.evaluate(async () => {
    const nodes = [...document.querySelectorAll(
      '#explorer-panel, #playback-stage, #feed, .feed-review-card, .discover-result, #goon-stage-title, .pw-media',
    )];
    const activeCount = elements => elements.reduce((n, element) =>
      n + element.getAnimations().filter(animation => animation.playState === 'running').length, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const arrivalsStarted = activeCount(nodes) > 0;
    const initialCount = activeCount(nodes);

    document.dispatchEvent(new CustomEvent('avto-playback-pause', {detail: {paused: true}}));
    const pausedCount = activeCount(nodes);

    const hidden = document.createElement('section');
    hidden.id = 'explorer-panel';
    document.body.append(hidden);
    await Promise.resolve();
    const hiddenAnimation = hidden.getAnimations()[0];
    hidden.hidden = true;
    await Promise.resolve();
    const hiddenCancelled = !hiddenAnimation || hiddenAnimation.playState === 'idle';

    const removed = document.createElement('article');
    removed.className = 'feed-review-card';
    document.body.append(removed);
    await Promise.resolve();
    const removedAnimation = removed.getAnimations()[0];
    removed.remove();
    await Promise.resolve();
    const removedCancelled = !removedAnimation || removedAnimation.playState === 'idle';

    const status = document.querySelector('#error-status');
    status.textContent = 'Playback error: synthetic failure';
    await Promise.resolve();
    const statusOpacity = getComputedStyle(status).opacity;
    const statusAnimation = status.getAnimations()[0];
    const statusKeepsTextOpaque = !statusAnimation
      || statusAnimation.effect.getKeyframes().every(frame => frame.opacity === undefined);
    const critical = document.querySelector('#critical');
    let criticalActionImmediate = false;
    critical.addEventListener('click', () => { criticalActionImmediate = true; });
    critical.click();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      reducedMotion, arrivalsStarted, initialCount, pausedCount, hiddenCancelled,
      removedCancelled, statusOpacity, statusKeepsTextOpaque, criticalActionImmediate,
      passed: (reducedMotion ? initialCount === 0 : initialCount > 0)
        && pausedCount === 0 && hiddenCancelled && removedCancelled
        && statusOpacity === '1' && statusKeepsTextOpaque && criticalActionImmediate,
    };
  });
  await page.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.AVTOH_BROWSER_EXECUTABLE
      ? {executablePath: process.env.AVTOH_BROWSER_EXECUTABLE}
      : {}),
  });
  try {
    const normal = await runCase(browser, false);
    const reduced = await runCase(browser, true);
    assert.equal(normal.passed, true, JSON.stringify(normal));
    assert.equal(reduced.passed, true, JSON.stringify(reduced));
    console.log(JSON.stringify({normal, reduced}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
