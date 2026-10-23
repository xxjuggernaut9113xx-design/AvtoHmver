(function(root) {
 'use strict';
 const f=Math.fround;
 const primary=[[45,25,20,5,5],[22,35,28,12,10],[5,35,45,35,25]];
 const bonus=[
  [[35,45,15,5,3],[30,45,20,8,5],[25,45,24,10,8],[20,40,28,12,12],[16,38,32,15,15],[12,35,36,18,18]],
  [[25,40,22,8,5],[22,38,28,12,8],[18,36,34,15,12],[14,32,40,18,18],[10,30,45,22,22],[8,28,50,25,25]],
  [[8,32,40,30,15],[6,30,45,35,18],[5,28,50,40,22],[4,25,55,45,30],[3,22,60,50,40],[2,20,65,55,45]]
 ];
 class Inventory {
  constructor(data={}) {this.ownedItems=structuredClone(data.ownedItems||[]);this.hotbarItems=[...(data.hotbarItems||[8,8,8,8,8])];}
  state(type){return this.ownedItems.find(s=>s.type===type);}
  unlock(type){if(type===8||this.state(type))return false;this.ownedItems.push({type,unlocked:true,level:1,charges:0});return true;}
  upgrade(type){const state=this.state(type);if(type===8||!state||state.level>=5)return false;state.level++;return true;}
  maximum(type,context={}){let n={0:1,1:3,3:3,4:2,5:5,6:15,7:1,9:3,10:1,11:2,12:2,13:1}[type];if(type===4&&context.mode===2){if(!context.manager)return undefined;n=context.maxBreaks;}return n===undefined?n:(n+(context.biggerPockets?1:0))|0;}
  grant(type,count,context){const state=this.state(type),max=this.maximum(type,context);if(!state||max===undefined||state.charges>=max)return false;state.charges=(state.charges+count)|0;return true;}
  equip(type,slot){if(!this.state(type)||!Number.isInteger(slot)||slot<0||slot>4)return false;for(let i=0;i<this.hotbarItems.length;i++)if(this.hotbarItems[i]===type)this.hotbarItems[i]=0;while(this.hotbarItems.length<=slot)this.hotbarItems.push(0);this.hotbarItems[slot]=type;return true;}
  export(){return {version:1,ownedItems:structuredClone(this.ownedItems),hotbarItems:[...this.hotbarItems]};}
 }
 function rewards(context,inventory,ownedModifiers,random) {
  const lane=Math.min(context.lane,2),tier=Math.max(1,Math.min(6,context.tier)),unlocks=[],upgrades=[],modifiers=[...new Set(context.unlockableModifiers||[])].filter(n=>n!==22&&!ownedModifiers.includes(n)),result=[];
  for(let type=1;type<=13;type++){if(type===2||type===8)continue;const state=inventory.state(type);if(!state||!state.unlocked)unlocks.push(type);else if(state.level<5&&type!==7&&type!==10)upgrades.push(type);}
  const has=type=>result.some(r=>r.type===type);
  function available(category){return category===1||category===2?!has(category-1):category===3?!has(3)&&upgrades.length>0:category===4?!has(2)&&unlocks.length>0:category===5&&!has(5)&&modifiers.length>0;}
  function add(category,isBonus){if(!available(category))return false;const row={type:0,item:8,modifier:22,amount:1};if(category===1){const multiplier=lane===0?(isBonus?.4:.75):lane===1?(isBonus?.75:1):2;row.amount=Math.max(1,Math.floor(f(context.baseCoins*f(multiplier))+.5));}else if(category===2){row.type=1;row.amount=Math.max(1,context.baseSuccuCoins);}else if(category===3){row.type=3;row.item=upgrades[random.range(0,upgrades.length-1)];row.amount=tier>=6?3:((lane===2&&tier>=4)||(lane===1&&tier>=5))?2:1;}else if(category===4){row.type=2;row.item=unlocks[random.range(0,unlocks.length-1)];}else{row.type=5;row.modifier=modifiers[random.range(0,modifiers.length-1)];}result.push(row);return true;}
  function pick(weights,isBonus){let total=0;for(let c=1;c<=5;c++)if(available(c))total=f(total+weights[c-1]);let roll=f(random.fraction()*total);if(total>0)for(let c=1;c<=5;c++)if(available(c)){roll=f(roll-weights[c-1]);if(roll<=0){add(c,isBonus);return;}}for(const c of [5,3,4,2,1])if(add(c,isBonus))return;}
  if(context.final&&lane===2)add(4,false);if(!result.length)pick(primary[lane],false);pick(bonus[lane][tier-1],true);if(result.length<2)for(const c of [5,3,4,2,1])if(add(c,true)&&result.length>=2)break;return result;
 }
 const api={Inventory,rewards};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceInventory=api;
})(globalThis);
