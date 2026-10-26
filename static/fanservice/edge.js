(function(root){
 'use strict';
 const load=(name,global)=>typeof module!=='undefined'&&module.exports?require('./'+name+'.js'):root[global];
 const Cards=load('cards','FanserviceCards'),Economy=load('economy','FanserviceEconomy');
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),add=(a,b)=>((a||0)+b)|0;
 function state(run){return run.state.edge??={version:1,phase:'idle',streak:0,bank:0,lastCount:25,lastInterval:1,strokeMultiplier:1.1,breakScaled:1,postBreak:1,masterUntil:5,until:5,wasEdgeCard:false,perfect:false,ratio:0,strokesPerEdge:[]};}
 function active(run){return !!run.state.edge&&run.state.edge.phase!=='idle';}
 function allowed(run){const e=run.state.edge;return run.config.mode!==2&&!!run.config.cardRules&&run.phase==='playing'&&!run.state.finished&&!run.player.hasCame&&(!e||['idle','sequence'].includes(e.phase));}
 function beginCard(run,at){
  const e=state(run);run.state.card=5;Economy.draw(run);Cards.start(run,'edge',{at});run.state.canUseItems=false;e.phase='sequence';e.wasEdgeCard=true;e.deadline=null;
  return [{type:'edge-card-started'}];
 }
 function trigger(run){
  if(!allowed(run))return [];
  const e=state(run),s=run.state,flow=s.cardFlow,devil=s.modifiers.includes('Deal With The Devil');e.perfect=false;e.ratio=0;
  if(!e.wasEdgeCard){e.lastCount=25;e.breakScaled=10;e.until=e.masterUntil;e.postBreak=1.75;}
  else{
   e.lastCount=Math.max(0,(flow?.assigned||0)-(flow?.remaining||0));
   e.ratio=flow?.assigned>0?e.lastCount/flow.assigned:0;e.perfect=e.ratio>=.85;
   if(!devil)s.meter+=e.perfect?.08:.05;
   e.bank=add(e.bank,e.perfect?50:30);if(e.perfect)s.PerfectEdges=add(s.PerfectEdges,1);
   e.breakScaled=clamp(e.breakScaled-e.breakScaled*(.05+run.random.fraction()*.05),1,30);
  }
  s.edges=add(s.edges,1);e.streak=add(e.streak,1);s.EdgeStreak=e.streak;s.LastEdgeTime=s.seconds;e.wasEdgeCard=true;e.strokesPerEdge.push(s.combo);
  s.canUseItems=false;e.postBreak=clamp(e.postBreak+Math.trunc(e.streak/5),1,8);e.holdRemaining=Math.trunc(e.postBreak);
  e.phase='handoff';e.deadline=s.seconds+(e.postBreak>=2?.9:1);Cards.extendForEdge(run);
  return [{type:'edge-recorded',perfect:e.perfect,ratio:e.ratio,streak:e.streak}];
 }
 function completeBreak(run,at){
  const e=state(run),flow=run.state.cardFlow,events=Cards.advance(run,at);if(flow)flow.suspended=true;
  if(e.until<=1){e.phase='mercy';run.state.card=5;e.deadline=null;events.push({type:'mercy-opened'});}
  else{e.until--;e.phase='rest';e.deadline=at+Math.max(e.breakScaled,.01);events.push({type:'edge-rest-started',seconds:e.breakScaled});}
  return events;
 }
 function advance(run){
  const e=run.state.edge,now=run.state.seconds,events=[];if(!e||run.phase!=='playing'||run.state.finished)return events;
  if(e.phase==='handoff'&&now>=e.deadline){
   if(e.postBreak>=2&&!e.perfect){e.phase='hold';e.nextTick=e.deadline;}
   else events.push(...completeBreak(run,e.deadline));
  }
  if(e.phase==='hold'){
   if(run.state.card===6&&now>=e.nextTick)e.nextTick+=Math.floor(now-e.nextTick)+1;
   while(e.phase==='hold'&&now>=e.nextTick){const at=e.nextTick;e.nextTick++;e.holdRemaining--;if(e.holdRemaining<=0)events.push(...completeBreak(run,at));}
  }
  if(e.phase==='rest'&&now>=e.deadline)events.push(...beginCard(run,e.deadline));
  else if(e.phase==='mercy-rest'&&now>=e.deadline){e.phase='idle';e.wasEdgeCard=false;e.deadline=null;events.push({type:'edge-streak-ended',requestNextCard:true});}
  return events;
 }
 function continueRest(run){
  const e=run.state.edge;if(!e||run.phase!=='playing'||run.state.finished)return [];
  if(e.phase==='rest')return beginCard(run,run.state.seconds);
  if(e.phase==='mercy-rest'){e.phase='idle';e.wasEdgeCard=false;e.deadline=null;return [{type:'edge-streak-ended',requestNextCard:true}];}
  return [];
 }
 function mercy(run,accept){
  const e=run.state.edge;if(!e||e.phase!=='mercy'||run.phase!=='playing'||run.state.finished||typeof accept!=='boolean')return [];
  if(!accept){e.masterUntil=Math.trunc(e.masterUntil*1.25);e.until=e.masterUntil;return [{type:'mercy-declined'},...beginCard(run,run.state.seconds)];}
  run.state.heat=0;run.state.meter+=.01;const earned=Economy.addBeatCoins(run,e.bank);e.bank=0;e.phase='mercy-rest';e.deadline=run.state.seconds+60;
  return [{type:'mercy-accepted',earned,seconds:60}];
 }
 function cancel(run){const e=run.state.edge;if(!e)return;e.phase='idle';e.deadline=null;e.nextTick=null;e.wasEdgeCard=false;if(run.state.cardFlow)run.state.cardFlow.suspended=true;}
 const sourceLedger=['RecoveredSessionWidget.cpp: E direct action in newer mode, excludes music','BP_EdgeManager TriggerEdgeV2: entry3675 / ExecuteUbergraph','RecoveredEdgeManager.cpp: ratio .85, bank30/50, handoff .9/1, hold timer, rest/mercy','RecoveredEdgeRestWidget.cpp / RecoveredMercyRestWidget.cpp: G cancel, 60-second Mercy rest','MercyEventWidget bytecode: UpdateMasterEdgeCount&Set then EdgingEventV2'];
 const api={state,active,allowed,trigger,advance,continueRest,mercy,cancel,sourceLedger};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceEdge=api;
})(globalThis);
