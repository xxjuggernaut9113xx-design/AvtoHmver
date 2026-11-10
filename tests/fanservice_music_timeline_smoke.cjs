const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42171';
const wav=Buffer.alloc(44+8000*2*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
// Match the server manifest contract: offset is already applied to each row,
// while meta.offset is zero so the player must not shift the timeline again.
const manifest={protocol:1,library_id:'music-fixture',track_id:1,recording_id:'sha1:'+'a'.repeat(40),duration:4,offset:.25,stream_url:'/api/music/tracks/1/stream?browser=true',beatmap:{meta:{duration:4,bpm:120,offset:0},beats:[0,.75,1.75,2.75,3.75].map(time=>({time:time+.25,type:'stroke'})),events:[{time:.25,type:'disable_break',value:'start'},{time:1,type:'restore_break'},{time:4,type:'text',value:'Final recording boundary'}]}};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   if(!localStorage.getItem('fanservice-profile-v1:music-fixture'))localStorage.setItem('fanservice-profile-v1:music-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:music-fixture',library_id:'music-fixture',device_id:'fixture',name:'Neutral',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  });
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/fanservice/v1/music/1/manifest')return route.fulfill({json:manifest});
   if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'music-fixture',media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
   if(url.pathname==='/api/music/tracks/1/stream')return route.fulfill({body:wav,contentType:'audio/wav'});
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.join(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);
   if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'music-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto(origin+'/fanservice/play.html?library=music-fixture&track=1');
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.locator('#start').click();await page.waitForTimeout(350);
  const lead=await page.evaluate(()=>({remaining:musicLeadIn,strokes:state.strokes,seconds:state.seconds,position:audio.currentTime}));assert.ok(lead.remaining>1);assert.equal(lead.strokes,0);assert.equal(lead.seconds,0);assert.equal(lead.position,0);
  await page.locator('#stage').click();const pausedLead=await page.evaluate(()=>musicLeadIn);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>musicLeadIn),pausedLead);
  await page.evaluate(()=>checkpoint(true));await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);assert.ok(await page.evaluate(()=>musicLeadIn)>1);
  await page.locator('#start').click();assert.equal(await page.evaluate(()=>audio.paused),true);
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();await page.waitForFunction(()=>!run.returnEdge);
  const returned=await page.evaluate(()=>({strokes:state.strokes,seconds:state.seconds}));
  await page.waitForFunction(strokes=>state.strokes>strokes,returned.strokes);
  await page.locator('#stage').click();const stopped=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes}));await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes})),stopped);
  await page.locator('#resume-session').click();
  await page.evaluate(()=>{audio.pause();audio.dispatchEvent(new Event('waiting'));});
  const buffered=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes}));await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes})),buffered);
  await page.evaluate(async()=>{await audio.play();const until=performance.now()+4300;while(performance.now()<until){};});
  await page.waitForFunction(()=>finished);
  const completed=await page.evaluate(()=>({strokes:state.strokes,seconds:state.seconds,caption:document.querySelector('#caption').textContent,sessions:profile.progression.sessions,wins:profile.progression.wins}));
  assert.equal(completed.strokes,5+returned.strokes);assert.ok(Math.abs(completed.seconds-4-returned.seconds)<.05);assert.equal(completed.caption,'Final recording boundary');assert.equal(completed.sessions,1);assert.equal(completed.wins,1);
  await page.evaluate(()=>audio.dispatchEvent(new Event('ended')));assert.equal(await page.evaluate(()=>profile.progression.sessions),1);assert.deepEqual(errors,[]);
  console.log('Music timeline player passed: checkpointed 2s lead-in, pause/buffering hold, sparse recording callbacks, final beat/control drain and once-only natural settlement. Synthetic recording and mocked library API; no original-build runtime claim.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
