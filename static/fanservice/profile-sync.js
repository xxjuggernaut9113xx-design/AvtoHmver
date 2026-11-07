(function(root){
 'use strict';
 class Transport {
  constructor({binding,fetch:request=root.fetch.bind(root),timeout=10000}){this.binding=binding;this.fetch=request;this.timeout=timeout;this.pending=false;}
  capture(){return JSON.stringify(this.binding());}
  assertCurrent(binding){if(this.capture()!==binding)throw Error('Profile or sync connection changed. The response was discarded; retry from the current profile.');}
  async request(method,body){
   if(this.pending)throw Error('Wait for the current profile synchronization.');
   const binding=this.capture(),c=JSON.parse(binding);
   if(!['GET','PUT'].includes(method)||!/^[a-zA-Z0-9-]{1,80}$/.test(c.id)||!/^[a-fA-F0-9]{64}$/.test(c.key)||!Number.isSafeInteger(c.revision)||c.revision<0)throw Error('Create or import a valid sync connection.');
   if(method==='PUT'&&body?.expected_revision!==c.revision)throw Error('Sync revision changed. Retry from the current profile.');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeout);this.pending=true;
   try{
    const response=await this.fetch(new URL('/api/fanservice/v1/profiles/'+c.id,c.server),{method,credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','X-Fanservice-Profile-Key':c.key},body:body?JSON.stringify(body):undefined});
    const data=await response.json();this.assertCurrent(binding);
    if(!response.ok)throw Error(data.error||'Profile synchronization failed.');
    if(!Number.isSafeInteger(data.revision)||data.revision<0||method==='PUT'&&data.revision!==c.revision+1)throw Error('Server returned an invalid profile revision. Local sync state was retained.');
    return {data,binding};
   }catch(error){if(controller.signal.aborted)throw Error('Profile synchronization timed out. Local data was retained; check the remote revision before uploading again.');throw error;}
   finally{clearTimeout(timer);this.pending=false;}
  }
 }
 const copy=value=>JSON.parse(JSON.stringify(value));
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 function portablePack(pack){
  const selection=pack?.selection||{},ids=Array.isArray(selection.ids)?selection.ids:[],rules=Array.isArray(selection.rules)?selection.rules:[];
  if(!ids.length&&!rules.length)return null;
  const result={id:pack.id,name:pack.name,description:pack.description,unlock_cost:pack.unlock_cost,library_id:pack.library_id,selection:{ids:copy(ids),rules:copy(rules)}};
  if(typeof pack.author==='string')result.author=pack.author;
  if(typeof pack.cover_id==='string'&&!pack.cover_id.startsWith('local:'))result.cover_id=pack.cover_id;
  return result;
 }
 function portableProfile(profile){return {version:1,unlock_points:0,packs:(profile.packs||[]).map(portablePack).filter(Boolean)};}
 function packIdentity(pack){return typeof pack?.id==='string'?pack.id:'';}
 function definition(pack){return portablePack(pack)||{id:packIdentity(pack),name:pack?.name,description:pack?.description};}
 function diff(local,remote){
  const a=new Map((local.packs||[]).map(pack=>[packIdentity(pack),pack])),b=new Map((remote.packs||[]).map(pack=>[packIdentity(pack),pack]));
  if([...a.keys(),...b.keys()].some(id=>!id)||a.size!==(local.packs||[]).length||b.size!==(remote.packs||[]).length)throw Error('Profile contains a missing or duplicate pack ID.');
  return [...new Set([...a.keys(),...b.keys()])].sort().flatMap(id=>{
   const before=a.get(id),after=b.get(id);
   if(before&&after&&JSON.stringify(stable(definition(before)))===JSON.stringify(stable(definition(after))))return [];
   return [{id,local:before?copy(before):null,remote:after?copy(after):null,kind:!before?'remote-only':!after?'local-only':'changed'}];
  });
 }
 function applyChoices(local,remote,differences,choices){
  const selected=new Map();for(const item of differences){const choice=choices[item.id],allowed=item.kind==='changed'?['local','remote']:item.kind==='local-only'?['local','remove']:['remote','skip'];if(!allowed.includes(choice))throw Error(`Choose a version for ${item.local?.name||item.remote?.name||item.id}.`);selected.set(item.id,choice);}
  const localById=new Map((local.packs||[]).map(pack=>[packIdentity(pack),pack])),diffById=new Map(differences.map(item=>[item.id,item]));
  const ids=new Set([...localById.keys(),...(remote.packs||[]).map(packIdentity)]),packs=[];
  for(const id of ids){const item=diffById.get(id),choice=item?selected.get(id):null;let source;
   if(!item)source=localById.get(id);
   else if(choice==='local')source=item.local;
   else if(choice==='remote')source=item.remote;
   else if(choice==='remove'||choice==='skip')continue;
   if(!source)continue;
   const pack=copy(source),authority=localById.get(id);
   if(authority){pack.owned=!!authority.owned;pack.enabled=!!authority.enabled;}
   else {pack.owned=false;pack.enabled=false;}
   delete pack.manifest;delete pack.snapshot;delete pack.use_offline;
   packs.push(pack);
  }
  if(packs.length>128)throw Error('A profile can contain at most 128 custom packs.');
  const result=copy(local);result.version=1;result.packs=packs;return result;
 }
 const api={Transport,portablePack,portableProfile,diff,applyChoices};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceProfileSync=api;
})(globalThis);
