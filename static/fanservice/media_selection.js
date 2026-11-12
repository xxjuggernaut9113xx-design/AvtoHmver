(function(root){
 'use strict';
 // Heat selects a modifier column; weighted selection chooses the event.
 function heatBand(state){
  const heat=state?.heat;
  if(!Number.isFinite(heat)||heat<0||heat>100)throw new RangeError('Run heat must be finite and between 0 and 100.');
  return heat<=30?'slow':heat<=70?'medium':'fast';
 }
 const clamp=value=>Math.max(0,Math.min(100,value));
 const clampRange=(value,low,high)=>Math.max(low,Math.min(high,value));
 const comboKeys=['F','D','C','B','A','S'];
 // `eligibleSpecialEvents` mirrors BP_GlobalManager
 // CheckEventConditions&ReturnArray (cooked v0.05.1 package, export 60,
 // 88 stmts, 0 errors): it walks the SpecialEventDataTable rows in order
 // and appends the eligible ones, and DetermineCardV2 (BP_DrawManager)
 // then runs AdjustHeatLevelWeights, AdjustComboLevelWeights and
 // ChooseWeightedEventFromArray over that list. `state.totalDraws` is the
 // native TotalDrawCount at check time — already incremented for this
 // draw (DetermineCardV2 increments it before the check). The caller
 // supplies the gates this module cannot see (Succubus / frenzy /
 // favorite eligibility live in spawn_eligibility and favorites), and
 // the cooldown / shop counters, which default to the native initial
 // state (not on cooldown, zero) when the caller does not carry them.
 function eligibleSpecialEvents(rows,state){
  if(!Array.isArray(rows))throw new TypeError('Special event rows are required.');
  const heat=state?.heat;
  if(!Number.isFinite(heat)||heat<0||heat>100)throw new RangeError('Run heat must be finite and between 0 and 100.');
  const totalDraws=Number.isFinite(state?.totalDraws)?state.totalDraws:0;
  const coins=Number.isFinite(state?.coins)?state.coins:0;
  const timeSinceLastShop=Number.isFinite(state?.timeSinceLastShop)?state.timeSinceLastShop:0;
  const storeChanceMultiplier=Number.isFinite(state?.storeChanceMultiplier)?state.storeChanceMultiplier:0;
  const out=[];
  for(const row of rows){
   const code=Number(row?.eventCode),base=Number(row?.baseWeight);
   if(!Number.isInteger(code)||!Number.isFinite(base))throw new TypeError('Event weight data is invalid.');
   switch(code){
    case 0:case 1:case 2:
     // Slow / medium / fast append with no check.
     out.push(row);break;
    case 4:
     // TemptationEligibilityCheck: TotalDrawCount > 1, not on cooldown,
     // Heat <= 35.0.
     if(totalDraws>1&&!state?.temptationOnCooldown&&heat<=35)out.push(row);
     break;
    case 5:
     if(state?.succubusEligible)out.push(row);
     break;
    case 6:
     // Mercy is never appended: the native case calls
     // MercyEligibilityCheck and then PopExecutionFlowIfNot(EX_False) —
     // a constant false — so the branch always pops before the append.
     break;
    case 7:
     if(state?.assFrenzyEligible)out.push(row);
     break;
    case 8:
     if(state?.boobFrenzyEligible)out.push(row);
     break;
    case 11:
     // StoreEventCheck: Classic only (GameModeSelection 0), not on
     // cooldown, PlayerCoins >= 200. The appended row carries the
     // AdjustStoreWeight base weight: (BaseWeight + 1) * clamp(
     // StoreChanceMultiplier + clamp(TimeSinceLastShop/60*0.04, 0, 2) +
     // floor(PlayerCoins/250)*0.08, 1, 5). The raw table base applies
     // here — heat/combo weights are added later by weightedEvents.
     if(state?.mode===0&&!state?.storeOnCooldown&&coins>=200){
      const multiplier=clampRange(storeChanceMultiplier+clampRange(timeSinceLastShop/60*.04,0,2)+Math.floor(coins/250)*.08,1,5);
      out.push({...row,baseWeight:(base+1)*multiplier});
     }
     break;
    case 12:
     if(state?.favoriteFrenzyEligible)out.push(row);
     break;
    default:
     // CoinFlip (3), FeetFrenzy (9), BossSpawn (10) and any unknown
     // code have no case in the native switch and are never appended.
     break;
   }
  }
  return out;
 }
 // `rows` is the caller's eligible event list, in native candidate order.
 function weightedEvents(rows,state,fraction){
  const pool=heatBand(state),tier=state?.comboTier;
  if(!Array.isArray(rows)||!Number.isInteger(tier)||tier<0||tier>7||!Number.isFinite(fraction)||fraction<0||fraction>1)
   throw new RangeError('Valid eligible rows, combo tier, and random fraction are required.');
  const weighted=rows.map(row=>{
   const base=Number(row.baseWeight),heat=Number(row.heat?.[pool]),combo=tier<6?Number(row.combo?.[comboKeys[tier]]):0;
   if(!Number.isFinite(base)||!Number.isFinite(heat)||!Number.isFinite(combo))throw new TypeError('Event weight data is invalid.');
   return {row,weight:clamp(clamp(base+heat)+combo)};
  });
  const total=weighted.reduce((sum,event)=>sum+event.weight,0);
  if(total<=0)return null;
  const value=fraction*total;
  let cumulative=0;
  for(const event of weighted){cumulative+=event.weight;if(cumulative>value)return event.row;}
  return null;
 }
 const api={heatBand,weightedEvents,eligibleSpecialEvents};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceMediaSelection=api;
})(globalThis);
