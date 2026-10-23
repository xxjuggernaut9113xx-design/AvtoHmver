const {test}=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
const chpack=require('../static/fanservice/chpack.js');
function inspect(bytes){const result=spawnSync('python',['-c',"import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({'names':z.namelist(),'manifest':json.loads(z.read('manifest.json')),'media':[list(z.read(n)) for n in z.namelist() if n.startswith('media/')]}))"],{input:Buffer.from(bytes),encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
const origin='https://library.example';
const pack={name:'Phone pack',description:'Portable',unlock_cost:9,cover_id:'local:one'};
const media=[{id:'local:one',local:true,file:'a.png',type:'image',tags:['slow','fast','slow','position:front'],url:'blob:https://phone.example/one'},{id:2,file:'b.mp4',type:'video',tags:['medium'],url:'/api/media/2/stream'}];
test('on-device mixed export preserves bytes, cover, counts and metadata with a standard ZIP reader',async()=>{
 const calls=[];const blob=await chpack.create(pack,media,{origin,fetchMedia:async(url,opts)=>{calls.push({url:String(url),opts});return new Response(new Uint8Array([calls.length,0,255]));}});
 const result=inspect(await blob.arrayBuffer());assert.deepEqual(result.names,['media/0_fast_position-front_slow.png','media/1_medium.mp4','preview.png','manifest.json']);
 assert.deepEqual(result.media,[[1,0,255],[2,0,255]]);assert.equal(result.manifest.preview,'preview.png');assert.equal(result.manifest.unlock_cost,9);assert.equal(result.manifest.image_count,1);assert.equal(result.manifest.video_count,1);assert.equal(result.manifest.total_media,2);
 assert.equal(result.manifest.version,'0.02a');assert.equal(JSON.stringify(result.manifest).includes('https:'),false);assert.equal(JSON.stringify(result.manifest).includes('owned'),false);assert.equal(calls[0].url,media[0].url);assert.equal(calls[1].url,origin+'/api/media/2/stream');assert(calls.every(c=>c.opts.method===undefined&&c.opts.body===undefined));
});
test('missing media, foreign URLs, invalid names and cancelled operations never return partial archives',async()=>{
 await assert.rejects(chpack.create(pack,media,{origin,fetchMedia:async()=>new Response('',{status:404})}),/download failed/);
 await assert.rejects(chpack.create(pack,[{...media[0],url:origin+'/upload'}],{origin}),/local device/);
 await assert.rejects(chpack.create(pack,[{...media[1],url:'https://foreign.example/file'}],{origin}),/library/);
 const controller=new AbortController();controller.abort();await assert.rejects(chpack.create(pack,media,{origin,signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(chpack.create({...pack,name:''},media,{origin}),/pack name/);
 await assert.rejects(chpack.create(pack,[{...media[0],file:'bad.exe'}],{origin}),/Unsupported/);
});
test('ZIP checksum matches the published CRC-32 check value',()=>assert.equal(chpack.crc32(new TextEncoder().encode('123456789')),0xcbf43926));
test('saved pack import round trips mixed media and rejects corrupt or conflicting ZIP data',async()=>{
 const blob=await chpack.create(pack,media,{origin,fetchMedia:async()=>new Response(new Uint8Array([1,2,3]))});
 const imported=await chpack.unpack(blob);assert.equal(imported.manifest.name,pack.name);assert.equal(imported.manifest.unlock_cost,9);assert.equal(imported.files.length,2);assert.deepEqual([...new Uint8Array(await imported.files[1].arrayBuffer())],[1,2,3]);
 const bytes=new Uint8Array(await blob.arrayBuffer());const bad=bytes.slice();bad[30+new DataView(bytes.buffer).getUint16(26,true)]^=1;await assert.rejects(chpack.unpack(new Blob([bad])),/integrity/);
 const conflicting=bytes.slice();conflicting[30]^=1;await assert.rejects(chpack.unpack(new Blob([conflicting])),/Conflicting/);
 await assert.rejects(chpack.unpack(new Blob([bytes.subarray(0,20)])),/ZIP/);
});
test('compressed pack import checks expansion, checksums and manifest media',async()=>{
 const result=spawnSync('python',['-c',"import sys,io,zipfile,json; b=io.BytesIO(); z=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED); z.writestr('manifest.json',json.dumps(dict(name='Compressed',description='',unlock_cost=0,media=[dict(file='0_slow.png',type='image')]))); z.writestr('media/0_slow.png',b'abc'*100); z.close(); sys.stdout.buffer.write(b.getvalue())"]);assert.equal(result.status,0);const imported=await chpack.unpack(new Blob([result.stdout]));assert.equal(imported.files[0].size,300);
});
