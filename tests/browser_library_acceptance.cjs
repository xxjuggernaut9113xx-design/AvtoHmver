const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || './browser/node_modules/playwright');

async function run() {
  const origin = process.env.AVTOHMVER_LIBRARY_FIXTURE_ORIGIN;
  assert.ok(origin, 'Set AVTOHMVER_LIBRARY_FIXTURE_ORIGIN to a disposable Server fixture');
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FANSERVICE_BROWSER_EXECUTABLE,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const mediaResponses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => {
      if (!response.url().includes('/api/media?')) return;
      try { mediaResponses.push({ status: response.status(), url: response.url(), media: (await response.json()).media?.length }); } catch (_) {}
    });
    await page.goto(origin);
    console.log('Opened disposable Server library.');
    if (await page.title() === 'Set up AvtoHmver') {
      const completed = await page.request.post(new URL('/api/oobe/complete', origin).href);
      assert.ok(completed.ok(), await completed.text());
      await page.reload();
    }
    await page.locator('#explorer-route-label').waitFor();

    await page.locator('.source-tree-source').nth(109).waitFor();
    console.log('Loaded source hierarchy.');
    assert.equal(await page.locator('.source-tree-source').count(), 110);
    await page.locator('.source-tree-source').first().locator('button.source-tree-browse').click();
    await page.waitForFunction(() => document.querySelector('#context-tab-label')?.textContent === 'Parity source 001');
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length > 0, null, { timeout: 8000 }).catch(async error => {
      console.log('Source route diagnostics:', await page.locator('#context-tab-label').textContent(), await page.locator('#empty-state').isVisible(), mediaResponses, errors);
      throw error;
    });

    await page.locator('[data-top-nav="library"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length >= 60);
    const allCount = await page.locator('#grid .explorer-row').count();
    assert.ok(allCount >= 60, `Expected the first large library page, found ${allCount} rows`);
    await page.locator('#grid-sentinel').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length >= 110);
    console.log('Loaded the second large result page.');
    assert.equal(await page.locator('#grid .explorer-row').count(), 115);
    await page.locator('#grid').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
    const allMediaScrollTop = await page.locator('#grid').evaluate(grid => grid.scrollTop);
    assert.ok(allMediaScrollTop > 0, 'The full media list should be scrolled before leaving it');

    await page.locator('[data-top-nav="activity"]').click();
    await page.locator('#activity-status').waitFor();
    const pauseQueue = page.waitForResponse(response =>
      response.url().endsWith('/api/downloads/pause') && response.request().method() === 'POST');
    await page.locator('#explorer-panel').getByRole('button', { name: 'Pause downloads' }).click();
    assert.equal((await pauseQueue).status(), 200);
    const queueStatus = await page.request.get(`${origin}/api/downloads/status`).then(response => response.json());
    assert.equal(queueStatus.paused, true);
    await page.locator('[data-top-nav="library"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length === 115);
    assert.equal(await page.locator('#grid').evaluate(grid => grid.scrollTop), allMediaScrollTop);
    console.log('Restored pagination and scroll after the queue view.');

    await page.locator('#explorer-rating-status').selectOption('needs_review');
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length === 2);
    const reviewCount = await page.locator('#grid .explorer-row').count();
    assert.equal(reviewCount, 2);

    await page.locator('#explorer-rating-status').selectOption('');
    await page.locator('#explorer-tag-filter').selectOption('Parity portrait');
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length === 3, null, { timeout: 8000 }).catch(async error => {
      console.log('Tag filter diagnostics:', mediaResponses, await page.locator('#grid .explorer-row').count(), errors);
      throw error;
    });
    assert.equal(await page.locator('#grid .explorer-row').count(), 3);

    await page.locator('#grid .explorer-row-select').first().click();
    await page.locator('#explorer-bulk-bar').waitFor({ state: 'visible' });
    await page.locator('[data-top-nav="discover"]').click();
    await page.locator('#explorer-panel h2').getByText('Search').waitFor();
    await page.locator('[data-top-nav="library"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#grid .explorer-row').length === 3);
    assert.equal(await page.locator('#explorer-tag-filter').inputValue(), 'Parity portrait');
    assert.equal(await page.locator('#explorer-selection-count').textContent(), '1 selected');
    assert.equal(await page.locator('#grid .explorer-row-select').first().isChecked(), true);
    const bulkUpdate = page.waitForResponse(response =>
      response.url().endsWith('/api/media/bulk') && response.request().method() === 'POST');
    page.once('dialog', dialog => dialog.accept('4'));
    await page.locator('[data-bulk="set-rating"]').click();
    assert.equal((await bulkUpdate).status(), 200);
    const persisted = await page.request.get(`${origin}/api/media?limit=1&media_type=all&source_id=1`).then(response => response.json());
    assert.equal(persisted.media[0].rating, 4);
    assert.deepEqual(errors, []);
    console.log('Server library acceptance passed: hierarchy, source browsing, pagination/scroll restoration, queue pause persistence, filter/selection restoration, and bulk-rating persistence.');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
