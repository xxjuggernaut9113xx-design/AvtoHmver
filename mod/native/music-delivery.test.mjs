import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {deliverServerMusic} from './music-delivery.mjs';
const audio=Buffer.alloc(44+16000);
audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);
audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);
audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);
const manifest=()=>({protocol:1,library_id:'neutral-library',track_id:1,recording_id:'sha1:'+createHash('sha1').update(audio).digest('hex'),duration:1,
  beatmap:{meta:{title:'Server neutral',duration:1,bpm:120,offset:0},beats:[{time:.5,type:'stroke'}],events:[]}});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'music-delivery-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {serverOrigin:'http://127.0.0.1:42169',trackId:1,outputDirectory:path.join(root,'pack')};}
test('delivers exact confirmed Server WAV into original music layout',async t=>{
  const args=await fixture(t),calls=[];
  const result=await deliverServerMusic({...args,fetch:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return url.endsWith('/stream')?new Response(audio):Response.json(manifest());}});
  assert.equal(result.converted,false);assert.equal(result.source_recording_id,result.recording_id);assert.equal(calls.length,3);
  assert.deepEqual(await fs.readFile(path.join(args.outputDirectory,'song.wav')),audio);
});
test('rejects changed recording and publishes no pack',async t=>{
  const args=await fixture(t);await assert.rejects(deliverServerMusic({...args,fetch:async url=>url.endsWith('/stream')?new Response('changed'):Response.json(manifest())}),/recording changed/);
  await assert.rejects(fs.stat(args.outputDirectory),{code:'ENOENT'});
});
test('rejects a confirmation changed during delivery',async t=>{
  const args=await fixture(t);let count=0;
  await assert.rejects(deliverServerMusic({...args,fetch:async url=>{if(url.endsWith('/stream'))return new Response(audio);const m=manifest();if(++count===2)m.beatmap.meta.title='Changed';return Response.json(m);}}),/changed during delivery/);
});
test('retains existing library folder without making network requests',async t=>{
  const args=await fixture(t);await fs.mkdir(args.outputDirectory);await fs.writeFile(path.join(args.outputDirectory,'keep'),'retained');
  await assert.rejects(deliverServerMusic({...args,fetch:()=>{throw Error('Must not fetch');}}),/retained/);
  assert.deepEqual(await fs.readdir(args.outputDirectory),['keep']);
});
test('bounds response bodies and rejects unexpected Server identity',async t=>{
  const args=await fixture(t);
  await assert.rejects(deliverServerMusic({...args,fetch:async()=>new Response('{}',{headers:{'content-length':'5000000'}})}),/limit/);
  await assert.rejects(deliverServerMusic({...args,fetch:async()=>Response.json({...manifest(),track_id:2})}),/identity/);
  await assert.rejects(deliverServerMusic({...args,serverOrigin:'http://example.com'}),/HTTPS/);
});
