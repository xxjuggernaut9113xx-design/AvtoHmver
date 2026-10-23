(function(root){
 'use strict';
 const Inventory=(typeof module!=='undefined'&&module.exports?require('./inventory.js'):root.FanserviceInventory).Inventory;
 const types={DecreaseHeat:1,Slowdown:3,Break:4,BonerPill:5,SuccuShield:6,Resupply:7,ApexLure:9,EscapeRope:10,LootRush:11,Bounty:12,ComboCruncher:13};
 const ids=Object.fromEntries(Object.entries(types).map(([id,type])=>[type,id]));
 const fail=reason=>({ok:false,reason});
 const level=s=>Math.max(0,Math.min(4,s.level-1));
 function catalog(modes){return modes.items.map(source=>{const id=source.ItemType.split('::')[1];return {type:types[id],id,title:source.Level1TooltipTitle,classification:source.Classification.split('::')[1],maxCharges:source.MaxCharges,upgradeable:!!source.bIsUpgradeable,purchaseCosts:[1,2,3,4,5].map(n=>source['PurchaseCost_Lvl'+n]),upgradeCosts:[1,2,3,4,5].map(n=>source['UpgradeCost_Lvl'+n]),source};});}
 function prepare(modes,mode,random,context={}){
  const inventory=new Inventory(),rows=catalog(modes);inventory.catalog=rows;
  if(mode===0)rows.forEach(r=>inventory.unlock(r.type));
  else if(mode===1){if(!random||typeof random.range!=='function')throw new TypeError('Tower loadout requires random.range');const candidates=rows.filter(r=>r.type!==7);for(let i=0;i<candidates.length-1;i++){const j=random.range(i,candidates.length-1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}for(const c of ['Defensive','Offensive']){const row=candidates.find(r=>r.classification===c);if(row)inventory.unlock(row.type);}}
  else if(mode===2){inventory.unlock(4);inventory.hotbarItems[0]=4;}
  else throw new RangeError('Unsupported item mode');
  if(mode===0&&context.hotbar)inventory.hotbarItems=Array.from({length:5},(_,i)=>rows.some(r=>r.type===context.hotbar[i])?context.hotbar[i]:8);
  return inventory;
 }
 function rowFor(inventory,type){return inventory.catalog&&inventory.catalog.find(r=>r.type===type);}
 function purchase(inventory,type,wallet,context={}){const row=rowFor(inventory,type),s=inventory.state(type);if(!row||!s||!s.unlocked)return fail('Item unavailable');const maximum=inventory.maximum(type,context),cost=row.purchaseCosts[level(s)];if(maximum===undefined)return fail('Capacity context unavailable');if(s.charges>=maximum)return fail('Capacity reached');if(!Number.isFinite(wallet.coins)||wallet.coins<cost)return fail('Insufficient coins');const amount=type===6?[1,4,7,10,15][level(s)]:1;if(!inventory.grant(type,amount,context))return fail('Grant rejected');wallet.coins-=cost;return {ok:true,cost,amount};}
 function upgrade(inventory,type,wallet){const row=rowFor(inventory,type),s=inventory.state(type);if(!row||!s||!s.unlocked||!row.upgradeable||s.level>=5)return fail('Upgrade unavailable');const cost=row.upgradeCosts[level(s)];if(!Number.isFinite(wallet.coins)||wallet.coins<cost)return fail('Insufficient coins');if(!inventory.upgrade(type))return fail('Upgrade rejected');wallet.coins-=cost;return {ok:true,cost};}
 function equip(inventory,type,slot){return rowFor(inventory,type)&&inventory.state(type)?.unlocked&&inventory.equip(type,slot)?{ok:true}:fail('Equip rejected');}
 function consume(inventory,type,state,hooks){if(!hooks.recycler||!hooks.recycler()){inventory.state(type).charges--;}state.metrics=state.metrics||{};state.metrics.itemsUsed=(state.metrics.itemsUsed||0)+1;}
 function use(inventory,type,state,deps={}){
  const item=inventory.state(type),hooks=deps.hooks||{},context=deps.context||{},i=item?level(item):0,id=ids[type];
  if(!id||!item||!item.unlocked||item.charges<=0)return fail('No item available');
  if(hooks.panicBlocked&&hooks.panicBlocked(type,state))return fail('Panic blocked');
  if(state.canUseItems===false&&!(state.cardType===3&&[10,11,12,13].includes(type)))return fail('Cannot use items');
  state.effects=state.effects||{};const e=state.effects;
  const requireHook=name=>typeof hooks[name]==='function';
  if(type===3&&(state.canUseSlowdown===false||state.canUseBonerPill===false)||type===5&&state.canUseBonerPill===false||type===11&&e.lootRushRemaining>0||type===12&&e.bountyRemaining>0||type===7&&e.resupplyRemaining>0)return fail('Cooldown active');
  if(type===1&&!Number.isFinite(state.heat)||type===13&&!(state.combo>0))return fail('Effect state unavailable');
  if(type===3&&(!requireHook('speed')||!Number.isFinite(state.beatInterval))||type===4&&!requireHook('beginBreak')||type===5&&(!requireHook('pill')||!Number.isFinite(state.strokeCount)||!Number.isFinite(state.beatInterval)||!Number.isFinite(context.minimumBeatInterval))||type===7&&!requireHook('openStore')||type===9&&!requireHook('spawnSuccubus')||type===10&&(!requireHook('escape')||!(state.beatsRemaining>0)||[4,5].includes(state.cardType))||type===12&&(!deps.random||typeof deps.random.range!=='function'||!Number.isFinite(state.strokes)))return fail('Effect prerequisite unavailable');
  if([1,3,4,6,7].includes(type)&&context.punishmentEnabled&&!requireHook('punishment'))return fail('Punishment prerequisite unavailable');
  if([1,3,4,6,7].includes(type)&&context.punishmentEnabled&&hooks.punishment(type,state)){if(type===1)state.heat=Math.min(100,state.heat+15);return fail('Punishment triggered');}
  if(context.allOrNothing&&[1,5,7].includes(type)){state.coins=0;state.cumMeter=0;}
  if(type===1){state.heat=Math.max(0,state.heat-[15,25,35,45,60][i]);state.cumMeter=Math.min(1,(state.cumMeter||0)+.01);}
  else if(type===3){if(hooks.speed(1/(i+2))===false)return fail('Timeline rejected');state.beatInterval*=i+2;state.canUseSlowdown=false;state.cumMeter=Math.min(1,(state.cumMeter||0)+.01);}
  else if(type===4){const duration=context.mode===2?context.breakDuration:[5,10,15,25,50][i];if(!Number.isFinite(duration)||hooks.beginBreak(duration)===false)return fail('Break unavailable');state.combo=0;state.cumMeter=Math.min(1,(state.cumMeter||0)+.01);}
  else if(type===5){const effect={strokeMultiplier:[2,2.5,3,3,4][i],intervalDivisor:[2,2,2,3,5][i],coinMultiplier:[2,2,2,3,3][i],speed:[2,2,3,5,6][i],timelineStrokes:[2,2,3,3,4][i]};if(hooks.pill(effect)===false)return fail('Timeline rejected');state.strokeCount=Math.trunc(state.strokeCount*effect.strokeMultiplier);state.beatInterval=Math.max(context.minimumBeatInterval||.05,Math.min(1,state.beatInterval/effect.intervalDivisor));state.coinMultiplier=effect.coinMultiplier;state.cardType=2;state.canUseBonerPill=false;e.temptationRemaining=60;}
  else if(type===6){state.shieldToggled=!state.shieldToggled;return {ok:true,consumed:false};}
  else if(type===7){e.resupplyRemaining=2;return {ok:true,pending:true};}
  else if(type===9){if(hooks.spawnSuccubus({hard:i<4,strokeMultiplier:1+(4-i)*.5})===false)return fail('Succubus unavailable');}
  else if(type===10){if(hooks.escape()===false)return fail('Escape unavailable');state.combo=0;}
  else if(type===11){e.lootRushRemaining=[15,20,30,40,50][i];e.lootRushBonus=[.5,.75,1,1.25,1.5][i];state.lootBarMultiplier=(state.lootBarMultiplier===undefined?1:state.lootBarMultiplier)+e.lootRushBonus;}
  else if(type===12){e.bountyLevel=i+1;e.bountyStartStrokes=state.strokes;e.bountyRequiredStrokes=deps.random.range([38,38,36,34,32][i],[48,48,46,44,42][i]);e.bountyRemaining=deps.random.range([14,17,20,23,26][i],[17,20,23,26,30][i]);}
  else if(type===13){state.cumMeter=Math.min(1,(state.cumMeter||0)+state.combo/5000);state.combo=Math.trunc(state.combo*[0,.05,.1,.15,.2][i]);}
  consume(inventory,type,state,hooks);return {ok:true,consumed:true};
 }
 function tick(inventory,state,seconds,deps={}){
  if(!Number.isFinite(seconds)||seconds<0)return [];const e=state.effects||{},events=[],hooks=deps.hooks||{},context=deps.context||{};
  if(e.lootRushRemaining>0){e.lootRushRemaining=Math.max(0,e.lootRushRemaining-seconds);if(!e.lootRushRemaining){state.lootBarMultiplier=Math.max(0,state.lootBarMultiplier-e.lootRushBonus);e.lootRushBonus=0;events.push('LootRushExpired');}}
  if(e.temptationRemaining>0)e.temptationRemaining=Math.max(0,e.temptationRemaining-seconds);
  if(e.resupplyRemaining>0){e.resupplyRemaining=Math.max(0,e.resupplyRemaining-seconds);if(!e.resupplyRemaining){if(typeof hooks.openStore!=='function'||hooks.openStore()===false){e.resupplyRemaining=Number.EPSILON;events.push('StoreUnavailable');}else{consume(inventory,7,state,hooks);events.push('StoreOpened');}}}
  if(e.bountyRemaining>0){if(state.strokes-e.bountyStartStrokes>=e.bountyRequiredStrokes){const caps={1:3,3:3,4:2,5:5,6:15,7:1,9:3,10:1,11:2,12:2,13:2},eligible=inventory.hotbarItems.filter(t=>caps[t]&&inventory.state(t)&&inventory.state(t).charges<caps[t]+(context.biggerPockets?1:0));if(eligible.length&&(!deps.random||typeof deps.random.range!=='function')){events.push('RewardRandomUnavailable');return events;}e.bountyRemaining=0;if(!eligible.length)state.coins=((state.coins||0)+75)|0;else inventory.grant(eligible[deps.random.range(0,eligible.length-1)],1,context);events.push('BountyClaimed');}else{e.bountyRemaining=Math.max(0,e.bountyRemaining-seconds);if(!e.bountyRemaining)events.push('BountyFailed');}}
  return events;
 }
 const limitations=['Native presentation, edge manager, timeline, music break lifecycle and store require explicit host hooks.','Table capacities intentionally differ from Inventory grant capacities; source grants may overfill.','Shield toggling does not consume; spawn eligibility must consume shield charges separately.'];
 const api={types,catalog,prepare,purchase,upgrade,equip,use,tick,limitations};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceItems=api;
})(globalThis);
