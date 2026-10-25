const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
test('durable cross-tab pins protect retired media, resume exact versions, and clean only owned snapshots',async()=>{
 const source=fs.readFileSync(require.resolve('../static/fanservice/store.js'),'utf8');
 const server=http.createServer((req,res)=>{if(req.url==='/store.js'){res.setHeader('Content-Type','text/javascript');res.end(source);}else if(req.url==='/bad'){res.statusCode=503;res.end('failed');}else if(req.url.startsWith('/media')){res.setHeader('Content-Type','image/png');res.end(req.url);}else{res.setHeader('Content-Type','text/html');res.end('<script src="/store.js"></script>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage(),origin='http://127.0.0.1:'+server.address().port;
  await Promise.all([a.goto(origin),b.goto(origin)]);
  const copied=await a.evaluate(async()=>{const s=FanserviceStore;let reads=0;const source={name:'picker.png',type:'image/png',size:6,arrayBuffer:async()=>{reads++;return new TextEncoder().encode('copied').buffer;}};const [record]=await s.importFiles([source]);source.arrayBuffer=async()=>{throw Error('Picker grant expired');};const saved=await s.get('files',record.id);const result={reads,text:await saved.blob.text(),file:saved.blob instanceof File};await s.remove('files',record.id);try{await s.importFiles([new File(['valid'],'first.png',{type:'image/png'}),{name:'missing.png',type:'image/png',size:5,arrayBuffer:async()=>new ArrayBuffer(0)}]);throw Error('Unexpected partial copy success');}catch(e){if(!e.message.includes('could not be copied completely'))throw e;}return {...result,remaining:(await s.localFiles()).length};});
  assert.deepEqual(copied,{reads:1,text:'copied',file:false,remaining:0});
  const rollback=await a.evaluate(async()=>{
   const original=IDBObjectStore.prototype.put;let writes=0,error;
   IDBObjectStore.prototype.put=function(value,...args){if(value?.local&&++writes===2)throw new DOMException('synthetic quota failure','QuotaExceededError');return original.call(this,value,...args);};
   try{await FanserviceStore.importFiles([new File(['one'],'one.png',{type:'image/png'}),new File(['two'],'two.png',{type:'image/png'})]);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=original;}
   return {error,remaining:(await FanserviceStore.localFiles()).length};
  });assert.match(rollback.error,/none of the selected files were saved/);assert.equal(rollback.remaining,0,'A second-write quota failure must abort the first write too');
  const first=await a.evaluate(async()=>{const s=FanserviceStore;await s.importFiles([new File(['private'],'private.png',{type:'image/png'})]);await s.put('files','unrelated-orphan',{blob:new Blob(['keep']),local:false});const snapshot=await s.download({id:'p',library_id:'l'},{media:[{id:1,url:'/media-one'}]},location.origin,null);await s.pinSnapshot('p','session-one');return snapshot;});
  await b.evaluate(()=>FanserviceStore.pinSnapshot('p','session-two'));
  const second=await b.evaluate(()=>FanserviceStore.download({id:'p',library_id:'l'},{media:[{id:2,url:'/media-two'}]},location.origin,null));assert.notEqual(first.id,second.id);
  assert.equal(await a.evaluate(key=>!!FanserviceStore.get&&FanserviceStore.get('files',key).then(Boolean),first.media[0].storage_key),true);
  await a.reload();assert.equal(await a.evaluate(async()=> (await FanserviceStore.snapshot('p','session-one')).media[0].id),1);
  assert.equal(await a.evaluate(async()=> (await FanserviceStore.snapshot('p')).media[0].id),2);
  await assert.rejects(b.evaluate(()=>FanserviceStore.download({id:'p',library_id:'l'},{media:[{url:'/media-staged'},{url:'/bad'}]},location.origin,null)),/Download failed/);
  assert.equal(await b.evaluate(async()=> (await FanserviceStore.snapshot('p')).id),second.id);
  const failures=await b.evaluate(async()=>{
   const s=FanserviceStore,previous=await s.get('snapshots','p'),originalFetch=window.fetch,results=[];
   for(const mode of ['empty','truncated-stream','truncated-fallback','oversized-fallback','different-library']){
    let fetched=false;window.fetch=async()=>{fetched=true;if(mode==='empty')return new Response(new Uint8Array(0));if(mode==='truncated-stream')return new Response('short',{headers:{'content-length':'100'}});return {ok:true,headers:new Headers({'content-length':mode==='oversized-fallback'?String(256*1024*1024+1):'100'}),body:null,blob:async()=>new Blob(['short'])};};
    let error;try{await s.download({id:'p',library_id:'l'},{library_id:mode==='different-library'?'foreign':'l',media:[{url:'/untrusted'}]},location.origin,null);}catch(e){error=e.message;}finally{window.fetch=originalFetch;}
    results.push({mode,error,retained:(await s.get('snapshots','p')).id===previous.id,fetched});
   }
   const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value?.blob&&value.local===false)throw new DOMException('synthetic quota failure','QuotaExceededError');return put.call(this,value,...args);};
   try{await s.download({id:'p',library_id:'l'},{media:[{url:'/media-quota'}]},location.origin,null);}catch(e){results.push({mode:'quota',error:e.message,retained:(await s.get('snapshots','p')).id===previous.id});}finally{IDBObjectStore.prototype.put=put;}
   return results;
  });
  assert.equal(failures.length,6);for(const failure of failures){assert.ok(failure.error,failure.mode+' must fail');assert.equal(failure.retained,true,failure.mode+' must retain the previous snapshot');}assert.equal(failures.find(row=>row.mode==='different-library').fetched,false);assert.match(failures.find(row=>row.mode==='quota').error,/Storage is full/);
  await a.evaluate(()=>FanserviceStore.releaseSession('session-one'));
  assert.equal(await b.evaluate(async key=>!!(await FanserviceStore.get('files',key)),first.media[0].storage_key),true);
  await b.evaluate(()=>FanserviceStore.releaseSession('session-two'));
  assert.equal(await b.evaluate(async key=>!!(await FanserviceStore.get('files',key)),first.media[0].storage_key),false);
  await a.evaluate(()=>FanserviceStore.pinSnapshot('p','delete-pin'));await b.evaluate(()=>FanserviceStore.deleteSnapshot('p'));
  assert.equal(await a.evaluate(async()=> (await FanserviceStore.snapshot('p','delete-pin')).id),second.id);
  await assert.rejects(b.evaluate(()=>FanserviceStore.snapshot('p')),/No downloaded snapshot/);
  await a.evaluate(()=>FanserviceStore.releaseSession('delete-pin'));
  assert.equal(await a.evaluate(async key=>!!(await FanserviceStore.get('files',key)),second.media[0].storage_key),false);
  const remaining=await a.evaluate(async()=>({local:(await FanserviceStore.localFiles()).map(x=>x.name),orphan:!!(await FanserviceStore.get('files','unrelated-orphan')),records:await new Promise(async(resolve,reject)=>{const request=indexedDB.open('fanservice-local-v1',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('files'),r=tx.objectStore('files').getAll();r.onsuccess=()=>resolve(r.result.map(x=>x.kind||x.local));tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);})}));
  assert.deepEqual(remaining.local,['private.png']);assert.equal(remaining.orphan,true);assert.deepEqual(remaining.records.sort(),[false,true]);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
