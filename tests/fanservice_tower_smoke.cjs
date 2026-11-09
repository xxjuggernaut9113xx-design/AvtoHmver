const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../static/fanservice'),origin='http://127.0.0.1:42178',fixture='tower-round-fixture';

function estimatedWork(option){
 if(option.objective===0)return 4000;
 if(option.objective===1)return option.parameter*3;
 if(option.objective===2)return option.parameter;
 if(option.objective===3)return option.parameter*50;
 if(option.objective===6)return 0;
 if(option.objective===7)return option.parameter*2;
 if(option.objective===8)return option.parameter*50;
 return Infinity;
}
function chooseOption(options,final){
 const rank=final?{6:0,7:1,2:2,1:3,8:4,3:5,0:6}:{2:0,8:1,1:2,3:3,0:4};
 return options.map((option,index)=>({option,index})).sort((a,b)=>
  (rank[a.option.objective]??99)-(rank[b.option.objective]??99)||
  (final?estimatedWork(a.option)-estimatedWork(b.option):estimatedWork(b.option)-estimatedWork(a.option))
 )[0];
}

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(id=>{
  const key='fanservice-profile-v1:'+id;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:1,unlock_points:0,packs:[{id:'custom:'+id,library_id:id,device_id:'fixture',name:'Neutral Tower fixture',owned:true,enabled:true,selection:{ids:[1],rules:[],local_ids:[]}}]}));
 },fixture);
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/fanservice/v1/resolve')return route.fulfill({json:{library_id:fixture,media:[{id:1,type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',tags:['slow','medium','fast','succubus','cum','ass','boobs']} ]}});
  const relative=url.pathname.replace(/^\/fanservice\//,''),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  let body=fs.readFileSync(file);
  if(relative==='store.js')body=Buffer.concat([body,Buffer.from(`\nObject.assign(FanserviceStore,{savedLibrary:()=> '${fixture}',server:()=> '${origin}',assertServer:()=>{},resolveLocal:async()=>({media:[]})});`)]);
  return route.fulfill({body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.json')?'application/json':relative.endsWith('.html')?'text/html':relative.endsWith('.css')?'text/css':'application/octet-stream'});
 });
 try{
  await page.goto(origin+'/fanservice/play.html?library='+fixture);await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  await page.locator('#mode').selectOption('1');await page.locator('#tower-rounds').fill('2');await page.clock.install();
  await page.getByRole('button',{name:'Start',exact:true}).click();
  const rounds=[];
  async function playRound(round,final){
   const options=await page.evaluate(()=>run.tower.options.map(({objective,tier,parameter,lane,coins,succu_coins})=>({objective,tier,parameter,lane,coins,succu_coins})));
   const pick=chooseOption(options,final);await page.getByRole('button',{name:`Choose Tower option ${pick.index+1}`,exact:true}).click();
   let view=await page.evaluate(()=>({phase:run.phase,objective:run.roundObjective.objective,target:run.roundObjective.target,round:run.tower.round,seconds:state.seconds,strokes:state.strokes,edges:state.edges,succubi:state.succubi,milkingCount:state.milkingCount,meter:state.meter,allowed:run.player.isAllowedToCum}));
   if(view.objective===6){
    await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');
   }else if(view.objective===7){
    await page.getByRole('button',{name:'Hold to record tribute',exact:true}).focus();
    for(let n=0;n<view.target&&await page.evaluate(()=>run.phase==='playing');n++){await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');}
   }else{
    let edgeAttempts=0;
    for(let elapsed=0;elapsed<7200000;elapsed+=10000){
     view=await page.evaluate(()=>({phase:run.phase,objective:run.roundObjective.objective,target:run.roundObjective.target,edges:state.edges,edgePhase:state.edge?.phase||'idle',meter:state.meter,seconds:state.seconds,strokes:state.strokes,succubi:state.succubi,allowed:run.player.isAllowedToCum}));
     if(view.phase!=='playing'||view.allowed||view.meter>=1)break;
     if(view.objective===3&&view.edges<view.target&&view.edgePhase==='idle'&&edgeAttempts<view.target){
      await page.getByRole('button',{name:'Edge / E',exact:true}).click();edgeAttempts++;
     }else if(view.objective===3&&['rest','mercy'].includes(view.edgePhase)){
      const action=view.edgePhase==='mercy'?'Continue streak':'Continue / G';await page.getByRole('button',{name:action,exact:true}).click();
     }
     await page.clock.fastForward(10000);
    }
    view=await page.evaluate(()=>({phase:run.phase,objective:run.roundObjective.objective,target:run.roundObjective.target,edges:state.edges,edgePhase:state.edge?.phase||'idle',meter:state.meter,seconds:state.seconds,strokes:state.strokes,succubi:state.succubi,allowed:run.player.isAllowedToCum}));
    if(view.phase==='playing'&&(view.allowed||view.meter>=1)){await page.getByRole('button',{name:'Hold to finish',exact:true}).focus();await page.keyboard.down('Enter');await page.clock.runFor(1200);await page.keyboard.up('Enter');}
    assert.notEqual(await page.evaluate(()=>run.phase),'playing',`Tower round ${round} completes from delivered gameplay events: ${JSON.stringify(view)}`);
   }
   await page.waitForFunction(()=>run.phase!=='playing');
   const result=await page.evaluate(()=>({phase:run.phase,round:run.tower.round,completed:run.tower.completed,failed:run.tower.failed,coins:state.coins,succuCoins:state.succuCoins,inventory:run.inventory.export(),history:run.tower.history.at(-1),selected:run.tower.selected}));
   rounds.push({round,objective:result.selected.objective,target:result.selected.parameter,tier:result.selected.tier,lane:result.selected.lane,coins:result.coins,succuCoins:result.succuCoins,history:result.history});
   return result;
  }

  const first=await playRound(1,false);assert.equal(first.phase,'shop');assert.equal(first.failed,0);
  await page.getByRole('button',{name:'Inventory / loadout',exact:true}).click();await page.getByRole('heading',{name:'Inventory and loadout',exact:true}).waitFor();
  const transaction=await page.evaluate(()=>{
   const owned=run.inventory.ownedItems.filter(s=>s.unlocked),catalog=run.inventory.catalog;
   const buys=owned.map(state=>({state,row:catalog.find(row=>row.type===state.type)})).filter(x=>x.state.charges<x.row.maxCharges).sort((a,b)=>a.row.purchaseCosts[a.state.level-1]-b.row.purchaseCosts[b.state.level-1]);
   const upgrades=owned.map(state=>({state,row:catalog.find(row=>row.type===state.type)})).filter(x=>x.row.upgradeable&&x.state.level<5).sort((a,b)=>a.row.upgradeCosts[a.state.level-1]-b.row.upgradeCosts[b.state.level-1]);
   const buy=buys[0],upgrade=upgrades[0];return {coins:state.coins,buy:buy&&{id:buy.row.id,cost:buy.row.purchaseCosts[buy.state.level-1],charges:buy.state.charges,type:buy.row.type},upgrade:upgrade&&{id:upgrade.row.id,cost:upgrade.row.upgradeCosts[upgrade.state.level-1],level:upgrade.state.level,type:upgrade.row.type}};
  });
  assert(transaction.buy&&transaction.upgrade,'Tower shop has an available item purchase and upgrade');
  assert(transaction.coins>=transaction.buy.cost+transaction.upgrade.cost,`Earned Tower coins cover both shop transactions: ${JSON.stringify(transaction)}`);
  await page.getByRole('button',{name:`Buy ${transaction.buy.id} · ${transaction.buy.cost}`,exact:true}).click();
  await page.getByRole('button',{name:`Upgrade ${transaction.upgrade.id} · ${transaction.upgrade.cost}`,exact:true}).click();
  const purchased=await page.evaluate(()=>({coins:state.coins,inventory:run.inventory.export(),moneySpent:state.MoneySpent}));
  assert.equal(purchased.coins,transaction.coins-transaction.buy.cost-transaction.upgrade.cost);
  await page.getByRole('button',{name:'Close inventory',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(checkpointKey)));
  assert.equal(saved.run.phase,'shop');assert.equal(saved.run.tower.completed,1);assert.equal(saved.run.tower.failed,0);
  await page.reload();await page.getByText('Unfinished session ready. Tap Start to resume.').waitFor();
  const restored=await page.evaluate(()=>({phase:run.phase,round:run.tower.round,completed:run.tower.completed,failed:run.tower.failed,coins:state.coins,inventory:run.inventory.export(),history:run.tower.history}));
  assert.equal(restored.phase,'shop');assert.equal(restored.completed,1);assert.equal(restored.failed,0);assert.equal(restored.coins,purchased.coins);assert.deepEqual(restored.inventory,purchased.inventory);assert.deepEqual(restored.history,saved.run.tower.history);
  await page.getByRole('button',{name:'Start',exact:true}).click();await page.getByRole('button',{name:'Continue Tower',exact:true}).click();
  const carry=await page.evaluate(()=>({phase:run.phase,round:run.tower.round,inventory:run.inventory.export(),coins:state.coins}));
  assert.equal(carry.phase,'selection');assert.equal(carry.round,1);assert.deepEqual(carry.inventory,purchased.inventory);assert.equal(carry.coins,purchased.coins);
  const final=await playRound(2,true);assert.equal(final.phase,'complete');assert.equal(final.failed,0);
  await page.waitForFunction(()=>finished);const settled=await page.evaluate(()=>({won:state.won,round:run.tower.round,completed:run.tower.completed,failed:run.tower.failed,best:state.BestTowerWinRounds,progression:JSON.parse(localStorage.getItem(profileKey)).progression}));
  assert.equal(settled.won,true);assert.equal(settled.round,2);assert.equal(settled.completed,2);assert.equal(settled.failed,0);assert.equal(settled.best,2);assert.equal(settled.progression.sessions,1);assert.equal(settled.progression.wins,1);assert.deepEqual(errors,[]);
  const report={authority:'normal Tower draft/shop/finish controls with Playwright virtual-clock gameplay ticks and synthetic neutral media/Server routes; no state or gameplay counter injection; not original-game execution or device acceptance',fixture,sourceHashes:Object.fromEntries(['tower.js','run.js','objectives.js','cards.js','items.js','play.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')])),rounds,transaction,purchased,checkpoint:{phase:restored.phase,completed:restored.completed,inventoryRetained:true},carry,settled};
  if(process.env.FANSERVICE_SMOKE_OUTPUT){fs.mkdirSync(process.env.FANSERVICE_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.FANSERVICE_SMOKE_OUTPUT,'tower-browser.json'),JSON.stringify(report,null,2));}
  console.log('Tower browser smoke passed: two delivered finite rounds, shop purchase/upgrade, checkpoint restore, retained inventory, and one final winning settlement. '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
