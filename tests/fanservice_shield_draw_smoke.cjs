const {webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42184';

async function makeFixture(browser,enhanced){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('fanservice-profile-v1:shield-draw-fixture',JSON.stringify({version:1,unlock_points:0,mobile_loadout:[6,8,8,8,8],packs:[{id:'custom:shield-draw-fixture',library_id:'shield-draw-fixture',device_id:'fixture',name:'Shield draw fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]})));
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'shield-draw-fixture',media:[{id:1,type:'image',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect width="640" height="360" fill="%2388aabb"/%3E%3C/svg%3E',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
  const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  let body=fs.readFileSync(file);
  if(relative==='data/card-rules.json'){
   const rules=JSON.parse(body.toString());for(const pool of ['slow','medium','fast'])rules.patterns[pool]=[[1]];
   for(const key of ['SlowHeat','MediumHeat','HighHeat'])rules.heat[key]={MinStrokeCount:5,MaxStrokeCount:5,MinIntervalSeconds:.1,MaxIntervalSeconds:.1};
   rules.difficulty_count=[1,1,1];rules.difficulty_speed=[1,1,1];rules.minimum_intervals=[.1,.1,.1];rules.travel=.1;body=Buffer.from(JSON.stringify(rules));
  }
  return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
 });
 await page.goto(origin+'/fanservice/play.html?library=shield-draw-fixture');await page.waitForFunction(()=>!document.querySelector('#start').disabled);
 await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
 await page.getByRole('button',{name:'Start',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
 await page.evaluate(({enhanced})=>{run.inventory.grant(6,2,{mode:0});if(enhanced)run.ownedModifiers.push(14);renderItemControls();}, {enhanced});
 const button=page.locator('#item-controls').getByRole('button',{name:/^Use .*shield/i});await button.waitFor();
 await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true','HUD action toggles the Succu Shield without consuming a charge');
 return {context,page,errors,button};
}
async function nextDraw(test,after){
 for(let elapsed=0;elapsed<10000;elapsed+=50){
  await test.page.clock.runFor(50);
  const snapshot=await test.page.evaluate(()=>({draws:state.totalDraws,charges:run.inventory.state(6).charges,toggled:state.shieldToggled,blocks:state.shieldBlockCount||0,pool:state.cardFlow?.pool}));
  if(snapshot.draws>after)return snapshot;
 }
 throw Error('Timed out waiting for a natural card completion and automatic media draw.');
}
async function check(browser,enhanced){
 const test=await makeFixture(browser,enhanced);
 try{
  const start=await test.page.evaluate(()=>({draws:state.totalDraws,charges:run.inventory.state(6).charges,toggled:state.shieldToggled}));
  assert.equal(start.charges,2);assert.equal(start.toggled,true);
  const first=await nextDraw(test,start.draws);
  assert.equal(first.pool==='succubus',false,'ordinary low heat card flow remains active');
  if(enhanced){
   assert.equal(first.charges,2,'Enhanced Plating preserves the shield charge on the first blocked draw');
   assert.equal(first.blocks,1,'Enhanced Plating records its first blocked draw');assert.equal(first.toggled,true);
   const second=await nextDraw(test,first.draws);
   assert.equal(second.charges,1,'the next blocked draw consumes one shield charge');assert.equal(second.blocks,0);assert.equal(second.toggled,true);
   assert.equal((await test.button.getAttribute('aria-pressed')),'true');
  }else{
   assert.equal(first.charges,1,'first blocked draw consumes one shield charge');assert.equal(first.toggled,true);
   const second=await nextDraw(test,first.draws);
   assert.equal(second.charges,0,'second blocked draw consumes the last shield charge');assert.equal(second.toggled,false);
   assert.equal(await test.button.getAttribute('aria-pressed'),'false');
  }
  assert.deepEqual(test.errors,[],'no browser errors');
  return {enhanced,first,final:enhanced?await test.page.evaluate(()=>({charges:run.inventory.state(6).charges,toggled:state.shieldToggled,blocks:state.shieldBlockCount||0})):await test.page.evaluate(()=>({charges:run.inventory.state(6).charges,toggled:state.shieldToggled}))};
 }finally{await test.context.close();}
}
(async()=>{
 const browser=await webkit.launch({headless:true,...(process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:{})});
 try{const results=[await check(browser,false),await check(browser,true)];console.log('Shield automatic-draw WebKit smoke passed. Authority: synthetic neutral media and fixture-authored card pacing; explicit item and perk fixtures, no game counter or RNG metric injection. '+JSON.stringify(results));}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
