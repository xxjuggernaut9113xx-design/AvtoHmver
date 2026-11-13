const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.AVTOH_PLAYWRIGHT_MODULE || path.resolve(__dirname, 'browser/node_modules/playwright'));

const root = path.resolve(__dirname, '../static');
const videoFixture = path.resolve(__dirname, 'fixtures/fanservice/resume.mp4');
const media = [
  {id:1,filename:'one.png',filepath:'one.png',type:'image',downloaded:1,rating:0,tags:[]},
  {id:2,filename:'two.png',filepath:'two.png',type:'image',downloaded:1,rating:0,tags:[]},
  {id:3,filename:'three.png',filepath:'three.png',type:'image',downloaded:1,rating:0,tags:[]},
  {id:4,filename:'clip.mp4',filepath:'clip.mp4',type:'video',downloaded:1,rating:0,tags:[],duration_secs:1},
];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHgQCAQX5bWQAAAAASUVORK5CYII=', 'base64');

function json(response, body) {
  response.writeHead(200, {'Content-Type':'application/json'});
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.writeHead(200, {'Content-Type':'text/html'});
    response.end(fs.readFileSync(path.join(root, 'index.html')));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/settings') return json(response, {});
    if (url.pathname === '/api/tags') return json(response, {tags:[]});
    if (url.pathname === '/api/downloads/status') return json(response, {paused:false});
    if (url.pathname === '/api/groups') return json(response, {groups:[]});
    if (url.pathname === '/api/sources') return json(response, {sources:[]});
    if (url.pathname === '/api/media') return json(response, {media,has_more:false,next_cursor:null});
    return json(response, {});
  }
  if (url.pathname.startsWith('/library/')) {
    if (url.pathname.endsWith('.mp4')) {
      response.writeHead(200, {'Content-Type':'video/mp4','Accept-Ranges':'bytes'});
      fs.createReadStream(videoFixture).pipe(response);
    } else {
      response.writeHead(200, {'Content-Type':'image/png'});
      response.end(png);
    }
    return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, {'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'});
  fs.createReadStream(file).pipe(response);
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,...(process.env.AVTOH_BROWSER_EXECUTABLE ? {executablePath:process.env.AVTOH_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage();
    await page.clock.install();
    await page.goto(origin);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.currentItems.length === 4);
    await page.locator('#ss-speed').evaluate(select => { select.value='2000'; select.dispatchEvent(new Event('change', {bubbles:true})); });
    await page.evaluate(() => startSlideshow(0));
    await page.waitForFunction(() => !document.querySelector('#slideshow').hidden && document.querySelector('#slideshow-stage img'));
    const click = selector => page.locator(selector).evaluate(element => element.click());
    const pause = '#slideshow [data-playback-pause]';
    await click(pause);
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => ss.index), 0, 'image dwell is held by Pause');
    await click('#ss-next');
    assert.equal(await page.evaluate(() => ss.index), 1, 'explicit Next works while paused');
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => ss.index), 1, 'Next does not auto-advance while paused');
    await click(pause);
    await page.clock.runFor(1999);
    assert.equal(await page.evaluate(() => ss.index), 1, 'Resume starts a fresh dwell');
    await page.clock.runFor(1);
    assert.equal(await page.evaluate(() => ss.index), 2, 'dwell advances after its remaining time');

    await page.evaluate(() => { clearAdvanceTimer(); ss.index = 3; renderSlide(); });
    await page.waitForSelector('#slideshow-stage video');
    await click(pause);
    await page.locator('#slideshow-stage video').evaluate(video => video.dispatchEvent(new Event('ended')));
    assert.equal(await page.evaluate(() => ss.index), 3, 'video end remains pending during Pause');
    await click('#ss-next');
    assert.equal(await page.evaluate(() => ss.index), 0, 'manual replacement takes precedence over pending end');
    await click(pause);
    assert.equal(await page.evaluate(() => ss.index), 0, 'Resume does not skip the manually selected slide');

    await click(pause);
    await page.evaluate(() => {
      exitSlideshow();
      startFeed(false, state.currentItems);
      exitFeed();
      startPortraitWall(state.currentItems);
      exitPortraitWall();
      startSlideshow(0);
    });
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => ss.index), 0, 'rapid mode changes preserve shared Pause without stale advancement');
    console.log('Shared Pause browser acceptance passed: image dwell, pending video end, explicit Next, and rapid mode changes.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
