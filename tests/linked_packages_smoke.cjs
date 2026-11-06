const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('./browser/node_modules/playwright');

async function run() {
  const root = process.env.AVTOHMVER_LINKED_FIXTURE;
  assert.ok(path.isAbsolute(root ?? ''), 'Set AVTOHMVER_LINKED_FIXTURE to a seeded disposable fixture');
  await fs.access(path.join(root, '.parity-fixture'));
  const ready = JSON.parse(await fs.readFile(path.join(root, 'ready.json')));
  const seed = JSON.parse(await fs.readFile(path.join(root, 'seeded.json')));
  const library = await fs.realpath(ready.library_dir);
  const markedRoot = await fs.realpath(root);
  assert.ok(library.startsWith(markedRoot + path.sep), 'The library must be inside the fixture');
  assert.equal(seed.origin, `http://127.0.0.1:${ready.port}`);
  const portable = path.resolve(root, seed.package);
  assert.ok(portable.startsWith(path.resolve(root) + path.sep));
  const portableBefore = await fs.readFile(portable);
  const original = path.join(library, 'fixture-001', 'portrait.png');
  const moved = original + '.moved';
  const originalBefore = await fs.readFile(original);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.FANSERVICE_BROWSER_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    const complete = await page.request.post(seed.origin + '/api/oobe/complete');
    assert.ok(complete.ok(), await complete.text());
    await page.goto(seed.origin);
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Organization' }).click();
    await page.getByRole('button', { name: 'Stage linked .chpack', exact: true }).click();
    await page.getByRole('button', { name: 'Stage library' }).click();
    await page.getByText('Package ready on this computer.').waitFor();
    const packagePath = await page.locator('#linked-package-path').textContent();
    const container = await fs.realpath(path.dirname(packagePath));
    assert.equal(path.dirname(container), path.join(library, '.avtohmver-linked-packages'));
    const links = JSON.parse(await fs.readFile(path.join(container, 'links.json')));
    const source = links.find(link => path.normalize(link.path) === original);
    assert.ok(source);
    const [originalStat, linkStat] = await Promise.all([
      fs.stat(original, { bigint: true }), fs.stat(path.join(container, source.link), { bigint: true }),
    ]);
    assert.equal(linkStat.ino, originalStat.ino);
    assert.ok(originalStat.nlink >= 2n);

    await fs.rename(original, moved);
    await page.getByText('Managed package is no longer available.', { exact: false }).waitFor();
    assert.equal(await page.locator('#linked-package-path').isHidden(), true);
    await assert.rejects(fs.stat(container), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(moved), originalBefore);
    assert.deepEqual(await fs.readFile(portable), portableBefore);
    console.log('Browser staging verified hard links and live invalidation, preserving the moved original and portable export.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
