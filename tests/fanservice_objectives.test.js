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
test('release window carries the original 60 s CumWindowTime and notification text',()=>{
 // CumEventOverride decode (GM ubergraph, 2026-11-11): Start Cum Window
 // Timer notifies 'Cum Meter Filled' / '60s Release Window\r\nFinish to
 // Win' and Set and Display Cum Window Timer (re)initializes CumWindowTime
 // = 60.0. The 60 s is a constant in the original, not a per-map window.
 const p=player(),s=stats(),r=new O.Runtime({},p,s);
 const event=r.tick(p,s,1,100)[0];
 assert.equal(event.type,'release-window-opened');
 assert.equal(event.seconds,60);
 assert.equal(event.notification,'60s Release Window\nFinish to Win');
 assert.equal(r.releaseDeadline,160);
});
test('GM objective clock: Devil guard holds Timer seconds unless the current card is Succubus (3)',()=>{
 // SetSessionDuration (GM ubergraph, v0.05.1, cooked package): the 1 s
 // duration tick counts SessionLength + 1 always, EXCEPT when
 // 'Deal with the Devil' is active and CurrentCardTypeEnum != 3.
 const p={sessionLength:0,hasCame:false,isAllowedToCum:false},s=stats();
 const r=new O.Runtime({LastObjectiveIndex_Classic:1},p,s);
 r.state.target=10;r.gmSeconds=9;
 const devil={modifiers:['Deal With The Devil'],cardType:2};
 assert.deepEqual(r.tickSecond(p,s,0,9,devil),{events:[],counted:0});
 assert.equal(r.gmSeconds,9);
 // Devil + Succubus card (3): the second counts (guard passes), but the
 // trigger gate blocks the window for a Succubus card outside Frenzy, so
 // the objective stays complete for the next tick to retry.
 assert.deepEqual(r.tickSecond(p,s,0,9,{modifiers:['Deal With The Devil'],cardType:3}),{events:[],counted:1});
 assert.equal(r.gmSeconds,10);
 // Without the modifier the same card counts and the gate passes.
 assert.deepEqual(r.tickSecond(p,s,0,10,{modifiers:[],cardType:2}),{events:[{type:'release-window-opened',seconds:60,card:'CumEventOverride',notification:'60s Release Window\nFinish to Win'}],counted:1});
 assert.equal(r.gmSeconds,11);
 assert.equal(O.gmSecondCounts({modifiers:['Deal With The Devil'],cardType:3}),true);
 assert.equal(O.gmSecondCounts({modifiers:['Deal With The Devil'],cardType:5}),false);
 assert.equal(O.gmSecondCounts({modifiers:[],cardType:5}),true);
});
test('GM objective clock: Timer completes only on the seconds path, never on beat advance',()=>{
 // The trigger function has no Timer case (GM ubergraph, v0.05.1): Timer
 // completion reaches the trigger block only via the 1 s format timer
 // (stmts 2378-2380). The wall clock alone must not complete it.
 const p={sessionLength:0,hasCame:false,isAllowedToCum:false},s=stats();
 const r=new O.Runtime({LastObjectiveIndex_Classic:1},p,s);
 r.state.target=10;r.gmSeconds=10;
 // The wall clock races ahead of the GM clock; it must not complete the
 // Timer on its own.
 p.sessionLength=100;
 assert.deepEqual(r.tick(p,s,0,100),[]);
 assert.equal(r.tickSecond(p,s,0,100).events[0].type,'release-window-opened');
});
test('GM objective clock: Prejac expiry stops the clock and ends the session without a release window',()=>{
 // Format-timer Prejac branch (GM ubergraph stmts 2381-2388, v0.05.1):
 // completion clears both 1 s timer handles and calls EndSession() — no
 // trigger block, no 60 s window. The stopped clock counts no more seconds.
 const p={sessionLength:0,hasCame:false,isAllowedToCum:false},s=stats();
 const r=new O.Runtime({LastObjectiveIndex_Classic:4,LastObjective_Prejac:30},p,s);
 r.gmSeconds=29;
 const fired=r.tickSecond(p,s,0,30);
 assert.equal(fired.counted,1);assert.equal(r.gmSeconds,30);
 assert.equal(fired.events[0].type,'premature-cum');
 assert.equal(r.gmStopped,true);assert.equal(r.releaseDeadline,null);
 assert.deepEqual(r.tickSecond(p,s,0,31),{events:[],counted:0});
 assert.equal(r.gmSeconds,30);
});
test('Prejac tick expires at deadline while explicit confirmation at deadline wins',()=>{
 const p=player(),s=stats(),r=new O.Runtime({LastObjectiveIndex_Classic:4,LastObjective_Prejac:30},p,s);
 assert.equal(p.isAllowedToCum,true);p.sessionLength=50;
 assert.equal(r.resolveClimax(p)[0].type,'successful-cum');
 // Prejac expiry is a seconds-path check on the GM clock (GM ubergraph
 // @94068 dump, 2026-11-11): completion (stmts 2385-2388) clears both 1 s
 // timers and calls EndSession — it does NOT enter the trigger block, so no
 // release window opens and no Spawn100Percent / Start Cum Window Timer runs.
 r.gmSeconds=49;const fired=r.tickSecond(p,s,0,30);
 assert.equal(fired.events[0].type,'premature-cum');assert.equal(fired.counted,1);assert.equal(r.gmSeconds,50);
 assert.equal(r.gmStopped,true);
 assert.equal(r.releaseDeadline,null);
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
 state.objective=6;state.target=30;p.sessionLength=50;r.gmSeconds=49;
 assert.equal(r.tickSecond(p,s,0,0,{mode:1,phase:'playing',state}).events[0].type,'round-failed');
 p.sessionLength=51;assert.deepEqual(r.resolveClimax(p,{mode:1,phase:'playing',state}),[]);
 assert.deepEqual(r.tick(p,s,1,0,{mode:2}),[]);assert.deepEqual(r.tick(p,s,1,0,{mode:1,phase:'shop',state}),[]);
});
test('settled climax ignores Edge-card override and Tower Prejac after checkpoint restoration',()=>{
 const p=player(),s=stats(),runtime=new O.Runtime({},p,s);
 p.hasCame=true;
 const restored=Object.assign(Object.create(O.Runtime.prototype),JSON.parse(JSON.stringify(runtime)));
 assert.deepEqual(restored.resolveClimax(p,{mode:0,cardType:5}),[]);
 assert.deepEqual(restored.resolveClimax(p,{mode:1,phase:'bossRound',state:{active:true,objective:6,baselineDuration:20,target:30}}),[]);
});
test('release window opens only for the card types the original trigger accepts',()=>{
 // Determine And Trigger Cum Meter Override Event (BP_GlobalManager ubergraph,
 // v0.05.1, live block @92330-93214): when 'Is Succu Frenzy Active' is false
 // the trigger proceeds only when the current card type is NOT Edging (5),
 // Cum (6) or Succubus (3); when Frenzy is active it proceeds only for a
 // Succubus card (3). The dead trigger function has no frenzy type check;
 // the live block governs. A failed gate leaves the objective complete so
 // the next tick retries instead of losing the window.
 const complete=(i)=>{const p=player(),s=stats(),r=new O.Runtime({LastObjectiveIndex_Classic:i},p,s);r.state.target=10;p.sessionLength=30;r.gmSeconds=30;for(const k of Object.keys(s))s[k]=30;return {p,s,r};};
 // Timer (1) completes on the GM-side seconds path, the others on beat
 // advance; both run the same trigger gate once complete.
 const open=({p,s,r},now,ctx)=>r.state.objective===1?r.tickSecond(p,s,1,now,ctx).events:r.tick(p,s,1,now,ctx);
 for(let i=0;i<O.specs.length;i++){
  const objective=O.specs[i].objective;if(![0,1,2,3,8].includes(objective))continue;
  for(const cardType of [0,1,2,3,5,6,7,8]){
   const {p,s,r}=complete(i);
   assert.equal(open({p,s,r},100,{mode:0,cardType}).some(e=>e.type==='release-window-opened'),![3,5,6].includes(cardType),`objective ${objective} card ${cardType} without Frenzy`);
  }
  for(const cardType of [0,3,5,6]){
   const {p,s,r}=complete(i);
   assert.equal(open({p,s,r},100,{mode:0,cardType,modifiers:['Succufrenzy']}).some(e=>e.type==='release-window-opened'),cardType===3,`objective ${objective} card ${cardType} with Frenzy`);
  }
  const {p,s,r}=complete(i);
  assert.deepEqual(open({p,s,r},100,{mode:0,cardType:6}),[]);
  assert.equal(open({p,s,r},101,{mode:0,cardType:0})[0].type,'release-window-opened','a failed gate retries on the next tick');
 }
});
test('GM objective clock: Timer reset advances the GM baseline so the window re-fires only after another full target',()=>{
 // Set and Display Cum Window Timer (GM ubergraph, v0.05.1): the 'Timer
 // Reset' case does Objective_TimeRequired_Seconds += Original Objective
 // Time Required Seconds — the target grows by the original target while
 // SessionLength keeps counting. The player's baseline model is the same
 // requirement only if the reset advances baselineGmSeconds, the baseline
 // the GM-clock completion reads; advancing the wall baseline alone leaves
 // the objective complete and re-fires on the next second.
 const p={sessionLength:0,hasCame:false,isAllowedToCum:false},s=stats();
 const r=new O.Runtime({LastObjectiveIndex_Classic:1},p,s);
 r.state.target=100;r.gmSeconds=100;
 // Completion opens the window through the override path (Spawn100Percent
 // + Start Cum Window Timer + flag), and the flag holds while it is open:
 // a second completion does not re-fire (HasCumMeterOverideTriggered?).
 assert.equal(r.tickSecond(p,s,0,100,{mode:0,cardType:0}).events[0].type,'release-window-opened');
 assert.deepEqual(r.tickSecond(p,s,0,101,{mode:0,cardType:0}).events,[]);
 // The 60 s window runs; expiry resets the Timer.
 r.gmSeconds=160;
 const expired=r.expireReleaseWindow(p,s,0,160,{mode:0});
 assert.equal(expired.events[0].type,'objective-reset');
 assert.equal(expired.events[0].notification,'Timer Reset');
 assert.equal(r.state.baselineGmSeconds,100);
 // One second past the reset target is not enough: another full target
 // (gmSeconds 200) is required.
 r.gmSeconds=160;assert.deepEqual(r.tickSecond(p,s,0,161,{mode:0,cardType:0}).events,[]);
 r.gmSeconds=198;assert.deepEqual(r.tickSecond(p,s,0,199,{mode:0,cardType:0}).events,[]);
 r.gmSeconds=199;assert.equal(r.tickSecond(p,s,0,200,{mode:0,cardType:0}).events[0].type,'release-window-opened');
 // resetAfterMiss itself advances the GM baseline (and wraps int32 like
 // the other baselines).
 const state={active:true,objective:1,target:10,baselineDuration:20,baselineGmSeconds:20};
 O.resetAfterMiss(state,true,.8);assert.equal(state.baselineGmSeconds,30);assert.equal(state.baselineDuration,30);
 state.baselineGmSeconds=2147483647;state.target=1;O.resetAfterMiss(state,true,.8);assert.equal(state.baselineGmSeconds,-2147483648);
});
test('expired release windows name the reset objective the original names',()=>{
 // Set and Display Cum Window Timer (BP_GlobalManager ubergraph, v0.05.1):
 // each objective case notifies '<Objective> Reset' — 'Cum Meter Reset' (0),
 // 'Timer Reset' (1), 'Strokes Reset' (2), 'Edges Reset' (3), 'Succubi Reset' (8).
 const expected={0:'Cum Meter Reset',1:'Timer Reset',2:'Strokes Reset',3:'Edges Reset',8:'Succubi Reset'};
 for(let i=0;i<O.specs.length;i++){
  const objective=O.specs[i].objective;if(!(objective in expected))continue;
  const p=player(),s=stats(),r=new O.Runtime({LastObjectiveIndex_Classic:i},p,s);
  r.state.target=10;p.sessionLength=30;r.gmSeconds=30;for(const k of Object.keys(s))s[k]=30;
  const opened=r.state.objective===1?r.tickSecond(p,s,1,100,{mode:0,cardType:0}).events:r.tick(p,s,1,100,{mode:0,cardType:0});
  assert.equal(opened[0].type,'release-window-opened');
  const expired=r.expireReleaseWindow(p,s,1,160,{mode:0});
  assert.equal(expired.events[0].type,'objective-reset');
  assert.equal(expired.events[0].notification,expected[objective],`objective ${objective}`);
 }
});
