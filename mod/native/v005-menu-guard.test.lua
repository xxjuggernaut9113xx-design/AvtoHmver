local Guard = assert(loadfile('mod/runtime-v005/Scripts/menu_guard.lua'))()
local passed = 0
local function test(name, operation) operation();passed = passed + 1;print('PASS ' .. name) end
local function object(address)
    local value = {address=address, valid=true}
    function value:IsValid() return self.valid end
    function value:GetAddress() return self.address end
    return value
end
local function fixture()
    local menu, class, warning, start, tree, root = object(1), object(2), object(3), object(4), object(5), object(6)
    class.GetFullName = function() return 'WidgetBlueprintGeneratedClass /Game/NewSetup/MainMenu.MainMenu_C' end
    menu.GetClass = function() return class end
    menu.viewport, menu.visible, start.visible, warning.visible, warning.visibility = true, true, true, false, 1
    menu.IsInViewport = function(self) return self.viewport end
    for _, value in ipairs({menu, warning, start}) do value.IsVisible = function(self) return self.visible end end
    warning.GetVisibility = function(self) return self.visibility end
    warning.GetParent = function(self) return self.parent end
    menu.AdultContentWarningSplashButton, menu.StartGameButton, menu.WidgetTree, tree.RootWidget = warning, start, tree, root
    return menu, warning, start, tree, root, class
end
local function deny(menu, fragment)
    local allowed, reason = Guard.evaluate(menu)
    assert(allowed == false and type(reason) == 'string' and #reason > 0)
    if fragment then assert(reason:find(fragment, 1, true), reason) end
end

test('confirmed collapsed and detached original warning permits independent entry',function()
    local menu = fixture();local allowed, reason = Guard.evaluate(menu)
    assert(allowed == true and reason:find('confirmed',1,true))
end)
test('confirmed hidden and detached original warning also permits entry',function()
    local menu, warning = fixture();warning.visibility = 2;assert(Guard.evaluate(menu) == true)
end)
test('visible original age screen denies entry without submitting it',function()
    local menu, warning = fixture();warning.visible, warning.visibility = true, 0;deny(menu, 'age screen')
end)
test('hidden but still parented original warning denies entry',function()
    local menu, warning = fixture();warning.parent = object(7);deny(menu, 'age screen')
end)
test('zero-address invalid native parent wrapper establishes detached state',function()
    local menu, warning = fixture();warning.parent = object(0);warning.parent.valid = false;assert(Guard.evaluate(menu) == true)
end)
test('invalid nonzero parent wrapper is stale rather than proof of detachment',function()
    local menu, warning = fixture();warning.parent = object(7);warning.parent.valid = false;deny(menu, 'age screen')
end)
test('missing or invalid original age guard fails closed',function()
    local menu, warning = fixture();menu.AdultContentWarningSplashButton = nil;deny(menu)
    menu.AdultContentWarningSplashButton = warning;warning.valid = false;deny(menu)
end)
test('unknown visibility cannot establish original age dismissal',function()
    for _, value in ipairs({0,3,4,5,'Collapsed'}) do local menu, warning = fixture();warning.visibility = value;deny(menu, 'age screen') end
end)
test('opacity-like invisible state alone cannot replace collapsed or hidden state',function()
    local menu, warning = fixture();warning.visible = false;warning.visibility = 0;deny(menu, 'age screen')
end)
test('closed, invisible or invalid menu fails closed',function()
    for _, mutate in ipairs({function(m) m.viewport=false end,function(m) m.visible=false end,function(m) m.valid=false end}) do local menu=fixture();mutate(menu);deny(menu) end
    deny(nil)
end)
test('a similarly named or unrelated native class fails closed',function()
    for _, name in ipairs({'MainMenu_C','WidgetBlueprintGeneratedClass /Game/UI/FakeMainMenu.FakeMainMenu_C','Class /Script/Engine.Actor'}) do
        local menu, _, _, _, _, class = fixture();class.GetFullName=function() return name end;deny(menu, 'MainMenu_C')
    end
end)
test('original start control must remain valid and visible',function()
    local menu, _, start = fixture();start.visible = false;deny(menu, 'start control')
    start.visible = true;start.valid = false;deny(menu)
end)
test('original widget tree and root must both remain valid',function()
    local menu, _, _, tree, root = fixture();tree.valid=false;deny(menu);tree.valid=true;root.valid=false;deny(menu)
    root.valid=true;tree.RootWidget=nil;deny(menu)
end)
test('native method errors are denied and do not escape evaluate',function()
    local menu, warning = fixture();warning.GetParent=function() error('native read unavailable') end;deny(menu, 'native menu read failed')
end)
test('missing native methods and unknown return types fail closed',function()
    local menu, warning = fixture();warning.GetVisibility=nil;deny(menu)
    menu, warning=fixture();warning.IsVisible=function() return 0 end;deny(menu)
    menu=fixture();menu.GetAddress=function() return 'pointer' end;deny(menu)
end)
test('objects becoming invalid during inspection fail closed',function()
    local menu, warning, _, _, root=fixture();warning.GetParent=function() root.valid=false;return nil end;deny(menu)
end)
test('native object identity replacement during reads fails closed',function()
    local menu, warning = fixture();warning.GetParent=function() warning.address=warning.address+1;return nil end;deny(menu,'identity changed')
end)
test('replacement of a valid property is rejected even when prior object stays alive',function()
    local menu, warning, _, tree = fixture();warning.GetParent=function() menu.WidgetTree=object(99);return nil end;deny(menu)
end)
test('age screen reopening during inspection revokes permission',function()
    local menu, warning, start=fixture();local calls=0
    start.IsVisible=function() calls=calls+1;if calls==2 then warning.visible=true;warning.visibility=0 end;return true end
    deny(menu,'visibility changed')
end)
test('inspection constructs nothing and does not invoke native input or mutations',function()
    local menu, warning, start, tree, root, class=fixture()
    local function forbidden() error('Forbidden mutation') end
    for _, value in ipairs({menu,warning,start,tree,root,class}) do value.SetVisibility=forbidden;value.RemoveFromParent=forbidden;value.AddToViewport=forbidden end
    StaticConstructObject, ExecuteInGameThread, RegisterHook=forbidden,forbidden,forbidden
    assert(Guard.evaluate(menu)==true);assert(menu.AdultContentWarningSplashButton==warning and warning.visibility==1)
end)
print(tostring(passed) .. ' v005 original-menu guard tests passed')
