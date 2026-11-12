'use strict';
const $=id=>document.getElementById(id),store=FanserviceStore,rules=FanserviceRules,params=new URLSearchParams(location.search),library=params.get('library')||store.savedLibrary()||'device:'+store.device;
const profileKey='fanservice-profile-v1:'+library,checkpointKey='fanservice-session-v1:'+library,audio=$('audio');
let sessionId=store.id(),profile,media=[],decks,remaining={},music,map,soundtrackWarnings,run,state,catalog,contract,cardRules,started=false,paused=false,finished=false,settling=false,lastBeat=0,lastFrame=0,checkpointAt=0,category='slow',breakUntil=0,speed=1,pinnedPacks=[],restoring=false,currentMedia=null,mediaPosition=0,restoredView=null,keepMediaOnReplay=false,pendingMediaSeek=null,mediaSeekToken=0;
const clock={next:0,event:0,last:0},resources=[],finishButton=$('finish');
let specialEvents;
let favorites=null;
let musicBuffering=false,musicLeadIn=0,musicStarting=false,restorePosition=null;
let finishHold;
const mediaStatus=document.createElement('p');mediaStatus.id='media-status';mediaStatus.setAttribute('role','status');$('voice-status').after(mediaStatus);
const meterValue=document.createElement('span');meterValue.id='meter-value';$('meter').after(meterValue);
for(const id of ['image','video'])FanserviceMedia.observe($(id),text=>{mediaStatus.textContent=text;if(/failed|unavailable|error/i.test(text))status(text);});
function status(text){$('status').textContent=text;}
const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function action(text,fn){const button=element('button',text);button.type='button';button.onclick=()=>Promise.resolve().then(fn).catch(error=>status(error.message));return button;}
async function api(path){store.assertServer();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch(new URL(path,store.server()),{credentials:'same-origin',signal:controller.signal});const value=await response.json();store.assertServer();if(value.library_id!==undefined&&value.library_id!==library)throw Error('The Server library identity changed. Return to the library before starting another session.');if(!response.ok)throw Error(value.error||`Server ${response.status}`);return value;}catch(error){if(controller.signal.aborted)throw Error('Server request timed out. Saved phone files and snapshots remain available.');throw error;}finally{clearTimeout(timer);}}
async function readJSON(path){const response=await fetch(path);if(!response.ok)throw Error('Gameplay specification unavailable: '+path);return response.json();}
const settingsPanel=element('section'),modeSelect=element('select'),objectiveSelect=element('select'),targetInput=element('input'),roundsInput=element('input'),objectiveLabel=element('label'),roundsLabel=element('label');
const lootChoice=element('input'),lootLabel=element('label','Enable loot bar');lootChoice.type='checkbox';lootChoice.id='loot-enabled';lootLabel.prepend(lootChoice);
const frenzyChoice=element('input'),frenzyLabel=element('label','Include body-part frenzy events');frenzyChoice.type='checkbox';frenzyChoice.id='frenzy-enabled';frenzyLabel.prepend(frenzyChoice);
settingsPanel.id='session-setup';settingsPanel.append(element('h2','Session setup'));
for(const [id,title] of [[0,'Classic'],[1,'Tower'],[2,'Soundtrack']]){const option=element('option',title);option.value=id;modeSelect.append(option);}modeSelect.id='mode';
for(const [index,spec] of FanserviceObjectives.specs.entries()){const option=element('option',spec.title);option.value=index;objectiveSelect.append(option);}objectiveSelect.id='objective';
targetInput.id='objective-target';targetInput.type='number';roundsInput.id='tower-rounds';roundsInput.type='number';roundsInput.min=1;roundsInput.max=1000;roundsInput.value=3;
const modeLabel=element('label','Mode');modeLabel.append(modeSelect);objectiveLabel.append('Objective',objectiveSelect,'Target',targetInput);roundsLabel.append('Tower rounds',roundsInput);settingsPanel.append(modeLabel,objectiveLabel,roundsLabel,lootLabel,frenzyLabel);
const wakeChoice=element('input'),wakeLabel=element('label','Keep screen awake during play'),wakeStatus=element('p');
const wakePreference='fanservice-keep-awake';
wakeChoice.type='checkbox';wakeChoice.checked=localStorage.getItem(wakePreference)!=='off';wakeLabel.prepend(wakeChoice);
wakeStatus.setAttribute('role','status');
$('session-statistics').after(wakeLabel,wakeStatus);
let wakeWanted=false,wakePending=false,wakeHandle=null,pageHidden=false;
function wakeMessage(text){if(wakeStatus.textContent!==text)wakeStatus.textContent=text;}
async function requestScreenWake(){
 if(!wakeWanted||wakePending||wakeHandle)return;
 const cap=window.Capacitor;
 const native=cap?.isNativePlatform?.()&&cap.isPluginAvailable?.('ScreenWake')?cap.Plugins.ScreenWake:null;
 if(!native&&!navigator.wakeLock){wakeMessage('Screen wakefulness is unavailable on this device.');return;}
 wakePending=true;
 try{
  let handle;
  if(native){
   await native.setEnabled({enabled:true});
   handle={release:()=>native.setEnabled({enabled:false})};
  }else{
   handle=await navigator.wakeLock.request('screen');
   handle.addEventListener('release',()=>{
    if(wakeHandle===handle){wakeHandle=null;wakeMessage('The device released screen wakefulness.');}
   });
  }
  if(!wakeWanted){
   await handle.release();
   if(wakeWanted)queueMicrotask(requestScreenWake);
   return;
  }
  if(handle.released){wakeMessage('The device released screen wakefulness.');return;}
  wakeHandle=handle;
  wakeMessage('Screen wakefulness is active.');
 }catch{
  if(wakeWanted)wakeMessage('Screen wakefulness could not be enabled.');
 }finally{
  wakePending=false;
 }
}
function updateScreenWake(){
 const wanted=wakeChoice.checked&&started&&!paused&&!finished&&!settling&&!document.hidden&&!pageHidden&&run.phase==='playing';
 if(!wanted){
  const handle=wakeHandle;
  wakeHandle=null;
  if(handle)void handle.release().catch(()=>{if(!wakeWanted)wakeMessage('The screen wakefulness release could not be confirmed.');});
  wakeMessage(wakeChoice.checked?'Screen wakefulness applies during active play.':'Screen wakefulness is off.');
 }else if(!wakeWanted){
  wakeWanted=true;
  void requestScreenWake();
 }
 wakeWanted=wanted;
}
wakeChoice.onchange=()=>{
 localStorage.setItem(wakePreference,wakeChoice.checked?'on':'off');
 updateScreenWake();
};
updateScreenWake();
const vibrationMode=element('select'),vibrationLabel=element('label','Gameplay vibration'),vibrationStatus=element('p');
const vibrationPreference='fanservice-vibration-mode';
for(const [value,label] of [['off','Off'],['event','Before next event'],['beat','Every beat']]){
 const option=element('option',label);
 option.value=value;
 vibrationMode.append(option);
}
vibrationMode.value=FanserviceVibration.normalize(localStorage.getItem(vibrationPreference));
vibrationLabel.append(vibrationMode);
vibrationStatus.setAttribute('role','status');
wakeStatus.after(vibrationLabel,vibrationStatus);
const capacitor=window.Capacitor;
const nativeVibration=capacitor?.isNativePlatform?.()&&capacitor.isPluginAvailable?.('GameplayVibration')?capacitor.Plugins.GameplayVibration:null;
let canVibrate=typeof navigator.vibrate==='function'||!!nativeVibration;
function vibrationMessage(text){if(vibrationStatus.textContent!==text)vibrationStatus.textContent=text;}
function pulseVibration(duration){
 if(!canVibrate)return;
 if(nativeVibration){
  nativeVibration.pulse({duration}).catch(()=>{if(duration)vibrationMessage('The device declined the vibration request.');});
 }else if(!navigator.vibrate(duration)&&duration){
  vibrationMessage('The browser declined the vibration request.');
 }
}
function updateVibrationStatus(){
 vibrationMessage(!canVibrate?'Gameplay vibration is unavailable on this device.':vibrationMode.value==='off'?'Gameplay vibration is off.':'');
}
if(nativeVibration){
 nativeVibration.available().then(({available})=>{canVibrate=available;updateVibrationStatus();}).catch(()=>{
  canVibrate=false;
  updateVibrationStatus();
 });
}
const vibration=FanserviceVibration.create(pulseVibration,vibrationMode.value);
vibrationMode.onchange=()=>{
 localStorage.setItem(vibrationPreference,vibrationMode.value);
 vibration.mode(vibrationMode.value);
 updateVibrationStatus();
};
updateVibrationStatus();
function vibrationDeadlines(){
 const deadlines=[];
 if(breakUntil>state.seconds)deadlines.push(breakUntil);
 const edge=state.edge;
 if(edge?.phase==='rest'||edge?.phase==='mercy-rest')deadlines.push(edge.deadline);
 if(edge?.until>1){
  if(edge.phase==='handoff')deadlines.push(edge.deadline+(edge.postBreak>=2&&!edge.perfect?edge.holdRemaining:0));
  if(edge.phase==='hold'&&state.card!==6)deadlines.push(edge.nextTick+edge.holdRemaining-1);
 }
 const round=run.roundObjective;
 if(round?.active&&(round.objective===6||round.objective===1&&run.context().phase!=='bossRound')){
  deadlines.push(round.baselineDuration+round.target);
 }
 if(round&&run.objective.releaseDeadline!==null&&run.objective.settings['DoesNotCummingInWindowResetObjective?']===false){
  deadlines.push(run.objective.releaseDeadline);
 }
 return deadlines;
}
const towerPanel=element('section'),objectiveStatus=element('p');towerPanel.id='tower-draft';objectiveStatus.id='objective-status';objectiveStatus.setAttribute('role','status');
const inventoryDialog=element('dialog'),inventoryBody=element('div'),inventoryTitle=element('h2','Inventory and loadout');inventoryDialog.id='inventory-dialog';inventoryDialog.append(inventoryTitle,inventoryBody,action('Close inventory',()=>inventoryDialog.close()));
const challengeDialog=element('dialog'),challengeBody=element('div');challengeDialog.id='challenge-dialog';challengeDialog.append(element('h2','Challenges and modifiers'),challengeBody,action('Close challenges',()=>challengeDialog.close()));
const inventoryAction=action('Inventory / loadout',()=>{renderInventory();inventoryDialog.showModal();}),challengeAction=action('Challenges / modifiers',()=>{renderChallenges();challengeDialog.showModal();});
document.body.append(inventoryDialog,challengeDialog);$('status').after(towerPanel,objectiveStatus);$('controls').append(inventoryAction,challengeAction);
const holdingHand=element('select'),holdingLabel=element('label','Holding hand');
const holdingPreference='fanservice-holding-hand',itemControls=$('item-controls');
for(const [value,label] of [['left','Left hand'],['right','Right hand']]){
 const option=element('option',label);
 option.value=value;
 holdingHand.append(option);
}
holdingHand.value=localStorage.getItem(holdingPreference)==='left'?'left':'right';
holdingLabel.append(holdingHand);
vibrationStatus.after(holdingLabel);
function applyHoldingHand(){
 $('gameplay-stage').dataset.holdingHand=holdingHand.value;
}
holdingHand.onchange=()=>{
 localStorage.setItem(holdingPreference,holdingHand.value);
 applyHoldingHand();
};
applyHoldingHand();
const itemButtons=Array.from({length:5},(_,slot)=>{
 const button=action('',()=>{useItem(run.inventory.hotbarItems[slot]);render();});
 button.hidden=true;
 itemControls.append(button);
 return button;
});
function canAttemptItem(owned){
 return started&&!paused&&!finished&&!settling&&run.phase==='playing'&&owned?.unlocked&&owned.charges>0;
}
function renderItemControls(){
 const inventory=run.inventory;
 for(const [slot,button] of itemButtons.entries()){
  const type=inventory.hotbarItems[slot],item=inventory.state(type);
  const row=item?.unlocked&&inventory.catalog.find(entry=>entry.type===type);
  button.hidden=false;
  if(type===6)button.setAttribute('aria-pressed',String(!!state.shieldToggled));else button.removeAttribute('aria-pressed');
  if(!row){button.dataset.compactLabel='-';button.disabled=true;button.textContent='—';button.title='Empty slot '+(slot+1);button.setAttribute('aria-label','Empty slot '+(slot+1));continue;}
  button.disabled=!canAttemptItem(item);
  button.dataset.compactLabel=(row.title.replace(/[^A-Z]/g,'').slice(0,2)||row.title.slice(0,2))+' '+item.charges;
  const text=row.title+' · '+item.charges;
  if(button.textContent!==text){
   button.textContent=text;button.title=text;
   button.setAttribute('aria-label','Use '+row.title+' · '+item.charges+' charges');
  }
 }
 itemControls.hidden=!started||finished;
}
const edgePanel=element('section'),edgeButton=action('Edge / E',()=>triggerEdge());edgePanel.id='edge-panel';edgeButton.id='edge-action';edgeButton.setAttribute('aria-label','Edge / E');edgePanel.setAttribute('aria-live','polite');objectiveStatus.after(edgePanel);$('controls').append(edgeButton);
const tauntButton=action('Taunt',()=>triggerTaunt());tauntButton.id='taunt-action';tauntButton.setAttribute('aria-label','Taunt');$('controls').append(tauntButton);
function renderTaunt(){tauntButton.hidden=!started||finished||!!music;}
const favoriteButton=action('Favorite',()=>toggleFavorite());favoriteButton.id='favorite-action';favoriteButton.setAttribute('aria-label','Favorite');$('controls').append(favoriteButton);
function renderFavorite(){favoriteButton.hidden=!started||finished||!!music;favoriteButton.disabled=!currentMedia||!favorites;favoriteButton.textContent=currentMedia&&favorites?.isFavorite(currentMedia)?'Unfavorite':'Favorite';}
function toggleFavorite(){
 if(!started||paused||finished||!currentMedia||music||!favorites)return;
 const result=favorites.toggleFavorite(currentMedia);
 // Native ToggleFavorite moves the entry out of the master pool only; the
 // remaining-deck copy lingers until that deck exhausts and refills from
 // master. Unfavorite restores it to the master and remaining decks.
 refreshFavoriteInDecks(currentMedia,result.isFavorite);
 status(result.isFavorite?`Favorited ${currentMedia.file||currentMedia.id}.`:`Unfavorited ${currentMedia.file||currentMedia.id}.`);
 checkpoint(true);render();
}
function refreshFavoriteInDecks(item,isFavorite){
 const pools=['slow','medium','fast','succubus','cum','ass','boobs'];
 const tags=(item.tags||[]).map(tag=>String(tag).toLowerCase());
 const belongs=pools.filter(name=>tags.includes(name));if(!belongs.length)belongs.push('slow');
 for(const pool of pools){
  if(!decks[pool])continue;
  const at=decks[pool].findIndex(entry=>entry.id===item.id);
  if(isFavorite){if(at>=0)decks[pool].splice(at,1);}
  else if(belongs.includes(pool)&&at<0)decks[pool].push(item);
  if(remaining[pool]&&!isFavorite&&belongs.includes(pool)){
   const remainingAt=remaining[pool].findIndex(entry=>entry.id===item.id);
   if(remainingAt<0)remaining[pool].push(item);
  }
 }
}
let edgeView='';
function triggerEdge(){
 if(!started||paused||finished||!FanserviceEdge.allowed(run))return;
 // Hotbar stmt 32: the Edge button rolls punishment when the current card is
 // an edge card (byte 5) and edges are available; a trigger spawns the
 // punishment event and blocks the edge (TriggerEdgeV2 never runs). The
 // direct edge (any other card) has no roll site — it is the session
 // widget's E direct action, not the hotbar button. ActivateItem(2), called
 // first by the button flow (stmt 26), is a no-op: the ActivateItem switch
 // has no case for type 2. EdgeAvailable has no player counterpart (a
 // loot-granted edge count in the original; GiveEdge increments it, and the
 // player models edges as always available when allowed()), so allowed() is
 // the availability gate here. The roll reads TotalTauntsUsed, the same
 // input as the item sites (play.js:521). The roll is skipped at a 0% rate
 // (fewer than 5 taunts): the outcome is predetermined, and drawing would
 // only perturb the shared random stream — the edge smoke's Mercy deadline
 // window caught the shift (1 pass, 1 fail over two repeats with the
 // unconditional draw; baseline passes).
 if(run.state.card===5){
  const taunts=run.state.TotalTauntsUsed||0;
  if(FanservicePunishment.rate(taunts)>0&&FanservicePunishment.roll(taunts,run.random)){spawnPunishment();checkpoint(true);render();return;}
 }
 objectiveEvents(run.edge());checkpoint(true);render();
}
function edgeAction(events){objectiveEvents(events);checkpoint(true);render();}
function renderEdge(){
 const e=state.edge,enabled=started&&!paused&&!finished&&FanserviceEdge.allowed(run);edgeButton.disabled=!enabled;
 edgePanel.hidden=!e||e.phase==='idle'||finished;const seconds=e?.phase==='hold'?e.holdRemaining:e?.deadline?Math.max(0,Math.ceil(e.deadline-state.seconds)):0;
 const view=JSON.stringify([e?.phase,seconds,e?.streak,e?.bank,paused,finished,!!run.returnEdge]);if(edgeView===view)return;edgeView=view;edgePanel.replaceChildren();if(edgePanel.hidden)return;
 if(run.returnEdge)edgePanel.append(element('p','Return Edge: follow the beats, then tap Edge / E to continue your session. Your current media stays in place.'));
 edgePanel.append(element('p',`Edge streak ${e.streak} · pending ${e.bank} coins · ${e.phase}${seconds?` · ${seconds} seconds`:''}.`));
 if(['rest','mercy-rest'].includes(e.phase)){const button=action('Continue / G',()=>edgeAction(run.continueEdgeRest()));button.disabled=paused;edgePanel.append(button);}
 if(e.phase==='mercy')for(const [accepted,title] of [[true,'Accept Mercy'],[false,'Continue streak']]){const button=action(title,()=>edgeAction(run.mercy(accepted)));button.disabled=paused;edgePanel.append(button);}
}
function settingsChanged(){const mode=Number(modeSelect.value),spec=FanserviceObjectives.specs[Number(objectiveSelect.value)];objectiveLabel.hidden=mode!==0;roundsLabel.hidden=mode!==1;targetInput.min=spec.min;targetInput.max=spec.max;targetInput.step=spec.sliderStep;targetInput.value=spec.defaultTarget;targetInput.disabled=spec.objective===0;}
modeSelect.onchange=()=>{settingsChanged();if(run&&!started)installRun(makeRun());};objectiveSelect.onchange=settingsChanged;settingsChanged();
function makeRun(){
 const spec=FanserviceObjectives.specs[Number(objectiveSelect.value)],target=Number(targetInput.value),mode=Number(modeSelect.value);
 if(mode===2&&!music)throw Error('Select a confirmed soundtrack in Unlocks before starting Soundtrack mode.');
 if(mode!==2&&music)throw Error('Return to Unlocks and select Classic · no soundtrack for Classic or Tower.');
 if(!Number.isSafeInteger(target)||target<spec.min||target>spec.max)throw Error(`Objective target must be between ${spec.min} and ${spec.max}.`);
 const settings={...(profile.mobile_settings||{}),LastObjectiveIndex_Classic:Number(objectiveSelect.value),LootBarEnabled:lootChoice.checked,'IsBrainMelterEnabled?':frenzyChoice.checked};if(spec.saveKey)settings[spec.saveKey]=target;
 return new FanserviceRun.Run(catalog,{mode,rounds:Number(roundsInput.value),settings,difficulty:Number($('difficulty').value),cardRules,lootEnabled:lootChoice.checked,maxBreaks:catalog.music_upgrades[1]['Value_L'+Math.max(1,Math.min(5,profile.mobile_music_upgrades?.[1]||1))],seed:run?.config.seed??crypto.getRandomValues(new Int32Array(1))[0],hotbar:run?.inventory.hotbarItems||profile.mobile_loadout,modifiers:profile.progression?.enabled_modifiers||[]});
}
function installRun(value){window.FanserviceVoice.stop();vibration.cancel();cancelFinishHold();run=value;state=run.state;decks=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));remaining={};favorites=new FanserviceFavorites.Favorites({random:run.random});favorites.register(media);}
function pauseVisualMedia(){$('video').pause();$('background-video').pause();}
function cancelMediaGesture(){
 mediaPress=null;mediaKey=null;
 cancelFinishHold();
}
new ResizeObserver(cancelMediaGesture).observe($('stage'));
$('image').addEventListener('load',cancelMediaGesture);$('video').addEventListener('loadedmetadata',cancelMediaGesture);
function playVisualMedia(){
 if($('video').hidden)return;
 $('video').play().catch(error=>status('Video access failed: '+error.message));
 $('background-video').play().catch(()=>{});
}
function seekMedia(position){
 const item=currentMedia,token=++mediaSeekToken;pendingMediaSeek=position;
 const apply=()=>{if(currentMedia!==item||token!==mediaSeekToken)return;if(Math.abs($('video').currentTime-position)>.05)$('video').currentTime=position;else pendingMediaSeek=null;};
 if($('video').readyState>0)apply();else $('video').addEventListener('loadedmetadata',apply,{once:true});
}
function showMedia(item,position=0,{restart=false}={}){
 const video=item.type==='video',same=currentMedia?.id===item.id&&currentMedia?.type===item.type;
 if(!same||restart){pauseVisualMedia();mediaSeekToken++;pendingMediaSeek=null;}currentMedia=item;mediaPosition=position;
 $('image').hidden=video;$('video').hidden=!video;
 $('background-image').hidden=video;$('background-video').hidden=!video;
 if(video){
  if(!same){$('video').src=item.url;$('background-video').src=item.url;}
  seekMedia(position);
  if(started&&!paused)playVisualMedia();
 }else if(!same){$('image').src=item.url;$('background-image').src=item.url;}
 cancelMediaGesture();
}
function mediaView(){if(!currentMedia)return null;const time=$('video').hidden?0:$('video').currentTime;return {id:currentMedia.id,position:paused||pendingMediaSeek!==null?mediaPosition:Number.isFinite(time)&&time>0?time:mediaPosition};}
$('video').addEventListener('seeked',()=>{if(pendingMediaSeek!==null&&Math.abs($('video').currentTime-pendingMediaSeek)<.1)pendingMediaSeek=null;});
$('video').addEventListener('timeupdate',()=>{if(!paused&&pendingMediaSeek===null&&currentMedia?.type==='video'&&Number.isFinite($('video').currentTime)&&$('video').currentTime>0)mediaPosition=$('video').currentTime;});
function automaticMediaPool(){
 const options=FanserviceModifiers.options(state.modifiers);
 if(options.eventOverride==='succubus')return 'succubus';
 if(options.eventOverride==='slow-medium')return run.random.range(0,1)===0?'medium':'slow';
 if(options.eventOverride==='fast-succubus')return run.random.range(0,1)===0?'succubus':'fast';
 const shield=run.inventory.state(6),heatCategory=state.heat<=30?2:state.heat<=70?1:0;
 const gate=FanserviceSpawnEligibility.check({heatCategory,combo:state.combo,canSuccubiSpawn:state.canSuccubiSpawn??false,shieldToggled:!!state.shieldToggled,shieldCharges:shield?.charges||0,shieldBlockCount:state.shieldBlockCount??0,enhancedPlating:FanserviceEconomy.has(run,14),demonProof:!options.canSpawnSuccubi,exorcistRemaining:state.economy?.exorcistRemaining||0});
 if(shield)shield.charges=gate.shieldCharges;
 state.shieldBlockCount=gate.shieldBlockCount;state.shieldToggled=gate.shieldToggled;
 const pools={0:'slow',1:'medium',2:'fast',5:'succubus',7:'ass',8:'boobs',12:'slow'};
 const rows=specialEvents.rows.filter(row=>{
  const pool=pools[row.eventCode];if(!pool||!decks[pool]?.length)return false;
  if(row.eventCode===5)return gate.eligible;
  if(row.eventCode===7||row.eventCode===8)return run.config.settings['IsBrainMelterEnabled?']===true&&heatCategory===0;
  // Favorite Frenzy (TriggerSelectedEvent, BP_DrawManager stmt 62 @2142,
  // event code 12; gated at filter time by CheckEventConditions&ReturnArray
  // stmt 82 @2363 via FavoriteFrenzyEligibilityCheck): the gate counts the
  // derived FavoriteFrenzy deck (>=3) and the 120 s cooldown; the spawn
  // itself draws from the slow deck as a type-9 card (see draw()) — the
  // MEDIA deck is slow, but the card's beat pattern comes from
  // FrenzyBeatPatterns (cards.js bank 'frenzy'), not the slow bank.
  if(row.eventCode===12)return favorites&&favorites.isFavoriteFrenzyEligible(state.seconds);
  return true;
 });
 const selected=FanserviceMediaSelection.weightedEvents(rows,{heat:state.heat,comboTier:rules.comboTier(state.combo)},run.random.fraction());
 state.mediaEvent=selected?.name||'SlowStrokeEvent';state.frenzyPending=selected?.eventCode===12;return selected?pools[selected.eventCode]:'slow';
}
function draw(pool,{prepare=true,force=false,cardOptions={}}={}){
 if(prepare&&!force&&started&&FanserviceEdge.active(run)){status('Finish the active edge stage before drawing another card.');return false;}
 if(prepare&&!force&&started&&!music&&state.card===3&&FanserviceCards.remaining(run)>0){status('Finish the active encounter before drawing another card.');return false;}
 state.frenzyPending=false;
 decks??=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));
 if(pool===undefined&&!music&&started&&!finished&&run.phase==='playing'&&run.cumOverrideDue()){pool='cum';cardOptions={...cardOptions,override:true};}
 pool??=music?category:automaticMediaPool();category=pool;
 let item=null;
 // Favorite injection (DrawNextCardForCategory 0x14826f430): for a non-9
 // category, a 1-100 roll against the threshold (success iff roll <=
 // FavoritesLikelyhoodPercent) draws from the current
 // category's remaining-favorites deck instead of the normal deck. The
 // injected entry is pruned from the normal remaining deck: the native
 // enforces the same anti-repeat through its seen set, which does not
 // reach this working deck.
 const favoriteCategory={slow:0,medium:1,fast:2,succubus:3,cum:6,ass:7,boobs:8}[pool];
 const injected=favorites&&favoriteCategory!==undefined&&!music?favorites.injectFavorite(favoriteCategory,run.random):null;
 if(injected?.item){
  item=injected.item;
  if(remaining[pool]){const at=remaining[pool].findIndex(entry=>entry.id===item.id);if(at>=0)remaining[pool].splice(at,1);}
 }else{
  if(!decks[pool]?.length){status(`No ${pool} media in the frozen selection. Enable a complementary pack or organize its tags in full fanservice.`);return false;}
  if(!remaining[pool]?.length)remaining[pool]=[...decks[pool]];
  const index=Math.floor(Math.random()*remaining[pool].length);item=remaining[pool].splice(index,1)[0];
 }
 showMedia(item,0,{restart:true});
 // The frenzy pick (automaticMediaPool, event code 12) spawns through the
 // slow deck as a type-9 card and starts the 120 s cooldown here, at the
 // spawn — the original starts it inside FavoriteFrenzyEvent.
 const frenzy=state.frenzyPending&&!music;
 if(prepare){state.card=frenzy?9:{slow:0,medium:1,fast:2,succubus:3,cum:6,ass:7,boobs:8}[pool];state.canUseSlowdown=true;state.canUseBonerPill=true;if(started&&!finished&&run.phase==='playing'){FanserviceEconomy.draw(run);if(!music){if(frenzy&&favorites)favorites.triggerFavoriteFrenzy(state.seconds);run.startCard(pool,frenzy?{...cardOptions,frenzy:true}:cardOptions);speed=1;}}}
 return true;
}
function spawnPunishment(){
 // SpawnPunishmentEvent (GM ubergraph stmts 1440-1460): a custom succubus
 // card event, not the Apex Lure draw('succubus') path. It replaces the
 // current card with SpawnCustomCardEvent(SuccubusCards, 30, 50, 0.28, 0.33,
 // byte(3), 1.0, ...), locks items for the event (stmt 1454), switches the
 // background to 8 ('tauntbackground'), and shows the "Punishment"
 // notification. The next draw re-enables items through Economy.draw, the
 // same mechanism that unlocks after any succubus card. Not reproduced:
 // the voiceline (FindSpecialEventDialogueStructs(1) lines live in the
 // cooked data table, not the retained ASTs), PlayMusic(3) (no dynamic
 // music track switch in Classic/Tower), FastPaceAnim and the BM widgets
 // (UI-only, no player counterpart).
 if(!started||paused||finished||run.phase!=='playing')return false;
 decks??=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));
 if(!decks.succubus?.length){status('No succubus media in the frozen selection. Punishment could not start.');return false;}
 if(!remaining.succubus?.length)remaining.succubus=[...decks.succubus];
 const index=Math.floor(Math.random()*remaining.succubus.length),item=remaining.succubus.splice(index,1)[0];
 showMedia(item,0,{restart:true});
 category='succubus';
 state.card=3;state.canUseSlowdown=true;state.canUseBonerPill=true;
 FanserviceEconomy.draw(run);
 run.startCard('succubus',{punishment:true});speed=1;
 state.canUseItems=false;
 FanserviceBackground.apply($('session-background'),'tauntbackground',$('background-status'));
 status('Punishment: Your boasts have consequences.');
 return true;
}
function triggerTaunt(){
 // UI_Manager TauntButton click (entry 21921 -> stmt 609 -> stmt 328): the
 // guards run first, then the branch notification, then Taunt() /
 // Firemouth Taunt(), StartTauntCooldown(), and the Tempting Fate check at
 // five taunts. The media for the spawned card is picked here, mirroring
 // spawnPunishment; run.taunt() does the guards, heat, counters, cooldown,
 // card spawn, and the cum-meter add (TauntCumAdd 0.01, UI_Manager CDO
 // property #227). No T-key shortcut: the original's
 // T-key entry (8529 -> UI stmt 236) lands in a widget-create flow, not
 // the taunt handler, so it was not established as the taunt key.
 if(!started||paused||finished||run.phase!=='playing'||music)return;
 const pool=state.card===3?null:(FanserviceTaunts.isFiremouth(run)?'succubus':'fast');
 if(pool){
  decks??=rules.mediaPools(media,FanserviceModifiers.options(state.modifiers));
  if(!decks[pool]?.length){status(`No ${pool} media in the frozen selection. Taunt could not start.`);return;}
 }
 const result=run.taunt();
 if(!result.ok){
  status({cum:'Cannot Taunt: Cannot taunt during cum events.',edge:'Cannot Taunt: Cannot taunt during edging events.',cooldown:`Taunt on Cooldown: Try again in ${result.seconds} seconds.`,already:'Already Taunted: Wait until the next task to taunt.'}[result.reason]||'Taunt is unavailable.');
  render();return;
 }
 if(result.branch==='normal'||result.branch==='firemouth'){
  const wanted=result.branch==='normal'?'fast':'succubus';
  if(!remaining[wanted]?.length)remaining[wanted]=[...decks[wanted]];
  const index=Math.floor(Math.random()*remaining[wanted].length),item=remaining[wanted].splice(index,1)[0];
  showMedia(item,0,{restart:true});
  category=wanted;speed=1;
 }
 if(result.branch==='normal'){
  FanserviceBackground.apply($('session-background'),'tauntbackground',$('background-status'));
  status(result.temptingFate?'Tempting Fate: Your taunts drew her ire. Items may trigger punishment.':'Taunt! Increased Stroke Speed & Count.');
 }else if(result.branch==='succubus')status('Succubus Taunt! Succubi Spawn Chance Permanently Increased.');
 else status('Firemouth Taunt! Your Trash Talk has Summoned a Succubus!');
 checkpoint(true);render();
}
function pulseBeat(){lastBeat=position();$('center').style.boxShadow='0 0 18px #fff';setTimeout(()=>$('center').style.boxShadow='',80);}
let laneSource,laneQueue,laneStarted,laneTimes=[],laneNodes=[$('beat')];
function renderBeatLane(){
 const card=run?.returnEdge||!music,flow=state?.cardFlow,source=card?flow:map,queue=card?flow?.queue:map?.beats;
 if(source!==laneSource||queue!==laneQueue||flow?.started!==laneStarted){laneSource=source;laneQueue=queue;laneStarted=flow?.started;laneTimes=card?FanserviceBeatLane.cardTimes(flow):(map?.beats||[]).filter(beat=>beat.type!=='rest').map(beat=>beat.time);}
 const now=card?state?.seconds:audio.currentTime,notes=started&&(!card||!flow?.suspended&&!flow?.ended)?FanserviceBeatLane.project(laneTimes,now,{lead:card?flow?.travel:3}):[];
 let spacing=Infinity;for(let index=1;index<notes.length;index++){const gap=Math.abs(notes[index].x-notes[index-1].x)*$('beats').clientWidth/100;if(gap>.1)spacing=Math.min(spacing,gap);}
 const diameter=Math.max(6,Math.min(23,spacing*.8));
 for(let index=0;index<notes.length;index++){
  const node=laneNodes[index]??document.createElement('span');
  if(!laneNodes[index]){node.className='beat-ball';node.setAttribute('aria-hidden','true');$('beats').append(node);laneNodes.push(node);}
  node.hidden=false;node.style.left=notes[index].x+'%';node.dataset.hitTime=String(notes[index].time);
  node.style.width=diameter+'px';node.style.height=diameter+'px';
  node.style.opacity=notes[index].time<now?String(Math.max(0,1-(now-notes[index].time)/.25)):'1';
 }
 for(let index=notes.length;index<laneNodes.length;index++)laneNodes[index].hidden=true;
}
function beat(){scoreBeat();pulseBeat();}
function scoreBeat(){
 if(!started||paused||finished||run.phase!=='playing'||state.seconds<breakUntil)return;
 for(const event of run.beat())if(event.type==='loot'){const reward=event.reward;status(reward.type===0?`Loot: ${reward.amount} coins${reward.tax?` · ${reward.tax} tax`:''}.`:reward.type===6?'Jackpot drop applied to equipped items.':reward.applied?`Loot: ${run.inventory.catalog.find(r=>r.type===reward.item)?.id||'item'} charge.`:'Loot item is already at capacity.');}
 vibration.beat();
 if(run.config.mode===2){const level=Math.max(1,Math.min(5,profile.mobile_music_upgrades?.[2]||1)),threshold=catalog.music_upgrades[2]['Value_L'+level];if(state.strokes%threshold===0)run.inventory.grant(4,1,itemContext());}
 render();
}
function position(){return music?audio.currentTime:state?.seconds||0;}
function timelinePool(pool,replay){
 if(draw(pool,{prepare:!replay})&&replay)state.card={slow:0,medium:1,fast:2,succubus:3,cum:6,ass:7,boobs:8}[pool];
}
function event(e,{replay=false}={}){
 if(e.type==='media_change')timelinePool(e.value,replay);else if(e.type==='cycle_media')draw();
 else if(e.type==='text')$('caption').textContent=e.value;
 else if(e.type==='dialogue')window.FanserviceVoice.say(e.value,text=>$('caption').textContent=text,text=>$('voice-status').textContent=text);
 else if(e.type==='cum_event'){run.player.isAllowedToCum=e.value==='start';if(e.value==='start')timelinePool('cum',replay);}
 else if(e.type==='disable_break')state.breakSectionDisabled=e.value==='start';
 else if(e.type==='restore_break')state.breakSectionDisabled=false;
 else if(e.type==='grant_break'&&!replay)run.inventory.grant(4,1,itemContext());
 else if(e.type==='background')FanserviceBackground.apply($('session-background'),e.value,$('background-status'));
 else if(e.type==='edge'){$('caption').textContent='Edge checkpoint.';}
}
function reconcileTimeline(events){
 $('caption').textContent='';$('voice-status').textContent='';FanserviceBackground.apply($('session-background'),'normalbeatbackground',$('background-status'));state.breakSectionDisabled=false;run.player.isAllowedToCum=false;
 timelinePool('slow',true);
 for(const entry of events)event(entry,{replay:true});
}
function timelineCallbacks(){return {beat,event,replayBeat:pulseBeat,reconcile:reconcileTimeline};}
function sampleMusic(ended=false){
 return rules.recordingSample(map,audio.currentTime,clock,{...timelineCallbacks(),advance:elapsed=>objectiveEvents(run.advance(elapsed))},{active:!paused&&!run.returnEdge&&!musicLeadIn&&!musicBuffering&&!audio.paused&&!audio.seeking&&audio.readyState>=3,ended});
}
function resumeMusic(){
 if(run.returnEdge||musicLeadIn||musicStarting)return;
 musicStarting=true;
 audio.play().catch(error=>{paused=true;$('pause').textContent='Pause';status(error.message);render();}).finally(()=>{musicStarting=false;});
}
function checkpoint(force=false){
 if(!started||finished||!run)return;const now=performance.now();if(!force&&now-checkpointAt<1000)return;checkpointAt=now;
 try{localStorage.setItem(checkpointKey,JSON.stringify({version:1,id:sessionId,library,server:store.server(),run:run.export(),media,view:mediaView(),music,clock:{...clock},position:position(),lastBeat,category,breakUntil,speed,pinnedPacks,musicLeadIn}));}
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
 if(['shop','round-complete'].includes(run.phase))towerPanel.append(element('p',run.phase==='shop'?'Round complete. Shop available.':'Round complete.'),action('Continue Tower',()=>{run.continue();checkpoint(true);renderTower();updateScreenWake();}));
}
function render(){
 updateScreenWake();
 if(!state)return;
 renderSessionShell();
 renderBeatLane();
 renderItemControls();
 const session=run.effectiveStats();$('meter').value=Math.min(state.meter,1);$('stats').textContent=`${session.strokes} beats · combo ${state.combo} (${rules.comboTier(state.combo)}) · ${state.coins} coins · ${state.succuCoins} SuccuCoins · heat ${state.heat.toFixed(1)} · ${Math.floor(session.seconds)} seconds${run.config.lootEnabled?` · loot ${Math.floor(Math.max(0,state.lootBar)*100)}%`:''}`;
 $('meter-value').textContent=`Cum meter ${(Math.max(0,Math.min(state.meter,1))*100).toFixed(2)}%`;
 const objective=run.roundObjective||run.objective.state,spec=FanserviceObjectives.specs.find(s=>s.objective===objective.objective);
 objectiveStatus.textContent=(run.tower?`Tower ${run.phase}. `:'')+(spec?`${spec.title}: ${objective.target}. `:'')+(run.objective.releaseDeadline===null?'':`Release window: ${Math.max(0,Math.ceil(run.objective.releaseDeadline-state.seconds))} seconds.`)+(state.seconds<breakUntil?` Break: ${Math.ceil(breakUntil-state.seconds)} seconds.`:'');
 finishButton.textContent=objective.objective===7?'Hold to record tribute':'Hold to finish';finishButton.disabled=!canFinish();
 finishButton.setAttribute('aria-label',finishButton.textContent);
 $('controls').dataset.finishReady=String(!finishButton.disabled);
 if(finishButton.disabled)cancelFinishHold();
 $('draw').disabled=!started||finished||run.phase!=='playing'||FanserviceEdge.active(run);$('tap').disabled=$('draw').disabled||paused;renderEdge();renderTaunt();renderFavorite();renderOverlays();
}
function renderOverlays(){
 // Cum overlays (v0.05.1 decoded animations — see
 // docs/parity/evidence/ticket44-loops-overlay-20261111.md): the allowed
 // overlay breathes with the 1 s SpawnOverlay pulse while cum is allowed;
 // the countdown overlay plays the 0.5 s SpawnAnim entrance then the Idle
 // loop while the release window is open, with its progress bar bound to
 // the window remainder. The 60 s window itself is untouched.
 if(!run||!state||!window.FanserviceOverlays)return;
 const overlay=FanserviceOverlays.overlayState({isAllowedToCum:run.player.isAllowedToCum,releaseDeadline:run.objective.releaseDeadline,now:state.seconds,windowSeconds:60,hasCame:run.player.hasCame});
 $('cum-overlay').hidden=!overlay.allowed;
 $('cum-countdown-overlay').hidden=!overlay.countdown;
 if(overlay.countdown){
  $('cum-countdown-progress').value=overlay.progress;
  $('cum-countdown-text').textContent=`Release window: ${overlay.seconds} seconds.`;
 }
 // Map-window warnings (music mode only, UMusicModeManager getters — see
 // docs/parity/evidence/ticket51-queue-consumer-20261111.md): the objective
 // countdown above never runs in Playlist mode, so the same countdown
 // overlay shows the CumIn / CumWithin / BreakDisable countdown from the
 // beatmap events. CumWithin wins at the window start instant, when both it
 // and CumIn are active.
 if(music&&map?.events){
  const warnings=FanserviceOverlays.mapWindowWarnings({now:position(),events:map.events});
  const texts=FanserviceOverlays.mapWindowWarningTexts({now:position(),events:map.events});
  const shown=warnings.cumWithin.active?{progress:warnings.cumWithin.progress,text:texts.cumWithin}:warnings.cumIn.active?{progress:warnings.cumIn.progress,text:texts.cumIn}:warnings.breakDisable.active?{progress:warnings.breakDisable.progress,text:texts.breakDisable}:null;
  if(shown){$('cum-countdown-overlay').hidden=false;$('cum-countdown-progress').value=shown.progress;$('cum-countdown-text').textContent=shown.text;}
 }
}
function objectiveEvents(events){
 const beats=events.filter(e=>e.type==='card-beat');
 if(beats.length){pulseBeat();beats.forEach(()=>vibration.beat());}
 const opened=events.find(e=>e.type==='release-window-opened');
 if(opened){run.cancelEdge();draw('cum',{force:true});status(opened.notification||'Objective complete. 60 second release window.');}
 else if(events.some(e=>e.type==='card-complete'&&e.requestNextCard)&&run.phase==='playing'&&!FanserviceEdge.active(run))draw(undefined,{force:true});
 if(events.some(e=>e.type==='edge-card-started')&&!keepMediaOnReplay)draw('fast',{prepare:false,force:true});
 if(events.some(e=>e.type==='edge-streak-ended'&&e.requestNextCard)&&run.phase==='playing')draw(undefined,{force:true});
 if(events.some(e=>e.type==='edge-recorded'))status(events.find(e=>e.type==='edge-recorded').perfect?'Perfect edge recorded.':'Edge recorded.');
 if(events.some(e=>e.type==='return-edge-complete')&&music){resumeMusic();status('Return edge complete. Resuming the saved song position.');}
 if(!music){const resumed=events.find(e=>e.type==='return-edge-complete'&&e.resumePool);if(resumed){if(!currentMedia)draw(resumed.resumePool,{prepare:false,force:true});status('Return edge complete. Resuming the interrupted task.');}}
 if(events.some(e=>e.type==='tribute-recorded'))status(`Tribute recorded: ${state.milkingCount}.`);
 if(events.some(e=>e.type==='objective-reset'))status(events.find(e=>e.type==='objective-reset').notification||'Release window closed. Objective reset.');
 if(events.some(e=>['round-complete','round-failed'].includes(e.type))||run.phase!=='playing')renderTower();
 if(run.phase!=='playing')vibration.cancel();
 if(run.phase==='complete'&&!settling&&!finished)void end(!!state.won);
 updateScreenWake();
}
function tickItems(elapsed){
 const itemState=readItemState();for(const result of FanserviceItems.tick(run.inventory,itemState,elapsed,itemDependencies())){
  if(result==='BountyClaimed')state.BountiesCollected=(state.BountiesCollected||0)+1;
  if(result==='BountyFailed')FanserviceEconomy.recordBountyCollectionFailure(run);
 }writeItemState(itemState);
}
function tick(now){
 const delta=lastFrame?Math.max((now-lastFrame)/1000,0):0;lastFrame=now;
 if(started&&!paused&&!finished&&run.phase==='playing'){
  if(run.returnEdge){
   audio.pause();
   if(vibrationMode.value==='event')vibration.advance(state.seconds,state.seconds+delta,vibrationDeadlines());
   objectiveEvents(run.advance(delta));if(!finished&&run.phase==='playing')tickItems(delta);checkpoint();
   render();requestAnimationFrame(tick);return;
  }
  if(music&&musicLeadIn>0){
   musicLeadIn=Math.max(0,musicLeadIn-delta);
   status(musicLeadIn?`Song starts in ${Math.ceil(musicLeadIn)}…`:'Starting recording…');
   if(!musicLeadIn)resumeMusic();
   checkpoint();render();requestAnimationFrame(tick);return;
  }
  const sample=position();
  if(music&&!audio.seeking&&sample<clock.last-.05){
   window.FanserviceVoice.stop();
   vibration.cancel();
   rules.seek(map,sample,clock,timelineCallbacks());
  }
  const elapsed=music?Math.max(0,sample-clock.last):delta;
  const advancing=!music||!musicBuffering&&!audio.paused&&!audio.seeking&&audio.readyState>=3;
  if(advancing){
   if(vibrationMode.value==='event'){
    vibration.advance(state.seconds,state.seconds+elapsed,vibrationDeadlines());
    if(music)vibration.advance(clock.last,sample,soundtrackWarnings);
   }
   if(music)sampleMusic();else objectiveEvents(run.advance(elapsed));
   if(!finished&&run.phase==='playing'){
    if(!music&&!run.config.cardRules){const interval=[.7,.5,.35][Number($('difficulty').value)]/speed*(FanserviceEconomy.has(run,6)?2:1);if(state.seconds>=breakUntil&&position()-lastBeat>=interval)beat();}
    tickItems(elapsed);
   }
   checkpoint();
  }
  render();
 }
 requestAnimationFrame(tick);
}
async function mutateProfile(fn){
 const write=()=>{const current=JSON.parse(localStorage.getItem(profileKey)||'null');if(!current)throw Error('The active profile is no longer available.');const next=fn(current);localStorage.setItem(profileKey,JSON.stringify(next));profile=next;return next;};
 return navigator.locks?.request?navigator.locks.request('fanservice-profile:'+profileKey,write):write();
}
async function end(won){
 if(finished||settling)return;vibration.cancel();cancelFinishHold();settling=true;updateScreenWake();window.FanserviceVoice?.stop();audio.pause();pauseVisualMedia();
 if(!started){status('Session canceled; no rewards were granted.');settling=false;return;}
 state.won=won;state.finished=true;
 try{
  const objective=(run.roundObjective||run.objective.state)?.objective;
  await mutateProfile(current=>{const next=FanserviceProgression.settleSession(FanserviceProgression.startSession(current,contract),{...run.effectiveStats(),mode:run.config.mode,difficulty:run.config.difficulty,objective},sessionId,contract);next.mobile_settings={...next.mobile_settings,...run.config.settings};next.mobile_loadout=[...run.inventory.hotbarItems];return next;});
  finished=true;await releasePins();localStorage.removeItem(checkpointKey);
  $('summary').textContent=`${won?'Session completed':'Session ended'}\n${profile.progression.last_settlement.xp} XP · ${state.coins} coins · ${profile.progression.last_settlement.unlock_points} UP\nLevel ${profile.progression.level} · ${profile.progression.xp} XP toward next level\nRewards saved once. Pack ownership was retained.`;
  renderItemControls();status('Session saved. Return to the library to resolve live pack contents again.');for(const id of ['start','pause','tap','draw','finish','end'])$(id).disabled=true;renderTower();
 }catch(error){state.finished=false;status('Rewards could not be saved: '+error.message);checkpoint(true);}
 finally{settling=false;updateScreenWake();renderSessionShell();}
}
function itemContext(){const levels=profile.mobile_music_upgrades||[1,1,1],value=type=>catalog.music_upgrades[type]['Value_L'+Math.max(1,Math.min(5,levels[type]||1))];return {mode:run.config.mode,manager:true,maxBreaks:value(1),breakDuration:value(0),minimumBeatInterval:0,biggerPockets:run.ownedModifiers.includes(13),allOrNothing:state.modifiers.includes('All or Nothing'),objectiveType:(run.roundObjective||run.objective.state).objective,punishmentEnabled:true};}
function readItemState(){return {...state,_baseline:{...state},strokes:run.effectiveStats().strokes,cumMeter:state.meter,cardType:state.card,strokeCount:state.cardFlow?.remaining??state.strokes,beatInterval:state.cardFlow?.interval??[.7,.5,.35][Number($('difficulty').value)]/speed,beatsRemaining:music?map.beats.length-clock.next:state.cardFlow?.remaining??1,canUseItems:state.canUseItems!==false&&FanserviceModifiers.options(state.modifiers).canUseItems&&!state.breakSectionDisabled&&state.seconds>=breakUntil};}
function writeItemState(value){for(const key of ['heat','combo','coins','effects','metrics','canUseSlowdown','canUseBonerPill','coinMultiplier','lootBarMultiplier','shieldToggled'])if(value[key]!==value._baseline[key])state[key]=value[key];if(value.cumMeter!==value._baseline.meter)state.meter=value.cumMeter;if(value.cardType!==value._baseline.card){state.card=value.cardType;if(state.cardFlow)state.cardFlow.card=value.cardType;}}
function itemDependencies(){return {context:itemContext(),random:run.random,hooks:{
 recycler:()=>FanserviceEconomy.recycler(run),
 itemUsed:type=>{const notification=FanserviceEconomy.itemUsed(run,type,run.inventory.catalog.find(r=>r.type===type)?.classification);if(notification)status(notification);},
 resetObjective:value=>{run.resetObjective();value.coins=0;value.cumMeter=state.meter;value.strokes=run.effectiveStats().strokes;},
 panicBlocked:(type,s)=>FanserviceModifiers.panicBlocked(run.inventory.catalog.find(r=>r.type===type)?.id,s.heat,state.modifiers),
 speed:multiplier=>{if(music)return false;const next=Math.max(.1,Math.min(5,speed*multiplier));if(state.cardFlow&&!run.modifyCard(next))return false;speed=next;return true;},
 beginBreak:duration=>{if(state.breakSectionDisabled){FanserviceEconomy.recordDisabledBreakSectionFailure(run);return false;}if(state.seconds<breakUntil)return false;breakUntil=state.seconds+duration;if(!music&&state.cardFlow)run.delayCard(duration);if(music)FanserviceEconomy.recordMusicBreakUsed(run);return true;},
 pill:effect=>{if(music)return false;const next=Math.max(.1,Math.min(5,speed*effect.speed));if(state.cardFlow&&!run.modifyCard(next,effect.timelineStrokes))return false;speed=next;return true;},
 openStore:()=>{if(run.tower&&run.phase==='playing')return false;renderInventory(true);if(!inventoryDialog.open)inventoryDialog.showModal();return true;},
 spawnSuccubus:({strokeAddend}={})=>FanserviceModifiers.options(state.modifiers).canSpawnSuccubi&&draw('succubus',{cardOptions:{apexLure:true,strokeAddend}}),
 // RollPunishmentChance reads TotalTauntsUsed (LegacyStats), not the
 // EMetricType::TimesTaunted challenge metric — Firemouth taunts count
 // toward the metric but not toward the punishment roll.
 punishment:(type,s)=>FanservicePunishment.roll(s.TotalTauntsUsed||0,run.random),
 spawnPunishment:()=>spawnPunishment(),
 escape:()=>{if(music)return false;return draw(undefined,{force:true});}
 }};}
