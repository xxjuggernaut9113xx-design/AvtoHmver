(function(root){
 'use strict';
 // Heat selects a modifier column; weighted selection chooses the event.
 function heatBand(state){
  const heat=state?.heat;
  if(!Number.isFinite(heat)||heat<0||heat>100)throw new RangeError('Run heat must be finite and between 0 and 100.');
  return heat<=30?'slow':heat<=70?'medium':'fast';
 }
 const clamp=value=>Math.max(0,Math.min(100,value));
 const comboKeys=['F','D','C','B','A','S'];
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
 const api={heatBand,weightedEvents};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceMediaSelection=api;
})(globalThis);
