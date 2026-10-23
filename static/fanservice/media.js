(function(root){
 'use strict';
 const errors={1:'Playback was interrupted.',2:'Media could not be read. Check access or the Server connection.',3:'This browser could not decode the media.',4:'This browser does not support the media format or codec.'};
 function observe(media,report){
  const listeners=[],video=media.tagName.toLowerCase()==='video';let last=0,verified=false;
  const on=(name,handler)=>{media.addEventListener(name,handler);listeners.push([name,handler]);};
  on('loadstart',()=>{last=0;verified=false;report('Reading saved media.');});
  on('error',()=>report(video?(errors[media.error?.code]||'Video playback failed.'):'This browser could not decode the saved image. Try a browser-supported image format.'));
  if(video){
   on('loadeddata',()=>report(`Video frame decoded: ${media.videoWidth} × ${media.videoHeight}. Tap Play to verify playback.`));
   on('waiting',()=>report('Video is waiting for media data.'));
   on('timeupdate',()=>{if(!media.paused&&!media.seeking&&media.currentTime>last+.05&&!verified){verified=true;report('Video playback verified: the playback clock is advancing.');}last=media.currentTime;});
  }else on('load',()=>report(`Image decoded: ${media.naturalWidth} × ${media.naturalHeight}.`));
  return ()=>{for(const [name,handler] of listeners)media.removeEventListener(name,handler);};
 }
 const api={observe};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FanserviceMedia=api;
})(globalThis);
