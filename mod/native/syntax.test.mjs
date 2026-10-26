import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,to_luastring,to_jsstring} from 'fengari';
for(const file of ['main.lua','music.lua','companion.lua','rhythm.lua'])test('Lua parses: '+file,()=>{
 const state=lauxlib.luaL_newstate(),status=lauxlib.luaL_loadstring(state,to_luastring(readFileSync(new URL('../runtime/Scripts/'+file,import.meta.url),'utf8')));
 const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));lua.lua_close(state);assert.equal(status,0,message);
});
