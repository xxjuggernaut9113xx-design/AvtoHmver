const assert = require('node:assert/strict');
const { chromium } = require('./browser/node_modules/playwright');

async function run() {
  // This check stages a restore. Use a fresh parity_acceptance Server and
  // restart that same disposable Server after the browser check.
  const fixtureOrigin = process.env.AVTOHMVER_ADMIN_FIXTURE_ORIGIN;
  assert.ok(fixtureOrigin, 'Set AVTOHMVER_ADMIN_FIXTURE_ORIGIN to a fresh Server fixture');
  const origin = new URL(fixtureOrigin);
  assert.equal(origin.hostname, '127.0.0.1');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FANSERVICE_BROWSER_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    await page.goto(origin.href);
    assert.equal(await page.title(), 'Set up AvtoHmver');
    const complete = await page.request.post(new URL('/api/oobe/complete', origin).href);
    assert.ok(complete.ok(), await complete.text());
    await page.reload();
    const settings = page.getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Settings' });
    await settings.click();
    assert.equal(await page.locator('#settings-local-startup').isHidden(), true);
    await page.getByRole('tab', { name: 'Local Admin' }).click();

    const backend = page.getByRole('combobox', { name: 'P-HAR native backend' });
    await backend.selectOption('rocm');
    await page.waitForResponse(response =>
      response.url().endsWith('/api/admin/phar') && response.request().method() === 'GET');
    assert.equal(await backend.inputValue(), 'rocm');
    const configure = page.waitForResponse(response =>
      response.url().endsWith('/api/admin/phar') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Apply backend' }).click();
    const configuration = await configure;
    assert.equal(configuration.status(), 200);
    assert.equal((await configuration.json()).backend, 'rocm');

    await page.route('**/api/admin/phar', route => route.fulfill({
      status: 503,
      json: { error: 'A local maintenance job is active' },
    }));
    await page.getByRole('button', { name: 'Create backup' }).click();
    await page.getByText('create backup · succeeded').waitFor();
    await page.getByText('P-HAR unavailable: A local maintenance job is active').waitFor();
    await page.unroute('**/api/admin/phar');
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await page.getByText('validate backup · succeeded').waitFor();

    const patch = await page.request.patch(new URL('/api/settings', origin).href, {
      data: { theme: 'tactical' },
    });
    assert.ok(patch.ok(), await patch.text());
    page.once('dialog', dialog => dialog.accept('RESTORE BACKUP'));
    await page.getByRole('button', { name: 'Stage restore' }).click();
    await page.getByText('restore backup · succeeded').waitFor();
    await page.getByText('Restart AvtoHmver to apply this job.').waitFor();

    // Feed the UI the same capability flags a real Tailnet Viewer receives.
    // The transport-level role check is covered by the Rust router tests.
    await page.route('**/api/settings', async route => {
      const response = await route.fetch();
      const json = await response.json();
      json.local_integration_settings_local_only = true;
      json.external_tool_settings_local_only = true;
      await route.fulfill({ response, json });
    });
    await page.reload();
    await settings.click();
    assert.equal(await page.getByRole('tab', { name: 'Local Admin' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 0);
    assert.equal(await page.locator('#settings-max-concurrent').isDisabled(), true);
    await page.getByRole('tab', { name: 'Media & Storage' }).click();
    assert.equal(await page.getByRole('button', { name: 'Clear thumbnails now' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Refresh usage' }).isEnabled(), true);
    console.log('Admin permissions, classifier configuration, backup validation, and staged restore verified.');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
