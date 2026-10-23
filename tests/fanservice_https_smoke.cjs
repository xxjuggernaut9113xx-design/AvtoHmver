const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const origin=process.env.FANSERVICE_HTTPS_ORIGIN;if(!origin)throw Error('Set FANSERVICE_HTTPS_ORIGIN to the private HTTPS origin.');
 const browser=await chromium.launch({headless:true,executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(origin+'/fanservice/');await page.evaluate(()=>profileReady);
  assert(await page.evaluate(()=>isSecureContext));await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.locator('#local-files').setInputFiles(process.env.FANSERVICE_TEST_VIDEO);
  await page.locator('#local-import').click();await page.locator('[data-local-tile]').waitFor();
  await context.setOffline(true);await page.reload();await page.locator('[data-local-tile]').waitFor();
  await page.locator('[data-local-tile]').getByRole('button',{name:'Preview',exact:true}).click();
  const result=await page.evaluate(async()=>{const video=document.querySelector('#preview video');video.muted=true;await video.play();await new Promise(resolve=>setTimeout(resolve,700));return {time:video.currentTime,ready:video.readyState,bytes:(await FanserviceStore.localFiles())[0].blob.size};});
  assert(result.time>0);assert(result.ready>=2);assert(result.bytes>0);
  console.log(JSON.stringify({passed:true,secure:true,offlineReload:true,video:result}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
