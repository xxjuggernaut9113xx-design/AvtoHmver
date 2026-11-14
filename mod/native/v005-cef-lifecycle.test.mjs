import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';

test('native browser readiness fails closed when its helper is missing, incompatible or not running',()=>{
 const source=readFileSync(new URL('../runtime-v005/Scripts/main.lua',import.meta.url),'utf8');
 const gate=source.slice(source.indexOf('local checkedCefReady'),source.indexOf('local generation'));
 const cases=[
  {mode:'missing'}, {mode:'load-error'}, {mode:'unregistered'}, {mode:'read-error'},
  {ready:true,state:'starting'}, {ready:false,state:'running'},
  {ready:'true',state:'running'}, {ready:true,state:'running',expected:true},
 ];
 for(const fixture of cases){
  const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
  const setup=`local directory='/fixture'\nlocal function log() end\npackage.loadlib=function()\n`+
   (fixture.mode==='missing'?`return nil,'missing'`:
    `return function()\n`+(fixture.mode==='load-error'?`error('wrong exact build')`:
     fixture.mode==='unregistered'?`return 'not registered'`:
     `FanserviceCefReady=function() `+(fixture.mode==='read-error'?`error('read failed')`:
      `return ${JSON.stringify(fixture.ready)},${JSON.stringify(fixture.state)}`)+` end`)+`\nend`)+`\nend\n`;
  const status=lauxlib.luaL_dostring(state,to_luastring(setup+gate+`\nassert(cefReady()==${Boolean(fixture.expected)})`));
  const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));
  lua.lua_close(state);assert.equal(status,0,JSON.stringify(fixture)+': '+message);
 }
});

test('the first native document can retry navigation in place before reparenting',()=>{
 const source=readFileSync(new URL('../runtime-v005/Scripts/main.lua',import.meta.url),'utf8');
 const placement=source.slice(source.indexOf('local function entryDocumentURL('),source.indexOf('local profileChanged'));
 const attach=source.slice(source.indexOf('local function attach('),source.indexOf('local function openPanel('));
 const polling=source.slice(source.indexOf('local function pollEntry('),source.indexOf('local function pollPanel('));
 const suite=`
local function valid(o) return o and o.alive end
local function text(v) return v end
local function log() end
local owner,entry,menuList,entryToken,lastClick,entryHTML,entryURL,entryReady,entryDeadline,entryLastLoad
local initialCanvasPending,initialNavigationRetried
local now=0
os.time=function() return now end
local epoch='123-456'
local browser=nil
local nativeDocumentReady=false
local title='about:blank'
local removals,loads,listAdds=0,0,0
local label=''
local slot={alive=true}
function slot:SetSize() end
function slot:SetPadding() end
function slot:SetHorizontalAlignment() end
function slot:SetVerticalAlignment() end
local list={alive=true}
function list:GetClass() return {GetFullName=function() return 'Class /Script/UMG.VerticalBox' end} end
function list:AddChildToVerticalBox() listAdds=listAdds+1;return slot end
local menu={alive=true,StartGameButton={GetParent=function() return list end}}
function menu:GetAddress() return 789 end
local function widget(_,_,_,url)
 local result={alive=true,urlInitial=url}
 function result:RemoveFromParent()
  assert(nativeDocumentReady,'native document was destroyed before initialization')
  removals=removals+1
 end
 function result:LoadURL()
  assert(nativeDocumentReady or (now>=3 and removals==0),'native document was reloaded before its retry window')
  loads=loads+1
 end
 function result:GetTitle() return title end
 function result:ExecuteJavascript(script) label=script end
 return result
end
`+placement+attach+polling+`
attach(menu)
assert(removals==0 and loads==0 and listAdds==0)
pollEntry()
assert(removals==0 and loads==0 and listAdds==0)
now=3
pollEntry()
assert(removals==0 and loads==1 and listAdds==0)
now=7
pollEntry()
assert(removals==0 and loads==1 and listAdds==0)
nativeDocumentReady=true
title='FANSERVICE_ENTRY_READY:'..entryToken
pollEntry()
assert(removals==1 and loads==2 and listAdds==1 and not entryReady)
pollEntry()
assert(not entryReady)
title='FANSERVICE_ENTRY_READY:'..entryToken
pollEntry()
assert(entryReady and label:find('Fanservice'))
`;
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 const status=lauxlib.luaL_dostring(state,to_luastring(suite));
 const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));
 lua.lua_close(state);assert.equal(status,0,message);
});
