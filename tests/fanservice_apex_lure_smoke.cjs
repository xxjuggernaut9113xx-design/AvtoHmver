const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/fanservice/**',async route=>{const rel=new URL(route.request().url()).pathname.slice('/fanservice/'.length)||'index.html',file=path.resolve(__dirname,'../static/fanservice',rel);if(file.startsWith(path.resolve(__dirname,'../static/fanservice')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())await route.fulfill({path:file});else await route.continue();});
  await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');await page.evaluate(()=>serverReady);
  const png=fs.readFileSync(path.join(__dirname,'../static/fanservice/assets/button_rectangle_flat.png')).toString('base64');
  const library=await page.evaluate(async encoded=>{const [file]=await FanserviceStore.importFiles([new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'apex.png',{type:'image/png'})],['slow','medium','fast','succubus','cum','ass','boobs']);const pack={id:'custom:apex-test',library_id:libraryId,device_id:FanserviceStore.device,name:'Apex test',description:'Synthetic media',unlock_cost:0,selection:{ids:[],rules:[],local_ids:[file.id]}};const manifest={library_id:libraryId,media:[{id:'local:'+file.id}]};let next=FanserviceModel.change(FanserviceModel.fresh(),{action:'create',pack,manifest});next=FanserviceModel.change(next,{action:'enable',id:pack.id,enabled:true,manifest});localStorage.setItem(key(),JSON.stringify(next));return libraryId;},png);
  const play=origin+'/fanservice/play.html?library='+encodeURIComponent(library);
  await page.goto(play);await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.evaluate(()=>{run.inventory.grant(9,1);run.inventory.upgrade(9);run.inventory.equip(9,0);renderItemControls();checkpoint(true);});
  const expected=await page.evaluate(()=>{const baseline=FanserviceRun.Run.restore(catalog,run.export());const ordinary=baseline.startCard('succubus').assigned;const apex=FanserviceRun.Run.restore(catalog,run.export()).startCard('succubus',{apexLure:true,strokeAddend:1.5}).assigned;return {ordinary,apex};});
  assert.notEqual(expected.apex,expected.ordinary,'level 2 additive bonus must change this seeded outcome');
  await page.getByRole('button',{name:/Use Apex Lure · 1 charge/}).click();
  const after=await page.evaluate(()=>({flow:run.state.cardFlow,charges:run.inventory.state(9).charges,used:run.state.metrics.itemsUsed,phase:run.phase}));
  assert.equal(after.flow.pool,'succubus');assert.equal(after.flow.assigned,expected.apex);assert.notEqual(after.flow.assigned,expected.ordinary);assert.equal(after.charges,0);assert.equal(after.used,1);assert.equal(after.phase,'playing');
  await page.reload();await page.getByText('Unfinished session ready. Tap Start to resume.').waitFor();
  const restored=await page.evaluate(()=>({flow:run.state.cardFlow,charges:run.inventory.state(9).charges,used:run.state.metrics.itemsUsed,phase:run.phase}));
  assert.equal(restored.flow.assigned,after.flow.assigned);assert.equal(restored.flow.pool,'succubus');assert.equal(restored.charges,0);assert.equal(restored.used,1);assert.equal(restored.phase,'playing');
  await page.evaluate(()=>{localStorage.removeItem(checkpointKey);location.reload();});await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.evaluate(()=>{run.inventory.grant(9,1);run.inventory.upgrade(9);run.inventory.equip(9,0);renderItemControls();checkpoint(true);});
  await page.getByRole('button',{name:'Edge / E',exact:true}).click();await page.waitForFunction(()=>state.edge?.phase==='sequence');
  await page.getByRole('button',{name:/Use Apex Lure · 1 charge/}).click();
  const blocked=await page.evaluate(()=>({charges:run.inventory.state(9).charges,edge:state.edge?.phase,flow:state.cardFlow}));
  assert.equal(blocked.charges,1);assert.equal(blocked.edge,'sequence');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Cannot use items');assert.deepEqual(errors,[]);
  console.log('Apex Lure browser smoke passed: exact seeded additive count, charge/reload persistence, and edge-phase rejection without charge loss.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
