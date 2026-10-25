const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const one=await browser.newContext(),two=await browser.newContext(),a=await one.newPage(),b=await two.newPage();
  for(const page of [a,b]){page.on('dialog',dialog=>dialog.accept());await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');if(!await page.evaluate(()=>serverReady))throw Error('Sync fixture connection failed: '+await page.locator('#status').innerText());await page.getByRole('button',{name:'Unlocks',exact:true}).click();await page.getByText('Profile synchronization',{exact:true}).click();}
  await a.locator('#sync-new').click();const connection=await a.evaluate(()=>saveSync());
  await a.locator('#sync-upload').click();await a.waitForFunction(()=>syncRevision===1);
  await b.locator('#sync-id').fill(connection.id);await b.locator('#sync-key').fill(connection.key);
  await b.locator('#sync-download').click();await b.waitForFunction(()=>syncRevision===1);assert.match(await b.locator('#status').innerText(),/Profile downloaded/);
  await a.locator('#sync-upload').click();await a.waitForFunction(()=>syncRevision===2);
  await b.locator('#sync-upload').click();await b.waitForFunction(()=>document.querySelector('#status').textContent.includes('changed on another device'));assert.equal(await b.evaluate(()=>syncRevision),1);
  await b.locator('#sync-download').click();await b.waitForFunction(()=>syncRevision===2);
  let release,arrived;const waiting=new Promise(resolve=>arrived=resolve),held=new Promise(resolve=>release=resolve);
  await b.route('**/api/fanservice/v1/profiles/*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();arrived();await held;await route.fulfill({response});});
  await b.locator('#sync-download').click();await waiting;
  await b.evaluate(()=>{const updated=JSON.parse(localStorage.getItem(key()));updated.local_edit_sentinel='retained';localStorage.setItem(key(),JSON.stringify(updated));});release();
  await b.waitForFunction(()=>document.querySelector('#status').textContent.includes('response was discarded'));assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem(key())).local_edit_sentinel),'retained');assert.equal(await b.evaluate(()=>syncRevision),2);
  console.log('Real Server sync passed: two clients, upload/download revisions, conflict rejection and stale-response preservation.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
