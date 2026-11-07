const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const one=await browser.newContext(),two=await browser.newContext(),a=await one.newPage(),b=await two.newPage();
  for(const page of [a,b]){page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');if(!await page.evaluate(()=>serverReady))throw Error('Sync fixture connection failed: '+await page.locator('#status').innerText());await page.getByRole('button',{name:'Unlocks',exact:true}).click();await page.getByText('Profile synchronization',{exact:true}).click();}
  await a.locator('#sync-new').click();const connection=await a.evaluate(()=>saveSync());
  await a.evaluate(()=>{profile={version:1,unlock_points:99,packs:[{id:'custom:conflict-pack',name:'Original',description:'',library_id:libraryId,device_id:FanserviceStore.device,unlock_cost:5,selection:{ids:[1],rules:[],local_ids:['private-file']},owned:true,enabled:true}]};localStorage.setItem(key(),JSON.stringify(profile));});
  await a.locator('#sync-upload').click();await a.waitForTimeout(1000);if(await a.evaluate(()=>syncRevision)!==1)throw Error('Initial profile upload did not advance: '+await a.locator('#status').innerText());
  await b.locator('#sync-id').fill(connection.id);await b.locator('#sync-key').fill(connection.key);
  const privateIds=await b.evaluate(async()=>{const [local]=await FanserviceStore.importFiles([new File(['private local media'],'private.png',{type:'image/png'})]);const snapshot={id:'fixture-snapshot',pack_id:'custom:conflict-pack',library_id:libraryId,saved_at:'fixture-time',device_id:FanserviceStore.device,media:[{id:1,storage_key:'fixture-snapshot:0'}],music:null};await FanserviceStore.put('files','fixture-snapshot:0',{blob:new Blob(['private snapshot bytes']),local:false});await FanserviceStore.put('snapshots',[libraryId,'custom:conflict-pack'],snapshot);await FanserviceStore.pinSnapshot(libraryId,'custom:conflict-pack','sync-protection-session');return {local:local.id};});
  await b.locator('#sync-download').click();await b.locator('#sync-review-dialog').waitFor({state:'visible'});await b.locator('#sync-review-packs select').selectOption('remote');await b.locator('#sync-apply').click();await b.waitForFunction(()=>syncRevision===1&&document.querySelector('#status').textContent.includes('Reviewed pack choices applied'));
  assert.equal(await b.evaluate(()=>profile.packs[0].owned),false,'A remote pack definition must not grant ownership');
  await a.evaluate(()=>{profile.packs[0].name='A edit';localStorage.setItem(key(),JSON.stringify(profile));});await a.locator('#sync-upload').click();await a.waitForFunction(()=>syncRevision===2);
  await b.evaluate(()=>{profile.packs[0].name='B edit';profile.unlock_points=77;profile.packs[0].owned=true;profile.packs[0].enabled=true;localStorage.setItem(key(),JSON.stringify(profile));});
  await b.locator('#sync-upload').click();await b.waitForFunction(()=>document.querySelector('#status').textContent.includes('changed on another device'));assert.equal(await b.evaluate(()=>syncRevision),1);
  await b.locator('#sync-download').click();await b.locator('#sync-review-dialog').waitFor({state:'visible'});assert.equal(await b.locator('#sync-review-packs select').count(),1);await b.locator('#sync-review-packs select').selectOption('local');await b.locator('#sync-apply').click();await b.waitForFunction(()=>syncRevision===2&&document.querySelector('#status').textContent.includes('Reviewed pack choices applied'));
  assert.deepEqual(await b.evaluate(()=>({name:profile.packs[0].name,owned:profile.packs[0].owned,enabled:profile.packs[0].enabled,up:profile.unlock_points})),{name:'B edit',owned:true,enabled:true,up:77});
  await b.locator('#sync-download').click();await b.locator('#sync-review-dialog').waitFor({state:'visible'});
  await a.evaluate(()=>{profile.packs[0].name='A late edit';localStorage.setItem(key(),JSON.stringify(profile));});await a.locator('#sync-upload').click();await a.waitForFunction(()=>syncRevision===3);
  await b.locator('#sync-apply').click();await b.waitForFunction(()=>document.querySelector('#status').textContent.includes('remote profile changed'));
  assert.equal(await b.evaluate(()=>profile.packs[0].name),'B edit','A fresh remote conflict must preserve the reviewed device’s local work');assert.equal(await b.evaluate(()=>syncRevision),2);
  const retained=await b.evaluate(async ids=>({local:(await FanserviceStore.get('files',ids.local)).blob.text(),snapshot:(await FanserviceStore.snapshot(libraryId,'custom:conflict-pack','sync-protection-session')).media[0].url,bytes:await (await FanserviceStore.get('files','fixture-snapshot:0')).blob.text()}),privateIds);
  assert.equal(retained.local,'private local media');assert.equal(retained.bytes,'private snapshot bytes');assert.ok(retained.snapshot.startsWith('blob:'),'A pinned snapshot remains readable after profile sync');
  let release,arrived;const waiting=new Promise(resolve=>arrived=resolve),held=new Promise(resolve=>release=resolve);
  await b.route('**/api/fanservice/v1/profiles/*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();arrived();await held;await route.fulfill({response});});
  await b.locator('#sync-download').click();await waiting;
  await b.evaluate(()=>{const updated=JSON.parse(localStorage.getItem(key()));updated.local_edit_sentinel='retained';localStorage.setItem(key(),JSON.stringify(updated));});release();
  await b.waitForFunction(()=>document.querySelector('#status').textContent.includes('response was discarded'));assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem(key())).local_edit_sentinel),'retained');assert.equal(await b.evaluate(()=>syncRevision),2);
  console.log('Real Server sync passed: two clients, per-pack review/apply, revision conflict rejection and stale-response preservation.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
