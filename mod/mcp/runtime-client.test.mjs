import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {BUILD, RuntimeClient} from './runtime-client.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanservice-mcp-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  return directory;
}
async function peer(directory, transform = value => value, previousNonce = null) {
  const slot = path.join(directory, '.fanservice-mcp.request');
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const packet = await fs.readFile(slot, 'utf8');
      const match = /^FANSERVICE_MCP_1\n([a-f0-9]{32})\n([0-9]+)\n(status|catalog|profile|enablefixture|probevideo|probeaudio|probeaudiocontrols|probeaudiooffline|probebeatqueue|rhythmstate|probeaudioreconcilestream|probeaudiofinalization|probeaudioreconcile|probeaudioclock|probeclock|clockstatus|stopclock)\n$/.exec(packet);
      assert.ok(match);
      if (match[1] === previousNonce) { await delay(5); continue; }
      const target = path.join(directory, '.fanservice-mcp.response.' + match[1]);
      const message = transform({protocol: 1, nonce: match[1], build_id: BUILD, ok: true, result: {action: match[3]}});
      await fs.writeFile(target + '.tmp', typeof message === 'string' ? message : JSON.stringify(message));
      await fs.rename(target + '.tmp', target);
      return {packet, target};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(5);
  }
  throw Error('Fixture request never arrived.');
}

test('roundtrip uses fixed protocol, exact build and cleans only owned IPC files', async t => {
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, 'unrelated.txt'), 'retain');
  const native = peer(directory);
  const result = await new RuntimeClient(directory).request('catalog');
  await native;
  assert.deepEqual(result, {action: 'catalog'});
  assert.deepEqual(await fs.readdir(directory), ['unrelated.txt']);
});

