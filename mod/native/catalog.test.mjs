import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';

test('native catalog copies every borrowed string before any further native invocation',()=>{
 const source=readFileSync(new URL('../runtime/Scripts/main.lua',import.meta.url),'utf8');
 const begin=source.indexOf('local function nativeState(store)'),end=source.indexOf('\nlocal lastDiagnosticRequest',begin);
 assert.ok(begin>=0&&end>begin);
 const script=`
 local function quote(value) return '"'..value..'"' end
 local function boolean(value) return value and 'true' or 'false' end
 local function stringValue(value) return type(value)=='string' and value or value:ToString() end
 ${source.slice(begin,end)}
 local generation=0
 local function borrowed(value)
  local owner=generation
  return {ToString=function() assert(owner==generation,'borrowed catalog storage was invalidated');return value end}
 end
 local store={}
 function store:GetAllPackInfos()
  return {{PackName=borrowed('fanservice-one'),Title=borrowed('First'),Description=borrowed('One'),UnlockCost=1,TotalMediaCount=2},
   {PackName=borrowed('fanservice-two'),Title=borrowed('Second'),Description=borrowed('Two'),UnlockCost=3,TotalMediaCount=4}}
 end
 function store:IsPackUnlocked(name) generation=generation+1;return name=='fanservice-one' end
 function store:IsPackEnabled(name) generation=generation+1;return name=='fanservice-one' end
 function store:GetUnlockPoints() return 4 end
 result=nativeState(store)
 `;
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 try{
  const status=lauxlib.luaL_dostring(state,to_luastring(script));assert.equal(status,lua.LUA_OK,status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1)));
  lua.lua_getglobal(state,to_luastring('result'));
  assert.deepEqual(JSON.parse(to_jsstring(lua.lua_tostring(state,-1))),{unlock_points:4,packs:[{id:'fanservice-one',name:'First',description:'One',unlock_cost:1,media_count:2,owned:true,enabled:true},{id:'fanservice-two',name:'Second',description:'Two',unlock_cost:3,media_count:4,owned:false,enabled:false}]});
 }finally{lua.lua_close(state);}
});
