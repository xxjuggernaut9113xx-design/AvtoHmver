const test=require('node:test'),assert=require('node:assert/strict');
const background=require('../static/fanservice/background.js');
const inventory=require('./fixtures/fanservice/music-control-inventory.json');

test('shipped named background event values select distinct explicit procedural presets',()=>{
 const names={normalbeatbackground:'normal',succubusbackground:'succubus',successfulcumbackground:'success',temptationbackground:'temptation',tauntbackground:'taunt',mercybackground:'mercy'};
 assert.deepEqual(Object.keys(names).sort(),Object.keys(inventory.sample_background_values).sort());assert.equal(inventory.sample_map_count,10);
 const css=new Set();for(const [name,id]of Object.entries(names)){const preset=background.resolve(name);assert.equal(preset.id,id);assert.equal(preset.recognized,true);assert.match(preset.label,/procedural preset/);assert.doesNotMatch(preset.css,/NaN|Infinity|url\(/);css.add(preset.css);}assert.equal(css.size,6);
 const normal=background.resolve('normalbeatbackground'),succubus=background.resolve('succubusbackground');
 assert.equal(normal.id,'normal');assert.equal(succubus.id,'succubus');assert.notEqual(normal.css,succubus.css);
 for(const preset of [normal,succubus]){assert.equal(preset.recognized,true);assert.match(preset.label,/procedural preset/);assert.doesNotMatch(preset.css,/NaN|Infinity|url\(/);}
 assert.deepEqual(background.resolve(' NormalBeatBackground '),normal);
});

test('numeric background values retain finite hue behavior including exponent and extreme values',()=>{
 assert.equal(background.resolve(3).css,'radial-gradient(ellipse at bottom,hsl(129 40% 25%),#101722)');
 assert.deepEqual(background.resolve('3'),background.resolve(3));assert.deepEqual(background.resolve('3e0'),background.resolve(3));
 for(const value of [-1,1e308,-1e308,0]){const preset=background.resolve(value);assert.equal(preset.id,'numeric');assert.equal(preset.recognized,true);assert.doesNotMatch(preset.css,/NaN|Infinity/);}
});

test('invalid background values use a labeled safe preset without network or CSS injection',()=>{
 for(const value of [null,undefined,true,false,{},[],NaN,Infinity,-Infinity,'','   ','NaN','https://example.test/image.jpg','url(https://example.test/image.jpg)','x;display:none']){
  const preset=background.resolve(value);assert.equal(preset.id,'normal');assert.equal(preset.recognized,false);assert.match(preset.label,/Unrecognized/);assert.doesNotMatch(preset.css,/NaN|Infinity|url\(|display/);
 }
});

test('applying a background changes only presentation and exposes the chosen preset',()=>{
 const stage={style:{background:'old'},dataset:{},media:{id:'retain'}},status={textContent:''};
 const preset=background.apply(stage,'succubusbackground',status);
 assert.equal(stage.style.background,preset.css);assert.equal(stage.dataset.backgroundPreset,'succubus');assert.equal(status.textContent,'Background: Succubus procedural preset.');assert.deepEqual(stage.media,{id:'retain'});
 background.apply(stage,{},status);assert.equal(stage.dataset.backgroundPreset,'normal');assert.match(status.textContent,/Unrecognized background/);
});