function useItem(type){
 if(!started||paused||finished||settling||run.phase!=='playing')throw Error('Start an active round before using items.');
 if(!run.inventory.hotbarItems.includes(type))throw Error('Equip this item first.');
 const value=readItemState(),result=FanserviceItems.use(run.inventory,type,value,itemDependencies());
 if(!result.ok)throw Error(result.reason);
 writeItemState(value);
 if(result.consumed||type===6){const notification=FanserviceEconomy.itemUsed(run,type,run.inventory.catalog.find(row=>row.type===type).classification);if(notification)status(notification);}
 checkpoint(true);
}
function renderInventory(storeEvent=false){
 renderItemControls();
 inventoryBody.replaceChildren();const shop=run.phase==='shop'||storeEvent;inventoryBody.append(element('p',`${state.coins} session coins. ${shop?'Shop open.':'Equip items before play; purchases require an active shop.'}`));
 for(const row of run.inventory.catalog){const owned=run.inventory.state(row.type);if(!owned?.unlocked)continue;const box=element('article'),index=Math.max(0,Math.min(4,owned.level-1));box.append(element('p',`${row.source['Level'+owned.level+'TooltipTitle']} · level ${owned.level} · ${owned.charges} charges`));
  const slot=element('select');slot.setAttribute('aria-label','Slot for '+row.id);for(let i=0;i<5;i++){const option=element('option','Slot '+(i+1));option.value=i;slot.append(option);}box.append(slot,action('Equip '+row.id,()=>{if(started&&run.phase!=='shop')throw Error('Change the loadout before play or in a Tower shop.');const result=FanserviceItems.equip(run.inventory,row.type,Number(slot.value));if(!result.ok)throw Error(result.reason);checkpoint(true);renderInventory(storeEvent);}));
  const buy=action(`Buy ${row.id} · ${row.purchaseCosts[index]}`,()=>{const result=FanserviceItems.purchase(run.inventory,row.type,state,itemContext());if(!result.ok)throw Error(result.reason);state.MoneySpent=(state.MoneySpent||0)+result.cost;checkpoint(true);renderInventory(storeEvent);});buy.disabled=!shop;box.append(buy);
  const upgrade=action(`Upgrade ${row.id} · ${row.upgradeCosts[index]}`,()=>{const result=FanserviceItems.upgrade(run.inventory,row.type,state);if(!result.ok)throw Error(result.reason);state.MoneySpent=(state.MoneySpent||0)+result.cost;checkpoint(true);renderInventory(storeEvent);});upgrade.disabled=!shop||!row.upgradeable||owned.level>=5;box.append(upgrade);
  const use=action('Use '+row.id,()=>{useItem(row.type);renderInventory(storeEvent);render();});
  use.disabled=!canAttemptItem(owned)||!run.inventory.hotbarItems.includes(row.type);box.append(use);inventoryBody.append(box);
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
  if(music){
   const lead=!run.resumed||musicLeadIn>0||run.interrupted||run.returnEdge,muted=audio.muted;
   if(lead)audio.muted=true;
   try{await audio.play();if(Math.abs(audio.duration-music.duration)>.35){audio.pause();throw Error('Recording duration differs from the confirmed beatmap.');}}
   finally{if(lead)audio.pause();audio.muted=muted;}
   if(restorePosition!==null){audio.currentTime=restorePosition;restorePosition=null;}
   if(!run.resumed){audio.currentTime=0;musicLeadIn=2;}
  }
  started=true;lastFrame=performance.now();$('start').disabled=true;$('difficulty').disabled=true;for(const input of settingsPanel.querySelectorAll('input,select'))input.disabled=true;
  if(run.interrupted){keepMediaOnReplay=true;try{objectiveEvents(run.resumeInterrupted());}finally{keepMediaOnReplay=false;}}
  $('pause').disabled=false;if(restoredView){showMedia(restoredView.item,restoredView.position);restoredView=null;}else if(!currentMedia||!run.resumed)draw(run.resumed?category:undefined,{prepare:!run.resumed});else showMedia(currentMedia,$('video').currentTime||mediaPosition);renderTower();render();checkpoint(true);status(run.returnEdge?'Return Edge: follow the beats, then tap Edge / E to continue your session.':'');if(run.phase==='complete')await end(!!state.won);
 }catch(error){status(error.message);}
};
 $('pause').onclick=()=>{if(!started||finished)return;if(!paused)mediaPosition=mediaView()?.position||0;paused=!paused;if(paused){checkpoint(true);vibration.cancel();cancelFinishHold();window.FanserviceVoice?.stop();audio.pause();pauseVisualMedia();}else{const voiceResume=window.FanserviceVoice?.unlock?.();voiceResume?.catch(()=>{});lastFrame=performance.now();if(run.interrupted){keepMediaOnReplay=true;try{objectiveEvents(run.resumeInterrupted());}finally{keepMediaOnReplay=false;}}if(music)resumeMusic();if(!$('video').hidden){seekMedia(mediaPosition);playVisualMedia();}checkpoint(true);if(run.returnEdge)status('Return Edge: follow the beats, then tap Edge / E to continue your session.');}$('pause').textContent='Pause';render();};
