-- Isolated synthetic-video probe; excluded from the runtime installer.
local source = debug.getinfo(1, 'S').source:gsub('^@', ''):gsub('\\', '/')
local directory = assert(source:match('^(.*)/Scripts/main%.lua$'))
local input = assert(io.open(directory .. '/target-pack.txt', 'rb'))
local target = input:read(256)
input:close()
target = target:match('^%s*(.-)%s*$')
assert(target:match('^fanservice%-[a-z0-9%-]+$'), 'Choose an isolated synthetic fanservice pack.')
local needle = '/extracted/' .. target .. '/media/'
local attempts = 0
RegisterHook('/Script/CockHero.MediaPlaybackController:PlayMediaEntry', function(_, path)
    if attempts >= 3 then return end
    local current = path:get():ToString():gsub('\\', '/')
    if not current:lower():find(needle, 1, true) or current:sub(-4):lower() ~= '.mp4' then return end
    local store = FindFirstOf('CHPackStoreController')
    if not store:IsValid() or not store:IsPackUnlocked(target) or not store:IsPackEnabled(target) then return end
    attempts = attempts + 1
    path:set('http://127.0.0.1:42170/synthetic.mp4')
    print('[FanserviceStreamProbe] Synthetic owned-pack video redirected to loopback HTTP. Attempt '
          .. tostring(attempts) .. '\n')
end)
print('[FanserviceStreamProbe] Ready. Only the configured owned synthetic pack is eligible.\n')
