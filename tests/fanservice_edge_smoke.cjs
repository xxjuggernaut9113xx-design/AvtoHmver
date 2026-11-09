const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42176';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],stages=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   if(!localStorage.getItem('fanservice-profile-v1:edge-fixture'))localStorage.setItem('fanservice-profile-v1:edge-fixture',JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:edge-fixture',library_id:'edge-fixture',device_id:'fixture',name:'Neutral Edge fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
  });
  await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:'edge-fixture',media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']}]}});
   const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);
   if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> 'edge-fixture',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
   return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
  });
  const snapshot=()=>page.evaluate(()=>({edge:state.edge,edges:state.edges,strokes:state.strokes,meter:state.meter,coins:state.coins,seconds:state.seconds,flow:state.cardFlow}));
  async function until(predicate,label){for(let n=0;n<3000;n++){if(await page.evaluate(predicate))return;await page.clock.runFor(50);}throw Error('Timed out: '+label);}
  async function trigger(){await page.getByRole('button',{name:'Edge / E',exact:true}).click();const s=await snapshot();stages.push({phase:s.edge.phase,streak:s.edge.streak,perfect:s.edge.perfect,bank:s.edge.bank,postBreak:s.edge.postBreak,seconds:s.seconds});return s;}
  async function rest(){await until(()=>['rest','mercy'].includes(state.edge.phase),'Edge handoff/hold');}
  async function replayHold(){
   await until(()=>state.edge.phase==='hold','Edge hold');const count=(await snapshot()).edges;
   await page.getByRole('button',{name:'Pause',exact:true}).click();const saved=await snapshot();
   await page.reload();await page.waitForFunction(()=>!document.querySelector('#start').disabled);assert.deepEqual(await snapshot(),saved,'Persisted hold restores before Start');
   await page.getByRole('button',{name:'Start',exact:true}).click();assert.equal((await snapshot()).edges,count-1,'Resume rolls back only current Edge');
   await trigger();
  }
  await page.goto(origin+'/fanservice/play.html?library=edge-fixture');await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.locator('#objective').selectOption('3');await page.locator('#objective-target').fill('12');
  await page.clock.install();await page.getByRole('button',{name:'Start',exact:true}).click();
  for(let n=1;n<=5;n++){
   const s=await trigger();assert.equal(s.edges,n);assert.equal(s.edge.bank,(n-1)*30);
   if(n===5){await until(()=>state.edge.phase==='hold','fifth Edge hold');assert.equal((await snapshot()).edge.holdRemaining,2);}
   await rest();
   if(n<5)await page.getByRole('button',{name:'Continue / G',exact:true}).click();
  }
  assert.equal((await snapshot()).edge.phase,'mercy');await page.getByRole('button',{name:'Continue streak',exact:true}).click();
  assert.equal((await snapshot()).edge.until,6);assert.equal((await snapshot()).edge.bank,120);
  await until(()=>state.cardFlow.completed/state.cardFlow.assigned>=.85,'perfect sixth Edge');
  const perfect=await trigger();assert(perfect.edge.perfect);assert.equal(perfect.edge.bank,170);assert.equal(perfect.edge.postBreak,2.75);
  await rest();assert.equal((await snapshot()).edge.phase,'rest');await page.getByRole('button',{name:'Continue / G',exact:true}).click();
  for(let n=7;n<=11;n++){
   const s=await trigger();assert.equal(s.edges,n);assert.equal(s.edge.postBreak,1.75+Math.trunc(n/5));if(n===10)await replayHold();await rest();
   if(n<11)await page.getByRole('button',{name:'Continue / G',exact:true}).click();
  }
  const before=await snapshot();assert.equal(before.edge.phase,'mercy');assert.equal(before.edge.bank,320);
  await page.getByRole('button',{name:'Accept Mercy',exact:true}).click();const accepted=await snapshot();
  assert.equal(accepted.coins,before.coins+320);assert.equal(accepted.edge.bank,0);assert(accepted.edge.deadline-accepted.seconds>59.9&&accepted.edge.deadline-accepted.seconds<=60);assert.equal(accepted.meter,before.meter+.01);
  await page.clock.runFor(59000);assert.equal((await snapshot()).edge.phase,'mercy-rest');assert.equal((await snapshot()).strokes,accepted.strokes);
  await page.getByRole('button',{name:'Continue / G',exact:true}).click();await trigger();assert.equal(await page.evaluate(()=>run.player.isAllowedToCum),true);
  await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');
  await page.getByText(/Rewards saved once/).waitFor();
  const result=await page.evaluate(()=>({edges:state.edges,finished,won:state.won,progression:JSON.parse(localStorage.getItem(profileKey)).progression}));
  assert.equal(result.edges,12);assert(result.finished&&result.won);assert.equal(result.progression.sessions,1);assert.equal(result.progression.lifetime_metrics.Edges,12);assert.deepEqual(errors,[]);
  const report={authority:'shared player controls with virtual browser time and synthetic neutral media/Server routes; not original-game execution or physical-device acceptance',sourceHashes:Object.fromEntries(['edge.js','run.js','cards.js','play.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')])),stages,acceptedBank:320,persistedHoldRestored:true,currentEdgeReplayed:true,edges:result.edges,sessions:1,won:result.won};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'edge-browser.json'),JSON.stringify(report,null,2));}
  console.log('Edge controls passed: normal/perfect, both Mercy choices, hold persistence and replay, fixed-base continuation, bank payout and one winning settlement. '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
