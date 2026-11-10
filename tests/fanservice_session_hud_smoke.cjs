const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42180';
const gif='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#91c9dc"/><circle cx="960" cy="170" r="85" fill="#ffdc85"/><path d="M0 600L300 180L600 600L900 260L1280 600V720H0Z" fill="#527a89"/><path d="M0 650L350 420L720 650L1100 400L1280 580V720H0Z" fill="#254c56"/><rect x="12" y="12" width="1256" height="696" fill="none" stroke="#fff" stroke-width="8"/></svg>');
const media=[1,2,3].map(id=>({id,type:'image',url:gif+'#'+id,tags:['slow','medium','fast','succubus','cum','ass','boobs']}));
const screenshots=path.resolve(__dirname,'../.test-tmp/session-hud');fs.mkdirSync(screenshots,{recursive:true});

async function check(engine,name){
 const browser=await engine.launch({headless:true,...(name==='Chromium'&&process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('fanservice-profile-v1:hud-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:hud-fixture',library_id:'hud-fixture',device_id:'fixture',name:'HUD fixture',owned:true,enabled:true,selection:{ids:[1,2,3],rules:[],local_ids:[]}}]})));
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'hud-fixture',media}});
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'hud-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto(origin+'/fanservice/play.html?library=hud-fixture');await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  assert.equal(await page.locator('body').getAttribute('data-session-state'),'setup');
  assert.equal(await page.locator('#pre-session').isVisible(),true,`${name}: setup controls visible before Start`);
  await page.locator('#preset-name').fill('Phone');await page.getByRole('button',{name:'Save preset'}).click();
  await page.locator('#difficulty').selectOption('2');await page.locator('#session-preset').selectOption({label:'Phone'});await page.getByRole('button',{name:'Apply preset'}).click();
  assert.equal(await page.locator('#difficulty').inputValue(),'1',`${name}: preset restores difficulty`);
  await page.screenshot({path:path.join(screenshots,`session-hud-portrait-${name.toLowerCase()}.png`),fullPage:true});
  await page.locator('#start').click();await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
  assert.equal(await page.locator('#pre-session').isVisible(),false,`${name}: setup hidden during play`);
  const dimensions=()=>page.evaluate(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return {viewport:{width:innerWidth,height:innerHeight},stage:rect('#gameplay-stage'),media:rect('#stage'),beats:rect('#beats'),hud:rect('#session-hud'),stageBackground:getComputedStyle(document.querySelector('#gameplay-stage')).backgroundColor,beatBackground:getComputedStyle(document.querySelector('#beats')).backgroundImage,buttons:[...document.querySelectorAll('#controls button:not([hidden])')].filter(el=>getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden').map(el=>({id:el.id,...(()=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}})()})),session:{id:sessionId,media:currentMedia?.id,seconds:state.seconds},background:document.querySelector('#background-image').getAttribute('src')||document.querySelector('#background-video').getAttribute('src')};});
  const portrait=await dimensions();
  assert.ok(Math.abs(portrait.hud.width/portrait.hud.height-16/9)<.01,`${name}: portrait HUD matches the media aspect ratio rather than the viewport`);
  assert.ok(portrait.stage.width>=portrait.viewport.width*.9&&portrait.stage.height>=portrait.viewport.height*.9,`${name}: portrait media surface fills viewport: ${JSON.stringify(portrait.stage)}`);
  assert.ok(portrait.beats.bottom<=portrait.viewport.height+1&&portrait.hud.bottom-portrait.beats.bottom<=20,`${name}: beat lane sits near safe bottom edge: ${JSON.stringify({viewport:portrait.viewport,beats:portrait.beats})}`);
  assert.ok(portrait.beatBackground.includes('rgba('),`${name}: beat lane background remains translucent`);
  assert.ok(portrait.buttons.filter(button=>['pause','finish'].includes(button.id)).every(button=>button.width>=44&&button.height>=44),`${name}: primary HUD touch targets are at least 44px`);
  assert.ok(portrait.background,`${name}: media is duplicated into the background layer`);
  assert.equal(await page.locator('#item-controls button').count(),5,`${name}: five inventory slots remain visible`);
  assert.ok((await page.locator('#item-controls').boundingBox()).x<195,`${name}: right holding hand puts slots on the left`);
  assert.ok(portrait.beats.y>=portrait.hud.y&&portrait.beats.bottom<=portrait.hud.bottom,`${name}: beatbar overlays the actual media`);
  assert.ok(portrait.hud.height<portrait.viewport.height*.5,`${name}: wide portrait media has letterboxing outside its HUD`);
  const session=portrait.session;
  await page.screenshot({path:path.join(screenshots,`session-hud-portrait-playing-${name.toLowerCase()}.png`)});
  await page.locator('#pause').click();await page.waitForFunction(()=>document.querySelector('#pause-menu').open&&document.body.dataset.sessionState==='paused');
  const pausedSeconds=await page.evaluate(()=>state.seconds);await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>state.seconds),pausedSeconds,`${name}: game clock freezes while pause menu is open`);
  for(const label of ['Next media','End session','Inventory','Challenges'])assert.ok(await page.locator('#pause-menu').getByRole('button',{name:label}).isVisible().catch(()=>false),`${name}: ${label} is available from pause menu`);
  assert.ok(await page.locator('#pause-menu').getByText('Holding hand',{exact:false}).isVisible(),`${name}: display settings are available while paused`);
  assert.equal(await page.locator('#session-presets').isVisible(),false,`${name}: presets stay in setup before Start`);
  await page.screenshot({path:path.join(screenshots,`session-hud-pause-${name.toLowerCase()}.png`)});
  await page.locator('#pause-menu label').filter({hasText:'Holding hand'}).locator('select').selectOption('left');
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);
  await page.locator('#resume-session').click();await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
  const landscape=await dimensions();
  assert.ok(Math.abs(landscape.hud.width/landscape.hud.height-16/9)<.01,`${name}: landscape HUD matches the media aspect ratio rather than the viewport`);
  assert.ok(landscape.stage.width>=landscape.viewport.width*.9&&landscape.stage.height>=landscape.viewport.height*.9,`${name}: landscape media surface fills viewport: ${JSON.stringify(landscape.stage)}`);
  assert.equal(landscape.session.id,session.id,`${name}: rotation preserves session ID`);
  assert.equal(landscape.session.media,session.media,`${name}: rotation preserves current media`);
  assert.ok(landscape.session.seconds>=pausedSeconds,`${name}: rotation does not reset session clock`);
  assert.ok(landscape.beats.bottom<=landscape.viewport.height+1&&landscape.hud.bottom-landscape.beats.bottom<=20,`${name}: landscape beat lane stays near the bottom safe area`);
  assert.ok((await page.locator('#item-controls').boundingBox()).x>422,`${name}: left holding hand puts slots on the right`);
  await page.screenshot({path:path.join(screenshots,`session-hud-landscape-${name.toLowerCase()}.png`)});
  const resumedSeconds=landscape.session.seconds;await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>state.seconds)>resumedSeconds,`${name}: clock advances after Resume`);
  assert.deepEqual(errors,[],`${name}: no browser errors`);
 }finally{await browser.close();}
}

(async()=>{if(process.env.FANSERVICE_HUD_WEBKIT_ONLY)await check(webkit,'WebKit');else{await check(chromium,'Chromium');if(fs.existsSync(webkit.executablePath()))await check(webkit,'WebKit');}console.log(`Session HUD smoke passed; screenshots: ${screenshots}`);})().catch(error=>{console.error(error);process.exitCode=1;});
