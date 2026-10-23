const test=require('node:test'),assert=require('node:assert/strict');
const progression=require('../static/fanservice/progression.js');
const contract=require('../static/fanservice/data/native-contract.json');
const fresh=()=>({version:1,packs:[{id:'custom:a',owned:true,enabled:true,device_id:'private-device'}],unlock_points:0,future:{unchanged:42},device:{secret:'local-only'}});
test('all 70 native challenge rows normalize without losing source fields',()=>{
 const defs=progression.definitions(contract);assert.equal(defs.length,70);assert.equal(new Set(defs.map(d=>d.id)).size,70);
 for(const d of defs){assert.ok(d.name);assert.ok(['Session','Lifetime'].includes(d.scope));assert.equal(d.requirements.length,d.Requirements.length);for(const r of d.requirements){assert.equal(typeof r.TargetValue,'number');assert.ok(r.MetricType.startsWith('EMetricType::'));}for(const r of d.rewards)assert.ok(r.RewardType.startsWith('ECHRewardType::'));}
 assert.equal(defs[0].name,'Rookie Edger');assert.equal(defs[0].Requirements[0],contract.DT_Challenges[0].Requirements[0]);
});
test('native requirement comparison, progress and condition semantics',()=>{
 for(const [comparison,a,b,expected] of [['GreaterOrEqual',2,2,true],['Greater',2,2,false],['LessOrEqual',2,2,true],['Less',2,2,false],['Equal',2,2,true],['Unknown',2,2,false]])assert.equal(progression.requirementMet({ComparisonType:'EComparisonType::'+comparison,CurrentValue:a,TargetValue:b}),expected);
 assert.equal(progression.requirementProgress({TargetValue:0,ComparisonType:'Unknown'}),1);assert.equal(progression.requirementProgress({TargetValue:4,CurrentValue:1,ComparisonType:'Less'}),.75);
 assert.equal(progression.conditionsMet([{ConditionType:'modifier',ConditionValue:'Iron Man'}],{modifiers:['ironman']}),false);
 assert.equal(progression.conditionsMet([{ConditionType:'modifier',ConditionValue:'Iron Man'},{ConditionType:'no_items'},{ConditionType:'max_time',ConditionValue:'60'}],{modifiers:['Iron Man'],ItemsUsed:0,SessionDuration:60}),true);
 assert.equal(progression.conditionsMet([{ConditionType:'unknown'}],{}),true);
});
test('settlement is idempotent, awards reached level points and preserves ownership/privacy fields',()=>{
 const original=fresh(),stats={seconds:60,strokes:300,edges:6,won:true,coins:9};const next=progression.settleSession(original,stats,'session-1',contract,()=>220);
 assert.equal(next.progression.level,3);assert.equal(next.progression.xp,0);assert.equal(next.unlock_points,11+1+3+5+5);assert.deepEqual(next.packs,original.packs);assert.deepEqual(next.device,original.device);assert.deepEqual(next.future,original.future);assert.equal(original.progression,undefined);
 assert.deepEqual(progression.settleSession(next,stats,'session-1',contract,()=>999),next);
 assert.equal(next.progression.challenge_progress.rookie_edger.completed,true);assert.equal(next.progression.challenge_progress.master_of_control.completed,true);
 assert.ok(!JSON.stringify(next.progression.last_settlement).includes('private-device'));
});
test('native challenge claims grant once and validate modifier/card identifiers',()=>{
 const settled=progression.settleSession(fresh(),{seconds:400,edges:15,won:true},'win',contract,()=>0);
 const before=settled.unlock_points,next=progression.claimChallenge(settled,'intermediate_edger',contract);
 assert.equal(next.progression.challenge_progress.intermediate_edger.claimed,true);assert.equal(next.progression.total_xp,500);assert.ok(next.unlock_points>=before+12);assert.ok(next.progression.unlocked_modifiers.includes('Pheromones'));assert.ok(next.progression.unlocked_player_cards.includes('vera_pc_1'));
 assert.deepEqual(progression.claimChallenge(next,'intermediate_edger',contract),next);
 assert.deepEqual(progression.claimChallenge(next,'missing',contract),next);
});
test('pack rewards record entitlement without enabling or replacing custom packs',()=>{
 const settled=progression.settleSession(fresh(),{seconds:20,won:false,LostToSuccubus:1},'loss',contract,()=>0);const next=progression.claimChallenge(settled,'succubus_lunch',contract);
 assert.ok(next.progression.rewarded_packs.includes('cum_covered_succubi_vol._1'));assert.deepEqual(next.packs,fresh().packs);
});
test('session reset preserves completion and lifetime progress',()=>{
 let profile=progression.settleSession(fresh(),{seconds:400,won:true,edges:1,strokes:20},'first',contract,()=>0);const before=profile.progression.challenge_progress;profile=progression.startSession(profile,contract);
 for(const [id,entry] of Object.entries(profile.progression.challenge_progress))if(entry.scope==='Session'&&!entry.completed)assert.ok(entry.requirements.every(r=>r.CurrentValue===0));else assert.deepEqual(entry.requirements,before[id].requirements);
});
test('definition changes reset incompatible progress and archive removed definitions without reclaiming',()=>{
 const source=progression.settleSession(fresh(),{seconds:400,won:true,edges:5},'first',contract,()=>0);const claimed=progression.claimChallenge(source,'rookie_edger',contract),changed=JSON.parse(JSON.stringify(contract));changed.DT_Challenges=changed.DT_Challenges.filter(d=>d.ChallengeID!=='intermediate_edger');changed.DT_Challenges[0].Conditions=['(ConditionType="modifier",ConditionValue="Iron Man")'];
 const next=progression.startSession(claimed,changed);assert.equal(next.progression.challenge_progress.intermediate_edger.archived,true);assert.equal(next.progression.challenge_progress.rookie_edger.claimed,true);assert.deepEqual(progression.claimChallenge(next,'rookie_edger',changed),next);
});
test('UP follows native post-game integer divisions and losing scale',()=>{
 assert.equal(progression.sessionUP({seconds:180,strokes:599,edges:3,maxCombo:799,highDraws:19,itemsUsed:1,won:true}),10);
 assert.equal(progression.sessionUP({seconds:180,strokes:599,edges:3,maxCombo:799,highDraws:19,itemsUsed:1,won:false}),0);
 assert.equal(progression.sessionUP({seconds:0,won:false}),2);
});
