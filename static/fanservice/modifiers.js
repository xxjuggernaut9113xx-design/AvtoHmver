(function(root){
 'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x));
 const conflictMap={
  'Pheromones':['Slow and Steady','Succufrenzy'],
  'Mr. Money Bandz':['Succufrenzy','Sacrificial'],
  'Ass Fanatic':['Boobs Fanatic','Feet Fanatic'],
  'Boobs Fanatic':['Ass Fanatic','Feet Fanatic'],
  'Hungry Succubi':['Succufrenzy','Slow and Steady','Demon Proof','Deal With The Devil'],
  'Succufrenzy':['Slow and Steady','Sacrificial','Hungry Succubi','Raw Dog','Demon Proof','All or Nothing','Double Time','Pheromones','Mr. Money Bandz','Deal With The Devil'],
  'Slow and Steady':['Hungry Succubi','Succufrenzy','Hivemind','Deal With The Devil','Double Time','Pheromones','Iron Man'],
  'Sacrificial':['Mr. Money Bandz','Deal With The Devil','Succufrenzy'],
  'Feet Fanatic':['Ass Fanatic','Boobs Fanatic'],
  'Iron Man':['Slow and Steady'],
  'Raw Dog':['Succufrenzy','All or Nothing'],
  'Demon Proof':['Deal With The Devil','Hivemind','Succufrenzy','Hungry Succubi'],
  'All or Nothing':['Succufrenzy','Raw Dog'],
  'Hivemind':['Demon Proof','Slow and Steady'],
  'Deal With The Devil':['Demon Proof','Hungry Succubi','Sacrificial','Slow and Steady','Succufrenzy'],
  'Double Time':['Succufrenzy','Slow and Steady']
 };
 const names=[...Object.keys(conflictMap),'Prize Machine','Fap Tax','Bad RNG','Overencumbered','Dry Spell','Double Devil','Panic Button','Hot Hands','Jackpot Drops','Greed Machine','Those Are Mine','Avarice'];
 const sourceLedger=Object.freeze({
  definitions:'native-contract.json:DT_Modifiers',conflicts:'RecoveredProgression.cpp:GetRecoveredModifierConflicts',
  media:'RecoveredRules.cpp:LoadMediaPack',items:'RecoveredRules.cpp:PrepareDrawState',
  meter:'RecoveredSession.cpp:AddBeatMeter',eventDispatch:'RecoveredEventRules.cpp:DetermineDispatchedEvent',
  succubusCount:'RecoveredSpecialCards.cpp:DrawRecoveredSpecialCard',lootMultiplier:'RecoveredRules.cpp:AddToLootBar',
  loot:'RecoveredNativeLoot.cpp:Roll',tax:'RecoveredCardDispatch.cpp:RollAndGiveLootDropsV2',panic:'RecoveredNativeLoot.cpp:IsPanicBlocked'
 });
 function text(value){const m=String(value||'').match(/,\s*"((?:\\.|[^"\\])*)"\)$/);return m?m[1].replace(/\\'/g,"'").replace(/\\"/g,'"'):String(value||'');}
 function canonical(name){return names.find(n=>n.toLowerCase()===String(name).toLowerCase())||null;}
 function active(enabled){return new Set((enabled||[]).map(n=>canonical(n)||n));}
 function definitions(contract){return (contract.DT_Modifiers||[]).map(row=>({...copy(row),id:text(row.ModifierTitle),name:text(row.ModifierTitle),description:text(row.ModifierDescription),conflicts:copy(conflictMap[text(row.ModifierTitle)]||[])}));}
 function conflicts(name,enabled){const id=canonical(name)||name,set=active(enabled);return (conflictMap[id]||[]).filter(n=>set.has(n));}
 function toggle(profile,name,enabled,settings={}){
  const id=canonical(name);if(!id)throw Error('Unknown modifier: '+name);const next=copy(profile);next.progression??={};const p=next.progression;p.enabled_modifiers??=[];
  if(!enabled){p.enabled_modifiers=p.enabled_modifiers.filter(n=>canonical(n)!==id);return next;}
  if(!(p.unlocked_modifiers||[]).some(n=>canonical(n)===id))throw Error('Unlock this modifier first: '+id);
  const blocked=conflicts(id,p.enabled_modifiers);if(blocked.length&&!settings.replaceConflicts)throw Error('Conflicting modifiers: '+blocked.join(', '));
  p.enabled_modifiers=p.enabled_modifiers.filter(n=>!blocked.includes(canonical(n)||n));if(!p.enabled_modifiers.some(n=>canonical(n)===id))p.enabled_modifiers.push(id);return next;
 }
 function options(enabled){const set=active(enabled),has=n=>set.has(n);return {
  ass:has('Ass Fanatic'),boobs:has('Boobs Fanatic'),feet:has('Feet Fanatic'),modifiers:[...set],
  canUseItems:!has('Raw Dog'),canSpawnSuccubi:!has('Demon Proof'),
  eventOverride:has('Succufrenzy')?'succubus':has('Slow and Steady')?'slow-medium':has('Double Time')?'fast-succubus':null,
  meter:{hungrySuccubi:has('Hungry Succubi'),sacrificial:has('Sacrificial'),succubusOnly:has('Deal With The Devil'),moneyBandz:has('Mr. Money Bandz')},
  loot:{prizeMachine:has('Prize Machine'),badRNG:has('Bad RNG'),drySpell:has('Dry Spell'),jackpotDrops:has('Jackpot Drops'),fapTax:has('Fap Tax'),overencumbered:has('Overencumbered'),greedMachine:has('Greed Machine')}
 };}
 function dispatchEvent(event,enabled,roll){const set=active(enabled);if(set.has('Succufrenzy'))return {event:'SpawnSuccubus',clearIdle:false};if(set.has('Slow and Steady'))return {event:roll===0?'MediumStrokeEvent':'SlowStrokeEvent',clearIdle:false};if(set.has('Double Time'))return {event:roll===0?'SpawnSuccubus':'FastStrokeEvent',clearIdle:false};const events={0:'PostEdgeSlow',1:'PostEdgeFast',3:'SlowStrokeEvent',4:'MediumStrokeEvent',5:'FastStrokeEvent',7:'TemptationEvent',8:'SpawnSuccubus',10:'MercyEvent',14:'AssFrenzyEvent',15:'BoobFrenzyEvent',30:'SpawnStoreEvent',31:'VideoLoopStrokeEvent'};return {event:events[event]||null,clearIdle:true};}
 function succubusCountMultiplier(base,defeated,enabled,economyMultiplier=1){const set=active(enabled);return (base+(set.has('Hivemind')?.4*defeated:0))*economyMultiplier+(set.has('Double Devil')?1:0);}
 function lootMultiplier(base,charges,combo,enabled){const set=active(enabled);let result=base;if(set.has('Overencumbered')&&charges>=2)result-=.5;if(set.has('Greed Machine')&&combo+1667!==0)result+=2*combo/(combo+1667);return result;}
 function panicBlocked(item,heat,enabled){return heat<=75&&active(enabled).has('Panic Button')&&['DecreaseHeat','Slowdown','Break','SuccuShield','Resupply','EscapeRope','ComboCruncher'].includes(item);}
 function coinTax(coins,enabled){return active(enabled).has('Fap Tax')?Math.max(0,Math.min(999999999,Math.floor(coins*.05+.5))):0;}
 function rollLoot(inventory,enabled,roll,context={}){
  const f=Math.fround,set=active(enabled),fallback={type:0,item:8,amount:context.coinReward??10};if(set.has('Dry Spell')||!Number.isFinite(roll))return fallback;
  const table=[[1,3,15],[3,3,10],[4,2,6],[5,5,10],[6,15,25],[7,1,1],[9,3,20],[11,2,10],[12,2,10],[13,2,5],[10,1,.5]],eligible=[];let total=0;
  for(const item of inventory.hotbarItems||[])for(const [type,cap,weight] of table)if(item===type){const state=typeof inventory.state==='function'?inventory.state(type):(inventory.ownedItems||[]).find(s=>s.type===type);if(state&&state.charges>=cap+(context.biggerPockets?1:0))break;eligible.push({item:type,weight:f(weight)});total=f(total+f(weight));break;}
  if(!eligible.length)return fallback;
  function scale(newTotal){const factor=total>0?f(Math.max(0,newTotal)/total):0;for(const row of eligible)row.weight=f(row.weight*factor);total=f(Math.max(0,newTotal));}
  const multiplier=set.has('Prize Machine')?(context.burningProfits?6:4):(context.burningProfits?2:1);if(multiplier!==1)scale(f(total*multiplier));if(set.has('Bad RNG'))scale(f(total-50));if(total>100)scale(100);
  let jackpot=0;if(set.has('Jackpot Drops')&&total>0){jackpot=Math.min(total,Math.max(0,Math.min(100,context.jackpotWeight??7.5)));scale(0);}
  let accumulated=0;for(const row of eligible){accumulated=f(accumulated+row.weight);if(row.weight>0&&f(roll)<=accumulated)return {type:4,item:row.item,amount:1};}if(jackpot>0&&f(roll)<=f(accumulated+jackpot))return {type:6,item:8,amount:1};return fallback;
 }
 const api={definitions,conflicts,toggle,options,dispatchEvent,succubusCountMultiplier,lootMultiplier,panicBlocked,coinTax,rollLoot,sourceLedger};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceModifiers=api;
})(typeof globalThis!=='undefined'?globalThis:this);
