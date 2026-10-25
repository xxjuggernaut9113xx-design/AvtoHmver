const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rules=require('../static/fanservice/rules.js');
const fixtures=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/fanservice',name+'.json'))).fixtures;
test('mobile media pools match 32 native cases including preferences, exclusions and untagged distribution',()=>{
 const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/fanservice/data/native-contract.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(contract.pool_cases.length,32);
 for(const row of contract.pool_cases){const pools=rules.mediaPools(row.media,row.options);assert.deepEqual(Object.fromEntries(Object.entries(pools).map(([name,media])=>[name,media.map(item=>item.file)])),row.expected);}
});
test('mobile XP matches all 4200 native reconstruction golden fixtures',()=>{
 const rows=fixtures('native-xp-traces');assert.equal(rows.length,4200);
 for(const {stats:s,expected_xp} of rows)assert.equal(rules.xp({seconds:s.SessionDuration,strokes:s.Strokes,edges:s.Edges,enemies:s.EnemiesDefeated,succubi:s.SuccubiDefeated||0,won:s.bWon,modifiers:s.ActiveModifiers}),expected_xp,JSON.stringify(s));
});
test('mobile meter and coin rules match native session traces',()=>{
 for(const row of fixtures('session-rule-traces')){
  const i=row.inputs,w=row.writes;
  if(row.function==='AddtoCumMeteronBeatComplete'){
   const s={finished:i['PlayerVariablesStruct.HasCame?'],meterMultiplier:i['PlayerVariablesStruct.CumMeterMultiplier'],highDraws:i['PlayerVariablesStruct.ConsecutiveHighHeatDraws'],edges:i['PlayerVariablesStruct.TotalEdgeCount'],combo:i['PlayerVariablesStruct.CurrentComboCount'],seconds:i['PlayerVariablesStruct.SessionLength'],card:i.CurrentCardTypeEnum,baseGain:i.BaseCumGain,meter:i.CumMeterPercentage,heat:i['Heat Level'],modifiers:Object.entries(i).filter(([k,v])=>k.startsWith('modifier:')&&v).map(([k])=>k.slice(9))};
   assert.ok(Math.abs(rules.meter(s)-(w.CumMeterPercentage??i.CumMeterPercentage))<1e-12,JSON.stringify(i));
  }
 }
});
test('combo thresholds match native state traces',()=>{for(const row of fixtures('state-rule-traces').filter(r=>r.function==='DetermineComboType')){const i=row.inputs;const key=Object.keys(row.writes).find(k=>/ComboType/i.test(k));if(key)assert.equal(rules.comboTier(i['PlayerVariablesStruct.CurrentComboCount']),row.writes[key]);}});
test('playback clock holds while buffering and seeks skip stale events',()=>{
 const map={beats:[{time:1,type:'stroke'},{time:2,type:'stroke'},{time:3,type:'stroke'}],events:[{time:2,type:'text'}]},clock={next:0,event:0,last:0},hits=[],events=[];
 const cb={beat:b=>hits.push(b.time),event:e=>events.push(e.time)};
 rules.schedule(map,1,clock,cb);rules.schedule(map,1,clock,cb);assert.deepEqual(hits,[1]);
 rules.schedule(map,3,clock,cb);assert.deepEqual(hits,[1,3]);assert.deepEqual(events,[]);
});
test('session rewards survive reload and cannot be granted twice',()=>{const p={version:1,packs:[],unlock_points:5};const stats={seconds:60,strokes:100,edges:0,won:true,coins:100};const once=rules.rewards(p,stats,'session-1'),twice=rules.rewards(JSON.parse(JSON.stringify(once)),stats,'session-1');assert.deepEqual(twice,once);assert.equal(once.progression.sessions,1);assert.equal(once.unlock_points,5);});


test('timeline merges control events before simultaneous beats and keeps source order within each lane',()=>{
 const map={beats:[{time:0,type:'stroke'},{time:.5,type:'stroke'},{time:.5,type:'stroke'}],events:[{time:0,type:'media_change',value:'fast'},{time:.25,type:'text',value:'one'},{time:.5,type:'text',value:'two'}]},clock={},order=[];
 rules.schedule(map,.5,clock,{beat:b=>order.push('beat:'+b.time),event:e=>order.push(e.type+':'+e.value)});
 assert.deepEqual(order,['media_change:fast','beat:0','text:one','text:two','beat:0.5','beat:0.5']);
});

test('backwards seeks never repeat beat rewards or one-shot inventory and dialogue events',()=>{
 const map={beats:[{time:0,type:'stroke'},{time:.5,type:'stroke'},{time:1,type:'stroke'}],events:[{time:.25,type:'grant_break'},{time:.75,type:'dialogue',value:'fixture'}]},clock={},hits=[],events=[];
 const callbacks={beat:b=>hits.push(b.time),event:e=>events.push(e.type)};
 rules.schedule(map,.5,clock,callbacks);rules.schedule(map,1,clock,callbacks);
 rules.seek(map,0,clock,callbacks);rules.schedule(map,.5,clock,callbacks);rules.schedule(map,1,clock,callbacks);
 assert.deepEqual(hits,[0,.5,1]);assert.deepEqual(events,['grant_break','dialogue']);
 const restored=JSON.parse(JSON.stringify(clock));rules.seek(map,0,restored,callbacks);rules.schedule(map,1,restored,callbacks);
 assert.deepEqual(hits,[0,.5,1]);assert.deepEqual(events,['grant_break','dialogue']);
});

