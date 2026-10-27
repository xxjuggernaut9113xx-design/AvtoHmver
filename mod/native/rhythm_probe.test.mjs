import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';

test('owned native clock probe pause/rebase, foreign preservation and cleanup contracts',()=>{
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 const module=readFileSync(new URL('../runtime/Scripts/rhythm_probe.lua',import.meta.url),'utf8');
 const suite=readFileSync(new URL('./rhythm_probe.test.lua',import.meta.url),'utf8').replace(/^local Probe =.*\r?\n/,'local Probe = require("rhythm_probe")\n');
 const status=lauxlib.luaL_dostring(state,to_luastring('package.preload["rhythm_probe"]=function()\n'+module+'\nend\n'+suite));
 const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));lua.lua_close(state);assert.equal(status,0,message);
});
