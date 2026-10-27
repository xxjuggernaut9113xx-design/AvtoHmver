import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {exportMusicPack,originalBeatmap,validateWave} from './music-pack.mjs';

const run=promisify(execFile), sha1=bytes=>'sha1:'+createHash('sha1').update(bytes).digest('hex');
function origin(value) {
  const url=new URL(value);
  if(url.origin!==value || url.username || url.password || !['https:','http:'].includes(url.protocol) ||
    url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Use an HTTPS Server origin or loopback HTTP origin.');
  return url.origin;
}
async function download(fetch,url,limit,signal) {
  const response=await fetch(url,{redirect:'error',signal});
  if(response.status!==200 || !response.body) throw Error('Server music request failed: HTTP '+response.status);
  const declared=response.headers.get('content-length');
  if(declared!==null && (!/^\d+$/.test(declared)||Number(declared)>limit)) {await response.body.cancel();throw Error('Server music response exceeds its limit.');}
  const reader=response.body.getReader(),parts=[];let total=0;
  try {
    for (;;) {const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Error('Server music response exceeds its limit.');parts.push(Buffer.from(value));}
  } catch(error) {await reader.cancel().catch(()=>{});throw error;} finally {reader.releaseLock();}
  if(!total || declared!==null&&total!==Number(declared)) throw Error('Server music response is empty or truncated.');
  return Buffer.concat(parts,total);
}

export async function deliverServerMusic({serverOrigin,trackId,outputDirectory,ffmpeg,fetch=globalThis.fetch}) {
  const server=origin(serverOrigin);
  if(!Number.isSafeInteger(trackId)||trackId<1)throw Error('A positive Server track ID is required.');
  if(typeof outputDirectory!=='string'||!path.isAbsolute(outputDirectory))throw Error('A new absolute output pack directory is required.');
  // Fail before downloads when the caller selected an occupied destination.
  try {await fs.lstat(outputDirectory);throw Error('Existing music pack destination was retained.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const signal=AbortSignal.timeout(300000),manifestURL=server+`/api/fanservice/v1/music/${trackId}/manifest`;
  const manifest=JSON.parse((await download(fetch,manifestURL,4*1024*1024,signal)).toString('utf8'));
  if(manifest.track_id!==trackId||typeof manifest.library_id!=='string'||!manifest.library_id)throw Error('Server returned a different soundtrack identity.');
  originalBeatmap(manifest,'song.wav');
  const source=await download(fetch,server+`/api/music/tracks/${trackId}/stream`,256*1024*1024,signal);
  if(sha1(source)!==manifest.recording_id)throw Error('Server recording changed or does not match the confirmed beatmap.');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'fanservice-music-delivery-'));
  try {
    let audio=source,converted=false;
    try {validateWave(audio,manifest.duration);}catch(error){
      if(typeof ffmpeg!=='string'||!path.isAbsolute(ffmpeg))throw Error('This recording requires an absolute FFmpeg executable path for native PCM WAV conversion.',{cause:error});
      const executable=await fs.lstat(ffmpeg);if(!executable.isFile()||executable.isSymbolicLink())throw Error('FFmpeg must be an existing regular executable.');
      const input=path.join(temporary,'recording'),output=path.join(temporary,'converted.wav');
      await fs.writeFile(input,source,{flag:'wx'});
      await run(ffmpeg,['-nostdin','-v','error','-i',input,'-map_metadata','-1','-vn','-ar','44100','-ac','2','-c:a','pcm_s16le','-fs','268435456',output],{timeout:300000,maxBuffer:1024*1024,windowsHide:true});
      const stat=await fs.stat(output);if(stat.size>256*1024*1024)throw Error('Converted WAV exceeds the native export limit.');
      audio=await fs.readFile(output);validateWave(audio,manifest.duration);converted=true;
    }
    const latest=JSON.parse((await download(fetch,manifestURL,4*1024*1024,signal)).toString('utf8'));
    if(JSON.stringify(latest)!==JSON.stringify(manifest))throw Error('Confirmed soundtrack changed during delivery; retry.');
    const nativeManifest={...manifest,recording_id:sha1(audio)};
    const manifestFile=path.join(temporary,'manifest.json'),audioFile=path.join(temporary,'song.wav');
    await fs.writeFile(manifestFile,JSON.stringify(nativeManifest),{flag:'wx'});await fs.writeFile(audioFile,audio,{flag:'wx'});
    const result=await exportMusicPack({manifestFile,audioFile,outputDirectory});
    return {...result,source_recording_id:manifest.recording_id,library_id:manifest.library_id,track_id:trackId,converted,
      next_step:'Refresh the original Playlist library or restart the game; select and play through its original controls.'};
  } finally {await fs.rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [serverOrigin,id,outputDirectory,ffmpeg,...extra]=process.argv.slice(2);
  if(extra.length||!outputDirectory){process.stderr.write('Usage: node music-delivery.mjs SERVER_ORIGIN TRACK_ID NEW_ABSOLUTE_PACK_DIRECTORY [ABSOLUTE_FFMPEG]\n');process.exitCode=2;}
  else try{console.log(JSON.stringify(await deliverServerMusic({serverOrigin,trackId:Number(id),outputDirectory,ffmpeg}),null,2));}
  catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
