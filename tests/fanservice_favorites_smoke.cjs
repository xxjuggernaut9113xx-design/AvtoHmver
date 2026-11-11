const {chromium,webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../static/fanservice');let origin;const fixture='favorites-hotbar';

(async()=>{
 const engine=process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'&&process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:process.env.FANSERVICE_BROWSER_ENGINE!=='webkit'&&process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/api/fanservice/v1/resolve'){
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({library_id:fixture,media:[1,2,3,4,5,6].map(id=>({id,file:'fav'+id+'.png',type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}))}));return;
  }
  const relative=url.pathname.replace(/^\/fanservice\//,'');if(!url.pathname.startsWith('/fanservice/')){response.writeHead(404);response.end();return;}
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){response.writeHead(404);response.end();return;}
  let body=fs.readFileSync(file);if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> '${fixture}',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
  const type=relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream';response.writeHead(200,{'content-type':type});response.end(body);
 });
 const reports=[];
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:390,height:844},...(process.env.FANSERVICE_BROWSER_ENGINE==='webkit'?{deviceScaleFactor:3,isMobile:true,hasTouch:true}:{})}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(id=>{
   const progression={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[],challenge_progress:{},lifetime_metrics:{},unlocked_modifiers:[],enabled_modifiers:[]};
   localStorage.setItem('fanservice-profile-v1:'+id,JSON.stringify({version:1,unlock_points:0,mobile_loadout:[1],progression,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral favorites fixture',owned:true,enabled:true,selection:{ids:[1,2,3,4,5,6],rules:[],local_ids:[]}}]}));
  },fixture);
  try{
   await page.goto(origin+'/fanservice/play.html?library='+fixture);
   await page.waitForFunction(()=>!document.querySelector('#start').disabled);
   await page.locator('#mode').selectOption('0');await page.locator('#objective').selectOption('1');
   await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.evaluate(()=>{if(state.card===3||state.card===5||state.card===6)draw('slow',{force:true});});
   await page.clock.fastForward(2000);
   const favoriteButton=page.locator('#favorite-action');
   assert.equal(await favoriteButton.isHidden(),false,'The Favorite button must be visible during play');
   assert.equal(await favoriteButton.textContent(),'Favorite','The button starts as Favorite');
   assert.equal(await page.evaluate(()=>!!favorites&&favorites.ready),true,'The favorites registry must be built at installRun');
   await favoriteButton.click();
   assert.equal(await favoriteButton.textContent(),'Unfavorite','Toggling once must flip the label to Unfavorite');
   assert.equal(await page.evaluate(()=>favorites.isFavorite(currentMedia)),true,'The current media must be in the favorites registry after toggling');
   assert.equal(await page.evaluate(()=>favorites.getFavoriteFrenzyCardCount()),1,'The derived FavoriteFrenzy deck must hold the one favorite');
   await favoriteButton.click();
   assert.equal(await favoriteButton.textContent(),'Favorite','Toggling again must restore the label to Favorite');
   assert.equal(await page.evaluate(()=>favorites.isFavorite(currentMedia)),false,'The current media must leave the favorites registry after untoggling');
   assert.equal(await page.evaluate(()=>draw('slow',{force:true})),true,'Drawing must still work after favorite toggling');
   // Favorite Frenzy (TriggerSelectedEvent, BP_DrawManager event code 12):
   // with three favorites the automatic draw can pick the frenzy event and
   // spawn the 20-50 slow card as type 9, starting the 120 s cooldown. Six
   // fixture items are needed: favoriting removes an item from the normal
   // decks (play.js favorite toggle), so three must remain unfavorited or
   // the weighted event pick has no eligible rows at all.
   for(let n=0;n<8&&await page.evaluate(()=>favorites.getFavoriteFrenzyCardCount())<3;n++){
    await page.evaluate(()=>draw('slow',{force:true}));
    if(!await page.evaluate(()=>favorites.isFavorite(currentMedia)))await favoriteButton.click();
   }
   assert.equal(await page.evaluate(()=>favorites.getFavoriteFrenzyCardCount()),3,'Three favorites must fill the derived FavoriteFrenzy deck');
   assert.equal(await page.evaluate(()=>favorites.isFavoriteFrenzyEligible(state.seconds)),true,'The frenzy gate must be open with three favorites and no cooldown');
   let frenzy=false;
   for(let n=0;n<60&&!frenzy;n++){await page.evaluate(()=>draw(undefined,{force:true}));frenzy=await page.evaluate(()=>state.card===9);}
   assert.equal(frenzy,true,'An automatic draw must pick the frenzy event within 60 draws');
   assert.equal(await page.evaluate(()=>run.state.cardFlow.card),9,'The frenzy spawn must be card type 9');
   assert.equal(await page.evaluate(()=>run.state.cardFlow.pool),'slow','The frenzy spawn must draw from the slow deck');
   const frenzyStrokes=await page.evaluate(()=>run.state.cardFlow.assigned);
   assert.ok(frenzyStrokes>=16&&frenzyStrokes<=40,`Frenzy strokes ${frenzyStrokes} must be in 20-50 before the difficulty multiplier`);
   assert.equal(await page.evaluate(()=>favorites.isFavoriteFrenzyEligible(state.seconds)),false,'The frenzy spawn must start the 120 s cooldown');
   assert.deepEqual(errors,[],'No page errors');
   reports.push('favorites smoke: PASS');
  }catch(error){reports.push('favorites smoke: FAIL '+error.message);throw error;}
 }finally{await browser.close();server.close();}
 console.log(reports.join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
