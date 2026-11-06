const assert = require('node:assert/strict');
const { chromium } = require('./browser/node_modules/playwright');

async function run() {
  // This check changes persistent settings and requires a fresh, disposable
  // Server started with desktop/examples/parity_acceptance.rs.
  const fixtureOrigin = process.env.AVTOHMVER_THEME_FIXTURE_ORIGIN;
  assert.ok(fixtureOrigin, 'Set AVTOHMVER_THEME_FIXTURE_ORIGIN to a fresh Server fixture');
  const origin = new URL(fixtureOrigin);
  assert.equal(origin.hostname, '127.0.0.1');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FANSERVICE_BROWSER_EXECUTABLE,
  });
  try {
    const page = await browser.newPage({ colorScheme: 'light' });
    await page.goto(origin.href);
    assert.equal(await page.title(), 'Set up AvtoHmver');
    assert.equal(await page.locator('#theme-input').inputValue(), 'system');
    assert.equal(await page.locator('#theme-input option[value=tactical]').count(), 1);

    const complete = await page.request.post(new URL('/api/oobe/complete', origin).href);
    assert.ok(complete.ok(), await complete.text());
    await page.reload();
    assert.equal(await page.title(), 'AvtoHmver Server');
    await page.locator('#explorer-route-label').waitFor();
    assert.match(await page.locator('#explorer-route-label').textContent(), /^AVTOHMVER/);
    await page.locator('html[data-theme=linen]').waitFor();

    const openAppearance = async () => {
      await page.getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Appearance' }).click();
    };
    await openAppearance();
    const theme = page.locator('#settings-theme');
    assert.equal(await theme.inputValue(), 'system');
    const saveAppearance = async () => {
      const saved = page.waitForResponse(response =>
        response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
      await page.locator('#settings-save').click();
      const response = await saved;
      assert.ok(response.ok(), await response.text());
      return (await response.json()).theme;
    };
    await theme.selectOption('tactical');
    assert.equal(await saveAppearance(), 'tactical');
    await page.locator('html[data-theme=tactical]').waitFor();
    await page.reload();
    await page.locator('html[data-theme=tactical]').waitFor();
    await openAppearance();
    assert.equal(await theme.inputValue(), 'tactical');

    const legacy = await page.request.patch(new URL('/api/settings', origin).href, {
      data: { theme: 'yotsuba-b' },
    });
    assert.ok(legacy.ok(), await legacy.text());
    await page.reload();
    await page.locator('html[data-theme=midnight]').waitFor();
    await openAppearance();
    assert.equal(await theme.inputValue(), 'midnight');
    assert.equal(await saveAppearance(), 'yotsuba-b');
    console.log('AvtoHmver branding, fresh System, saved Tactical, and legacy theme verified.');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
