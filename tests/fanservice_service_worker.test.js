const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../static/fanservice/sw.js'),'utf8');
function worker(){
 const events={},data=new Map(),deleted=[];let claimed=false,network=async()=>new Response('online');
 const caches={keys:async()=>[...data.keys()],delete:async key=>{deleted.push(key);return data.delete(key);},open:async key=>{if(!data.has(key))data.set(key,new Map());const entries=data.get(key);return {addAll:async paths=>{for(const path of paths)entries.set(new URL(path,'https://test.invalid/fanservice/').href,new Response(key+':'+path));},match:async request=>entries.get(request.url)};}};
 const self={location:new URL('https://test.invalid/fanservice/sw.js'),addEventListener:(name,handler)=>events[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}}};
 vm.runInNewContext(source,{self,caches,URL,Request,Response,fetch:(...args)=>network(...args)});
 const lifecycle=async name=>{let promise;events[name]({waitUntil:value=>promise=value});await promise;};
 const request=async(url,method='GET')=>{let promise;events.fetch({request:new Request(url,{method}),respondWith:value=>promise=value});return promise;};
 return {data,deleted,lifecycle,request,setNetwork:value=>network=value,claimed:()=>claimed};
}

test('service worker retires only its older shell generations after current shell installation',async()=>{
 const w=worker();for(const key of ['fanservice-shell-v1','fanservice-shell-v13','unrelated-cache','fanservice-shell-custom'])w.data.set(key,new Map());
 await w.lifecycle('install');await w.lifecycle('activate');assert.deepEqual(w.deleted,['fanservice-shell-v1','fanservice-shell-v13']);assert.equal(w.claimed(),true);
 assert.equal(w.data.has('unrelated-cache'),true);assert.equal(w.data.has('fanservice-shell-custom'),true);
});

test('offline fetch uses the current shell rather than any older matching cache',async()=>{
 const w=worker();w.data.set('fanservice-shell-v1',new Map([['https://test.invalid/fanservice/rules.js',new Response('stale')]]));
 await w.lifecycle('install');w.setNetwork(async()=>{throw Error('offline');});
 const response=await w.request('https://test.invalid/fanservice/rules.js?session=one');assert.match(await response.text(),/^fanservice-shell-v15:/);
 assert.equal((await w.request('https://test.invalid/fanservice/not-cached')).type,'error');
});

test('API responses and requests outside the owned shell are not intercepted',async()=>{
 const w=worker();for(const [url,method] of [['https://test.invalid/api/fanservice/v1/capabilities','GET'],['https://test.invalid/fanservice/api/profile','GET'],['https://other.invalid/fanservice/rules.js','GET'],['https://test.invalid/library/','GET'],['https://test.invalid/fanservice/','POST']])assert.equal(await w.request(url,method),undefined);
});
