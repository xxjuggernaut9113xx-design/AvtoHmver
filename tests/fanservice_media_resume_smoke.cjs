const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42179';
const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const media=[1,2,3].map(id=>({id,type:'image',url:gif+'#'+id,tags:['slow','medium','fast','succubus','cum','ass','boobs']}));
async function check(engine,name){
 const browser=await engine.launch({headless:true,...(name==='Chromium'&&process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('fanservice-profile-v1:resume-fixture'))localStorage.setItem('fanservice-profile-v1:resume-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:resume-fixture',library_id:'resume-fixture',device_id:'fixture',name:'Resume fixture',owned:true,enabled:true,selection:{ids:[1,2,3],rules:[],local_ids:[]}}]}));});
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'resume-fixture',media}});
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'resume-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  const view=()=>page.evaluate(()=>({id:currentMedia?.id,src:document.querySelector('#image').src,edges:state.edges,strokes:state.strokes}));
  await page.goto(origin+'/fanservice/play.html?library=resume-fixture');await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.locator('#start').click();const initial=await view();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.evaluate(()=>paused),true,`${name}: pagehide pauses`);
  await page.locator('#pause-menu[open] #resume-session, body[data-session-state=playing] #pause').click();assert.deepEqual((await view()).id,initial.id,`${name}: refocus preserved image`);
  assert.equal(await page.evaluate(()=>paused),false,`${name}: Resume unpauses`);
  await page.locator('#status').filter({hasText:/Return Edge: follow the beats/}).waitFor();
  assert.match(await page.locator('#status').textContent(),/tap Edge \/ E to continue your session/,`${name}: visible status explains return Edge`);
  const seconds=await page.evaluate(()=>state.seconds),beat=await page.locator('#beat').evaluate(element=>element.style.left);await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>state.seconds)>seconds,`${name}: gameplay advances after Resume`);
  assert.notEqual(await page.locator('#beat').evaluate(element=>element.style.left),beat,`${name}: return Edge beat visibly advances`);
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();await page.waitForFunction(()=>!run.returnEdge);
  assert.equal((await view()).id,initial.id,`${name}: completed return Edge retains media`);
  await page.locator('#pause-menu[open] #resume-session, body[data-session-state=playing] #pause').click();const saved=await view();
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  assert.equal((await view()).id,saved.id,`${name}: checkpoint preview preserved image`);
  await page.locator('#start').click();assert.equal((await view()).id,saved.id,`${name}: Start preserved image`);
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();assert.equal((await view()).id,saved.id,`${name}: active Edge preserved image`);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
async function checkVideo(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage(),video={id:7,type:'video',url:origin+'/fanservice/resume.mp4',tags:['slow','medium','fast','succubus','cum']};
  await page.addInitScript(()=>{localStorage.setItem('fanservice-profile-v1:resume-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:resume-fixture',library_id:'resume-fixture',device_id:'fixture',name:'Resume fixture',owned:true,enabled:true,selection:{ids:[7],rules:[],local_ids:[]}}]}));});
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'resume-fixture',media:[video]}});
   if(url.pathname==='/fanservice/resume.mp4'){
    const body=fs.readFileSync(path.join(__dirname,'fixtures/fanservice/resume.mp4')),range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
    if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):body.length-1;return route.fulfill({status:206,body:body.subarray(start,end+1),contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`}});}
    return route.fulfill({body,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes'}});
   }
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'resume-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto(origin+'/fanservice/play.html?library=resume-fixture');await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();
  await page.locator('#video').evaluate(video=>new Promise(resolve=>video.readyState?resolve():video.addEventListener('loadedmetadata',resolve,{once:true})));
  await page.locator('#video').evaluate(video=>{video.pause();video.currentTime=1.4;});await page.waitForFunction(()=>document.querySelector('#video').currentTime>=1.39);
  await page.locator('#pause').click();await page.locator('#draw').click();await page.locator('#resume-session').click();await page.waitForFunction(()=>document.querySelector('#video').currentTime<.5);
  await page.locator('#video').evaluate(video=>{video.currentTime=1.4;});await page.waitForFunction(()=>document.querySelector('#video').currentTime>=1.39);
  await page.locator('#pause-menu[open] #resume-session, body[data-session-state=playing] #pause').click();await page.locator('#video').evaluate(video=>{video.currentTime=0;});await page.locator('#pause-menu[open] #resume-session, body[data-session-state=playing] #pause').click();
  await page.waitForFunction(()=>document.querySelector('#video').currentTime>=1.35,{timeout:5000});
  assert.equal(await page.locator('#video').evaluate(video=>video.paused),false,'Video plays during return Edge');
  const resumedTime=await page.locator('#video').evaluate(video=>video.currentTime);await page.waitForTimeout(250);
  assert.ok(await page.locator('#video').evaluate(video=>video.currentTime)>resumedTime+.1,'Video frames advance after Resume');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#video').currentTime>=1.35);
 }finally{await browser.close();}
}
(async()=>{await check(chromium,'Chromium');await checkVideo();if(fs.existsSync(webkit.executablePath()))await check(webkit,'WebKit');console.log('Media resume identity and MP4 position passed in Edge'+(fs.existsSync(webkit.executablePath())?' and image identity in WebKit':' (WebKit unavailable)')+'.');})().catch(error=>{console.error(error);process.exitCode=1;});
