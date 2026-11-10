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
   if(url.pathname==='/api/music/tracks/1/stream'){
    const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
    if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${wav.length}`}});}
    return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});
   }
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.join(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);
   if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'music-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto(origin+'/fanservice/play.html?library=music-fixture&track=1');
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();
  await page.waitForFunction(()=>audio.currentTime>.2);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForFunction(()=>paused);
  const held=await page.evaluate(()=>({position:audio.currentTime,event:clock.event,next:clock.next,strokes:state.strokes}));
  await page.locator('#resume-session').click();await page.waitForFunction(()=>!!run.returnEdge);
  await page.waitForTimeout(3200);
  const edge=await page.evaluate(()=>({position:audio.currentTime,event:clock.event,next:clock.next,strokes:state.strokes,paused:audio.paused}));
  assert.equal(edge.position,held.position);assert.equal(edge.event,held.event);assert.equal(edge.next,held.next);assert.equal(edge.paused,true);assert.ok(edge.strokes>held.strokes,'Real edge beats progress while the recording is paused');
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();
  await page.waitForFunction(()=>!!run.returnEdge);
  assert.equal(await page.evaluate(()=>audio.paused),true);
  assert.equal(await page.evaluate(()=>state.edges),0);
  assert.equal(await page.evaluate(()=>audio.currentTime),held.position);
  assert.deepEqual(await page.evaluate(()=>({event:clock.event,next:clock.next})),{event:held.event,next:held.next});
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();
  await page.waitForFunction(()=>!run.returnEdge&&!audio.paused);
  assert.equal(await page.evaluate(()=>state.edges),1);
  await page.waitForFunction(()=>finished);
  const result=await page.evaluate(()=>({seconds:state.seconds,caption:document.querySelector('#caption').textContent,sessions:profile.progression.sessions,wins:profile.progression.wins}));
  assert.ok(result.seconds>4);assert.equal(result.caption,'Final recording boundary');assert.equal(result.sessions,1);assert.equal(result.wins,1);assert.deepEqual(errors,[]);
  await page.goto(origin+'/fanservice/play.html?library=music-fixture');
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#start').click();
  // Seed the fixture's starting inventory through its public API, then use the real controls.
  await page.evaluate(()=>{for(const [slot,type] of [7,11].entries()){run.inventory.grant(type,1,itemContext());run.inventory.equip(type,slot);}render();});
  await page.getByRole('button',{name:/Use Loot Rush/}).click();await page.getByRole('button',{name:/Use Resupply/}).click();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.locator('#resume-session').click();
  const effects=await page.evaluate(()=>({rush:state.effects.lootRushRemaining,items:state.ItemsUsed,used:state.metrics.itemsUsed}));
  for(let attempt=0;attempt<2;attempt++){
   await page.waitForTimeout(2300);
   assert.equal(await page.evaluate(()=>state.effects.resupplyRemaining),0,'Pending item effects use active return timing');
   assert.ok(await page.evaluate(()=>state.effects.lootRushRemaining)<effects.rush-2);
   assert.equal(await page.evaluate(()=>run.inventory.state(7).charges),0);assert.equal(await page.evaluate(()=>state.ItemsUsed),effects.items+1);
   await page.getByRole('button',{name:'Close inventory',exact:true}).click();
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.locator('#resume-session').click();
   assert.equal(await page.evaluate(()=>run.inventory.state(7).charges),1);assert.equal(await page.evaluate(()=>state.ItemsUsed),effects.items);
   assert.equal(await page.evaluate(()=>state.metrics.itemsUsed),effects.used);
   assert.ok(await page.evaluate(()=>state.effects.lootRushRemaining)>=effects.rush-.2);
  }
  assert.deepEqual(errors,[]);
  console.log('Interruption player passed: pagehide pauses actual audio, Resume runs real edge beats with song/event cursors held, reload replays only interrupted edge, then song and final events resume once; active item timers and delayed consumption roll back/replay twice. Synthetic recording; physical device lifecycle remains unverified.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