function tap(){if(started&&!paused&&!finished&&!music&&run.phase==='playing')draw();}
$('tap').onclick=tap;$('draw').onclick=()=>{draw();checkpoint(true);render();};
function canFinish(){
 return started&&!paused&&!finished&&!settling&&run.phase==='playing'&&(run.player.isAllowedToCum||state.meter>=1);
}
function cancelFinishHold(){
 $('finish-ring').setAttribute('hidden','');
 if(!finishHold)return;
 clearTimeout(finishHold.timer);
 finishHold=null;
}
function beginFinishHold(input){
 if(finishHold||document.hidden||!canFinish())return;
 const activeRun=run;
 finishHold={input,timer:setTimeout(()=>{
  cancelFinishHold();
  if(document.hidden||run!==activeRun||!canFinish())return;
  if(state.meter>=1&&!run.player.isAllowedToCum)objectiveEvents(run.advance(0));
  objectiveEvents(run.climax());
  render();
 },1000)};
}
const mediaSurface=$('stage'),finishRing=$('finish-ring');
let mediaPress=null,mediaKey=null;
mediaSurface.addEventListener('pointerdown',event=>{
 if(mediaPress){mediaPress=null;cancelFinishHold();return;}
 if(!event.isPrimary||event.button!==0||!started||finished||paused)return;
 event.preventDefault();mediaSurface.focus({preventScroll:true});mediaSurface.setPointerCapture(event.pointerId);
 mediaPress={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now()};
 if(canFinish()){
  finishRing.style.left=event.clientX+'px';finishRing.style.top=event.clientY+'px';finishRing.removeAttribute('hidden');
  beginFinishHold(event.pointerId);
 }
});
mediaSurface.addEventListener('pointermove',event=>{
 if(mediaPress?.id!==event.pointerId)return;
 if(Math.hypot(event.clientX-mediaPress.x,event.clientY-mediaPress.y)>14){mediaPress=null;cancelFinishHold();}
});
mediaSurface.addEventListener('pointerup',event=>{
 if(mediaPress?.id!==event.pointerId)return;
 const tap=performance.now()-mediaPress.at<250;
 mediaPress=null;cancelFinishHold();
 if(tap&&!paused&&!finished&&!settling)$('pause').click();
});
for(const type of ['pointercancel','lostpointercapture'])mediaSurface.addEventListener(type,()=>{mediaPress=null;cancelFinishHold();});
mediaSurface.addEventListener('contextmenu',event=>event.preventDefault());
mediaSurface.addEventListener('click',event=>{if(event.detail===0&&started&&!paused&&!finished&&!settling)$('pause').click();});
mediaSurface.addEventListener('blur',cancelMediaGesture);
finishButton.addEventListener('pointerdown',e=>{
 if(!e.isPrimary||e.button!==0||finishButton.disabled)return;
 e.preventDefault();
 finishButton.focus();
 finishButton.setPointerCapture(e.pointerId);
 beginFinishHold(e.pointerId);
});
for(const type of ['pointerup','pointercancel','lostpointercapture']){
 finishButton.addEventListener(type,e=>{if(finishHold?.input===e.pointerId)cancelFinishHold();});
}
finishButton.addEventListener('contextmenu',e=>e.preventDefault());
finishButton.addEventListener('blur',cancelFinishHold);
window.addEventListener('blur',cancelMediaGesture);
$('end').onclick=()=>end(false);
document.addEventListener('keydown',e=>{
 if(e.target===mediaSurface&&['Enter','Space'].includes(e.code)){
  e.preventDefault();if(!e.repeat){mediaKey={code:e.code,at:performance.now()};beginFinishHold(e.code);}
 }else if((e.code==='Enter'&&e.target===document.body)||(e.target===finishButton&&['Enter','Space'].includes(e.code))){
  e.preventDefault();
  if(!e.repeat)beginFinishHold(e.code);
 }else if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){
  e.preventDefault();tap();
 }else if(e.code==='KeyE'&&!e.repeat&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){
  e.preventDefault();triggerEdge();
 }else if(e.code==='KeyG'&&!e.repeat&&!paused&&!finished&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){
  e.preventDefault();edgeAction(run.continueEdgeRest());
 }
});
document.addEventListener('keyup',e=>{
 if(mediaKey?.code===e.code){const tap=performance.now()-mediaKey.at<250;mediaKey=null;if(tap&&started&&!paused&&!finished&&!settling)$('pause').click();}
 if(finishHold?.input===e.code)cancelFinishHold();
});
if(navigator.mediaSession){
 for(const action of ['seekbackward','seekforward','seekto']){
  try{navigator.mediaSession.setActionHandler(action,()=>{});}catch{/* This browser does not implement the action. */}
 }
}
audio.addEventListener('waiting',()=>{musicBuffering=true;window.FanserviceVoice.stop();vibration.cancel();status('Buffering: rhythm clock is held at the actual playback position.');});audio.addEventListener('playing',()=>{musicBuffering=false;status('Playing from the client audio clock.');});
audio.addEventListener('ended',()=>{if(!music||!started||paused||run.returnEdge||finished||settling||musicLeadIn||audio.seeking)return;const final=sampleMusic(true);if(!final?.complete){status('Recording ended before the confirmed song boundary. No completion rewards were granted.');return;}FanserviceEconomy.recordMusicModeWinRounds(run,1);void end(true);});audio.addEventListener('error',()=>status('Soundtrack access failed. Reconnect or use an explicitly saved snapshot.'));
audio.addEventListener('seeked',()=>{window.FanserviceVoice.stop();vibration.cancel();if(started&&!run.returnEdge&&!run.interrupted&&!musicLeadIn&&map&&state){rules.seek(map,audio.currentTime,clock,timelineCallbacks());checkpoint(true);render();}});
function interruptSession(){if(!started||finished)return;run.interrupt();if(!paused)$('pause').click();else checkpoint(true);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelFinishHold();interruptSession();}updateScreenWake();});
window.addEventListener('pagehide',()=>{pageHidden=true;interruptSession();window.FanserviceVoice.stop();vibration.cancel();cancelFinishHold();updateScreenWake();checkpoint(true);});
window.addEventListener('pageshow',()=>{pageHidden=false;updateScreenWake();});
async function releasePins(){await Promise.all(pinnedPacks.map(packId=>store.releaseSession(sessionId+':'+packId)));pinnedPacks=[];}
async function restoreMedia(item){
 if(item.storage_key){const saved=await store.get('files',item.storage_key);if(!saved?.blob)throw Error('Active-session media was removed or evicted.');const url=URL.createObjectURL(saved.blob);resources.push(url);return {...item,url};}
 if(item.local){const result=await store.resolveLocal({local_ids:[item.id.replace(/^local:/,'')]},store.device);if(result.unavailable)throw Error('Active-session local file is unavailable.');return result.media[0];}
 return item;
}
const pauseMenu=$('pause-menu'),setupHost=$('pre-session'),pauseBody=$('pause-menu-body');
const presetPanel=element('fieldset'),presetChoice=element('select'),presetName=element('input'),presetStatus=element('p');
const presetKey='fanservice-session-presets-v1:'+library;
presetPanel.id='session-presets';presetPanel.append(element('legend','Saved session presets'));
presetChoice.id='session-preset';presetChoice.setAttribute('aria-label','Saved session preset');
presetName.id='preset-name';presetName.maxLength=40;presetName.placeholder='Preset name';presetName.setAttribute('aria-label','Preset name');
function savedPresets(){try{return FanserviceSessionPresets.normalize(JSON.parse(localStorage.getItem(presetKey)||'null'),FanserviceObjectives.specs).presets;}catch{return [];}}
function refreshPresets(){presetChoice.replaceChildren(new Option('Choose a preset',''));for(const [index,preset] of savedPresets().entries())presetChoice.append(new Option(preset.name,String(index)));}
function presetSettings(){return {mode:Number(modeSelect.value),difficulty:Number($('difficulty').value),objective:Number(objectiveSelect.value),target:Number(targetInput.value),rounds:Number(roundsInput.value),loot:lootChoice.checked,frenzy:frenzyChoice.checked,holding:holdingHand.value,vibration:vibrationMode.value,wake:wakeChoice.checked};}
const savePreset=action('Save preset',()=>{
 if(started||restoring)return;
 const entries=FanserviceSessionPresets.save(savedPresets(),presetName.value,presetSettings(),FanserviceObjectives.specs);
 localStorage.setItem(presetKey,JSON.stringify({version:1,presets:entries}));refreshPresets();presetStatus.textContent='Preset saved on this device.';
});
const loadPreset=action('Apply preset',()=>{
 if(started||restoring||presetChoice.value==='')return;const preset=savedPresets()[Number(presetChoice.value)];if(!preset)return;
 const value=preset.settings;
 if((value.mode===2)!==!!music)throw Error('Choose a preset that matches this session’s soundtrack selection.');
 modeSelect.value=value.mode;objectiveSelect.value=value.objective;settingsChanged();targetInput.value=value.target;roundsInput.value=value.rounds;
 $('difficulty').value=value.difficulty;lootChoice.checked=value.loot;frenzyChoice.checked=value.frenzy;holdingHand.value=value.holding;holdingHand.onchange();vibrationMode.value=value.vibration;vibrationMode.onchange();wakeChoice.checked=value.wake;wakeChoice.onchange();
 installRun(makeRun());presetName.value=preset.name;presetStatus.textContent='Preset applied. Check your settings, then Start.';
});
presetPanel.append(presetChoice,loadPreset,presetName,savePreset,presetStatus);refreshPresets();
const sessionOptions=[settingsPanel,$('difficulty').closest('label'),holdingLabel,wakeLabel,wakeStatus,vibrationLabel,vibrationStatus,presetPanel];
const secondaryActions=[inventoryAction,challengeAction,$('tap'),$('draw'),$('end')];
for(const button of secondaryActions)button.dataset.secondary='true';
setupHost.append(...sessionOptions,inventoryAction,challengeAction,$('start'));
$('session-statistics').append(mediaStatus);
pauseBody.before($('resume-session'));
let shellMounted=false;
function renderSessionShell(){
 document.body.dataset.sessionState=finished?'finished':!started?'setup':paused?'paused':'playing';
 if(started&&!shellMounted){
  const lockedSettings=element('details');lockedSettings.append(element('summary','Session rules (set before Start)'),settingsPanel,$('difficulty').closest('label'));
  $('tap').hidden=true;
  pauseBody.append(inventoryAction,challengeAction,$('draw'),holdingLabel,wakeLabel,wakeStatus,vibrationLabel,vibrationStatus,lockedSettings,$('session-statistics'),$('end'));
  const libraryLink=element('a','Return to library');libraryLink.href='index.html';pauseBody.append(libraryLink);shellMounted=true;
 }
 // d146862 moved Inventory/Challenges into the pause menu, which only opens
 // while the session is playing and paused; after finish the menu stays
 // closed, so the post-settlement claim flow lost its entry point. Before
 // d146862 both actions lived in #controls and stayed visible after finish,
 // so move them back there once the session is finished.
 if(finished&&shellMounted)$('controls').append(inventoryAction,challengeAction);
 presetPanel.disabled=started||restoring;
 if(started&&paused){if($('status').parentNode!==pauseBody)pauseBody.prepend($('status'));}
 else if($('status').parentNode!==$('voice-status').parentNode)$('voice-status').after($('status'));
 if(started&&paused&&!finished&&!document.hidden){if(!pauseMenu.open){pauseMenu.showModal();$('resume-session').focus({preventScroll:true});}}
 else if(pauseMenu.open)pauseMenu.close();
}
$('resume-session').onclick=()=>{if(paused&&!finished)$('pause').click();};
pauseMenu.addEventListener('cancel',event=>{event.preventDefault();$('resume-session').click();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderSessionShell();});
window.addEventListener('pageshow',renderSessionShell);
(async()=>{
 if(store.savedLibrary()&&library!==store.savedLibrary())throw Error('This session belongs to a different library. Return to the selected Server library.');
 profile=JSON.parse(localStorage.getItem(profileKey)||'null');if(!profile)throw Error('No game profile on this device. Create and enable a pack first.');
 lootChoice.checked=!!profile.mobile_settings?.LootBarEnabled;
 frenzyChoice.checked=!!profile.mobile_settings?.['IsBrainMelterEnabled?'];
 [catalog,contract,cardRules,specialEvents]=await Promise.all([readJSON('data/modes.json'),readJSON('data/native-contract.json'),readJSON('data/card-rules.json'),readJSON('data/special-events.json')]);
 const saved=JSON.parse(localStorage.getItem(checkpointKey)||'null');
 if(saved){
  restoring=true;
  if(saved.version!==1||saved.library!==library||saved.server!==store.server())throw Error('An unfinished session belongs to a different Server or unsupported version.');
  sessionId=saved.id;pinnedPacks=saved.pinnedPacks||[];media=await Promise.all(saved.media.map(restoreMedia));music=saved.music;if(music?.storage_key)music=await restoreMedia(music);installRun(FanserviceRun.Run.restore(catalog,saved.run));run.resumed=true;Object.assign(clock,saved.clock);lastBeat=saved.lastBeat??saved.position??0;category=saved.category;breakUntil=saved.breakUntil||0;speed=saved.speed||1;musicLeadIn=Math.max(0,Math.min(2,Number(saved.musicLeadIn)||0));settingsPanel.hidden=true;$('source').textContent='Unfinished session restored · frozen membership';
  if(saved.view){const item=media.find(candidate=>candidate.id===saved.view.id&&Object.values(decks).some(pool=>pool.includes(candidate)));if(!item)throw Error('Saved current media is no longer in the frozen session. Discard the unfinished session to continue.');restoredView={item,position:Number.isFinite(saved.view.position)&&saved.view.position>=0?saved.view.position:0};}
  run.interrupt();
 }else{
  const manifests={},enabled=profile.packs.filter(pack=>pack.owned&&pack.enabled);
  if(params.has('snapshot')){
   const selected=enabled.find(pack=>pack.id===params.get('snapshot'));if(!selected)throw Error('Enable this owned snapshot pack before playing it.');let savedAt;
   for(const pack of enabled){if(pack.id===selected.id||pack.selection.ids.length||pack.selection.rules.length){const snapshot=await store.pinSnapshot(library,pack.id,sessionId+':'+pack.id);pinnedPacks.push(pack.id);if(snapshot.library_id!==pack.library_id)throw Error(`Pack ${pack.name}: saved snapshot belongs to another library.`);manifests[pack.id]={library_id:snapshot.library_id,media:snapshot.media};if(pack.id===selected.id){music=snapshot.music;savedAt=snapshot.saved_at;}}else{const local=await store.resolveLocal(pack.selection,pack.device_id);if(local.unavailable)throw Error(`Pack ${pack.name} has ${local.unavailable} unavailable device-local members.`);manifests[pack.id]={library_id:pack.library_id,media:local.media};}}
   $('source').textContent=`Saved snapshots · ${enabled.length} enabled packs · ${savedAt}`;
  }else{
   for(const pack of enabled){const manifest=pack.selection.ids.length||pack.selection.rules.length?await api('/api/fanservice/v1/resolve?selection='+encodeURIComponent(JSON.stringify({ids:pack.selection.ids,rules:pack.selection.rules}))):{library_id:pack.library_id,media:[]};const local=await store.resolveLocal(pack.selection,pack.device_id);if(local.unavailable)throw Error(`Pack ${pack.name} has ${local.unavailable} unavailable device-local members.`);manifest.media=manifest.media.map(item=>({...item,url:new URL(item.url,store.server()).href}));manifest.media.push(...local.media);manifests[pack.id]=manifest;}
   const track=Number(params.get('track'));if(track)music=await api(`/api/fanservice/v1/music/${track}/manifest`);$('source').textContent='Live contents resolved · frozen for this session';
  }
  media=FanserviceModel.freezeSession(profile,manifests).media;if(music)modeSelect.value=2;settingsChanged();installRun(makeRun());
 }
 if(saved)$('difficulty').value=String(run.config.difficulty??1);
 const missing=['slow','medium','fast','succubus','cum'].filter(pool=>!decks[pool].length);if(missing.length)throw Error('Enabled packs lack required gameplay pools: '+missing.join(', ')+'. Enable complementary packs or organize their tags in full fanservice.');
 if(music){store.validateMusic(music,{libraryId:library,playable:true});map=music.beatmap;soundtrackWarnings=map.events.filter(e=>['edge','disable_break','restore_break'].includes(e.type)).map(e=>e.time);audio.src=music.url||new URL(music.stream_url,store.server());if(saved){restorePosition=saved.position;audio.addEventListener('loadedmetadata',()=>{audio.currentTime=saved.position;},{once:true});}}
 if(restoredView)showMedia(restoredView.item,restoredView.position);else draw(category,{prepare:!saved});renderTower();render();$('start').disabled=false;status(saved?'Unfinished session ready. Tap Start to resume.':'Ready. Tap Start to enable local playback and audio.');requestAnimationFrame(tick);
})().catch(async error=>{status(error.message);$('start').disabled=true;if(!started&&!restoring)await releasePins().catch(()=>{});if(restoring)settingsPanel.append(action('Discard unfinished session',async()=>{if(!confirm('Discard this unfinished session without granting rewards? Saved library media and pack ownership are retained.'))return;await releasePins();localStorage.removeItem(checkpointKey);location.reload();}));});
