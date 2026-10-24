local scriptPath = debug.getinfo(1, 'S').source:gsub('^@', ''):gsub('\\', '/')
local directory = assert(scriptPath:match('^(.*)/Scripts/main%.lua$'), 'Cannot locate fanservice module directory.')
local function readFile(path, maximum)
    local stream, problem = io.open(path, 'rb')
    if not stream then error(problem) end
    local data = stream:read(maximum + 1)
    stream:close()
    if #data > maximum then error('fanservice file exceeds its size limit.') end
    return data
end
local origin = readFile(directory .. '/server-origin.txt', 2048):match('^%s*(.-)%s*$')
local scheme, host, port = origin:match('^(https?)://([A-Za-z0-9%.%-]+):?(%d*)$')
assert(scheme and not host:find('%.%.') and (port == '' or tonumber(port) >= 1 and tonumber(port) <= 65535),
       'Set server-origin.txt to a Server origin without a path, credentials or query.')
assert(scheme == 'https' or host == '127.0.0.1' or host == 'localhost', 'Remote Server origins require HTTPS.')
local page = origin .. '/fanservice/'
local javascript = readFile(directory .. '/Scripts/bridge.js', 65536)
local browser, owner, ownerAddress, storeAddress, epoch
local generation = 0
local lastRequest = 0
local queued = false
local failedOwner = nil
local lastError = nil
local lastUrl = nil
local profileChanged = false
local function log(message) print('[Fanservice] ' .. message .. '\n') end
local function quote(value)
    return '"' .. tostring(value):gsub('[%z\1-\31\\"]', function(character)
        if character == '\\' then return '\\\\' end
        if character == '"' then return '\\"' end
        return string.format('\\u%04x', character:byte())
    end) .. '"'
end
local function boolean(value) return value and 'true' or 'false' end
local function stringValue(value, field)
    if value == nil then error('Native catalog omitted ' .. tostring(field or 'a required text field') .. '.') end
    if type(value) == 'string' then return value end
    return value:ToString()
