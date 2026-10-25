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
local javascript = readFile(directory .. '/Scripts/bridge.js', 65536) .. '\n' .. readFile(directory .. '/Scripts/native-controls.js',65536)
local browser, owner, ownerAddress, storeAddress, epoch
local generation = 0
local lastRequest = 0
local queued = false
local failedOwner = nil
local lastError = nil
local lastUrl = nil
local profileChanged = false
local profileGeneration = 0
local baseEpoch = tostring(os.time()) .. '-' .. tostring(math.random(1,2147483647))
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
    local packs = {}
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
        local owned = store:IsPackUnlocked(name)
        packs[#packs + 1] = '{"id":' .. quote(name) .. ',"name":' .. quote(stringValue(item.Title, 'Title'))
            .. ',"description":' .. quote(stringValue(item.Description, 'Description')) .. ',"unlock_cost":' .. tostring(cost)
            .. ',"media_count":' .. tostring(count) .. ',"owned":' .. boolean(owned)
            .. ',"enabled":' .. boolean(store:IsPackEnabled(name)) .. '}'
    end
    if type(infos) == 'table' then
        for _, item in ipairs(infos) do append(item) end
    else
        infos:ForEach(function(_, parameter) append(parameter:get()) end)
    end
    return '{"unlock_points":' .. tostring(store:GetUnlockPoints()) .. ',"packs":[' .. table.concat(packs, ',') .. ']}'
end
local lastDiagnosticRequest
local diagnosticController, diagnosticImage, diagnosticDeadline, diagnosticSave
local diagnosticVideo = 'null'
local function runtimeContext()
    local instance = FindFirstOf('BP_CHGameInstance_C')
    if not instance:IsValid() then error('Original game instance is not ready.') end
    local store = instance['CHPack StoreController']
    if not store or not store:IsValid() then error('Active original pack store is not ready.') end
    local save = instance.CurrentSave
    if not save or not save:IsValid() then error('Active original save is not ready.') end
    local slot = stringValue(instance.SaveSlotName, 'SaveSlotName')
    local user = instance.UserIndex
    if #slot == 0 or #slot > 512 or slot:find('[%z\1-\31]')
        or type(user) ~= 'number' or user < 0 or user % 1 ~= 0 then
        error('Original profile identity is invalid.')
    end
    return store, '{"build_id":"v004-exclusive-c645757d","slot":' .. quote(slot)
        .. ',"user_index":' .. tostring(user) .. ',"save_address":' .. quote(tostring(save:GetAddress()))
        .. ',"store_address":' .. quote(tostring(store:GetAddress())) .. '}'
end
local Music = assert(loadfile(directory .. '/Scripts/music.lua'))()
local Companion = assert(loadfile(directory .. '/Scripts/companion.lua'))()
local approvedAudio, audioProbeDeadline
local stoppedMusic = {}
local function musicBinding()
    local ok, _, profile = pcall(runtimeContext)
    return ok and (profile .. ':' .. tostring(profileGeneration)) or nil
end
local nativeMusic = Music.new({
    find=StaticFindObject,
    spawn=function(class, outer) return StaticFindObject('/Script/Engine.Default__GameplayStatics'):SpawnObject(class, outer) end,
    currentBinding=musicBinding,
    authorize=function(url, binding) return approvedAudio and approvedAudio.url == url and approvedAudio.binding == binding end
})
local function musicActor()
    local actor = FindFirstOf('BP_GlobalManager_C')
    if actor:IsValid() then return actor end
    return StaticFindObject('/Script/Engine.Default__GameplayStatics'):GetPlayerController(FindFirstOf('BP_CHGameInstance_C'), 0)
end
local function audioJSON()
    local state = nativeMusic:status()
    return '{"state":' .. quote(state.state) .. ',"position":' .. tostring(state.position)
        .. ',"duration":' .. tostring(state.duration) .. ',"advancing":' .. boolean(state.advancing)
        .. ',"error":' .. (state.error and quote(state.error) or 'null')
        .. ',"scope":"native audio transport; rhythm-session integration remains gated"}'
end
local function stopNativeMusic(reason)
    nativeMusic:stop(reason)
    if approvedAudio and approvedAudio.nonce then
        stoppedMusic[#stoppedMusic+1] = approvedAudio.nonce
        if #stoppedMusic > 128 then table.remove(stoppedMusic,1) end
    end
    approvedAudio = nil
end
local nativeCompanion = Companion.new({directory=directory,quote=quote,
    stoppedMusic=function() local values={} for _,token in ipairs(stoppedMusic) do values[#values+1]=quote(token) end return '[' .. table.concat(values,',') .. ']' end,
    openMusic=function(url, map, nonce)
        if #map > 4 * 1024 * 1024 then error('Native beatmap exceeds its limit.') end
        local binding = musicBinding()
        stopNativeMusic('replaced')
        approvedAudio = {url=url,binding=binding,nonce=nonce}
        nativeMusic:open(url,musicActor(),binding)
    end})
local function companionPulse()
    local store, profile = runtimeContext()
    nativeCompanion:update(profile,nativeState(store),profileGeneration,epoch or baseEpoch)
end
local audioQueued = false
LoopAsync(25,function()
    if audioQueued then return false end
    audioQueued = true
    ExecuteInGameThread(function()
        local ok, problem = pcall(function()
            if approvedAudio and browser and (not owner or not owner:IsValid() or not owner:IsInViewport() or not owner:IsVisible()) then stopNativeMusic('Import closed') end
            nativeMusic:sample()
            if audioProbeDeadline and os.time() >= audioProbeDeadline then
                stopNativeMusic('synthetic probe complete');audioProbeDeadline = nil
            elseif nativeMusic:status().state == 'ended' then
                stopNativeMusic('recording complete')
            elseif approvedAudio and (nativeMusic:status().state == 'stopped' or nativeMusic:status().state == 'error') then
                stopNativeMusic('transport closed')
            end
        end)
        if not ok then log('Native audio sampling failed: ' .. tostring(problem)) end
        audioQueued = false
    end)
    return false
end)
local function stopDiagnosticVideo()
    if diagnosticController and diagnosticController:IsValid() then diagnosticController:StopPlayback(false) end
    diagnosticController, diagnosticImage, diagnosticDeadline, diagnosticSave = nil, nil, nil, nil
end
local function sampleDiagnosticVideo()
    if not diagnosticController then return end
    local ok, problem = pcall(function()
        if not diagnosticController:IsValid() then error('Synthetic decoder was released before sampling.') end
        local instance = FindFirstOf('BP_CHGameInstance_C')
        if not instance:IsValid() or not instance.CurrentSave:IsValid()
            or instance.CurrentSave:GetAddress() ~= diagnosticSave then
            error('Native profile changed during the synthetic video probe.')
        end
        local texture = diagnosticController.DynamicTexture
        local valid = texture and texture:IsValid()
        local width = valid and texture:Blueprint_GetSizeX() or 0
        local height = valid and texture:Blueprint_GetSizeY() or 0
        diagnosticVideo = '{"initialized":' .. boolean(diagnosticController.bStreamingVideoInitialized)
            .. ',"frame":' .. tostring(diagnosticController.StreamingVideoCurrentFrame)
            .. ',"width":' .. tostring(width) .. ',"height":' .. tostring(height)
            .. ',"scope":"separate synthetic native decoder; no gameplay or visible-output claim"}'
        if os.time() >= diagnosticDeadline then stopDiagnosticVideo() end
    end)
    if not ok then
        diagnosticVideo = '{"error":' .. quote(tostring(problem)) .. '}'
        pcall(stopDiagnosticVideo)
    end
end
local function diagnosticFixture(store)
    local fixture = readFile(directory .. '/mcp-test-pack.txt', 256):match('^%s*(.-)%s*$')
    if not fixture:match('^fanservice%-native%-panel%-one%-[a-f0-9%-]+$') then
        error('Configure only the isolated native-panel-one synthetic fixture.')
    end
    if not store:IsPackUnlocked(fixture) then error('Synthetic fixture is not owned. Use original Unlocks.') end
    return fixture
end
local function diagnosticRequest()
    sampleDiagnosticVideo()
    local input = io.open(directory .. '/.fanservice-mcp.request', 'rb')
    if not input then return end
    local packet = input:read(513)
    input:close()
    if not packet or #packet > 512 then return end
    local nonce, timestamp, action = packet:match('^FANSERVICE_MCP_1\n([a-f0-9]+)\n(%d+)\n([a-z]+)\n$')
    timestamp = tonumber(timestamp)
    if not nonce or #nonce ~= 32 or nonce == lastDiagnosticRequest or not timestamp
        or math.abs(os.time() - timestamp) > 30 then return end
    lastDiagnosticRequest = nonce
    local ok, result = pcall(function()
        if action ~= 'status' and action ~= 'catalog' and action ~= 'profile'
            and action ~= 'enablefixture' and action ~= 'probevideo' and action ~= 'probeaudio' then
            error('Runtime MCP action is not supported.')
        end
        local store, profile = runtimeContext()
        if action == 'catalog' then return nativeState(store) end
        if action == 'profile' then return profile end
        if action == 'enablefixture' then
            local fixture = diagnosticFixture(store)
            local before = store:GetUnlockPoints()
            store:SetPackEnabled(fixture, true)
            if store:GetUnlockPoints() ~= before then error('Unexpected native UP change while enabling fixture.') end
            return '{"enabled":' .. boolean(store:IsPackEnabled(fixture)) .. ',"unlock_points":'
                .. tostring(before) .. ',"pack":' .. quote(fixture) .. '}'
        end
        if action == 'probeaudio' then
            local fixture = diagnosticFixture(store)
            if not store:IsPackEnabled(fixture) then error('Enable the synthetic fixture before its audio probe.') end
            stopNativeMusic('synthetic probe requested')
            local binding = musicBinding()
            approvedAudio = {url='http://127.0.0.1:42170/synthetic-tone.m4a',binding=binding}
            audioProbeDeadline = os.time() + 10
            nativeMusic:open(approvedAudio.url,musicActor(),binding)
            return '{"started":true,"scope":"fixed synthetic native audio transport; no gameplay or age-screen action"}'
        end
        if action == 'probevideo' then
            local fixture = diagnosticFixture(store)
            if not store:IsPackEnabled(fixture) then error('Enable the synthetic fixture before running its probe.') end
            stopDiagnosticVideo()
            local instance = FindFirstOf('BP_CHGameInstance_C')
            local factory = StaticFindObject('/Script/Engine.Default__GameplayStatics')
            local controllerClass = StaticFindObject('/Script/CockHero.MediaPlaybackController')
            local imageClass = StaticFindObject('/Script/UMG.Image')
            if not factory:IsValid() or not controllerClass:IsValid() or not imageClass:IsValid() then
                error('Native synthetic decoder factory is unavailable.')
            end
            diagnosticController = factory:SpawnObject(controllerClass, instance)
            diagnosticImage = factory:SpawnObject(imageClass, instance)
            if not diagnosticController:IsValid() or not diagnosticImage:IsValid() then error('Synthetic decoder construction failed.') end
            diagnosticSave = instance.CurrentSave:GetAddress()
            diagnosticDeadline = os.time() + 5
            diagnosticVideo = '{"started":true}'
            diagnosticController:PlayMediaEntry('http://127.0.0.1:42170/synthetic.mp4', diagnosticImage, 3.0)
            return '{"started":true,"scope":"separate synthetic native decoder; sample native_status for frame progress"}'
        end
        local menu = FindFirstOf('ImportMenuWidget_C')
        local visible = menu:IsValid() and menu:IsInViewport() and menu:IsVisible()
        return '{"ready":true,"read_only":true,"original_unlocks_authoritative":true,"import_visible":'
            .. boolean(visible) .. ',"profile":' .. profile .. ',"video_probe":' .. diagnosticVideo .. ',"audio_probe":' .. audioJSON() .. '}'
    end)
    if ok and #result > 4 * 1024 * 1024 then ok, result = false, 'Native diagnostic response exceeds 4 MiB.' end
    local response = '{"protocol":1,"nonce":' .. quote(nonce)
        .. ',"build_id":"v004-exclusive-c645757d","ok":' .. boolean(ok)
        .. (ok and ',"result":' .. result or ',"error":' .. quote(tostring(result))) .. '}'
    local target = directory .. '/.fanservice-mcp.response.' .. nonce
    local temporary = target .. '.tmp'
    local output = assert(io.open(temporary, 'wb'))
    assert(output:write(response))
    assert(output:close())
    local renamed, problem = os.rename(temporary, target)
    if not renamed then os.remove(temporary); error(problem) end
    log('Runtime MCP action completed: ' .. action)
end
local function revoke()
    if browser then log('Embedded Lite closed; bridge revoked.') end
    if browser and browser:IsValid() then
        browser:ExecuteJavascript('globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.revoke()')
        browser:RemoveFromParent()
    end
    stopNativeMusic('Import closed; rhythm-session integration is not active')
    nativeCompanion:cancel('Native menu closed. Stale work was discarded.')
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
    epoch = baseEpoch .. '-' .. tostring(generation) .. '-' .. tostring(storeAddress)
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
    if #title > 65536 then return end
    local requestEpoch, id, action, encoded = title:match('^FANSERVICE_RPC:([%d%-]+):(%d+):([a-z]+):(.*)$')
    id = tonumber(id)
    if requestEpoch ~= epoch or not id or id <= lastRequest or id > 2147483647 then return end
    lastRequest = id
    local target, requestEpochSnapshot = browser, epoch
    local function reply(payload)
        if browser == target and epoch == requestEpochSnapshot and target:IsValid() then
            target:ExecuteJavascript('globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.receive(' .. tostring(id) .. ',' .. payload .. ')')
        end
    end
    local ok, problem = pcall(function()
        if action == 'state' and encoded == '' then
            reply('{"ok":true,"state":' .. nativeState(store) .. '}')
        elseif action == 'musicstatus' then reply('{"ok":true,"data":' .. audioJSON() .. '}')
        elseif action == 'musicpause' then nativeMusic:pause();reply('{"ok":true,"data":' .. audioJSON() .. '}')
        elseif action == 'musicresume' then nativeMusic:resume();reply('{"ok":true,"data":' .. audioJSON() .. '}')
        elseif action == 'musicreconnect' then nativeMusic:reconnect();reply('{"ok":true,"data":' .. audioJSON() .. '}')
        elseif action == 'musicstop' then stopNativeMusic('user stopped');reply('{"ok":true,"data":' .. audioJSON() .. '}')
        elseif action == 'musicseek' then
            local value = Companion.decode(encoded):match('^%{"position":([%d%.]+)%}$')
            if not value then error('Invalid native seek position.') end
            nativeMusic:seek(tonumber(value));reply('{"ok":true,"data":' .. audioJSON() .. '}')
        else nativeCompanion:request(action,encoded,reply) end
    end)
    if not ok then reply('{"ok":false,"error":' .. quote(tostring(problem)) .. '}') end
end
log('v0.04 embedded menu adapter loaded. Native UP remains authoritative.')
for _, event in ipairs({'Init', 'ReloadSave'}) do
    RegisterHook('/Script/CockHero.CHPackStoreController:' .. event, function()
        profileGeneration = profileGeneration + 1
        profileChanged = true
    end)
end
LoopAsync(500, function()
    if queued then return false end
    queued = true
    ExecuteInGameThread(function()
        local ok, problem = pcall(function()
            diagnosticRequest()
            if profileChanged then
                stopDiagnosticVideo()
                revoke()
                profileChanged = false
            end
            local menu = FindFirstOf('ImportMenuWidget_C')
            if not menu:IsValid() or not menu:IsInViewport() or not menu:IsVisible() then
                if browser then revoke() end
                companionPulse()
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
            companionPulse()
        end)
        if not ok and tostring(problem) ~= lastError then
            lastError = tostring(problem)
            log('Adapter error: ' .. lastError)
        end
        queued = false
    end)
    return false
end)
