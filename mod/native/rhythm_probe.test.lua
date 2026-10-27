local Probe = assert(loadfile('mod/runtime/Scripts/rhythm_probe.lua'))()
local passed=0
local function eq(actual,expected) assert(actual==expected,tostring(actual)..' ~= '..tostring(expected)) end
local function test(name,run) run();passed=passed+1;print('PASS '..name) end
local function contains(value,text) assert(type(value)=='string' and value:find(text,1,true),tostring(value)) end
local function object(address,class,outer)
    local result={address=address,valid=true,class=class,outer=outer}
    function result:IsValid() return self.valid end
    function result:GetAddress() return self.address end
    function result:GetClass() return self.class end
    function result:GetOuter() return self.outer end
    function result:IsA(name) return self.className==name end
    return result
end
local function fixture(options)
    options=options or {}
    local f={clock=0,wall=0,binding='profile:1',created=0,releases=0,removed=0,foreignWrites=0,foreignRemoved=0,rooted=false,failRelease=false,widgets={}}
    local managerClass,widgetClass,imageClass=object(11),object(12),object(13)
    local world=object(20);world.className='/Script/Engine.World';f.world=world
    local instance=object(30);function instance:GetWorld() return f.world end
    local manager=object(40,managerClass,instance);f.manager=manager;f.instance=instance
    manager.bIsRunning=false;manager.MasterTimeReference=0;manager.TimelineOffset=0
    manager.TotalStrokes=0;manager.CompletedBeats=0;manager.CurrentBeatIndex=0
    local queue={};function queue:Empty() for key in pairs(self) do if type(key)=='number' then self[key]=nil end end end
    manager.BeatQueue=queue
    function manager:GetWorld() return self.CachedWorld end
    function manager:SetWorld(value) self.CachedWorld=value end
    function manager:IsSequenceRunning() return self.bIsRunning end
    function manager:GetMasterTimelinePosition() return self.bIsRunning and f.clock-self.MasterTimeReference+self.TimelineOffset or self.TimelineOffset end
    function manager:ResumeSequence() if not self.bIsRunning and #self.BeatQueue>0 then self.bIsRunning=true;self.MasterTimeReference=f.clock end end
    local foreignBacking=object(999,widgetClass,instance);foreignBacking.bIsMoving=true
    function foreignBacking:RemoveFromParent() f.foreignRemoved=f.foreignRemoved+1 end
    f.foreign=setmetatable({}, {__index=foreignBacking,__newindex=function(_,key,value) f.foreignWrites=f.foreignWrites+1;foreignBacking[key]=value end})
    function manager:CreateTestBeatWidget(event)
        if options.noWidget then return end
        local widget=object(50+#f.widgets,widgetClass,instance);f.widget=widget;f.widgets[#f.widgets+1]=widget
        widget.bIsMoving=true;widget.MasterTimeReference=self.MasterTimeReference;widget.TimelineOffset=self.TimelineOffset
        widget.CurrentBeatEvent={};for key,value in pairs(event) do widget.CurrentBeatEvent[key]=value end
        widget.inViewport=true
        function widget:SetDesiredSizeInViewport(value) self.width=value.X;self.height=value.Y end
        function widget:RemoveFromParent() self.inViewport=false;f.removed=f.removed+1 end
        function widget:IsInViewport() return self.inViewport end
    end
    local env={}
    function env.createRoot(owner) eq(owner,instance);f.created=f.created+1;f.rooted=true;return 'lease-1',manager.address end
    function env.releaseRoot(token)
        eq(token,'lease-1');f.releases=f.releases+1
        if f.failRelease then return false end
        assert(not manager.bIsRunning and #queue==0,'Root released while manager was active')
        f.rooted=false;return true
    end
    function env.managers() return {object(998),manager} end
    function env.widgets() local values={f.foreign};for _,widget in ipairs(f.widgets) do values[#values+1]=widget end;return values end
    function env.find(path)
        return ({['/Script/CockHero.BeatSpawnerManager']=managerClass,['/Script/CockHero.PreciseBeatWidget']=widgetClass,['/Script/UMG.Image']=imageClass})[path]
    end
    function env.spawnImage(widget)
        if options.badImage then return object(60,imageClass,instance) end
        local image=object(60,imageClass,widget);f.image=image;return image
    end
    function env.instance() return instance end
    function env.binding() return f.binding end
    function env.now() return f.wall end
    function env.bindings(value,name)
        if value==manager then return f.foreignManagerBinding and {{address=998,function_name='Foreign'}} or {} end
        if value.class==widgetClass and value~=f.foreign then
            eq(name,'OnBeatReachedCenter')
            if f.retiredWidget then return {} end
            local result={{address=manager.address,function_name='OnBeatReachedCenter'}}
            if f.shared then result[2]={address=998,function_name='Foreign'} end
            return result
        end
        return {{address=998,function_name='OnBeatReachedCenter'}}
    end
    if options.audio then
        f.audio={state='playing',position=0}
        function f.audio:status() return {state=self.state,position=self.position} end
        function f.audio:pause() self.state='paused' end
        function f.audio:resume() self.state='playing' end
        function f.audio:seek(position) self.position=position;self.state='paused' end
        function f.audio:reconnect() self.state='playing' end
        env.audio=f.audio;env.reconcile=options.reconcile
    end
    f.env=env;f.probe=Probe.new(env)
    function f:advance(seconds)
        self.clock=self.clock+seconds;self.wall=self.wall+seconds
        if self.audio and self.audio.state=='playing' then self.audio.position=self.audio.position+seconds end
        if manager.bIsRunning and manager.CurrentBeatIndex==1 and manager:GetMasterTimelinePosition()>=20 then manager.CurrentBeatIndex=2 end
        if not options.noTick and self.widget and self.widget.bIsMoving and self.widget.BeatIcon then
            local position=self.clock-self.widget.MasterTimeReference+self.widget.TimelineOffset
            if position>=self.widget.CurrentBeatEvent.TargetHitTime then
                self.widget.bIsMoving=false
                if manager.bIsRunning then manager.CompletedBeats=manager.CompletedBeats+1 end
            end
        end
        return self.probe:step()
    end
    function f:pauseAndResume()
        eq(self.probe:start().phase,'running')
        eq(self:advance(.5).phase,'paused')
        local widgetClock=self.clock-self.widget.MasterTimeReference+self.widget.TimelineOffset
        local result=self:advance(2.1);eq(result.phase,'running')
        local resumedClock=self.clock-self.widget.MasterTimeReference+self.widget.TimelineOffset
        assert(math.abs(widgetClock-resumedClock)<.000001,'Widget clock was not rebased at resume')
        return result
    end
    return f
end

test('owned native pause/resume preserves clocks and delivers one completion before cleanup',function()
    local f=fixture();local result=f:pauseAndResume()
    eq(result.resumed_position,.5);eq(f.manager.CompletedBeats,0);eq(f.widget.width,64);eq(f.widget.height,64)
    eq(f:advance(2.75).phase,'observing');eq(f.manager.CompletedBeats,1)
    result=f:advance(1.1);eq(result.phase,'complete');eq(result.passed,true);eq(result.root_released,true)
    eq(f.created,1);eq(f.releases,1);eq(f.rooted,false);eq(f.removed,1);eq(#f.manager.BeatQueue,0)
    eq(f.foreignWrites,0);eq(f.foreignRemoved,0);eq(f.foreign.bIsMoving,true)
    eq(f.probe:step().phase,'complete');eq(f.releases,1)
end)
test('paused wall time cannot complete the widget or consume a future event',function()
    local f=fixture();f.probe:start();eq(f:advance(.5).phase,'paused')
    local result=f:advance(1.9);eq(result.phase,'paused');eq(result.position,.5)
    eq(f.manager.CompletedBeats,0);eq(f.manager.CurrentBeatIndex,1);eq(f.widget.bIsMoving,false)
    f.probe:stop('test cleanup');eq(f.rooted,false);eq(f.foreignWrites,0)
end)
test('profile change cancels only owned resources without settling or clearing foreign objects',function()
    local f=fixture();f.probe:start();f:advance(.5);f.binding='profile:2'
    local result=f.probe:step();eq(result.phase,'failed');eq(result.passed,false);contains(result.error,'binding changed')
    eq(result.root_released,true);eq(f.rooted,false);eq(f.removed,1);eq(f.foreignWrites,0);eq(f.foreignRemoved,0)
end)
test('world change cannot continue a stale owned clock',function()
    local f=fixture();f.probe:start();f.world=object(21);f.world.className='/Script/Engine.World'
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'active world changed');eq(f.rooted,false)
end)
test('duplicate native completion fails instead of passing once-only delivery',function()
    local f=fixture();f:pauseAndResume();f.manager.CompletedBeats=2
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'duplicate completion');eq(f.rooted,false)
end)
test('a bare widget with no actual native ticking reaches the deadline and releases its root',function()
    local f=fixture({noTick=true});f:pauseAndResume()
    local result=f:advance(13);eq(result.phase,'failed');contains(result.error,'timed out');eq(result.root_released,true)
    eq(f.manager.CompletedBeats,0);eq(f.foreignWrites,0)
end)
test('a shared widget is retained and foreign callbacks are never removed or cleared',function()
    local f=fixture();f.probe:start();f.shared=true
    local result=f:advance(.5);eq(result.phase,'failed');contains(result.error,'shared or changed ownership')
    contains(result.cleanup_error,'shared or changed ownership');eq(result.root_released,false);eq(f.rooted,true)
    eq(f.removed,0);eq(f.foreignWrites,0);eq(#f.env.bindings(f.widget,'OnBeatReachedCenter'),2)
end)
test('an unknown manager callback prevents destructive cleanup of shared state',function()
    local f=fixture();f.probe:start();f.foreignManagerBinding=true
    local result=f.probe:step();eq(result.phase,'failed');contains(result.cleanup_error,'foreign delegates')
    eq(f.rooted,true);eq(f.releases,0);eq(#f.manager.BeatQueue,2)
end)
test('a modified owned queue is retained rather than clearing unrecognized entries',function()
    local f=fixture();f.probe:start();f.manager.BeatQueue[2].Interval=9
    local result=f.probe:step();eq(result.phase,'failed');contains(result.cleanup_error,'queue contents changed')
    eq(f.manager.BeatQueue[2].Interval,9);eq(f.releases,0)
end)
test('failed image setup retires the new owned widget and releases the fresh root',function()
    local f=fixture({badImage=true});local result=f.probe:start()
    eq(result.phase,'failed');contains(result.error,'foreign image');eq(result.root_released,true)
    eq(f.removed,1);eq(f.foreignWrites,0)
end)
test('root release refusal is explicit and a later stop can retry only that lease',function()
    local f=fixture();f.probe:start();f.failRelease=true
    local result=f.probe:stop('cancel');eq(result.phase,'failed');contains(result.cleanup_error,'release was refused')
    eq(f.rooted,true);eq(f.manager.bIsRunning,false);eq(#f.manager.BeatQueue,0)
    f.failRelease=false;result=f.probe:stop('retry lease release');eq(result.phase,'stopped');eq(f.rooted,false);eq(f.releases,2)
end)
test('a backwards wall clock aborts without relying on an unbounded timeout',function()
    local f=fixture();f.probe:start();f.wall=-1
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'moved backwards');eq(f.rooted,false)
end)
test('status is copied and a completed probe cannot be reused',function()
    local f=fixture();f.probe:start();local status=f.probe:status();status.phase='complete'
    eq(f.probe:status().phase,'running');local ok=pcall(function() f.probe:start() end);eq(ok,false)
    f.probe:stop('cancel');eq(f.rooted,false)
end)
test('an already retired unbound widget requires no new writes during root cleanup',function()
    local f=fixture();f:pauseAndResume();eq(f:advance(2.75).phase,'observing')
    f.retiredWidget=true;f.widget.inViewport=false
    local result=f:advance(1.1);eq(result.phase,'complete');eq(result.passed,true);eq(f.rooted,false);eq(f.removed,0)
end)
test('a fresh factory object with an unexpected queue is never cleared or adopted',function()
    local f=fixture();f.manager.BeatQueue[1]={foreign=true}
    local result=f.probe:start();eq(result.phase,'failed');contains(result.cleanup_error,'unknown entries')
    eq(f.manager.BeatQueue[1].foreign,true);eq(f.releases,0);eq(f.rooted,true)
end)
test('owned decoder clock drives native manager through pause and once-only completion',function()
    local f=fixture({audio=true});f:pauseAndResume()
    eq(f.audio.state,'playing');eq(f.audio.position,.5)
    eq(f:advance(2.75).phase,'observing')
    local result=f:advance(1.1);eq(result.phase,'complete');eq(result.passed,true);eq(result.root_released,true)
    eq(result.clock_source,'native audio decoder');assert(result.max_clock_error<=.05);eq(f.foreignWrites,0)
end)
test('asynchronous decoder resume remains bounded and frozen until acknowledgement',function()
    local f=fixture({audio=true});f.probe:start();f:advance(.5)
    function f.audio:resume() self.requested=true end
    local result=f:advance(2.1);eq(result.phase,'resuming_audio');eq(f.audio.requested,true);eq(f.widget.bIsMoving,false)
    result=f:advance(.1);eq(result.phase,'resuming_audio');eq(f.manager.CompletedBeats,0)
    f.audio.state='playing';result=f:advance(.05);assert(result.phase=='running',result.error or result.phase);assert(result.resumed_position>=.5)
    f.probe:stop('test complete');eq(f.rooted,false)
end)
test('decoder failure stops only owned rhythm resources',function()
    local f=fixture({audio=true});f.probe:start();f.audio.state='error'
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'audio clock became unavailable');eq(f.rooted,false);eq(f.foreignWrites,0)
end)
test('unexpected forward decoder seek fails instead of awarding a skipped beat',function()
    local f=fixture({audio=true});f:pauseAndResume();f.audio.position=2.5
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'jumped without seek reconciliation');eq(f.rooted,false);eq(f.manager.CompletedBeats,0)
end)
test('decoder discontinuity fails before an unreconciled backwards seek',function()
    local f=fixture({audio=true});f:pauseAndResume();f.audio.position=0
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'moved backwards');eq(f.rooted,false)
end)
test('owned seek retires the old widget, reconnects, and backward replay cannot award twice',function()
    local f=fixture({audio=true,reconcile=true});eq(f.probe:start().phase,'running')
    local result
    for index=1,500 do
        result=f:advance(.05)
        if result.phase=='failed' then error(result.error..' / '..tostring(result.cleanup_error)) end
        if result.phase=='complete' then break end
    end
    eq(result.phase,'complete');eq(result.passed,true);eq(result.replay_verified,true);eq(result.root_released,true)
    eq(#f.widgets,2);eq(result.retired_widgets,2);eq(f.widgets[1].inViewport,false);eq(f.widgets[1].bIsMoving,false)
    eq(result.completed,1);assert(result.seek_position>=1.25);assert(result.reconnect_position>=2);assert(result.backward_position>=.75)
    eq(f.foreignWrites,0);eq(f.foreignRemoved,0)
end)
test('a failed seek leaves no live owned widget or manager root',function()
    local f=fixture({audio=true,reconcile=true});f.probe:start();f:advance(.5)
    function f.audio:seek() self.state='error' end
    eq(f:advance(2.1).phase,'seeking_forward')
    local result=f:advance(.05);eq(result.phase,'failed');contains(result.error,'decoder failed');eq(result.root_released,true)
    eq(f.widgets[1].inViewport,false);eq(f.foreignWrites,0)
end)
test('stale retired widget activity is detected without removing foreign widgets',function()
    local f=fixture({audio=true,reconcile=true});f.probe:start();f:advance(.5);eq(f:advance(2.1).phase,'seeking_forward')
    f.widgets[1].bIsMoving=true
    local result=f.probe:step();eq(result.phase,'failed');contains(result.error,'became active again')
    eq(f.foreignWrites,0);eq(f.foreignRemoved,0);eq(result.root_released,false)
end)
test('a seek that never acknowledges expires and releases only its own root',function()
    local f=fixture({audio=true,reconcile=true});f.probe:start();f:advance(.5)
    function f.audio:seek() self.state='seeking' end
    eq(f:advance(2.1).phase,'seeking_forward');eq(f:advance(1).phase,'seeking_forward')
    local result=f:advance(38);eq(result.phase,'failed');contains(result.error,'timed out');eq(result.root_released,true);eq(f.foreignWrites,0)
end)
test('reconnect cannot silently accept a different recording position',function()
    local f=fixture({audio=true,reconcile=true});f.probe:start()
    function f.audio:reconnect() self.position=8;self.state='playing' end
    local result
    for i=1,200 do result=f:advance(.05);if result.phase=='failed' then break end end
    eq(result.phase,'failed');contains(result.error,'restore its bound position');eq(result.root_released,true);eq(f.manager.CompletedBeats,0)
end)
print(tostring(passed)..' owned rhythm clock probe tests passed')
