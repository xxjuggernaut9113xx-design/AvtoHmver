const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin;const fixture='overlays-hotbar';

// Cum overlays (v0.05.1 decoded animations — see
// docs/parity/evidence/ticket44-loops-overlay-20261111.md): the allowed
// overlay breathes with the 1 s SpawnOverlay pulse while cum is allowed;
// the countdown overlay plays the 0.5 s SpawnAnim entrance then the Idle
// loop while the release window is open. The smoke pins the wiring: the
// overlays stay hidden until the release-window state is set, then show
// with the decoded animation names/durations and the window remainder.
(async()=>{
 const engine=process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'&&process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:process.env.FANSERVICE_BROWSER_ENGINE!=='webkit'&&process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/api/fanservice/v1/resolve'){
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({library_id:fixture,media:[{id:1,file:'overlay.png',type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}));return;
  }
  const relative=url.pathname.replace(/^\/fanservice\//,'');if(!url.pathname.startsWith('/fanservice/')){response.writeHead(404);response.end();return;}
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){response.writeHead(404);response.end();return;}
  let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> '${fixture}',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
  const type=relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream';response.writeHead(200,{'content-type':type});response.end(body);
 });
 const reports=[];
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:390,height:844},...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?{deviceScaleFactor:3,isMobile:true,hasTouch:true}:{})}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(id=>{
   const progression={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[],challenge_progress:{},lifetime_metrics:{},unlocked_modifiers:[],enabled_modifiers:[]};
   localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[1],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral overlays fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  },fixture);
  try{
   await page.goto(origin+'/fanservice/play.html?library='+fixture);
   await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption('1');
   await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.clock.fastForward(2000);
   const allowed=page.locator('#cum-overlay'),countdown=page.locator('#cum-countdown-overlay');
   assert.equal(await allowed.isHidden(),true,'The allowed overlay must start hidden');
   assert.equal(await countdown.isHidden(),true,'The countdown overlay must start hidden');
   assert.equal(await page.evaluate(()=>!!window.FanserviceOverlays),true,'The overlays module must load');
   await page.evaluate(()=>{run.player.isAllowedToCum=true;run.objective.releaseDeadline=state.seconds+60;render();});
   assert.equal(await allowed.isHidden(),false,'The allowed overlay must show while cum is allowed');
   assert.equal(await countdown.isHidden(),false,'The countdown overlay must show while the release window is open');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#cum-overlay')).animationName),'cum-spawn-overlay','The allowed overlay must run the decoded SpawnOverlay pulse');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#cum-overlay')).animationDuration),'1s','SpawnOverlay must last 1.0 s');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#cum-overlay')).animationIterationCount),'infinite','SpawnOverlay must loop infinitely');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#cum-countdown-overlay')).animationName),'cum-spawn-anim, cum-idle','The countdown overlay must run the SpawnAnim entrance then the Idle loop');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#cum-countdown-overlay')).animationDuration),'0.5s, 1.00388s','SpawnAnim must last 0.5 s and Idle 60233 ticks (≈1.004 s; the computed style rounds the 1.003883s CSS value)');
   assert.equal(await page.evaluate(()=>document.querySelector('#cum-countdown-progress').value),1,'The countdown progress must start at the full window');
   assert.equal(await page.evaluate(()=>document.querySelector('#cum-countdown-text').textContent),'Release window: 60 seconds.','The countdown text must show the window remainder');
   await page.evaluate(()=>{run.objective.releaseDeadline=state.seconds+30;render();});
   assert.equal(await page.evaluate(()=>document.querySelector('#cum-countdown-progress').value),0.5,'The countdown progress must track the window remainder');
   assert.equal(await page.evaluate(()=>document.querySelector('#cum-countdown-text').textContent),'Release window: 30 seconds.','The countdown text must track the window remainder');
   await page.evaluate(()=>{run.player.isAllowedToCum=false;run.objective.releaseDeadline=null;render();});
   assert.equal(await allowed.isHidden(),true,'The allowed overlay must hide when cum is no longer allowed');
   assert.equal(await countdown.isHidden(),true,'The countdown overlay must hide when the window closes');
   assert.deepEqual(errors,[],'No page errors');
   reports.push('overlays smoke: PASS');
  }catch(error){reports.push('overlays smoke: FAIL '+error.message);throw error;}
 }finally{await browser.close();server.close();}
 console.log(reports.join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
