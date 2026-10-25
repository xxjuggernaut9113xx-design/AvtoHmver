const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const adbPath=process.env.FANSERVICE_ADB||'E:/fanservice-tools/android-sdk/platform-tools/adb.exe',serial=process.env.FANSERVICE_ANDROID_SERIAL||'emulator-5556',output=process.env.FANSERVICE_ANDROID_OUTPUT;
if(!output)throw Error('Set FANSERVICE_ANDROID_OUTPUT. This check imports only a synthetic clip into the isolated fanservice-test AVD.');
const clip=fs.readFileSync(process.env.FANSERVICE_TEST_VIDEO||'E:/fanservice-mod-lab/v004-native/synthetic-http/synthetic.mp4'),expected=crypto.createHash('sha256').update(clip).digest('hex');
const report={started:new Date().toISOString(),passed:false,expected_sha256:expected},pending=new Map();let ws,next=0,ids=[],forwarded=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function adb(...args){return execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:20000}).trim();}
async function connect(){
 const sockets=adb('shell','cat','/proc/net/unix'),name=sockets.match(/@(webview_devtools_remote_\d+)/)?.[1];assert(name,'Application WebView is not ready');if(!forwarded&&adb('forward','--list').split('\n').some(line=>line.split(/\s+/)[1]==='tcp:9234'))throw Error('Port 9234 already has an unrelated ADB forward');adb('forward','tcp:9234','localabstract:'+name);forwarded=true;
 const targets=await(await fetch('http://127.0.0.1:9234/json/list',{signal:AbortSignal.timeout(10000)})).json(),target=targets.find(t=>t.type==='page'&&new URL(t.url).hostname==='localhost');assert(target,'Expected only the local Capacitor application');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('WebView connection failed'));});
 ws.onmessage=e=>{const reply=JSON.parse(e.data),call=pending.get(reply.id);if(call){clearTimeout(call.timer);pending.delete(reply.id);reply.error?call.reject(Error(reply.error.message)):call.resolve(reply.result);}};
 ws.onclose=()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('WebView disconnected'));}pending.clear();};
}
async function evaluate(expression){
 const result=await new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Android evaluation timed out'));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}}));});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;
}
async function ready(){const deadline=Date.now()+120000;for(;;){try{await connect();await evaluate('profileReady');return;}catch(error){ws?.close();if(Date.now()>=deadline)throw error;await delay(500);}}}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 try{
  assert.equal(adb('emu','avd','name').split(/\r?\n/)[0].trim(),'fanservice-test','Refuse any other device');
  report.version=adb('shell','dumpsys','package','org.fanservice.viewer').match(/versionName=(\S+)/)?.[1];assert.equal(report.version,process.env.FANSERVICE_EXPECTED_ANDROID_VERSION||'0.3.10');
  adb('shell','am','start','-n','org.fanservice.viewer/.MainActivity');await ready();
  report.sync_module=await evaluate('typeof FanserviceProfileSync.Transport');assert.equal(report.sync_module,'function');
  report.existing_ids=await evaluate('(async()=> (await FanserviceStore.localFiles()).map(file=>file.id))()');
  ids=await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(clip.toString('base64'))}),c=>c.charCodeAt(0));return (await FanserviceStore.importFiles([new File([bytes],'synthetic-storage-acceptance.mp4',{type:'video/mp4'})])).map(record=>record.id);})()`);assert.equal(ids.length,1);
  ws.close();adb('shell','am','force-stop','org.fanservice.viewer');adb('shell','am','start','-n','org.fanservice.viewer/.MainActivity');await ready();
  report.retained=await evaluate(`(async()=>{const entry=await FanserviceStore.get('files',${JSON.stringify(ids[0])});if(!entry?.blob)throw Error('Synthetic copy was lost on restart');const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await entry.blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');const video=document.createElement('video');video.muted=true;video.playsInline=true;video.src=URL.createObjectURL(entry.blob);document.body.append(video);try{await video.play();const from=video.currentTime;await new Promise(resolve=>setTimeout(resolve,700));return {hash,bytes:entry.blob.size,width:video.videoWidth,height:video.videoHeight,advanced:video.currentTime>from+.1};}finally{video.pause();URL.revokeObjectURL(video.src);video.remove();}})()`);
  assert.equal(report.retained.hash,expected);assert.equal(report.retained.bytes,clip.length);assert.equal(report.retained.advanced,true);
  await evaluate(`(async()=>{for(const id of ${JSON.stringify(ids)})await FanserviceStore.remove('files',id);return true;})()`);ids=[];
  report.remaining_ids=await evaluate('(async()=> (await FanserviceStore.localFiles()).map(file=>file.id))()');assert.deepEqual(report.remaining_ids.sort(),report.existing_ids.sort());
  report.passed=true;console.log('Android '+report.version+' passed: sync module, copied video checksum, cold app restart, decoded playback clock, and preservation of existing files.');
 }catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
 finally{if(ids.length&&ws?.readyState===WebSocket.OPEN)try{await evaluate(`(async()=>{for(const id of ${JSON.stringify(ids)})await FanserviceStore.remove('files',id);return true;})()`);}catch(error){report.cleanup_error=error.message;}ws?.close();if(forwarded)try{adb('forward','--remove','tcp:9234');}catch{}report.finished=new Date().toISOString();fs.writeFileSync(path.join(output,'android-storage-acceptance.json'),JSON.stringify(report,null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
