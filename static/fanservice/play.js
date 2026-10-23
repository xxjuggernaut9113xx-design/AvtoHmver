'use strict';
const $=id=>document.getElementById(id),store=FanserviceStore,rules=FanserviceRules,params=new URLSearchParams(location.search),library=params.get('library')||localStorage.getItem('fanservice-last-library')||'device:'+store.device;
const profileKey='fanservice-profile-v1:'+library,checkpointKey='fanservice-session-v1:'+library,audio=$('audio');
let sessionId=store.id(),profile,media=[],decks,remaining={},music,map,run,state,catalog,contract,started=false,paused=false,finished=false,settling=false,lastBeat=0,lastFrame=0,checkpointAt=0,category='slow',breakUntil=0,speed=1,pinnedPacks=[],restoring=false;
const clock={next:0,event:0,last:0},resources=[];
const mediaStatus=document.createElement('p');mediaStatus.id='media-status';mediaStatus.setAttribute('role','status');$('stage').after(mediaStatus);
for(const id of ['image','video'])FanserviceMedia.observe($(id),text=>mediaStatus.textContent=text);
function status(text){$('status').textContent=text;}
const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function action(text,fn){const button=element('button',text);button.type='button';button.onclick=()=>Promise.resolve().then(fn).catch(error=>status(error.message));return button;}
async function api(path){const response=await fetch(new URL(path,store.server()));const value=await response.json();if(!response.ok)throw Error(value.error||`Server ${response.status}`);return value;}
async function readJSON(path){const response=await fetch(path);if(!response.ok)throw Error('Gameplay specification unavailable: '+path);return response.json();}
const settingsPanel=element('section'),modeSelect=element('select'),objectiveSelect=element('select'),targetInput=element('input'),roundsInput=element('input'),objectiveLabel=element('label'),roundsLabel=element('label');
const lootChoice=element('input'),lootLabel=element('label','Enable loot bar');lootChoice.type='checkbox';lootChoice.id='loot-enabled';lootLabel.prepend(lootChoice);
settingsPanel.id='session-setup';settingsPanel.append(element('h2','Session setup'));
for(const [id,title] of [[0,'Classic'],[1,'Tower'],[2,'Soundtrack']]){const option=element('option',title);option.value=id;modeSelect.append(option);}modeSelect.id='mode';
for(const [index,spec] of FanserviceObjectives.specs.entries()){const option=element('option',spec.title);option.value=index;objectiveSelect.append(option);}objectiveSelect.id='objective';
targetInput.id='objective-target';targetInput.type='number';roundsInput.id='tower-rounds';roundsInput.type='number';roundsInput.min=1;roundsInput.max=1000;roundsInput.value=3;
const modeLabel=element('label','Mode');modeLabel.append(modeSelect);objectiveLabel.append('Objective',objectiveSelect,'Target',targetInput);roundsLabel.append('Tower rounds',roundsInput);settingsPanel.append(modeLabel,objectiveLabel,roundsLabel,lootLabel);
const towerPanel=element('section'),objectiveStatus=element('p');towerPanel.id='tower-draft';objectiveStatus.id='objective-status';objectiveStatus.setAttribute('role','status');
const inventoryDialog=element('dialog'),inventoryBody=element('div'),inventoryTitle=element('h2','Inventory and loadout');inventoryDialog.id='inventory-dialog';inventoryDialog.append(inventoryTitle,inventoryBody,action('Close inventory',()=>inventoryDialog.close()));
const challengeDialog=element('dialog'),challengeBody=element('div');challengeDialog.id='challenge-dialog';challengeDialog.append(element('h2','Challenges and modifiers'),challengeBody,action('Close challenges',()=>challengeDialog.close()));
document.body.append(inventoryDialog,challengeDialog);$('controls').before(settingsPanel,towerPanel,objectiveStatus);$('controls').append(action('Inventory / loadout',()=>{renderInventory();inventoryDialog.showModal();}),action('Challenges / modifiers',()=>{renderChallenges();challengeDialog.showModal();}));
function settingsChanged(){const mode=Number(modeSelect.value),spec=FanserviceObjectives.specs[Number(objectiveSelect.value)];objectiveLabel.hidden=mode!==0;roundsLabel.hidden=mode!==1;targetInput.min=spec.min;targetInput.max=spec.max;targetInput.step=spec.sliderStep;targetInput.value=spec.defaultTarget;targetInput.disabled=spec.objective===0;}
modeSelect.onchange=()=>{settingsChanged();if(run&&!started)installRun(makeRun());};objectiveSelect.onchange=settingsChanged;settingsChanged();
function makeRun(){
 const spec=FanserviceObjectives.specs[Number(objectiveSelect.value)],target=Number(targetInput.value),mode=Number(modeSelect.value);
 if(mode===2&&!music)throw Error('Select a confirmed soundtrack in Unlocks before starting Soundtrack mode.');
 if(mode!==2&&music)throw Error('Return to Unlocks and select Classic · no soundtrack for Classic or Tower.');
 if(!Number.isSafeInteger(target)||target<spec.min||target>spec.max)throw Error(`Objective target must be between ${spec.min} and ${spec.max}.`);
 const settings={...(profile.mobile_settings||{}),LastObjectiveIndex_Classic:Number(objectiveSelect.value),LootBarEnabled:lootChoice.checked};if(spec.saveKey)settings[spec.saveKey]=target;
 return new FanserviceRun.Run(catalog,{mode,rounds:Number(roundsInput.value),settings,difficulty:Number($('difficulty').value),lootEnabled:lootChoice.checked,maxBreaks:catalog.music_upgrades[1]['Value_L'+Math.max(1,Math.min(5,profile.mobile_music_upgrades?.[1]||1))],seed:run?.config.seed??crypto.getRandomValues(new Int32Array(1))[0],hotbar:run?.inventory.hotbarItems||profile.mobile_loadout,modifiers:profile.progression?.enabled_modifiers||[]});
}
function installRun(value){run=value;state=run.state;decks=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));remaining={};}
function draw(pool=category,{prepare=true}={}){
 category=pool;$('pool').value=pool;decks??=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));
 if(!decks[pool]?.length){status(`No ${pool} media in the frozen selection. Choose another pool or organize its tags in full fanservice.`);return false;}
 if(!remaining[pool]?.length)remaining[pool]=[...decks[pool]];
 const index=Math.floor(Math.random()*remaining[pool].length),item=remaining[pool].splice(index,1)[0],video=item.type==='video';
 $('image').hidden=video;$('video').hidden=!video;$('video').pause();
 if(video){$('video').src=item.url;if(started&&!paused)$('video').play().catch(error=>status('Video access failed: '+error.message));}else $('image').src=item.url;
 if(prepare){state.card={slow:0,medium:1,fast:2,succubus:3,cum:6,ass:7,boobs:8}[pool];state.canUseSlowdown=true;state.canUseBonerPill=true;if(started&&!finished&&run.phase==='playing')FanserviceEconomy.draw(run);}
 return true;
}
function beat(){scoreBeat();lastBeat=position();$('beat').style.background='#fff';setTimeout(()=>$('beat').style.background='#c8ef97',80);}
function scoreBeat(){
 if(!started||paused||finished||run.phase!=='playing'||state.seconds<breakUntil)return;
 for(const event of run.beat())if(event.type==='loot'){const reward=event.reward;status(reward.type===0?`Loot: ${reward.amount} coins${reward.tax?` · ${reward.tax} tax`:''}.`:reward.type===6?'Jackpot drop applied to equipped items.':reward.applied?`Loot: ${run.inventory.catalog.find(r=>r.type===reward.item)?.id||'item'} charge.`:'Loot item is already at capacity.');}
 if(run.config.mode===2){const level=Math.max(1,Math.min(5,profile.mobile_music_upgrades?.[2]||1)),threshold=catalog.music_upgrades[2]['Value_L'+level];if(state.strokes%threshold===0)run.inventory.grant(4,1,itemContext());}
 render();
}
function position(){return music?audio.currentTime:state?.seconds||0;}
function event(e){
 if(e.type==='media_change')draw(e.value);else if(e.type==='cycle_media')draw();
 else if(e.type==='text')$('caption').textContent=e.value;
 else if(e.type==='dialogue')window.FanserviceVoice?.say(e.value,text=>$('caption').textContent=text);
 else if(e.type==='cum_event'){run.player.isAllowedToCum=e.value==='start';if(e.value==='start')draw('cum');}
 else if(e.type==='disable_break')state.breakSectionDisabled=e.value==='start';
 else if(e.type==='restore_break')state.breakSectionDisabled=false;
 else if(e.type==='grant_break')run.inventory.grant(4,1,itemContext());
 else if(e.type==='background')$('stage').style.background=`radial-gradient(ellipse at bottom,hsl(${Number(e.value)*43} 40% 25%),#101722)`;
 else if(e.type==='edge'){$('caption').textContent='Edge checkpoint.';}
}
function checkpoint(force=false){
 if(!started||finished||!run)return;const now=performance.now();if(!force&&now-checkpointAt<1000)return;checkpointAt=now;
 try{localStorage.setItem(checkpointKey,JSON.stringify({version:1,id:sessionId,library,server:store.server(),run:run.export(),media,music,clock:{...clock},position:position(),lastBeat,category,breakUntil,speed,pinnedPacks}));}
 catch(error){status('Session checkpoint could not be saved: '+error.message);}
}
function renderTower(){
 towerPanel.replaceChildren();if(!run?.tower)return;
 towerPanel.append(element('h2',`Tower · round ${run.tower.round}${run.phase==='selection'?'+1':''} of ${run.tower.rounds}`));
 if(run.phase==='selection')for(const [index,option] of run.tower.options.entries()){
  const spec=FanserviceObjectives.specs.find(s=>s.objective===option.objective),row=element('article');
  row.append(element('p',`${spec?.title||'Objective'} · ${option.parameter} · tier ${option.tier} · ${option.modifiers.join(', ')||'No modifiers'}`),action(`Choose Tower option ${index+1}`,()=>{
   run.select(index);decks=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));remaining={};draw();checkpoint(true);renderTower();render();
  }));towerPanel.append(row);
 }
 if(['shop','round-complete'].includes(run.phase))towerPanel.append(element('p',run.phase==='shop'?'Round complete. Shop available.':'Round complete.'),action('Continue Tower',()=>{run.continue();checkpoint(true);renderTower();}));
}
function render(){
 if(!state)return;
 $('meter').value=Math.min(state.meter,1);$('stats').textContent=`${state.strokes} beats · combo ${state.combo} (${rules.comboTier(state.combo)}) · ${state.coins} coins · ${state.succuCoins} SuccuCoins · heat ${state.heat.toFixed(1)} · ${Math.floor(state.seconds)} seconds${run.config.lootEnabled?` · loot ${Math.floor(Math.max(0,state.lootBar)*100)}%`:''}`;
 const objective=run.roundObjective||run.objective.state,spec=FanserviceObjectives.specs.find(s=>s.objective===objective.objective);
 objectiveStatus.textContent=(run.tower?`Tower ${run.phase}. `:'')+(spec?`${spec.title}: ${objective.target}. `:'')+(run.objective.releaseDeadline===null?'':`Release window: ${Math.max(0,Math.ceil(run.objective.releaseDeadline-state.seconds))} seconds.`)+(state.seconds<breakUntil?` Break: ${Math.ceil(breakUntil-state.seconds)} seconds.`:'');
 $('finish').disabled=!started||finished||run.phase!=='playing'||(!run.player.isAllowedToCum&&state.meter<1);
 $('draw').disabled=$('tap').disabled=!started||finished||paused||run.phase!=='playing';
}
function objectiveEvents(events){
 if(events.some(e=>e.type==='release-window-opened')){draw('cum');status('Objective complete. 60 second release window.');}
 if(events.some(e=>e.type==='objective-reset'))status('Release window closed. Objective reset.');
 if(events.some(e=>['round-complete','round-failed'].includes(e.type))||run.phase!=='playing')renderTower();
 if(run.phase==='complete'&&!settling&&!finished)void end(!!state.won);
}
function tick(now){
 const delta=lastFrame?Math.max((now-lastFrame)/1000,0):0;lastFrame=now;
 if(started&&!paused&&!finished&&run.phase==='playing'){
  const advancing=!music||!audio.paused&&!audio.seeking&&audio.readyState>=3;
  if(advancing){
   const events=run.advance(delta);objectiveEvents(events);
   if(!finished&&run.phase==='playing'){
    if(music)rules.schedule(map,position(),clock,{beat,event});
    else{const interval=[.7,.5,.35][Number($('difficulty').value)]/speed*(FanserviceEconomy.has(run,6)?2:1);if(state.seconds>=breakUntil&&position()-lastBeat>=interval)beat();}
    const itemState=readItemState();for(const result of FanserviceItems.tick(run.inventory,itemState,delta,itemDependencies())){
     if(result==='BountyClaimed')state.BountiesCollected=(state.BountiesCollected||0)+1;
     if(result==='BountyFailed')state.BountyCollectionFailures=(state.BountyCollectionFailures||0)+1;
     if(result==='StoreOpened')FanserviceEconomy.itemUsed(run,7,run.inventory.catalog.find(r=>r.type===7)?.classification);
    }writeItemState(itemState);
   }
   checkpoint();
  }
  const interval=music?60/map.meta.bpm:[.7,.5,.35][Number($('difficulty').value)];$('beat').style.left=`${50+Math.max(-1,Math.min(1,(position()-lastBeat)/interval))*45}%`;render();
 }
 requestAnimationFrame(tick);
}
async function mutateProfile(fn){
 const write=()=>{const current=JSON.parse(localStorage.getItem(profileKey)||'null');if(!current)throw Error('The active profile is no longer available.');const next=fn(current);localStorage.setItem(profileKey,JSON.stringify(next));profile=next;return next;};
 return navigator.locks?.request?navigator.locks.request('fanservice-profile:'+profileKey,write):write();
}
async function end(won){
 if(finished||settling)return;settling=true;window.FanserviceVoice?.stop();audio.pause();$('video').pause();
 if(!started){status('Session canceled; no rewards were granted.');settling=false;return;}
 state.won=won;state.finished=true;
 try{
  await mutateProfile(current=>{const next=FanserviceProgression.settleSession(FanserviceProgression.startSession(current,contract),state,sessionId,contract);next.mobile_settings={...next.mobile_settings,...run.config.settings};next.mobile_loadout=[...run.inventory.hotbarItems];return next;});
  finished=true;await releasePins();localStorage.removeItem(checkpointKey);
  $('summary').textContent=`${won?'Session completed':'Session ended'}\n${profile.progression.last_settlement.xp} XP · ${state.coins} coins · ${profile.progression.last_settlement.unlock_points} UP\nLevel ${profile.progression.level} · ${profile.progression.xp} XP toward next level\nRewards saved once. Pack ownership was retained.`;
  status('Session saved. Return to the library to resolve live pack contents again.');for(const id of ['start','pause','tap','draw','finish','end'])$(id).disabled=true;renderTower();
 }catch(error){state.finished=false;status('Rewards could not be saved: '+error.message);checkpoint(true);}
 finally{settling=false;}
}
function itemContext(){const levels=profile.mobile_music_upgrades||[1,1,1],value=type=>catalog.music_upgrades[type]['Value_L'+Math.max(1,Math.min(5,levels[type]||1))];return {mode:run.config.mode,manager:true,maxBreaks:value(1),breakDuration:value(0),minimumBeatInterval:0,biggerPockets:run.ownedModifiers.includes(13),allOrNothing:state.modifiers.includes('All or Nothing')};}
function readItemState(){return {...state,_baseline:{...state},cumMeter:state.meter,cardType:state.card,strokeCount:state.strokes,beatInterval:[.7,.5,.35][Number($('difficulty').value)]/speed,beatsRemaining:music?map.beats.length-clock.next:1,canUseItems:state.canUseItems!==false&&FanserviceModifiers.options(state.modifiers).canUseItems&&!state.breakSectionDisabled&&state.seconds>=breakUntil};}
function writeItemState(value){for(const key of ['heat','combo','coins','effects','metrics','canUseSlowdown','canUseBonerPill','coinMultiplier','lootBarMultiplier','shieldToggled'])if(value[key]!==value._baseline[key])state[key]=value[key];if(value.cumMeter!==value._baseline.meter)state.meter=value.cumMeter;}
function itemDependencies(){return {context:itemContext(),random:run.random,hooks:{
 recycler:()=>FanserviceEconomy.recycler(run),
 panicBlocked:(type,s)=>FanserviceModifiers.panicBlocked(run.inventory.catalog.find(r=>r.type===type)?.id,s.heat,state.modifiers),
 speed:multiplier=>{if(music)return false;speed*=multiplier;return true;},
 beginBreak:duration=>{if(state.breakSectionDisabled||state.seconds<breakUntil)return false;breakUntil=state.seconds+duration;if(music){state.MusicBreaksUsed=(state.MusicBreaksUsed||0)+1;}return true;},
 pill:effect=>{if(music)return false;speed*=effect.speed;return true;},
 openStore:()=>{if(run.tower&&run.phase==='playing')return false;renderInventory(true);if(!inventoryDialog.open)inventoryDialog.showModal();return true;},
 spawnSuccubus:()=>FanserviceModifiers.options(state.modifiers).canSpawnSuccubi&&draw('succubus'),
 escape:()=>{if(music)return false;return draw();}
 }};}
