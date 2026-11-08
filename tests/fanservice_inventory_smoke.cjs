const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.FANSERVICE_FIXTURE_ORIGIN||'http://127.0.0.1:42169';
const output=process.env.FANSERVICE_SMOKE_OUTPUT;
// This is a scoped transaction acceptance: synthetic media, shop phase and wallet
// establish the precondition. All purchases/upgrades/equips use player controls.
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')console.error('Browser:',message.text());});
  // Exercise the checked-out assets even when the fixture server embeds an older build.
  await page.route('**/fanservice/**',async route=>{
   const relative=new URL(route.request().url()).pathname.slice('/fanservice/'.length)||'index.html';
   const file=path.resolve(__dirname,'../static/fanservice',relative);
   if(file.startsWith(path.resolve(__dirname,'../static/fanservice')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())await route.fulfill({path:file});
   else await route.continue();
  });
  await page.goto(origin+'/fanservice/');await page.waitForFunction(()=>typeof serverReady!=='undefined');await page.evaluate(()=>serverReady);
  const png=fs.readFileSync(path.join(__dirname,'../static/fanservice/assets/button_rectangle_flat.png')).toString('base64');
  const library=await page.evaluate(async encoded=>{
   const [file]=await FanserviceStore.importFiles([new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'inventory.png',{type:'image/png'})],['slow','medium','fast','succubus','cum','ass','boobs']);
   const pack={id:'custom:inventory-test',library_id:libraryId,device_id:FanserviceStore.device,name:'Inventory acceptance',description:'Synthetic transaction fixture',unlock_cost:0,selection:{ids:[],rules:[],local_ids:[file.id]}};
   const manifest={library_id:libraryId,media:[{id:'local:'+file.id}]};let next=FanserviceModel.change(FanserviceModel.fresh(),{action:'create',pack,manifest});next=FanserviceModel.change(next,{action:'enable',id:pack.id,enabled:true,manifest});localStorage.setItem(key(),JSON.stringify(next));return libraryId;
  },png);
  const play=origin+'/fanservice/play.html?library='+encodeURIComponent(library);
  await page.goto(play);await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor().catch(async error=>{console.error(await page.locator('#status').innerText());throw error;});
  assert.deepEqual(await page.evaluate(()=>run.inventory.hotbarItems),[8,8,8,8,8]);
  assert.equal(await page.evaluate(()=>run.inventory.ownedItems.every(i=>i.charges===0&&i.level===1)),true);
  await page.getByRole('button',{name:'Inventory / loadout',exact:true}).click();
  await page.getByLabel('Slot for DecreaseHeat',{exact:true}).selectOption('2');
  await page.getByRole('button',{name:'Equip DecreaseHeat',exact:true}).click();
  await page.getByRole('button',{name:'Close inventory',exact:true}).click();
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  // Controlled shop entry avoids claiming Tower-objective coverage in this test.
  await page.evaluate(()=>{run.phase='shop';state.coins=0;renderInventory();});
  await page.getByRole('button',{name:'Inventory / loadout',exact:true}).click();
  const snapshot=()=>page.evaluate(()=>({inventory:run.inventory.export(),coins:state.coins,spent:state.MoneySpent||0}));
  const empty=await snapshot();
  await page.getByRole('button',{name:'Buy DecreaseHeat · 100',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Insufficient coins');assert.deepEqual(await snapshot(),empty);
  await page.getByRole('button',{name:'Upgrade DecreaseHeat · 100',exact:true}).click();assert.deepEqual(await snapshot(),empty);
  await page.evaluate(()=>{state.coins=1000;});
  await page.getByRole('button',{name:'Upgrade DecreaseHeat · 100',exact:true}).click();
  await page.getByRole('button',{name:'Buy DecreaseHeat · 150',exact:true}).click();
  await page.getByRole('button',{name:'Buy DecreaseHeat · 150',exact:true}).click();
  await page.getByRole('button',{name:'Buy DecreaseHeat · 150',exact:true}).click();
  const full=await snapshot();assert.equal(full.inventory.ownedItems.find(i=>i.type===1).level,2);assert.equal(full.inventory.ownedItems.find(i=>i.type===1).charges,3);assert.equal(full.coins,450);assert.equal(full.spent,550);
  await page.getByRole('button',{name:'Buy DecreaseHeat · 150',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Capacity reached');assert.deepEqual(await snapshot(),full);
  // Original StoreWidget always passes Count=1 to GrantItem, including shields.
  await page.getByRole('button',{name:'Upgrade SuccuShield · 100',exact:true}).click();
  await page.getByRole('button',{name:'Buy SuccuShield · 125',exact:true}).click();
  const shield=await snapshot();assert.equal(shield.inventory.ownedItems.find(i=>i.type===6).charges,1,'Original StoreWidget grants one shield charge per purchase at every level');assert.equal(shield.coins,225);assert.equal(shield.spent,775);
  await page.getByLabel('Slot for DecreaseHeat',{exact:true}).selectOption('4');await page.getByRole('button',{name:'Equip DecreaseHeat',exact:true}).click();
  const saved=await snapshot();assert.equal(saved.inventory.hotbarItems[4],1);assert.equal(saved.inventory.hotbarItems.filter(i=>i===1).length,1);
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'inventory-purchased.png'),fullPage:true});}
  await page.reload();await page.getByText('Unfinished session ready. Tap Start to resume.').waitFor();assert.deepEqual(await snapshot(),saved);
  await page.getByRole('button',{name:'Start',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();assert.deepEqual(await snapshot(),saved);
  await page.getByRole('button',{name:'End session',exact:true}).click();await page.waitForFunction(()=>finished);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem(profileKey)).mobile_loadout),saved.inventory.hotbarItems);
  await page.goto(play);await page.getByText('Ready. Tap Start to enable local playback and audio.').waitFor();
  assert.deepEqual(await page.evaluate(()=>run.inventory.hotbarItems),saved.inventory.hotbarItems.map(type=>type===0?8:type),'New sessions normalize the recovered empty-slot sentinel');
  assert.equal(await page.evaluate(()=>run.inventory.ownedItems.every(i=>i.charges===0&&i.level===1)),true,'New sessions must not grant prior session charges');
  await page.locator('#mode').selectOption('1');assert.equal(await page.evaluate(()=>run.inventory.ownedItems.length),2);assert.deepEqual(await page.evaluate(()=>run.inventory.hotbarItems),[8,8,8,8,8]);
  // Only the inventory mode initialization is scoped here, not soundtrack playback.
  await page.evaluate(()=>{music={inventoryAcceptance:true};});
  await page.locator('#mode').selectOption('2');assert.deepEqual(await page.evaluate(()=>run.inventory.ownedItems.map(i=>[i.type,i.charges])),[[4,0]]);assert.deepEqual(await page.evaluate(()=>run.inventory.hotbarItems),[4,8,8,8,8]);
  assert.deepEqual(errors,[]);
  const report={passed:true,precondition:'Synthetic local media; controlled shop phase and 1000 session coins; synthetic soundtrack metadata for mode initialization only',transactions:saved,coverage:['fresh zero charges','insufficient purchase and upgrade atomicity','level 1 upgrade cost 100','level 2 purchase cost 150','three-charge capacity','level 2 shield buys exactly one charge for 125','equip move without duplication','exact checkpoint/reload and resume','settled profile loadout','new-session charge reset','Tower and soundtrack availability'],authority:'modes.json byte-roundtripped tables plus original-inventory-purchase.json retained original StoreWidget/BP_CHGameInstance bytecode at reJOIce commit 1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff; browser transaction evidence compared with original static control flow, not an original-game live runtime trace'};
  if(output)fs.writeFileSync(path.join(output,'inventory-acceptance.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Inventory browser acceptance passed: actual equip, purchase, upgrade, insufficient-funds, capacity, checkpoint/reload, profile loadout and mode controls.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
