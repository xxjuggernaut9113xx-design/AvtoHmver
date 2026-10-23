const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const adbPath=process.env.FANSERVICE_ADB||'E:/fanservice-tools/android-sdk/platform-tools/adb.exe',serial=process.env.FANSERVICE_ANDROID_SERIAL||'emulator-5556',root=process.env.FANSERVICE_ANDROID_OUTPUT;
if(!root)throw Error('Set FANSERVICE_ANDROID_OUTPUT to a new evidence directory. Run only against the isolated fanservice-test emulator containing synthetic media.');
fs.mkdirSync(root,{recursive:true});
const report={started:new Date().toISOString(),passed:false},pending=new Map();let ws,nextId=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function adb(...args){return execFileSync(adbPath,['-s',serial,...args],{encoding:'utf8',timeout:20000}).trim();}
async function connect(){const sockets=adb('shell','cat','/proc/net/unix'),name=sockets.match(/@(webview_devtools_remote_\d+)/)?.[1];assert(name,'WebView socket missing');adb('forward','tcp:9223','localabstract:'+name);const targets=await(await fetch('http://127.0.0.1:9223/json/list',{signal:AbortSignal.timeout(10000)})).json();const target=targets.find(t=>t.type==='page');assert(target);ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('WebView connection failed'));});ws.onmessage=e=>{const message=JSON.parse(e.data),call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error.message)):call.resolve(message.result);}};ws.onclose=()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('WebView disconnected'));}pending.clear();};}
async function evaluate(expression){const result=await new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Evaluation timed out: '+expression.slice(0,80)));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true,userGesture:true}}));});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;}
async function wait(expression,timeout=20000){const deadline=Date.now()+timeout;let error;while(Date.now()<deadline){try{const value=await evaluate(expression);if(value)return value;}catch(e){error=e;}await pause(200);}throw Error('Timed out waiting for '+expression.slice(0,100)+(error?' | '+error.message:''));}
async function click(text,scope='document'){assert(await evaluate(`(()=>{const b=Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true;})()`),'Button unavailable: '+text);}
function documentPicker(){adb('shell','uiautomator','dump','/data/local/tmp/fanservice-acceptance.xml');return adb('shell','cat','/data/local/tmp/fanservice-acceptance.xml');}
async function waitPicker(){for(let i=0;i<10;i++){const xml=documentPicker();if(xml.includes('text="SAVE"'))return xml;await pause(500);}throw Error('Native Save picker did not open');}
function savePicker(xml){const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(n=>n.includes('text="SAVE"'));assert(node);const match=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert(match);adb('shell','input','tap',String(Math.floor((+match[1]+ +match[3])/2)),String(Math.floor((+match[2]+ +match[4])/2)));}
async function closeExport(){await evaluate('exportCancel.click();true');await wait('!exportDialog.open');}
(async()=>{
 let originalMode;
 try{
  for(let attempt=0;;attempt++){try{await connect();break;}catch(error){if(attempt>=30)throw error;await pause(500);}}await wait('["/","/index.html"].includes(location.pathname)&&typeof FanserviceStore!=="undefined"&&document.querySelectorAll("[data-local-tile]").length');
  report.version=adb('shell','dumpsys','package','org.fanservice.viewer').match(/versionName=(\S+)/)?.[1];assert.equal(report.version,process.env.FANSERVICE_ANDROID_VERSION||'0.3.8');
  report.packName='Native economy '+Date.now();report.filename=report.packName.replaceAll(' ','_')+'.chpack';
  await evaluate('(()=>{const c=document.querySelector("[data-local-tile] input[type=checkbox]");c.checked=true;c.dispatchEvent(new Event("change"));document.querySelector("#create").click();return true;})()');
  await wait('document.querySelector("#pack-dialog").open');
  await evaluate(`document.querySelector('#pack-name').value=${JSON.stringify(report.packName)};document.querySelector('#access').value='immediate';document.querySelector('#save-pack').click();true`);
  const row=`Array.from(document.querySelectorAll('#packs .pack')).find(row=>row.innerText.includes(${JSON.stringify(report.packName)}))`;
  await wait(row);await click('Enable',row);await wait(`(${row}).innerText.includes('Enabled')`);
  await evaluate('document.querySelector("#play-session").click();true');await wait('location.pathname.endsWith("/play.html")&&typeof run!=="undefined"&&!!run&&!document.querySelector("#start").disabled');
  await evaluate('document.querySelector("#difficulty").value="2";document.querySelector("#loot-enabled").checked=true;true');
  await click('Inventory / loadout');await click('Equip DecreaseHeat');await click('Close inventory');await click('Start');
  await wait('state.lootRolls>=1',25000);await click('Pause');
  report.live=await evaluate('({id:sessionId,state:run.export(),lastBeat,speed})');assert(report.live.state.state.strokes>=20);assert(report.live.state.state.heat>10);
  await evaluate('location.reload();true');await wait('typeof run!=="undefined"&&run?.resumed&&!document.querySelector("#start").disabled');
  const restored=await evaluate('({id:sessionId,state:run.export(),lastBeat,speed})');assert.deepEqual(restored,report.live);assert.equal(await evaluate('document.querySelector("#difficulty").value'),'2');
  await click('Start');await click('Pause');assert.equal(await evaluate('state.totalDraws'),report.live.state.state.totalDraws);await click('End session');await wait('finished');
  report.settlement=await evaluate('({sessions:profile.progression.sessions,ledger:profile.progression.last_settlement,pack:profile.packs.find(p=>p.enabled).id})');
  console.log('Actual Android local pack creation, enablement, timer loot, reload and settlement passed.');
  await evaluate('location.href="index.html";true');await wait('location.pathname.endsWith("/index.html")&&typeof showUnlocks==="function"');await evaluate('showUnlocks();true');await wait(row);
  await evaluate('window.acceptanceRequests=[];window.acceptanceFetch=window.fetch;window.fetch=(input,options)=>{acceptanceRequests.push({url:String(input),method:options?.method||"GET"});return acceptanceFetch(input,options);};true');
  await click('Export .chpack',row);await waitPicker();adb('shell','input','keyevent','4');await wait('exportTask===null&&exportProgress.textContent==="Export cancelled."');report.cancel=await evaluate('exportProgress.textContent');await closeExport();
  originalMode=adb('shell','run-as','org.fanservice.viewer','stat','-c','%a','cache');adb('shell','run-as','org.fanservice.viewer','chmod','500','cache');
  try{await click('Export .chpack',row);await wait('exportTask===null&&exportProgress.textContent.includes("Cannot stage archive")');report.stagingFailure=await evaluate('exportProgress.textContent');}
  finally{adb('shell','run-as','org.fanservice.viewer','chmod',originalMode,'cache');originalMode=null;}
  await closeExport();await click('Export .chpack',row);const picker=await waitPicker();assert(picker.includes(report.filename));savePicker(picker);
  await wait('exportTask===null&&exportProgress.textContent.includes("Archive saved and verified")');report.saved=await evaluate('exportProgress.textContent');
  report.requests=await evaluate('acceptanceRequests');assert(!report.requests.some(r=>['POST','PUT','PATCH','DELETE'].includes(r.method)),'Local media must not upload');
  report.stagingFiles=adb('shell','run-as','org.fanservice.viewer','find','cache','-maxdepth','1','-name','fanservice-export-*.part');assert.equal(report.stagingFiles,'');
  adb('pull','/sdcard/Download/'+report.filename,path.join(root,report.filename));
  await closeExport();await click('Export .chpack',row);await waitPicker();
  report.interruption={stagedBefore:adb('shell','run-as','org.fanservice.viewer','find','cache','-maxdepth','1','-name','fanservice-export-*.part')};assert(report.interruption.stagedBefore);
  ws.close();await pause(200);adb('shell','am','force-stop','org.fanservice.viewer');adb('shell','am','start','-n','org.fanservice.viewer/.MainActivity');
  let connected=false;for(let i=0;i<30;i++){try{await connect();connected=true;break;}catch{await pause(500);}}assert(connected,'WebView did not reopen after interruption');
  await wait('typeof libraryId==="string"&&typeof profile!=="undefined"&&!!profile.progression');
  report.interruption.stagedAfter=adb('shell','run-as','org.fanservice.viewer','find','cache','-maxdepth','1','-name','fanservice-export-*.part');assert.equal(report.interruption.stagedAfter,'');
  report.interruption.sessions=await evaluate('profile.progression.sessions');assert.equal(report.interruption.sessions,report.settlement.sessions);await evaluate('showUnlocks();true');await wait(row);
  report.passed=true;console.log('Real picker cancellation, real staging permission failure, retry save and no-upload checks passed.');
 }catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
 finally{if(originalMode)try{adb('shell','run-as','org.fanservice.viewer','chmod',originalMode,'cache');}catch(e){report.cleanupError=e.message;}report.finished=new Date().toISOString();fs.writeFileSync(path.join(root,'android-acceptance.json'),JSON.stringify(report,null,2)+'\n');ws?.close();}
})();
