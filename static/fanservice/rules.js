(function(root){
 'use strict';const f=Math.fround,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
 const thresholds=[100,120,145,175,210,250,300,360,430,515,620,750,910,1100,1330,1600,1920,2300,2750,3300];
 function comboTier(count){const b=[0,100,250,500,750,1250,2000];for(let i=0;i<6;i++)if(count>=b[i]&&count<b[i+1])return i;return 5;}
 function drawMultipliers(tier,count=1,speed=1){const counts=[.8,.8,1,1.25,1.5,1.75,2.25,3],times=[1.4,1.25,1,.95,.85,.8,.75,.6];if(tier<0||tier>7)return null;return {count:counts[tier]*count,time:tier===4?.85:times[tier]*speed};}
 const coinAward=type=>[0,1,2,6,7,8].includes(type)?1:[3,5].includes(type)?2:0;
 function mediaPools(media,options={}){const names=['slow','medium','fast','succubus','cum','ass','boobs'],pools=Object.fromEntries([...names,'video'].map(name=>[name,[]]));let fallback=0;const excluded=(options.excluded||[]).map(tag=>tag.toLowerCase());for(const item of media){const tags=(item.tags||[]).map(tag=>tag.toLowerCase()),has=tag=>tags.includes(tag);if((options.ass||options.boobs||options.feet)&&!((options.ass&&(has('ass')||has('assjob')))||(options.boobs&&(has('boobs')||has('paizuri')))||(options.feet&&(has('feet')||has('footjob')))))continue;if(tags.some(tag=>excluded.includes(tag)))continue;if(item.type?.toLowerCase()==='video'||/\.(mp4|webm|mov|mkv)$/i.test(item.file||''))pools.video.push(item);if(!names.some(has))pools[names[fallback++%5]].push(item);for(const tag of tags)if(names.includes(tag))pools[tag].push(item);}return pools;}
 function xp(stats){let p=((Math.floor(f(f(stats.seconds)*f(1/60))*f(10)))+Math.min(Math.floor(f(f(stats.strokes)*f(.18))),360)+Math.min((stats.enemies||0)+(stats.succubi||0),60))|0;p=Math.trunc(f(f(p)+f(f(stats.edges||0)*f(15))));if(stats.won)p=Math.trunc(f(f(p)+f(60)));let m=1;const mods=(stats.modifiers||[]).map(s=>s.toLowerCase());if(mods.includes('ironman'))m=f(1.2);if(mods.includes('hardcore'))m=f(m+f(.15));return Math.floor(f(f(p)*m));}
 function meter(state){if(state.finished)return state.meter;const mods=state.modifiers||[];if(mods.includes('Hungry Succubi')&&state.card===3)return clamp(state.meter-.002,0,1);if(mods.includes('Sacrificial')||mods.includes('Deal With The Devil')&&state.card!==3)return state.meter;let gain=mods.includes('Mr. Money Bandz')?.000125:state.baseGain;let value=state.meter+gain*(state.meterMultiplier??1);if(state.heat>=80)value+=.00025;if((state.highDraws||0)>=8)value+=.00025;value+=(state.edges||0)/3/2000;if(state.combo>=1500)value+=.00025;value+=Math.trunc(state.seconds/300)/10000;return value;}
 function rewards(profile,stats,sessionId){const next=JSON.parse(JSON.stringify(profile));next.progression??={level:1,xp:0,total_xp:0,coins:0,sessions:0,wins:0,completed_sessions:[]};const p=next.progression;if(p.completed_sessions.includes(sessionId))return next;const earned=xp(stats);p.xp+=earned;p.total_xp+=earned;p.coins+=stats.coins||0;p.sessions++;if(stats.won)p.wins++;while(p.level<20&&p.xp>=thresholds[p.level-1]){p.xp-=thresholds[p.level-1];p.level++;}p.completed_sessions.push(sessionId);return next;}
 const controlChannel=type=>({media_change:'media',text:'text',background:'background',speed_change:'speed',cum_event:'release',disable_break:'break',restore_break:'break'})[type];
 function lowerBound(rows,position){let lo=0,hi=rows.length;while(lo<hi){const middle=(lo+hi)>>>1;if(rows[middle].time<position)lo=middle+1;else hi=middle;}return lo;}
 function timelineState(map,state){
  const cursor=(value,length)=>Number.isSafeInteger(value)&&value>=0?Math.min(value,length):0;
  state.next=cursor(state.next,map.beats.length);state.event=cursor(state.event,map.events.length);
  state.beatFloor=Math.max(cursor(state.beatFloor,map.beats.length),state.next);
  state.eventFloor=Math.max(cursor(state.eventFloor,map.events.length),state.event);
  if(!Number.isFinite(state.last)||state.last<0)state.last=0;
 }
 function seek(map,position,state,callbacks={}){
  if(!Number.isFinite(position)||position<0)return false;
  timelineState(map,state);state.next=lowerBound(map.beats,position);state.event=lowerBound(map.events,position);
  state.beatFloor=Math.max(state.beatFloor,state.next);state.eventFloor=Math.max(state.eventFloor,state.event);state.last=position;
  if(callbacks.reconcile){
   const latest=new Map();for(let index=0;index<state.event;index++){const entry=map.events[index],channel=controlChannel(entry.type);if(channel)latest.set(channel,{entry,index});if(entry.type==='cum_event'&&entry.value==='start')latest.set('media',{entry,index});}
   callbacks.reconcile([...new Map([...latest.values()].map(value=>[value.index,value])).values()].sort((a,b)=>a.index-b.index).map(value=>value.entry));
  }
  return true;
 }
 function schedule(map,position,state,callbacks){
  if(!Number.isFinite(position)||position<0)return;
  timelineState(map,state);
  if(position<state.last-.05||position>state.last+1)seek(map,position,state,callbacks);
  while(state.next<map.beats.length&&map.beats[state.next].time<=position||state.event<map.events.length&&map.events[state.event].time<=position){
   const nextBeat=map.beats[state.next],nextEvent=map.events[state.event];
   if(nextEvent&&nextEvent.time<=position&&(!nextBeat||nextEvent.time<=nextBeat.time)){
    const index=state.event++,replay=index<state.eventFloor;state.eventFloor=Math.max(state.eventFloor,state.event);
    if(!replay||controlChannel(nextEvent.type))callbacks.event(nextEvent,{replay});
   }else{
    const index=state.next++,replay=index<state.beatFloor;state.beatFloor=Math.max(state.beatFloor,state.next);
    if(map.beats[index].type!=='rest'){if(!replay)callbacks.beat(map.beats[index]);else if(callbacks.replayBeat)callbacks.replayBeat(map.beats[index]);}
   }
  }
  state.last=position;
 }

 const api={thresholds,comboTier,drawMultipliers,coinAward,mediaPools,xp,meter,rewards,schedule,seek};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceRules=api;
})(globalThis);
