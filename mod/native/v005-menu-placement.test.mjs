import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lua,lauxlib,lualib,to_luastring,to_jsstring} from 'fengari';

test('main-menu entry survives native reparenting and resets the browser document click sequence',()=>{
 const source=readFileSync(new URL('../runtime-v005/Scripts/main.lua',import.meta.url),'utf8');
 const placement=source.slice(source.indexOf('local function placeEntry('),source.indexOf('local profileChanged'));
 const polling=source.slice(source.indexOf('local function pollEntry('),source.indexOf('local function pollPanel('));
 const suite=`
local function valid(o) return o and o.alive end
local function text(v) return v end
local function log() end
local entryReady,entryDeadline,entryLastLoad,lastClick=true,0,0,14
local entryToken='123-456'
local browser=nil
local title='FANSERVICE_ENTRY_READY:'..entryToken
local listAdds,canvasAdds,loads,opens,closes=0,0,0,0,0
local label=''
local slot={alive=true}
function slot:SetSize(v) assert(v.SizeRule==1 and v.Value==1) end
function slot:SetPadding(v) assert(v.Top==0 and v.Bottom==0) end
function slot:SetHorizontalAlignment(v) assert(v==0) end
function slot:SetVerticalAlignment(v) assert(v==0) end
function slot:SetAnchors(v) assert(v.Minimum.X==1 and v.Maximum.X==1) end
function slot:SetOffsets(v) assert(v.Top==35 and v.Bottom==66) end
function slot:SetZOrder(v) assert(v==220) end
local menuList={alive=true}
function menuList:AddChildToVerticalBox(w) listAdds=listAdds+1;return slot end
local root={}
function root:AddChildToCanvas(w) canvasAdds=canvasAdds+1;return slot end
local owner={alive=true,WidgetTree={RootWidget=root}}
local entry={alive=true,urlInitial='data:initial'}
function entry:RemoveFromParent() end
function entry:ExecuteJavascript(v) label=v end
function entry:LoadURL(url,post,response) assert(url==self.urlInitial and post=='' and response==false);loads=loads+1;title='FANSERVICE_ENTRY_READY:'..entryToken end
function entry:GetTitle() return title end
local openPanel,closePanel
`+placement+`
openPanel=function() opens=opens+1;browser={};placeEntry(true) end
closePanel=function() closes=closes+1;browser=nil;placeEntry(false) end
`+polling+`
placeEntry(false)
assert(listAdds==1 and canvasAdds==0 and lastClick==0 and not entryReady)
pollEntry();assert(entryReady and label:find('Fanservice'))
title='FANSERVICE_ENTRY:'..entryToken..':1';pollEntry()
assert(opens==1 and canvasAdds==1 and not entryReady and lastClick==0)
pollEntry();assert(label:find('Back'))
title='FANSERVICE_ENTRY:'..entryToken..':1';pollEntry()
assert(closes==1 and listAdds==2 and not entryReady)
pollEntry();assert(label:find('Fanservice'))
title='FANSERVICE_ENTRY:'..entryToken..':1';pollEntry()
assert(opens==2 and loads==4)
menuList.alive=false
assert(not pcall(placeEntry,false))
`;
 const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
 const status=lauxlib.luaL_dostring(state,to_luastring(suite));
 const message=status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1));
 lua.lua_close(state);assert.equal(status,0,message);
});
