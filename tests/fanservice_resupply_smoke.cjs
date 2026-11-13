const playwrightModule=process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright';
const {chromium,webkit}=require(playwrightModule);
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin;const fixture='resupply-hotbar';

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
   const progression={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[],challenge_progress:{},lifetime_metrics:{},unlocked_modifiers:['Hot Hands'],enabled_modifiers:['Hot Hands']};
   localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[7],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral resupply fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  },fixture);
  try{
   await page.goto(origin+'/fanservice/play.html?library='+fixture);
   await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption('1');
   await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.evaluate(()=>{if(!run.inventory.hotbarItems.includes(7))throw Error('Resupply was not in the hotbar from the seeded loadout.');if(!run.inventory.grant(7,1,{mode:0}))throw Error('Could not seed the single Resupply charge.');if(run.inventory.catalog.find(row=>row.type===7)?.classification!=='Defensive')throw Error('Expected Resupply to be a defensive item.');checkpoint(true);renderItemControls();});
   await page.clock.fastForward(12000);
   const before=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,combo:state.combo,heat:state.heat,coins:state.coins,charges:run.inventory.state(7).charges,itemsUsed:run.state.ItemsUsed||0,defensiveUsed:run.state.DefensiveItemsUsed||0,modifiers:[...state.modifiers],heatCap:FanserviceEconomy.heatCap(run)}));
   assert(before.seconds>0&&before.strokes>0,'Normal controls must advance gameplay time and deliver strokes before the Resupply use');
   assert(before.combo>0,'Beats must build a nonzero combo before the Resupply use, so the activation combo reset is observable');
   assert(before.heat<=85,'Heat must leave room for the +10 Hot Hands step below the cap, so the step is observable');
   assert.equal(before.charges,1);assert.equal(before.itemsUsed,0);assert.equal(before.defensiveUsed,0);
   assert(before.modifiers.includes('Hot Hands'),'Hot Hands must be enabled for this round');
   assert(!runHasHeatSpell(await page.evaluate(()=>run.ownedModifiers)),'Heat Spell must not be owned, so it cannot mask the Hot Hands heat step');
   function runHasHeatSpell(owned){return owned.includes(4);}
   const resupplyButton=page.locator('#item-controls').getByRole('button',{name:/^Use Resupply ·/});
   for(let attempt=0;attempt<4&&!await resupplyButton.isEnabled();attempt++)await page.clock.fastForward(5000);
   assert.equal(await resupplyButton.isEnabled(),true,'Resupply must be usable through the hotbar during normal gameplay');
   await resupplyButton.click();
   const atActivation=await page.evaluate(()=>({itemsUsed:run.state.ItemsUsed||0,defensiveUsed:run.state.DefensiveItemsUsed||0,heat:state.heat,combo:state.combo,charges:run.inventory.state(7).charges,resupplyRemaining:state.effects.resupplyRemaining,storeOpen:document.querySelector('#inventory-dialog').open,metricsItemsUsed:state.metrics.itemsUsed||0}));
   assert.equal(atActivation.itemsUsed,1,'economy.itemUsed must run at activation: ItemsUsed increments before the store delay elapses');
   assert.equal(atActivation.defensiveUsed,1,'Resupply is defensive, so DefensiveItemsUsed increments at activation');
   assert(Math.abs(atActivation.heat-Math.min(before.heat+10,before.heatCap))<1e-6,`Hot Hands heat must be visible at activation: expected ${Math.min(before.heat+10,before.heatCap)}, got ${atActivation.heat}`);
   assert.equal(atActivation.combo,0,'Activation must reset the combo to zero immediately');
   assert.equal(atActivation.charges,1,'The Resupply charge must still be 1 immediately after activation');
   assert.equal(atActivation.resupplyRemaining,2,'The 2s store delay must be pending immediately after activation');
   assert.equal(atActivation.storeOpen,false,'The store must not be open immediately after activation');
   await page.clock.fastForward(1000);
   const midDelay=await page.evaluate(()=>({charges:run.inventory.state(7).charges,resupplyRemaining:state.effects.resupplyRemaining,itemsUsed:run.state.ItemsUsed||0,storeOpen:document.querySelector('#inventory-dialog').open}));
   assert.equal(midDelay.charges,1,'The charge must survive the first second of the store delay');
   assert(midDelay.resupplyRemaining>0&&midDelay.resupplyRemaining<2,'The store delay must be counting down after one second');
   assert.equal(midDelay.itemsUsed,1);assert.equal(midDelay.storeOpen,false);
   await page.clock.fastForward(2000);
   await page.waitForFunction(()=>state.effects.resupplyRemaining===0&&document.querySelector('#inventory-dialog').open);
   const afterStore=await page.evaluate(()=>({itemsUsed:run.state.ItemsUsed||0,defensiveUsed:run.state.DefensiveItemsUsed||0,charges:run.inventory.state(7).charges,resupplyRemaining:state.effects.resupplyRemaining,storeOpen:document.querySelector('#inventory-dialog').open,metricsItemsUsed:state.metrics.itemsUsed||0}));
   assert.equal(afterStore.charges,0,'The Resupply charge is consumed only when the store opens');
   assert.equal(afterStore.itemsUsed,1,'ItemsUsed must not increment a second time when the store opens');
   assert.equal(afterStore.defensiveUsed,1,'DefensiveItemsUsed must not increment a second time when the store opens');
   assert.equal(afterStore.storeOpen,true,'The store must open when the 2s delay elapses');
   await page.evaluate(()=>checkpoint(true));
   const savedCheckpoint=await page.evaluate(key=>{const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved)throw Error('No checkpoint was saved after the store opened.');return {itemsUsed:saved.run.state.ItemsUsed,defensiveUsed:saved.run.state.DefensiveItemsUsed,charges:saved.run.inventory.ownedItems.find(row=>row.type===7)?.charges,resupplyRemaining:saved.run.state.effects.resupplyRemaining};},'fanservice-session-v1:'+fixture);
   assert.equal(savedCheckpoint.itemsUsed,1,'The saved checkpoint must carry the single activation count');
   assert.equal(savedCheckpoint.defensiveUsed,1);
   assert.equal(savedCheckpoint.charges,0,'The saved checkpoint must carry the consumed charge');
   assert.equal(savedCheckpoint.resupplyRemaining,0,'The saved checkpoint must carry the elapsed store delay');
   await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   const restored=await page.evaluate(()=>({itemsUsed:run.state.ItemsUsed||0,defensiveUsed:run.state.DefensiveItemsUsed||0,charges:run.inventory.state(7).charges,resupplyRemaining:state.effects.resupplyRemaining,combo:state.combo,seconds:state.seconds}));
   assert.equal(restored.itemsUsed,1,'ItemsUsed must survive the checkpoint reload unchanged');
   assert.equal(restored.defensiveUsed,1,'DefensiveItemsUsed must survive the checkpoint reload unchanged');
   assert.equal(restored.charges,0,'The consumed charge must stay consumed after the reload');
   assert.equal(restored.resupplyRemaining,0,'The elapsed store delay must stay elapsed after the reload');
   assert.deepEqual(errors,[]);
   reports.push({before,atActivation,midDelay,afterStore,savedCheckpoint,restored});
  }finally{await context.close();}
  const report={authority:'Playwright player hotbar controls with virtual clock and synthetic neutral media/Server route; Hot Hands and the Resupply hotbar slot are seeded through the starting profile and the public grant API; combo and heat are built by delivered beats, no gameplay metrics are injected; reconstruction runtime only, not original-game execution or device acceptance',engine:process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?'Playwright WebKit 27.2':'Playwright Chromium',playwrightVersion:require(`${playwrightModule}/package.json`).version,viewport:{width:390,height:844,...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?{deviceScaleFactor:3,isMobile:true,hasTouch:true}:{})},cases:reports,sourceHashes:Object.fromEntries(['play.js','run.js','session_metrics.js','economy.js','cards.js','items.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]))};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'ticket48-resupply-browser.json'),JSON.stringify(report,null,2));}
  console.log('Resupply browser smoke passed: hotbar activation applies economy.itemUsed at once (ItemsUsed/DefensiveItemsUsed +1, Hot Hands heat +10, combo reset), the charge survives the 2s delay and is consumed only when the store opens, no second count follows, and the checkpoint reload preserves the activation count and consumed charge. '+JSON.stringify(report));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
