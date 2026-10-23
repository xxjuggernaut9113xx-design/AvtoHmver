const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/fanservice/');await page.getByRole('checkbox',{name:'Select sample1.png'}).waitFor();
  const png=fs.readFileSync(require.resolve('../static/fanservice/assets/button_rectangle_flat.png')).toString('base64');
  const library=await page.evaluate(async encoded=>{
   const [file]=await FanserviceStore.importFiles([new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'economy.png',{type:'image/png'})],['slow','medium','fast','succubus','cum','ass','boobs']);
   const pack={id:'custom:economy-test',library_id:libraryId,device_id:FanserviceStore.device,name:'Economy test',description:'Synthetic fixture',unlock_cost:0,selection:{ids:[],rules:[],local_ids:[file.id]}};
   const manifest={library_id:libraryId,media:[{id:'local:'+file.id}]};let next=FanserviceModel.change(FanserviceModel.fresh(),{action:'create',pack,manifest});next=FanserviceModel.change(next,{action:'enable',id:pack.id,enabled:true,manifest});next.user_field={preserved:true};localStorage.setItem(key(),JSON.stringify(next));return libraryId;
  },png);
  let releaseCapabilities,capabilitiesRequested;
  const gate=new Promise(resolve=>releaseCapabilities=resolve),requested=new Promise(resolve=>capabilitiesRequested=resolve);
  await page.route('**/api/fanservice/v1/capabilities',async route=>{capabilitiesRequested();await gate;await route.continue();});
  await page.reload({waitUntil:'domcontentloaded'});await requested;
  await page.locator('[data-local-tile]').filter({hasText:'economy.png'}).waitFor();
  await page.locator('#unlocks').click();await page.getByRole('heading',{name:'Economy test · Custom',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>libraryId),library,'Offline controls must bind to the saved profile before the Server responds');
  releaseCapabilities();await page.evaluate(()=>serverReady);await page.locator('#unlocks-dialog').evaluate(dialog=>dialog.close());await page.unroute('**/api/fanservice/v1/capabilities');
  await page.goto(origin+'/fanservice/play.html?library='+encodeURIComponent(library));await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();
  await page.locator('#difficulty').selectOption('2');await page.locator('#loot-enabled').check();
  await page.getByRole('button',{name:'Inventory / loadout',exact:true}).click();await page.getByRole('button',{name:'Equip DecreaseHeat',exact:true}).click();await page.getByRole('button',{name:'Close inventory',exact:true}).click();
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.waitForFunction(()=>state.lootRolls>=1,{},{timeout:20000});
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const before=await page.evaluate(()=>({id:sessionId,run:run.export(),lastBeat,speed}));assert(before.run.state.strokes>=20);assert.equal(before.run.config.difficulty,2);assert(before.run.state.heat>10);
  await page.reload();await page.getByText('Unfinished session ready. Tap Start to resume.').waitFor();
  const restored=await page.evaluate(()=>({id:sessionId,run:run.export(),lastBeat,speed}));assert.deepEqual(restored,before);assert.equal(await page.locator('#difficulty').inputValue(),'2');
  await page.getByRole('button',{name:'Start',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
  assert.equal(await page.evaluate(()=>state.totalDraws),before.run.state.totalDraws,'resume must not count another draw or reset item multipliers');
  await page.evaluate(()=>{const current=JSON.parse(localStorage.getItem(profileKey));current.packs[0].name='Edited during economy run';localStorage.setItem(profileKey,JSON.stringify(current));});
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.waitForFunction(()=>finished);
  const settled=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));assert.equal(settled.progression.sessions,1);assert.equal(settled.packs[0].name,'Edited during economy run');assert(settled.progression.lifetime_metrics.Strokes>=20);assert.deepEqual(settled.user_field,{preserved:true});
  await page.evaluate(()=>end(false));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)).progression.sessions),1);assert.deepEqual(errors,[]);
  console.log('Live economy smoke passed: profile-readiness race, real timer beats and loot, difficulty heat, exact reward/RNG/checkpoint restore, no resume draw reset, and one profile-preserving settlement.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
