const {test}=require('node:test'),assert=require('node:assert/strict');
const Items=require('../static/fanservice/items'),{Run}=require('../static/fanservice/run');
const modes=require('../static/fanservice/data/modes.json'),cardRules=require('../static/fanservice/data/card-rules.json'),Rules=require('../static/fanservice/rules');
const evidence=require('./fixtures/fanservice/original-item-interactions.json');
function inventory(type){const run=new Run(modes);run.inventory.grant(type,1);run.inventory.equip(type,0);return run.inventory;}

test('retained ActivateItem calls All or Nothing only after successful supported effects',()=>{
 const statements=evidence.records.find(r=>r.function==='ActivateItem').statements;
 const calls=statements.filter(({statement:s})=>s.ContextExpression?.VirtualFunctionName==='ApplyAllOrNothingModifierEffects_IfToggled');
 assert.deepEqual(calls.map(s=>s.index),[45,56,70,94,106,129]);
 const uses=statements.filter(({statement:s})=>s.VirtualFunctionName==='UseItem');
 assert.deepEqual(uses.map(({statement:s})=>s.Parameters[0].Value),[1,3,4,5,6,7,9,10,11,12,13]);
 for(const call of calls){const priorUse=uses.filter(use=>use.index<call.index).at(-1);assert.ok(priorUse);const branch=statements.find(({index})=>index===priorUse.index+1);assert.equal(branch.statement.op,'EX_JumpIfNot');}
});

test('original item lock permits only Escape Rope and excludes both edge and release cards',()=>{
 for(const type of [1,3,4,5,6,7,9,11,12,13]){
  const inv=inventory(type),state={canUseItems:false,cardType:3,combo:20,strokes:0};
  assert.equal(Items.use(inv,type,state).ok,false,`locked type ${type}`);
  assert.equal(inv.state(type).charges,1);
 }
 for(const cardType of [3,4,5,6]){
  const inv=inventory(10),state={canUseItems:false,cardType,beatsRemaining:1,combo:20};
  const result=Items.use(inv,10,state,{hooks:{escape:()=>true}});
  assert.equal(result.ok,[3,4].includes(cardType),`Escape Rope on card ${cardType}`);
  assert.equal(inv.state(10).charges,[3,4].includes(cardType)?0:1);
 }
});

test('rejected timeline mutation preserves All or Nothing coins and objective progress',()=>{
 for(const type of [3,4,5,9,10]){
  const inv=inventory(type),state={coins:75,cumMeter:.4,heat:50,combo:30,beatInterval:.5,strokeCount:30,beatsRemaining:30,cardType:1};
  const before=structuredClone(state);
  const result=Items.use(inv,type,state,{context:{allOrNothing:true,minimumBeatInterval:.05},hooks:{speed:()=>false,beginBreak:()=>false,pill:()=>false,spawnSuccubus:()=>false,escape:()=>false}});
  assert.equal(result.ok,false);assert.equal(state.coins,before.coins);assert.equal(state.cumMeter,before.cumMeter);assert.equal(inv.state(type).charges,1);
 }
});

test('All or Nothing applies after supported successful effects, never Boner Pill',()=>{
 for(const type of [1,3,4,5,6,7,10]){
  const inv=inventory(type),state={coins:75,cumMeter:.4,heat:50,combo:30,beatInterval:.5,strokeCount:30,beatsRemaining:30,cardType:1};
  const result=Items.use(inv,type,state,{context:{allOrNothing:true,minimumBeatInterval:.05},hooks:{speed:()=>true,beginBreak:()=>true,pill:()=>true,openStore:()=>true,escape:()=>true}});
  assert.equal(result.ok,true);assert.equal(state.coins,type===5?75:0,`coins on type ${type}`);assert.equal(state.cumMeter,type===5?.4:0,`meter on type ${type}`);
 }
});

test('objective-specific All or Nothing reset hook runs only after an accepted effect',()=>{
 const inv=inventory(3),state={coins:75,cumMeter:.4,beatInterval:.5};let resets=0;
 const deps={context:{allOrNothing:true,objectiveType:2},hooks:{speed:()=>false,resetObjective:()=>resets++}};
 assert.equal(Items.use(inv,3,state,deps).ok,false);assert.equal(resets,0);
 deps.hooks.speed=()=>true;assert.equal(Items.use(inv,3,state,deps).ok,true);assert.equal(resets,1);assert.equal(state.coins,0);assert.equal(state.cumMeter,.4+.01);
});


test('Apex Lure adds its level bonus to the existing succubus modifier before truncation',()=>{
 const bonuses=[2,1.5,1,.5,0];
 for(let level=1;level<=5;level++){
  const run=new Run(modes,{seed:137,cardRules}),item=run.inventory.state(9);run.inventory.grant(9,1);run.inventory.equip(9,0);item.level=level;
  let flow;const result=Items.use(run.inventory,9,run.state,{hooks:{spawnSuccubus:options=>{flow=run.startCard('succubus',{apexLure:true,...options});return !!flow;}}});
  assert.equal(result.ok,true);
  const rng=new Run(modes,{seed:137,cardRules}).random,strokes=rng.range(30,50);
  const base=Rules.drawMultipliers(0,cardRules.difficulty_count[1],cardRules.difficulty_speed[1]).count;
  assert.equal(flow.assigned,Math.trunc(strokes*(base+bonuses[level-1])));
  assert.equal(run.inventory.state(9).charges,0);
 }
});

test('Apex bonus is additive after Hivemind, Infernal Clause, and Double Devil modifiers',()=>{
 const run=new Run(modes,{seed:137,cardRules,modifiers:['Hivemind','Double Devil']});run.state.succubi=3;run.ownedModifiers=[7];
 const item=run.inventory.state(9);run.inventory.grant(9,1);run.inventory.equip(9,0);item.level=2;
 let flow;assert.equal(Items.use(run.inventory,9,run.state,{hooks:{spawnSuccubus:options=>{flow=run.startCard('succubus',{apexLure:true,...options});return !!flow;}}}).ok,true);
 const rng=new Run(modes,{seed:137,cardRules}).random,strokes=rng.range(30,50);
 const base=Rules.drawMultipliers(0,cardRules.difficulty_count[1],cardRules.difficulty_speed[1]).count;
 const modified=(base+.4*3)*.5+1+1.5;
 assert.equal(flow.assigned,Math.trunc(strokes*modified));
});
