(function(root){
 'use strict';
 function check(input){
  const {heatCategory,combo,canSuccubiSpawn=false,shieldToggled,shieldCharges,shieldBlockCount,enhancedPlating,demonProof,exorcistRemaining}=input;
  let charges=shieldCharges;
  let blocks=shieldBlockCount;
  let toggled=shieldToggled;
  let blocked=false;
  if(demonProof||exorcistRemaining>0)return {eligible:false,shieldCharges:charges,shieldBlockCount:blocks,shieldToggled:toggled,blocked};
  if(!canSuccubiSpawn&&charges>0&&toggled){
   blocked=true;
   if(enhancedPlating){
    if(!Number.isInteger(blocks)||blocks<0)throw new TypeError('shieldBlockCount is required for Enhanced Plating');
    if(blocks<1)blocks+=1;
    else {blocks=0;charges-=1;}
   }else charges-=1;
   if(charges<=0)toggled=false;
   return {eligible:false,shieldCharges:charges,shieldBlockCount:blocks,shieldToggled:toggled,blocked};
  }
  return {eligible:heatCategory===0||combo>=2000,shieldCharges:charges,shieldBlockCount:blocks,shieldToggled:toggled,blocked};
 }
 const api={check};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.FanserviceSpawnEligibility=api;
})(typeof window!=='undefined'?window:globalThis);
