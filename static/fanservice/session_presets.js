(function(root){
 'use strict';
 const VERSION=1,LIMIT=8;
 const defaultSpecs=[
  {min:1,max:1},{min:300,max:10800},{min:50,max:20000},{min:1,max:100},
  {min:30,max:600},{min:1,max:20},{min:5,max:100}
 ];
 function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
 function validSettings(value,specs){
  if(!plain(value))return null;
  const s={mode:value.mode,difficulty:value.difficulty,objective:value.objective,target:value.target,rounds:value.rounds,loot:value.loot,holding:value.holding,vibration:value.vibration,wake:value.wake};
  if(!Number.isInteger(s.mode)||s.mode<0||s.mode>2||!Number.isInteger(s.difficulty)||s.difficulty<0||s.difficulty>2||!Number.isInteger(s.objective)||s.objective<0||s.objective>6||!Number.isFinite(s.target)||!Number.isInteger(s.target)||s.target<1||s.target>86400||!Number.isInteger(s.rounds)||s.rounds<1||s.rounds>1000||typeof s.loot!=='boolean'||!['left','right'].includes(s.holding)||!['off','event','beat'].includes(s.vibration)||typeof s.wake!=='boolean')return null;
  const spec=specs[s.objective];
  if(!spec||!Number.isFinite(spec.min)||!Number.isFinite(spec.max)||s.target<spec.min||s.target>spec.max)return null;
  return s;
 }
 function validEntry(entry,specs){
  if(!plain(entry)||typeof entry.name!=='string')return null;
  const name=entry.name.trim();if(!name||name.length>40)return null;
  const settings=validSettings(entry.settings,specs);return settings?{name,settings}:null;
 }
 function normalize(input,specs=defaultSpecs){
  const rows=Array.isArray(input)?input:(plain(input)&&input.version===VERSION&&Array.isArray(input.presets)?input.presets:[]),result=[];
  for(const row of rows){if(result.length>=LIMIT)break;const entry=validEntry(row,specs);if(entry)result.push(entry);}
  return {version:VERSION,presets:result};
 }
 function save(entries,name,settings,specs=defaultSpecs){
  if(typeof name!=='string'||!name.trim()||name.trim().length>40)throw new TypeError('Preset name must be 1 to 40 characters.');
  const normalized=normalize(entries,specs).presets,entry=validEntry({name,settings},specs);
  if(!entry)throw new TypeError('Preset settings are invalid.');
  const index=normalized.findIndex(row=>row.name.toLocaleLowerCase()===entry.name.toLocaleLowerCase());
  if(index>=0)normalized[index]=entry;
  else {if(normalized.length>=LIMIT)throw new RangeError('At most 8 session presets are allowed.');normalized.push(entry);}
  return normalized;
 }
 const api={normalize,save,VERSION,LIMIT};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceSessionPresets=api;
})(globalThis);