test('timeout and cancellation clean owned slot and lock', async t => {
  const directory = await fixture(t);
  const runtime = new RuntimeClient(directory, {timeoutMs: 100, pollMs: 5});
  await assert.rejects(runtime.request('status'), /timed out/);
  assert.deepEqual(await fs.readdir(directory), []);
  const controller = new AbortController();
  const pending = runtime.request('profile', {signal: controller.signal});
  await delay(20);
  controller.abort();
  await assert.rejects(pending, /abort/i);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('foreign nonce and unsupported build responses fail closed and are retained', async t => {
  for (const field of ['nonce', 'build_id', 'protocol']) {
    const directory = await fixture(t);
    const native = peer(directory, value => ({...value, [field]: field === 'protocol' ? 2 : 'foreign'}));
    await assert.rejects(new RuntimeClient(directory).request('status'), /identity/);
    const {target} = await native;
    assert.deepEqual(await fs.readdir(directory), [path.basename(target)]);
  }
});

test('malformed and oversized responses are rejected without parsing or removing foreign data', async t => {
  for (const data of ['{broken', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    const directory = await fixture(t);
    const native = peer(directory, () => data);
    await assert.rejects(new RuntimeClient(directory).request('status'), /malformed|size limit/);
    await native;
    assert.equal((await fs.readdir(directory)).length, 1);
  }
});

test('matching native errors and invalid results are cleaned without reporting success', async t => {
  for (const transform of [value => ({...value, ok: false, error: 'Active profile unavailable.'}),
    value => ({...value, result: []})]) {
    const directory = await fixture(t);
    const native = peer(directory, transform);
    await assert.rejects(new RuntimeClient(directory).request('profile'), /profile unavailable|invalid result/);
    await native;
    assert.deepEqual(await fs.readdir(directory), []);
  }
});

test('two independent clients serialize through the shared lock', async t => {
  const directory = await fixture(t);
  const first = new RuntimeClient(directory), second = new RuntimeClient(directory);
  const native = (async () => {
    const firstReply = await peer(directory);
    await peer(directory, value => value, firstReply.packet.split('\n')[1]);
  })();
  const results = await Promise.all([first.request('status'), second.request('profile')]);
  await native;
  assert.deepEqual(results.map(value => value.action), ['status', 'profile']);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('existing foreign request and lock cannot be overwritten or removed', async t => {
  const directory = await fixture(t);
  const request = path.join(directory, '.fanservice-mcp.request');
  await fs.writeFile(request, 'foreign request');
  await assert.rejects(new RuntimeClient(directory).request('status'), /existing IPC request/);
  assert.equal(await fs.readFile(request, 'utf8'), 'foreign request');
  await fs.unlink(request);
  const lock = path.join(directory, '.fanservice-mcp.lock');
  await fs.writeFile(lock, 'foreign lock');
  await assert.rejects(new RuntimeClient(directory, {timeoutMs: 100}).request('status'), /timed out/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'foreign lock');
});

test('only explicitly listed actions and absolute runtime roots are accepted', async t => {
  const directory = await fixture(t);
  assert.throws(() => new RuntimeClient('relative'), /absolute/);
  for (const action of ['purchase', 'enable', 'disable', 'exec', '../catalog']) {
    await assert.rejects(new RuntimeClient(directory).request(action), /Unsupported/);
  }
  assert.deepEqual(await fs.readdir(directory), []);
});

test('linked runtime directories and response files are rejected', async t => {
  const directory = await fixture(t);
  const root = await fixture(t);
  const link = path.join(root, 'runtime');
  try { await fs.symlink(directory, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Host lacks link privilege.'); throw error; }
  await assert.rejects(new RuntimeClient(link).request('status'), /link/);
  const native = (async () => {
    const slot = path.join(directory, '.fanservice-mcp.request');
    for (;;) {
      try {
        const nonce = (await fs.readFile(slot, 'utf8')).split('\n')[1];
        const external = path.join(root, 'response.json');
        await fs.writeFile(external, '{}');
        const response = path.join(directory, '.fanservice-mcp.response.' + nonce);
        // A junction is enough to exercise the non-regular response guard on Windows.
        await fs.symlink(process.platform === 'win32' ? root : external, response, process.platform === 'win32' ? 'junction' : 'file');
        return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(5);
    }
  })();
  await assert.rejects(new RuntimeClient(directory).request('status'), /link|non-regular/);
  await native;
});

test('real MCP stdio connection distinguishes diagnostics and fixed synthetic actions', async t => {
  const directory = await fixture(t);
  const client = new Client({name: 'native-bridge-test', version: '1.0.0'});
  const transport = new StdioClientTransport({command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--runtime-dir', directory]});
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(tool => tool.name), ['native_status', 'native_catalog', 'native_profile', 'native_rhythm_state', 'native_beat_clock_status', 'native_enable_fixture', 'native_probe_video', 'native_probe_beat_queue', 'native_probe_streamed_audio_reconciliation', 'native_probe_audio_finalization', 'native_probe_audio_reconciliation', 'native_probe_audio_beat_clock', 'native_probe_beat_clock', 'native_stop_beat_clock', 'native_probe_audio_offline', 'native_probe_audio_controls', 'native_probe_audio']);
    assert.ok(listing.tools.every(tool => !tool.annotations.destructiveHint));
    assert.ok(listing.tools.slice(0, 5).every(tool => tool.annotations.readOnlyHint));
    assert.equal(listing.tools[5].annotations.readOnlyHint, false);
    assert.equal(listing.tools[5].annotations.idempotentHint, true);
    assert.equal(listing.tools[6].annotations.readOnlyHint, false);
    assert.equal(listing.tools[6].annotations.idempotentHint, false);
    const native = peer(directory);
    const reply = await client.callTool({name: 'native_catalog', arguments: {}});
    await native;
    assert.equal(reply.structuredContent.action, 'catalog');
    for (const [name, action] of [['native_probe_streamed_audio_reconciliation','probeaudioreconcilestream'], ['native_probe_audio_finalization','probeaudiofinalization'], ['native_probe_audio_reconciliation','probeaudioreconcile'], ['native_probe_audio_beat_clock','probeaudioclock'], ['native_beat_clock_status','clockstatus'], ['native_probe_beat_clock','probeclock'], ['native_stop_beat_clock','stopclock'], ['native_rhythm_state','rhythmstate'], ['native_enable_fixture', 'enablefixture'], ['native_probe_video', 'probevideo'], ['native_probe_audio', 'probeaudio'], ['native_probe_audio_controls','probeaudiocontrols'], ['native_probe_audio_offline','probeaudiooffline'], ['native_probe_beat_queue','probebeatqueue']]) {
      const nativeAction = peer(directory);
      const actionReply = await client.callTool({name, arguments: {}});
      await nativeAction;
      assert.equal(actionReply.structuredContent.action, action);
      const invalid = await client.callTool({name, arguments: {id: 'foreign-pack', url: 'https://foreign.example/video.mp4'}});
      assert.equal(invalid.isError, true);
      assert.deepEqual(await fs.readdir(directory), []);
    }
    const rejected = await client.callTool({name: 'native_purchase', arguments: {}});
    assert.equal(rejected.isError, true);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await client.close(); }
});
