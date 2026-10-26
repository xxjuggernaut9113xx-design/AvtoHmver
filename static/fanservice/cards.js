(function(root){
 'use strict';
 const load=(name,global)=>typeof module!=='undefined'&&module.exports?require('./'+name+'.js'):root[global];
 const Rules=load('rules','FanserviceRules'),Modifiers=load('modifiers','FanserviceModifiers'),Economy=load('economy','FanserviceEconomy');
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),limit=1000000;
 function timing(strokes,interval,count,userCount,time){
  if(![strokes,interval,count,userCount,time].every(Number.isFinite))throw Error('Card timing is invalid.');
  const result={count:Math.trunc(strokes*(count*userCount))||0,interval:clamp(interval*time,.28,5)};
  if(!Number.isSafeInteger(result.count)||result.count>limit)throw Error('Card count exceeds the supported sequence limit.');
  return result;
 }
 function queue(pattern,interval,count,speed,travel,minimum){
  if(!Array.isArray(pattern)||!pattern.length||pattern.some(n=>!Number.isFinite(n))||!pattern.some(n=>n>=0))throw Error('Card pattern requires a finite stroke interval.');
  if(!Number.isSafeInteger(count)||count<0||count>limit||![interval,speed,travel,minimum].every(Number.isFinite)||speed<=0||minimum<=0)throw Error('Card queue timing is invalid.');
  const result=[];let hit=travel,completed=0,index=0;
  while(completed<count){
   if(result.length>=limit)throw Error('Card pattern exceeds the supported sequence limit.');
   const multiplier=Math.fround(pattern[index]),duration=Math.max((1/speed)*(Math.abs(multiplier)*interval),minimum);
   result.push({AbsoluteFireTime:hit-travel,TargetHitTime:hit,PatternIndex:index,Interval:duration,BeatNumber:result.length+1,CustomMultiplier:multiplier});
   hit+=duration;if(multiplier>=0)completed++;index=(index+1)%pattern.length;
  }
  return result;
 }
 function current(run){return run.state.cardFlow;}
 function start(run,pool,options={}){
  const data=run.config.cardRules,s=run.state;if(!data||run.config.mode===2)return null;
  const card={slow:0,medium:1,fast:2,succubus:3,cum:6,ass:7,boobs:8,edge:5}[pool];if(card===undefined)throw Error('Unsupported card pool.');
  const difficulty=run.config.difficulty??1,multipliers=Rules.drawMultipliers(Rules.comboTier(s.combo),data.difficulty_count[difficulty],data.difficulty_speed[difficulty]);
  let count=multipliers.count,time=multipliers.time,travel=data.travel,bank=pool,min,max,low,high;
  if(card<=2){const row=data.heat[['SlowHeat','MediumHeat','HighHeat'][card]];min=row.MinStrokeCount;max=row.MaxStrokeCount;low=card===2?.15:row.MinIntervalSeconds;high=row.MaxIntervalSeconds;}
  else if(card===3){min=30;max=50;low=.15;high=.33;time=1;travel=1.5;count=Modifiers.succubusCountMultiplier(count,s.succubi,s.modifiers,Economy.has(run,7)?.5:1);}
  else if(card===5){
   const edge=s.edge;if(!edge)throw Error('Edge timing requires an active streak.');
   edge.strokeMultiplier+=.1+run.random.fraction()*.15;
   edge.lastInterval=clamp(edge.lastInterval-(.01+run.random.fraction()*.01)*(run.config.edgePacingMultiplier??1),.15,1);
   const intervalRoll=.8+run.random.fraction()*.45,countRoll=.8+run.random.fraction()*.45,base=Math.trunc(edge.lastCount*edge.strokeMultiplier);
   max=clamp(base,15,60);min=clamp(Math.trunc(base*countRoll),15,60);high=edge.lastInterval;low=edge.lastInterval*intervalRoll;count=time=1;bank='medium';
  }
  else if(card===6){min=75;max=100;low=.28;high=.35;travel=1.5;bank='fast';}
  else{const row=data.heat.HighHeat;min=row.MinStrokeCount;max=row.MaxStrokeCount;low=.15;high=row.MaxIntervalSeconds;bank='frenzy';}
  const result=timing(run.random.range(min,max),low+run.random.fraction()*(high-low),count,run.config.userCountMultiplier??1,time);
  const patterns=data.patterns[bank];if(!Array.isArray(patterns)||!patterns.length)throw Error('Card pattern bank is unavailable.');
  let pattern=[...patterns[run.random.range(0,patterns.length-1)]];
  const previous=current(run),previousInterval=previous?.queue[previous.nextFire]?.Interval??0;if(Math.fround(previousInterval)<=.2)pattern=pattern.map(value=>Math.fround(value)>=2?2.5:value);
  const baseInterval=result.interval*(Economy.has(run,6)?2:1),minimum=data.minimum_intervals[difficulty],entries=queue(pattern,baseInterval,Math.max(0,result.count),1,travel,minimum);
  s.card=card;s.cardFlow={generation:(previous?.generation||0)+1,pool,card,started:options.at??s.seconds,pattern,interval:baseInterval,speed:1,travel,minimum,assigned:result.count,remaining:result.count,nextFire:0,nextHit:0,completed:0,queue:entries,ended:false};
  return s.cardFlow;
 }
 function advance(run,at=run.state.seconds){
  const flow=current(run),s=run.state,events=[];if(!flow||flow.ended||flow.suspended||run.phase!=='playing'||s.finished)return events;
  const elapsed=at-flow.started;
  while(flow.nextFire<flow.queue.length&&flow.queue[flow.nextFire].AbsoluteFireTime<=elapsed)flow.nextFire++;
  while(flow.nextHit<flow.nextFire&&flow.queue[flow.nextHit].TargetHitTime<=elapsed){
   const entry=flow.queue[flow.nextHit++];if(entry.CustomMultiplier<0)continue;
   events.push(...Economy.beat(run),{type:'card-beat',time:entry.TargetHitTime+flow.started});flow.completed++;flow.remaining=Math.max(0,flow.assigned-flow.completed);
  }
  if(flow.remaining===0&&flow.nextHit>=flow.queue.length){
   flow.ended=true;s.canUseSlowdown=s.canUseBonerPill=true;
   if(flow.card===3){s.succubi=((s.succubi||0)+1)|0;s.ConsecutiveSuccubiSurvived=((s.ConsecutiveSuccubiSurvived||0)+1)|0;events.push({type:'encounter-defeated',reward:Economy.succubusDefeated(run,1)});}
   else{s.enemies=((s.enemies||0)+1)|0;s.ConsecutiveSuccubiSurvived=0;}
   events.push({type:'card-complete',pool:flow.pool,requestNextCard:flow.card!==5});
  }
  return events;
 }
 function rebuild(run,speed,factor=1,maxFireTime=null){
  const flow=current(run);if(!flow||flow.ended||flow.nextFire>=flow.queue.length||!Number.isFinite(speed)||speed<=0||!Number.isSafeInteger(factor)||factor<=0)return false;
  const future=(flow.queue.length-flow.nextFire)*factor;if(future>limit||flow.nextFire+future>limit)return false;
  const next=flow.queue.slice(0,flow.nextFire);let index=flow.queue[flow.nextFire]?.PatternIndex||0,fire=run.state.seconds-flow.started+.1;
  for(let n=0;n<future;n++){
   if(maxFireTime!==null&&fire>maxFireTime)break;
   const multiplier=Math.fround(flow.pattern[index]),duration=Math.max(Math.abs(multiplier)*flow.interval*(1/speed),flow.minimum);
   next.push({AbsoluteFireTime:fire,TargetHitTime:fire+flow.travel,PatternIndex:index,Interval:duration,BeatNumber:next.length+1,CustomMultiplier:multiplier});fire+=duration;index=(index+1)%flow.pattern.length;
  }
  flow.queue=next;flow.speed=speed;flow.generation++;if(factor!==1){
   if(maxFireTime===null)flow.assigned=next.reduce((count,entry)=>count+(entry.CustomMultiplier>=0?1:0),0);
   else{
    const startIndex=flow.queue[flow.nextFire]?.PatternIndex||0,perCycle=flow.pattern.filter(n=>n>=0).length,cycles=Math.floor(future/flow.pattern.length),remainder=future%flow.pattern.length;
    let strokes=next.slice(0,flow.nextFire).filter(entry=>entry.CustomMultiplier>=0).length+cycles*perCycle;
    for(let n=0;n<remainder;n++)if(flow.pattern[(startIndex+n)%flow.pattern.length]>=0)strokes++;
    flow.assigned=strokes;
   }
   flow.remaining=Math.max(0,flow.assigned-flow.completed);
  }return true;
 }
 function delay(run,seconds){const flow=current(run);if(!flow||flow.ended||!Number.isFinite(seconds)||seconds<0)return false;flow.started+=seconds;return true;}
 function extendForEdge(run){const flow=current(run);return !!flow&&rebuild(run,flow.speed,999,run.state.seconds-flow.started+9);}
 function remaining(run){return Math.max(0,current(run)?.remaining??0);}
 const sourceLedger=['retained v0.04 CDO pattern banks and heat rows','SpawnCustomCardEvent numeric traces (128)','native BuildBeatQueue 0x1481d02a0 (186 queue traces)','RecoveredRules.cpp: CompleteBeatSequence','RecoveredSuccuEconomy.cpp: HandleMetric(SuccubiDefeated)'];
 const api={timing,queue,start,advance,rebuild,delay,extendForEdge,remaining,sourceLedger};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceCards=api;
})(globalThis);
