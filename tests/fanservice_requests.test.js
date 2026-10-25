const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
for(const file of ['app.js','play.js']){
 const source=fs.readFileSync(require.resolve('../static/fanservice/'+file),'utf8'),start=source.indexOf('async function api('),end=source.indexOf('\nfunction bridge()',start);
 const code=file==='app.js'?source.slice(start,end):source.slice(start,source.indexOf('\nasync function readJSON',start));
 function setup(fetch){const store={server:()=> 'https://fixture.invalid'},context={fetch,URL,AbortController,setTimeout:fn=>setTimeout(fn,15),clearTimeout,FanserviceStore:store,store};vm.createContext(context);vm.runInContext(code,context);return context.api;}
 test(file+' request timeout covers stalled response bodies',{timeout:1000},async()=>{
  const api=setup(async(url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('body aborted')),{once:true}))}));
  await assert.rejects(api('/api/test'),/timed out/);
 });
 test(file+' preserves successful JSON and server failures',async()=>{
  assert.equal((await setup(async()=>({ok:true,json:async()=>({result:42})}))('/api/test')).result,42);
  await assert.rejects(setup(async()=>({ok:false,status:401,json:async()=>({error:'authorization expired'})}))('/api/test'),/authorization expired/);
 });
}
