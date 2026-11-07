const { chromium } = require(process.env.FANSERVICE_PLAYWRIGHT_MODULE || './browser/node_modules/playwright');
const assert = require('node:assert/strict');

const originA = process.env.FANSERVICE_SERVER_A_ORIGIN;
const originB = process.env.FANSERVICE_SERVER_B_ORIGIN;
const executablePath = process.env.FANSERVICE_BROWSER_EXECUTABLE;
assert.ok(originA && originB, 'Set FANSERVICE_SERVER_A_ORIGIN and FANSERVICE_SERVER_B_ORIGIN');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${originA}/fanservice/`);
    await page.waitForFunction(() => /library [a-f0-9]{32}/.test(document.querySelector('#connection')?.textContent || ''));
    const libraryA = (await page.locator('#connection').innerText()).match(/library ([a-f0-9]{32})/)[1];

    await page.locator('#connection-setup').click();
    await page.locator('#server-origin').fill(originB);
    await page.locator('#connect-server').click();
    await page.waitForURL(`${originB}/fanservice/`);
    await page.waitForFunction(() => /library [a-f0-9]{32}/.test(document.querySelector('#connection')?.textContent || ''));
    const libraryB = (await page.locator('#connection').innerText()).match(/library ([a-f0-9]{32})/)[1];
    assert.notEqual(libraryB, libraryA, 'each Server should expose its own library identity');

    await page.locator('#connection-setup').click();
    await page.locator('#saved-servers').selectOption(originA);
    await page.locator('#select-server').click();
    await page.waitForURL(`${originA}/fanservice/`);
    await page.waitForFunction(id => document.querySelector('#connection')?.textContent?.includes(`library ${id}`), libraryA);
    assert.equal((await page.locator('#connection').innerText()).match(/library ([a-f0-9]{32})/)[1], libraryA,
      'switching back should restore Server A identity');

    await page.route('**/api/fanservice/v1/library**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ library_id: libraryB, items: [], next_cursor: null, has_more: false })
    }));
    await page.locator('#filters button').click();
    await page.locator('#status').getByText('The Server library identity changed. Reopen the library to continue.', { exact: true }).waitFor();
    await page.unroute('**/api/fanservice/v1/library**');
    assert.equal(await page.locator('#grid article').count(), 0, 'a changed-identity response must not replace the current library');

    await page.route('**/api/fanservice/v1/capabilities**', route => route.abort());
    await page.reload();
    await page.locator('#status').getByText(/Server unavailable:.*Local files and explicitly downloaded snapshots remain available\./).waitFor();
    assert.equal(await page.locator('#connection-setup').isEnabled(), true, 'connection recovery controls should remain available');
    await page.unroute('**/api/fanservice/v1/capabilities**');
    await page.reload();
    await page.waitForFunction(id => document.querySelector('#connection')?.textContent?.includes(`library ${id}`), libraryA);

    let releaseResponse;
    let requestPaused;
    const paused = new Promise(resolve => { requestPaused = resolve; });
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    await page.route('**/api/fanservice/v1/library**', async route => {
      requestPaused();
      await responseGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          library_id: libraryA,
          items: [{ id: 'deferred-stale', name: 'stale-from-prior-server.png', type: 'image', rating: 1, tags: [], thumbnail: '/missing.png', url: '/missing.png' }],
          next_cursor: null,
          has_more: false
        })
      });
    });
    await page.locator('#filters button').click();
    await paused;
    // A saved-server switch navigates away from A. Mark the pending document inactive
    // while keeping it alive long enough to deliver the delayed response.
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    releaseResponse();
    await page.locator('#status').getByText('Server connection changed. Reopen the current library to continue.', { exact: true }).waitFor();
    assert.equal(await page.getByText('stale-from-prior-server.png', { exact: true }).count(), 0,
      'a response started on the prior Server must not render after switching');
    assert.deepEqual(errors, []);
    console.log(`Saved Server regression passed. A=${libraryA}; B=${libraryB}; identity mismatch and connection failure rejected safely; deferred A response rejected after switch to B.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
