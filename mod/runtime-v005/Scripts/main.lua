local source = debug.getinfo(1, 'S').source:gsub('^@', ''):gsub('\\', '/')
local directory = assert(source:match('^(.*)/Scripts/main%.lua$'), 'Cannot locate v0.05 fanservice runtime.')
local BUILD = 'v0051-hotfix-public-a8f46896'
local function read(name, limit)
    local file = assert(io.open(directory .. '/' .. name, 'rb'))
    local data = file:read(limit + 1); file:close()
    assert(#data <= limit, 'Native runtime file exceeds its limit.')
    return data
end
assert(read('build-id.txt', 128):match('^%s*(.-)%s*$') == BUILD, 'Wrong native runtime build configuration.')
local origin = read('server-origin.txt', 2048):match('^%s*(.-)%s*$')
local scheme, host, port = origin:match('^(https?)://([A-Za-z0-9%.%-]+):?(%d*)$')
assert(scheme and not host:find('%.%.') and (port == '' or tonumber(port) >= 1 and tonumber(port) <= 65535), 'Invalid Server origin.')
assert(scheme == 'https' or host == '127.0.0.1' or host == 'localhost', 'Remote Server origins require HTTPS.')
local page = origin .. '/fanservice/'
local Guard = dofile(directory .. '/Scripts/menu_guard.lua')
local Companion = dofile(directory .. '/Scripts/companion.lua')
local javascript = read('Scripts/bridge.js', 65536) .. '\n' .. read('Scripts/native-controls.js', 65536)
local function text(value) return type(value) == 'string' and value or value:ToString() end
local function valid(value) return value and value:IsValid() end
local function quote(value)
    return '"' .. tostring(value):gsub('[%z\1-\31\\"]', function(c)
        if c == '\\' then return '\\\\' end
        if c == '"' then return '\\"' end
        return string.format('\\u%04x', c:byte())
    end) .. '"'
end
local function boolean(value) return value and 'true' or 'false' end
local function log(value) print('[FanserviceV005] ' .. value .. '\n') end
local generation, epoch, signature = 0, nil, nil
local base = tostring(os.time()) .. '-' .. tostring(math.random(1, 2147483647))
local owner, entry, browser, entryToken, lastClick, lastRequest
local entryHTML, entryReady, entryDeadline, entryLastLoad, panelDeadline, panelLastLoad
local lastFailure, lastGate
local failedMenu
local profileChanged = false
local broker = Companion.new({directory=directory, quote=quote})

local function renew()
    generation = generation + 1
    epoch = base .. '-' .. tostring(generation)
end
renew()
local function closePanel(reason)
    broker:cancel(reason or 'Fanservice panel closed.')
    if valid(browser) then
        browser:ExecuteJavascript('globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.revoke()')
        browser:RemoveFromParent()
    end
    browser, lastRequest, panelDeadline, panelLastLoad = nil, 0, nil, nil
    if valid(entry) then entry:ExecuteJavascript('document.querySelector("button").textContent="Fanservice"') end
    renew()
end
local function detach(reason)
    closePanel(reason)
    if valid(entry) then entry:RemoveFromParent() end
    entry, owner, entryToken, lastClick = nil, nil, nil, 0
    entryHTML, entryReady, entryDeadline, entryLastLoad = nil, nil, nil, nil
end
local function context()
    local instance = FindFirstOf('BP_CHGameInstance_C')
    assert(valid(instance), 'Original game instance is unavailable.')
    local store, save = instance['CHPack StoreController'], instance.CurrentSave
    assert(valid(store) and valid(save), 'Original profile is unavailable.')
    local slot, user = text(instance.SaveSlotName), instance.UserIndex
    assert(#slot > 0 and #slot <= 512 and not slot:find('[%z\1-\31]') and type(user) == 'number' and user >= 0 and user % 1 == 0, 'Invalid original profile identity.')
    local identity = slot .. ':' .. tostring(user) .. ':' .. tostring(store:GetAddress()) .. ':' .. tostring(save:GetAddress())
    local json = '{"build_id":' .. quote(BUILD) .. ',"slot":' .. quote(slot) .. ',"user_index":' .. tostring(user)
        .. ',"save_address":' .. quote(tostring(save:GetAddress())) .. ',"store_address":' .. quote(tostring(store:GetAddress())) .. '}'
    return store, json, identity
end
local function catalog(store)
    local packs, count = {}, 0
    local infos = store:GetAllPackInfos()
    assert(#infos <= 10000, 'Native pack catalog exceeds its limit.')
    local function append(item)
        if type(item) == 'userdata' then
            local ok, value = pcall(function() return item:get() end)
            if ok and value ~= nil then item = value end
        end
        local name = text(item.PackName)
        if name:sub(1, 11) ~= 'fanservice-' then return end
        assert(#name <= 240 and not name:find('[%z\1-\31]'), 'Invalid native pack identity.')
        local cost, members = item.UnlockCost, item.TotalMediaCount
        assert(type(cost) == 'number' and cost >= 0 and cost % 1 == 0 and type(members) == 'number' and members >= 0 and members % 1 == 0, 'Invalid native pack counters.')
        count = count + 1
        packs[count] = '{"id":' .. quote(name) .. ',"name":' .. quote(text(item.Title))
            .. ',"description":' .. quote(text(item.Description)) .. ',"unlock_cost":' .. tostring(cost)
            .. ',"media_count":' .. tostring(members) .. ',"owned":' .. boolean(store:IsPackUnlocked(name))
            .. ',"enabled":' .. boolean(store:IsPackEnabled(name)) .. '}'
    end
    if type(infos) == 'table' then
        for _, item in ipairs(infos) do append(item) end
    else infos:ForEach(function(_, parameter) append(parameter:get()) end) end
    return '{"unlock_points":' .. tostring(store:GetUnlockPoints()) .. ',"packs":[' .. table.concat(packs, ',') .. ']}'
end
local function widget(menu, offsets, z, initialURL)
    local factory = StaticFindObject('/Script/Engine.Default__GameplayStatics')
    local class = StaticFindObject('/Script/WebView.WebViewWidget')
    assert(valid(factory) and valid(class), 'Native browser factory is unavailable.')
    local child = factory:SpawnObject(class, menu.WidgetTree)
    assert(valid(child), 'Native browser construction failed.')
    child.urlInitial = initialURL
    child:SetVisibility(0)
    local ok, problem = pcall(function()
        local slot = menu.WidgetTree.RootWidget:AddChildToCanvas(child)
        assert(valid(slot), 'Original menu root is not a supported canvas.')
        slot:SetAnchors(offsets.anchors)
        slot:SetOffsets(offsets.margin)
        slot:SetZOrder(z)
    end)
    if not ok then child:RemoveFromParent(); error(problem) end
    return child
end
local function attach(menu)
    owner, lastClick = menu, 0
    entryToken = epoch .. '-' .. tostring(menu:GetAddress())
    entryHTML = '<!doctype html><title>FANSERVICE_ENTRY_READY:' .. entryToken .. '</title><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#101923}button{width:100%;height:55px;background:#12b886;color:#10202a;border:2px solid #a4dbc4;font:20px system-ui;cursor:pointer}</style><button>Fanservice</button><script>let n=0;document.querySelector("button").onclick=()=>{document.title="FANSERVICE_ENTRY:' .. entryToken .. ':"+(++n)};</script>'
    local initialURL = 'data:text/html;charset=utf-8,' .. entryHTML:gsub('.', function(c) return string.format('%%%02X', c:byte()) end)
    entry = widget(menu, {anchors={Minimum={X=1,Y=0},Maximum={X=1,Y=0}},margin={Left=-225,Top=35,Right=200,Bottom=55}}, 220, initialURL)
    entryReady, entryDeadline, entryLastLoad = false, os.time() + 30, os.time()
    log('Independent main-menu entry attached after original age-screen dismissal.')
end
local function openPanel()
    assert(owner and Guard.evaluate(owner), 'Original main menu is no longer available.')
    renew()
    browser = widget(owner, {anchors={Minimum={X=0,Y=0},Maximum={X=1,Y=1}},margin={Left=95,Top=105,Right=25,Bottom=25}}, 210, page)
    browser:LoadURL(page, '', false)
    panelDeadline, panelLastLoad = os.time() + 30, os.time()
    entry:ExecuteJavascript('document.querySelector("button").textContent="Close fanservice"')
    lastRequest = 0
    log('Independent fanservice panel opened; original Import controls unchanged.')
end
local function pollEntry()
    local title = text(entry:GetTitle())
    if not entryReady then
        if title == 'FANSERVICE_ENTRY_READY:' .. entryToken then
            entryReady = true; log('Independent entry document handshake verified.')
        else
            assert(os.time() <= entryDeadline, 'Native entry document did not become ready.')
            if os.time() - entryLastLoad >= 3 then
                entryLastLoad = os.time(); entry:LoadURL(text(entry.urlInitial), '', false)
            end
            return
        end
    end
    local token, click = title:match('^FANSERVICE_ENTRY:([%d%-]+):(%d+)$')
    click = tonumber(click)
    if token == entryToken and click and click > lastClick and click <= 2147483647 then
        lastClick = click
        if browser then closePanel() else openPanel() end
    end
end
local function pollPanel(store)
    if not browser then return end
    assert(valid(browser), 'Fanservice browser was released.')
    local url = text(browser:GetUrl())
    if url == '' or url == 'about:blank' then
        assert(os.time() <= panelDeadline, 'Native Server document did not become ready.')
        if os.time() - panelLastLoad >= 3 then panelLastLoad = os.time(); browser:LoadURL(page, '', false) end
        return
    end
    if url:sub(1, #page) ~= page then closePanel('Panel left its configured Server.'); return end
    browser:ExecuteJavascript('globalThis.__fanserviceNativeEpoch=' .. quote(epoch) .. ';' .. javascript)
    local title = text(browser:GetTitle())
    if #title > 65536 then return end
    local requestEpoch, id, action, encoded = title:match('^FANSERVICE_RPC:([%d%-]+):(%d+):([a-z]+):(.*)$')
    id = tonumber(id)
    if requestEpoch ~= epoch or not id or id <= lastRequest or id > 2147483647 then return end
    lastRequest = id
    local target, snapshot = browser, epoch
    local function reply(payload)
        if browser == target and epoch == snapshot and valid(target) and text(target:GetUrl()):sub(1, #page) == page then
            target:ExecuteJavascript('globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.receive(' .. tostring(id) .. ',' .. payload .. ')')
        end
    end
    local ok, problem = pcall(function()
        if action == 'state' and encoded == '' then reply('{"ok":true,"state":' .. catalog(store) .. '}')
        elseif action == 'musicprepare' then error('Deliver music to the original Playlist from this v0.05 panel.')
        else broker:request(action, encoded, reply) end
    end)
    if not ok then reply('{"ok":false,"error":' .. quote(tostring(problem)) .. '}') end
end
LoopInGameThreadWithDelay(500, function()
    local ok, problem = pcall(function()
        local store, profile, identity = context()
        if signature ~= identity or profileChanged then
            detach('Original profile changed. Pending work was discarded.')
            signature = identity
            failedMenu = nil
            profileChanged = false
        end
        local menu = FindFirstOf('MainMenu_C')
        local allowed, reason = Guard.evaluate(menu)
        if reason ~= lastGate then log('Menu gate: ' .. tostring(reason)); lastGate = reason end
        if owner and (not allowed or not valid(owner) or menu:GetAddress() ~= owner:GetAddress()) then detach('Original menu closed.') end
        if allowed and not entry and failedMenu ~= menu:GetAddress() then
            failedMenu = menu:GetAddress()
            attach(menu)
            failedMenu = nil
        end
        if entry then pollEntry(); pollPanel(store) end
        broker:update(profile, catalog(store), generation, epoch)
        lastFailure = nil
    end)
    if not ok and tostring(problem) ~= lastFailure then
        lastFailure = tostring(problem)
        if valid(owner) then failedMenu = owner:GetAddress() end
        pcall(detach, 'Native context is unavailable.')
        log('Adapter stopped its UI: ' .. lastFailure)
    end
end)
for _, event in ipairs({'Init', 'ReloadSave'}) do
    RegisterHook('/Script/CockHero.CHPackStoreController:' .. event, function() profileChanged = true end)
end
log('Experimental v0.05 independent-menu adapter loaded. Native Unlocks remains authoritative.')
