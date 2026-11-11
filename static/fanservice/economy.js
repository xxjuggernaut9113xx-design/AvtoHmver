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
  const effective=run.effectiveStats?run.effectiveStats():s;s.meter=Rules.meter({...s,edges:effective.edges,seconds:effective.seconds});
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
  const s=run.state;applySessionMetric(run,8,1);
  // #48 counting correction (unpacked v0.05.1 widget ubergraphs, 2026-11-11):
  // the original increments DefensiveItemsUsed (30) only for types 4/6/7/10/13
  // and OffensiveItemsUsed (31) only for types 9/11/12 — NOT for every item
  // of that classification. Types 1/3/5 increment neither 30 nor 31 (their
  // callees UseReduceHeatItem / UseSlowdownItem / UseBonerPill are retained
  // and call neither UpdateMetric); types 4/6/7 increment 30 (their callees
  // Use Break Item / ToggleSuccuShields / TabbedInventoryResupplyTrigger
  // reach UpdateMetric(30,1) in the unpacked PG1/PG2 ubergraphs). The
  // classification argument is therefore not used for the 30/31 decision.
  if([4,6,7,10,13].includes(type))applySessionMetric(run,30,1);
  else if([9,11,12].includes(type))applySessionMetric(run,31,1);
  const specific={5:27,10:35,11:34,13:39}[type];if(specific)applySessionMetric(run,specific,1);
  // ActivateItem calls ApplyHeatSpellEffect only for types 0, 1, 3, 6, 7 and
  // for Break outside Playlist mode (stmts 30, 42, 53, 74, 91, 102). Escape
  // Rope (10) and Combo Cruncher (13) never call it, and UseEscapeRopeItem's
  // ubergraph flow (entry 71540) only creates a widget, re-enables items and
  // calls SlowStrokeEvent, so the -10 is by type, not by classification.
  if(([0,1,3,6,7].includes(type)||(type===4&&run.config.mode!==2))&&has(run,4))s.heat=clamp(s.heat-10,0,100);
  // Original ActivateItem calls DetermineShouldHotHandsModifierApply for Break only on its Playlist (mode 2) branch.
  if(type!==1&&!(type===4&&run.config.mode!==2)&&s.modifiers.includes('Hot Hands'))s.heat=clamp(s.heat+10,0,heatCap(run));
 }
 function recycler(run){return has(run,17)&&fraction(run)<.25;}
 function advance(run,seconds){
  const s=run.state,e=initialize(run);e.exorcistRemaining=Math.max(0,e.exorcistRemaining-seconds);
  const ticks=Math.floor(s.seconds+seconds)-Math.floor(s.seconds);if(ticks>0&&s.heat>=70)s.TimeAtHighHeat=add(s.TimeAtHighHeat,ticks);
  if(has(run,19)){e.tycoonElapsed+=seconds;const reward=Math.trunc(e.tycoonElapsed/60);if(reward>0){addSuccuCoins(run,reward);e.tycoonElapsed-=60*reward;}}
 }
 // Native RecordSessionMetric jump table (0x1483070c0, v0.05.1 — see
 // docs/parity/evidence/ticket50-producers-native-20261111.md §3): add for
 // most metrics; max for 4/17/18/42/43 (which then tail-call
 // UpdateLifetimeBest — mirrored in progression.js updateChallenges);
 // set for 24 PercentAtHighHeat; no-op for 5/9/15/20/21 (live counters,
 // derived values, or handled by another system — do not invent a session
 // increment for them). Out-of-range ids return.
 const sessionMetricModes={4:'max',5:'noop',9:'noop',15:'noop',17:'max',18:'max',20:'noop',21:'noop',24:'set',42:'max',43:'max'};
 function applySessionMetric(run,metricId,value){
  const field=metricIds[metricId];if(!field)return false;
  const mode=sessionMetricModes[metricId]||'add',s=run.state;
  if(mode==='noop')return false;
  if(mode==='max'){s[field]=Math.max(s[field]||0,value);return true;}
  if(mode==='set'){s[field]=value;return true;}
  s[field]=add(s[field],value);return true;
 }
 // The six settled producers (§1): each wraps UpdateMetricWithConditions
 // with a constant metric id, a value of 1 (or the rounds won), and a
 // zeroed conditions struct (no conditions). Challenge fan-out (§2 phase
 // 3) flows through the existing settlement path: the producer records
 // into run state, sessionMetrics copies the field by name, and
 // updateChallenges fans out by metric id. The §2 phase-2 helper
 // (0x1482f4540, unnamed in the public PDB) is NOT implemented — its name
 // and bool meaning are unestablished. Reset / subtract / combine need
 // the 0x148311f70 helper's semantics (and, for combine, the int
 // parameter's role) — recorded open, not guessed.
 function recordComboCruncherUsed(run){return applySessionMetric(run,39,1);}
 function recordMusicBreakUsed(run){return applySessionMetric(run,44,1);}
 function recordBountyCollectionFailure(run){return applySessionMetric(run,46,1);}
 function recordDisabledBreakSectionFailure(run){return applySessionMetric(run,45,1);}
 function recordTowerWinRounds(run,rounds){if(!Number.isSafeInteger(rounds)||rounds<=0)return false;return applySessionMetric(run,43,rounds);}
 function recordMusicModeWinRounds(run,rounds){if(!Number.isSafeInteger(rounds)||rounds<=0)return false;return applySessionMetric(run,42,rounds);}
 const sourceLedger=['RecoveredRules.cpp: BeatComplete, AddBeatLootReward, AddToLootBar, PrepareDrawState','RecoveredSession.cpp: GetLootIncrement','RecoveredCardDispatch.cpp: RollAndGiveLootDropsV2','RecoveredSuccuEconomy.cpp: catalog, currency, metric/action handlers, timers','RecoveredNewerItemRuntime.cpp: item-use metrics'];
 // Native EMetricType ordinals, full 47-value enum from reJOIce
 // Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json
 // (the older Analysis/native-reflection-enums.json has only 30, 0-29,
 // which is why 30/31/35 looked unresolved).
 const metricIds={0:'Strokes',1:'Edges',2:'SuccubiDefeated',3:'EnemiesDefeated',4:'MaxCombo',5:'StrokeCombo',6:'MissedCumWindows',7:'TimesTaunted',8:'ItemsUsed',9:'AvgStrokesPerEdge',10:'DrawsAtMaxHeat',11:'EarlyClimax',12:'SessionDuration',13:'SessionsCompleted',14:'SessionsWon',15:'TotalXPEarned',16:'MoneySpent',17:'EdgeStreak',18:'ConsecutiveSuccubiSurvived',19:'CumWindowsHit',20:'PerfectRounds',21:'TimesLost',22:'LostToSuccubus',23:'TimeAtHighHeat',24:'PercentAtHighHeat',25:'GamesWithSexToy',26:'PerfectEdges',27:'BonerPillsUsed',28:'AcceptedTemptation',29:'CameDuringTaunt',30:'DefensiveItemsUsed',31:'OffensiveItemsUsed',32:'DeclinedTemptation',33:'BountiesCollected',34:'LootRushesUsed',35:'EscapeRopesUsed',36:'MilkingCount',37:'SuccuSlayerSessionsWon',38:'EdgeSessionsWon',39:'ComboCrunchersUsed',40:'SuccuCoinsSpent',41:'SessionsWonAtMaxDifficulty',42:'BestMusicModeWinRounds',43:'BestTowerWinRounds',44:'MusicBreaksUsed',45:'DisabledBreakSectionFailures',46:'BountyCollectionFailures'};
 const shopIds=[0,1,2,3,4,5,6,7,9,10,11,12,13,16,17,18,19,20,21];
 const api={catalog,shopIds,initialize,has,fraction,heatCap,addHeat,addSuccuCoins,purchase,addBeatCoins,loot,beat,draw,succubusDefeated,itemUsed,recycler,advance,sourceLedger,metricIds,sessionMetricModes,applySessionMetric,recordComboCruncherUsed,recordMusicBreakUsed,recordBountyCollectionFailure,recordDisabledBreakSectionFailure,recordTowerWinRounds,recordMusicModeWinRounds};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceEconomy=api;
})(globalThis);
