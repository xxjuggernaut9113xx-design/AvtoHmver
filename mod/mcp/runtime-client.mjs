import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export const BUILD = 'v004-exclusive-c645757d';
const LIMIT = 4 * 1024 * 1024;
const actions = new Set(['status', 'catalog', 'profile', 'enablefixture', 'probevideo', 'probeaudio', 'probeaudiocontrols', 'probeaudiooffline', 'probebeatqueue', 'rhythmstate', 'probeaudioreconcile', 'probeaudioclock', 'probeclock', 'clockstatus', 'stopclock']);

async function checkedDirectory(directory) {
  if (!path.isAbsolute(directory)) throw Error('Runtime directory must be absolute.');
  let current = path.resolve(directory);
  for (;;) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Runtime directory contains a link or non-directory.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function readRegular(file, limit) {
  const before = await fs.lstat(file);
  if (before.isSymbolicLink() || !before.isFile()) throw Error('IPC file is a link or non-regular file.');
  if (before.size > limit) throw Error('IPC file exceeds its size limit.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw Error('IPC file changed while opening.');
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > limit) throw Error('IPC file exceeds its size limit.');
    return bytes.subarray(0, count).toString('utf8');
  } finally { await handle.close(); }
}

async function removeMatching(file, expected, limit) {
  try {
    if (await readRegular(file, limit) === expected) await fs.unlink(file);
  } catch (error) {
    if (error.code !== 'ENOENT') return;
  }
}

export class RuntimeClient {
  constructor(directory, {timeoutMs = 15000, pollMs = 25} = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('Runtime directory must be absolute.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw Error('Timeout must be 100–60000 milliseconds.');
    if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw Error('Invalid polling interval.');
    this.directory = path.resolve(directory);
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
  }

  async request(action, {signal} = {}) {
    if (!actions.has(action)) throw Error('Unsupported native runtime action.');
    signal?.throwIfAborted();
    await checkedDirectory(this.directory);
    const nonce = randomBytes(16).toString('hex');
    const request = path.join(this.directory, '.fanservice-mcp.request');
    const response = path.join(this.directory, '.fanservice-mcp.response.' + nonce);
    const temporary = path.join(this.directory, '.fanservice-mcp.request.tmp.' + nonce);
    const lock = path.join(this.directory, '.fanservice-mcp.lock');
    const owner = nonce + '\n';
    const packet = 'FANSERVICE_MCP_1\n' + nonce + '\n' + Math.floor(Date.now() / 1000) + '\n' + action + '\n';
    const deadline = Date.now() + this.timeoutMs;
    let locked = false, staged = false, published = false, responseText;
    const pause = async () => {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw Error('Native runtime timed out. Load the Fanservice mod or check its IPC lock.');
      await delay(Math.min(this.pollMs, Math.max(1, deadline - Date.now())), undefined, {signal});
    };
    try {
      for (;;) {
        signal?.throwIfAborted();
        try {
          const handle = await fs.open(lock, 'wx', 0o600);
          locked = true;
          try { await handle.writeFile(owner); await handle.sync(); } finally { await handle.close(); }
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          let stat;
          try { stat = await fs.lstat(lock); }
          catch (lookup) { if (lookup.code === 'ENOENT') { await pause(); continue; } throw lookup; }
          if (stat.isSymbolicLink() || !stat.isFile()) throw Error('IPC lock is a link or non-regular file.');
          await pause();
        }
      }
      await checkedDirectory(this.directory);
      try { await fs.lstat(request); throw Error('An existing IPC request was retained; inspect it before retrying.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const handle = await fs.open(temporary, 'wx', 0o600);
      staged = true;
      try { await handle.writeFile(packet); await handle.sync(); } finally { await handle.close(); }
      // The exclusive bridge lock serializes cooperating clients; never replace a stale request.
      await fs.link(temporary, request);
      published = true;
      await fs.unlink(temporary);
      staged = false;
      for (;;) {
        signal?.throwIfAborted();
        try {
          const text = await readRegular(response, LIMIT);
          let message;
          try { message = JSON.parse(text); } catch { throw Error('Native runtime returned malformed JSON.'); }
          if (!message || message.protocol !== 1 || message.nonce !== nonce || message.build_id !== BUILD) {
            throw Error('Native runtime response identity does not match this request and build.');
          }
          responseText = text;
          if (message.ok !== true) throw Error(typeof message.error === 'string' ? message.error : 'Native runtime rejected the request.');
          if (!message.result || typeof message.result !== 'object' || Array.isArray(message.result)) throw Error('Native runtime returned an invalid result.');
          return message.result;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await pause();
      }
    } finally {
      if (responseText !== undefined) await removeMatching(response, responseText, LIMIT);
      if (published) await removeMatching(request, packet, 512);
      if (staged) await removeMatching(temporary, packet, 512);
      if (locked) await removeMatching(lock, owner, 64);
    }
  }
}
