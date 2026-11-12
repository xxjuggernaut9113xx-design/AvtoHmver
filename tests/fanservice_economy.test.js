const test=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run'),economy=require('../static/fanservice/economy');
const catalog=require('../static/fanservice/data/modes.json');
function session(config={}){const run=new Run(catalog,{seed:137,...config});economy.draw(run);return run;}
test('beat heat uses draw heat category and difficulty; beat coins truncate and wrap',()=>{
 for(const [difficulty,heat] of [[0,.15],[1,.2],[2,.4]]){const run=session({difficulty});run.beat();assert(Math.abs(run.state.heat-heat)<1e-12);assert.equal(run.state.coins,1);assert.equal(run.state.strokes,1);}
 const run=session();run.state.coinMultiplier=1.9;run.state.coins=2147483647;run.beat();assert.equal(run.state.coins,-2147483648);assert.equal(run.state.SessionCoinsEarned,1);
 run.state.card=3;run.state.modifiers=['Avarice'];run.beat();assert.equal(run.state.coins,2147483647);assert.equal(run.state.SessionCoinsEarned,1);
});
test('draw reset and heat boundaries keep native consecutive and session metrics separate',()=>{
 const run=session();Object.assign(run.state,{heat:100,coinMultiplier:3,meterMultiplier:8});economy.draw(run);economy.draw(run);assert.equal(run.state.highDraws,2);assert.equal(run.state.DrawsAtMaxHeat,2);assert.equal(run.state.coinMultiplier,1);assert.equal(run.state.meterMultiplier,1);
 run.state.heat=30;economy.draw(run);assert.equal(run.state.highDraws,0);assert.equal(run.state.DrawsAtMaxHeat,2);assert.equal(run.state.heatCategory,2);run.state.heat=70;economy.draw(run);assert.equal(run.state.heatCategory,1);run.state.heat=70.01;economy.draw(run);assert.equal(run.state.heatCategory,0);
});
test('loot rewards occur before increment on the following beat and never while disabled',()=>{
 const run=session({lootEnabled:true});run.state.lootBar=.99;assert.deepEqual(run.beat(),[]);assert.equal(run.state.lootRolls,0);assert(run.state.lootBar>1);
 const events=run.beat();assert.equal(events[0].type,'loot');assert.equal(run.state.lootRolls,1);assert.equal(run.state.lootBar,.05);assert.equal(run.state.coins,12);
 run.config.lootEnabled=false;run.state.lootBar=1;run.beat();assert.equal(run.state.lootRolls,1);assert.equal(run.state.lootBar,1);
});
test('cash loot applies tax before Golden Shower without multiplying the direct coin grant',()=>{
 const run=session({modifiers:['Dry Spell','Fap Tax']});run.ownedModifiers=[1,16];Object.assign(run.state,{coins:101,coinMultiplier:9,heat:70});const reward=economy.loot(run);assert.equal(reward.tax,5);assert.equal(reward.amount,50);assert.equal(run.state.coins,146);assert.equal(run.state.heat,68);assert.equal(run.state.SessionCoinsEarned,undefined);
});
test('jackpot grants equipped slots without claiming a charge above grant capacity',()=>{
 const run=session({modifiers:['Jackpot Drops']});run.inventory.equip(1,0);run.inventory.equip(13,1);run.random.fraction=()=>0;
 const result=economy.loot(run);assert.equal(result.type,6);assert.equal(run.inventory.state(1).charges,1);assert.equal(run.inventory.state(13).charges,1);
 economy.loot(run);assert.equal(run.inventory.state(1).charges,2);assert.equal(run.inventory.state(13).charges,1);
});
test('loot bar effects combine native charge-count, combo and encounter multipliers',()=>{
 const run=session({lootEnabled:true,modifiers:['Overencumbered','Greed Machine','Mr. Money Bandz']});run.ownedModifiers=[9];run.inventory.equip(1,0);run.inventory.state(1).charges=2;run.state.card=3;run.state.combo=1666;run.beat();assert(Math.abs(run.state.lootBar-.3)<1e-12);assert.equal(run.state.baseGain,.000125);
});
test('run-only shop rejects duplicate, unknown and unaffordable purchases without charging',()=>{
 const run=session();run.state.succuCoins=12;assert.deepEqual(economy.purchase(run,2),{ok:true,cost:12});assert.equal(run.state.SuccuCoinsSpent,12);assert.equal(run.state.succuCoins,0);assert(!economy.purchase(run,2).ok);assert(!economy.purchase(run,15).ok);assert(!economy.purchase(run,0).ok);assert.equal(run.state.SuccuCoinsSpent,12);
 assert(!economy.addSuccuCoins(run,-1));run.state.succuCoins=2147483647;assert(!economy.addSuccuCoins(run,1));
});
test('run timers, currency and independent economy randomness resume exactly',()=>{
 const run=session();run.ownedModifiers=[11,17,19,20,21];run.state.card=3;run.state.heat=60;
 for(let i=0;i<299;i++)run.beat();run.advance(59);const restored=Run.restore(catalog,run.export());
 for(const value of [run,restored]){value.beat();value.advance(1);economy.recycler(value);}
 assert.deepEqual(restored.export(),run.export());assert.equal(run.state.succuCoins,2);assert.equal(run.state.economy.coinverterStrokes,0);assert.equal(run.state.economy.tycoonElapsed,0);
});
test('item use records the native specific metrics',()=>{
 // Escape Rope gets no Heat Spell -10 (ActivateItem stmts 120-130 never call
 // ApplyHeatSpellEffect for type 10), so Hot Hands (+10, capped at 75 by Pot
 // Lid) is the only heat change: 74 -> 75.
 const run=session({modifiers:['Hot Hands']});run.ownedModifiers=[4,0];run.state.heat=74;economy.itemUsed(run,10,'Defensive');assert.equal(run.state.heat,75);assert.equal(run.state.ItemsUsed,1);assert.equal(run.state.DefensiveItemsUsed,1);assert.equal(run.state.EscapeRopesUsed,1);
 economy.itemUsed(run,5,'Offensive');assert.equal(run.state.heat,75);assert.equal(run.state.BonerPillsUsed,1);economy.itemUsed(run,11,'Offensive');assert.equal(run.state.LootRushesUsed,1);economy.itemUsed(run,13,'Defensive');assert.equal(run.state.ComboCrunchersUsed,1);
});
test('item-use counters use the native EMetricType names for ordinals 30/31/35',()=>{
 // reJOIce Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json
 // lists EMetricType with 47 values (30 DefensiveItemsUsed, 31 OffensiveItemsUsed,
 // 35 EscapeRopesUsed); the older Analysis/native-reflection-enums.json has only
 // 30 values (0-29), which is why those ordinals looked unresolved.
 assert.deepEqual([economy.metricIds[30],economy.metricIds[31],economy.metricIds[35]],['DefensiveItemsUsed','OffensiveItemsUsed','EscapeRopesUsed']);
 assert.equal(economy.metricIds[8],'ItemsUsed');assert.equal(economy.metricIds[27],'BonerPillsUsed');assert.equal(economy.metricIds[34],'LootRushesUsed');assert.equal(economy.metricIds[39],'ComboCrunchersUsed');
 // Each counter itemUsed increments is one of the resolved names: Escape Rope
 // (10) touches 8, 30 and 35; Combo Cruncher (13) 8, 30 and 39; Boner Pill (5)
 // 8 and 27 only (no 31 — its callee UseBonerPill is retained and calls
 // neither UpdateMetric); Loot Rush (11) 8, 31 and 34; types 9/12 touch 8
 // and 31 only. #48 counting correction (unpacked v0.05.1, 2026-11-11):
 // DefensiveItemsUsed (30) only for types 4/6/7/10/13 and OffensiveItemsUsed
 // (31) only for types 9/11/12; types 1/3 increment neither 30 nor 31
 // (their callees UseReduceHeatItem/UseSlowdownItem are retained and call
 // neither), and types 4/6/7 increment 30 (their callees Use Break Item /
 // ToggleSuccuShields / TabbedInventoryResupplyTrigger reach UpdateMetric
 // (30,1) in the unpacked widget ubergraphs).
 const rope=session();economy.itemUsed(rope,10,'Defensive');assert.equal(rope.state[economy.metricIds[8]],1);assert.equal(rope.state[economy.metricIds[30]],1);assert.equal(rope.state[economy.metricIds[35]],1);
 const cruncher=session();economy.itemUsed(cruncher,13,'Defensive');assert.equal(cruncher.state[economy.metricIds[8]],1);assert.equal(cruncher.state[economy.metricIds[30]],1);assert.equal(cruncher.state[economy.metricIds[39]],1);
 const pill=session();economy.itemUsed(pill,5,'Offensive');assert.equal(pill.state[economy.metricIds[8]],1);assert.equal(pill.state[economy.metricIds[31]],undefined);assert.equal(pill.state[economy.metricIds[27]],1);
 const rush=session();economy.itemUsed(rush,11,'Offensive');assert.equal(rush.state[economy.metricIds[8]],1);assert.equal(rush.state[economy.metricIds[31]],1);assert.equal(rush.state[economy.metricIds[34]],1);
 for(const type of [9,12]){const run=session();economy.itemUsed(run,type,'Offensive');assert.equal(run.state[economy.metricIds[8]],1);assert.equal(run.state[economy.metricIds[31]],1);assert.equal(run.state[economy.metricIds[30]],undefined);}
 for(const type of [4,6,7]){const run=session();economy.itemUsed(run,type,'Defensive');assert.equal(run.state[economy.metricIds[8]],1);assert.equal(run.state[economy.metricIds[30]],1);assert.equal(run.state[economy.metricIds[31]],undefined);}
 for(const type of [1,3]){const run=session();economy.itemUsed(run,type,'Defensive');assert.equal(run.state[economy.metricIds[8]],1);assert.equal(run.state[economy.metricIds[30]],undefined);assert.equal(run.state[economy.metricIds[31]],undefined);}
});
test('Heat Spell reduces heat only on the ActivateItem branches that call ApplyHeatSpellEffect',()=>{
 // ActivateItem stmts 30, 42, 53, 74, 91, 102 call ApplyHeatSpellEffect for
 // types 0, 1, 3, 6, 7 and for Break outside Playlist mode; Escape Rope (10)
 // and Combo Cruncher (13) never call it, and UseEscapeRopeItem's ubergraph
 // flow (entry 71540) only creates a widget, re-enables items and calls
 // SlowStrokeEvent, so neither gets the -10.
 for(const type of [1,3,6,7]){const run=session();run.ownedModifiers=[4];run.state.heat=50;economy.itemUsed(run,type,'Defensive');assert.equal(run.state.heat,40,`type ${type}`);}
 for(const [mode,heat] of [[0,40],[1,40],[2,50]]){const run=session({mode});run.ownedModifiers=[4];run.state.heat=50;economy.itemUsed(run,4,'Defensive');assert.equal(run.state.heat,heat,`Break mode ${mode}`);}
 for(const [type,classification] of [[10,'Defensive'],[13,'Defensive'],[5,'Offensive'],[9,'Offensive'],[11,'Offensive'],[12,'Offensive']]){const run=session();run.ownedModifiers=[4];run.state.heat=50;economy.itemUsed(run,type,classification);assert.equal(run.state.heat,50,`type ${type}`);}
 // With Pot Lid capping heat at 75, Heat Spell (-10) applies before Hot Hands
 // (+10): 74 -> 64 -> 74, not 74 -> 75 -> 65.
 const ordered=session({modifiers:['Hot Hands']});ordered.ownedModifiers=[4,0];ordered.state.heat=74;economy.itemUsed(ordered,3,'Defensive');assert.equal(ordered.state.heat,74);
});
test('Hot Hands heats Break only in Playlist mode, as the retained ActivateItem branches do',()=>{
 for(const [mode,heat] of [[0,50],[1,50],[2,60]]){
  const run=session({mode,modifiers:['Hot Hands']});run.state.heat=50;
  economy.itemUsed(run,4,'Defensive');
  assert.equal(run.state.heat,heat,`Break in mode ${mode}`);assert.equal(run.state.ItemsUsed,1);assert.equal(run.state.DefensiveItemsUsed,1);
 }
 for(const type of [3,5,6,7,9,10,11,12,13]){const run=session({modifiers:['Hot Hands']});run.state.heat=50;economy.itemUsed(run,type,'Offensive');assert.equal(run.state.heat,60,`type ${type}`);}
 const decrease=session({modifiers:['Hot Hands']});decrease.state.heat=50;economy.itemUsed(decrease,1,'Defensive');assert.equal(decrease.state.heat,50);
});
test('Hot Hands returns its notification when it applies, and none otherwise',()=>{
 // DetermineShouldHotHandsModifierApply (retained AST): CreateNotificationBox
 // ("Hot Hands Modifier", "Item usage adds heat.\r\n+10% Heat Added", ...)
 // fires before AddHeat(10.0, true) whenever Hot Hands is active and the
 // item is not type 1. The player renders it on the single status line as
 // "Title: body" (the Punishment precedent), collapsing the body's line
 // break to a space. The box fires even when the heat is already capped.
 const note='Hot Hands Modifier: Item usage adds heat. +10% Heat Added';
 const run=session({modifiers:['Hot Hands']});run.state.heat=50;
 assert.equal(economy.itemUsed(run,3,'Defensive'),note);assert.equal(run.state.heat,60);
 const capped=session({modifiers:['Hot Hands']});capped.ownedModifiers=[0];capped.state.heat=75;
 assert.equal(economy.itemUsed(capped,3,'Defensive'),note);assert.equal(capped.state.heat,75);
 const playlist=session({mode:2,modifiers:['Hot Hands']});playlist.state.heat=50;
 assert.equal(economy.itemUsed(playlist,4,'Defensive'),note);assert.equal(playlist.state.heat,60);
 const plain=session();plain.state.heat=50;assert.equal(economy.itemUsed(plain,3,'Defensive'),null);
 const decrease=session({modifiers:['Hot Hands']});decrease.state.heat=50;
 assert.equal(economy.itemUsed(decrease,1,'Defensive'),null);assert.equal(decrease.state.heat,50);
 const widget=session({modifiers:['Hot Hands']});widget.state.heat=50;
 assert.equal(economy.itemUsed(widget,4,'Defensive'),null);assert.equal(widget.state.heat,50);
});
test('Heat Spell returns its notification when it applies, and combines with Hot Hands in original order',()=>{
 // ApplyHeatSpellEffect (reJOIce functions/BP_GlobalManager, retained AST):
 // CreateNotificationBox("Heat Spell", "Defensive Item Used\r\nHeat has
 // been reduced by 10%", ...) fires whenever the effect's condition holds —
 // the same branches that get the -10 (ActivateItem stmts 30, 42, 53, 74,
 // 91, 102). The player renders it on the single status line as "Title:
 // body" (the Punishment / Hot Hands precedent), collapsing the body's line
 // break to a space. The box fires even when the heat is already at the
 // floor, so the notification is tied to the condition, not to the heat
 // change. When both Heat Spell and Hot Hands apply, ActivateItem calls
 // Heat Spell first in every branch (Heat Spell stmt < Hot Hands stmt), so
 // the player joins them in that order with ' · ' — a player rendering
 // decision for the single status line, keeping the string|null contract.
 const note='Heat Spell: Defensive Item Used Heat has been reduced by 10%';
 const hot='Hot Hands Modifier: Item usage adds heat. +10% Heat Added';
 for(const type of [1,3,6,7]){const run=session();run.ownedModifiers=[4];run.state.heat=50;assert.equal(economy.itemUsed(run,type,'Defensive'),note);assert.equal(run.state.heat,40);}
 for(const mode of [0,1]){const run=session({mode});run.ownedModifiers=[4];run.state.heat=50;assert.equal(economy.itemUsed(run,4,'Defensive'),note);assert.equal(run.state.heat,40);}
 const playlist=session({mode:2});playlist.ownedModifiers=[4];playlist.state.heat=50;
 assert.equal(economy.itemUsed(playlist,4,'Defensive'),null);assert.equal(playlist.state.heat,50);
 for(const [type,classification] of [[10,'Defensive'],[13,'Defensive'],[5,'Offensive'],[9,'Offensive'],[11,'Offensive'],[12,'Offensive']]){const run=session();run.ownedModifiers=[4];run.state.heat=50;assert.equal(economy.itemUsed(run,type,classification),null);assert.equal(run.state.heat,50);}
 const floor=session();floor.ownedModifiers=[4];floor.state.heat=0;
 assert.equal(economy.itemUsed(floor,3,'Defensive'),note);assert.equal(floor.state.heat,0);
 const both=session({modifiers:['Hot Hands']});both.ownedModifiers=[4,0];both.state.heat=74;
 assert.equal(economy.itemUsed(both,3,'Defensive'),note+' · '+hot);assert.equal(both.state.heat,74);
 const hotOnly=session({mode:2,modifiers:['Hot Hands']});hotOnly.ownedModifiers=[4];hotOnly.state.heat=50;
 assert.equal(economy.itemUsed(hotOnly,4,'Defensive'),hot);assert.equal(hotOnly.state.heat,60);
 const spellOnly=session({modifiers:['Hot Hands']});spellOnly.ownedModifiers=[4];spellOnly.state.heat=50;
 assert.equal(economy.itemUsed(spellOnly,1,'Defensive'),note);assert.equal(spellOnly.state.heat,40);
});
test('active time metrics and run currency stop outside playing phases',()=>{
 const run=session();run.state.heat=70;run.advance(.6);run.advance(.6);assert.equal(run.state.TimeAtHighHeat,1);run.advance(1.9);assert.equal(run.state.TimeAtHighHeat,3);run.phase='shop';const before=run.export();run.advance(60);run.beat();assert.deepEqual(run.export(),before);
});
test('Succubus drawing locks ordinary items and Those Are Mine clears only equipped charges',()=>{
 const run=session({modifiers:['Those Are Mine']});run.inventory.state(1).charges=3;run.inventory.state(3).charges=2;run.inventory.equip(1,0);run.state.card=3;economy.draw(run);assert.equal(run.inventory.state(1).charges,0);assert.equal(run.inventory.state(3).charges,2);assert.equal(run.state.canUseItems,false);
 run.state.card=0;economy.draw(run);assert.equal(run.state.canUseItems,true);
});
test('beat meter time gain reads the GM SessionLength, not wall seconds',()=>{
 // AddtoCumMeteronBeatComplete stmt 43 (GM ubergraph, v0.05.1, cooked
 // package export 14): the time term is Divide_IntInt(
 // PlayerVariablesStruct.SessionLength, 300) / 10000 — the GM counter,
 // not the PM wall clock. The two diverge whenever the Devil guard held
 // GM seconds back or Prejac stopped the clock.
 const run=session();run.state.card=0;run.state.meter=0;run.state.meterMultiplier=1;
 run.state.seconds=0;run.objective.gmSeconds=300;run.beat();
 assert(Math.abs(run.state.meter-.00035)<1e-12);
 const wall=session();wall.state.card=0;wall.state.meter=0;wall.state.meterMultiplier=1;
 wall.state.seconds=600;wall.objective.gmSeconds=0;wall.beat();
 assert(Math.abs(wall.state.meter-.00025)<1e-12);
});