end
local function nativeState(store)
    local packs, allowed = {}, {}
    local infos = store:GetAllPackInfos()
    if #infos > 10000 then error('Native catalog exceeds 10000 packs.') end
    local function append(item)
        if type(item) == 'userdata' then
            local ok, value = pcall(function() return item:get() end)
            if ok and value ~= nil then item = value end
        end
        local name = stringValue(item.PackName, 'PackName')
        if name:sub(1, 11) ~= 'fanservice-' then return end
        if #name > 240 or name:find('[%z\1-\31]') then error('Invalid native pack name.') end
        local cost, count = item.UnlockCost, item.TotalMediaCount
        if type(cost) ~= 'number' or cost < 0 or cost % 1 ~= 0
            or type(count) ~= 'number' or count < 0 or count % 1 ~= 0 then
            error('Invalid native pack price or media count.')
        end
        allowed[name] = {owned=store:IsPackUnlocked(name), count=count}
        packs[#packs + 1] = '{"id":' .. quote(name) .. ',"name":' .. quote(stringValue(item.Title, 'Title'))
            .. ',"description":' .. quote(stringValue(item.Description, 'Description')) .. ',"unlock_cost":' .. tostring(cost)
            .. ',"media_count":' .. tostring(count) .. ',"owned":' .. boolean(allowed[name].owned)
            .. ',"enabled":' .. boolean(store:IsPackEnabled(name)) .. '}'
    end
    if type(infos) == 'table' then
        for _, item in ipairs(infos) do append(item) end
    else
        infos:ForEach(function(_, parameter) append(parameter:get()) end)
    end
    return '{"unlock_points":' .. tostring(store:GetUnlockPoints()) .. ',"packs":[' .. table.concat(packs, ',') .. ']}', allowed
end
local function revoke()
    if browser then log('Embedded Lite closed; bridge revoked.') end
    if browser and browser:IsValid() then
        browser:ExecuteJavascript('globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.revoke()')
        browser:RemoveFromParent()
    end
    browser, owner, ownerAddress, storeAddress, epoch = nil, nil, nil, nil, nil
    lastRequest = 0
end
local function attach(menu, store)
    local tree = menu.WidgetTree
    if not tree:IsValid() or not tree.RootWidget:IsValid() then error('Import widget tree is unavailable.') end
    local class = StaticFindObject('/Script/WebBrowserWidget.WebBrowser')
    local factory = StaticFindObject('/Script/Engine.Default__GameplayStatics')
    if not class:IsValid() or not factory:IsValid() then error('Native browser factory is unavailable.') end
    local child = factory:SpawnObject(class, tree)
    if not child:IsValid() then error('Native browser construction failed.') end
    browser = child
    local slot = tree.RootWidget:AddChildToCanvas(child)
    if not slot:IsValid() then error('Original Import canvas rejected the browser.') end
    slot:SetAnchors({Minimum={X=0,Y=0},Maximum={X=1,Y=1}})
    slot:SetOffsets({Left=120,Top=30,Right=24,Bottom=30})
    slot:SetZOrder(100)
    generation = generation + 1
    owner, ownerAddress, storeAddress = menu, menu:GetAddress(), store:GetAddress()
    epoch = tostring(os.time()) .. '-' .. tostring(generation) .. '-' .. tostring(storeAddress)
    lastRequest = 0
    child:LoadURL(page)
    log('Embedded Lite opened through ordinary Import. Generation ' .. tostring(generation))
end
local function handle(store)
    local currentUrl = stringValue(browser:GetUrl())
    if currentUrl ~= lastUrl then lastUrl = currentUrl; log('Embedded URL: ' .. currentUrl) end
    if currentUrl:sub(1, #page) ~= page then return end
    browser:ExecuteJavascript('globalThis.__fanserviceNativeEpoch=' .. quote(epoch) .. ';' .. javascript)
    local title = stringValue(browser:GetTitleText())
    if #title > 4096 then return end
    local requestEpoch, id, action, encoded = title:match('^FANSERVICE_RPC:([%d%-]+):(%d+):([a-z]+):(.*)$')
    id = tonumber(id)
    if requestEpoch ~= epoch or not id or id <= lastRequest or id > 2147483647 then return end
    lastRequest = id
    local ok, result = pcall(function()
        local state, allowed = nativeState(store)
        if action == 'state' then return '{"ok":true,"state":' .. state .. '}' end
        if encoded:gsub('%%%x%x', ''):find('%%') then
            error('Invalid encoded native pack identity.')
        end
        local name = encoded:gsub('%%(%x%x)', function(hex) return string.char(tonumber(hex, 16)) end)
        local pack = allowed[name]
        if not pack then error('Pack is not in the current fanservice native catalog.') end
        if pack.count == 0 then error('Native pack has no playable media.') end
        if action == 'purchase' then
            if not pack.owned and not store:UnlockPack(name) then error('Native purchase rejected. Check your UP balance.') end
        elseif action == 'enable' or action == 'disable' then
            if not pack.owned then error('Unlock this pack in the native game first.') end
            store:SetPackEnabled(name, action == 'enable')
        else
            error('Unsupported native action.')
        end
        state = nativeState(store)
        return '{"ok":true,"state":' .. state .. '}'
    end)
    local payload = ok and result or '{"ok":false,"error":' .. quote(tostring(result):gsub('^.-:%d+: ', '')) .. '}'
    browser:ExecuteJavascript('globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.receive('
                              .. tostring(id) .. ',' .. payload .. ')')
end
log('v0.04 embedded menu adapter loaded. Native UP remains authoritative.')
for _, event in ipairs({'Init', 'ReloadSave'}) do
    RegisterHook('/Script/CockHero.CHPackStoreController:' .. event, function()
        profileChanged = true
    end)
end
LoopAsync(500, function()
    if queued then return false end
    queued = true
    ExecuteInGameThread(function()
        local ok, problem = pcall(function()
            if profileChanged then
                revoke()
                profileChanged = false
            end
            local menu = FindFirstOf('ImportMenuWidget_C')
            if not menu:IsValid() or not menu:IsInViewport() or not menu:IsVisible() then
                if browser then revoke() end
                return
            end
            local store = FindFirstOf('CHPackStoreController')
            if not store:IsValid() then error('Active native store is unavailable.') end
            local address = menu:GetAddress()
            if browser and (not browser:IsValid() or ownerAddress ~= address or storeAddress ~= store:GetAddress()) then revoke() end
            if not browser then
                if failedOwner == address then return end
                failedOwner = address
                attach(menu, store)
                failedOwner = nil
            end
            handle(store)
        end)
        if not ok and tostring(problem) ~= lastError then
            lastError = tostring(problem)
            log('Adapter error: ' .. lastError)
        end
        queued = false
    end)
    return false
end)
