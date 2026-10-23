/* Shared drafts; independent music adapters never drive the session clock. */
(() => {
  'use strict';
  const defaults = () => ({version:1,id:null,revision:0,name:'Untitled',media_ids:[],collection_id:null,tags:[],media_types:['image','video'],order:'shuffled',display_fit:'contain',captions:true,music_source:'none',playlist_id:null,music_volume:0.5});
  let canEdit=false, musicGeneration=0;
  let presets=[], playlists=[], tracks=[], draft=defaults(), active=null, music=null, media=[], index=0, timer=null;
  const sheet=document.createElement('dialog'); sheet.className='playback-sheet'; sheet.setAttribute('aria-label','Playback setup');
  sheet.innerHTML=`<h2>Playback setup</h2><div class="playback-actions"><button data-action="close">Close</button><button data-action="refresh">Refresh shared library</button></div>

    <p data-access-status></p><p data-status role="status" aria-live="polite"></p><label>Preset<select data-field="preset"><option value="">Current draft</option></select></label>
    <label>Name<input data-field="name" maxlength="160"></label><div class="playback-actions"><button data-action="save">Save</button><button data-action="new">Save as new</button><button data-action="rename">Rename</button><button data-action="delete">Delete</button><button data-action="reload">Reload saved preset</button></div>
    <label>Collection ID (optional)<input data-field="collection_id" type="number" min="1"></label><label>Tags (comma separated)<input data-field="tags"></label><label>Media types<select data-field="media_types"><option value="image,video">Images and videos</option><option value="image">Images</option><option value="video">Videos</option><option value="gif">GIFs</option></select></label>
    <label>Order<select data-field="order"><option value="shuffled">Shuffled</option><option value="sequential">Sequential</option></select></label><label>Display fit<select data-field="display_fit"><option>contain</option><option>cover</option></select></label><label>Captions<input data-field="captions" type="checkbox"></label>
    <label>Music source<select data-field="music_source"><option value="none">None</option><option value="local">Local</option><option value="spotify">Spotify — External</option><option value="apple_music">Apple Music</option><option value="youtube">YouTube — Embedded</option><option value="soundcloud">SoundCloud — Embedded</option></select></label>
    <label>Shared playlist<select data-field="playlist_id"><option value="">Select a playlist</option></select></label><label>Music volume<input data-field="music_volume" type="range" min="0" max="1" step="0.01"></label><button data-action="apply">Apply music to active playback</button>
    <details><summary>Manage music playlists</summary><label>Playlist name<input data-playlist-name maxlength="160"></label><label>Provider link<input data-provider-url type="url" placeholder="https://"></label><label>Local tracks<select data-tracks multiple size="5"></select></label><label>Upload audio<input data-upload type="file" accept=".mp3,.aac,.m4a,.wav,.flac,.ogg" multiple></label><div class="playback-actions"><button data-action="playlist-new">Create playlist</button><button data-action="playlist-save">Update selected playlist</button><button data-action="playlist-delete">Delete selected playlist</button></div></details>
    <p data-mode></p><div data-music></div><div data-visual></div><p data-caption></p><div class="playback-actions"><button data-action="previous">Previous</button><button data-action="next">Next</button><button data-action="pause">Pause playback</button><button data-action="resume">Resume playback</button><button data-action="stop">Stop playback</button></div><button class="playback-start" data-action="start">Start with current draft</button>`;
  document.body.append(sheet);
  sheet.addEventListener('close',()=>{if(music?.isEmbedded){musicGeneration++;music.dispose();music=null;sheet.querySelector('[data-music]').replaceChildren();status('Embedded music stopped when the setup sheet closed. Use Apply music to restart.');}});
  const field=name=>sheet.querySelector(`[data-field="${name}"]`), status=s=>{sheet.querySelector('[data-status]').textContent=s;};
  async function api(url,method='GET',body) {
    const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const result=await response.json(); if(!response.ok){const e=new Error(result.error||'Request failed');e.status=response.status;throw e;}return result;
  }
  function read() { draft={...draft,name:field('name').value,collection_id:Number(field('collection_id').value)||null,tags:field('tags').value.split(',').map(s=>s.trim()).filter(Boolean),media_types:field('media_types').value.split(','),order:field('order').value,display_fit:field('display_fit').value,captions:field('captions').checked,music_source:field('music_source').value,playlist_id:Number(field('playlist_id').value)||null,music_volume:Number(field('music_volume').value)};return structuredClone(draft); }
  function render() { for(const key of ['name','collection_id','order','display_fit','music_source','music_volume'])field(key).value=draft[key]??'';field('tags').value=draft.tags.join(',');field('media_types').value=draft.media_types.join(',');field('captions').checked=draft.captions;field('preset').value=draft.id??'';renderPlaylists(); }
  function options(select,rows,first) { select.replaceChildren();if(first){const option=new Option(first,'');select.add(option);}for(const row of rows)select.add(new Option(row.name||row.title,String(row.id))); }
  function renderPlaylists(){options(field('playlist_id'),playlists.filter(p=>p.provider===draft.music_source),'Select a playlist');field('playlist_id').value=draft.playlist_id??'';}
  async function refresh(){const [p,l,t,access]=await Promise.all([api('/api/playback-presets'),api('/api/goon/playlists'),api('/api/music/tracks'),api('/api/music/access')]);canEdit=access.can_edit;for(const action of ['save','new','rename','delete','playlist-new','playlist-save','playlist-delete'])sheet.querySelector(`[data-action="${action}"]`).disabled=!canEdit;sheet.querySelector('[data-upload]').disabled=!canEdit;sheet.querySelector('[data-access-status]').textContent=canEdit?'Local Host: edits and uploads are shared with connected clients.':'Read-only Viewer: shared presets and playlists are available for playback; editing and upload require the local Host.';presets=p.presets;playlists=l.playlists;tracks=t.tracks;options(field('preset'),presets,'Current draft');options(sheet.querySelector('[data-tracks]'),tracks);render();}
  field('preset').addEventListener('change',()=>{draft=structuredClone(presets.find(p=>p.id===Number(field('preset').value))||defaults());render();});
  field('music_source').addEventListener('change',()=>{read();draft.playlist_id=null;renderPlaylists();});
  field('playlist_id').addEventListener('change',()=>{const p=playlists.find(p=>p.id===Number(field('playlist_id').value));if(p){sheet.querySelector('[data-playlist-name]').value=p.name;sheet.querySelector('[data-provider-url]').value=p.source_url||'';for(const o of sheet.querySelector('[data-tracks]').options)o.selected=p.tracks.includes(Number(o.value));}});
  sheet.querySelector('[data-upload]').addEventListener('change',async e=>{try{for(const file of e.target.files){const r=await fetch(`/api/music/tracks?name=${encodeURIComponent(file.name)}`,{method:'POST',body:file});const result=await r.json();if(!r.ok)throw new Error(result.error||'Upload failed');}await refresh();status('Audio uploaded to host. Select tracks to create a playlist.');}catch(e){status(e.message);}});
  const loadScript=(url,ready)=>new Promise((resolve,reject)=>{if(ready()){resolve();return;}const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(new Error('Provider player could not load. Retry or open externally.'));document.head.append(s);});
  class LocalAdapter {
    constructor(playlist,volume){this.ids=playlist.tracks;this.index=0;this.audio=document.createElement('audio');this.audio.controls=true;this.audio.volume=volume;this.capabilities={play:true,pause:true,seek:true,volume:true};this.audio.addEventListener('ended',()=>avtoPlaybackClock.end(this.audio,()=>{if(++this.index<this.ids.length){this.load();this.play().catch(e=>status(e.message));}}));this.audio.addEventListener('error',()=>status('Track unavailable or unsupported. Retry Apply music, or import a compatible file.'));}
    load(){if(!this.ids.length)throw new Error('This local playlist has no tracks.');this.audio.src=`/api/music/tracks/${this.ids[this.index]}/stream?browser=true`;}
    play(){return avtoPlaybackClock.play(this.audio);}pause(){this.audio.pause();}seek(t){this.audio.currentTime=t;}volume(v){this.audio.volume=v;}state(){return {paused:this.audio.paused,time:this.audio.currentTime};}dispose(){avtoPlaybackClock.forget(this.audio);this.pause();this.audio.removeAttribute('src');this.audio.load();}
  }
  class ExternalAdapter {constructor(url){this.url=url;this.capabilities={play:false,pause:false,seek:false,volume:false};}load(){}state(){return {mode:'external'};}dispose(){} }
  async function applyMusic(config) {
    const request=++musicGeneration;
    if(music)music.dispose();music=null;const container=sheet.querySelector('[data-music]');container.replaceChildren();sheet.querySelector('[data-mode]').textContent='';
    if(config.music_source==='none')return;
    const playlist=playlists.find(p=>p.id===config.playlist_id&&p.provider===config.music_source);if(!playlist)throw new Error('Selected music playlist is missing. Refresh and choose a playlist.');
    const external=()=>{const a=document.createElement('a');a.href=playlist.source_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open in provider app';container.append(a);};
    if(playlist.provider==='local'){music=new LocalAdapter(playlist,config.music_volume);music.load();container.append(music.audio);sheet.querySelector('[data-mode]').textContent='Local playback — use audio controls';await music.play();return;}
    external();
    if(playlist.provider==='spotify'){music=new ExternalAdapter(playlist.source_url);sheet.querySelector('[data-mode]').textContent='External — control music independently in Spotify';return;}
    if(playlist.provider==='apple_music'){
      let appleInstance, adapter;
      const current=()=>request===musicGeneration;
      try{
        const credentials=await api('/api/music/apple-configuration'); if(!current())return;
        await loadScript('https://js-cdn.music.apple.com/musickit/v3/musickit.js',()=>!!window.MusicKit); if(!current())return;
        await window.MusicKit.configure({developerToken:credentials.developer_token,app:{name:'AvtoHmver',build:'0.3.4'}}); if(!current())return;
        const instance=window.MusicKit.getInstance();appleInstance=instance;
        music={isEmbedded:true,dispose(){instance.stop();Promise.resolve(instance.unauthorize()).catch(()=>{});}};
        await instance.authorize(); if(!current())return;
        const url=new URL(playlist.source_url),parts=url.pathname.split('/').filter(Boolean);
        const type=parts.includes('playlist')?'playlist':parts.includes('song')?'song':'album',id=url.searchParams.get('i')||parts.at(-1);
        await instance.setQueue({[url.searchParams.has('i')?'song':type]:id}); if(!current())return;
        adapter=avtoMusicConnectors.createApple(instance,config.music_volume,message=>{if(current())status(message);});music=adapter;
        await avtoPlaybackClock.play(adapter); if(!current()){adapter.dispose();return;}
        for(const [label,fn]of [['Play',()=>avtoPlaybackClock.play(adapter)],['Pause',()=>{avtoPlaybackClock.forget(adapter);adapter.pause();}]]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>Promise.resolve(fn()).catch(error=>{if(current())status(error.message);});container.append(button);}
        sheet.querySelector('[data-mode]').textContent='Embedded - Apple Music; shared Pause controls this player';return;
      }catch(error){
        if(adapter)adapter.dispose();else if(appleInstance){appleInstance.stop();await Promise.resolve(appleInstance.unauthorize()).catch(()=>{});}
        if(current()){music=null;sheet.querySelector('[data-mode]').textContent='External - Apple Music authorization or playback unavailable';status(error.message);}return;
      }
    }
    const iframe=document.createElement('iframe');iframe.title=`${playlist.provider} official player`;iframe.allow='autoplay; encrypted-media; fullscreen';
    if(playlist.provider==='youtube'){const url=new URL(playlist.source_url);const video=url.hostname==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v');const list=url.searchParams.get('list');const origin=encodeURIComponent(location.origin);iframe.src=video?`https://www.youtube.com/embed/${encodeURIComponent(video)}?controls=1&enablejsapi=1&origin=${origin}${list?'&list='+encodeURIComponent(list):''}`:`https://www.youtube.com/embed/videoseries?enablejsapi=1&origin=${origin}&list=${encodeURIComponent(list||'')}`;}
    else iframe.src=`https://w.soundcloud.com/player/?url=${encodeURIComponent(playlist.source_url)}&auto_play=false`;
    container.prepend(iframe);
    const abort=new AbortController();
    music={isEmbedded:true,capabilities:{play:false,pause:false,seek:false,volume:false},dispose(){abort.abort();iframe.src='about:blank';iframe.remove();}};
    const report=message=>{if(request===musicGeneration&&!abort.signal.aborted&&iframe.isConnected)status(message);};
    iframe.onerror=()=>report('Embed blocked. Retry Apply music or open the provider externally.');
    try{
      const controller=await avtoMusicConnectors.create(playlist.provider,iframe,config.music_volume,report,abort.signal);
      if(request!==musicGeneration||abort.signal.aborted){controller.dispose();return;}
      music=controller;
      for(const [label,fn]of [['Play',()=>avtoPlaybackClock.play(controller)],['Pause',()=>{avtoPlaybackClock.forget(controller);controller.pause();}]]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>Promise.resolve(fn()).catch(error=>report(error.message));container.append(button);}
      sheet.querySelector('[data-mode]').textContent=`Embedded - ${playlist.provider}; shared Pause controls this player`;
    }catch(error){if(request===musicGeneration&&!abort.signal.aborted){music=null;sheet.querySelector('[data-mode]').textContent='External - embedded player unavailable';status(error.message);}}

  }
  function visual(){avtoPlaybackClock.cancel(timer);const target=sheet.querySelector('[data-visual]');for(const v of target.querySelectorAll('video')){avtoPlaybackClock.forget(v);v.pause();v._clipCleanup?.();v.removeAttribute('src');v.load();}target.replaceChildren();const item=media[index];if(!item)return;const isVideo=item.type==='video';const node=document.createElement(isVideo?'video':'img');node.className='playback-stage';node.style.objectFit=active.display_fit;node.src=`/api/media/${item.id}/stream`;if(isVideo){node.controls=true;if(typeof bindVirtualClip==='function')bindVirtualClip(node,item);node.onended=()=>avtoPlaybackClock.end(node,()=>advance(1));avtoPlaybackClock.play(node).catch(()=>status('Tap the video Play control to start.'));}else timer=avtoPlaybackClock.timeout(()=>advance(1),10000);target.append(node);sheet.querySelector('[data-caption]').textContent=active.captions?(item.filename||''):'';}
  function advance(delta){if(media.length){index=(index+delta+media.length)%media.length;visual();}}
  sheet.addEventListener('click',async event=>{const action=event.target.dataset.action;if(!action)return;try{
    if(action==='close'){sheet.close();return;}
    if(action==='refresh'){await refresh();status('Shared presets and playlists refreshed.');}
    if(['save','new','rename'].includes(action)){const p=read();if(action==='new'){p.id=null;p.revision=0;}draft=await api(p.id?`/api/playback-presets/${p.id}`:'/api/playback-presets',p.id?'PUT':'POST',p);await refresh();status('Preset saved. Active playback is unchanged.');}
    if(action==='reload'){const id=draft.id;await refresh();const saved=presets.find(p=>p.id===id);if(!saved)throw new Error('Saved preset was deleted. Save this draft as new.');draft=structuredClone(saved);render();status('Saved preset reloaded.');}
    if(action==='delete'){if(!draft.id)throw new Error('Choose a saved preset.');await api(`/api/playback-presets/${draft.id}?revision=${draft.revision}`,'DELETE');draft=defaults();await refresh();status('Preset deleted.');}
    if(action.startsWith('playlist-')){const id=Number(field('playlist_id').value);if(action==='playlist-delete'){if(!id)throw new Error('Select a playlist.');await api(`/api/goon/playlists/${id}`,'DELETE');}else{const p={name:sheet.querySelector('[data-playlist-name]').value,provider:field('music_source').value,source_url:field('music_source').value==='local'?null:sheet.querySelector('[data-provider-url]').value,tracks:field('music_source').value==='local'?Array.from(sheet.querySelector('[data-tracks]').selectedOptions,o=>Number(o.value)):[]};if(action==='playlist-save'&&!id)throw new Error('Select a playlist.');const saved=await api(action==='playlist-save'?`/api/goon/playlists/${id}`:'/api/goon/playlists',action==='playlist-save'?'PUT':'POST',p);draft.playlist_id=saved.id;}await refresh();status('Shared playlist updated.');}
    if(action==='start'){const p=read();const result=await api('/api/playback-presets/resolve?preset='+encodeURIComponent(JSON.stringify(p)));active=structuredClone(p);media=result.media;index=0;visual();await applyMusic(active);status('Playing current draft.');}
    if(action==='apply'){await applyMusic(read());status('Music applied independently of visuals.');}
    if(action==='next')advance(1);if(action==='previous')advance(-1);
    if(action==='pause')avtoPlaybackClock.setPaused(true);
    if(action==='resume')avtoPlaybackClock.setPaused(false);
    if(action==='stop'){musicGeneration++;avtoPlaybackClock.cancel(timer);for(const v of sheet.querySelectorAll('[data-visual] video')){avtoPlaybackClock.forget(v);v.pause();v._clipCleanup?.();v.removeAttribute('src');v.load();}music?.dispose();music=null;media=[];active=null;sheet.querySelector('[data-visual]').replaceChildren();sheet.querySelector('[data-music]').replaceChildren();status('Playback stopped.');}
  }catch(e){status(e.status===409?'Preset changed on another client. Reload saved preset or Save as new.':e.message);}});
  document.querySelector('#playback-setup-open')?.addEventListener('click',async()=>{sheet.showModal();try{if(!active){draft=defaults();if(typeof state!=='undefined'&&state.selectedMediaIds instanceof Set)draft.media_ids=[...state.selectedMediaIds];}await refresh();}catch(e){status(e.message);}});
})();
