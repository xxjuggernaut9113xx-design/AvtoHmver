const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin;const fixture='edge-punishment';

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
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
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(id=>{
   const progression={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[],challenge_progress:{},lifetime_metrics:{},unlocked_modifiers:[],enabled_modifiers:[]};
   localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[1],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral punishment fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  },fixture);
  try{
   await page.goto(origin+'/fanservice/play.html?library='+fixture);
   await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption('1');
   await page.clock.install();await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.clock.runFor(2000);
   const running=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,card:state.card}));
   assert(running.seconds>0&&running.strokes>0,'Normal controls must advance gameplay time and deliver strokes before the Edge cases');
   await page.evaluate(()=>{if([3,5,6].includes(state.card))draw('slow',{force:true});});
   assert.notEqual(await page.evaluate(()=>state.card),5,'The session must not start on an edge card');
   // Deterministic trigger rate: (25/5)*20 = 100%.
   await page.evaluate(()=>{run.state.TotalTauntsUsed=25;});
   const edgeButton=page.getByRole('button',{name:'Edge / E',exact:true});
   async function until(predicate,label){for(let n=0;n<3000;n++){if(await page.evaluate(predicate))return;await page.clock.runFor(50);}throw Error('Timed out: '+label);}
   const snap=()=>page.evaluate(()=>({card:state.card,edges:state.edges,phase:state.edge?.phase,punishment:state.cardFlow?.punishment,pool:state.cardFlow?.pool,interval:state.cardFlow?.interval,assigned:state.cardFlow?.assigned,canUseItems:state.canUseItems,status:document.querySelector('#status').textContent,background:document.querySelector('#session-background').dataset.backgroundPreset,countMultiplier:FanserviceRules.drawMultipliers(FanserviceRules.comboTier(state.combo),1,1).count}));
   // Guard case (hotbar stmt 28-31): the direct Edge — current card is not an
   // edge card (byte 5) — never rolls, even at a 100% rate.
   assert.equal(await edgeButton.isEnabled(),true,'Edge must be usable during normal gameplay');
   await edgeButton.click();
   const guard=await snap();
   assert.equal(guard.edges,1,'The direct Edge must start an edge');
   assert.notEqual(guard.card,3,'The direct Edge must not spawn a punishment card');
   assert.equal(guard.punishment,false,'The direct Edge must not stamp a punishment card');
   // Drive the guard edge to its edge card: rest, then Continue / G.
   await until(()=>['rest','mercy'].includes(state.edge.phase),'Edge handoff');
   await page.getByRole('button',{name:'Continue / G',exact:true}).click();
   const onEdgeCard=await snap();
   assert.equal(onEdgeCard.card,5,'Continue must start the edge card');
   assert.equal(onEdgeCard.phase,'sequence','The edge card must be in its sequence phase');
   // Trigger case (hotbar stmt 32-35): Edge on the edge card rolls at 100%
   // and spawns the punishment event, blocking the edge (TriggerEdgeV2 never runs).
   const before=await snap();
   assert.equal(await edgeButton.isEnabled(),true,'Edge must be usable on the edge card');
   await edgeButton.click();
   const punished=await snap();
   assert.equal(punished.card,3,'The punishment event must replace the edge card with a succubus card');
   assert.equal(punished.pool,'succubus');
   assert.equal(punished.punishment,true,'The spawned card must be stamped as the punishment card, not an Apex Lure draw');
   assert(punished.interval>=.28&&punished.interval<=.33,`Punishment interval must be the traced [0.28,0.33] roll, got ${punished.interval}`);
   assert(punished.assigned>=Math.trunc(30*before.countMultiplier)&&punished.assigned<=Math.trunc(50*before.countMultiplier),`Punishment strokes must be the traced [30,50] roll times the combo count multiplier ${before.countMultiplier}, got ${punished.assigned}`);
   assert.equal(punished.canUseItems,false,'Items must be locked during the punishment event');
   assert(punished.status.includes('Punishment'),'The Punishment notification must be shown');
   assert.equal(punished.background,'taunt','The background must switch to 8 (tauntbackground) during the punishment event');
   assert.equal(punished.edges,1,'The punished Edge must not record: TriggerEdgeV2 never runs');
   assert.equal(punished.phase,'sequence','The edge must stay in its sequence phase: it never started');
   // Wait for the punishment card to complete, then draw fresh. (No
   // generation change is expected here: the edge is still active, so the
   // next card does not auto-draw — completion is the flow finishing its
   // strokes, as in the edge smoke's .85 check.)
   let completed=false;
   for(let n=0;n<3000&&!completed;n++){completed=await page.evaluate(()=>!!state.cardFlow&&state.cardFlow.completed>=state.cardFlow.assigned);if(!completed)await page.clock.runFor(50);}
   assert.equal(completed,true,'Punishment card must complete');
   await page.evaluate(()=>draw('slow',{force:true}));
   // Miss case (hotbar stmt 33, miss): at a 0% rate the Edge on the edge card
   // records the edge and spawns nothing.
   await page.evaluate(()=>{run.state.TotalTauntsUsed=0;});
   await edgeButton.click();
   const second=await snap();
   assert.equal(second.edges,2,'The direct Edge after the punishment must start the next edge');
   assert.equal(second.punishment,false,'The direct Edge after the punishment must not stamp a punishment card');
   await until(()=>['rest','mercy'].includes(state.edge.phase),'Second Edge handoff');
   await page.getByRole('button',{name:'Continue / G',exact:true}).click();
   assert.equal((await snap()).card,5,'Continue must start the second edge card');
   await edgeButton.click();
   const recorded=await snap();
   assert.equal(recorded.edges,3,'The missed Edge must record on the edge card');
   assert.notEqual(recorded.card,3,'The missed Edge must not spawn a punishment card');
   assert.equal(recorded.punishment,false,'The missed Edge must not stamp a punishment card');
   assert.deepEqual(errors,[]);
   reports.push({guard,punished,recorded});
  }finally{await context.close();}
 }finally{await browser.close();server.close();}
 console.log(JSON.stringify(reports,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
