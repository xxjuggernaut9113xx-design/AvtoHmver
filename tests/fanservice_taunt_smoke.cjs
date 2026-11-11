const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin;const fixture='taunt-hotbar';

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
   localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[1],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral taunt fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  },fixture);
  try{
   await page.goto(origin+'/fanservice/play.html?library='+fixture);
   await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption('1');
   await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.evaluate(()=>{
    if(state.card===3||state.card===5||state.card===6)draw('slow',{force:true});
    state.heat=50;checkpoint(true);
   });
   await page.clock.fastForward(2000);
   const tauntButton=page.locator('#taunt-action');
   assert.equal(await tauntButton.isHidden(),false,'The Taunt button must be visible during play');
   const before=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,heat:state.heat,meter:state.meter,card:state.card,canUseItems:state.canUseItems,taunts:state.TimesTaunted||0,totalTaunts:state.TotalTauntsUsed||0,generation:state.cardFlow?.generation,countMultiplier:FanserviceRules.drawMultipliers(FanserviceRules.comboTier(state.combo),1,1).count}));
   assert(before.seconds>0&&before.strokes>0,'Normal controls must advance gameplay time and deliver strokes before the taunt');
   assert.equal(before.card===3,false,'The current card must not be a succubus card, so the taunt takes the normal branch');
   assert.equal(before.canUseItems,true,'Items must be usable before the taunt');
   assert.equal(before.taunts,0);assert.equal(before.totalTaunts,0);
   await tauntButton.click();
   const taunted=await page.evaluate(()=>({card:state.card,pool:state.cardFlow?.pool,taunt:state.cardFlow?.taunt,travel:state.cardFlow?.travel,interval:state.cardFlow?.interval,assigned:state.cardFlow?.assigned,heat:state.heat,meter:state.meter,canUseItems:state.canUseItems,taunts:state.TimesTaunted||0,totalTaunts:state.TotalTauntsUsed||0,hasTaunted:state.hasTaunted,cooldownUntil:state.tauntCooldownUntil,status:document.querySelector('#status').textContent,background:document.querySelector('#session-background').dataset.backgroundPreset}));
   assert.equal(taunted.card,2,'The taunt must replace the current card with a fast card');
   assert.equal(taunted.pool,'fast');
   assert.equal(taunted.taunt,true,'The spawned card must be stamped as the taunt card');
   assert.equal(taunted.travel,1.75);
   assert(taunted.interval>=.28&&taunted.interval<=.322,`Taunt interval must be the traced [0.18,0.23] roll under the 0.28 floor, got ${taunted.interval}`);
   assert(taunted.assigned>=Math.trunc(20*before.countMultiplier)&&taunted.assigned<=Math.trunc(30*before.countMultiplier),`Taunt strokes must be the HighHeat 20-30 roll times the combo count multiplier ${before.countMultiplier}, got ${taunted.assigned}`);
   assert.equal(taunted.heat,before.heat+25,'The taunt must add the traced 25 heat');
   assert.equal(taunted.taunts,1,'The taunt must count toward the TimesTaunted metric');
   assert.equal(taunted.totalTaunts,1,'The taunt must count toward TotalTauntsUsed, the punishment roll input');
   assert.equal(taunted.hasTaunted,true,'The once-per-card lock must be set');
   assert.equal(taunted.cooldownUntil,before.seconds+5,'The 5-second cooldown must start at the taunt');
   assert(taunted.status.includes('Taunt!'),'The Taunt notification must be shown');
   assert.equal(taunted.background,'taunt','The background must switch to 8 (tauntbackground) during the taunt card');
   await tauntButton.click();
   const rejected=await page.evaluate(()=>({heat:state.heat,taunts:state.TimesTaunted||0,totalTaunts:state.TotalTauntsUsed||0,status:document.querySelector('#status').textContent}));
   assert.equal(rejected.heat,taunted.heat,'A rejected taunt must not add heat');
   assert.equal(rejected.taunts,1);assert.equal(rejected.totalTaunts,1);
   assert(rejected.status.includes('Taunt on Cooldown'),'The cooldown rejection must be shown before the already-taunted one');
   await page.clock.fastForward(5000);
   await page.evaluate(()=>draw('slow',{force:true}));
   await tauntButton.click();
   const second=await page.evaluate(()=>({card:state.card,taunt:state.cardFlow?.taunt,taunts:state.TimesTaunted||0,totalTaunts:state.TotalTauntsUsed||0,status:document.querySelector('#status').textContent}));
   assert.equal(second.card,2,'A new card must clear the once-per-card lock so the taunt works again');
   assert.equal(second.taunt,true);
   assert.equal(second.taunts,2);assert.equal(second.totalTaunts,2);
   assert(second.status.includes('Taunt!'),'The second taunt notification must be shown');
   assert.deepEqual(errors,[]);
   reports.push({before,taunted,rejected,second});
  }finally{await context.close();}
 }finally{await browser.close();server.close();}
 console.log(JSON.stringify(reports,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
