(function(root){
 'use strict';
 // Favorites (v0.05.1 native UMediaPlaybackController disassembly — see
 // docs/parity/evidence/ticket44-favorites-native-20261111.md). ToggleFavorite
 // (0x1482bd300) flips one media entry's bIsFavorite flag (+0x41) and moves
 // it between the master deck registry (+0x328) and the favorites source
 // registry (+0x3c8); RebuildFavoriteFrenzyCategory (0x148299d10) re-derives
 // the FavoriteFrenzy deck (category 9) from the favorites source registry,
 // deduped by anti-repeat key, and installs it (shuffled) as the key-9 deck
 // in the master and remaining-deck maps; DrawNextCardForCategory
 // (0x14826f430) draws from the remaining deck, with a 1-100 roll against the
 // controller+0x30 threshold injecting a favorite from the current
 // category's remaining-favorites deck (RollFavoritesChance, BP_GlobalManager:
 // RandomIntegerInRange(1, 100), success iff roll <=
 // FavoritesLikelyhoodPercent). CumFavoriteCards EXISTS Blueprint-side
 // (DrawManager pool, CardManager Master_Favorite_Cum, SaveGame
 // Saved_Cum_FavoriteCards) — the earlier native-only "no equivalent"
 // finding stands only for native code (see
 // docs/parity/evidence/ticket44-favorites-blueprint-20261111.md).
 // AddFavoriteCardToArray (BP_DrawManager) is a per-category toggle over
 // Slow/Medium/Fast/Succubus/Cum; Event/Edging/AssFrenzy/BoobFrenzy
 // dispatch to the Fast block.
 //
 // Player deviations, recorded, not hidden:
 // - Anti-repeat key: the native MakeMediaAntiRepeatKey transform was not
 //   decoded, so the lowercased filename is used as the key until it is.
 // - Injection threshold default 20 is the SAVE-GAME default, not the GM
 //   CDO 10: BP_CHSaveGame_C FavoritesLikelihoodPercentage defaults to 20
 //   (save-class-defaults.json, payload 85d62672), and
 //   InitializeFavoriteLikelihood (UI_Manager, 22 stmts) copies it into
 //   GM FavoritesLikelyhoodPercent (stmt 4) and then into the native
 //   controller's FavoritePercentage (stmt 5) at UI init — before any
 //   draw — and the FavoritesFrequencySlider change handler keeps all
 //   three in sync (UI_Manager ubergraph stmts 669/675/679). The GM CDO
 //   10 is only the pre-init default and never reaches a roll. The
 //   controller field is the single favorites-percentage property on
 //   UMediaPlaybackController in all retained evidence, so it is the
 //   +0x30 roll threshold by elimination; the offset identity itself was
 //   not read from a property-offset table. The slider itself is not
 //   modeled in the player (no settings UI for it), so the threshold is
 //   the default 20 unless a caller passes one.
 // - Hard/soft anti-repeat blocked sets: the native builds both from
 //   BuildAntiRepeatBlockedKeys / BuildSoftGlobalAntiRepeatBlockedKeys,
 //   whose contents were not decoded. The player uses the seen set (keys
 //   drawn this cycle) for both.
 // - ToggleFavorite removes the entry from the master registry only, NOT
 //   from the remaining deck (native §4): a favorited entry stays drawable
 //   from the normal remaining deck until that deck exhausts and refills
 //   from master. Unfavorite appends to master AND remaining (§4), which
 //   can duplicate an entry already lingering in the remaining deck; the
 //   seen set keeps the duplicate from drawing twice in one cycle.
 // - The FavoriteFrenzy cooldown (120 s, Blueprint) and the frenzy gate
 //   ARE modeled here (isFavoriteFrenzyEligible /
 //   startFavoriteFrenzyCooldown / triggerFavoriteFrenzy — see below).
 // - Persistence across sessions (ticket44-favorites-persistence-20261112):
 //   the original DOES persist favorites — the five per-category
 //   Saved_*_FavoriteCards arrays (full CHPackMediaEntry structs,
 //   bIsFavorite at +0x41) plus AllFavoritedCards_Array on
 //   BP_CHSaveGame_C, written by SaveGameToSlot on EVERY toggle
 //   (AddFavoriteCardToArray syncs master -> save array and calls
 //   GameInstance.SaveAllData() immediately, both paths, all five
 //   categories) and restored at startup by
 //   Validate&PopulateSavedMedia via UCHPackManager::ValidateMediaEntries
 //   (keep iff filename length > 1 and IFileManager::FileExists). The
 //   derived FavoriteFrenzy deck is NOT stored; it is rebuilt from the
 //   restored registry. The player mirrors this: serializeFavorites /
 //   restoreFavorites persist the favorited set as {filename, home
 //   category} pairs (the per-category split is recoverable from the home
 //   category), play.js writes them to the game profile on every toggle
 //   and restores them in installRun, dropping entries whose file is no
 //   longer in the pack. The Medium-add ([card]-only save) and Succubus
 //   (normal-deck) wiring quirks of AddFavoriteCardToArray are decoded
 //   but NOT copied — no caller of that function was found and both
 //   contradict the native ToggleFavorite registry model mirrored here.
 //   The frenzy event's presentation (FastPaceAnim, dialogue 0, background
 //   3, music 2, FavoriteFrenzySpawnOverlay_Widget) is carried in the
 //   trigger's spawn spec and play.js acts on the wireable parts (draw():
 //   the 1.75 s overlay banner, the Fast! flash, the Normal Beat
 //   Background). The dialogue and music are not modeled — see
 //   docs/parity/evidence/ticket44-favorites-blueprint-20261111.md. The trigger's
 //   CALL SITE is settled (BP_DrawManager TriggerSelectedEvent stmt 62 @2142,
 //   event code 12, gated at filter time by
 //   BP_GlobalManager CheckEventConditions&ReturnArray stmt 82 @2363 via
 //   FavoriteFrenzyEligibilityCheck); play.js wires it through
 //   automaticMediaPool.
 const categories=Object.freeze({slow:0,medium:1,fast:2,succubus:3,event:4,edge:5,cum:6,ass:7,boobs:8,favorite:9});
 const FRENZY_MIN_CARDS=3,FRENZY_COOLDOWN_SECONDS=120;
 const poolNames=['slow','medium','fast','succubus','cum','ass','boobs'];
 const categoryByPool={slow:0,medium:1,fast:2,succubus:3,cum:6,ass:7,boobs:8};
 function filenameOf(entry){return String(entry?.filename??entry?.file??'');}
 function keyOf(entry){return filenameOf(entry).toLowerCase();}
 function categoryOf(entry){
  if(Number.isSafeInteger(entry?.category)&&entry.category>=0&&entry.category<=9)return entry.category;
  const tags=(entry?.tags||[]).map(tag=>String(tag).toLowerCase());
  for(const name of poolNames)if(tags.includes(name))return categoryByPool[name];
  return 0;
 }
 // AddFavoriteCardToArray (BP_DrawManager): Event (4), Edging (5),
 // AssFrenzy (7) and BoobFrenzy (8) dispatch to the Fast block — their
 // favorites live in the Fast registry, not their own category's.
 function favoriteHomeCategory(category){return [4,5,7,8].includes(category)?2:category;}
 function normalize(entry){return {filename:filenameOf(entry),category:categoryOf(entry),isFavorite:entry?.isFavorite===true,item:entry?.item??entry??null};}
 class Favorites{
  constructor({random,threshold}={}){
   this.random=random||{fraction:()=>Math.random()};
   this.threshold=threshold===undefined?20:threshold;
   this.ready=false;this.currentCategory=0;
   this.master=new Map();this.remaining=new Map();
   this.favoritesSource=new Map();this.remainingFavorites=new Map();
   this.universe=new Set();this.seen=new Set();
   this.frenzyCooldownEndsAt=null;
  }
  arrayFor(map,category){let array=map.get(category);if(!array){array=[];map.set(category,array);}return array;}
  findByFilename(array,filename){const key=String(filename).toLowerCase();return array.find(entry=>keyOf(entry)===key);}
  removeByFilename(array,filename){const key=String(filename).toLowerCase(),index=array.findIndex(entry=>keyOf(entry)===key);if(index>=0)array.splice(index,1);return index>=0;}
  shuffle(array,random){
   const source=random||this.random;
   for(let i=array.length-1;i>0;i--){const j=Math.floor(source.fraction()*(i+1));[array[i],array[j]]=[array[j],array[i]];}
   return array;
  }
  register(entries){
   for(const input of entries||[]){
    const entry=normalize(input);
    if(!entry.filename)continue;
    this.arrayFor(this.master,entry.category).push({...entry,isFavorite:false});
    this.arrayFor(this.remaining,entry.category).push({...entry,isFavorite:false});
   }
   this.ready=true;this.rebuildGlobalDrawCycleUniverse();
   return this;
  }
  isFavorite(input){
   const key=keyOf(input);if(!key)return false;
   for(const array of this.favoritesSource.values())if(this.findByFilename(array,key))return true;
   return false;
  }
  setCurrentCategory(category){if(Number.isSafeInteger(category)&&category>=0&&category<=9)this.currentCategory=category;return this.currentCategory;}
  toggleFavorite(input){
   const entry=normalize(input);
   if(!this.ready||!entry.filename)return input;
   let found=null,homeCategory=null;
   for(const [category,array] of this.master.entries()){
    if(category===9)continue;
    const match=this.findByFilename(array,entry.filename);
    if(match){found=match;homeCategory=category;break;}
   }
   if(found){
    const copy={...found,isFavorite:true};
    const home=favoriteHomeCategory(homeCategory);
    this.arrayFor(this.favoritesSource,home).push(copy);
    this.arrayFor(this.remainingFavorites,home).push({...copy});
    this.removeByFilename(this.master.get(homeCategory),entry.filename);
   }else{
    for(const [category,array] of this.favoritesSource.entries()){
     const match=this.findByFilename(array,entry.filename);
     if(match){found=match;homeCategory=category;break;}
    }
    if(!found)return {...entry,isFavorite:false};
    const copy={...found,isFavorite:false};
    this.arrayFor(this.master,found.category).push(copy);
    this.arrayFor(this.remaining,found.category).push({...copy});
    this.removeByFilename(this.favoritesSource.get(homeCategory),entry.filename);
    this.removeByFilename(this.remainingFavorites.get(homeCategory)||[],entry.filename);
   }
   this.rebuildFavoriteFrenzyCategory();this.rebuildGlobalDrawCycleUniverse();
   return {...entry,isFavorite:!!found&&this.isFavorite(entry)};
  }
  // Persistence across sessions (ticket44-favorites-persistence-20261112):
  // the original persists the five per-category Saved_*_FavoriteCards
  // arrays and restores them at startup via ValidateMediaEntries (keep
  // iff the file still exists); the derived FavoriteFrenzy deck is NOT
  // stored. The persisted form here is the favorited set as {filename,
  // home category} pairs — the home category is the favoritesSource map
  // KEY (the per-category split is recoverable from it), not the entry's
  // own category field (they differ for 4/5/7/8, which dispatch to Fast).
  static parseSavedFavorites(value){
   let entries=null;
   if(Array.isArray(value))entries=value;
   else if(value!==null&&typeof value==='object'){
    if(value.version!==undefined&&value.version!==1)return [];
    if(!Array.isArray(value.entries))return [];
    entries=value.entries;
   }else return [];
   const out=[];
   for(const item of entries){
    if(!item||typeof item!=='object')continue;
    if(typeof item.filename!=='string'||!item.filename)continue;
    if(item.category===undefined)out.push({filename:item.filename});
    else if(Number.isSafeInteger(item.category)&&item.category>=0&&item.category<=9)out.push({filename:item.filename,category:item.category});
   }
   return out;
  }
  serializeFavorites(){
   const out=[];
   for(const [home,array] of this.favoritesSource.entries()){
    if(home===9)continue;
    for(const entry of array)out.push({filename:filenameOf(entry),category:home});
   }
   out.sort((a,b)=>a.filename.toLowerCase()<b.filename.toLowerCase()?-1:a.filename.toLowerCase()>b.filename.toLowerCase()?1:0);
   return out;
  }
  restoreFavorites(list){
   // ValidateMediaEntries analogue: keep a saved entry only if its file
   // is still registered in this session's media; drop the rest.
   const items=Array.isArray(list)?list:[];
   let restored=0,dropped=0;
   if(!this.ready)return {restored:0,dropped:items.length};
   for(const item of items){
    const filename=filenameOf(item);
    if(!filename){dropped++;continue;}
    if(this.isFavorite(item)){restored++;continue;}
    let found=null,foundCategory=null;
    for(const [category,array] of this.master.entries()){
     if(category===9)continue;
     const match=this.findByFilename(array,filename);
     if(match){found=match;foundCategory=category;break;}
    }
    if(!found){dropped++;continue;}
    const home=favoriteHomeCategory(Number.isSafeInteger(item?.category)&&item.category>=0&&item.category<=9?item.category:foundCategory);
    const copy={...found,isFavorite:true};
    this.arrayFor(this.favoritesSource,home).push(copy);
    this.arrayFor(this.remainingFavorites,home).push({...copy});
    this.removeByFilename(this.master.get(foundCategory),filename);
    restored++;
   }
   this.rebuildFavoriteFrenzyCategory();this.rebuildGlobalDrawCycleUniverse();
   return {restored,dropped};
  }
  rebuildFavoriteFrenzyCategory(){
   const deck=[],seenKeys=new Set();
   for(const [category,array] of this.favoritesSource.entries()){
    if(category===9)continue;
    for(const entry of array){
     const key=keyOf(entry);if(key.length<=1||seenKeys.has(key))continue;
     seenKeys.add(key);deck.push({...entry,isFavorite:true});
    }
   }
   this.master.set(9,deck);
   this.remaining.set(9,deck.map(entry=>({...entry})));
   this.favoritesSource.delete(9);this.remainingFavorites.delete(9);
   if(this.remaining.get(9).length)this.shuffle(this.remaining.get(9));
   return deck;
  }
  rebuildGlobalDrawCycleUniverse(){
   this.universe=new Set();
   for(const map of [this.master,this.favoritesSource])for(const array of map.values())for(const entry of array){const key=keyOf(entry);if(key)this.universe.add(key);}
   for(const key of [...this.seen])if(!this.universe.has(key))this.seen.delete(key);
   this.refreshCycleIfComplete();
   return this.universe;
  }
  refreshCycleIfComplete(){
   if(this.universe.size&&this.seen.size>=this.universe.size)this.seen.clear();
   return this.seen;
  }
  refillFavorites(category){
   const source=this.favoritesSource.get(category)||[];
   const array=source.map(entry=>({...entry}));
   this.shuffle(array);
   if(array.length>1){const a=Math.floor(this.random.fraction()*array.length),b=Math.floor(this.random.fraction()*array.length);[array[a],array[b]]=[array[b],array[a]];}
   this.remainingFavorites.set(category,array);
   return array;
  }
  refillNormal(category){
   const source=this.master.get(category)||[];
   const array=source.map(entry=>({...entry}));
   this.shuffle(array);
   this.remaining.set(category,array);
   return array;
  }
  popAvoidingAntiRepeat(array){
   if(!array||!array.length)return null;
   const index=array.findIndex(entry=>!this.seen.has(keyOf(entry)));
   return array.splice(index>=0?index:0,1)[0];
  }
  markSeen(entry){const key=keyOf(entry);if(key&&this.universe.has(key))this.seen.add(key);return this.seen;}
  roll(random){
   // RollFavoritesChance (BP_GlobalManager): RandomIntegerInRange(1, 100).
   // The fraction source is [0, 1); the clamp covers a stub returning 1.
   const source=random||this.random;
   return Math.min(100,1+Math.floor(source.fraction()*100));
  }
  drawForCategory(category,random){
   if(!this.ready)return null;
   this.setCurrentCategory(category);this.refreshCycleIfComplete();
   const source=random||this.random;
   let array=null,favoritesPath=false;
   if(category!==9&&this.threshold>0){
    const favoritesDeck=this.remainingFavorites.get(category)||[];
    if(favoritesDeck.some(entry=>filenameOf(entry))){
     if(this.roll(source)<=this.threshold)favoritesPath=true;
    }
   }
   if(favoritesPath){
    array=this.remainingFavorites.get(category)||[];
    const entry=this.popAvoidingAntiRepeat(array);
    if(entry){this.markSeen(entry);if(!array.length)this.refillFavorites(category);return entry;}
   }
   array=this.remaining.get(category)||[];
   const entry=this.popAvoidingAntiRepeat(array);
   if(!entry)return null;
   this.markSeen(entry);
   if(!array.length)this.refillNormal(category);
   return entry;
  }
  injectFavorite(category,random){
   if(!this.ready||category===9||this.threshold<=0)return null;
   const source=random||this.random;
   const deck=this.remainingFavorites.get(category)||[];
   if(!deck.some(entry=>filenameOf(entry)))return null;
   if(this.roll(source)>this.threshold)return null;
   const entry=this.popAvoidingAntiRepeat(deck);
   if(!entry)return null;
   this.markSeen(entry);
   if(!deck.length)this.refillFavorites(category);
   return entry;
  }
  getFavoriteFrenzyCardCount(){return this.master.get(9)?.length||0;}
  hasEnoughFavoriteFrenzyCards(count){return this.getFavoriteFrenzyCardCount()>=Math.max(count||0,0);}
  // FavoriteFrenzy gate + cooldown (BP_GlobalManager, GM ubergraph):
  // FavoriteFrenzyEligibilityCheck: Eligible = HasEnoughFavoriteFrenzyCards(3)
  // AND NOT IsFavoriteFrenzyOnCooldown?. StartFavoriteFrenzyCooldown:
  // K2_ClearAndInvalidateTimerHandle, IsFavoriteFrenzyOnCooldown? = true,
  // Current_FavoriteFrenzyCooldownSeconds = 0.0, then a 1.0 s looping
  // K2_SetTimerDelegate calls ProgressFavoriteFrenzyCooldown, which adds
  // 1.0 per tick and, at Current >= Master_FavoriteFrenzyCooldownSeconds
  // (120.0, GM CDO), clears the timer, sets the flag false, and prints
  // 'Favorite Frenzy Off Cooldown, Eligible for Draw'. The player models
  // the counter as an absolute session-seconds end time (now + 120);
  // the 1 s tick is an implementation detail with no observable difference.
  // FavoriteFrenzyEvent (entry 81592) spawns SpawnCustomCardEvent
  // (SlowCards, 20, 50, 0.18, 0.25, byte 9, ...) — the gate counts the
  // derived FavoriteFrenzy deck but the event spawns from SlowCards with
  // card type 9 — then FastPaceAnim, PlaySpecialEventDialogue(0), Change
  // Beat Background(3), PlayMusic(2), and creates
  // FavoriteFrenzySpawnOverlay_Widget. The call site is
  // TriggerSelectedEvent (BP_DrawManager, event code 12); triggerFavoriteFrenzy
  // starts the 120 s cooldown and returns the decoded spawn spec, and
  // play.js draws the frenzy card through Cards.start with {frenzy:true}.
  isFavoriteFrenzyOnCooldown(now=0){return this.frenzyCooldownEndsAt!==null&&now<this.frenzyCooldownEndsAt;}
  isFavoriteFrenzyEligible(now=0){return this.hasEnoughFavoriteFrenzyCards(FRENZY_MIN_CARDS)&&!this.isFavoriteFrenzyOnCooldown(now);}
  startFavoriteFrenzyCooldown(now=0){this.frenzyCooldownEndsAt=now+FRENZY_COOLDOWN_SECONDS;return this.frenzyCooldownEndsAt;}
  triggerFavoriteFrenzy(now=0){
   if(!this.isFavoriteFrenzyEligible(now))return null;
   this.startFavoriteFrenzyCooldown(now);
   return {pool:'slow',category:9,minStrokes:20,maxStrokes:50,intervalMin:0.18,intervalMax:0.25,overlay:'FavoriteFrenzySpawnOverlay_Widget',background:3,music:2,dialogue:0};
  }
  getRemainingCards(){return this.remaining.get(this.currentCategory)?.length||0;}
  getRemainingFavoriteCards(){return this.remainingFavorites.get(this.currentCategory)?.length||0;}
 }
 const api={Favorites,categories};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceFavorites=api;
})(globalThis);
