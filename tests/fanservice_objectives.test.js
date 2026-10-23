const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../static/fanservice/objectives');
const player=()=>({sessionLength:20,hasCame:false,isAllowedToCum:false});
const stats=()=>({strokes:20,edges:20,milkingCount:20,succubiDefeated:20});
test('Classic source selections retain enum, slider, range and finite save semantics',()=>{
 assert.deepEqual(O.specs.map(s=>s.objective),[0,1,2,3,6,7,8]);
 assert.deepEqual(O.specs.map(s=>O.getSavedTarget({},O.specs.indexOf(s))),[1,300,1000,2,60,2,5]);
 assert.equal(O.getSelectedIndex({LastObjectiveIndex_Classic:2.5}),3);
 for(const value of [NaN,Infinity,-Infinity])assert.equal(O.getSelectedIndex({LastObjectiveIndex_Classic:value}),0);
 for(let i=1;i<O.specs.length;i++){const s=O.specs[i];assert.equal(O.getSavedTarget({[s.saveKey]:-1},i),s.min);assert.equal(O.getSavedTarget({[s.saveKey]:1e9},i),s.max);assert.equal(O.getSavedTarget({[s.saveKey]:NaN},i),s.defaultTarget);}
 assert.equal(O.getSavedTarget({},99),0);
});
test('all source thresholds use baselines, exact boundaries, and inactive gates',()=>{
 for(let i=0;i<O.specs.length;i++){
  const p=player(),s=stats(),state=O.initialize({LastObjectiveIndex_Classic:i},p,s);state.target=10;
  p.sessionLength=29;for(const k of Object.keys(s))s[k]=29;
  assert.equal(O.isComplete(state,p,s,.99),false);
  assert.equal(O.isPrejacExpired(state,p),false);
  p.sessionLength=30;for(const k of Object.keys(s))s[k]=30;
  assert.equal(O.isComplete(state,p,s,1),state.objective!==6);
  assert.equal(O.isPrejacExpired(state,p),state.objective===6);
  state.active=false;assert.equal(O.isComplete(state,p,s,1),false);assert.equal(O.isPrejacExpired(state,p),false);
 }
});
test('miss reset advances previous baseline rather than current overshoot and wraps int32',()=>{
 for(const [objective,key] of [[1,'baselineDuration'],[2,'baselineStrokes'],[3,'baselineEdges'],[8,'baselineSuccubi']]){
  const state={active:true,objective,target:10,[key]:20};assert.deepEqual(O.resetAfterMiss(state,true,.8),{reset:true,meter:.8});assert.equal(state[key],30);
  state[key]=2147483647;state.target=1;O.resetAfterMiss(state,true,.8);assert.equal(state[key],-2147483648);
  state[key]=20;assert.equal(O.resetAfterMiss(state,false,.8).reset,[1,3].includes(objective));
 }
 assert.deepEqual(O.resetAfterMiss({objective:0},false,.8),{reset:true,meter:0});
 for(const objective of [6,7,4,5])assert.equal(O.resetAfterMiss({objective},true,1).reset,false);
});
test('release window opens once, expires at 60 seconds, revokes permission and resets meter',()=>{
 const p=player(),s=stats(),r=new O.Runtime({},p,s);
 assert.equal(r.tick(p,s,1,100)[0].type,'release-window-opened');assert.equal(s.cumWindowsHit,1);assert.equal(p.isAllowedToCum,true);
 assert.deepEqual(r.tick(p,s,1,101),[]);assert.equal(r.releaseDeadline,160);
 assert.deepEqual(r.expireReleaseWindow(p,s,1,159.99),{meter:1,events:[]});
 const expired=r.expireReleaseWindow(p,s,1,160);assert.equal(expired.meter,0);assert.equal(expired.events[0].type,'objective-reset');assert.equal(p.isAllowedToCum,false);assert.equal(s.missedCumWindows,1);
 assert.deepEqual(r.expireReleaseWindow(p,s,1,161).events,[]);
 r.tick(p,s,1,200);r.reset();assert.equal(r.releaseDeadline,null);
});
test('Prejac tick expires at deadline while explicit confirmation at deadline wins',()=>{
 const p=player(),s=stats(),r=new O.Runtime({LastObjectiveIndex_Classic:4,LastObjective_Prejac:30},p,s);
 assert.equal(p.isAllowedToCum,true);p.sessionLength=50;
 assert.equal(r.resolveClimax(p)[0].type,'successful-cum');assert.equal(r.tick(p,s,0,30)[0].type,'premature-cum');
 p.sessionLength=51;assert.equal(r.resolveClimax(p)[0].type,'premature-cum');
 p.hasCame=true;assert.deepEqual(r.tick(p,s,1,31),[]);assert.deepEqual(r.resolveClimax(p),[]);
});
test('Tribute completes directly and disabled stroke reset reaches source success',()=>{
 const p=player(),s=stats(),tribute=new O.Runtime({LastObjectiveIndex_Classic:5},p,s);assert.equal(p.isAllowedToCum,true);
 s.milkingCount=21;assert.deepEqual(tribute.tick(p,s,1,0),[]);s.milkingCount=22;assert.equal(tribute.tick(p,s,0,0)[0].type,'successful-cum');
 const r=new O.Runtime({LastObjectiveIndex_Classic:2,LastObjective_Strokes:100,'DoesNotCummingInWindowResetObjective?':false},p,s);s.strokes=120;
 r.tick(p,s,0,0);assert.equal(r.expireReleaseWindow(p,s,0,60).events[0].type,'successful-cum');
});
test('Tower normal rounds complete directly, boss rounds release, Prejac fails, other modes idle',()=>{
 const p=player(),s=stats(),r=new O.Runtime({},p,s),state={...O.initialize({},p,s),objective:2,target:1};s.strokes++;
 assert.equal(r.tick(p,s,0,0,{mode:1,phase:'playing',state})[0].type,'round-complete');
 assert.equal(r.tick(p,s,0,0,{mode:1,phase:'bossRound',state})[0].type,'release-window-opened');
 assert.equal(r.expireReleaseWindow(p,s,0,60,{mode:1,phase:'bossRound',state}).events[0].type,'objective-reset');assert.equal(state.baselineStrokes,21);
 state.objective=6;state.target=30;p.sessionLength=50;assert.equal(r.tick(p,s,0,0,{mode:1,phase:'playing',state})[0].type,'round-failed');
 p.sessionLength=51;assert.deepEqual(r.resolveClimax(p,{mode:1,phase:'playing',state}),[]);
 assert.deepEqual(r.tick(p,s,1,0,{mode:2}),[]);assert.deepEqual(r.tick(p,s,1,0,{mode:1,phase:'shop',state}),[]);
});
