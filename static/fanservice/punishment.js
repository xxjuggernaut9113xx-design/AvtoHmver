(function(root){
 'use strict';
 // RollPunishmentChance (reJOIce newer-20261017, functions/BP_GlobalManager/
 // RollPunishmentChance.json): rate = (TotalTauntsUsed / 5, integer division)
 // * 20, printed as "Risk of Punishment: {float}", then the "Roll Chance
 // (0-100%)" helper decides WasPunishmentTriggered. The helper's own
 // comparison (< vs <=) is not in the retained ASTs; with a continuous
 // 0-100 roll the boundary is unobservable, so this uses <.
 function rate(taunts){
  if(!Number.isFinite(taunts)||taunts<=0)return 0;
  return Math.trunc(taunts/5)*20;
 }
 function roll(taunts,random){
  if(!random||typeof random.fraction!=='function')return false;
  return random.fraction()*100<rate(taunts);
 }
 // SpawnPunishmentEvent (GM ubergraph stmts 1440-1460):
 // SpawnCustomCardEvent(SuccubusCards, 30, 50, 0.28, 0.33, byte(3), 1.0,
 // Stroke Count Multiplier, SlateBrush, StrokeInterval),
 // CurrentCardTypeEnum = byte(3), Change Beat Background(8), "Punishment"
 // notification "Your boasts have consequences." The 8th parameter is the
 // "Stroke Count Multiplier" instance variable, which cards.js already
 // applies to succubus cards as succubusCountMultiplier; the SlateBrush and
 // StrokeInterval are computed locals whose player counterparts are the
 // succubus media pick and the card interval. Background 8 is
 // 'tauntbackground' (HandleBackGroundChange maps that name to byte 8).
 const spawnParams=Object.freeze({pool:'succubus',cardType:3,minStrokes:30,maxStrokes:50,minInterval:0.28,maxInterval:0.33,timeMultiplier:1,travel:1.5,background:'tauntbackground',notificationTitle:'Punishment',notificationBody:'Your boasts have consequences.'});
 const sourceLedger=['RollPunishmentChance.json: (TotalTauntsUsed/5 integer division)*20, "Risk of Punishment: {float}", "Roll Chance (0-100%)"','ExecuteUbergraph_BP_GlobalManager stmts 1440-1460: SpawnCustomCardEvent(SuccubusCards, 30, 50, 0.28, 0.33, byte(3), 1.0, ...), CurrentCardTypeEnum=3, CanUseItems=false, Change Beat Background(8), "Punishment" / "Your boasts have consequences.", PlayMusic(3)','HandleBackGroundChange: tauntbackground maps to byte 8','UI_Manager ubergraph stmts 66-68: TotalTauntsUsed==5 shows "Tempting Fate" / "Your taunts drew her ire. Items may trigger punishment."'];
 const api={rate,roll,spawnParams,sourceLedger};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanservicePunishment=api;
})(globalThis);
