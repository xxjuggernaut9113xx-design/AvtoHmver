const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=> 'test-device'},indexedDB:{open:()=>({})}};
vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../static/fanservice/store.js'),'utf8'),context);
const validate=context.FanserviceStore.validateMusic;
const fixture=()=>({protocol:1,library_id:'library-one',track_id:1,recording_id:'sha1:'+'a'.repeat(40),duration:10,offset:.25,stream_url:'/api/music/tracks/1/stream?browser=true',native_stream_url:'/api/music/tracks/1/stream?native=true',beatmap:{meta:{duration:10,bpm:120,offset:0},beats:[{time:.25,type:'stroke'},{time:1,type:'accent'},{time:2,type:'rest'}],events:[{time:0,type:'text',value:'Neutral fixture'},{time:1,type:'grant_break'}]}});

test('confirmed soundtrack preserves shifted stroke, rest and accent data without applying offset twice',()=>{
 const music=fixture();assert.equal(validate(music,{libraryId:'library-one',trackId:1}),music);assert.equal(music.beatmap.beats[0].time,.25);
});

test('recording, library, selected track and stream mismatches fail before playback',()=>{
 for(const change of [m=>m.library_id='other',m=>m.track_id=2,m=>m.recording_id='sha1:unknown',m=>m.stream_url='https://other.invalid/music',m=>m.native_stream_url='/api/music/tracks/2/stream?native=true',m=>m.duration=NaN,m=>m.offset=Infinity]){
  const music=fixture();change(music);assert.throws(()=>validate(music,{libraryId:'library-one',trackId:1}),/identity or stream/);
 }
});

test('recording-bound map rejects duration mismatch, invalid BPM, empty beats and unapplied offsets',()=>{
 for(const change of [m=>m.beatmap.meta.duration=12,m=>m.beatmap.meta.bpm=0,m=>m.beatmap.meta.bpm=401,m=>m.beatmap.meta.offset=.25,m=>m.beatmap.beats=[],m=>m.beatmap.events={}]){
  const music=fixture();change(music);assert.throws(()=>validate(music),/metadata/);
 }
});

test('sorted recording bounds are enforced for every beat and control',()=>{
 for(const change of [m=>m.beatmap.beats[1].time=-1,m=>m.beatmap.beats[1].time=.1,m=>m.beatmap.beats[1].time=11,m=>m.beatmap.beats[1].type='unknown',m=>m.beatmap.events[1].time=-1,m=>m.beatmap.events[1].time=Infinity,m=>m.beatmap.events[1].type='unknown']){
  const music=fixture();change(music);assert.throws(()=>validate(music),/beats|controls/);
 }
});

test('control values allow bounded primitives and reject null, structured and nonfinite values',()=>{
 for(const value of ['start',false,1,'🎵'.repeat(1000)]){const music=fixture();music.beatmap.events[0].value=value;assert.equal(validate(music),music);}
 for(const value of [null,{},[],NaN,Infinity,'🎵'.repeat(1001)]){const music=fixture();music.beatmap.events[0].value=value;assert.throws(()=>validate(music),/controls/);}
});


test('undefined speed controls remain editable and storable but cannot silently start playback',()=>{
 const music=fixture();music.beatmap.events=[{time:1,type:'speed_change',value:1.5}];
 assert.equal(validate(music),music);assert.throws(()=>validate(music,{playable:true}),/unsupported speed_change semantics/);
 assert.equal(music.beatmap.events[0].value,1.5);
});
