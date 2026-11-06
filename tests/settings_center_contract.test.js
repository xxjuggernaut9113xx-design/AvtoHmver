const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('settings center exposes every durable tab and storage action', () => {
  const html = read('static/index.html');
  for (const tab of ['general', 'media-storage', 'appearance', 'playback-goon', 'automation', 'local-admin']) {
    assert.match(html, new RegExp(`data-settings-tab="${tab}"`));
    assert.match(html, new RegExp(`data-settings-tab-panel="${tab}"`));
  }
  for (const id of [
    'settings-max-download-size-preset',
    'settings-max-source-storage-preset',
    'settings-minimum-free-disk',
    'settings-thumbnail-cache-limit',
    'settings-automatic-cleanup-mode',
    'settings-clear-thumbnails',
    'settings-clear-archives',
    'settings-export-sources',
    'settings-local-admin',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const bytes of [25, 50, 100, 250, 500, 1024]) {
    assert.match(html, new RegExp(`value="${bytes * 1024 * 1024}"`));
  }
  assert.match(html, /value="unlimited"/);
  assert.match(html, /value="custom"/);
});

test('settings runtime reconciles voices and admin visibility', () => {
  const app = read('static/app.js');
  const library = read('static/library.js');
  assert.match(app, /voiceschanged/);
  assert.match(app, /preserve|selected/i);
  assert.match(app, /boundedNumber\(el\('#settings-tts-rate'\),\s*0\.1,\s*3,\s*1\)/);
  assert.match(app, /boundedNumber\(el\('#settings-tts-pitch'\),\s*0,\s*2,\s*1\)/);
  assert.match(app, /boundedNumber\(el\('#settings-tts-volume'\),\s*0,\s*1,\s*1\)/);
  assert.match(app, /window\.stopLocalAdminPolling/);
  assert.match(app, /startup_registration/);
  assert.match(app, /ENABLE RETENTION/);
  assert.match(app, /ENABLE AUTOMATIC CLEANUP/);
  assert.match(app, /retention_confirmation\s*=\s*confirmation/);
  assert.match(app, /automatic_cleanup_confirmation\s*=\s*confirmation/);
  assert.match(app, /archive_retention_confirmation\s*=\s*confirmation/);
  assert.match(library, /window\.isSettingsTabActive\?\.\('local-admin'\)/);
  assert.match(library, /document\.hidden/);
  assert.match(library, /window\.renderSettingsLocalAdmin/);
  assert.doesNotMatch(library, /explorer-admin-nav|data-nav=["']admin["']/);
});

test('Admin keeps showing backup and restore progress during classifier unavailability', async () => {
  const library = read('static/library.js');
  const begin = library.indexOf('async function refreshAdminPanel(');
  const end = library.indexOf('function renderAdminPanel(', begin);
  const nodes = new Map(['#admin-status', '#admin-phar', '#admin-backup-list', '#admin-job-list']
    .map(id => [id, { textContent: '' }]));
  const seen = {};
  let classifierAvailable = false;
  const context = vm.createContext({
    window: { isSettingsTabActive: tab => tab === 'local-admin' },
    document: { hidden: false },
    explorerEl: id => nodes.get(id),
    api: async route => {
      if (route.endsWith('backups')) return { backups: [{ id: 'safety.zip' }] };
      if (route.endsWith('jobs')) return { jobs: [{ phase: 'succeeded', restart_required: true }] };
      if (!classifierAvailable) throw new Error('A local maintenance job is active');
      return { phase: 'ready' };
    },
    stopAdminPolling() { seen.stopped = true; },
    renderAdminPhar(target, data) { seen.phar = data; },
    renderAdminBackups(target, data) { seen.backups = data; },
    renderAdminJobs(target, data) { seen.jobs = data; },
  });
  new vm.Script(library.slice(begin, end)).runInContext(context);
  const panel = { isConnected: true };
  await context.refreshAdminPanel(panel);
  assert.equal(seen.backups[0].id, 'safety.zip');
  assert.equal(seen.jobs[0].restart_required, true);
  assert.match(nodes.get('#admin-status').textContent, /maintenance job is active/);
  assert.equal(seen.stopped, undefined);
  classifierAvailable = true;
  await context.refreshAdminPanel(panel);
  assert.equal(seen.phar.phase, 'ready');
  assert.equal(nodes.get('#admin-status').textContent, '');
});

test('asynchronous browser voice discovery preserves the saved selection', async () => {
  const app = read('static/app.js');
  const begin = app.lastIndexOf('function populateTtsVoiceSelect');
  const end = app.indexOf('function renderStartupRegistration', begin);
  assert.ok(begin >= 0 && end > begin, 'voice helpers must remain independently testable');

  const select = {
    options: [],
    value: '',
    replaceChildren(...options) { this.options = options; },
    add(option) { this.options.push(option); },
  };
  const listeners = new Map();
  const voiceState = { voices: [] };
  const context = vm.createContext({
    appSettings: { tts_voice: 'Saved voice' },
    settingsVoiceListenerInstalled: false,
    el: (selector) => selector === '#settings-tts-voice' ? select : null,
    Option: function Option(text, value) { this.text = text; this.value = value; },
    window: {
      speechSynthesis: {
        getVoices: () => voiceState.voices,
        addEventListener: (event, listener) => listeners.set(event, listener),
      },
    },
    Promise,
  });
  new vm.Script(app.slice(begin, end)).runInContext(context);

  context.populateTtsVoiceSelect('Saved voice');
  assert.equal(select.value, 'Saved voice');
  assert.match(select.options.at(-1).text, /unavailable/);

  context.installSpeechVoiceListener();
  voiceState.voices = [
    { name: 'Saved voice', lang: 'en-US' },
    { name: 'Other voice', lang: 'en-GB' },
  ];
  listeners.get('voiceschanged')();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(select.value, 'Saved voice');
  assert.deepEqual(select.options.map((option) => option.value), ['', 'Saved voice', 'Other voice']);
  assert.doesNotMatch(select.options[1].text, /unavailable/);
});
