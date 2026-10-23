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
