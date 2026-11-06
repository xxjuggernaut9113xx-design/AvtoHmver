(function(root){
 'use strict';
 const normalize=mode=>['off','event','beat'].includes(mode)?mode:'event';
 function create(pulse,initialMode){
  let mode=normalize(initialMode),pulsed=false;
  function emit(duration){
   pulsed=true;
   pulse(duration);
  }
  function cancel(){
   if(!pulsed)return;
   pulsed=false;
   pulse(0);
  }
  return {
   mode(value){
    const next=normalize(value);
    if(mode!==next)cancel();
    mode=next;
   },
   cancel,
   advance(from,to,deadlines){
    if(mode==='event'&&to>from&&deadlines.some(at=>from<at-3&&at-3<=to&&to<at))emit(100);
   },
   beat(){if(mode==='beat')emit(25);}
  };
 }
 const api={create,normalize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.FanserviceVibration=api;
})(globalThis);
