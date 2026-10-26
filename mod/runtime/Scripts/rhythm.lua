local Rhythm = {}
local fields = {'AbsoluteFireTime','TargetHitTime','PatternIndex','Interval','BeatNumber','CustomMultiplier'}
local fieldSet = {}
for _,name in ipairs(fields) do fieldSet[name] = true end
local delegates = {'OnBeatFired','OnBeatHitCenter','OnSequenceEnd','OnSequencePaused','OnBeatSpeedChanged'}
local maximum = 1000000
local function finite(value) return type(value) == 'number' and value == value and value > -math.huge and value < math.huge end
local function integer(value, minimum) return finite(value) and value % 1 == 0 and value >= minimum and value <= 2147483647 end
local function valid(value)
    local ok,result = pcall(function() return value ~= nil and value:IsValid() end)
    return ok and result == true
end
local function plain(value) return type(value) == 'table' and getmetatable(value) == nil end
local function event(row, previous)
    if not plain(row) then error('Native beat entries must be complete plain numeric tables.') end
    for key in pairs(row) do if not fieldSet[key] then error('Native beat entry contains an unknown field.') end end
    local result = {}
    for _,key in ipairs(fields) do
        local value = rawget(row,key)
        if not finite(value) then error('Native beat entry requires finite ' .. key .. '.') end
        result[key] = value
    end
    if result.AbsoluteFireTime < 0 or result.TargetHitTime < result.AbsoluteFireTime or result.Interval <= 0
        or not integer(result.PatternIndex,0) or not integer(result.BeatNumber,1)
        or math.abs(result.CustomMultiplier) > 3.4028234663852886e38 then error('Native beat entry is outside its numeric contract.') end
    if previous and (result.AbsoluteFireTime < previous.AbsoluteFireTime or result.TargetHitTime < previous.TargetHitTime
        or result.BeatNumber <= previous.BeatNumber) then error('Native beat entries must retain chronological and beat-number order.') end
    return result
end
local function same(row, expected)
    for _,key in ipairs(fields) do
        local actual,wanted = row[key],expected[key]
        local tolerance = key == 'CustomMultiplier' and math.max(0.0000001,math.abs(wanted)*0.0000002)
            or (key == 'PatternIndex' or key == 'BeatNumber') and 0 or math.max(0.000000001,math.abs(wanted)*0.000000000001)
        if not finite(actual) or math.abs(actual-wanted) > tolerance then error('Native beat queue failed readback for ' .. key .. '.') end
    end
end
function Rhythm.validateEvents(rows)
    if not plain(rows) then error('Native beat queue requires a plain contiguous array.') end
    local count = #rows
    if count > maximum then error('Native beat queue exceeds 1000000 events.') end
    for key in pairs(rows) do
        if type(key) ~= 'number' or key % 1 ~= 0 or key < 1 or key > count then error('Native beat queue requires contiguous indexes starting at 1.') end
    end
    local result = {}
    for index=1,count do
        if rawget(rows,index) == nil then error('Native beat queue requires contiguous indexes starting at 1.') end
        result[index] = event(rows[index],result[index-1])
    end
    return result
end
function Rhythm.new(env)
    if type(env) ~= 'table' or type(env.find) ~= 'function' or type(env.spawn) ~= 'function' or not valid(env.outer) then
        error('Native beat queue requires a controlled object factory and valid outer.')
    end
    local class = env.find('/Script/CockHero.BeatSpawnerManager')
    if not valid(class) then error('Exact native beat manager class is unavailable.') end
    local manager = env.spawn(class,env.outer)
    if not valid(manager) or manager:GetAddress() == env.outer:GetAddress() then error('Native beat factory did not return a fresh manager.') end
    local address,classAddress = manager:GetAddress(),class:GetAddress()
    local closed = false
    local expected = {}
    local function stopped()
        if closed then error('Owned native beat queue is closed.') end
        if not valid(manager) or manager:GetAddress() ~= address or not valid(manager:GetClass()) or manager:GetClass():GetAddress() ~= classAddress then
            error('Owned native beat manager identity is unavailable.')
        end
        if manager:IsSequenceRunning() ~= false then error('Owned native beat queue must remain stopped.') end
        for _,name in ipairs(delegates) do
            local bindings = manager[name]:GetBindings()
            if bindings ~= nil and (type(bindings) ~= 'table' or next(bindings) ~= nil) then error('Owned native beat queue has bound delegates.') end
        end
    end
    stopped()
    if #manager.BeatQueue ~= 0 then error('Fresh native beat manager has a nonempty queue.') end
    local self = {}
    function self:append(row)
        local copy = event(row,expected[#expected])
        if #expected >= maximum then error('Native beat queue exceeds 1000000 events.') end
        stopped()
        local queue = manager.BeatQueue
        if #queue ~= #expected then error('Owned native beat queue changed unexpectedly.') end
        local index = #expected + 1
        queue[index] = copy
        if #queue ~= index then error('Native beat queue append failed its length check.') end
        local read = {}
        local value = manager.BeatQueue[index]
        for _,key in ipairs(fields) do read[key] = value[key] end
        same(read,copy)
        expected[index] = copy
        return index
    end
    function self:readAll()
        stopped()
        local queue = manager.BeatQueue
        local count = #queue
        if count ~= #expected then error('Owned native beat queue changed unexpectedly.') end
        local result = {}
        for index=1,count do
            local row,value = {},manager.BeatQueue[index]
            for _,key in ipairs(fields) do row[key] = value[key] end
            same(row,expected[index])
            result[index] = row
        end
        return result
    end
    function self:setStoppedClock(seconds)
        if not finite(seconds) or seconds < 0 then error('Owned native beat clock requires finite nonnegative seconds.') end
        stopped()
        manager.TimelineOffset = seconds
        local actual = manager:GetMasterTimelinePosition()
        if not finite(actual) or math.abs(actual-seconds) > 0.000000001 then error('Stopped native beat clock failed readback.') end
        return actual
    end
    function self:close()
        if closed then return true end
        stopped()
        manager.BeatQueue:Empty()
        if #manager.BeatQueue ~= 0 then error('Owned native beat queue cleanup failed.') end
        expected = {}
        closed = true
        manager = nil
        return true
    end
    return self
end
function Rhythm.probe(env)
    local queue = Rhythm.new(env)
    local ok,result = pcall(function()
        local first = {AbsoluteFireTime=0.25,TargetHitTime=1.25,PatternIndex=0,Interval=0.5,BeatNumber=1,CustomMultiplier=1}
        local second = {AbsoluteFireTime=0.75,TargetHitTime=1.75,PatternIndex=1,Interval=0.25,BeatNumber=2,CustomMultiplier=-1}
        local third = {AbsoluteFireTime=1.0,TargetHitTime=2.0,PatternIndex=0,Interval=0.5,BeatNumber=3,CustomMultiplier=0.75}
        queue:append(first);queue:append(second)
        local before = queue:readAll()
        queue:append(third)
        local after = queue:readAll()
        same(before[1],after[1]);same(before[2],after[2])
        return {count=#after,roundtrip=true,append_retained=true,stopped_clock=queue:setStoppedClock(2.5),
            scope='separately constructed stopped native POD queue and clock; no gameplay, widgets, callbacks or progression'}
    end)
    local cleaned,problem = pcall(function() return queue:close() end)
    if not ok then error(tostring(result) .. (cleaned and '' or '; cleanup: ' .. tostring(problem))) end
    if not cleaned then error(problem) end
    result.cleaned = true
    return result
end
return Rhythm
