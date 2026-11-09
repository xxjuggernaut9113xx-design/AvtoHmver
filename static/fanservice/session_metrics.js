(function(root){
 'use strict';
 const metricForObjective={1:'sessionLength',2:'strokes',3:'edges',7:'milkingCount',8:'succubi'};
 function resetObjective(run){
  const state=run.state,objective=run.roundObjective||run.objective?.state;
  state.metricResetOffsets??={};
  state.coins=0;
  if(!objective)return;
  if(objective.objective===0){state.meter=0;return;}
  const metric=metricForObjective[objective.objective];
  if(!metric)return;
  const raw=metric==='sessionLength'?(state.seconds??run.player.sessionLength??0):(state[metric]??0);
  state.metricResetOffsets[metric]=raw;
  const baseline={sessionLength:'baselineDuration',strokes:'baselineStrokes',edges:'baselineEdges',milkingCount:'baselineMilking',succubi:'baselineSuccubi'}[metric];
  objective[baseline]=0;
 }
 function effective(state,player={}){
  const offsets=state.metricResetOffsets||{};
  const result={...state};
  for(const metric of ['strokes','edges','milkingCount','succubi'])result[metric]=Math.max(0,(state[metric]||0)-(offsets[metric]||0));
  result.seconds=Math.max(0,(state.seconds||0)-(offsets.sessionLength||0));
  result.sessionLength=Math.max(0,(state.seconds??player.sessionLength??0)-(offsets.sessionLength||0));
  return result;
 }
 const api={resetObjective,effective};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceSessionMetrics=api;
})(globalThis);
