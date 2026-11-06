/* Synthetic media only. Verify exported ZIPs with Python's independent reader. */
const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const output=path.resolve(process.env.FANSERVICE_SMOKE_OUTPUT||'fanservice-ci-results/export');fs.mkdirSync(output,{recursive:true});
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';let browser;
function inspect(file){const r=spawnSync('python',['-c',"import hashlib,zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({'names':z.namelist(),'manifest':json.loads(z.read('manifest.json')),'hashes':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n!='manifest.json'}}))",file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:850},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/fanservice/');await page.getByText('sample1.png',{exact:true}).waitFor();
 const preserveAuthor=route=>route.continue({postData:{...route.request().postDataJSON(),author:'Parity fixture author'}});
 await page.route('**/api/fanservice/v1/export/chpack',preserveAuthor);
 for(const name of ['sample1.png','sample3.png'])await page.getByRole('checkbox',{name:'Select '+name,exact:true}).check();
 await page.getByRole('button',{name:'Create Pack',exact:true}).click();await page.locator('#pack-name').fill('Exact exported selection');await page.locator('#access').selectOption('priced');await page.locator('#price').fill('7');await page.locator('#cover').selectOption('1');
 const before=await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fanservice-profile-v1:'))));
 async function download(filename){await page.getByRole('link',{name:'Download .chpack',exact:true}).waitFor();const ready=page.waitForEvent('download');await page.getByRole('link',{name:'Download .chpack',exact:true}).click();const d=await ready;const target=path.join(output,filename);await d.saveAs(target);assert.equal(await d.failure(),null);const archive=inspect(target);await page.getByRole('button',{name:'Close',exact:true}).click();return archive;}
 await page.locator('#export-selection').click();const selection=await download('selection.chpack');assert.equal(selection.manifest.total_media,2);assert.equal(selection.manifest.unlock_cost,7);assert.equal(selection.manifest.preview,'preview.png');assert.equal(selection.names.filter(n=>n.startsWith('media/')).length,2);
 assert.equal(await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fanservice-profile-v1:')))),before,'export must not save a profile or purchase');
 await page.getByRole('button',{name:'Save to Unlocks',exact:true}).click();await page.getByRole('heading',{name:'Exact exported selection · Custom',exact:true}).waitFor();await page.locator('#packs').getByRole('button',{name:'Export .chpack',exact:true}).click();const saved=await download('custom-pack.chpack');assert.deepEqual(saved.manifest,selection.manifest);
 assert.equal(selection.manifest.author,'Parity fixture author');
 await page.unroute('**/api/fanservice/v1/export/chpack',preserveAuthor);
 const profile=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('fanservice-profile-v1:')))));assert.equal(profile.unlock_points,0);assert.equal(profile.packs[0].owned,false);
 let announce;const started=new Promise(resolve=>announce=resolve);await page.route('**/api/fanservice/v1/export/chpack',async route=>{announce();await new Promise(resolve=>setTimeout(resolve,500));await route.abort().catch(()=>{});});
 await page.locator('#packs').getByRole('button',{name:'Export .chpack',exact:true}).click();await started;await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#status').filter({hasText:'Export cancelled.'}).waitFor();assert.equal(await page.getByRole('link',{name:'Download .chpack',exact:true}).count(),0);await page.unroute('**/api/fanservice/v1/export/chpack');
 await page.getByRole('button',{name:'Back to import'}).click();await page.getByRole('button',{name:'Clear selection',exact:true}).click();
 const png=await(await page.request.get(origin+'/api/media/1/stream')).body();
 await page.locator('#local-files').setInputFiles({name:'private-phone.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Add selected phone files'}).click();await page.getByRole('checkbox',{name:'Select local private-phone.png',exact:true}).check();
 await page.getByRole('button',{name:'Create Pack',exact:true}).click();await page.locator('#pack-name').fill('Phone-only export');
 const posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
 await page.locator('#export-selection').click();const phone=await download('phone-local.chpack');assert.equal(phone.manifest.total_media,1);assert.equal(phone.manifest.media[0].type,'image');assert.equal('preview' in phone.manifest,false,'a pack without a cover must omit the optional preview');assert.deepEqual(posts,[],'phone bytes must never be uploaded or posted to an export service');
 await page.evaluate(()=>{globalThis.Capacitor={isNativePlatform:()=>true};});await page.locator('#export-selection').click();await page.locator('dialog[open] > p[role=status]').filter({hasText:'This Android shell has no archive saving support.'}).waitFor();assert.deepEqual(posts,[]);await page.getByRole('button',{name:'Close',exact:true}).click();
 for(const mode of ['saved','cancelled','failed']){
  await page.evaluate(mode=>{
   globalThis.nativeArchive={parts:[],aborted:false};
   const native={
    begin:async()=>({token:'browser-native-test'}),
    append:async({data})=>{if(mode==='failed')throw Error('Device storage exhausted.');nativeArchive.parts.push(data);},
    finish:async()=>({cancelled:mode==='cancelled',verified:true,bytes:nativeArchive.parts.reduce((n,p)=>n+atob(p).length,0)}),
    abort:async()=>{nativeArchive.aborted=true;}
   };
   globalThis.Capacitor={isNativePlatform:()=>true,isPluginAvailable:name=>name==='ArchiveSave',registerPlugin:()=>native};
  },mode);
  await page.locator('#export-selection').click();
  const expected=mode==='saved'?'Archive saved and verified on device.':mode==='cancelled'?'Export cancelled.':'Device storage exhausted.';
  await page.locator('dialog[open] > p[role=status]').filter({hasText:expected}).waitFor();
  const result=await page.evaluate(()=>nativeArchive);assert(result.aborted);assert.deepEqual(posts,[]);
  assert.equal(await page.getByRole('link',{name:'Download .chpack',exact:true}).count(),0);
  if(mode==='saved'){
   const filename=path.join(output,'native-transport.chpack');fs.writeFileSync(filename,Buffer.concat(result.parts.map(part=>Buffer.from(part,'base64'))));
   assert.deepEqual(inspect(filename).manifest,phone.manifest);
  }
  await page.getByRole('button',{name:'Close',exact:true}).click();
 }
 assert.deepEqual(errors,[]);console.log('Export smoke passed: review + saved custom pack, exact ZIP counts/cover/price, no purchase side effects, and phone-local archive without uploads.');
 const standalone=path.join(output,'standalone-cover.chpack');
 const differentCover=spawnSync('python',['-c',"import sys,zipfile; src=zipfile.ZipFile(sys.argv[1]); dst=zipfile.ZipFile(sys.argv[2],'w'); [dst.writestr(n,src.read(n)+(b'fixture-cover' if n=='preview.png' else b'')) for n in src.namelist()]; dst.close()",path.join(output,'selection.chpack'),standalone]);
 assert.equal(differentCover.status,0,differentCover.stderr?.toString());
 for(const [file,expected] of [['selection.chpack',selection],['standalone-cover.chpack',inspect(standalone)]]){
  const roundTrip=await browser.newPage({acceptDownloads:true});
  await roundTrip.goto(origin+'/fanservice/');
  await roundTrip.getByText('sample1.png',{exact:true}).waitFor();
  await roundTrip.locator('#archive-file').setInputFiles(path.join(output,file));
  await roundTrip.locator('#archive-import').click();
  const importedPack=roundTrip.locator('#packs article').filter({hasText:'Exact exported selection'});
  await importedPack.waitFor();
  await roundTrip.waitForFunction(()=>document.querySelector('#packs article img')?.src.startsWith('blob:'));
  await roundTrip.route('**/api/**',route=>route.abort());
  await importedPack.getByRole('button',{name:'Export .chpack',exact:true}).click();
  const ready=roundTrip.waitForEvent('download');
  await roundTrip.getByRole('link',{name:'Download .chpack',exact:true}).click();
  const copied=await ready,copyPath=path.join(output,'imported-'+file);
  await copied.saveAs(copyPath);
  assert.equal(await copied.failure(),null);
  const reexported=inspect(copyPath);
  assert.deepEqual(reexported.manifest,expected.manifest);
  assert.deepEqual(reexported.hashes,expected.hashes);
  await roundTrip.close();
 }
 console.log('Imported cover, manifest and media round-trip byte-for-byte without access to the source library.');
 await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
