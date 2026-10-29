import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const events = new Set(['media_change','cycle_media','speed_change','background','text','disable_break','restore_break','grant_break','dialogue','edge','cum_event']);

export function originalBeatmap(manifest, audioFile) {
  const map = manifest?.beatmap, meta = map?.meta;
  if (!object(manifest) || manifest.protocol !== 1 || !/^sha1:[a-f0-9]{40}$/.test(manifest.recording_id) ||
      !Number.isFinite(manifest.duration) || manifest.duration <= 0 || manifest.duration > 86400 ||
      !object(map) || !object(meta) || !Number.isFinite(meta.duration) || Math.abs(meta.duration-manifest.duration) > .1 ||
      !Number.isFinite(meta.bpm) || meta.bpm < 20 || meta.bpm > 400 || (meta.offset !== undefined && meta.offset !== 0) ||
      !Array.isArray(map.beats) || !map.beats.length || map.beats.length > 100000 || !Array.isArray(map.events) || map.events.length > 10000)
    throw Error('A confirmed recording-bound Server music manifest is required.');
  if (audioFile !== 'song.wav') throw Error('The original music loader requires song.wav.');
  const rows = (values, allowed) => {
    let previous = -1;
    return values.map(row => {
      if (!object(row) || !Number.isFinite(row.time) || row.time < 0 || row.time < previous || row.time > manifest.duration || !allowed.has(row.type))
        throw Error('Invalid or unordered original music event.');
      previous = row.time;
      const result = {time:row.time,type:row.type};
      if (row.duration !== undefined) {
        if (!Number.isFinite(row.duration) || row.duration < 0 || row.time+row.duration > manifest.duration)
          throw Error('Original music event duration exceeds its recording.');
        result.duration = row.duration;
      }
      if (row.value !== undefined) {
        if (!['string','number','boolean'].includes(typeof row.value) || typeof row.value === 'number' && !Number.isFinite(row.value) || String(row.value).length > 2000)
          throw Error('Invalid original music event value.');
        result.value = String(row.value);
      }
      return result;
    });
  };
  const text = value => typeof value === 'string' ? value.slice(0,160) : '';
  return {meta:{title:text(meta.title) || 'fanservice soundtrack',artist:text(meta.artist),author:text(meta.author) || 'fanservice',audioFile,duration:manifest.duration,bpm:meta.bpm,offset:0},
    beats:rows(map.beats,new Set(['stroke','rest','accent'])),events:rows(map.events,events)};
}

export function validateWave(bytes, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw Error('A positive confirmed WAV duration is required.');
  if (bytes.length < 44 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WAVE' ||
      bytes.toString('ascii',12,16) !== 'fmt ' || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1)
    throw Error('Original music requires a PCM WAV with a standard first fmt chunk.');
  const channels=bytes.readUInt16LE(22),rate=bytes.readUInt32LE(24),align=bytes.readUInt16LE(32);
  if (![1,2].includes(channels) || rate < 8000 || rate > 192000 || bytes.readUInt16LE(34) !== 16 || align !== channels*2 || bytes.readUInt32LE(28) !== rate*align || bytes.readUInt32LE(4)+8 !== bytes.length)
    throw Error('Original music export supports mono/stereo 16-bit PCM WAV.');
  let data=null;
  for (let cursor=12;cursor+8<=bytes.length;) {
    const length=bytes.readUInt32LE(cursor+4),end=cursor+8+length;
    if (end>bytes.length) throw Error('WAV chunk exceeds recording bounds.');
    if (data===null && length%2) throw Error('Original music loader cannot safely skip odd-sized WAV chunks.');
    if (bytes.toString('ascii',cursor,cursor+4)==='data') {
      if (data!==null) throw Error('Multiple WAV data chunks are unsupported.');
      data=length;
    }
    cursor=end+(length%2);
  }
  if (!data || data%align || Math.abs(data/(rate*align)-duration)>.1) throw Error('WAV duration does not match the confirmed recording.');
}

async function regular(file, limit) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size <= 0 || before.size > limit)
    throw Error('Music export requires bounded regular source files.');
  const handle = await fs.open(file,'r');
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw Error('Music source changed while opening.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== before.size) throw Error('Music source changed while reading.');
    return bytes;
  } finally { await handle.close(); }
}

export async function exportMusicPack({manifestFile,audioFile,outputDirectory,assertCurrent=async()=>{}}) {
  await assertCurrent();
  for (const value of [manifestFile,audioFile,outputDirectory]) if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('Absolute source and destination paths are required.');
  const manifest = JSON.parse((await regular(manifestFile,4*1024*1024)).toString('utf8'));
  const filename = 'song'+path.extname(audioFile).toLowerCase();
  const map = originalBeatmap(manifest,filename);
  const audio = await regular(audioFile,256*1024*1024);
  if ('sha1:'+createHash('sha1').update(audio).digest('hex') !== manifest.recording_id) throw Error('Recording bytes do not match the confirmed beatmap.');
  validateWave(audio,manifest.duration);
  let ancestor = path.dirname(outputDirectory);
  for (;;) {
    const stat = await fs.lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Music destination ancestors must be existing directories without links.');
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  await assertCurrent();
  await fs.mkdir(outputDirectory);
  const written = [];
  try {
    for (const [name,bytes] of [[filename,audio],['beatmap.json',JSON.stringify(map,null,2)+'\n']]) {
      await assertCurrent();
      const destination = path.join(outputDirectory,name), handle = await fs.open(destination,'wx',0o600);
      written.push(destination);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    }
    await assertCurrent();
  } catch (error) {
    for (const file of written.reverse()) await fs.unlink(file).catch(()=>{});
    await fs.rmdir(outputDirectory).catch(()=>{});
    throw error;
  }
  return {directory:outputDirectory,recording_id:manifest.recording_id,beats:map.beats.length,events:map.events.length,audio_file:filename,native_acceptance:'pending'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifestFile,audioFile,outputDirectory,...extra] = process.argv.slice(2);
  if (extra.length || !outputDirectory) { process.stderr.write('Usage: node music-pack.mjs ABSOLUTE_MANIFEST ABSOLUTE_RECORDING NEW_ABSOLUTE_DIRECTORY\n'); process.exitCode = 2; }
  else { try { console.log(JSON.stringify(await exportMusicPack({manifestFile,audioFile,outputDirectory}),null,2)); } catch (error) { process.stderr.write(error.message+'\n'); process.exitCode = 1; } }
}
