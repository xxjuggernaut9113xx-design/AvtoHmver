const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const {deliverServerMusic}=await import(pathToFileURL(path.resolve('mod/native/music-delivery.mjs')));
  const {validateWave}=await import(pathToFileURL(path.resolve('mod/native/music-pack.mjs')));
  const root=path.resolve(process.env.FANSERVICE_SMOKE_OUTPUT||'fanservice-ci-results');
  const outputDirectory=path.join(root,'native-server-music');
  const result=await deliverServerMusic({serverOrigin:process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169',trackId:1,outputDirectory,ffmpeg:process.env.FANSERVICE_NATIVE_FFMPEG});
  const map=JSON.parse(await fs.readFile(path.join(outputDirectory,'beatmap.json'),'utf8'));
  validateWave(await fs.readFile(path.join(outputDirectory,'song.wav')),12);
  assert.equal(map.meta.audioFile,'song.wav');assert.equal(map.meta.offset,0);assert.equal(result.converted,true);
  assert.equal(result.track_id,1);assert.notEqual(result.source_recording_id,result.recording_id);
  assert.ok(map.beats.length>0);assert.equal(result.native_acceptance,'pending');
  await fs.writeFile(path.join(root,'native-music-delivery.json'),JSON.stringify(result,null,2)+'\n');
  console.log('Real Server confirmed AAC -> native PCM WAV music delivery passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
