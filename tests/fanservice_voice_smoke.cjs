const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage(),writes=[];page.on('request',request=>{if(['POST','PUT','PATCH','DELETE'].includes(request.method()))writes.push(request.url());});
 await page.goto((process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169')+'/fanservice/');await page.getByRole('button',{name:'Connection',exact:true}).click();await page.getByText('Local voice pack',{exact:true}).click();
 const manifest={version:1,lines:{Fanservice_Test:{file:'tone.wav',caption:'Synthetic voice fixture'}}};
 const files=[{name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))},{name:'tone.wav',mimeType:'audio/wav',buffer:fs.readFileSync(path.join(__dirname,'../static/fanservice/assets/timing.wav'))}];
 await page.getByLabel('Voice manifest and recordings').setInputFiles(files);await page.getByRole('button',{name:'Import local voice pack',exact:true}).click();await page.getByText('Imported 1 recordings.',{exact:false}).waitFor();
 const speak=()=>page.evaluate(async()=>{await FanserviceVoice.unlock();let caption;const played=await FanserviceVoice.say('Fanservice_Test',text=>caption=text);return {played,caption};});
 assert.deepEqual(await speak(),{played:true,caption:'Synthetic voice fixture'});await page.reload();assert.deepEqual(await speak(),{played:true,caption:'Synthetic voice fixture'});
 const missing=await page.evaluate(async()=>{let caption;const played=await FanserviceVoice.say('Missing_Test',text=>caption=text);return {played,caption};});assert.equal(missing.played,false);assert.match(missing.caption,/unavailable/);
 const rejected=await page.evaluate(async manifest=>{try{await FanserviceVoice.importPack([new File([JSON.stringify(manifest)],'manifest.json',{type:'application/json'}),new File(['invalid WAV'],'tone.wav',{type:'audio/wav'})]);return false;}catch{return true;}},manifest);assert.equal(rejected,true);assert.deepEqual(await speak(),{played:true,caption:'Synthetic voice fixture'});assert.deepEqual(writes,[],'Voice import/play must never upload recordings');
 console.log('Voice smoke passed: local WAV import, actual WebAudio decode/play, captions, reload, missing recording, invalid import rollback and no uploads.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
