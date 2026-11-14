const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice'),items=[
 {type:3,id:'Slowdown',cooldown:'Cooldown active'},
 {type:4,id:'Break',cooldown:'Cannot use items'},
 {type:5,id:'BonerPill',cooldown:'Cooldown active'},
 {type:10,id:'EscapeRope',cooldown:'Cannot use items'},
 {type:12,id:'Bounty',cooldown:'Cooldown active'},
 {type:13,id:'ComboCruncher',cooldown:'Effect state unavailable'}
];
let origin;

async function makePage(browser,item){
 const fixture='hotbar-item-'+item.type,context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({fixture,type})=>{
  const progression={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[],challenge_progress:{},lifetime_metrics:{},unlocked_modifiers:[],enabled_modifiers:[]};
  localStorage.setItem('fanservice-profile-v1:'+fixture,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[type,8,8,8,8],progression,packs:[{id:'custom:'+fixture,library_id:fixture,device_id:'fixture',name:'Hotbar item fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
 },{fixture,type:item.type});
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:fixture,media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
  const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
  if(!url.pathname.startsWith('/fanservice/')||!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  let body=fs.readFileSync(file);
  if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> '${fixture}',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
  if(relative==='data/card-rules.json'){
   const rules=JSON.parse(body.toString());for(const pool of ['slow','medium','fast'])rules.patterns[pool]=[[1]];
   for(const key of ['SlowHeat','MediumHeat','HighHeat'])rules.heat[key]={MinStrokeCount:5,MaxStrokeCount:5,MinIntervalSeconds:.1,MaxIntervalSeconds:.1};
   rules.difficulty_count=[1,1,1];rules.difficulty_speed=[1,1,1];rules.minimum_intervals=[.1,.1,.1];rules.travel=.1;body=Buffer.from(JSON.stringify(rules));
  }
  const contentType=relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream';
  return route.fulfill({body,contentType});
 });
 await page.goto(origin+'/fanservice/play.html?library='+fixture);
 await page.waitForFunction(()=>!document.querySelector('#start').disabled);
 await page.clock.install();
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
 const button=page.locator('#item-controls button').first();
 await page.evaluate(type=>{if(!run.inventory.grant(type,2,itemContext()))throw Error('Could not grant test charges.');renderItemControls();},item.type);
 await button.waitFor();
 return {context,page,button,errors,fixture};
}

async function runCase(browser,item){
 const test=await makePage(browser,item),{page,button}=test;
 const read=()=>page.evaluate(type=>{const s=readItemState(),flow=s.cardFlow;return {charges:run.inventory.state(type).charges,combo:s.combo,heat:s.heat,beatInterval:flow?.queue?.[flow.nextFire]?.Interval??s.beatInterval,strokeCount:s.strokeCount,card:s.card,strokes:s.strokes,meter:s.meter,coins:s.coins,used:s.ItemsUsed||0,effects:{...s.effects},canUseSlowdown:s.canUseSlowdown,canUseBonerPill:s.canUseBonerPill,flowGeneration:flow?.generation,returnEdge:!!run.returnEdge};},item.type);
 async function until(predicate,label){for(let n=0;n<3000;n++){if(await page.evaluate(predicate))return;await page.clock.runFor(50);}throw Error('Timed out: '+label);}
 try{
  if(item.type===3||item.type===5||item.type===4||item.type===10||item.type===12)await page.clock.runFor(500);
  if(item.type===3||item.type===5)await until(()=>state.cardFlow&&!state.cardFlow.ended&&state.cardFlow.remaining>0,'active ordinary card');
  if(item.type===13)await until(()=>state.combo>=5,'combo from delivered beats');
  const before=await read();assert.equal(before.charges,2,`${item.id}: seeded charges are in the equipped slot`);
  await button.click();

  if(item.type===3){
   await until(()=>state.canUseSlowdown===false,'Slowdown activation');const used=await read();
   assert.equal(used.charges,1);assert.equal(used.used,before.used+1);assert(used.beatInterval>before.beatInterval,`Slowdown timeline interval ${before.beatInterval} -> ${used.beatInterval}`);assert(used.effects.lootRushRemaining===0||used.effects.lootRushRemaining===undefined);
   await button.click();await page.waitForFunction(message=>document.querySelector('#status').textContent===message,item.cooldown);assert.deepEqual(await read(),{...used,used:used.used});
  }else if(item.type===4){
   const used=await read();assert.equal(used.charges,1);assert.equal(used.used,before.used+1);assert.equal(used.combo,0);assert(used.meter>=before.meter);
   await button.click();await page.waitForFunction(message=>document.querySelector('#status').textContent===message,item.cooldown);assert.equal((await read()).charges,1,'failed second Break keeps its charge');
  }else if(item.type===5){
   const used=await read();assert.equal(used.charges,1);assert.equal(used.used,before.used+1);assert.equal(used.canUseBonerPill,false);assert.equal(used.card,2);assert(used.strokeCount>=before.strokeCount*2);
   await button.click();await page.waitForFunction(message=>document.querySelector('#status').textContent===message,item.cooldown);assert.equal((await read()).charges,1,'cooldown rejection keeps the Boner Pill charge');
  }else if(item.type===10){
   const used=await read();assert.equal(used.charges,1);assert.equal(used.used,before.used+1);assert.equal(used.combo,0);
   await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);const restored=await read();assert.equal(restored.charges,used.charges);assert.equal(restored.used,used.used);assert.equal(restored.combo,used.combo);
   await page.getByRole('button',{name:'Start',exact:true}).click();await page.clock.runFor(1000);
   assert.equal(await page.evaluate(()=>!!run.returnEdge),true,'reload enters the required Return Edge');
    assert.equal(await page.evaluate(()=>state.card),5);await button.click();await page.waitForFunction(message=>document.querySelector('#status').textContent===message,item.cooldown,{timeout:1500}).catch(async()=>{throw Error(`Escape Rope rejection status: ${await page.locator('#status').textContent()}`)});
   assert.equal((await read()).charges,1,'Escape Rope rejected on the Edge card retains its charge');
  }else if(item.type===12){
   await until(()=>state.effects?.bountyRemaining>0,'Bounty activation');const used=await read();assert.equal(used.charges,1);assert.equal(used.used,before.used+1);assert(used.effects.bountyRequiredStrokes>0);
   await button.click();await page.waitForFunction(message=>document.querySelector('#status').textContent===message,item.cooldown);assert.equal((await read()).charges,1,'cooldown rejection keeps the Bounty charge');
   await until(()=>run.inventory.state(12).charges===2||state.effects.bountyRemaining===0,'Bounty claim or expiry');
   assert.equal((await read()).charges,2,'meeting the delivered-stroke threshold grants the eligible equipped Bounty item');
  }else if(item.type===13){
   assert(before.combo>0);const used=await read();assert.equal(used.charges,1);assert.equal(used.used,before.used+1);assert.equal(used.combo,0);assert(used.meter>before.meter);
   await button.click();await page.waitForFunction(message=>document.querySelector('#status').textContent===message,item.cooldown);assert.equal((await read()).charges,1,'no-combo rejection keeps the Combo Cruncher charge');
  }

  const persisted=await read();
  if(item.type!==10){await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);const restored=await read();
   for(const key of ['charges','combo','beatInterval','strokeCount','card','strokes','meter','coins','used','canUseSlowdown','canUseBonerPill'])assert.deepEqual(restored[key],persisted[key],`${item.id}: ${key} survives reload`);
   for(const [key,value] of Object.entries(persisted.effects)){if(/Remaining$/.test(key)&&Number.isFinite(value))assert(restored.effects[key]<=value&&restored.effects[key]>=value-1,`${item.id}: ${key} resumes from the saved countdown`);else assert.deepEqual(restored.effects[key],value,`${item.id}: ${key} survives reload`);}
  }
  assert.deepEqual(test.errors,[],`${item.id}: no browser exceptions`);
  return {item:item.id,before,persisted};
 }finally{await test.context.close();}
}

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})}),server=http.createServer();
 try{
  server.on('request',(request,response)=>{});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  // Each page installs its fixture's saved-library response through Playwright routing.
  const results=[];for(const item of items)results.push(await runCase(browser,item));
  console.log('Six supported-item hotbar flows passed through the player UI with source effects, rejected-use charge retention, and checkpoint reload. '+JSON.stringify(results));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
