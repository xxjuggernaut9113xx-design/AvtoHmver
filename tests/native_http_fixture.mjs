import http from 'node:http';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {lstat, realpath} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';

const input = process.argv[2];
if (!input || !path.isAbsolute(input)) throw Error('Provide the absolute isolated synthetic-http directory.');
const root = await realpath(input);
const files = new Map();
for (const [name, type] of [['synthetic-tone.m4a', 'audio/mp4'], ['synthetic.mp4', 'video/mp4']]) {
  const file = path.join(root, name), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024) throw Error('Invalid bounded neutral fixture file.');
  files.set('/' + name, {file, size: stat.size, type});
}
const server = http.createServer(async (request, response) => {
  const selected = files.get(request.url);
  if (!selected || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return; }
  let start = 0, end = selected.size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
    if (match) { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= selected.size) {
      response.writeHead(416, {'Content-Range': `bytes */${selected.size}`}).end(); return;
    }
    end = Math.min(end, selected.size - 1); status = 206;
  }
  const headers = {'Content-Type': selected.type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${selected.size}`;
  response.writeHead(status, headers);
  process.stdout.write(JSON.stringify({method: request.method, file: request.url, status, start, end}) + '\n');
  if (request.method === 'HEAD') { response.end(); return; }
  try { await pipeline(createReadStream(selected.file, {start, end}), response); }
  catch (error) { if (!response.destroyed) response.destroy(error); }
});
const stop = () => { server.closeAllConnections(); server.close(); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
server.listen(42170, '127.0.0.1', () => process.stdout.write('Neutral HTTP fixture ready on loopback:42170.\n'));
setTimeout(stop, 120000).unref();