function renderInventory(storeEvent=false){
 inventoryBody.replaceChildren();const shop=run.phase==='shop'||storeEvent;inventoryBody.append(element('p',`${state.coins} session coins. ${shop?'Shop open.':'Equip items before play; purchases require an active shop.'}`));
 for(const row of run.inventory.catalog){const owned=run.inventory.state(row.type);if(!owned?.unlocked)continue;const box=element('article'),index=Math.max(0,Math.min(4,owned.level-1));box.append(element('p',`${row.source['Level'+owned.level+'TooltipTitle']} · level ${owned.level} · ${owned.charges} charges`));
  const slot=element('select');slot.setAttribute('aria-label','Slot for '+row.id);for(let i=0;i<5;i++){const option=element('option','Slot '+(i+1));option.value=i;slot.append(option);}box.append(slot,action('Equip '+row.id,()=>{if(started&&run.phase!=='shop')throw Error('Change the loadout before play or in a Tower shop.');const result=FanserviceItems.equip(run.inventory,row.type,Number(slot.value));if(!result.ok)throw Error(result.reason);checkpoint(true);renderInventory(storeEvent);}));
  const buy=action(`Buy ${row.id} · ${row.purchaseCosts[index]}`,()=>{const result=FanserviceItems.purchase(run.inventory,row.type,state,itemContext());if(!result.ok)throw Error(result.reason);state.MoneySpent=(state.MoneySpent||0)+result.cost;checkpoint(true);renderInventory(storeEvent);});buy.disabled=!shop;box.append(buy);
  const upgrade=action(`Upgrade ${row.id} · ${row.upgradeCosts[index]}`,()=>{const result=FanserviceItems.upgrade(run.inventory,row.type,state);if(!result.ok)throw Error(result.reason);state.MoneySpent=(state.MoneySpent||0)+result.cost;checkpoint(true);renderInventory(storeEvent);});upgrade.disabled=!shop||!row.upgradeable||owned.level>=5;box.append(upgrade);
  const use=action('Use '+row.id,()=>{if(!started||paused||finished||run.phase!=='playing')throw Error('Start an active round before using items.');if(!run.inventory.hotbarItems.includes(row.type))throw Error('Equip this item first.');const value=readItemState(),result=FanserviceItems.use(run.inventory,row.type,value,itemDependencies());if(!result.ok)throw Error(result.reason);writeItemState(value);if(result.consumed)FanserviceEconomy.itemUsed(run,row.type,row.classification);checkpoint(true);renderInventory(storeEvent);render();});use.disabled=!owned.charges||!started||paused||finished;box.append(use);inventoryBody.append(box);
 }
 inventoryBody.append(element('p','Loadout: '+run.inventory.hotbarItems.map(type=>run.inventory.catalog.find(r=>r.type===type)?.id||'Empty').join(' · ')));
 if(shop){inventoryBody.append(element('h3',`Succu shop · ${state.succuCoins} SuccuCoins`));for(const row of FanserviceEconomy.catalog.filter(row=>FanserviceEconomy.shopIds.includes(row.id))){const owned=FanserviceEconomy.has(run,row.id),box=element('article');box.append(element('strong',row.title),element('p',row.description));const buy=action(owned?'Owned '+row.title:`Buy ${row.title} · ${row.cost} SuccuCoins`,()=>{const result=FanserviceEconomy.purchase(run,row.id);if(!result.ok)throw Error(result.reason);checkpoint(true);renderInventory(storeEvent);render();});buy.disabled=owned||state.succuCoins<row.cost;box.append(buy);inventoryBody.append(box);}}
}
function renderChallenges(){
 challengeBody.replaceChildren();const fresh=JSON.parse(localStorage.getItem(profileKey)||'null')||profile;
 for(const definition of FanserviceProgression.definitions(contract)){const progress=fresh.progression?.challenge_progress?.[definition.id],row=element('article');row.append(element('strong',definition.name),element('p',definition.description),element('p',progress?.claimed?'Claimed':progress?.completed?'Complete':`${definition.scope} challenge`));if(progress?.completed&&!progress.claimed)row.append(action('Claim '+definition.name,async()=>{await mutateProfile(value=>FanserviceProgression.claimChallenge(value,definition.id,contract));renderChallenges();}));challengeBody.append(row);}
 challengeBody.append(element('h3','Modifiers'));
 for(const definition of FanserviceModifiers.definitions(contract)){const unlocked=fresh.progression?.unlocked_modifiers?.includes(definition.id),enabled=fresh.progression?.enabled_modifiers?.includes(definition.id),row=element('article');row.append(element('strong',definition.name),element('p',definition.description));const toggle=action((enabled?'Disable ':'Enable ')+definition.name,async()=>{await mutateProfile(value=>FanserviceModifiers.toggle(value,definition.id,!enabled));if(!started){run.config.modifiers=profile.progression.enabled_modifiers;state.modifiers=[...run.config.modifiers];decks=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));}renderChallenges();});toggle.disabled=!unlocked||started;row.append(toggle);challengeBody.append(row);}
}
$('start').onclick=async()=>{
 try{
  if(!media.length)throw Error('No playable media.');if(finished||started)return;
  if(!run.resumed){const equipped=[...run.inventory.hotbarItems];installRun(makeRun());run.inventory.hotbarItems=equipped.map(type=>run.inventory.state(type)?type:8);}
  window.FanserviceVoice?.unlock().catch(()=>{});
  if(music){await audio.play();if(Math.abs(audio.duration-music.duration)>.35){audio.pause();throw Error('Recording duration differs from the confirmed beatmap.');}}
  started=true;lastFrame=performance.now();$('start').disabled=true;$('difficulty').disabled=true;for(const input of settingsPanel.querySelectorAll('input,select'))input.disabled=true;
  $('pause').disabled=false;draw(category,{prepare:!run.resumed});renderTower();render();checkpoint(true);status('Playing locally with the session selection frozen.');if(run.phase==='complete')await end(!!state.won);
 }catch(error){status(error.message);}
};
$('pause').onclick=()=>{if(!started||finished)return;paused=!paused;if(paused){window.FanserviceVoice?.stop();audio.pause();$('video').pause();checkpoint(true);}else{lastFrame=performance.now();if(music)audio.play().catch(error=>status(error.message));if(!$('video').hidden)$('video').play().catch(error=>status(error.message));}$('pause').textContent=paused?'Resume':'Pause';render();};
function tap(){if(started&&!paused&&!finished&&!music&&run.phase==='playing')draw();}
$('tap').onclick=tap;$('draw').onclick=()=>draw();$('pool').onchange=()=>draw($('pool').value);
$('finish').onclick=()=>{if($('finish').disabled)return;if(state.meter>=1&&!run.player.isAllowedToCum)objectiveEvents(run.advance(0));objectiveEvents(run.climax());};$('end').onclick=()=>end(false);
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();tap();}else if(e.code==='Enter'&&!$('finish').disabled)$('finish').click();});
audio.addEventListener('waiting',()=>status('Buffering: rhythm clock is held at the actual playback position.'));audio.addEventListener('playing',()=>status('Playing from the client audio clock.'));audio.addEventListener('ended',()=>{if(state)state.BestMusicModeWinRounds=1;void end(true);});audio.addEventListener('error',()=>status('Soundtrack access failed. Reconnect or use an explicitly saved snapshot.'));
audio.addEventListener('seeking',()=>{clock.last=audio.currentTime-2;clock.next=0;clock.event=0;});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started&&!paused&&!finished)$('pause').click();});
window.addEventListener('pagehide',()=>checkpoint(true));
async function releasePins(){await Promise.all(pinnedPacks.map(packId=>store.releaseSession(sessionId+':'+packId)));pinnedPacks=[];}
async function restoreMedia(item){
 if(item.storage_key){const saved=await store.get('files',item.storage_key);if(!saved?.blob)throw Error('Active-session media was removed or evicted.');const url=URL.createObjectURL(saved.blob);resources.push(url);return {...item,url};}
 if(item.local){const result=await store.resolveLocal({local_ids:[item.id.replace(/^local:/,'')]},store.device);if(result.unavailable)throw Error('Active-session local file is unavailable.');return result.media[0];}
 return item;
}
(async()=>{
 profile=JSON.parse(localStorage.getItem(profileKey)||'null');if(!profile)throw Error('No game profile on this device. Create and enable a pack first.');
 lootChoice.checked=!!profile.mobile_settings?.LootBarEnabled;
 [catalog,contract]=await Promise.all([readJSON('data/modes.json'),readJSON('data/native-contract.json')]);
 const saved=JSON.parse(localStorage.getItem(checkpointKey)||'null');
 if(saved){
  restoring=true;
  if(saved.version!==1||saved.library!==library||saved.server!==store.server())throw Error('An unfinished session belongs to a different Server or unsupported version.');
  sessionId=saved.id;pinnedPacks=saved.pinnedPacks||[];media=await Promise.all(saved.media.map(restoreMedia));music=saved.music;if(music?.storage_key)music=await restoreMedia(music);installRun(FanserviceRun.Run.restore(catalog,saved.run));run.resumed=true;Object.assign(clock,saved.clock);lastBeat=saved.lastBeat??saved.position??0;category=saved.category;breakUntil=saved.breakUntil||0;speed=saved.speed||1;settingsPanel.hidden=true;$('source').textContent='Unfinished session restored · frozen membership';
 }else{
  const manifests={},enabled=profile.packs.filter(pack=>pack.owned&&pack.enabled);
  if(params.has('snapshot')){
   const selected=enabled.find(pack=>pack.id===params.get('snapshot'));if(!selected)throw Error('Enable this owned snapshot pack before playing it.');let savedAt;
   for(const pack of enabled){if(pack.id===selected.id||pack.selection.ids.length||pack.selection.rules.length){const snapshot=await store.pinSnapshot(pack.id,sessionId+':'+pack.id);pinnedPacks.push(pack.id);if(snapshot.library_id!==pack.library_id)throw Error(`Pack ${pack.name}: saved snapshot belongs to another library.`);manifests[pack.id]={library_id:snapshot.library_id,media:snapshot.media};if(pack.id===selected.id){music=snapshot.music;savedAt=snapshot.saved_at;}}else{const local=await store.resolveLocal(pack.selection,pack.device_id);if(local.unavailable)throw Error(`Pack ${pack.name} has ${local.unavailable} unavailable device-local members.`);manifests[pack.id]={library_id:pack.library_id,media:local.media};}}
   $('source').textContent=`Saved snapshots · ${enabled.length} enabled packs · ${savedAt}`;
  }else{
   for(const pack of enabled){const manifest=pack.selection.ids.length||pack.selection.rules.length?await api('/api/fanservice/v1/resolve?selection='+encodeURIComponent(JSON.stringify({ids:pack.selection.ids,rules:pack.selection.rules}))):{library_id:pack.library_id,media:[]};const local=await store.resolveLocal(pack.selection,pack.device_id);if(local.unavailable)throw Error(`Pack ${pack.name} has ${local.unavailable} unavailable device-local members.`);manifest.media=manifest.media.map(item=>({...item,url:new URL(item.url,store.server()).href}));manifest.media.push(...local.media);manifests[pack.id]=manifest;}
   const track=Number(params.get('track'));if(track)music=await api(`/api/fanservice/v1/music/${track}/manifest`);$('source').textContent='Live contents resolved · frozen for this session';
  }
  media=FanserviceModel.freezeSession(profile,manifests).media;if(music)modeSelect.value=2;settingsChanged();installRun(makeRun());
 }
 if(saved)$('difficulty').value=String(run.config.difficulty??1);
 const missing=['slow','medium','fast','succubus','cum'].filter(pool=>!decks[pool].length);if(missing.length)throw Error('Enabled packs lack required gameplay pools: '+missing.join(', ')+'. Enable complementary packs or organize their tags in full fanservice.');
 if(music){map=music.beatmap;audio.src=music.url||new URL(music.stream_url,store.server());audio.hidden=false;if(saved)audio.addEventListener('loadedmetadata',()=>{audio.currentTime=saved.position;},{once:true});}
 draw(category,{prepare:!saved});renderTower();render();$('start').disabled=false;status(saved?'Unfinished session ready. Tap Start to resume.':'Ready. Tap Start to enable local playback and audio.');requestAnimationFrame(tick);
})().catch(async error=>{status(error.message);$('start').disabled=true;if(!started&&!restoring)await releasePins().catch(()=>{});if(restoring)settingsPanel.append(action('Discard unfinished session',async()=>{if(!confirm('Discard this unfinished session without granting rewards? Saved library media and pack ownership are retained.'))return;await releasePins();localStorage.removeItem(checkpointKey);location.reload();}));});
