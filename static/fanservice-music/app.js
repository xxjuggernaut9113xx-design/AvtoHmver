'use strict';
const $=id=>document.getElementById(id);let recording;
const message=text=>$('message').textContent=text;
async function request(path,options){const r=await fetch(path,options);const data=await r.json();if(!r.ok)throw Error(data.error||`Server ${r.status}`);return data;}
const track=()=>Number($('tracks').value);
function show(map){$('bpm').value=map.bpm;$('offset').value=map.offset;$('confirmed').checked=map.confirmed;$('document').value=JSON.stringify({beats:map.beats,events:map.events},null,2);}
async function inspect(){recording=await request(`/api/fanservice/v1/music/${track()}`);$('identity').textContent=`${recording.recording_id} · ${recording.duration.toFixed(3)} seconds`;$('audio').src=`/api/music/tracks/${track()}/stream?browser=true`;if(recording.beatmap)show(recording.beatmap);message(recording.matches?'Saved map matches this recording.':'No matching saved map; analyze or author one.');}
async function refresh(){const data=await request('/api/music/tracks');$('tracks').replaceChildren(...data.tracks.map(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.title;return o;}));}
function action(id,fn){$(id).onclick=async()=>{try{$(id).disabled=true;await fn();}catch(e){message(e.message);}finally{$(id).disabled=false;}};}
action('upload',async()=>{const f=$('file').files[0];if(!f)throw Error('Select an audio recording.');await request('/api/music/tracks?name='+encodeURIComponent(f.name),{method:'POST',body:f});await refresh();message('Recording imported.');});
action('inspect',inspect);$('tracks').onchange=()=>{recording=null;$('audio').pause();$('document').value='{"beats":[],"events":[]}';$('confirmed').checked=false;};
action('analyze',async()=>{await inspect();message('Analyzing an initial proposal…');show(await request(`/api/fanservice/v1/music/${track()}/analyze`,{method:'POST'}));message('Proposal ready. Listen, edit and confirm; analysis alone does not enable gameplay.');});
action('grid',async()=>{if(!recording)await inspect();const bpm=Number($('bpm').value),offset=Number($('offset').value);if(!Number.isFinite(bpm)||bpm<20||bpm>400)throw Error('BPM must be between 20 and 400.');const beats=[];for(let t=Math.max(0,-offset);t+offset<recording.duration;t+=60/bpm)beats.push({time:Number(t.toFixed(6)),type:'stroke'});$('document').value=JSON.stringify({beats,events:[]},null,2);$('confirmed').checked=false;message('Regular beat proposal generated; review before confirming.');});
action('save',async()=>{if(!recording)throw Error('Load the recording first.');const document=JSON.parse($('document').value);await request(`/api/fanservice/v1/music/${track()}/beatmap`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...recording,bpm:Number($('bpm').value),offset:Number($('offset').value),confirmed:$('confirmed').checked,beats:document.beats,events:document.events})});message('Beatmap saved.');});
refresh().catch(e=>message(e.message));
