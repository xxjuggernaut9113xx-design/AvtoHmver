const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/fanservice/voice.js'),'utf8');

function setup({rejectResume=false}={}){
 let openRequest,readRequest,readTransaction,resumeCalls=0,started=0,captionText='',reportText='';
 let rejectResumePromise;
 const file={arrayBuffer:async()=>new ArrayBuffer(8)};
 const pack={manifest:{version:1,lines:{fixture:{file:'tone.wav',caption:'Test caption'}}},audio:[['tone.wav',file]]};
 const indexedDB={open(){openRequest={};queueMicrotask(()=>{});return openRequest;}};
 class AudioContext{
  constructor(){this.destination={};}
  resume(){resumeCalls++;return new Promise((resolve,reject)=>{rejectResumePromise=reject;if(!rejectResume)resolve();});}
  async decodeAudioData(){return {decoded:true};}
  createBufferSource(){return {connect(node){return node;},start(){started++;},stop(){}};}
  createGain(){return {gain:{},connect(node){return node;}};}
 }
 const context={indexedDB,AudioContext,localStorage:{getItem:()=>null,setItem(){}},document:{getElementById:()=>null},console};
 vm.createContext(context);vm.runInContext(source,context);
 openRequest.result={createObjectStore(){},transaction(){
  readTransaction={};readRequest={};
  const store={get(){return readRequest;},put(){return readRequest;}};
  readTransaction.objectStore=()=>store;
  return readTransaction;
 }};
 async function finishRead(){await new Promise(resolve=>setImmediate(resolve));readRequest.result=pack;readRequest.onsuccess();readTransaction.oncomplete();}
 return {voice:context.FanserviceVoice,get resumeCalls(){return resumeCalls;},get started(){return started;},get captionText(){return captionText;},get reportText(){return reportText;},finishOpen(){openRequest.onsuccess();},finishRead,rejectResume(){rejectResumePromise(Error('gesture denied'));},say(){return context.FanserviceVoice.say('fixture',value=>captionText=value,value=>reportText=value);}};
}

test('say requests audio resume before IndexedDB readiness and starts audio once storage resolves',async()=>{
 const fixture=setup(),played=fixture.say();
 assert.equal(fixture.resumeCalls,1,'resume is invoked synchronously by say()');
 fixture.finishOpen();await fixture.finishRead();
 assert.equal(await played,true);assert.equal(fixture.captionText,'Test caption');assert.equal(fixture.started,1);
});

test('a rejected resume is handled while IndexedDB remains pending',async()=>{
 const fixture=setup({rejectResume:true}),played=fixture.say();
 fixture.rejectResume();
 await new Promise(resolve=>setImmediate(resolve));
 fixture.finishOpen();await fixture.finishRead();
 assert.equal(await played,false);assert.equal(fixture.started,0);assert.match(fixture.reportText,/could not play/);
});
