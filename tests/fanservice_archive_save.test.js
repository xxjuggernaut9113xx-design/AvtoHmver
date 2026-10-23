const {test}=require('node:test');
const assert=require('node:assert/strict');
const {save}=require('../static/fanservice/archive-save.js');

test('injected Android bridge works without the bundled registerPlugin API',async()=>{
 const previous=globalThis.Capacitor,native=destination();
 globalThis.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,Plugins:{ArchiveSave:native}};
 try{assert.equal((await save(new Blob(['bridge']),'bridge.chpack')).verified,true);}
 finally{globalThis.Capacitor=previous;}
});

function destination({cancelled=false,failAt=-1}={}){
 const parts=[],calls=[];
 return {parts,calls,
  async begin(options){calls.push(['begin',options]);return {token:'test-save'};},
  async append(options){calls.push(['append',options.offset]);if(parts.length===failAt)throw Error('Storage exhausted.');parts.push(Buffer.from(options.data,'base64'));},
  async finish(){calls.push(['finish']);return {cancelled,verified:true,bytes:parts.reduce((n,p)=>n+p.length,0)};},
  async abort(options){calls.push(['abort',options.token]);}
 };
}
test('native archive transport preserves exact bytes across bounded chunks and releases staging',async()=>{
 const bytes=Buffer.alloc(500123);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const native=destination();const result=await save(new Blob([bytes]),'test.chpack',{native});
 assert(result.verified);assert.deepEqual(Buffer.concat(native.parts),bytes);
 assert(native.parts.every(p=>p.length<=192*1024));
 assert.deepEqual(native.calls.filter(c=>c[0]==='append').map(c=>c[1]),[0,196608,393216]);
 assert.deepEqual(native.calls.at(-1),['abort','test-save']);
});
test('native picker cancellation releases staging and reports cancellation',async()=>{
 const native=destination({cancelled:true});
 await assert.rejects(save(new Blob(['archive']),'test.chpack',{native}),{name:'AbortError'});
 assert.equal(native.calls.at(-1)[0],'abort');
});
test('failed writes never invoke the picker or report success',async()=>{
 const native=destination({failAt:0});
 await assert.rejects(save(new Blob(['archive']),'test.chpack',{native}),/Storage exhausted/);
 assert(!native.calls.some(c=>c[0]==='finish'));assert.equal(native.calls.at(-1)[0],'abort');
});
test('cancellation during staging cleans up before opening a destination',async()=>{
 const native=destination(),controller=new AbortController();
 await assert.rejects(save(new Blob([Buffer.alloc(400000)]),'test.chpack',{
  native,signal:controller.signal,progress:()=>controller.abort()
 }),{name:'AbortError'});
 assert(!native.calls.some(c=>c[0]==='finish'));assert.equal(native.calls.at(-1)[0],'abort');
});
test('verification failure and missing native support cannot report a completed save',async()=>{
 const native=destination();native.finish=async()=>({bytes:7,verified:false});
 await assert.rejects(save(new Blob(['archive']),'test.chpack',{native}),/verification failed/);
 await assert.rejects(save(new Blob(['archive']),'test.chpack',{native:null}),/no archive saving support/);
});
