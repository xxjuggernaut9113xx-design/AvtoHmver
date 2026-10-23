(function(root){
 'use strict';const f=Math.fround,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const objectives=['FillCumMeter','TimerBased','Strokes','Edges','CoinFlip','Ruiner','Prejac','Tribute','SuccuSlayer'];
 class Random {
  constructor(seed){this.seed=seed|0;}
  fraction(){this.seed=(Math.imul(this.seed,196314165)+907633515)|0;return (this.seed>>>9)/8388608;}
  range(min,max){const count=max-min+1;return min+(count>0?Math.min(Math.trunc(f(this.fraction()*count)),count-1):0);}
 }
 function fits(name,objective){switch(name.toLowerCase()){
  case 'mr. money bandz':return objective===0;case 'hungry succubi':return objective===0||objective===2;
  case 'succufrenzy':return ![3,6,7].includes(objective);case 'slow and steady':return !!((0x1a8>>>objective)&1);
  case 'sacrificial':case 'demon proof':return objective===8;case 'deal with the devil':return !!((0x1aa>>>objective)&1);case 'double time':return objective===3;default:return true;
 }}
 class Tower {
  constructor(catalog,rounds,seed,endless=false,options={}){if(!Number.isInteger(rounds)||rounds<1)throw Error('Choose a positive round count');this.catalog=catalog;this.inventory=options.inventory;this.ownedModifiers=options.ownedModifiers||[];this.rewardRules=options.rewardRules;this.rounds=rounds;this.random=new Random(seed);this.endless=endless;this.round=0;this.history=[];this.recent=[];this.completed=0;this.failed=0;this.phase='selection';this.options=this.generate();}
  progress(round){return this.endless?clamp(f(Math.max(round-1,0)*f(.06)),0,f(.9)):this.rounds<2?0:clamp(f((round-1)/(this.rounds-1)),0,1);}
  pressure(){if(!this.history.length)return 0;const p=f(1-f(Math.pow(f(1-this.progress(this.round)),f(.6)))),lerp=(a,b)=>f(f(a)+f(p*f(b-a))),targetEdge=lerp(.5,2.5),targetDefense=lerp(0,1.5);let total=0,pressure=0;
   this.history.slice(-3).reverse().forEach((s,i)=>{const weight=f([.6,.3,.1][i]),rate=f(1/Math.max(f(s.seconds/60),f(.1))),edge=s.edges>0?f(.4):0,scale=f(f(1.2)/f(f(.8)+edge));const edges=s.edges>0?f(f(f(s.edges*rate)-targetEdge)/3):0,defense=f(f(f((s.defensive||0)*rate)-targetDefense)/2),offense=f(f(p-f((s.offensive||0)*rate))/2),taunts=f(f(p-f((s.taunts||0)*rate))/2),tempt=f(f(p-f((s.temptations||0)*rate))/2);let sum=f(f(f(.15)*tempt)+f(f(.15)*taunts));sum=f(sum+f(f(.2)*offense));sum=f(sum+f(f(.3)*defense));sum=f(sum+f(edge*edges));pressure=f(pressure+f(f(sum*scale)*weight));total=f(total+weight);});return total>0?f(pressure/total):0;
  }
  adaptive(){if(!this.endless&&this.rounds<2)return 1;const pressure=this.pressure(),progress=clamp(f(this.progress(this.round+1)-f(f(pressure>0?.2:.1)*pressure)),0,1),weights=[];let total=0;for(let i=0;i<5;i++){const shape=Math.max(f(1-f(Math.abs(f(progress-f(i*f(.25))))*f(2.5))),0),w=f(f(shape*shape)+f(.1));weights.push(w);total=f(total+w);}let roll=f(this.random.fraction()*total);for(let i=0;i<5;i++){roll=f(roll-weights[i]);if(roll<=0)return i+1;}return 5;}
  generate(){const final=!this.endless&&this.round+1>=this.rounds,hasEdge=this.history.some(s=>s.edges>0||s.defensive>0);let candidates=[0,1,2,3,6,7,8].filter(n=>(final||![6,7].includes(n))&&(n!==3||hasEdge));const fresh=candidates.filter(n=>!this.recent.includes(n));if(fresh.length>=3)candidates=fresh;const eligible=[...candidates],tiers=[2,3,4],lanes=[0,1,2],r=this.random;
   if(this.round>0&&!final){const base=this.adaptive();tiers[0]=clamp(base-(r.fraction()>=.75?2:1),1,5);const middle=r.fraction();tiers[1]=clamp(base+(middle<.2?-1:middle>=.8?1:0),1,5);tiers[2]=clamp(base+(r.fraction()>=.75?2:1),1,5);}
   if(!final)for(let i=2;i>0;i--){const j=r.range(0,i);[tiers[i],tiers[j]]=[tiers[j],tiers[i]];[lanes[i],lanes[j]]=[lanes[j],lanes[i]];}
   const result=[];
   for(let lane=0;lane<3;lane++){
    if(!candidates.length)candidates=[...eligible];const index=r.range(0,candidates.length-1),objective=candidates.splice(index,1)[0],tier=final?6:tiers[lane],row=this.catalog.objectives.find(v=>v.Tier===tier&&v.Objective==='ESessionObjective::'+objectives[objective]),t=this.catalog.tiers.find(v=>v.Tier===tier);
    if(!t)throw Error('Incomplete Tower source catalog');const parameter=row?r.range(row.MinValue,row.MaxValue):0;
    let coins=r.range(t.MinBaseCoins,t.MaxBaseCoins),succu_coins=Math.max(1,Math.floor(f(r.range(t.MinBaseSuccuCoins,t.MaxBaseSuccuCoins)*[1,1.75,3][lanes[lane]])+.5)),native_rewards;
    if(this.inventory){
     const names=['PotLid','GoldenShower','Lube','DevilCoin','HeatSpell','BurningProfits','Molasses','InfernalClause','HellMagnet','Accelerant','Exorcist','BankingError','StockholmCuffs','BiggerPockets','EnhancedPlating','Firemouth','PassiveCooling','Recycler','SpoilsOfSin','GoonTycoon','Coinverter','FlameHarness'];
     const helpers=this.rewardRules||root.FanserviceInventory;if(!helpers)throw Error('Tower inventory rules are unavailable');
     native_rewards=helpers.rewards({tier,lane:lanes[lane],baseCoins:coins,baseSuccuCoins:succu_coins,final,unlockableModifiers:(t.UnlockableSuccuModifiers||[]).map(name=>names.indexOf(name.replace('ESuccuShopModifier::',''))).filter(index=>index>=0)},this.inventory,this.ownedModifiers,r);
     coins=native_rewards.filter(reward=>reward.type===0).reduce((sum,reward)=>sum+reward.amount,0);succu_coins=native_rewards.filter(reward=>reward.type===1).reduce((sum,reward)=>sum+reward.amount,0);
    }
    const available=t.EligibleModifierTitles.filter(n=>fits(n,objective)),count=Math.min(r.range(t.MinModifiers,t.MaxModifiers),available.length),modifiers=[];
    for(let i=0;i<count;i++)modifiers.push(available.splice(r.range(0,available.length-1),1)[0]);const option={objective,tier,parameter,lane:lanes[lane],coins,succu_coins,modifiers};if(native_rewards)option.native_rewards=native_rewards;result.push(option);
   }
   return result;
  }
  select(index){if(this.phase!=='selection'||!this.options[index])throw Error('Choose an available Tower option');this.selected=this.options[index];this.recent.push(this.selected.objective);this.recent=this.recent.slice(-3);this.round++;this.phase='playing';return this.selected;}
  complete(success,stats){if(this.phase!=='playing')throw Error('No active Tower round');this.history.push({...stats});this.completed=this.round;if(!success)this.failed++;this.phase=this.round>=this.rounds&&!this.endless?'complete':'shop';}
  continue(){if(this.phase!=='shop')throw Error('Tower is not in the shop');this.options=this.generate();this.phase='selection';return this.options;}
 }
 const api={Random,Tower,fits};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceTower=api;
})(globalThis);
