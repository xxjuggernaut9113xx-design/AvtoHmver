local Companion = {}
local actions = {companionread=true,definitions=true,definitionsbegin=true,definitionschunk=true,definitionscommit=true,snapshotdownload=true,snapshotdelete=true,
    synchandshake=true,syncconfigure=true,syncupload=true,syncpreview=true,syncapply=true,musicprepare=true,sessionrelease=true}
local function read(path, maximum)
    local file = io.open(path, 'rb')
    if not file then return nil end
    local value = file:read(maximum + 1)
    file:close()
    if #value > maximum then error('Native companion file exceeds its limit.') end
    return value
end
local function publish(path, value)
    local temporary = path .. '.tmp'
    local file = assert(io.open(temporary, 'wb'))
    assert(file:write(value)); assert(file:close())
    os.remove(path)
    assert(os.rename(temporary, path))
end
function Companion.decode(value)
    local at = 1
    while true do
        local position = value:find('%', at, true)
        if not position then break end
        if not value:sub(position + 1, position + 2):match('^%x%x$') then error('Invalid native request encoding.') end
        at = position + 3
    end
    return (value:gsub('%%(%x%x)', function(hex) return string.char(tonumber(hex, 16)) end))
end
function Companion.new(env)
    assert(type(env.directory) == 'string' and type(env.quote) == 'function')
    local pending, current, sequence = nil, nil, 0
    local self = {}
    local prefix = env.directory .. '/.fanservice-companion'
    local function removeRequest(job)
        local value = read(prefix .. '.request', 65536)
        if value and value == job.packet then os.remove(prefix .. '.request') end
    end
    function self:cancel(reason)
        if pending then
            local job = pending; pending = nil
            removeRequest(job)
            job.reply('{"ok":false,"error":' .. env.quote(reason or 'Native context changed.') .. '}')
        end
    end
    function self:update(profileJSON, catalogJSON, generation, epoch)
        local identity = profileJSON .. ':' .. tostring(generation) .. ':' .. epoch
        if current and current.identity ~= identity then self:cancel('Native profile or menu changed. Stale work was discarded.') end
        current = {identity=identity,generation=generation,epoch=epoch}
        publish(prefix .. '.state', profileJSON:sub(1,-2) .. ',"protocol":1,"generation":'
            .. tostring(generation) .. ',"epoch":' .. env.quote(epoch) .. ',"updated_at":'
            .. tostring(os.time()) .. ',"native_catalog":' .. catalogJSON .. ',"stopped_music":' .. (env.stoppedMusic and env.stoppedMusic() or '[]') .. '}')
        if not pending then return end
        local job = pending
        local target = prefix .. '.response.' .. job.nonce
        local response = read(target, 4 * 1024 * 1024)
        if response then
            local nonce, version, result = response:match('^FANSERVICE_COMPANION_1\n([%d%-]+)\n(%d+)\n(.*)$')
            if nonce ~= job.nonce or tonumber(version) ~= current.generation then
                error('Foreign native companion response was retained.')
            end
            pending = nil
            os.remove(target); removeRequest(job)
            if job.action == 'musicprepare' and result:match('^%{"ok":true[,}]') then
                local ok, problem = pcall(function()
                    local commandPath = env.directory .. '/.fanservice-music-command.' .. job.nonce
                    local command = read(commandPath, 4 * 1024 * 1024)
                    if not command then error('Native soundtrack command is missing. Preparation did not activate playback.') end
                    local token, revision, owner, location, duration, map = command:match('^FANSERVICE_MUSIC_2\n([%d%-]+)\n(%d+)\n([%d%-]+)\n([^\n]+)\n([%d%.eE%+%-]+)\n(.*)$')
                    if token ~= job.nonce or tonumber(revision) ~= current.generation or owner ~= current.epoch then
                        error('Stale native soundtrack command was retained.')
                    end
                    duration = tonumber(duration)
                    if not duration or duration ~= duration or duration <= 0 or duration > 86400 then error('Native soundtrack recording duration is invalid.') end
                    local activated, failure = pcall(env.openMusic, Companion.decode(location), map, token, duration)
                    os.remove(commandPath)
                    if not activated then error(failure) end
                end)
                if not ok then result = '{"ok":false,"error":' .. env.quote(tostring(problem)) .. '}' end
            end
            job.reply(result)
        elseif os.time() > job.deadline then
            self:cancel('Native companion request timed out. Review its status before retrying.')
        end
    end
    function self:request(action, encoded, reply)
        if not actions[action] then error('Unsupported native companion action.') end
        if not current then error('Native companion profile is not ready.') end
        local helper = read(prefix .. '.host.lock',32)
        if not helper or #helper ~= 32 or not helper:match('^[a-f0-9]+$') or read(prefix .. '.ready',32) ~= helper then error('Start Start-FanserviceNative.cmd and wait for exact-build verification before using native companion controls.') end
        if pending or read(prefix .. '.request',65536) then error('Native companion is busy; wait for its current operation.') end
        local payload = Companion.decode(encoded)
        if #payload == 0 or #payload > 60000 or payload:sub(1,1) ~= '{' then error('Invalid native companion payload.') end
        sequence = sequence + 1
        local nonce = current.epoch .. '-' .. tostring(current.generation) .. '-' .. tostring(sequence)
        local packet = 'FANSERVICE_COMPANION_1\n' .. nonce .. '\n' .. tostring(current.generation)
            .. '\n' .. current.epoch .. '\n' .. action .. '\n' .. payload
        local temporary = prefix .. '.request.tmp.' .. nonce
        local file = assert(io.open(temporary,'wb'));assert(file:write(packet));assert(file:close())
        local renamed, problem = os.rename(temporary,prefix .. '.request')
        if not renamed then os.remove(temporary);error(problem) end
        pending = {nonce=nonce,packet=packet,action=action,reply=reply,deadline=os.time()+600}
    end
    return self
end
return Companion
