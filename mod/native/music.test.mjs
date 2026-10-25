import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';
test('native audio transport lifecycle and playback clock contracts in Lua',()=>{
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 const module=readFileSync(new URL('../runtime/Scripts/music.lua',import.meta.url),'utf8');
 const suite=readFileSync(new URL('./music.test.lua',import.meta.url),'utf8').replace(/^local Music =.*\r?\n/,'local Music = require("music")\n');
 const code='package.preload["music"]=function()\n'+module+'\nend\n'+suite;
 const status=lauxlib.luaL_dostring(state,to_luastring(code));
 const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));lua.lua_close(state);assert.equal(status,0,message);
});
