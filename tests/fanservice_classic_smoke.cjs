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
  await page.addInitScript(()=>{window.classicBeatPulses=0;Object.defineProperty(navigator,'vibrate',{configurable:true,value:duration=>{if(duration===25)window.classicBeatPulses++;return true;}});});
  await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');await page.evaluate(()=>serverReady);
  const png=fs.readFileSync(path.join(__dirname,'../static/fanservice/assets/button_rectangle_flat.png')).toString('base64');
  const library=await page.evaluate(async encoded=>{
   const files=await FanserviceStore.importFiles([new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'classic-timing.png',{type:'image/png'})],['slow','medium','fast','succubus','cum','ass','boobs']);
   const pack={id:'custom:classic-timing',library_id:libraryId,device_id:FanserviceStore.device,name:'Classic timing fixture',description:'Neutral fixture',unlock_cost:0,selection:{ids:[],rules:[],local_ids:[files[0].id]}};
   const manifest={library_id:libraryId,media:[{id:'local:'+files[0].id}]};let next=FanserviceModel.change(FanserviceModel.fresh(),{action:'create',pack,manifest});next=FanserviceModel.change(next,{action:'enable',id:pack.id,enabled:true,manifest});localStorage.setItem(key(),JSON.stringify(next));return libraryId;
  },png);
  await page.goto(origin+'/fanservice/play.html?library='+encodeURIComponent(library));await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();
  await page.locator('#objective').selectOption('2');await page.locator('#objective-target').fill('100');await page.getByRole('combobox',{name:'Gameplay vibration'}).selectOption('beat');
  await page.clock.install();await page.getByRole('button',{name:'Start',exact:true}).click();
  let samples=0,cards=new Set();
  for(let step=0;step<12000;step++){
   await page.clock.runFor(50);
   const s=await page.evaluate(()=>({seconds:state.seconds,strokes:state.strokes,pulses:window.classicBeatPulses,flow:state.cardFlow,release:run.player.isAllowedToCum,errors:document.querySelector('#status').textContent}));
   const f=s.flow;assert(f,'Start creates an ordinary card');cards.add(f.generation);
   const due=f.queue.filter(entry=>entry.CustomMultiplier>=0&&entry.TargetHitTime<=s.seconds-f.started).length;
   assert.equal(f.completed,due,'Delivered beats follow the card target timeline');
   assert.equal(s.pulses,s.strokes,'Every delivered stroke reaches the playable beat feedback');
   samples++;
   if(s.release){assert(s.strokes>=100);break;}
   assert(step<11999,'Ordinary Classic objective completes within ten simulated minutes');
  }
  await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');
  await page.getByText(/Rewards saved once/).waitFor();
  const result=await page.evaluate(()=>({strokes:state.strokes,pulses:window.classicBeatPulses,seconds:state.seconds,finished,won:state.won,progression:JSON.parse(localStorage.getItem(profileKey)).progression}));
  assert(result.finished&&result.won);assert.equal(result.progression.sessions,1);assert.equal(result.progression.wins,1);assert.deepEqual(errors,[]);
  const report={authority:'shared playable browser path with virtual time; not original-game execution',samples,cardsObserved:cards.size,strokes:result.strokes,pulses:result.pulses,seconds:result.seconds,finished:result.finished,won:result.won,sessions:result.progression.sessions,wins:result.progression.wins};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'classic-timing-browser.json'),JSON.stringify(report,null,2));}
  console.log('Classic smoke passed: ordinary cards deliver exact due beats, one feedback pulse per stroke, natural 100-stroke objective and one winning settlement. '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
