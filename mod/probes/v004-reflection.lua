-- Read-only development probe. No widget creation, save edits or access changes.
print('[FanserviceV004] reflection probe loaded\n')
local runs = 0
LoopAsync(4000, function()
    runs = runs + 1
    ExecuteInGameThread(function()
        local count = 0
        ForEachUObject(function(object)
            local name = object:GetFullName()
            if name:find('/Script/WebBrowserWidget.', 1, true)
                or name:find('/Script/CockHero.CHPackStoreController', 1, true)
                or name:find('/Script/CockHero.FileImportManager', 1, true)
                or name:find('/Script/UMG.WidgetBlueprintLibrary:Create', 1, true)
                or name:find('ImportMenuWidget_C /Engine/Transient', 1, true)
                or name:find('BP_CHGameInstance_C /Engine/Transient', 1, true) then
                if count < 160 then
                    print('[FSV004_OBJECT] ' .. name .. '\n')
                    if name:sub(1, 9) == 'Function ' then
                        local ok, problem = pcall(function()
                            object:ForEachProperty(function(property)
                                print('[FSV004_PARAM] ' .. property:GetFullName() .. '\n')
                            end)
                        end)
                        if not ok then print('[FSV004_PARAM_UNKNOWN] ' .. tostring(problem) .. '\n') end
                    end
                end
                count = count + 1
            end
        end)
        print('[FSV004_PASS] objects=' .. tostring(count) .. ' pass=' .. tostring(runs) .. '\n')
        local ok, problem = pcall(function()
            local store = FindFirstOf('CHPackStoreController')
            if store:IsValid() then
                print('[FSV004_STORE] ' .. store:GetFullName() .. '\n')
                print('[FSV004_UP] ' .. tostring(store:GetUnlockPoints()) .. '\n')
            else
                print('[FSV004_STORE] no live store instance\n')
            end
        end)
        if not ok then print('[FSV004_QUERY_UNKNOWN] ' .. tostring(problem) .. '\n') end
    end)
    return runs >= 3
end)
