const test=require('node:test'),assert=require('node:assert/strict');
const {Run}=require('../static/fanservice/run'),economy=require('../static/fanservice/economy');
const catalog=require('../static/fanservice/data/modes.json');
function session(config={}){const run=new Run(catalog,{seed:137,...config});economy.draw(run);return run;}
test('beat heat uses draw heat category and difficulty; beat coins truncate and wrap',()=>{
 for(const [difficulty,heat] of [[0,.1],[1,.2],[2,.6]]){const run=session({difficulty});run.beat();assert(Math.abs(run.state.heat-heat)<1e-12);assert.equal(run.state.coins,1);assert.equal(run.state.strokes,1);}
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
test('item use records the native specific metrics and source heat ordering',()=>{
 const run=session({modifiers:['Hot Hands']});run.ownedModifiers=[4,0];run.state.heat=74;economy.itemUsed(run,10,'Defensive');assert.equal(run.state.heat,74);assert.equal(run.state.ItemsUsed,1);assert.equal(run.state.DefensiveItemsUsed,1);assert.equal(run.state.EscapeRopesUsed,1);
 economy.itemUsed(run,5,'Offensive');assert.equal(run.state.heat,75);assert.equal(run.state.BonerPillsUsed,1);economy.itemUsed(run,11,'Offensive');assert.equal(run.state.LootRushesUsed,1);economy.itemUsed(run,13,'Defensive');assert.equal(run.state.ComboCrunchersUsed,1);
});
test('active time metrics and run currency stop outside playing phases',()=>{
 const run=session();run.state.heat=70;run.advance(.6);run.advance(.6);assert.equal(run.state.TimeAtHighHeat,1);run.advance(1.9);assert.equal(run.state.TimeAtHighHeat,3);run.phase='shop';const before=run.export();run.advance(60);run.beat();assert.deepEqual(run.export(),before);
});
test('Succubus drawing locks ordinary items and Those Are Mine clears only equipped charges',()=>{
 const run=session({modifiers:['Those Are Mine']});run.inventory.state(1).charges=3;run.inventory.state(3).charges=2;run.inventory.equip(1,0);run.state.card=3;economy.draw(run);assert.equal(run.inventory.state(1).charges,0);assert.equal(run.inventory.state(3).charges,2);assert.equal(run.state.canUseItems,false);
 run.state.card=0;economy.draw(run);assert.equal(run.state.canUseItems,true);
});
