const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE});try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.FANSERVICE_HTTPS_ORIGIN+'/fanservice/');await page.evaluate(()=>profileReady);
 assert.equal(await page.locator('#archive-file').getAttribute('accept'),null);
 await page.locator('#archive-file').setInputFiles(process.env.FANSERVICE_TEST_PACK);await page.locator('#archive-import').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Pack imported'));
 const saved=await page.evaluate(async()=>({packs:profile.packs,files:(await store.localFiles()).map(file=>({name:file.name,bytes:file.blob.size,tags:file.tags}))}));assert.equal(saved.packs.length,1);assert.equal(saved.files.length,1);assert.equal(saved.files[0].bytes,3470);
 await page.getByRole('button',{name:'Enable',exact:true}).click();await page.getByRole('button',{name:'Disable',exact:true}).waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();await page.locator('[data-local-tile]').waitFor();await page.locator('#unlocks').click();await page.getByRole('button',{name:'Disable',exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log('Pack import passed: unrestricted file picker, ZIP integrity, exact video bytes, local pack enablement and offline reload.');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
