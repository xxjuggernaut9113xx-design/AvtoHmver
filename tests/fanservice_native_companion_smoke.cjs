const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
(async()=>{
 const {sealConnection}=await import('../mod/native/sealed-test.mjs');
 const {NativeCompanionHost}=await import('../mod/native/host.mjs'),origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169',base=await fs.mkdtemp(path.join(os.tmpdir(),'native-server-smoke-'));
 let pulse;
 try{
  const caps=await(await fetch(origin+'/api/fanservice/v1/capabilities')).json(),runtime=path.join(base,'runtime'),game=path.join(base,'game'),packs=path.join(game,'CockHero/Binaries/Win64/packs');await fs.mkdir(runtime);await fs.mkdir(packs,{recursive:true});await fs.writeFile(path.join(runtime,'server-origin.txt'),origin);
  const state={protocol:1,build_id:'v004-exclusive-c645757d',slot:'SyntheticSlotA',user_index:0,save_address:'1',store_address:'2',generation:1,epoch:'123-1',updated_at:Math.floor(Date.now()/1000),native_catalog:{unlock_points:4,packs:[{id:'fanservice-smoke-123',owned:true,enabled:true}]}};
  const heartbeat=async()=>{state.updated_at=Math.floor(Date.now()/1000);await fs.writeFile(path.join(runtime,'.fanservice-companion.state'),JSON.stringify(state));};await heartbeat();pulse=setInterval(()=>heartbeat().catch(()=>{}),500);
  await fs.writeFile(path.join(packs,'.fanservice-receipts.json'),JSON.stringify({version:1,packs:{'custom:smoke':{custom_id:'custom:smoke',build_id:state.build_id,filename:'fanservice-smoke-123.chpack',sha256:'b'.repeat(64)}}}));
  const host=await new NativeCompanionHost({verifyBuild:false,runtimeDir:runtime,gameRoot:game,storeRoot:path.join(base,'data')}).initialize();let sequence=0;
  const raw=(action,payload={})=>host.handle({action,payload,nonce:'123-1-'+(++sequence),generation:state.generation,epoch:state.epoch});
  const call=async(action,payload={})=>raw(action,action==='syncconfigure'?await sealConnection(await raw('synchandshake'),payload):payload);
  const definition={id:'custom:smoke',name:'Neutral Server fixture',description:'API acceptance only',library_id:caps.library_id,unlock_cost:1,selection:{ids:[1],rules:[]}};
  await call('definitions',{packs:[definition],expected_revision:0});await call('snapshotdownload',{pack_id:definition.id,track_id:1,expected_revision:1});
  const saved=await call('companionread');assert.equal(Object.keys(saved.snapshots).length,1);const offline=await call('musicprepare',{pack_id:definition.id});const command=await fs.readFile(path.join(runtime,'.fanservice-music-command.'+offline.command_nonce),'utf8'),location=decodeURIComponent(command.split('\n')[4]);assert.ok(location.startsWith('file:///'));assert.ok(JSON.parse(command.split('\n').slice(5).join('\n')).beats.length>0);
  await call('snapshotdelete',{pack_id:definition.id});const retained=await fs.stat(new URL(location));assert.ok(retained.size>0,'Pinned audio must survive explicit snapshot removal');await call('sessionrelease',{session_id:offline.session_id});await assert.rejects(fs.stat(new URL(location)),{code:'ENOENT'});
  const connection={id:'native-'+randomUUID(),key:'a'.repeat(64),revision:0};await call('syncconfigure',connection);const before=await call('companionread');await call('syncupload',{expected_revision:before.revision});
  state.slot='SyntheticSlotB';state.generation++;await heartbeat();await call('syncconfigure',connection);const preview=await call('syncpreview');assert.equal(preview.packs.length,1);await call('syncapply',{preview_token:preview.preview_token,expected_revision:preview.local_revision});const downloaded=await call('companionread');assert.deepEqual(downloaded.packs,[definition]);assert.equal(downloaded.unlock_points,undefined);assert.equal(downloaded.progression,undefined);
  const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
  const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
  try{
   const page=await browser.newPage(),titles=[],errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');assert.equal(await page.evaluate(()=>serverReady),true);
   await page.evaluate(()=>{globalThis.__fanserviceNativeEpoch='123-1';});await page.addScriptTag({path:path.join(__dirname,'../mod/runtime/Scripts/bridge.js')});await page.addScriptTag({path:path.join(__dirname,'../mod/runtime/Scripts/native-controls.js')});
   let busy=false;const seen=new Set(),routing=setInterval(async()=>{if(busy||page.isClosed())return;busy=true;try{const title=await page.title(),match=/^FANSERVICE_RPC:123-1:([0-9]+):([a-z]+):(.*)$/.exec(title);if(!match||seen.has(match[1]))return;seen.add(match[1]);titles.push(title);let reply;try{reply={ok:true,data:await raw(match[2],JSON.parse(decodeURIComponent(match[3])))};}catch(error){reply={ok:false,error:error.message};}await page.evaluate(({id,reply})=>FanserviceNativeTransport.receive(id,reply),{id:Number(match[1]),reply});}catch(error){if(!page.isClosed())errors.push(error.message);}finally{busy=false;}},25);
   try{
    await page.getByText('Native music, offline storage and sync',{exact:true}).click();await page.getByRole('button',{name:'Read native companion profile',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#library').textContent.includes('SyntheticSlotB'));
    await page.getByRole('button',{name:'Create companion sync identity',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#library').textContent.includes('Companion identity created.'));
    await page.getByRole('button',{name:'Export companion sync connection',exact:true}).click();const exported=JSON.parse(await page.getByRole('textbox',{name:'Companion sync connection to copy'}).inputValue());assert.match(exported.key,/^[a-f0-9]{64}$/);assert.equal(titles.some(title=>title.includes(exported.key)),false,'Native page titles must never contain the sync key');
    await page.evaluate(()=>FanserviceNativeTransport.revoke());assert.equal(await page.getByText('Native music, offline storage and sync',{exact:true}).count(),0);assert.deepEqual(errors,[]);
   }finally{clearInterval(routing);while(busy)await new Promise(resolve=>setTimeout(resolve,5));}
  }finally{await browser.close();}
  console.log('Native companion / real Server passed: actual media + native AAC snapshot, local beatmap command, pinned removal/release, two-profile sync with no native wallet import. Actual browser native controls and sealed WebCrypto sync passed without a key in page titles. Synthetic native heartbeat; no game playback claimed.');
 }finally{clearInterval(pulse);await fs.rm(base,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
