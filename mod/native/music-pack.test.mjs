import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {originalBeatmap,exportMusicPack,validateWave} from './music-pack.mjs';

const recording = Buffer.alloc(44+12*8000*2);
recording.write('RIFF',0);recording.writeUInt32LE(recording.length-8,4);recording.write('WAVEfmt ',8);
recording.writeUInt32LE(16,16);recording.writeUInt16LE(1,20);recording.writeUInt16LE(1,22);
recording.writeUInt32LE(8000,24);recording.writeUInt32LE(16000,28);recording.writeUInt16LE(2,32);recording.writeUInt16LE(16,34);
recording.write('data',36);recording.writeUInt32LE(recording.length-44,40);
const manifest = () => ({protocol:1,recording_id:'sha1:'+createHash('sha1').update(recording).digest('hex'),duration:12,
  beatmap:{meta:{title:'Neutral',duration:12,bpm:120,offset:0},beats:[{time:1,type:'stroke'}],events:[{time:2,type:'background',value:true}]}});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'fanservice-music-pack-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const manifestFile=path.join(root,'manifest.json'),audioFile=path.join(root,'source.wav'),outputDirectory=path.join(root,'pack');
  await fs.writeFile(manifestFile,JSON.stringify(manifest())); await fs.writeFile(audioFile,recording);
  return {root,manifestFile,audioFile,outputDirectory};
}
test('original layout retains absolute timestamps and relative audio, with string event values',()=>{
  const source=manifest(),before=JSON.stringify(source),map=originalBeatmap(source,'song.wav');
  assert.equal(map.meta.audioFile,'song.wav'); assert.equal(map.meta.offset,0);
  assert.deepEqual(map.beats,[{time:1,type:'stroke'}]); assert.equal(map.events[0].value,'true');
  assert.equal(JSON.stringify(source),before);
});
test('rejects unsafe names, unknown events, shifted or unordered maps',()=>{
  for(const name of ['../song.wav','C:\\song.wav','song.exe']) assert.throws(()=>originalBeatmap(manifest(),name));
  for(const mutate of [m=>m.beatmap.meta.offset=1,m=>m.beatmap.events[0].type='unknown',m=>m.beatmap.beats.push({time:0,type:'stroke'}),m=>m.beatmap.events[0].value={},m=>m.beatmap.meta.duration=14]) {
    const value=manifest();mutate(value);assert.throws(()=>originalBeatmap(value,'song.wav'));
  }
});
test('preserves native duration fields and rejects intervals beyond recording',()=>{
  const source=manifest();source.beatmap.beats[0].duration=.5;source.beatmap.events[0].duration=2;
  const map=originalBeatmap(source,'song.wav');assert.equal(map.beats[0].duration,.5);assert.equal(map.events[0].duration,2);
  source.beatmap.events[0].duration=11;assert.throws(()=>originalBeatmap(source,'song.wav'),/duration/);
});
test('rejects unsupported native audio instead of merely renaming it',()=>{
  validateWave(recording,12);assert.throws(()=>validateWave(recording,10),/duration/);
  assert.throws(()=>validateWave(Buffer.from('not a recording'),12),/PCM WAV/);
  const floating=Buffer.from(recording);floating.writeUInt16LE(3,20);assert.throws(()=>validateWave(floating,12),/PCM WAV/);
  const odd=Buffer.concat([recording.subarray(0,36),Buffer.from([74,85,78,75,1,0,0,0,0,0]),recording.subarray(36)]);
  odd.writeUInt32LE(odd.length-8,4);assert.throws(()=>validateWave(odd,12),/odd-sized/);
  assert.throws(()=>originalBeatmap(manifest(),'song.mp3'),/song.wav/);
});
test('exports the exact recording and publishes beatmap last without changing sources',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.manifestFile);
  const result=await exportMusicPack(f);
  assert.equal(result.native_acceptance,'pending');assert.equal(result.beats,1);
  assert.deepEqual(await fs.readFile(path.join(f.outputDirectory,'song.wav')),recording);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.outputDirectory,'beatmap.json'))).meta.title,'Neutral');
  assert.deepEqual(await fs.readFile(f.manifestFile),before);
});
test('rejects mismatched recordings before creating destination',async t=>{
  const f=await fixture(t);await fs.writeFile(f.audioFile,'different recording');
  await assert.rejects(exportMusicPack(f),/do not match/);await assert.rejects(fs.stat(f.outputDirectory),{code:'ENOENT'});
});
test('retains existing destination and every unowned file',async t=>{
  const f=await fixture(t);await fs.mkdir(f.outputDirectory);await fs.writeFile(path.join(f.outputDirectory,'keep'),'retained');
  await assert.rejects(exportMusicPack(f),{code:'EEXIST'});
  assert.deepEqual(await fs.readdir(f.outputDirectory),['keep']);
});
