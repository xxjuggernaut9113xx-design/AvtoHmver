const test=require('node:test'),assert=require('node:assert/strict');
const modifiers=require('../static/fanservice/modifiers.js'),contract=require('../static/fanservice/data/native-contract.json'),rules=require('../static/fanservice/rules.js');
test('28 native modifier definitions preserve source descriptions and exact identities',()=>{
 const defs=modifiers.definitions(contract);assert.equal(defs.length,28);assert.equal(new Set(defs.map(d=>d.id)).size,28);for(const d of defs){assert.ok(d.description);assert.equal(d.ModifierTitle,contract.DT_Modifiers.find(r=>r.Name===d.Name).ModifierTitle);assert.ok(!d.name.startsWith('NSLOCTEXT'));}assert.equal(defs[0].name,'Pheromones');
});
test('native conflict map covers every source pair symmetrically with no inferred loot conflicts',()=>{
 const defs=modifiers.definitions(contract);let pairs=0;for(const d of defs)for(const conflict of d.conflicts){pairs++;assert.deepEqual(modifiers.conflicts(d.id,[conflict]),[conflict]);assert.ok(modifiers.conflicts(conflict,[d.id]).includes(d.id));}assert.equal(pairs,52);
 assert.deepEqual(modifiers.conflicts('Pheromones',['Slow and Steady','Succufrenzy','Demon Proof']),['Slow and Steady','Succufrenzy']);assert.deepEqual(modifiers.conflicts('Prize Machine',['Bad RNG','Dry Spell']),[]);
});
test('toggle checks unlocks and replaces conflicts only by explicit choice, preserving profile and unknown fields',()=>{
 const profile={packs:[{owned:true,enabled:true}],device:{token:'local'},progression:{unlocked_modifiers:['Pheromones','Slow and Steady'],enabled_modifiers:['Slow and Steady'],future:12}};
 assert.throws(()=>modifiers.toggle(profile,'Pheromones',true),/Conflicting/);assert.throws(()=>modifiers.toggle(profile,'Raw Dog',true),/Unlock/);assert.throws(()=>modifiers.toggle(profile,'unknown',true),/Unknown/);
 const next=modifiers.toggle(profile,'pheromones',true,{replaceConflicts:true});assert.deepEqual(next.progression.enabled_modifiers,['Pheromones']);assert.deepEqual(next.packs,profile.packs);assert.deepEqual(next.device,profile.device);assert.equal(next.progression.future,12);assert.deepEqual(profile.progression.enabled_modifiers,['Slow and Steady']);assert.deepEqual(modifiers.toggle(next,'Pheromones',true),next);assert.deepEqual(modifiers.toggle(next,'Pheromones',false).progression.enabled_modifiers,[]);
});
test('media options drive existing native filter without changing pool rules',()=>{
 const media=[{file:'a.jpg',tags:['ass']},{file:'b.jpg',tags:['boobs']},{file:'c.jpg',tags:['feet']}];assert.deepEqual(rules.mediaPools(media,modifiers.options(['Ass Fanatic'])).ass,[media[0]]);assert.equal(rules.mediaPools(media,modifiers.options(['Ass Fanatic'])).boobs.length,0);assert.equal(modifiers.options(['Raw Dog']).canUseItems,false);assert.equal(modifiers.options(['Demon Proof']).canSpawnSuccubi,false);
});
test('native dispatch override order and binary roll behavior remain exact',()=>{
 assert.deepEqual(modifiers.dispatchEvent(30,['Succufrenzy','Slow and Steady'],1),{event:'SpawnSuccubus',clearIdle:false});
 assert.equal(modifiers.dispatchEvent(30,['Slow and Steady'],0).event,'MediumStrokeEvent');assert.equal(modifiers.dispatchEvent(30,['Slow and Steady'],1).event,'SlowStrokeEvent');assert.equal(modifiers.dispatchEvent(30,['Double Time'],0).event,'SpawnSuccubus');assert.equal(modifiers.dispatchEvent(30,['Double Time'],1).event,'FastStrokeEvent');assert.deepEqual(modifiers.dispatchEvent(30,[],0),{event:'SpawnStoreEvent',clearIdle:true});assert.deepEqual(modifiers.dispatchEvent(99,[],0),{event:null,clearIdle:true});
});
test('succubus scaling preserves source addition and multiplication order',()=>{
 assert.equal(modifiers.succubusCountMultiplier(1,5,['Hivemind','Double Devil'],2),7);assert.equal(modifiers.succubusCountMultiplier(1,5,[]),1);assert.equal(modifiers.succubusCountMultiplier(1,5,['Double Devil']),2);
});
test('loot multiplier, panic threshold and tax use runtime source boundaries',()=>{
 assert.equal(modifiers.lootMultiplier(1,1,0,['Overencumbered']),1);assert.equal(modifiers.lootMultiplier(1,2,1667,['Overencumbered','Greed Machine']),1.5);assert.equal(modifiers.panicBlocked('Break',75,['Panic Button']),true);assert.equal(modifiers.panicBlocked('Break',75.01,['Panic Button']),false);assert.equal(modifiers.panicBlocked('BonerPill',20,['Panic Button']),false);assert.equal(modifiers.coinTax(110,['Fap Tax']),6);assert.equal(modifiers.coinTax(110,[]),0);
});
test('source ledger identifies concrete native functions for implemented effects',()=>{
 for(const feature of ['conflicts','media','items','meter','eventDispatch','succubusCount','lootMultiplier','loot','tax','panic'])assert.match(modifiers.sourceLedger[feature],/Recovered/);
});
test('loot roll reproduces native reconstruction boundary fixtures including duplicate slots and caps',()=>{
 const inventory={hotbarItems:[1],ownedItems:[{type:1,charges:0}]},roll=(enabled,value,ctx)=>modifiers.rollLoot(inventory,enabled,value,ctx);
 assert.equal(roll([],15).type,4);assert.equal(roll([],15.01).type,0);assert.equal(roll(['Prize Machine'],60).type,4);assert.equal(roll(['Prize Machine'],60.01).type,0);assert.equal(roll(['Prize Machine'],90,{burningProfits:true}).type,4);assert.equal(roll(['Prize Machine','Bad RNG'],40.01,{burningProfits:true}).type,0);
 inventory.hotbarItems.push(1);assert.equal(roll([],30).type,4);inventory.ownedItems[0].charges=3;assert.equal(roll([],0).type,0);assert.equal(roll([],0,{biggerPockets:true}).type,4);assert.equal(roll(['Jackpot Drops'],7.5,{biggerPockets:true}).type,6);assert.equal(roll(['Jackpot Drops'],7.51,{biggerPockets:true}).type,0);assert.equal(roll(['Jackpot Drops','Dry Spell'],0,{biggerPockets:true}).type,0);assert.equal(roll([],NaN).type,0);
});
