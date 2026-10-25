(function(root){
 'use strict';
 const load=(file,name)=>typeof module!=='undefined'&&module.exports?require('./'+file+'.js'):root[name];
 const Rules=load('rules','FanserviceRules'),Modifiers=load('modifiers','FanserviceModifiers');
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),add=(a,b)=>((a||0)+b)|0;
 const catalog=[
  [0,'Pot Lid','Caps max heat to 75%.',10],[1,'Golden Shower','Earn 5x coins from the loot bar.',5],
  [2,'Lube','Halves heat gain.',12],[3,'Devil Coin','50% chance of double SuccuCoins from Succubi.',6],
  [4,'Heat Spell','Defensive items reduce heat by 10 on use.',8],[5,'Burning Profits','Double item-drop weights at 100 heat.',6],
  [6,'Mollasses','50% slower strokes.',20],[7,'Infernal Clause','Halves Succubus stroke counts.',12],
  [8,'Hell Magnet','Doubles Succubus event weight.',2],[9,'Accelerant','Doubles loot progress during Succubus encounters.',6],
  [10,'Exorcist','30 second cooldown after defeating a Succubus.',10],[11,'Banking Error','20% chance of double beat coins.',4],
  [12,'Stockholm Cuffs','Triple SuccuCoin rewards.',6],[13,'Bigger Pockets','One extra charge of capacity per item.',8],
  [14,'Enhanced Plating','Shields last two draws.',8],[16,'Passive Cooling','Filling the loot bar reduces heat by 2.',3],
  [17,'Recycler','25% chance an item use retains its charge.',6],[18,'Spoils of Sin','A random equipped item charge after defeating a Succubus.',10],
  [19,'Goon Tycoon','One SuccuCoin every active minute.',3],[20,'Coinverter','One SuccuCoin every 300 strokes.',12],
  [21,'Flame Harness','Succubus strokes reduce heat by 0.25.',12]
 ].map(([id,title,description,cost])=>({id,title,description,cost}));
 function has(run,id){return run.ownedModifiers.includes(id);}
 function initialize(run){const s=run.state;s.economy??={seed:173203,tycoonElapsed:0,exorcistRemaining:0,coinverterStrokes:0};s.lootBar??=0;s.lootRolls??=0;return s.economy;}
 function fraction(run){const e=initialize(run);e.seed=(Math.imul(e.seed,196314165)+907633515)|0;return (e.seed>>>9)/8388608;}
 function heatCap(run){return has(run,0)?75:100;}
 function addHeat(run,amount){const s=run.state;s.heat=clamp(s.heat+amount*(has(run,2)?.5:1)*[.5,1,3][run.config.difficulty??1],0,100);s.heat=Math.min(s.heat,heatCap(run));}
 function addSuccuCoins(run,amount){if(!Number.isSafeInteger(amount)||amount<0||run.state.succuCoins+amount>2147483647)return false;run.state.succuCoins+=amount;return true;}
 function purchase(run,id){const row=catalog.find(r=>r.id===id);if(!row)return {ok:false,reason:'Unknown Succu shop modifier.'};if(has(run,id))return {ok:false,reason:'Modifier already owned for this run.'};if(run.state.succuCoins<row.cost)return {ok:false,reason:'Insufficient SuccuCoins.'};run.state.succuCoins-=row.cost;run.ownedModifiers.push(id);run.state.SuccuCoinsSpent=add(run.state.SuccuCoinsSpent,row.cost);return {ok:true,cost:row.cost};}
 function addBeatCoins(run,amount){const s=run.state;if(has(run,11)&&fraction(run)<Math.fround(.2))amount=add(amount,amount);const earned=Math.trunc(amount*(s.coinMultiplier??1));s.coins=add(s.coins,earned);if(earned>0)s.SessionCoinsEarned=add(s.SessionCoinsEarned,earned);return earned;}
 function context(run){return {mode:run.config.mode,manager:true,maxBreaks:run.config.maxBreaks??run.catalog.music_upgrades[1].Value_L1,biggerPockets:has(run,13),burningProfits:has(run,5)&&run.state.heat>=100};}
 function grant(run,type){return run.inventory.grant(type,1,context(run));}
 function loot(run){
  const s=run.state,reward=Modifiers.rollLoot(run.inventory,s.modifiers,Math.fround(run.random.fraction()*100),context(run));
  let applied=true,tax=0;
  if(reward.type===4)applied=grant(run,reward.item);
  else if(reward.type===6){applied=false;for(const type of run.inventory.hotbarItems)if(type!==8)applied=grant(run,type)||applied;}
  else{tax=Modifiers.coinTax(s.coins,s.modifiers);s.coins=add(s.coins,-tax);reward.amount=Math.min(2147483647,reward.amount*(has(run,1)?5:1));s.coins=add(s.coins,reward.amount);}
  s.lootRolls=add(s.lootRolls,1);s.lastLoot={...reward,applied,tax,roll:s.lootRolls};
  if(has(run,16))s.heat=clamp(s.heat-2,0,heatCap(run));
  return s.lastLoot;
 }
 function beat(run){
  if(run.phase!=='playing'||run.state.finished)return [];
  const s=run.state,e=initialize(run),events=[];
  s.strokes=add(s.strokes,1);s.combo=add(s.combo,1);s.maxCombo=Math.max(s.maxCombo,s.combo);
  if(s.card===3&&s.modifiers.includes('Avarice'))s.coins=add(s.coins,-1);else addBeatCoins(run,Rules.coinAward(s.card));
  addHeat(run,[.25,.15,.2][s.heatCategory??1]||0);
  if(s.modifiers.includes('Mr. Money Bandz'))s.baseGain=.000125;
  s.meter=Rules.meter(s);
  if(run.config.lootEnabled){
   if(s.lootBar>=1){events.push({type:'loot',reward:loot(run)});s.lootBar=0;}
   const base={0:.05,1:.035,2:.03,3:.05,5:.05,6:.05,7:.03,8:.03}[s.card]||0;
   const charges=run.inventory.hotbarItems.reduce((sum,type)=>sum+(run.inventory.state(type)?.charges||0),0);
   const multiplier=Modifiers.lootMultiplier(s.lootBarMultiplier??1,charges,s.combo,s.modifiers);
   s.lootBar+=base*(s.modifiers.includes('Mr. Money Bandz')?2:1)*(has(run,9)&&s.card===3?2:1)*multiplier;
  }
  if(has(run,20)){e.coinverterStrokes++;if(e.coinverterStrokes>=300){addSuccuCoins(run,Math.trunc(e.coinverterStrokes/300));e.coinverterStrokes%=300;}}
  if(has(run,21)&&s.card===3)addHeat(run,-.25);
  return events;
 }
 function draw(run){
  const s=run.state;initialize(run);s.coinMultiplier=1;s.meterMultiplier=1;s.canUseSlowdown=true;s.canUseBonerPill=true;
  s.canUseItems=!s.modifiers.includes('Raw Dog');s.totalDraws=add(s.totalDraws,1);
  if(s.heat>=100){s.highDraws=add(s.highDraws,1);s.DrawsAtMaxHeat=add(s.DrawsAtMaxHeat,1);}else s.highDraws=0;
  s.heatCategory=s.heat>=0&&s.heat<=30?2:s.heat<=70?1:s.heat<=100?0:s.heatCategory??1;
  if(s.card===3){s.canUseItems=false;if(s.modifiers.includes('Those Are Mine'))for(const type of run.inventory.hotbarItems){const item=run.inventory.state(type);if(item)item.charges=0;}}
 }
 function succubusDefeated(run,amount){
  if(!Number.isSafeInteger(amount)||amount<=0)return {coins:0,item:null};
  let reward=amount;if(has(run,3)&&fraction(run)<.5)reward*=2;if(has(run,12))reward*=3;reward=Math.min(2147483647,reward);addSuccuCoins(run,reward);
  if(has(run,10))initialize(run).exorcistRemaining=30;
  let item=null,coins=0;if(has(run,18)){
   const caps={1:3,3:3,4:2,5:5,6:15,7:1,9:3,10:1,11:2,12:2,13:2};
   const eligible=run.inventory.hotbarItems.filter(type=>caps[type]&&run.inventory.state(type)?.charges<caps[type]+(has(run,13)?1:0));
   if(eligible.length){item=eligible[Math.min(eligible.length-1,Math.trunc(Math.fround(fraction(run)*eligible.length)))];grant(run,item);}
   else{coins=75;run.state.coins=add(run.state.coins,coins);}
  }
  return {succuCoins:reward,coins,item};
 }
 function itemUsed(run,type,classification){
  const s=run.state;s.ItemsUsed=add(s.ItemsUsed,1);
  const metric=classification==='Offensive'?'OffensiveItemsUsed':'DefensiveItemsUsed';s[metric]=add(s[metric],1);
  const specific={5:'BonerPillsUsed',10:'EscapeRopesUsed',11:'LootRushesUsed',13:'ComboCrunchersUsed'}[type];if(specific)s[specific]=add(s[specific],1);
  if(metric==='DefensiveItemsUsed'&&has(run,4))s.heat=clamp(s.heat-10,0,100);
  if(type!==1&&s.modifiers.includes('Hot Hands'))s.heat=clamp(s.heat+10,0,heatCap(run));
 }
 function recycler(run){return has(run,17)&&fraction(run)<.25;}
 function advance(run,seconds){
  const s=run.state,e=initialize(run);e.exorcistRemaining=Math.max(0,e.exorcistRemaining-seconds);
  const ticks=Math.floor(s.seconds+seconds)-Math.floor(s.seconds);if(ticks>0&&s.heat>=70)s.TimeAtHighHeat=add(s.TimeAtHighHeat,ticks);
  if(has(run,19)){e.tycoonElapsed+=seconds;const reward=Math.trunc(e.tycoonElapsed/60);if(reward>0){addSuccuCoins(run,reward);e.tycoonElapsed-=60*reward;}}
 }
 const sourceLedger=['RecoveredRules.cpp: BeatComplete, AddBeatLootReward, AddToLootBar, PrepareDrawState','RecoveredSession.cpp: GetLootIncrement','RecoveredCardDispatch.cpp: RollAndGiveLootDropsV2','RecoveredSuccuEconomy.cpp: catalog, currency, metric/action handlers, timers','RecoveredNewerItemRuntime.cpp: item-use metrics'];
 const shopIds=[0,1,2,3,4,5,6,7,9,10,11,12,13,16,17,18,19,20,21];
 const api={catalog,shopIds,initialize,has,fraction,heatCap,addHeat,addSuccuCoins,purchase,addBeatCoins,loot,beat,draw,succubusDefeated,itemUsed,recycler,advance,sourceLedger};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceEconomy=api;
})(globalThis);
