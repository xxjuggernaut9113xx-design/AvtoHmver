const {webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42173';
const wav=Buffer.alloc(44+8000*2*5);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const manifest={protocol:1,library_id:'music-fixture',track_id:1,recording_id:'sha1:'+'b'.repeat(40),duration:5,offset:0,stream_url:'/api/music/tracks/1/stream?browser=true',beatmap:{meta:{duration:5,bpm:120,offset:0},beats:[0,.75,1.75,2.75,3.75].map(time=>({time,type:'stroke'})),events:[{time:.25,type:'cum_event',value:'start'},{time:1,type:'restore_break'},{time:5,type:'text',value:'Fixture complete'}]}};
(async()=>{
 const browser=await webkit.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('fanservice-profile-v1:music-fixture'))localStorage.setItem('fanservice-profile-v1:music-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:music-fixture',library_id:'music-fixture',device_id:'fixture',name:'Neutral',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));});
  await page.route(origin+'/**',async route=>{const url=new URL(route.request().url());
   if(url.pathname==='/api/fanservice/v1/music/1/manifest')return route.fulfill({json:manifest});
   if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'music-fixture',media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
   if(url.pathname==='/api/music/tracks/1/stream'){const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${wav.length}`}});}return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});}
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.join(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'music-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':'text/css'});
  });
  await page.goto(origin+'/fanservice/play.html?library=music-fixture');await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#objective').selectOption('4');await page.locator('#start').click();
  await page.evaluate(()=>{window.voiceUnlockCalls=0;const unlock=FanserviceVoice.unlock;FanserviceVoice.unlock=function(...args){window.voiceUnlockCalls++;return unlock.apply(this,args);};});
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.locator('#resume-session').click();assert.equal(await page.evaluate(()=>voiceUnlockCalls),1,'Resume click invokes voice unlock from its user activation handler');
  const finish=page.locator('#finish');
  const portrait=await finish.boundingBox();assert.ok(portrait.height>=44,'Portrait finish control meets touch target size');
  await page.mouse.move((await finish.boundingBox()).x+20,(await finish.boundingBox()).y+20);await page.mouse.down();await page.waitForTimeout(250);await page.setViewportSize({width:844,height:390});await page.mouse.up();await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>finished),false,'Rotation during hold cancels finish');
  const landscape=await finish.boundingBox();assert.ok(landscape&&landscape.y+landscape.height<=390,'Finish control remains visible after landscape rotation');
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>!document.querySelector('#finish').disabled);const box=await finish.boundingBox();await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.waitForTimeout(1100);await page.mouse.up();await page.waitForFunction(()=>finished);
  assert.deepEqual(errors,[]);console.log('iPhone-shaped WebKit touch emulation passed: real pointer hold cancellation on rotation, portrait/landscape visibility, and successful Prejac finish. Playwright WebKit is not physical iOS Safari/device acceptance.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
