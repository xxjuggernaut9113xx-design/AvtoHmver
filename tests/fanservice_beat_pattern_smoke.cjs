const {webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42182';

(async()=>{
 const browser=await webkit.launch({headless:true,...(process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('fanservice-profile-v1:beat-pattern-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:beat-pattern-fixture',library_id:'beat-pattern-fixture',device_id:'fixture',name:'Beat pattern fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]})));
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'beat-pattern-fixture',media:[{id:1,type:'image',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect width="640" height="360" fill="%2388aabb"/%3E%3C/svg%3E',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);
   if(relative==='data/card-rules.json'){
    const rules=JSON.parse(body.toString());for(const pool of ['slow','medium','fast'])rules.patterns[pool]=[[1,.25,1.5,-.5]];
    rules.heat.SlowHeat={MinStrokeCount:12,MaxStrokeCount:12,MinIntervalSeconds:.5,MaxIntervalSeconds:.5};
    rules.difficulty_count=[1,1,1];rules.difficulty_speed=[1,1,1];rules.minimum_intervals=[.1,.1,.1];body=Buffer.from(JSON.stringify(rules));
   }
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto(origin+'/fanservice/play.html?library=beat-pattern-fixture');
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
  await page.clock.runFor(3000);
  const read=()=>page.evaluate(()=>({now:(Date.now()-run.startedAt)/1000,stateSeconds:state.seconds,flow:state.cardFlow,balls:[...document.querySelectorAll('.beat-ball')].map(node=>({time:Number(node.dataset.hitTime),x:parseFloat(node.style.left)})),pool:document.querySelector('#pool')===null}));
  const before=await read();
  assert.ok(before.balls.length>=3,`multiple actual pattern balls visible: ${before.balls.length}`);
  assert.ok(before.balls.some(ball=>ball.time>before.stateSeconds&&ball.x<50),'future beats approach from left of center');
  assert.equal(before.pool,true,'the legacy manual pool selector is absent');
  const positive=before.flow.queue.filter(entry=>entry.CustomMultiplier>=0).map(entry=>before.flow.started+entry.TargetHitTime);
  assert.ok(before.balls.every(ball=>positive.some(time=>Math.abs(time-ball.time)<1e-7)),'balls match actual positive card queue hit times');
  assert.ok(before.balls.every(ball=>!before.flow.queue.some(entry=>entry.CustomMultiplier<0&&Math.abs(before.flow.started+entry.TargetHitTime-ball.time)<1e-7)),'rest beats do not render');
  const gaps=before.balls.slice(1).map((ball,index)=>ball.time-before.balls[index].time);
  assert.ok(new Set(gaps.map(gap=>gap.toFixed(3))).size>=2,'fixture exposes uneven pattern spacing');
  if(process.env.FANSERVICE_BEAT_SCREENSHOT)await page.screenshot({path:process.env.FANSERVICE_BEAT_SCREENSHOT});
  await page.locator('#stage').click();await page.waitForFunction(()=>document.querySelector('#pause-menu').open&&document.body.dataset.sessionState==='paused');
  const paused=await read();await page.clock.runFor(1000);const held=await read();
  assert.equal(held.stateSeconds,paused.stateSeconds,'game time remains held while paused');
  assert.deepEqual(held.balls,paused.balls,'beat positions remain held while paused');
  await page.locator('#resume-session').click();await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
  await page.clock.runFor(300);const resumed=await read();
  assert.ok(resumed.balls.some((ball,index)=>ball.x!==paused.balls[index]?.x),'beat projections advance after Resume');
  assert.deepEqual(errors,[],'no browser errors');
  console.log('Beat pattern WebKit smoke passed: actual patterned hits, rest filtering, and pause/resume projection.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
