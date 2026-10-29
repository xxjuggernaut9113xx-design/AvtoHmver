local Guard = {}

local function identity(object, name)
    if object == nil or object:IsValid() ~= true then error(name .. ' unavailable', 0) end
    local address = object:GetAddress()
    if type(address) ~= 'number' or address <= 0 or address ~= address or address == math.huge then
        error(name .. ' identity unknown', 0)
    end
    return address
end

local function detached(widget)
    local parent = widget:GetParent()
    if parent == nil then return true end
    return parent:IsValid() == false and parent:GetAddress() == 0
end

local function hiddenWarning(widget)
    local visibility = widget:GetVisibility()
    return (visibility == 1 or visibility == 2) and widget:IsVisible() == false and detached(widget)
end

local function inspect(menu)
    local menuAddress = identity(menu, 'main menu')
    local class = menu:GetClass()
    local classAddress = identity(class, 'main menu class')
    local className = class:GetFullName()
    if type(className) ~= 'string' or not className:match('^WidgetBlueprintGeneratedClass .+%.MainMenu_C$') then
        return false, 'original MainMenu_C required'
    end
    if menu:IsInViewport() ~= true or menu:IsVisible() ~= true then return false, 'main menu is closed' end

    local warning = menu.AdultContentWarningSplashButton
    local warningAddress = identity(warning, 'original age-screen guard')
    if not hiddenWarning(warning) then return false, 'original age screen has not been dismissed' end

    local start = menu.StartGameButton
    local startAddress = identity(start, 'original StartGameButton')
    if start:IsVisible() ~= true then return false, 'original start control is hidden' end
    local tree = menu.WidgetTree
    local treeAddress = identity(tree, 'original widget tree')
    local root = tree.RootWidget
    local rootAddress = identity(root, 'original root widget')

    if identity(menu, 'main menu') ~= menuAddress or identity(menu:GetClass(), 'main menu class') ~= classAddress
        or identity(warning, 'original age-screen guard') ~= warningAddress
        or identity(start, 'original StartGameButton') ~= startAddress
        or identity(tree, 'original widget tree') ~= treeAddress or identity(root, 'original root widget') ~= rootAddress
        or identity(menu.AdultContentWarningSplashButton, 'current age-screen guard') ~= warningAddress
        or identity(menu.StartGameButton, 'current StartGameButton') ~= startAddress
        or identity(menu.WidgetTree, 'current widget tree') ~= treeAddress
        or identity(tree.RootWidget, 'current root widget') ~= rootAddress then
        return false, 'native menu identity changed'
    end
    if menu:IsInViewport() ~= true or menu:IsVisible() ~= true or start:IsVisible() ~= true or not hiddenWarning(warning) then
        return false, 'native menu visibility changed'
    end
    return true, 'original main menu confirmed after age-screen dismissal'
end

function Guard.evaluate(menu)
    local ok, allowed, reason = pcall(inspect, menu)
    if not ok then return false, 'native menu read failed: ' .. tostring(allowed):sub(1, 256) end
    return allowed == true, reason
end

return Guard
