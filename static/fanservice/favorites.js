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
 // (0x14826f430) draws from the remaining deck, with a 0-99 roll against the
 // controller+0x30 threshold injecting a favorite from the current
 // category's remaining-favorites deck. There is no CumFavoriteCards
 // equivalent (PDB-wide zero hits).
 //
 // Player deviations, recorded, not hidden:
 // - Anti-repeat key: the native MakeMediaAntiRepeatKey transform was not
 //   decoded, so the lowercased filename is used as the key until it is.
 // - Injection threshold default 10 is the Blueprint-side
 //   FavoritesLikelyhoodPercent (BP_GlobalManager CDO). The native
 //   controller+0x30 provenance (own CDO vs Blueprint-set) is unestablished;
 //   do not treat 10 as a native fact.
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
 // - The FavoriteFrenzy cooldown (120 s, Blueprint) and the frenzy event
 //   trigger / eligibility check are Blueprint-side and NOT modeled here;
 //   the frenzy overlay widgets are not built. The registry is session
 //   state; the original persists bIsFavorite on the saved entry, the
 //   player does not persist favorites yet.
 const categories=Object.freeze({slow:0,medium:1,fast:2,succubus:3,event:4,edge:5,cum:6,ass:7,boobs:8,favorite:9});
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
 function normalize(entry){return {filename:filenameOf(entry),category:categoryOf(entry),isFavorite:entry?.isFavorite===true,item:entry?.item??null};}
 class Favorites{
  constructor({random,threshold}={}){
   this.random=random||{fraction:()=>Math.random()};
   this.threshold=threshold===undefined?10:threshold;
   this.ready=false;this.currentCategory=0;
   this.master=new Map();this.remaining=new Map();
   this.favoritesSource=new Map();this.remainingFavorites=new Map();
   this.universe=new Set();this.seen=new Set();
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
    this.arrayFor(this.favoritesSource,homeCategory).push(copy);
    this.arrayFor(this.remainingFavorites,homeCategory).push({...copy});
    this.removeByFilename(this.master.get(homeCategory),entry.filename);
   }else{
    for(const [category,array] of this.favoritesSource.entries()){
     const match=this.findByFilename(array,entry.filename);
     if(match){found=match;homeCategory=category;break;}
    }
    if(!found)return {...entry,isFavorite:false};
    const copy={...found,isFavorite:false};
    this.arrayFor(this.master,homeCategory).push(copy);
    this.arrayFor(this.remaining,homeCategory).push({...copy});
    this.removeByFilename(this.favoritesSource.get(homeCategory),entry.filename);
    this.removeByFilename(this.remainingFavorites.get(homeCategory)||[],entry.filename);
   }
   this.rebuildFavoriteFrenzyCategory();this.rebuildGlobalDrawCycleUniverse();
   return {...entry,isFavorite:!!found&&this.isFavorite(entry)};
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
  drawForCategory(category,random){
   if(!this.ready)return null;
   this.setCurrentCategory(category);this.refreshCycleIfComplete();
   const source=random||this.random;
   let array=null,favoritesPath=false;
   if(category!==9&&this.threshold>0){
    const favoritesDeck=this.remainingFavorites.get(category)||[];
    if(favoritesDeck.some(entry=>filenameOf(entry))){
     const roll=Math.floor(source.fraction()*100);
     if(roll<this.threshold)favoritesPath=true;
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
   const roll=Math.floor(source.fraction()*100);
   if(roll>=this.threshold)return null;
   const entry=this.popAvoidingAntiRepeat(deck);
   if(!entry)return null;
   this.markSeen(entry);
   if(!deck.length)this.refillFavorites(category);
   return entry;
  }
  getFavoriteFrenzyCardCount(){return this.master.get(9)?.length||0;}
  hasEnoughFavoriteFrenzyCards(count){return this.getFavoriteFrenzyCardCount()>=Math.max(count||0,0);}
  getRemainingCards(){return this.remaining.get(this.currentCategory)?.length||0;}
  getRemainingFavoriteCards(){return this.remainingFavorites.get(this.currentCategory)?.length||0;}
 }
 const api={Favorites,categories};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceFavorites=api;
})(globalThis);
