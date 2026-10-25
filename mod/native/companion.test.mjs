import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';
test('Lua companion IPC rejects stale work and activates only matching music commands',()=>{
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 const module=readFileSync(new URL('../runtime/Scripts/companion.lua',import.meta.url),'utf8');
 const suite=`
local files,clock={},100
os.time=function() return clock end
os.remove=function(path) files[path]=nil;return true end
os.rename=function(from,to) if files[to] then return nil,'already exists' end;files[to]=files[from];files[from]=nil;return true end
io.open=function(path,mode)
 if mode=='rb' then if not files[path] then return nil end;return {read=function(_,maximum) return files[path]:sub(1,maximum) end,close=function() return true end} end
 local bytes='';return {write=function(_,value) bytes=bytes..value;return true end,close=function() files[path]=bytes;return true end}
end
local Companion=require('companion')
assert(Companion.decode('%7B%22name%22%3A%22a%25b%22%7D')=='{"name":"a%b"}')
assert(not pcall(Companion.decode,'%zz'))
local replies,opened={},{}
local helper=Companion.new({directory='/runtime',quote=function(value) return '"'..value..'"' end,openMusic=function(url,map,nonce,duration) opened[#opened+1]={url,map,nonce,duration} end})
local profile='{"build_id":"v004-exclusive-c645757d","slot":"PlayerSave","user_index":0,"save_address":"1","store_address":"2"}'
helper:update(profile,'{"unlock_points":4,"packs":[]}',1,'123-1')
assert(not pcall(function() helper:request('companionread','%7B%7D',function() end) end),'Missing helper must fail before publishing')
files['/runtime/.fanservice-companion.host.lock']=string.rep('a',32)
files['/runtime/.fanservice-companion.ready']=string.rep('a',32)
assert(not pcall(function() helper:request('purchase','%7B%7D',function() end) end))
helper:request('companionread','%7B%7D',function(reply) replies[#replies+1]=reply end)
local packet=files['/runtime/.fanservice-companion.request'];local nonce=packet:match('^FANSERVICE_COMPANION_1\\n([^\\n]+)')
assert(nonce);assert(not pcall(function() helper:request('companionread','%7B%7D',function() end) end))
files['/runtime/.fanservice-companion.response.'..nonce]='FANSERVICE_COMPANION_1\\n'..nonce..'\\n1\\n{"ok":true,"data":{"revision":0}}'
helper:update(profile,'{}',1,'123-1');assert(#replies==1);assert(not files['/runtime/.fanservice-companion.request'])
helper:request('musicprepare','%7B%22track_id%22%3A1%7D',function(reply) replies[#replies+1]=reply end)
nonce=files['/runtime/.fanservice-companion.request']:match('^FANSERVICE_COMPANION_1\\n([^\\n]+)')
files['/runtime/.fanservice-companion.response.'..nonce]='FANSERVICE_COMPANION_1\\n'..nonce..'\\n1\\n{"ok":true,"data":{}}'
files['/runtime/.fanservice-music-command.'..nonce]='FANSERVICE_MUSIC_2\\n'..nonce..'\\n1\\n123-1\\nhttp%3A%2F%2F127.0.0.1%3A42169%2Fapi%2Fmusic%2Ftracks%2F1%2Fstream%3Fnative%3Dtrue\\n12\\n{"beats":[]}'
helper:update(profile,'{}',1,'123-1');assert(#opened==1);assert(opened[1][4]==12);assert(opened[1][1]=='http://127.0.0.1:42169/api/music/tracks/1/stream?native=true')
helper:request('companionread','%7B%7D',function(reply) replies[#replies+1]=reply end)
helper:update(profile,'{}',2,'123-2');assert(#replies==3);assert(replies[3]:find('Stale work',1,true));assert(not files['/runtime/.fanservice-companion.request'])
helper:request('companionread','%7B%7D',function(reply) replies[#replies+1]=reply end)
clock=701;helper:update(profile,'{}',2,'123-2');assert(#replies==4);assert(replies[4]:find('timed out',1,true))
for _,mode in ipairs({'missing','stale','duration','server-error'}) do
 helper:request('musicprepare','%7B%22track_id%22%3A1%7D',function(reply) replies[#replies+1]=reply end)
 nonce=files['/runtime/.fanservice-companion.request']:match('^FANSERVICE_COMPANION_1\\n([^\\n]+)')
 files['/runtime/.fanservice-companion.response.'..nonce]='FANSERVICE_COMPANION_1\\n'..nonce..'\\n2\\n'..(mode=='server-error' and '{"ok":false,"error":"native authorization failed"}' or '{"ok":true,"data":{}}')
 if mode~='missing' and mode~='server-error' then files['/runtime/.fanservice-music-command.'..nonce]='FANSERVICE_MUSIC_2\\n'..nonce..'\\n2\\n'..(mode=='stale' and '999-9' or '123-2')..'\\nhttp%3A%2F%2F127.0.0.1%3A42169%2Faudio\\n'..(mode=='duration' and '0' or '12')..'\\n{}' end
 local count=#replies;helper:update(profile,'{}',2,'123-2');assert(#replies==count+1);assert(replies[#replies]:find('"ok":false',1,true));assert(#opened==1)
 if mode=='server-error' then assert(replies[#replies]:find('native authorization failed',1,true)) end
 if mode=='stale' or mode=='duration' then assert(files['/runtime/.fanservice-music-command.'..nonce]) end
end

`;
 const status=lauxlib.luaL_dostring(state,to_luastring('package.preload["companion"]=function()\n'+module+'\nend\n'+suite));const error=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));lua.lua_close(state);assert.equal(status,0,error);
});
