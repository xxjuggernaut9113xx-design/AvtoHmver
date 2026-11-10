const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin,activeFixture='';
const cases=[
 {id:'all-or-nothing-timer',index:'1',name:'Timer (seconds)',objective:1},
 {id:'all-or-nothing-strokes',index:'2',name:'Strokes',objective:2}
];

(async()=>{
 const engine=process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'&&process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:process.env.FANSERVICE_BROWSER_ENGINE!=='webkit'&&process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/api/fanservice/v1/resolve'){
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({library_id:activeFixture,media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}));return;
  }
  const relative=url.pathname.replace(/^\/fanservice\//,'');if(!url.pathname.startsWith('/fanservice/')){response.writeHead(404);response.end();return;}
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){response.writeHead(404);response.end();return;}
  let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> '${activeFixture}',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
  const type=relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream';response.writeHead(200,{'content-type':type});response.end(body);
 });
 const reports=[];
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  for(const testCase of cases){
   const fixture='item-reset-'+testCase.id,context=await browser.newContext({viewport:{width:390,height:844},...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?{deviceScaleFactor:3,isMobile:true,hasTouch:true}:{})}),page=await context.newPage(),errors=[];
   activeFixture=fixture;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(id=>{
    const progression={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[],challenge_progress:{},lifetime_metrics:{},unlocked_modifiers:['All or Nothing'],enabled_modifiers:['All or Nothing']};
    localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[1],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral item reset fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
   },fixture);
   try{
    await page.goto(origin+'/fanservice/play.html?library='+fixture);
    await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption(testCase.index);
    await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await page.getByRole('button',{name:'Start',exact:true}).click();
    await page.evaluate(()=>{if(!run.inventory.grant(1,3,{mode:0}))throw Error('Could not seed the three granted defensive charges.');if(run.inventory.catalog.find(row=>row.type===1)?.classification!=='Defensive')throw Error('Expected Decrease Heat to be a defensive item.');checkpoint(true);renderItemControls();});
    await page.clock.fastForward(12000);
    const before=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,coins:state.coins,charges:run.inventory.state(1).charges,enabled:state.modifiers.includes('All or Nothing')}));
    assert(before.seconds>0&&before.strokes>0,'Normal controls must advance gameplay time and deliver strokes before reset');
    assert(before.coins>0,'Delivered beats must earn coins before the reset');assert.equal(before.enabled,true);assert.equal(before.charges,3);
    const itemTitle=await page.evaluate(()=>run.inventory.catalog.find(row=>row.type===1).title);
    const use=page.getByRole('button',{name:new RegExp('^Use '+itemTitle+' ·')});
    for(let attempt=0;attempt<4&&!await use.isEnabled();attempt++)await page.clock.fastForward(5000);
    assert.equal(await use.isEnabled(),true,'Defensive item must be usable during normal gameplay');
    await use.click();
    await page.waitForFunction(()=>run.inventory.state(1).charges===2);
    const first=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,coins:state.coins,session:run.effectiveStats(),playerSessionLength:run.player.sessionLength,offsets:state.metricResetOffsets,hud:document.querySelector('#stats').textContent,charges:run.inventory.state(1).charges,card:state.card,pool:state.cardFlow?.pool,canUseItems:state.canUseItems}));
    assert.equal(first.coins,0,'All-or-Nothing clears coins after a successful defensive item');assert(first.seconds>=before.seconds);assert.equal(first.charges,2);
    if(testCase.objective===1){assert(first.session.seconds<0.1);assert(first.playerSessionLength<0.1);assert(first.offsets.sessionLength<=first.seconds);assert(first.seconds-first.offsets.sessionLength<0.1);assert.match(first.hud,/0 seconds/);}
    else{assert.equal(first.session.strokes,0);assert.equal(first.strokes,before.strokes);assert.equal(first.offsets.strokes,first.strokes);assert.match(first.hud,/0 beats/);}
    await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    const restored=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,coins:state.coins,session:run.effectiveStats(),playerSessionLength:run.player.sessionLength,offsets:state.metricResetOffsets,charges:run.inventory.state(1).charges}));
    assert.equal(restored.offsets[testCase.objective===1?'sessionLength':'strokes'],first.offsets[testCase.objective===1?'sessionLength':'strokes']);assert.equal(restored.charges,2);
    if(testCase.objective===1){assert(restored.session.seconds<0.1,'Timer must resume from zero within one tenth of a second after checkpoint restoration');assert(restored.playerSessionLength<0.1);}else assert.equal(restored.session.strokes,0);
    await page.getByRole('button',{name:'Start',exact:true}).click();await page.waitForFunction(()=>started);
    await page.waitForFunction(()=>!!run.returnEdge);
    await page.getByRole('button',{name:'Edge / E',exact:true}).click();
    await page.clock.runFor(1500);
    await page.waitForFunction(()=>!run.returnEdge&&state.edge?.phase==='idle'&&state.canUseItems===true);
    const returned=await page.evaluate(()=>({card:state.card,pool:state.cardFlow?.pool,returnEdge:run.returnEdge,edgePhase:state.edge?.phase,canUseItems:state.canUseItems}));
    assert.equal(returned.card,first.card,'Return edge resumes the interrupted gameplay card');
    assert.equal(returned.pool,first.pool,'Return edge resumes the interrupted gameplay pool');
    assert.equal(returned.returnEdge,null);assert.equal(returned.edgePhase,'idle');assert.equal(returned.canUseItems,first.canUseItems);
    await page.clock.fastForward(4000);
    const between=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,coins:state.coins,session:run.effectiveStats()}));
    assert(between.seconds>restored.seconds,'The absolute clock continues after checkpoint restoration');
    if(testCase.objective===1)assert(between.session.seconds>0,'Effective duration resumes from zero after restoration');else assert(between.session.strokes>0,'Effective strokes resume from zero after restoration');
    const secondUse=page.getByRole('button',{name:new RegExp('^Use '+itemTitle+' ·')});
    for(let attempt=0;attempt<4&&(!await secondUse.isEnabled()||!await page.evaluate(()=>state.canUseItems!==false));attempt++)await page.clock.fastForward(5000);
    assert.equal(await secondUse.isEnabled(),true,'Item must become usable again during normal gameplay');
    await secondUse.click();
    await page.waitForFunction(()=>run.inventory.state(1).charges===1);
    const second=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,coins:state.coins,session:run.effectiveStats(),offsets:state.metricResetOffsets,charges:run.inventory.state(1).charges,hud:document.querySelector('#stats').textContent}));
    assert.equal(second.coins,0);assert.equal(second.charges,1);assert(second.seconds>first.seconds,'Repeated reset must leave absolute elapsed time monotonic');
    if(testCase.objective===1){assert(second.session.seconds<0.1);assert(second.offsets.sessionLength<=second.seconds);assert(second.seconds-second.offsets.sessionLength<0.1);assert.match(second.hud,/0 seconds/);}
    else{assert.equal(second.session.strokes,0);assert.equal(second.offsets.strokes,second.strokes);assert.match(second.hud,/0 beats/);}
    assert.deepEqual(errors,[]);
    reports.push({objective:testCase.objective,name:testCase.name,before:{seconds:before.seconds,strokes:before.strokes,coins:before.coins},firstReset:{rawSeconds:first.seconds,rawStrokes:first.strokes,effectiveSeconds:first.session.seconds,effectiveStrokes:first.session.strokes,coins:first.coins,offsets:first.offsets},restored:{rawSeconds:restored.seconds,rawStrokes:restored.strokes,effectiveSeconds:restored.session.seconds,effectiveStrokes:restored.session.strokes,charges:restored.charges},returnEdge:{card:returned.card,pool:returned.pool,edgePhase:returned.edgePhase,canUseItems:returned.canUseItems},secondReset:{rawSeconds:second.seconds,rawStrokes:second.strokes,effectiveSeconds:second.session.seconds,effectiveStrokes:second.session.strokes,coins:second.coins,charges:second.charges,offsets:second.offsets},hudAfterSecondReset:second.hud});
   }finally{await context.close();}
  }
  const report={authority:'Playwright player controls with virtual clock and synthetic neutral media/Server route; inventory is seeded through grant API, modifier/profile through starting profile; no gameplay metrics are injected; reconstruction runtime only, not original-game execution or device acceptance',engine:process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?'Playwright WebKit 27.2':'Playwright Chromium',playwrightVersion:require('./browser/node_modules/playwright/package.json').version,viewport:{width:390,height:844,...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?{deviceScaleFactor:3,isMobile:true,hasTouch:true}:{})},cases:reports,sourceHashes:Object.fromEntries(['play.js','run.js','session_metrics.js','economy.js','cards.js','items.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]))};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'ticket48-item-reset-browser.json'),JSON.stringify(report,null,2));}
  console.log('All-or-Nothing browser smoke passed: defensive item resets timer and stroke metrics, preserves clock progression across checkpoint reload, and clears coins on repeated resets. '+JSON.stringify(report));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
