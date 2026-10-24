-- Isolated development probe. It attaches only to an already-open native Import menu.
local commandPath = 'E:/fanservice-mod-lab/v004-native/browser-command.txt'
local browser = nil
local busy = false
local function report(message) print('[FSV004_BROWSER] ' .. message .. '\n') end
local function importMenu()
    local menu = FindFirstOf('ImportMenuWidget_C')
    if not menu:IsValid() or not menu:IsInViewport() then
        error('Open the original Import menu before this probe.')
    end
    return menu
end
local function inspect()
    local menu = importMenu()
    report('menu=' .. menu:GetFullName())
    local tree = menu.WidgetTree
    if not tree:IsValid() then error('Import widget has no valid WidgetTree.') end
    report('tree=' .. tree:GetFullName())
    local root = tree.RootWidget
    if not root:IsValid() then error('Import widget has no valid root.') end
    report('root=' .. root:GetFullName())
    local spawn = StaticFindObject('/Script/Engine.GameplayStatics:SpawnObject')
    if not spawn:IsValid() then error('Engine SpawnObject function unavailable.') end
    spawn:ForEachProperty(function(property) report('spawn-param=' .. property:GetFullName()) end)
end
local function attach()
    if browser and browser:IsValid() then error('Browser already attached.') end
    local menu = importMenu()
    local tree = menu.WidgetTree
    if not tree:IsValid() or not tree.RootWidget:IsValid() then error('Import widget tree is unavailable.') end
    local class = StaticFindObject('/Script/WebBrowserWidget.WebBrowser')
    if not class:IsValid() then error('Standard WebBrowser class is unavailable.') end
    local factory = StaticFindObject('/Script/Engine.Default__GameplayStatics')
    if not factory:IsValid() then error('GameplayStatics default object unavailable.') end
    report('constructing through the engine SpawnObject function')
    browser = factory:SpawnObject(class, tree)
    if not browser:IsValid() then error('Browser construction returned no object.') end
    local slot = tree.RootWidget:AddChildToCanvas(browser)
    if not slot:IsValid() then error('Import canvas rejected the browser.') end
    slot:SetAnchors({Minimum={X=0,Y=0},Maximum={X=1,Y=1}})
    slot:SetOffsets({Left=120,Top=30,Right=24,Bottom=30})
    slot:SetZOrder(100)
    browser:LoadString('<html><head><title>Fanservice browser ready</title></head><body style="background:#151c27;color:#afffcf;font:32px sans-serif;padding:48px"><h1>fanservice</h1><p>Embedded v0.04 browser ready.</p><p>The original Back control remains available.</p></body></html>', 'http://127.0.0.1:42168/fanservice/')
    report('attached=' .. browser:GetFullName())
end
local function detach()
    if browser and browser:IsValid() then browser:RemoveFromParent() end
    browser = nil
    report('detached')
end
local function lite()
    importMenu()
    if not browser or not browser:IsValid() then error('Attach the browser first.') end
    browser:LoadURL('http://127.0.0.1:42168/fanservice/')
    report('Lite navigation requested')
end
local commands = {inspect=inspect, attach=attach, detach=detach, lite=lite}
report('probe loaded; waiting for a bounded development command')
LoopAsync(500, function()
    if busy then return false end
    local input = io.open(commandPath, 'r')
    if not input then return false end
    local command = input:read(32)
    input:close()
    os.remove(commandPath)
    command = command:match('^%s*(.-)%s*$')
    local handler = commands[command]
    if not handler then report('unknown command rejected'); return false end
    busy = true
    ExecuteInGameThread(function()
        local ok, problem = pcall(handler)
        if not ok then report('error=' .. tostring(problem)) end
        busy = false
    end)
    return false
end)
