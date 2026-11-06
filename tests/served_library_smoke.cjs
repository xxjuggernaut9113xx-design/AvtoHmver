const assert = require('node:assert/strict');
const { chromium } = require('./browser/node_modules/playwright');

const origin = process.env.FANSERVICE_FIXTURE_ORIGIN || 'http://127.0.0.1:42169';

async function run() {
  const executablePath = process.env.FANSERVICE_BROWSER_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(origin + '/fanservice/');
    const ratingUrl = origin + '/api/media/1/rating';
    const writeAttempts = [];
    page.on('request', request => {
      if (request.url() === ratingUrl && request.method() === 'PUT') {
        writeAttempts.push(request.url());
      }
    });
    await page.evaluate(() => {
      window.addEventListener('message', event => {
        if (event.data === 'library-script-executed') window.libraryScriptExecuted = true;
      });
    });

    const htmlUrl = origin + '/library/active.html';
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(url => {
      const frame = document.createElement('iframe');
      frame.src = url;
      document.body.append(frame);
    }, htmlUrl);
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'active.html');

    const loaded = await page.evaluate(() => new Promise(resolve => {
      const script = document.createElement('script');
      script.src = '/library/active.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.append(script);
    }));
    assert.equal(loaded, false);
    assert.equal(await page.evaluate(() => window.libraryScriptExecuted), undefined);
    assert.deepEqual(writeAttempts, []);

    const width = await page.evaluate(async () => {
      const image = new Image();
      image.src = '/library/sample1.png';
      await image.decode();
      return image.naturalWidth;
    });
    assert.ok(width > 0);

    // The trusted Host page can still perform the same mutation.
    const hostStatus = await page.evaluate(async () => {
      const response = await fetch('/api/media/1/rating', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 2 }),
      });
      return response.status;
    });
    assert.equal(hostStatus, 200);
    console.log('Served library blocks active content and preserves Host editing and image decoding.');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
