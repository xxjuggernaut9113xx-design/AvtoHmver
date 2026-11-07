const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169',output=process.env.FANSERVICE_SMOKE_OUTPUT||path.join(require('node:os').tmpdir(),'fanservice-mobile-smoke');fs.mkdirSync(output,{recursive:true});
async function checkGameplayLayout(page,{landscape,insets=false}){
 const geometry=await page.evaluate(()=>{
  const box=id=>document.getElementById(id).getBoundingClientRect().toJSON();
  const button=[...document.querySelectorAll('#controls button')].map(node=>node.getBoundingClientRect().toJSON());
  return {stage:box('stage'),beats:box('beats'),controls:box('controls'),button,
   fit:getComputedStyle(document.querySelector('#stage img')).objectFit,
   viewport:{width:innerWidth,height:innerHeight,document:document.documentElement.scrollWidth}};
 });
 assert.equal(geometry.fit,'contain');
 assert.ok(geometry.stage.bottom<=geometry.beats.top&&geometry.beats.bottom<=geometry.controls.top);
 assert.ok(geometry.viewport.document<=geometry.viewport.width,'No horizontal clipping');
 assert.ok(geometry.button.every(button=>button.left>=0&&button.right<=geometry.viewport.width));
 if(landscape){
  if(!insets)assert.ok(geometry.stage.height>geometry.viewport.height/2,'Media takes most of the landscape viewport');
  if(insets){
   assert.ok(geometry.button.every(button=>button.left>=32&&button.right<=geometry.viewport.width-32));
   assert.ok(geometry.controls.bottom<=geometry.viewport.height-12);
  }
  assert.ok(geometry.controls.bottom<=geometry.viewport.height,'Compact controls fit below landscape media');
 }else{
  assert.ok(geometry.button.every(button=>button.height>=44),'Portrait controls meet the touch-target size');
 }
}
async function checkItemSide(page,side){
 const item=await page.getByRole('button',{name:/Use Spray Bottle/}).boundingBox();
 const media=await page.locator('#stage').boundingBox();
 assert.ok(item&&media);
 assert.ok(side==='left'?item.x+item.width<=media.x:item.x>=media.x+media.width);
 assert.ok(item.x>=0&&item.x+item.width<=page.viewportSize().width);
}
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.url());});
 await page.addInitScript(()=>{
  window.wakeEvents=[];
  window.voiceEvents=[];
  for(const method of ['start','stop']){
   const original=AudioBufferSourceNode.prototype[method];
   AudioBufferSourceNode.prototype[method]=function(...args){
    window.voiceEvents.push(method);
    return original.apply(this,args);
   };
  }
  window.vibrationEvents=[];
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:duration=>{
   window.vibrationEvents.push({duration,position:document.querySelector('#audio')?.currentTime});
   return true;
  }});
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{async request(type){
   window.wakeEvents.push(type);
   if(window.rejectWake)throw new DOMException('Rejected by fixture','NotAllowedError');
   const lock=new EventTarget();
   lock.released=false;
   lock.release=async()=>{
    lock.released=true;
    window.wakeEvents.push('release');
    lock.dispatchEvent(new Event('release'));
   };
   return lock;
  }}});
  const session=navigator.mediaSession,register=session.setActionHandler.bind(session);
  window.mediaActions=new Map();
  session.setActionHandler=(action,handler)=>{
   register(action,handler);
   window.mediaActions.set(action,handler);
  };
 });
 await page.goto(origin+'/fanservice/');await page.getByRole('checkbox',{name:'Select sample1.png'}).waitFor();assert.equal(await page.locator('nav button').count(),2);
 await page.getByRole('button',{name:'Connection',exact:true}).click();
 await page.getByText('Local voice pack',{exact:true}).click();
 const manifest={version:1,lines:{
  Fanservice_Test:{file:'voice.wav',caption:'Offline voice fixture'},
  Missing_Test:{file:'missing.wav',caption:'Offline caption without recording'}
 }};
 const wav=Buffer.alloc(44+8000*2*5);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
 wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
 wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);
 wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 await page.getByLabel('Voice manifest and recordings').setInputFiles([
  {name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))},
  {name:'voice.wav',mimeType:'audio/wav',buffer:wav}
 ]);
 await page.getByRole('button',{name:'Import local voice pack',exact:true}).click();
 await page.getByText('Imported 1 recordings.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('.tile img').first().evaluate(img=>{img.loading='eager';img.src='/missing-thumbnail-acceptance';});
 await page.waitForFunction(()=>document.querySelector('.tile img')?.alt==='Preview unavailable');
 assert.match(await page.locator('.tile img').first().getAttribute('src'),/thumbnail-unavailable\.svg$/);
 await page.locator('#local-files').setInputFiles({name:'private-synthetic-phone.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(__dirname,'../static/fanservice/assets/button_rectangle_flat.png'))});await page.getByRole('button',{name:'Add selected phone files'}).click();await page.getByRole('checkbox',{name:'Select local private-synthetic-phone.png'}).waitFor();
 await page.getByRole('button',{name:'Create Pack',exact:true}).click();await page.locator('#pack-name').fill('Phone-only fixture');await page.getByRole('button',{name:'Save to Unlocks'}).click();await page.getByRole('button',{name:'Enable',exact:true}).click();await page.getByRole('button',{name:'Disable',exact:true}).waitFor();assert.deepEqual(writes,[],'Phone import/pack creation must not upload media or write the Server library');
 await page.getByRole('button',{name:'Play enabled packs'}).click();
 const vibrationMode=page.getByRole('combobox',{name:'Gameplay vibration'});
 assert.deepEqual(await vibrationMode.locator('option').allTextContents(),['Off','Before next event','Every beat']);
 assert.equal(await vibrationMode.inputValue(),'event');
 await vibrationMode.selectOption('beat');
 const holdingHand=page.getByRole('combobox',{name:'Holding hand'});
 assert.deepEqual(await holdingHand.locator('option').allTextContents(),['Left hand','Right hand']);
 await holdingHand.selectOption('left');
 await page.getByRole('button',{name:'Inventory / loadout',exact:true}).click();
 await page.getByRole('button',{name:'Equip DecreaseHeat',exact:true}).click();
 await page.getByRole('button',{name:'Close inventory',exact:true}).click();
 const item=page.getByRole('button',{name:/Use Spray Bottle/});
 assert.equal(await item.isDisabled(),true);
 await checkItemSide(page,'right');
 await holdingHand.selectOption('right');
 await checkItemSide(page,'left');
 await checkGameplayLayout(page,{landscape:false});
 const details=page.getByText('Detailed statistics',{exact:true});
 assert.equal(await page.locator('#stats').isHidden(),true);
 await details.click();assert.equal(await page.locator('#stats').isVisible(),true);await details.click();
 await page.getByRole('button',{name:'Start',exact:true}).click();await page.waitForFunction(()=>state.strokes>0);
 const game=await page.evaluate(()=>({id:sessionId,media,seconds:state.seconds}));
 await page.setViewportSize({width:568,height:320});
 await page.evaluate(()=>scrollTo(0,0));
 await checkGameplayLayout(page,{landscape:true});
 await checkItemSide(page,'left');
 await holdingHand.selectOption('left');
 await checkItemSide(page,'right');
 await page.evaluate(()=>{state.heat=40;run.inventory.grant(1,1,{});render();});
 const charges=await page.evaluate(()=>run.inventory.state(1).charges);
 await item.tap();
 await page.waitForFunction(previous=>run.inventory.state(1).charges===previous-1,charges);
 assert.ok(await page.evaluate(()=>state.heat)<30,'Item use reached the Decrease Heat gameplay action');
 assert.deepEqual(await page.evaluate(()=>({id:sessionId,media})),{id:game.id,media:game.media});
 assert.ok(await page.evaluate(()=>state.seconds)>=game.seconds);await page.getByRole('button',{name:'Pause',exact:true}).click();const paused=await page.evaluate(()=>state.strokes);
 assert.equal(await item.isDisabled(),true);
 const pausedRun=await page.evaluate(()=>({id:sessionId,seconds:state.seconds}));
 await page.setViewportSize({width:320,height:568});
 await checkGameplayLayout(page,{landscape:false});
 assert.deepEqual(await page.evaluate(()=>({id:sessionId,seconds:state.seconds})),pausedRun);
 await page.setViewportSize({width:390,height:844});
 const beatVibrations=await page.evaluate(()=>window.vibrationEvents.map(event=>event.duration));
 assert.equal(beatVibrations.at(-1),0);
 assert.equal(beatVibrations.filter(duration=>duration===25).length,paused);await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>state.strokes),paused);await page.getByRole('button',{name:'Resume',exact:true}).click();
 const wakeChoice=page.getByRole('checkbox',{name:'Keep screen awake during play'});
 await page.getByText('Screen wakefulness is active.').waitFor();
 assert.deepEqual(await page.evaluate(()=>window.wakeEvents),['screen','release','screen']);
 await vibrationMode.selectOption('off');
 await page.getByText('Gameplay vibration is off.').waitFor();
 await wakeChoice.uncheck();
 await page.waitForFunction(()=>window.wakeEvents.at(-1)==='release');
 await page.getByText('Screen wakefulness is off.').waitFor();
 await page.evaluate(()=>{state.meter=1;render();});const finishButton=page.locator('#finish');
 await finishButton.tap();
 await page.waitForTimeout(1100);
 assert.doesNotMatch(await page.locator('#summary').innerText(),/Rewards saved once/);
 const cdp=await context.newCDPSession(page);
 await finishButton.scrollIntoViewIfNeeded();
 const box=await finishButton.boundingBox(),touchPoints=[{x:box.x+box.width/2,y:box.y+box.height/2}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await page.waitForTimeout(1100);
 assert.doesNotMatch(await page.locator('#summary').innerText(),/Rewards saved once/);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});await page.waitForFunction(()=>document.querySelector('#summary').textContent.includes('Rewards saved once'));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));assert.equal(first.progression.sessions,1);await page.reload();await page.locator('#start').waitFor();assert.equal(await page.evaluate(()=>profile.progression.sessions),1);assert.equal(await wakeChoice.isChecked(),false);await wakeChoice.check();
 assert.equal(await holdingHand.inputValue(),'left');
 await checkItemSide(page,'right');
 assert.equal(await vibrationMode.inputValue(),'off');await vibrationMode.selectOption('event');
 await page.goto(origin+'/fanservice/');await page.getByRole('checkbox',{name:'Select sample1.png'}).check();await page.getByRole('button',{name:'Create Pack',exact:true}).click();await page.locator('#pack-name').fill('Offline Server fixture');await page.getByRole('button',{name:'Save to Unlocks'}).click();const row=page.locator('.pack').filter({has:page.getByRole('heading',{name:'Offline Server fixture · Custom'})});await row.getByRole('button',{name:'Enable',exact:true}).click();await page.locator('#soundtrack').selectOption('1');
 await page.locator('.pack').filter({has:page.getByRole('heading',{name:'Offline Server fixture · Custom'})}).getByRole('button',{name:'Download snapshot',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Snapshot saved'),{timeout:30000});await page.evaluate(()=>navigator.serviceWorker.ready);await page.screenshot({path:path.join(output,'mobile-unlocks-snapshot.png'),fullPage:true});
 await context.setOffline(true);await page.locator('.pack').filter({has:page.getByRole('heading',{name:'Offline Server fixture · Custom'})}).getByRole('button',{name:'Play saved snapshot'}).click();await page.getByRole('button',{name:'Start',exact:true}).waitFor();await page.evaluate(()=>audio.muted=true);await page.getByRole('button',{name:'Start',exact:true}).click();await page.waitForFunction(()=>state.strokes>0);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const pausedAudio=await page.evaluate(()=>audio.currentTime);
 await page.setViewportSize({width:844,height:390});
 await page.evaluate(()=>scrollTo(0,0));
 await checkGameplayLayout(page,{landscape:true});
 const insetStyle=await page.addStyleTag({content:':root{--safe-top:10px;--safe-bottom:12px;--safe-left:32px;--safe-right:32px}'});
 await checkGameplayLayout(page,{landscape:true,insets:true});
 await insetStyle.evaluate(node=>node.remove());
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('#audio').getAttribute('controls'),null);
 assert.equal(await page.locator('#audio').isHidden(),true);
 assert.equal(await page.locator('#video').getAttribute('controls'),null);
 await page.evaluate(()=>{
  for(const action of ['seekbackward','seekforward','seekto']){
   window.mediaActions.get(action)({action,seekOffset:5,seekTime:8});
  }
 });
 await page.waitForTimeout(500);
 assert.ok(Math.abs(await page.evaluate(()=>audio.currentTime)-pausedAudio)<.05,'Media seek actions must leave the paused timeline in place');
 const delivered=await page.evaluate(()=>state.strokes);
 await page.reload();await page.getByText('Unfinished session ready. Tap Start to resume.').waitFor();
 assert.equal(await page.evaluate(()=>state.strokes),delivered);
 await page.evaluate(()=>{window.rejectWake=true;});
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.getByText('Screen wakefulness could not be enabled.').waitFor();
 await page.waitForFunction(time=>audio.currentTime>time,pausedAudio);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.evaluate(()=>{window.rejectWake=false;});
 await page.getByRole('button',{name:'Resume',exact:true}).click();
 await page.getByText('Screen wakefulness is active.').waitFor();
 await page.getByText('Offline voice fixture',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.voiceEvents.includes('start'));
 const playingSoundtrack=await page.evaluate(()=>({id:sessionId,position:audio.currentTime}));
 await page.setViewportSize({width:844,height:390});
 assert.equal(await page.evaluate(()=>sessionId),playingSoundtrack.id);
 await page.waitForFunction(time=>audio.currentTime>time,playingSoundtrack.position);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.voiceEvents),['start','stop']);
 await page.getByRole('button',{name:'Resume',exact:true}).click();
 await page.getByText('Offline caption without recording',{exact:true}).waitFor();
 assert.equal(await page.locator('#voice-status').innerText(),'Voice recording unavailable: Missing_Test');
 assert.deepEqual(await page.evaluate(()=>window.voiceEvents),['start','stop']);
 await page.waitForFunction(()=>document.querySelector('#summary')?.textContent.includes('Rewards saved once'),null,{timeout:20000});assert.match(await page.locator('#summary').innerText(),/Rewards saved once/);const final=await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)));assert.equal(final.progression.sessions,2);await page.waitForFunction(()=>window.wakeEvents.at(-1)==='release');await page.screenshot({path:path.join(output,'mobile-offline-rhythm-complete.png'),fullPage:true});
 const warnings=await page.evaluate(()=>window.vibrationEvents.filter(event=>event.duration===100));
 assert.equal(warnings.length,1);
 assert.ok(warnings[0].position>=3&&warnings[0].position<3.2);
 const savedId=new URL(page.url()).searchParams.get('snapshot');await page.evaluate(async id=>{const snapshot=await store.savedSnapshot(library,id);await store.remove('files',snapshot.media[0].storage_key);},savedId);await page.reload();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('unavailable'));assert.equal(await page.locator('#start').isDisabled(),true);
 assert.deepEqual(errors,[]);await context.setOffline(false);
 const other=await browser.newContext({viewport:{width:390,height:844}}),otherPage=await other.newPage();await otherPage.goto(origin+'/fanservice/');await otherPage.getByRole('checkbox',{name:'Select sample1.png'}).waitFor();const keyName=await otherPage.evaluate(()=>key());await otherPage.evaluate(({keyName,final})=>localStorage.setItem(keyName,JSON.stringify(final)),{keyName,final});await otherPage.reload();await otherPage.getByRole('button',{name:'Unlocks',exact:true}).click();await otherPage.getByRole('button',{name:'Play enabled packs'}).click();await otherPage.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('unavailable device-local'));assert.equal(await otherPage.locator('#start').isDisabled(),true);
 console.log('Mobile smoke passed: local privacy, controlled session/rewards/reload, explicit music snapshot, offline play with seeking disabled, checkpointed playback, natural completion, missing storage and cross-device unavailability. Physical iPhone/Android device behavior remains unverified.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
