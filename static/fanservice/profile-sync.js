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
 const api={Transport};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceProfileSync=api;
})(globalThis);
