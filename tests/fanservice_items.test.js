const test=require('node:test');
const assert=require('node:assert/strict');
const items=require('../static/fanservice/items.js');
const modes=require('../static/fanservice/data/modes.json');
const random={range:(a)=>a};
function charged(type,level=1){const inventory=items.prepare(modes,0,random);Object.assign(inventory.state(type),{charges:1,level});return inventory;}
test('source rows and chooser lifecycle preserve empty hotbar',()=>{const classic=items.prepare(modes,0,random);assert.deepEqual(classic.ownedItems.map(s=>s.type),[1,3,4,5,6,7,9,11,12,13,10]);assert.deepEqual(classic.hotbarItems,[8,8,8,8,8]);const tower=items.prepare(modes,1,random);assert.deepEqual(tower.ownedItems.map(s=>s.type),[1,5]);assert.deepEqual(tower.hotbarItems,classic.hotbarItems);const music=items.prepare(modes,2,random);assert.deepEqual(music.hotbarItems,[4,8,8,8,8]);assert.equal(music.ownedItems.length,1);});
test('original StoreWidget buys one shield charge while direct grants preserve native overfill',()=>{
 const evidence=require('./fixtures/fanservice/original-inventory-purchase.json');
 const buy=evidence.records[0].statements.find(s=>s.index===182).statement.ContextExpression;
 assert.equal(buy.VirtualFunctionName,'GrantItem');assert.deepEqual(buy.Parameters[1],{op:'EX_IntConst',Value:1});
 const inv=charged(6,2),wallet={coins:500};inv.state(6).charges=14;
 assert.deepEqual(items.purchase(inv,6,wallet),{ok:true,cost:125,amount:buy.Parameters[1].Value});
 assert.equal(inv.state(6).charges,15);assert.equal(wallet.coins,375);
 assert.equal(items.purchase(inv,6,wallet).ok,false);assert.equal(items.upgrade(inv,7,wallet).ok,false);
 inv.state(6).charges=14;assert.equal(inv.grant(6,4),true);assert.equal(inv.state(6).charges,18);
});
test('item purchases and upgrades charge only after a successful state change',()=>{
 const inv=items.prepare(modes,0,random),wallet={coins:200};
 assert.deepEqual(items.upgrade(inv,1,wallet),{ok:true,cost:100});
 assert.equal(inv.state(1).level,2);assert.equal(wallet.coins,100);
 wallet.coins=99;assert.equal(items.upgrade(inv,1,wallet).ok,false);
 assert.equal(inv.state(1).level,2);assert.equal(wallet.coins,99);
 inv.state(1).charges=3;assert.equal(items.purchase(inv,1,wallet).ok,false);
 assert.equal(wallet.coins,99);assert.equal(inv.state(1).charges,3);
});
test('loadout equip moves an item between valid slots without duplicates',()=>{
 const inv=items.prepare(modes,0,random);
 assert.equal(items.equip(inv,1,0).ok,true);assert.equal(items.equip(inv,3,1).ok,true);
 assert.equal(items.equip(inv,1,1).ok,true);
 assert.deepEqual(inv.hotbarItems,[0,1,8,8,8]);
 assert.equal(items.equip(inv,1,5).ok,false);assert.deepEqual(inv.hotbarItems,[0,1,8,8,8]);
});
test('missing hooks and cooldowns never consume',()=>{const inv=charged(3),state={beatInterval:.5};assert.equal(items.use(inv,3,state).ok,false);assert.equal(inv.state(3).charges,1);assert.equal(items.use(inv,3,state,{hooks:{speed:()=>true}}).ok,true);assert.equal(state.beatInterval,1);inv.state(3).charges=1;assert.equal(items.use(inv,3,state,{hooks:{speed:()=>true}}).ok,false);assert.equal(inv.state(3).charges,1);});
test('runtime break durations differ from table tooltip durations',()=>{const inv=charged(4,5);let duration;assert.equal(items.use(inv,4,{combo:20},{hooks:{beginBreak:n=>{duration=n;}}}).ok,true);assert.equal(duration,50);assert.equal(modes.items.find(r=>r.ItemType.endsWith('::Break')).Level5TooltipTitle,'25 Sec Break');});
test('loot rush exact deadline expires once and removes additive bonus',()=>{const inv=charged(11,5),state={lootBarMultiplier:1};assert.equal(items.use(inv,11,state).ok,true);assert.equal(state.lootBarMultiplier,2.5);assert.deepEqual(items.tick(inv,state,49),[]);assert.deepEqual(items.tick(inv,state,-1),[]);assert.deepEqual(items.tick(inv,state,1),['LootRushExpired']);assert.equal(state.lootBarMultiplier,1);assert.deepEqual(items.tick(inv,state,1),[]);});
test('bounty excludes preexisting strokes and checks completion before deadline',()=>{const inv=charged(12),state={strokes:100};assert.equal(items.use(inv,12,state,{random}).ok,true);assert.equal(state.effects.bountyRequiredStrokes,38);assert.equal(state.effects.bountyRemaining,14);assert.deepEqual(items.tick(inv,state,1,{random}),[]);state.strokes=138;assert.deepEqual(items.tick(inv,state,20,{random}),['BountyClaimed']);assert.equal(state.coins,75);assert.deepEqual(items.tick(inv,state,1,{random}),[]);});
test('bounty failure fires once',()=>{const inv=charged(12,5),state={strokes:500};items.use(inv,12,state,{random});assert.deepEqual(items.tick(inv,state,31,{random}),['BountyFailed']);state.strokes=999;assert.deepEqual(items.tick(inv,state,1,{random}),[]);});
test('resupply consumes only after delayed store success',()=>{const inv=charged(7),state={};const hooks={openStore:()=>false};assert.equal(items.use(inv,7,state,{hooks}).pending,true);assert.equal(inv.state(7).charges,1);assert.deepEqual(items.tick(inv,state,2,{hooks}),['StoreUnavailable']);hooks.openStore=()=>true;assert.deepEqual(items.tick(inv,state,1,{hooks}),['StoreOpened']);assert.equal(inv.state(7).charges,0);});
test('resupply applies itemUsed at activation exactly once while the charge stays delayed',()=>{const inv=charged(7),state={combo:12},calls=[];const hooks={openStore:()=>false,itemUsed:(...args)=>calls.push(args)};assert.equal(items.use(inv,7,state,{hooks}).pending,true);assert.deepEqual(calls,[[7]]);assert.equal(state.combo,0);assert.equal(inv.state(7).charges,1);assert.deepEqual(items.tick(inv,state,2,{hooks}),['StoreUnavailable']);assert.deepEqual(calls,[[7]]);assert.equal(state.combo,0);assert.equal(inv.state(7).charges,1);hooks.openStore=()=>true;assert.deepEqual(items.tick(inv,state,1,{hooks}),['StoreOpened']);assert.deepEqual(calls,[[7]]);assert.equal(state.combo,0);assert.equal(inv.state(7).charges,0);});
test('combo conversion uses recovered fraction and truncation',()=>{const inv=charged(13,5),state={combo:501,cumMeter:0};assert.equal(items.use(inv,13,state).ok,true);assert.equal(state.combo,100);assert.equal(state.cumMeter,501/5000);});
test('shield toggle and recycler preserve charges',()=>{const inv=charged(6),state={};assert.equal(items.use(inv,6,state).consumed,false);assert.equal(inv.state(6).charges,1);const heat=charged(1);assert.equal(items.use(heat,1,{heat:50},{hooks:{recycler:()=>true}}).ok,true);assert.equal(heat.state(1).charges,1);});
test('Break punishment rolls after the effect and never pre-empts it (hotbar stmt 167)',()=>{
 const inv=charged(4,1),state={combo:20},order=[],spawned=[];
 const deps={context:{punishmentEnabled:true},hooks:{beginBreak:()=>{order.push('break');return true;},punishment:()=>{order.push('roll');return true;},spawnPunishment:(...args)=>spawned.push(args)}};
 assert.deepEqual(items.use(inv,4,state,deps),{ok:true,consumed:true});
 assert.deepEqual(order,['break','roll']);
 assert.equal(state.combo,0);assert.equal(inv.state(4).charges,0);
 assert.equal(spawned.length,1);assert.equal(spawned[0][0],4);
});
test('Break punishment miss still applies the effect and spawns nothing',()=>{
 const inv=charged(4,1),state={combo:20};let rolled=false,spawned=0;
 const deps={context:{punishmentEnabled:true},hooks:{beginBreak:()=>true,punishment:()=>{rolled=true;return false;},spawnPunishment:()=>{spawned++;}}};
 assert.equal(items.use(inv,4,state,deps).ok,true);
 assert.equal(rolled,true);assert.equal(spawned,0);assert.equal(state.combo,0);assert.equal(inv.state(4).charges,0);
});
test('Playlist Break never rolls punishment (ActivateItem stmts 62-71)',()=>{
 const inv=charged(4,1),state={combo:20};let rolled=false;
 const deps={context:{mode:2,breakDuration:10,punishmentEnabled:true},hooks:{beginBreak:()=>true,punishment:()=>{rolled=true;return true;}}};
 assert.equal(items.use(inv,4,state,deps).ok,true);
 assert.equal(rolled,false);assert.equal(state.combo,0);assert.equal(inv.state(4).charges,0);
});
test('Break without a punishment hook still applies the effect',()=>{
 const inv=charged(4,1),state={combo:20};
 assert.equal(items.use(inv,4,state,{context:{punishmentEnabled:true},hooks:{beginBreak:()=>true}}).ok,true);
 assert.equal(state.combo,0);assert.equal(inv.state(4).charges,0);
});
test('DecreaseHeat punishment skips only the widget effect (hotbar stmts 97-103)',()=>{
 // The roll sits after AoN/UpdateItemUses and before the widget effect (heat
 // -15, cum-meter add, count decrement at stmts 103-155); a trigger spawns the
 // punishment event and skips that effect, but the use still succeeds and the
 // charge is consumed (UseItem already ran in ActivateItem). The punishment
 // event itself changes no heat, so there is no +15.
 const inv=charged(1),state={heat:50},spawned=[];
 const deps={context:{punishmentEnabled:true},hooks:{punishment:()=>true,spawnPunishment:(...args)=>spawned.push(args)}};
 assert.deepEqual(items.use(inv,1,state,deps),{ok:true,consumed:true});
 assert.equal(state.heat,50);assert.equal(state.cumMeter,undefined);assert.equal(inv.state(1).charges,0);
 assert.equal(spawned.length,1);assert.equal(spawned[0][0],1);
});
test('DecreaseHeat punishment miss applies the full effect',()=>{
 const inv=charged(1),state={heat:50};let spawned=0;
 const deps={context:{punishmentEnabled:true},hooks:{punishment:()=>false,spawnPunishment:()=>{spawned++;}}};
 assert.deepEqual(items.use(inv,1,state,deps),{ok:true,consumed:true});
 assert.equal(state.heat,35);assert.equal(state.cumMeter,.01);assert.equal(spawned,0);assert.equal(inv.state(1).charges,0);
});
test('Slowdown punishment never blocks the effect (hotbar stmt 183)',()=>{
 // The roll sits after AoN/UpdateItemUses; a trigger spawns the punishment
 // event and the ActivateItem continuation still runs.
 const inv=charged(3),state={beatInterval:.5},spawned=[];
 const deps={context:{punishmentEnabled:true},hooks:{speed:()=>true,punishment:()=>true,spawnPunishment:(...args)=>spawned.push(args)}};
 assert.equal(items.use(inv,3,state,deps).ok,true);
 assert.equal(state.beatInterval,1);assert.equal(state.canUseSlowdown,false);assert.equal(state.cumMeter,.01);
 assert.equal(spawned.length,1);assert.equal(spawned[0][0],3);assert.equal(inv.state(3).charges,0);
});
test('SuccuShield and Resupply never roll punishment (no roll site in the hotbar ubergraph)',()=>{
 // The hotbar ubergraph has exactly five RollPunishmentChance sites (Edge,
 // type 0, type 1, type 3, Break tail); types 6 and 7 have none.
 for(const type of [6,7]){
  const inv=charged(type),state={combo:12};let rolled=false;
  const deps={context:{punishmentEnabled:true},hooks:{punishment:()=>{rolled=true;return true;},openStore:()=>false}};
  assert.equal(items.use(inv,type,state,deps).ok,true,`type ${type}`);
  assert.equal(rolled,false,`type ${type}`);
 }
});
