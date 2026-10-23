const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/fanservice/');await page.getByRole('checkbox',{name:'Select sample1.png'}).waitFor();
  const library=await page.evaluate(async()=>{
   const files=await FanserviceStore.importFiles([new File(['synthetic media'],'flow.png',{type:'image/png'})],['slow','medium','fast','succubus','cum','ass','boobs']);
   const pack={id:'custom:flow-test',library_id:libraryId,device_id:FanserviceStore.device,name:'Flow test',description:'Synthetic fixture',unlock_cost:0,selection:{ids:[],rules:[],local_ids:[files[0].id]}};
   const manifest={library_id:libraryId,media:[{id:'local:'+files[0].id}]};let next=FanserviceModel.change(FanserviceModel.fresh(),{action:'create',pack,manifest});next=FanserviceModel.change(next,{action:'enable',id:pack.id,enabled:true,manifest});next.user_field={preserved:true};localStorage.setItem(key(),JSON.stringify(next));return libraryId;
  });
  await page.goto(origin+'/fanservice/play.html?library='+encodeURIComponent(library));await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();
  await page.locator('#mode').selectOption('1');await page.locator('#tower-rounds').fill('3');await page.getByRole('button',{name:'Start',exact:true}).click();
  for(let round=1;round<=3;round++){
   await page.getByRole('button',{name:'Choose Tower option 1',exact:true}).click();
   if(round===1){
    await page.evaluate(()=>checkpoint(true));const before=await page.evaluate(()=>({id:sessionId,state:run.export()}));await page.reload();await page.getByText('Unfinished session ready. Tap Start to resume.').waitFor();assert.equal(await page.evaluate(()=>sessionId),before.id);assert.equal(await page.evaluate(()=>run.tower.round),1);await page.getByRole('button',{name:'Start',exact:true}).click();
    await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem(profileKey));p.packs[0].name='Renamed during session';localStorage.setItem(profileKey,JSON.stringify(p));});
   }
   await page.evaluate(()=>{const o=run.roundObjective;if(o.objective===0)state.meter=1;else if(o.objective===1)state.seconds=o.baselineDuration+o.target;else if(o.objective===2)state.strokes=o.baselineStrokes+o.target;else if(o.objective===3)state.edges=o.baselineEdges+o.target;else if(o.objective===7)state.milkingCount=o.baselineMilking+o.target;else if(o.objective===8)state.succubi=o.baselineSuccubi+o.target;objectiveEvents(run.advance(0));render();});
   if(await page.evaluate(()=>run.phase==='playing'))await page.getByRole('button',{name:'Finish / Enter',exact:true}).click();
   if(round<3){await page.getByRole('button',{name:'Continue Tower',exact:true}).waitFor();await page.getByRole('button',{name:'Inventory / loadout',exact:true}).click();await page.getByRole('heading',{name:'Inventory and loadout',exact:true}).waitFor();await page.getByRole('button',{name:'Close inventory',exact:true}).click();await page.getByRole('button',{name:'Continue Tower',exact:true}).click();}
  }
  await page.waitForFunction(()=>finished);const profile=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));
  assert.equal(profile.progression.sessions,1);assert.equal(profile.progression.wins,1);assert.equal(profile.progression.lifetime_metrics.BestTowerWinRounds,3);assert.equal(profile.packs[0].name,'Renamed during session');assert.deepEqual(profile.user_field,{preserved:true});
  await page.evaluate(()=>end(true));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)).progression.sessions),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem(checkpointKey)),null);assert.deepEqual(errors,[]);
  console.log('Mobile flow smoke passed: three-round Tower, objective completion/release, shop controls, mid-round resume, profile edit preservation, and one settlement. Synthetic counters drive objective boundaries.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
