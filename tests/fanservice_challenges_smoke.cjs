const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/fanservice/**',async route=>{
   const relative=new URL(route.request().url()).pathname.slice('/fanservice/'.length)||'index.html',base=path.resolve(__dirname,'../static/fanservice'),file=path.resolve(base,relative);
   if(file.startsWith(base+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())await route.fulfill({path:file});else await route.continue();
  });
  await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');await page.evaluate(()=>serverReady);
  const png=fs.readFileSync(path.join(__dirname,'../static/fanservice/assets/button_rectangle_flat.png')).toString('base64');
  const library=await page.evaluate(async encoded=>{
   const [file]=await FanserviceStore.importFiles([new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'challenge.png',{type:'image/png'})],['slow','medium','fast','succubus','cum','ass','boobs']);
   const pack={id:'custom:challenges',library_id:libraryId,device_id:FanserviceStore.device,name:'Challenge fixture',description:'Neutral fixture',unlock_cost:0,selection:{ids:[],rules:[],local_ids:[file.id]}};
   const manifest={library_id:libraryId,media:[{id:'local:'+file.id}]};let next=FanserviceModel.change(FanserviceModel.fresh(),{action:'create',pack,manifest});next=FanserviceModel.change(next,{action:'enable',id:pack.id,enabled:true,manifest});next.fixture_field={preserved:true};localStorage.setItem(key(),JSON.stringify(next));return libraryId;
  },png);
  const open=async()=>{await page.goto(origin+'/fanservice/play.html?library='+encodeURIComponent(library));await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();};
  await open();await page.locator('#objective').selectOption('3');await page.locator('#objective-target').fill('30');await page.clock.install();
  await page.getByRole('button',{name:'Start',exact:true}).click();
  for(let count=1;count<=30;count++){
   await page.getByRole('button',{name:'Edge / E',exact:true}).click();
   assert.equal(await page.evaluate(()=>state.edges),count);
   if(count===30)break;
   for(let step=0;step<200;step++){
    await page.clock.runFor(100);
    const phase=await page.evaluate(()=>state.edge?.phase);
    if(phase==='rest'){await page.getByRole('button',{name:'Continue / G',exact:true}).click();break;}
    if(phase==='mercy'){await page.getByRole('button',{name:'Continue streak',exact:true}).click();break;}
    assert(step<199,'Edge handoff reaches an ordinary continuation choice');
   }
  }
  await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');await page.getByText(/Rewards saved once/).waitFor();
  const settled=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));
  assert.equal(settled.progression.sessions,1);assert.equal(settled.progression.wins,1);assert.equal(settled.progression.lifetime_metrics.Edges,30);
  assert.equal(settled.progression.challenge_progress.reach_level_5.completed,false,'Session XP alone stays below the original 750 XP requirement');
  await page.getByRole('button',{name:'Challenges / modifiers',exact:true}).click();
  await page.getByRole('button',{name:'Claim Intermediate Edger',exact:true}).click();
  await page.getByRole('button',{name:'Claim Master Edger',exact:true}).click();
  await page.getByRole('button',{name:'Claim Master of Control',exact:true}).click();
  await page.getByRole('button',{name:'Claim Reach Level 5',exact:true}).waitFor();
  const claimed=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));
  assert.equal(claimed.progression.lifetime_metrics.TotalXPEarned,claimed.progression.total_xp);
  assert.equal(claimed.progression.challenge_progress.reach_level_5.completed,true);
  assert.deepEqual(claimed.fixture_field,{preserved:true});assert.deepEqual(claimed.packs,settled.packs);
  await open();await page.getByRole('button',{name:'Challenges / modifiers',exact:true}).click();
  await page.getByRole('button',{name:'Enable Pheromones',exact:true}).click();
  await page.getByRole('button',{name:'Enable Succufrenzy',exact:true}).click();await page.getByText('Conflicting modifiers: Pheromones',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)).progression.enabled_modifiers),['Pheromones']);
  await page.getByRole('button',{name:'Enable Raw Dog',exact:true}).click();await page.getByRole('button',{name:'Close challenges',exact:true}).click();
  await page.locator('#objective').selectOption('3');await page.locator('#objective-target').fill('2');await page.getByRole('button',{name:'Start',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>state.modifiers),['Pheromones','Raw Dog']);
  assert.equal(await page.evaluate(()=>FanserviceModifiers.options(state.modifiers).canUseItems),false);
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();await page.clock.runFor(1100);await page.getByRole('button',{name:'Continue / G',exact:true}).click();await page.getByRole('button',{name:'Edge / E',exact:true}).click();await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');await page.getByText(/Rewards saved once/).waitFor();
  await page.getByRole('button',{name:'Challenges / modifiers',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Claim Intermediate Edger',exact:true}).count(),0);
  const final=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));assert.equal(final.progression.sessions,2);assert.equal(final.progression.wins,2);assert.equal(final.progression.lifetime_metrics.Edges,32);assert.deepEqual(errors,[]);
  const report={authority:'shared playable browser UI with virtual time; not original-game execution',firstSessionEdges:30,secondSessionEdges:2,sessions:2,wins:2,claimXPCounted:true,conflictRejected:true,enabledModifiers:final.progression.enabled_modifiers,claimsRemainClaimed:true,profilePreserved:true};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'challenges-browser.json'),JSON.stringify(report,null,2));}
  console.log('Challenges smoke passed. '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
