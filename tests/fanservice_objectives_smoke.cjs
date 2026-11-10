const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42177';
const fixture='classic-objectives-fixture';
const cases=[
 {index:'1',name:'Timer (seconds)',objective:1,target:300,checkpointReload:true},
 {index:'2',name:'Strokes',objective:2,target:100},
 {index:'3',name:'Edges',objective:3,target:2,edge:true},
 {index:'4',name:'Prejac (seconds)',objective:6,target:30},
 {index:'5',name:'Tribute',objective:7,target:2,immediate:true,finishName:'Hold to record tribute'},
 {index:'6',name:'Succu Slayer',objective:8,target:5,difficulty:2,modifiers:['Succufrenzy']},
 {index:'0',name:'Cum meter',objective:0}
];

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const reports=[];
 try{
  for(const testCase of cases){
   console.log('Starting Classic objective smoke: '+testCase.name);
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(({id,modifiers})=>{
    const key='fanservice-profile-v1:'+id;
    if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:1,unlock_points:0,progression:{unlocked_modifiers:modifiers,enabled_modifiers:modifiers},packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral Classic objective fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
   },{id:fixture,modifiers:testCase.modifiers||[]});
   await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:fixture,media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']} ]}});
    const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    let body=fs.readFileSync(file);
    if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> '${fixture}',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
    return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
   });
   try{
    await page.goto(origin+'/fanservice/play.html?library='+fixture);
    await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    await page.locator('#mode').selectOption('0');
    await page.locator('#objective').selectOption(testCase.index);
    if(testCase.target)await page.locator('#objective-target').fill(String(testCase.target));
    await page.locator('#difficulty').selectOption(String(testCase.difficulty??2));
    await page.clock.install();
    await page.getByRole('button',{name:'Start',exact:true}).click();
    console.log('Started Classic objective smoke: '+testCase.name);
    let checkpointReloaded=false,checkpointReload=null,afterCompletedReload={sessions:1,wins:1,checkpoint:null};
    if(testCase.checkpointReload){
     await page.clock.fastForward(5000);
     await page.locator('#stage').click();
     const checkpoint=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,meter:state.meter,objective:(run.roundObjective||run.objective.state).objective,target:(run.roundObjective||run.objective.state).target,flowCompleted:state.cardFlow?.completed||0}));
     assert(checkpoint.seconds>0&&checkpoint.strokes>0,'Ordinary card play advances before checkpoint reload');
     await page.reload();
     await page.waitForFunction(()=>!document.querySelector('#start').disabled);
     const beforeResume=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,meter:state.meter,objective:(run.roundObjective||run.objective.state).objective,target:(run.roundObjective||run.objective.state).target,flowCompleted:state.cardFlow?.completed||0}));
     assert.deepEqual(beforeResume,checkpoint,'Reload restores the checkpoint without changing objective progress');
     await page.getByRole('button',{name:'Start',exact:true}).click();
     await page.waitForFunction(()=>started);
     const resumed=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,meter:state.meter,objective:(run.roundObjective||run.objective.state).objective,target:(run.roundObjective||run.objective.state).target,flowCompleted:state.cardFlow?.completed||0,edgePhase:state.edge?.phase||'idle'}));
     assert(Math.abs(resumed.seconds-checkpoint.seconds)<.1,'Resume advances less than one tenth of a second');
     assert.equal(resumed.objective,checkpoint.objective);assert.equal(resumed.target,checkpoint.target);
     assert.equal(resumed.strokes,checkpoint.strokes);assert.equal(resumed.meter,checkpoint.meter);
     checkpointReload={savedSeconds:checkpoint.seconds,restoredSeconds:resumed.seconds,savedStrokes:checkpoint.strokes,restoredStrokes:resumed.strokes,target:checkpoint.target};checkpointReloaded=true;
    }
    if(testCase.edge)await page.getByRole('button',{name:'Edge / E',exact:true}).click();
    if(testCase.immediate){
     for(let count=0;count<(testCase.target||1);count++){
      await page.getByRole('button',{name:testCase.finishName||'Hold to finish',exact:true}).focus();
      await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');
     }
    }else{
     let reached=false;
     let progress;
     const quantum=10000;
     for(let elapsed=0;elapsed<7200000;elapsed+=quantum){
      await page.clock.fastForward(quantum);
      progress=await page.evaluate(()=>({eligible:run.player.isAllowedToCum||state.meter>=1||run.phase==='complete',phase:run.phase,edgePhase:state.edge?.phase||'idle',seconds:state.seconds,strokes:state.strokes,edges:state.edges,succubi:state.succubi,meter:state.meter,flow:state.cardFlow&&{started:state.cardFlow.started,assigned:state.cardFlow.assigned,completed:state.cardFlow.completed,ended:state.cardFlow.ended}}));
      reached=progress.eligible;
      if(testCase.edge&&progress.edges===1&&await page.evaluate(()=>state.edge?.phase==='rest')){
       await page.getByRole('button',{name:'Continue / G',exact:true}).click();
       await page.getByRole('button',{name:'Edge / E',exact:true}).click();
      }
      if(checkpointReloaded&&progress.edgePhase==='rest'&&progress.edges<4){
       await page.getByRole('button',{name:'Continue / G',exact:true}).click();
       await page.getByRole('button',{name:'Edge / E',exact:true}).click();
      }
      if(reached)break;
     }
     assert(reached,`${testCase.name} reaches finish eligibility through the playable timeline: ${JSON.stringify(progress)}`);
     if(testCase.name==='Edges')assert((await page.evaluate(()=>state.edges))>=2,'Two normal Edge actions meet the selected objective');
     if(testCase.name==='Succu Slayer')assert((await page.evaluate(()=>state.succubi))>=5,'Five normal Succubus card queues are completed');
     if(testCase.name==='Strokes')assert((await page.evaluate(()=>state.strokes))>=100,'Delivered card beats meet the selected stroke target');
     if(testCase.name==='Timer (seconds)')assert((await page.evaluate(()=>state.seconds))>=300,'Playable time meets the selected timer target');
     if(testCase.name==='Cum meter')assert((await page.evaluate(()=>state.meter))>=1,'Delivered card beats fill the meter');
     await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();
     await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');
    }
    await page.getByText(/Rewards saved once/).waitFor();
    const result=await page.evaluate(()=>({objective:(run.roundObjective||run.objective.state).objective,target:(run.roundObjective||run.objective.state).target,difficulty:run.config.difficulty,phase:run.phase,seconds:state.seconds,strokes:state.strokes,edges:state.edges,succubi:state.succubi,milkingCount:state.milkingCount,meter:state.meter,finished,won:state.won,progression:JSON.parse(localStorage.getItem(profileKey)).progression}));
    assert.equal(result.objective,testCase.objective);assert(result.finished&&result.won,`${testCase.name} settles a winning session`);
    if(testCase.name==='Succu Slayer'){
     assert.equal(result.difficulty,2,'Insane difficulty was selected through the normal UI');
     assert.equal(result.progression.lifetime_metrics.SessionsWonAtMaxDifficulty,1);
     assert.equal(result.progression.lifetime_metrics.SuccuSlayerSessionsWon,1);
     assert.equal(result.progression.challenge_progress.built_different.completed,true);
     assert.equal(result.progression.challenge_progress.public_safety.requirements[0].CurrentValue,1);
    }
    assert.equal(result.progression.sessions,1);assert.equal(result.progression.wins,1);assert.equal(result.progression.completed_sessions.length,1);assert.deepEqual(errors,[]);
    let repeatAttempt={sessions:1,wins:1};
    if(testCase.checkpointReload){
     assert(await page.locator('#finish').isDisabled(),'Completed session disables another finish action');
     await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');
     repeatAttempt=await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem(profileKey)).progression;return {sessions:p.sessions,wins:p.wins};});
     assert.deepEqual(repeatAttempt,{sessions:1,wins:1},'A repeated finish key attempt cannot settle a completed run twice');
     await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
     afterCompletedReload=await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem(profileKey)).progression;return {sessions:p.sessions,wins:p.wins,checkpoint:localStorage.getItem(checkpointKey)};});
     assert.deepEqual(afterCompletedReload,{sessions:1,wins:1,checkpoint:null},'Reload after settlement retains one reward ledger entry and no resumable run');
    }
    reports.push({name:testCase.name,target:result.target,difficulty:result.difficulty,seconds:result.seconds,strokes:result.strokes,edges:result.edges,succubi:result.succubi,milkingCount:result.milkingCount,meter:result.meter,won:result.won,sessions:result.progression.sessions,sessionMetrics:{SessionsWonAtMaxDifficulty:result.progression.lifetime_metrics.SessionsWonAtMaxDifficulty||0,SuccuSlayerSessionsWon:result.progression.lifetime_metrics.SuccuSlayerSessionsWon||0},builtDifferentCompleted:!!result.progression.challenge_progress.built_different?.completed,publicSafetyProgress:result.progression.challenge_progress.public_safety?.requirements?.[0]?.CurrentValue??0,checkpointReloaded,checkpointReload,repeatAttempt,afterCompletedReload});
   }finally{await context.close();}
  }
  const report={authority:'normal mobile player controls with Playwright virtual-clock fast-forward (one player tick per 10 simulated seconds) and synthetic neutral media/Server routes; Succu Slayer fixture enables unlocked Succufrenzy to force the encounter and does not test weighted event chance; reconstruction runtime and catalog only, not original-game execution or provenance',fixture,sourceHashes:Object.fromEntries(['objectives.js','run.js','cards.js','play.js','progression.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')])),cases:reports};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'classic-objectives-browser.json'),JSON.stringify(report,null,2));}
  console.log('Classic objective controls passed: all seven supported selections reached normal finish eligibility and one winning progression settlement. '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
