(function(root){
 'use strict';
 const presets={
  normalbeatbackground:{id:'normal',label:'Normal procedural preset',css:'radial-gradient(ellipse at bottom,#254b4d,#101722 70%)'},
  succubusbackground:{id:'succubus',label:'Succubus procedural preset',css:'radial-gradient(ellipse at bottom,#572c63,#171127 70%)'},
  successfulcumbackground:{id:'success',label:'Success procedural preset',css:'radial-gradient(ellipse at bottom,#57652b,#15221b 70%)'},
  temptationbackground:{id:'temptation',label:'Temptation procedural preset',css:'radial-gradient(ellipse at bottom,#6c4e27,#17141e 70%)'},
  tauntbackground:{id:'taunt',label:'Taunt procedural preset',css:'radial-gradient(ellipse at bottom,#693148,#1d1423 70%)'},
  mercybackground:{id:'mercy',label:'Mercy procedural preset',css:'radial-gradient(ellipse at bottom,#284f72,#101a2a 70%)'}
 };
 function resolve(value){
  const name=typeof value==='string'?value.trim().toLowerCase():'';
  if(Object.hasOwn(presets,name))return {...presets[name],recognized:true};
  const numeric=typeof value==='number'?value:typeof value==='string'&&value.length<=80&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())?Number(value):NaN;
  if(Number.isFinite(numeric)){
   const hue=(((numeric%360)*43)%360+360)%360;
   return {id:'numeric',label:'Numeric procedural preset',css:`radial-gradient(ellipse at bottom,hsl(${hue} 40% 25%),#101722)`,recognized:true};
  }
  return {...presets.normalbeatbackground,label:'Unrecognized background; Normal procedural preset',recognized:false};
 }
 function apply(stage,value,output){
  const preset=resolve(value);
  stage.style.background=preset.css;
  stage.dataset.backgroundPreset=preset.id;
  if(output)output.textContent='Background: '+preset.label+'.';
  return preset;
 }
 const api={resolve,apply};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceBackground=api;
})(globalThis);