test('forward seek skips obsolete rewards permanently and resumes exactly on the target boundary',()=>{
 const map={beats:[{time:0,type:'stroke'},{time:1,type:'stroke'},{time:2,type:'stroke'}],events:[{time:.5,type:'grant_break'},{time:1.5,type:'dialogue'}]},clock={},hits=[],events=[];
 const callbacks={beat:b=>hits.push(b.time),event:e=>events.push(e.type)};
 rules.schedule(map,0,clock,callbacks);rules.seek(map,2,clock,callbacks);rules.schedule(map,2,clock,callbacks);
 rules.seek(map,0,clock,callbacks);rules.schedule(map,1,clock,callbacks);rules.schedule(map,2,clock,callbacks);
 assert.deepEqual(hits,[0,2]);assert.deepEqual(events,[]);
});

test('seek reconciliation restores only latest persistent channels, not skipped grants or speech',()=>{
 const map={beats:[],events:[{time:0,type:'text',value:'old'},{time:.1,type:'disable_break',value:'start'},{time:.2,type:'grant_break'},{time:.3,type:'dialogue',value:'skip'},{time:.4,type:'text',value:'new'},{time:.5,type:'restore_break'},{time:.6,type:'background',value:2}]},clock={},reconciled=[];
 rules.seek(map,.8,clock,{reconcile:events=>reconciled.push(events)});
 assert.deepEqual(reconciled[0],[map.events[4],map.events[5],map.events[6]]);
 rules.seek(map,0,clock,{reconcile:events=>reconciled.push(events)});assert.deepEqual(reconciled[1],[]);
});

test('replayed persistent controls carry a replay flag without reopening the one-shot lane',()=>{
 const map={beats:[],events:[{time:0,type:'cum_event',value:'start'},{time:.5,type:'grant_break'},{time:1,type:'cum_event',value:'end'}]},clock={},events=[];
 const callbacks={beat:()=>{},event:(event,info)=>events.push([event.type,event.value,info.replay])};
 rules.schedule(map,1,clock,callbacks);rules.seek(map,0,clock,callbacks);rules.schedule(map,1,clock,callbacks);
 assert.deepEqual(events,[['cum_event','start',false],['grant_break',undefined,false],['cum_event','end',false],['cum_event','start',true],['cum_event','end',true]]);
});

test('legacy checkpoint cursors become a once-only high-water ledger',()=>{
 const map={beats:[{time:0,type:'stroke'},{time:1,type:'stroke'},{time:2,type:'stroke'}],events:[]},clock={next:2,event:0,last:1},hits=[];
 rules.seek(map,0,clock);rules.schedule(map,1,clock,{beat:b=>hits.push(b.time),event:()=>{}});rules.schedule(map,2,clock,{beat:b=>hits.push(b.time),event:()=>{}});
 assert.deepEqual(hits,[2]);assert.equal(clock.beatFloor,3);
});

test('rest beats and repeated samples cannot mint progression',()=>{
 const map={beats:[{time:0,type:'rest'},{time:.5,type:'stroke'}],events:[]},clock={},hits=[];
 const callbacks={beat:b=>hits.push(b.time),event:()=>{}};
 for(const position of [0,0,.5,.5])rules.schedule(map,position,clock,callbacks);
 assert.deepEqual(hits,[.5]);assert.equal(rules.seek(map,NaN,clock),false);assert.equal(rules.seek(map,-1,clock),false);
});


test('seek preserves release-start media side effects after a later release-end',()=>{
 const map={beats:[],events:[{time:0,type:'media_change',value:'fast'},{time:.1,type:'cum_event',value:'start'},{time:.2,type:'cum_event',value:'end'}]},clock={},reconciled=[];
 rules.seek(map,.3,clock,{reconcile:events=>reconciled.push(events)});
 assert.deepEqual(reconciled[0],[map.events[1],map.events[2]]);
 map.events.push({time:.25,type:'media_change',value:'slow'});rules.seek(map,.3,clock,{reconcile:events=>reconciled.push(events)});
 assert.deepEqual(reconciled[1],[map.events[2],map.events[3]]);
});


test('replayed beats retain visual pulse callbacks without repeating score callbacks',()=>{
 const map={beats:[{time:0,type:'stroke'},{time:.5,type:'rest'},{time:1,type:'stroke'}],events:[]},clock={},hits=[],pulses=[];
 const callbacks={beat:b=>hits.push(b.time),replayBeat:b=>pulses.push(b.time),event:()=>{}};
 rules.schedule(map,1,clock,callbacks);rules.seek(map,0,clock);rules.schedule(map,1,clock,callbacks);
 assert.deepEqual(hits,[0,1]);assert.deepEqual(pulses,[0,1]);
});
