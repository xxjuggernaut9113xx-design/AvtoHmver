local Rhythm = assert(loadfile('mod/runtime/Scripts/rhythm.lua'))()
local passed = 0
local function eq(actual,expected) assert(actual == expected,tostring(actual) .. ' ~= ' .. tostring(expected)) end
local function fails(operation,fragment)
    local ok,problem = pcall(operation)
    assert(not ok and tostring(problem):find(fragment,1,true),'Expected ' .. fragment .. ', got ' .. tostring(problem))
end
local function test(name,operation) operation();passed=passed+1;print('PASS ' .. name) end
local function entry(index)
    return {AbsoluteFireTime=(index-1)*0.5,TargetHitTime=(index-1)*0.5+0.75,PatternIndex=(index-1)%2,Interval=0.5,BeatNumber=index,CustomMultiplier=1}
end
local function fixture()
    local scope={rows={},generation=0,emptyCalls=0,invalidReads=0,spawnCalls=0,forbiddenCalls=0,reads=0,running=false,corrupt=false,round=false}
    local outer={address=101,valid=true,wallet=4}
    function outer:IsValid() return self.valid end
    function outer:GetAddress() return self.address end
    local class={address=102,valid=true,IsValid=outer.IsValid,GetAddress=outer.GetAddress}
    local queue
    local methods={}
    function methods:Empty() scope.rows={};scope.generation=scope.generation+1;scope.emptyCalls=scope.emptyCalls+1 end
    queue=setmetatable({}, {
        __len=function() return #scope.rows end,
        __index=function(_,key)
            if type(key)~='number' then return methods[key] end
            if key<1 or key>#scope.rows then scope.invalidReads=scope.invalidReads+1;error('Out-of-range native array read') end
            local generation=scope.generation
            return setmetatable({}, {__index=function(_,field)
                assert(generation==scope.generation,'Borrowed row survived native reallocation')
                scope.reads=scope.reads+1
                if scope.corrupt and field=='Interval' then return -5 end
                local value=scope.rows[key][field]
                if scope.round and field=='CustomMultiplier' then return value+0.00000001 end
                return value
            end})
        end,
        __newindex=function(_,key,row)
            assert(type(key)=='number' and key==#scope.rows+1,'Sparse native array assignment')
            scope.generation=scope.generation+1
            local copy={};for field,value in pairs(row) do copy[field]=value end
            scope.rows[key]=copy
        end
    })
    local manager={address=103,valid=true,BeatQueue=queue,TimelineOffset=0,IsValid=outer.IsValid,GetAddress=outer.GetAddress}
    function manager:GetClass() return class end
    function manager:IsSequenceRunning() return scope.running end
    function manager:GetMasterTimelinePosition() assert(not scope.running);return self.TimelineOffset end
    for _,name in ipairs({'StopSequence','StartPattern','Tick','CreateTestBeatWidget','OnBeatReachedCenter'}) do
        manager[name]=function() scope.forbiddenCalls=scope.forbiddenCalls+1;error('Forbidden gameplay call') end
    end
    for _,name in ipairs({'OnBeatFired','OnBeatHitCenter','OnSequenceEnd','OnSequencePaused','OnBeatSpeedChanged'}) do
        manager[name]={bindings={}}
        manager[name].GetBindings=function(self) return self.bindings end
    end
    local env={outer=outer,find=function(name) eq(name,'/Script/CockHero.BeatSpawnerManager');return class end,
        spawn=function(actual,owner) scope.spawnCalls=scope.spawnCalls+1;eq(actual,class);eq(owner,outer);return manager end}
    return {scope=scope,outer=outer,class=class,manager=manager,env=env,queue=queue}
end

test('fixed probe constructs only its stopped manager, verifies POD rows and empties only its own queue',function()
    local f=fixture();local result=Rhythm.probe(f.env)
    eq(result.count,3);eq(result.roundtrip,true);eq(result.append_retained,true);eq(result.stopped_clock,2.5);eq(result.cleaned,true)
    eq(f.scope.spawnCalls,1);eq(f.scope.emptyCalls,1);eq(f.scope.invalidReads,0);eq(f.scope.forbiddenCalls,0);eq(#f.scope.rows,0);eq(f.outer.wallet,4)
end)

test('append reads complete numeric rows again after every simulated native reallocation',function()
    local f=fixture();local owned=Rhythm.new(f.env)
    for i=1,8 do eq(owned:append(entry(i)),i) end
    local rows=owned:readAll();eq(#rows,8);eq(rows[1].BeatNumber,1);eq(rows[8].BeatNumber,8);eq(f.scope.invalidReads,0)
    owned:close();eq(f.scope.forbiddenCalls,0)
end)

test('event validation rejects sparse, zero-based, noninteger and named outer indexes',function()
    for _,rows in ipairs({{[2]=entry(2)},{[0]=entry(1)},{[1.5]=entry(1)},{entry(1),unexpected=entry(2)}}) do
        fails(function() Rhythm.validateEvents(rows) end,'contiguous')
    end
end)

test('event validation copies ordinary contiguous input without retaining caller aliases',function()
    local original={entry(1),entry(2)};local rows=Rhythm.validateEvents(original)
    original[1].Interval=99;eq(rows[1].Interval,.5)
end)

test('invalid or partial numeric entries are rejected before queue mutation',function()
    local f=fixture();local owned=Rhythm.new(f.env)
    for _,alter in ipairs({function(row) row.Interval=nil end,function(row) row.TargetHitTime=0/0 end,
        function(row) row.PatternIndex=.5 end,function(row) row.BeatNumber=2147483648 end,
        function(row) row.CustomMultiplier=math.huge end,function(row) row.Other=1 end}) do
        local row=entry(1);alter(row);fails(function() owned:append(row) end,'Native beat entry')
    end
    eq(#f.scope.rows,0);eq(f.scope.emptyCalls,0);owned:close()
end)

test('queue order is checked before native writes',function()
    local f=fixture();local owned=Rhythm.new(f.env);owned:append(entry(2))
    fails(function() owned:append(entry(1)) end,'chronological');eq(#f.scope.rows,1);owned:close()
end)

test('a running manager is refused without clearing or stopping it',function()
    local f=fixture();f.scope.running=true;fails(function() Rhythm.new(f.env) end,'remain stopped')
    eq(f.scope.emptyCalls,0);eq(f.scope.forbiddenCalls,0)
end)

test('any bound delegate or preexisting queue causes constructor refusal without mutation',function()
    for _,name in ipairs({'OnBeatHitCenter','OnSequenceEnd','OnBeatFired','OnSequencePaused','OnBeatSpeedChanged'}) do
        local f=fixture();f.manager[name].bindings={{Object=f.outer,FunctionName='OriginalCallback'}}
        fails(function() Rhythm.new(f.env) end,'bound delegates');eq(f.scope.emptyCalls,0);eq(f.scope.forbiddenCalls,0)
    end
    local f=fixture();f.scope.rows={entry(1)};fails(function() Rhythm.new(f.env) end,'nonempty queue');eq(f.scope.emptyCalls,0)
end)

test('newly bound delegates reject further writes and cleanup rather than changing foreign state',function()
    local f=fixture();local owned=Rhythm.new(f.env);owned:append(entry(1));f.manager.OnSequenceEnd.bindings={{Object=f.outer}}
    fails(function() owned:append(entry(2)) end,'bound delegates');fails(function() owned:close() end,'bound delegates')
    eq(#f.scope.rows,1);eq(f.scope.emptyCalls,0);eq(f.scope.forbiddenCalls,0)
end)

test('unexpected array edits are rejected before read or append',function()
    local f=fixture();local owned=Rhythm.new(f.env);f.scope.rows={entry(1)}
    fails(function() owned:append(entry(2)) end,'changed unexpectedly');fails(function() owned:readAll() end,'changed unexpectedly')
end)

test('native float rounding is accepted but corrupted readback closes the probe with cleanup',function()
    local f=fixture();f.scope.round=true;eq(Rhythm.probe(f.env).roundtrip,true)
    f=fixture();f.scope.corrupt=true;fails(function() Rhythm.probe(f.env) end,'failed readback')
    eq(f.scope.emptyCalls,1);eq(#f.scope.rows,0);eq(f.scope.forbiddenCalls,0)
end)

test('stopped clock validates native readback and cleanup is idempotent',function()
    local f=fixture();local owned=Rhythm.new(f.env);eq(owned:setStoppedClock(2.5),2.5)
    fails(function() owned:setStoppedClock(-1) end,'nonnegative');owned:close();owned:close();eq(f.scope.emptyCalls,1)
    fails(function() owned:readAll() end,'closed')
end)
print(tostring(passed) .. ' native POD rhythm queue tests passed')
