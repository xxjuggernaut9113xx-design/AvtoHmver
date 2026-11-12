const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin;const fixture='punishment-hotbar';

(async()=>{
 const engine=process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'&&process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:process.env.FANSERVICE_BROWSER_ENGINE!=='webkit'&&process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/api/fanservice/v1/resolve'){
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({library_id:fixture,media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}));return;
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
   localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[1],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral punishment fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  },fixture);
  try{
   await page.goto(origin+'/fanservice/play.html?library='+fixture);
   await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption('1');
   await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.evaluate(()=>{
    if(!run.inventory.hotbarItems.includes(1))throw Error('DecreaseHeat was not in the hotbar from the seeded loadout.');
    if(!run.inventory.grant(1,1,{mode:0}))throw Error('Could not seed the single DecreaseHeat charge.');
    if(state.card===3)draw('slow',{force:true});
    state.heat=50;run.state.TotalTauntsUsed=25;checkpoint(true);renderItemControls();
   });
   await page.clock.fastForward(2000);
   const before=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,heat:state.heat,meter:state.meter,card:state.card,canUseItems:state.canUseItems,charges:run.inventory.state(1).charges,itemsUsed:run.state.ItemsUsed||0,generation:state.cardFlow?.generation,countMultiplier:FanserviceRules.drawMultipliers(FanserviceRules.comboTier(state.combo),1,1).count}));
   assert(before.seconds>0&&before.strokes>0,'Normal controls must advance gameplay time and deliver strokes before the DecreaseHeat use');
   assert.equal(before.card===3,false,'The current card must not be a succubus card, so items are usable before the use');
   assert.equal(before.canUseItems,true,'Items must be usable before the use');
   assert.equal(before.charges,1);assert.equal(before.itemsUsed,0);
   const sprayButton=page.locator('#item-controls').getByRole('button',{name:/^Use Spray Bottle ·/});
   for(let attempt=0;attempt<4&&!await sprayButton.isEnabled();attempt++)await page.clock.fastForward(5000);
   assert.equal(await sprayButton.isEnabled(),true,'DecreaseHeat must be usable through the hotbar during normal gameplay');
   await sprayButton.click();
   const punished=await page.evaluate(()=>({card:state.card,pool:state.cardFlow?.pool,punishment:state.cardFlow?.punishment,travel:state.cardFlow?.travel,interval:state.cardFlow?.interval,assigned:state.cardFlow?.assigned,heat:state.heat,meter:state.meter,canUseItems:state.canUseItems,charges:run.inventory.state(1).charges,itemsUsed:run.state.ItemsUsed||0,status:document.querySelector('#status').textContent,background:document.querySelector('#session-background').dataset.backgroundPreset}));
   assert.equal(punished.card,3,'The punishment event must replace the current card with a succubus card');
   assert.equal(punished.pool,'succubus');
   assert.equal(punished.punishment,true,'The spawned card must be stamped as the punishment card, not an Apex Lure draw');
   assert.equal(punished.travel,1.5);
   assert(punished.interval>=.28&&punished.interval<=.33,`Punishment interval must be the traced [0.28,0.33] roll, got ${punished.interval}`);
   assert(punished.assigned>=Math.trunc(30*before.countMultiplier)&&punished.assigned<=Math.trunc(50*before.countMultiplier),`Punishment strokes must be the traced [30,50] roll times the combo count multiplier ${before.countMultiplier}, got ${punished.assigned}`);
   assert.equal(punished.heat,before.heat,'The punishment changes no heat: the DecreaseHeat effect is skipped');
   assert.equal(punished.meter,before.meter,'The punishment adds no cum meter: the DecreaseHeat effect is skipped');
   assert.equal(punished.canUseItems,false,'Items must be locked during the punishment event');
   assert(punished.status.includes('Punishment'),'The Punishment notification must be shown');
   assert.equal(punished.background,'taunt','The background must switch to 8 (tauntbackground) during the punishment event');
   assert.equal(punished.charges,0,'The DecreaseHeat charge is consumed even though its effect was skipped');
   assert.equal(punished.itemsUsed,1,'ItemsUsed increments on the punished use');
   assert.equal(await sprayButton.isDisabled(),true,'The hotbar must lock while items are locked');
   // FastPaceAnim (GM ubergraph stmt 1453): the punishment event plays
   // the same "Fast!" flash as the frenzy. The card takes 30-50 strokes
   // at 0.28-0.33 s, so 100 ms of clock cannot complete it.
   await page.clock.fastForward(100);
   assert.equal(await page.evaluate(()=>!document.querySelector('#pace-flash').hidden),true,'The Fast! flash must show at the punishment spawn (SpawnPunishmentEvent stmt 1453)');
   await page.clock.fastForward(2000);
   assert.equal(await page.evaluate(()=>document.querySelector('#pace-flash').hidden),true,'The Fast! flash must hide after 0.7547 s');
   const generation=await page.evaluate(()=>state.cardFlow.generation);
   let completed=false;
   for(let attempt=0;attempt<12&&!completed;attempt++){
    await page.clock.fastForward(5000);
    completed=await page.evaluate(gen=>!!state.cardFlow&&state.cardFlow.generation>gen,generation);
   }
   assert.equal(completed,true,'The punishment card must complete and draw the next card');
   const after=await page.evaluate(()=>({card:state.card,punishment:state.cardFlow?.punishment,canUseItems:state.canUseItems}));
   assert.equal(after.punishment,false,'The next card must not be a punishment card');
   assert.equal(after.canUseItems,after.card!==3,'The punishment lock must not persist past the card: items follow the normal per-card rule');
   await page.evaluate(()=>draw('slow',{force:true}));
   assert.equal(await page.evaluate(()=>state.canUseItems),true,'A fresh draw must re-enable items after the punishment card');
   assert.deepEqual(errors,[]);
   reports.push({before,punished,after});
  }finally{await context.close();}
 }finally{await browser.close();server.close();}
 console.log(JSON.stringify(reports,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
