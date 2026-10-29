import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';

test('v005 independent entry gate fails closed before original age dismissal and on stale native state',()=>{
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 const module=readFileSync(new URL('../runtime-v005/Scripts/menu_guard.lua',import.meta.url),'utf8');
 const suite=readFileSync(new URL('./v005-menu-guard.test.lua',import.meta.url),'utf8').replace(/^local Guard =.*\r?\n/,'local Guard = require("menu_guard")\n');
 const status=lauxlib.luaL_dostring(state,to_luastring('package.preload["menu_guard"]=function()\n'+module+'\nend\n'+suite));
 const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));lua.lua_close(state);assert.equal(status,0,message);
});
