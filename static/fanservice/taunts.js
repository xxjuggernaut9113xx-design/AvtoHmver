(function(root){
 'use strict';
 const load=(name,global)=>typeof module!=='undefined'&&module.exports?require('./'+name+'.js'):root[global];
 const Economy=load('economy','FanserviceEconomy');
 // The Taunt button (reJOIce newer-20261017, UI_Manager ubergraph; the click
 // handler is entry 21921 -> stmt 609 -> Jump 11879 -> stmt 328; the GM side
 // is Taunt() entry 86586 -> stmt 2144 -> Jump 86220 -> stmt 2130, and
 // Firemouth Taunt entry 85708 -> stmt 2113 -> Jump -> stmt 2111).
 // Guard order from the handler: cum card (byte 6), edge card (byte 5),
 // cooldown, already taunted this card. The normal Taunt spawns a fast card
 // event (SpawnCustomCardEvent(FastCards, HighHeat.Min, HighHeat.Max, 0.18,
 // 0.23, byte(2), 0.5, ...), GM stmts 2124-2129), adds TauntHeatAddAmount
 // (class default 25.0), and increments TotalTauntsUsed (GM stmts 2091-2093)
 // after a random FrenzyBeatPattern + StartPatternWithMediaSync, dialogue
 // struct 1 + voiceline, and Change Beat Background(8) (stmts 2087-2099).
 // During a succubus card (byte 3) the taunt instead applies
 // ApplyStrokeCountModifier(4) / ApplySpeedModifier(5.0) to the current card
 // and stops there: no new card, no heat, no TotalTauntsUsed increment
 // (GM stmts 2118-2122). Firemouth (HasSuccuModifier(15)) adds 50 heat and
 // summons a succubus (GM stmts 2100-2110 -> 2085-2083) instead of the fast
 // card. Both paths call UpdateMetric(7, 1) (GM stmts 2130 and 2111), so the
 // EMetricType::TimesTaunted challenge metric counts every taunt while
 // TotalTauntsUsed — the RollPunishmentChance input — counts normal taunts
 // only. The two counters are therefore kept separate in run.state.
 // StartTauntCooldown (GM 86419 -> stmt 2136 -> Jump 86286 -> stmt 2132)
 // sets TauntCooldownTimerDuration to its class default 5.0 and a 1-second
 // looping timer (K2_SetTimerDelegate interval 1.0, looping) ticks it down
 // by 1.0 until it clears IsTauntOnCooldown? (TauntCooldown, GM 86424 ->
 // stmt 2137). The player models that as tauntCooldownUntil in session
 // seconds. HasTaunted? resets on each new card determination unless the
 // player has already came (DetermineCardV2 stmt 15, reached when
 // !HasCame?); run.startCard is that seam.
 // NOT modeled, with the reason: AddToCumMeter(TauntCumAdd) — the field
 // exists but its default value is not in the retained evidence (the
 // UI_Manager CDO lives in the cooked packages); the +4/+5.0 current-card
 // modifiers — native BeatSpawnerManagerCPP calls with no retained body, so
 // add-vs-set-vs-multiply is unknown; AddPermanentSuccubusWeight — no player
 // counterpart; the dialogue struct 1 voiceline — its lines live in the
 // cooked data tables; the SpawnCustomCardEvent seventh parameter (0.5 for
 // the taunt card, 1.0 for the punishment card) — the parameter names are
 // not retained in SpawnCustomCardEvent.json.
 const cooldownSeconds=5,heatAdd=25,firemouthHeatAdd=50,temptingFateAt=5;
 const spawnParams=Object.freeze({pool:'fast',cardType:2,minInterval:0.18,maxInterval:0.23,background:'tauntbackground',notificationTitle:'Taunt',notificationBody:'Increased Stroke Speed & Count'});
 function cooldownRemaining(run){return Math.max(0,(run.state.tauntCooldownUntil||0)-run.state.seconds);}
 function guard(run){
  if(!run||run.phase!=='playing'||run.state.finished)return {reason:'not-playing'};
  if(run.state.card===6)return {reason:'cum'};
  if(run.state.card===5)return {reason:'edge'};
  const remaining=cooldownRemaining(run);
  if(remaining>0)return {reason:'cooldown',seconds:Math.trunc(remaining)};
  if(run.state.hasTaunted)return {reason:'already'};
  return null;
 }
 function isFiremouth(run){return Economy.has(run,15)||(run.state.modifiers||[]).includes('Firemouth');}
 function taunt(run){
  const blocked=guard(run);if(blocked)return {ok:false,...blocked};
  const s=run.state;
  // EMetricType::TimesTaunted (7): both taunt paths increment it (GM stmts
  // 2130 and 2111). TotalTauntsUsed increments on the normal path only.
  s.TimesTaunted=((s.TimesTaunted||0)+1)|0;
  if(s.card===3){
   // Succubus card: the current-card modifiers and the permanent succubus
   // weight are not modeled (see the header note). No new card, no heat, no
   // TotalTauntsUsed increment.
   s.hasTaunted=true;s.tauntCooldownUntil=s.seconds+cooldownSeconds;
   return {ok:true,branch:'succubus',taunts:s.TimesTaunted,totalTaunts:s.TotalTauntsUsed||0,temptingFate:false};
  }
  if(isFiremouth(run)){
   Economy.addHeat(run,firemouthHeatAdd);
   run.startCard('succubus');
   Economy.draw(run);
   s.hasTaunted=true;s.tauntCooldownUntil=s.seconds+cooldownSeconds;
   return {ok:true,branch:'firemouth',taunts:s.TimesTaunted,totalTaunts:s.TotalTauntsUsed||0,temptingFate:false};
  }
  Economy.addHeat(run,heatAdd);
  run.startCard('fast',{taunt:true});
  Economy.draw(run);
  s.TotalTauntsUsed=((s.TotalTauntsUsed||0)+1)|0;
  // The flags are set after the spawn: run.startCard resets hasTaunted for
  // ordinary draws (the DetermineCardV2 seam), and the original's spawn path
  // never resets it, so the taunt re-asserts them here.
  s.hasTaunted=true;s.tauntCooldownUntil=s.seconds+cooldownSeconds;
  return {ok:true,branch:'normal',taunts:s.TimesTaunted,totalTaunts:s.TotalTauntsUsed,temptingFate:s.TotalTauntsUsed===temptingFateAt};
 }
 const sourceLedger=['UI_Manager ubergraph stmts 328-348 + 55-75 + 170-260: TauntButton click guards, notifications, Firemouth(15) and succubus branches','BP_GlobalManager ubergraph stmts 2083-2099 + 2100-2144: Taunt() and Firemouth Taunt flows, TotalTauntsUsed increment, UpdateMetric(7, 1) at stmts 2111 and 2130','BP_GlobalManager ubergraph stmts 1722-1724 + 1896-1899 + 2132-2143: 5.0s cooldown, 1s looping timer tick','BP_DrawManager DetermineCardV2 stmt 15: HasTaunted? reset per card unless HasCame','BP_GlobalManager_C class defaults: TauntHeatAddAmount 25.0, TauntCooldownTimerDuration 5.0'];
 const api={cooldownSeconds,heatAdd,firemouthHeatAdd,temptingFateAt,spawnParams,guard,taunt,isFiremouth,cooldownRemaining,sourceLedger};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceTaunts=api;
})(globalThis);
