const test=require('node:test'),assert=require('node:assert/strict');
const {Favorites,categories}=require('../static/fanservice/favorites');
// Favorite-injection roll threshold default (10) is the Blueprint-side
// FavoritesLikelyhoodPercent (BP_GlobalManager CDO); the native
// controller+0x30 provenance is unestablished — see the module header.
function stubRandom(values){let i=0;return {fraction:()=>values[i++%values.length]};}
function entry(filename,category,item){return {filename,category,isFavorite:false,...(item?{item}:{})};}
function setup(values=[.5]){const favorites=new Favorites({random:stubRandom(values)});favorites.register([entry('a.png',0),entry('b.png',1),entry('c.png',2),entry('d.png',0)]);return favorites;}
test('toggle moves the entry between the registries and flips the flag',()=>{
 const favorites=setup();const result=favorites.toggleFavorite(entry('a.png',0));
 assert.equal(result.isFavorite,true);assert.equal(result.filename,'a.png');
 assert.equal(favorites.master.get(0).some(e=>e.filename==='a.png'),false);
 assert.equal(favorites.favoritesSource.get(0).some(e=>e.filename==='a.png'&&e.isFavorite),true);
 assert.equal(favorites.remainingFavorites.get(0).some(e=>e.filename==='a.png'),true);
 assert.equal(favorites.getFavoriteFrenzyCardCount(),1);
 assert.deepEqual(favorites.master.get(9).map(e=>e.filename),['a.png']);
 const back=favorites.toggleFavorite(entry('a.png',0));
 assert.equal(back.isFavorite,false);
 assert.equal(favorites.master.get(0).some(e=>e.filename==='a.png'&&!e.isFavorite),true);
 assert.equal(favorites.favoritesSource.get(0)?.some(e=>e.filename==='a.png')||false,false);
 assert.equal(favorites.getFavoriteFrenzyCardCount(),0);
});
test('toggle is a no-op returning the input unchanged before registration',()=>{
 const favorites=new Favorites({random:stubRandom([.5])});
 const input=entry('a.png',0);assert.deepEqual(favorites.toggleFavorite(input),input);
 assert.equal(favorites.getFavoriteFrenzyCardCount(),0);
});
test('toggle of an unknown filename changes nothing and reports not-favorite',()=>{
 const favorites=setup();const result=favorites.toggleFavorite(entry('missing.png',0));
 assert.equal(result.isFavorite,false);assert.equal(favorites.getFavoriteFrenzyCardCount(),0);
 assert.equal(favorites.master.get(0).length,2);
});
test('filename matching is case-insensitive',()=>{
 const favorites=setup();const result=favorites.toggleFavorite(entry('A.PNG',0));
 assert.equal(result.isFavorite,true);assert.equal(favorites.favoritesSource.get(0).some(e=>e.filename==='a.png'),true);
});
test('rebuild dedupes by anti-repeat key and installs the key-9 deck',()=>{
 const favorites=new Favorites({random:stubRandom([.5])});
 favorites.register([entry('shared.png',0),entry('SHARED.png',1),entry('other.png',2)]);
 favorites.toggleFavorite(entry('shared.png',0));favorites.toggleFavorite(entry('SHARED.png',1));favorites.toggleFavorite(entry('other.png',2));
 assert.equal(favorites.getFavoriteFrenzyCardCount(),2);
 assert.deepEqual([...favorites.master.get(9).map(e=>e.filename)].sort(),['other.png','shared.png']);
 assert.equal(favorites.favoritesSource.has(9),false);assert.equal(favorites.remainingFavorites.has(9),false);
 assert.ok(favorites.master.get(9).every(e=>e.isFavorite));
});
test('rebuild shuffles the key-9 remaining deck',()=>{
 const make=values=>{const favorites=new Favorites({random:stubRandom(values)});favorites.register([entry('a.png',0),entry('b.png',0),entry('c.png',0),entry('d.png',0)]);for(const name of ['a.png','b.png','c.png','d.png'])favorites.toggleFavorite(entry(name,0));return favorites.remaining.get(9).map(e=>e.filename).join(',');};
 assert.notEqual(make([0]),make([.99]));
});
test('getters match the native semantics including current-category keying',()=>{
 const favorites=setup();favorites.toggleFavorite(entry('a.png',0));favorites.toggleFavorite(entry('d.png',0));
 assert.equal(favorites.getFavoriteFrenzyCardCount(),2);
 assert.equal(favorites.hasEnoughFavoriteFrenzyCards(2),true);assert.equal(favorites.hasEnoughFavoriteFrenzyCards(3),false);
 assert.equal(favorites.hasEnoughFavoriteFrenzyCards(-5),true);
 favorites.setCurrentCategory(0);
 assert.equal(favorites.getRemainingCards(),2);assert.equal(favorites.getRemainingFavoriteCards(),2);
 favorites.setCurrentCategory(1);
 assert.equal(favorites.getRemainingCards(),1);assert.equal(favorites.getRemainingFavoriteCards(),0);
});
test('category-9 draw pops from the shuffled key-9 deck; empty deck yields no fallback',()=>{
 const favorites=setup();favorites.toggleFavorite(entry('a.png',0));favorites.toggleFavorite(entry('d.png',0));
 const first=favorites.drawForCategory(9);assert.ok(['a.png','d.png'].includes(first.filename));
 const second=favorites.drawForCategory(9);assert.ok(['a.png','d.png'].includes(second.filename));assert.notEqual(first.filename,second.filename);
 assert.equal(favorites.getFavoriteFrenzyCardCount(),2);
 const empty=new Favorites({random:stubRandom([.5])});empty.register([entry('a.png',0)]);
 assert.equal(empty.drawForCategory(9),null);assert.equal(empty.drawForCategory(0).filename,'a.png');
});
test('normal draw injects a favorite on a roll hit and draws normally on a miss',()=>{
 const favorites=setup([.05]);favorites.toggleFavorite(entry('a.png',0));favorites.setCurrentCategory(0);
 const hit=favorites.drawForCategory(0);assert.equal(hit.filename,'a.png');assert.equal(hit.isFavorite,true);
 assert.equal(favorites.seen.has('a.png'),true);
 const missed=setup([.5]);missed.toggleFavorite(entry('a.png',0));missed.setCurrentCategory(0);
 const drawn=missed.drawForCategory(0);
 // Native ToggleFavorite removes the entry from the master registry only,
 // not the remaining deck: the remaining-deck copy (isFavorite false) is
 // still drawable until that deck exhausts and refills from master.
 assert.equal(drawn.filename,'a.png');assert.equal(drawn.isFavorite,false);
 assert.equal(missed.remainingFavorites.get(0).length,1);
});
test('drawn favorites refill from the source map and reshuffle on exhaustion',()=>{
 const favorites=setup([.05]);favorites.toggleFavorite(entry('a.png',0));favorites.setCurrentCategory(0);
 assert.equal(favorites.drawForCategory(0).filename,'a.png');
 assert.equal(favorites.remainingFavorites.get(0).length,1);
 assert.equal(favorites.drawForCategory(0).filename,'a.png');
});
test('draw cycle refresh clears the seen set once every registered key is seen',()=>{
 const favorites=new Favorites({random:stubRandom([.99])});favorites.register([entry('a.png',0)]);
 favorites.drawForCategory(0);assert.equal(favorites.seen.size,1);
 favorites.drawForCategory(0);assert.equal(favorites.seen.size,1);
});
test('injectFavorite rolls against the threshold and consumes nothing on a miss',()=>{
 const hit=setup([.05]);hit.toggleFavorite(entry('a.png',0));
 assert.equal(hit.injectFavorite(0).filename,'a.png');
 const miss=setup([.5]);miss.toggleFavorite(entry('a.png',0));
 assert.equal(miss.injectFavorite(0),null);
 assert.equal(miss.remainingFavorites.get(0).length,1);assert.equal(miss.seen.size,0);
 const zero=new Favorites({random:stubRandom([0]),threshold:0});zero.register([entry('a.png',0)]);zero.toggleFavorite(entry('a.png',0));
 assert.equal(zero.injectFavorite(0),null);
 const frenzy=setup([.05]);frenzy.toggleFavorite(entry('a.png',0));
 assert.equal(frenzy.injectFavorite(9),null);
});
test('default injection threshold is the Blueprint-side 10',()=>{
 assert.equal(new Favorites({random:stubRandom([.5])}).threshold,10);
 assert.equal(new Favorites({random:stubRandom([.5]),threshold:25}).threshold,25);
});
