const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.AVTOH_PLAYWRIGHT_MODULE || path.resolve(__dirname, 'browser/node_modules/playwright'));

async function run() {
  const browser = await chromium.launch({headless:true,...(process.env.AVTOH_BROWSER_EXECUTABLE ? {executablePath:process.env.AVTOH_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route('https://w.soundcloud.com/**', route => route.fulfill({ body: '' }));
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      const body = url.pathname === '/api/playback-presets' ? {presets:[]}
        : url.pathname === '/api/goon/playlists' ? {playlists:[{id:7,name:'Recovery fixture',provider:'soundcloud',source_url:'https://soundcloud.com/fixture/track',tracks:[]}]}
        : url.pathname === '/api/music/tracks' ? {tracks:[]}
        : url.pathname === '/api/music/access' ? {can_edit:false} : {};
      route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.route('https://music-fixture.invalid/', route => route.fulfill({
      contentType: 'text/html', body: '<button id="playback-setup-open">Playback setup</button>',
    }));
    await page.goto('https://music-fixture.invalid/');
    await page.evaluate(() => {
      const events = {};
      const widget = {plays:0,pauses:0,bind(name,fn){events[name]=fn;if(name==='ready')queueMicrotask(fn);},unbind(name){delete events[name];},setVolume(){},seekTo(){},play(){this.plays++;events.play?.();},pause(){this.pauses++;events.pause?.();}};
      window.__provider = {events,widget};
      function Widget(){return widget;}
      Widget.Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',ERROR:'error'};
      window.SC={Widget};
    });
    for (const file of ['playback-clock.js','music-connectors.js','playback.js']) {
      await page.addScriptTag({content:fs.readFileSync(path.resolve(__dirname,'../static',file),'utf8')});
    }
    await page.locator('#playback-setup-open').click();
    const field = name => page.locator(`[data-field="${name}"]`);
    await field('music_source').selectOption('soundcloud');
    await field('playlist_id').selectOption('7');
    await page.locator('[data-action="apply"]').click();
    await page.waitForSelector('[data-music] iframe');
    await page.waitForSelector('[data-music] button');
    await page.locator('[data-music] button', {hasText:'Play'}).click();
    assert.equal(await page.evaluate(() => window.__provider.widget.plays),1,'configured connector starts through its exposed Play control');
    await page.evaluate(() => window.__provider.events.error());
    assert.match(await page.locator('[data-status]').textContent(),/SoundCloud track unavailable/);
    assert.equal(await page.evaluate(() => avtoPlaybackClock.paused),false);
    await page.locator('[data-music] button', {hasText:'Play'}).click();
    assert.equal(await page.evaluate(() => window.__provider.widget.plays),2,'explicit retry resumes the configured provider after loss');
    await page.locator('[data-action="pause"]').click();
    assert.equal(await page.evaluate(() => window.__provider.widget.pauses),1,'recovered provider remains attached to shared Pause');
    await page.locator('[data-action="resume"]').click();
    assert.equal(await page.evaluate(() => window.__provider.widget.plays),3,'shared Resume restarts the recovered provider');
    await page.locator('[data-action="stop"]').click();
    console.log('Configured SoundCloud fixture recovered after simulated provider ERROR; shared Pause and subsequent Play passed.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode=1; });
