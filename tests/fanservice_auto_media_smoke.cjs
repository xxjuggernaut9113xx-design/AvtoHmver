const {webkit}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42183';

(async()=>{
 const browser=await webkit.launch({headless:true,...(process.env.FANSERVICE_WEBKIT_EXECUTABLE?{executablePath:process.env.FANSERVICE_WEBKIT_EXECUTABLE}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   localStorage.setItem('fanservice-profile-v1:auto-media-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:auto-media-fixture',library_id:'auto-media-fixture',device_id:'fixture',name:'Automatic media fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
   crypto.getRandomValues=array=>{array.fill(42);return array;};
  });
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'auto-media-fixture',media:[{id:1,type:'image',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect width="640" height="360" fill="%2388aabb"/%3E%3C/svg%3E',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);
   if(relative==='data/card-rules.json'){
    const rules=JSON.parse(body.toString());rules.patterns.slow=[[1]];rules.patterns.medium=[[1]];rules.patterns.fast=[[1]];
    for(const key of ['SlowHeat','MediumHeat','HighHeat'])rules.heat[key]={MinStrokeCount:5,MaxStrokeCount:5,MinIntervalSeconds:.1,MaxIntervalSeconds:.1};
    rules.difficulty_count=[1,1,1];rules.difficulty_speed=[1,1,1];rules.minimum_intervals=[.1,.1,.1];rules.travel=.1;body=Buffer.from(JSON.stringify(rules));
   }
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  await page.goto(origin+'/fanservice/play.html?library=auto-media-fixture');
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.sessionState==='playing');
  const snapshots=[];
  for(let second=0;second<30;second++){
   await page.clock.runFor(1000);
   snapshots.push(await page.evaluate(()=>({pool:state.cardFlow?.pool,generation:state.cardFlow?.generation,nextHit:state.cardFlow?.nextHit,heat:state.heat,strokes:state.strokes,selector:document.querySelector('#pool')})));
   if(new Set(snapshots.map(row=>row.pool).filter(Boolean)).size>=2)break;
  }
  assert.ok(snapshots.some(row=>row.pool==='slow'),'public Start begins in the low heat ordinary pool');
  assert.ok(new Set(snapshots.map(row=>row.pool).filter(Boolean)).size>=2,`natural card completion changes ordinary pool: ${JSON.stringify(snapshots)}`);
  assert.ok(snapshots.some(row=>row.pool==='medium'),'actual beat heat reaches the medium ordinary pool');
  assert.ok(snapshots.every(row=>row.selector===null),'no manual pool selector is present');
  for(let index=1;index<snapshots.length;index++){
   assert.ok(snapshots[index].heat>=snapshots[index-1].heat,'heat never decreases during ordinary beats');
   assert.ok(snapshots[index].strokes>=snapshots[index-1].strokes,'strokes never decrease during ordinary beats');
   if(snapshots[index].generation===snapshots[index-1].generation)assert.ok(snapshots[index].nextHit>=snapshots[index-1].nextHit,'card flow advances naturally within its generation');
  }
  assert.deepEqual(errors,[],'no browser errors');
  console.log('Automatic media WebKit smoke passed: public Start, natural card completion, and heat based pool progression (synthetic neutral media and fixture-authored pacing; no native pattern fidelity claim).');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
