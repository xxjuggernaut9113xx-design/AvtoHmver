(function(root){
 'use strict';
 function project(times,now,options={}){
  const lead=Number.isFinite(options.lead)&&options.lead>0?options.lead:3;
  const trail=Number.isFinite(options.trail)&&options.trail>=0?options.trail:.25;
  const requested=Number.isFinite(options.limit)?Math.floor(options.limit):64;
  const limit=Math.max(0,Math.min(64,requested)),result=[];
  if(!Array.isArray(times)||!Number.isFinite(now)||limit===0)return result;
  for(const time of times){
   if(!Number.isFinite(time))continue;
   const delta=time-now;if(delta>lead||delta< -trail)continue;
   result.push({time,x:50-delta/lead*50});
   if(result.length>=limit)break;
  }
  return result;
 }
 function cardTimes(flow){
  if(!flow||!Number.isFinite(flow.started)||!Array.isArray(flow.queue))return [];
  const result=[];
  for(const entry of flow.queue){
   if(!entry||!Number.isFinite(entry.CustomMultiplier)||entry.CustomMultiplier<0||!Number.isFinite(entry.TargetHitTime))continue;
   const time=flow.started+entry.TargetHitTime;if(Number.isFinite(time))result.push(time);
  }
  return result;
 }
 const api={project,cardTimes};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.FanserviceBeatLane=api;
})(globalThis);
