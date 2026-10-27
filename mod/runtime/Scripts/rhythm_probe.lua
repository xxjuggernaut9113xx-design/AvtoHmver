local Probe = {}
local eventFields = {'AbsoluteFireTime','TargetHitTime','PatternIndex','Interval','BeatNumber','CustomMultiplier'}
local delegateNames = {'OnBeatSpeedChanged','OnSequencePaused','OnBeatFired','OnBeatHitCenter','OnSequenceEnd'}
local rows = {
    {AbsoluteFireTime=0.2,TargetHitTime=3.2,PatternIndex=0,Interval=0.5,BeatNumber=1,CustomMultiplier=1},
    {AbsoluteFireTime=20,TargetHitTime=23,PatternIndex=0,Interval=0.5,BeatNumber=2,CustomMultiplier=1}
}
local function finite(value) return type(value)=='number' and value==value and value>-math.huge and value<math.huge end
local function valid(object)
    local ok,value=pcall(function() return object~=nil and object:IsValid() end)
    return ok and value==true
end
local function address(object) return valid(object) and object:GetAddress() or nil end
local function check(condition,message) if not condition then error(message,0) end end
local function copy(value) local result={};for key,item in pairs(value) do result[key]=item end;return result end
local function near(actual,expected) return finite(actual) and math.abs(actual-expected)<=0.000001 end

function Probe.new(env)
    for _,name in ipairs({'createRoot','releaseRoot','managers','widgets','find','spawnImage','instance','binding','bindings','now'}) do
        assert(type(env[name])=='function','Missing owned rhythm probe dependency: '..name)
    end
    local report={phase='idle',passed=false,started=false,completed=0,index=0,position=0,paused_position=0,resumed_position=0,root_released=false}
    local scope
    local audio=env.audio
    local finalize=env.finalize==true
    local rows=finalize and {rows[1]} or rows
    if finalize then assert(audio and type(env.worldTime)=='function' and type(env.guardStatus)=='function','Owned finalization requires native audio, world time and guarded hit evidence.') end
    local reconcile=env.reconcile==true
    if reconcile then assert(audio and type(audio.seek)=='function' and type(audio.reconnect)=='function','Owned reconciliation requires seek and reconnect operations.') end
    if audio then for _,name in ipairs({'status','pause','resume'}) do assert(type(audio[name])=='function','Missing owned audio clock operation: '..name) end end
    local self={}
    if env.setClock then assert(audio and type(env.guardStatus)=='function','Owned decoder gating requires audio and guarded hit evidence.') end
    local function feedClock(position,playing)
        if env.setClock then check(env.setClock(scope.token,position,playing)==true,'Owned decoder clock gate update was refused.') end
    end
    local function wall()
        local value=env.now()
        check(finite(value),'Owned rhythm probe wall clock is invalid.')
        if scope then
            check(not scope.lastWall or value>=scope.lastWall,'Owned rhythm probe wall clock moved backwards.')
            scope.lastWall=value
        end
        return value
    end
    local function sameObject(object,expected) return expected~=nil and address(object)==expected end
    local function managerIdentity()
        check(scope and sameObject(scope.manager,scope.managerAddress),'Owned rhythm manager identity was lost.')
        local manager=scope.manager
        check(sameObject(manager:GetClass(),scope.managerClassAddress),'Owned rhythm manager class changed.')
        check(sameObject(manager:GetOuter(),scope.instanceAddress),'Owned rhythm manager outer changed.')
        if scope.worldReady then check(sameObject(manager:GetWorld(),scope.worldAddress),'Owned rhythm manager world changed.') end
        return manager
    end
    local function unbound(manager)
        for _,name in ipairs(delegateNames) do
            local bindings=env.bindings(manager,name)
            check(type(bindings)=='table' and next(bindings)==nil,'Owned rhythm manager acquired foreign delegates.')
        end
    end
    local function queueMatches(manager,count)
        count=count or #rows
        check(#manager.BeatQueue==count,'Owned rhythm queue length changed.')
        for index=1,count do
            local expected=rows[index]
            local row=manager.BeatQueue[index]
            for _,name in ipairs(eventFields) do check(near(row[name],expected[name]),'Owned rhythm queue contents changed.') end
        end
    end
    local function widgetOwnership(widget)
        if not valid(widget) then return false,false end
        local ok,bindings=pcall(env.bindings,widget,'OnBeatReachedCenter')
        if not ok or type(bindings)~='table' then return false,false end
        local ours=false
        for _,binding in pairs(bindings) do
            if binding.address==scope.managerAddress and binding.function_name=='OnBeatReachedCenter' then ours=true end
        end
        if not ours then return false,false end
        check(#bindings==1 and sameObject(widget:GetClass(),scope.widgetClassAddress),'Owned rhythm widget has shared or changed ownership.')
        return true,true
    end
    local function discover()
        local candidates=env.widgets() or {}
        check(#candidates<=10000,'Owned rhythm widget enumeration exceeds its limit.')
        local found={}
        for _,widget in ipairs(candidates) do
            local ours=widgetOwnership(widget)
            if scope.retired and scope.retired[address(widget)] then
                check(not widget.bIsMoving and not widget:IsInViewport(),'Retired owned rhythm widget became active again.')
            elseif ours then found[#found+1]=widget end
        end
        check(#found<=1,'Owned rhythm probe created unexpected duplicate widgets.')
        return found
    end
    local function createWidget(manager)
            manager:CreateTestBeatWidget(copy(rows[1]))
            local widgets=discover();check(#widgets==1,'Fresh bare native beat widget was not identified.')
            local widget=widgets[1];scope.widget=widget;scope.widgetAddress=address(widget)
            local image=env.spawnImage(widget)
            check(valid(image) and sameObject(image:GetClass(),scope.imageClassAddress) and sameObject(image:GetOuter(),scope.widgetAddress),'Rhythm image factory returned a foreign image.')
            widget.BeatIcon=image
            check(sameObject(widget.BeatIcon,address(image)),'Owned rhythm image assignment failed.')
            widget:SetDesiredSizeInViewport({X=64,Y=64})
            check(widget.bIsMoving==true,'Bare native rhythm widget did not start moving.')
    end
    local function stopOwned(reason)
        if not scope then return true end
        if scope.released then return true end
        if scope.token==nil then return true end
        if not scope.manager then
            check(env.releaseRoot(scope.token)==true,'Fresh owned rhythm root could not be released.')
            scope.released=true;report.root_released=true
            return true
        end
        local manager=managerIdentity()
        unbound(manager)
        if scope.queueEmptied then check(#manager.BeatQueue==0,'Released rhythm queue acquired unknown entries.')
        elseif scope.expectedCount~=nil then queueMatches(manager,scope.expectedCount)
        else check(#manager.BeatQueue==0,'Uninitialized rhythm queue contains unknown entries.') end
        local widgets=discover()
        if scope.widget and valid(scope.widget) then
            if widgetOwnership(scope.widget) then
                local present=false;for _,widget in ipairs(widgets) do if address(widget)==scope.widgetAddress then present=true end end
                if not present then widgets[#widgets+1]=scope.widget end
            else
                local remaining=env.bindings(scope.widget,'OnBeatReachedCenter')
                check(sameObject(scope.widget:GetClass(),scope.widgetClassAddress) and next(remaining)==nil
                    and scope.widget.bIsMoving==false and scope.widget:IsInViewport()==false,'Tracked rhythm widget ownership changed.')
            end
        end
        for _,widget in ipairs(widgets) do widget.bIsMoving=false end
        feedClock(manager:GetMasterTimelinePosition(),false)
        manager.bIsRunning=false
        for _,widget in ipairs(widgets) do
            check(widgetOwnership(widget),'Owned rhythm widget changed before retirement.')
            widget:RemoveFromParent()
        end
        manager.BeatQueue:Empty()
        scope.queueEmptied=true
        check(#manager.BeatQueue==0 and manager:IsSequenceRunning()==false,'Owned rhythm probe did not stop its queue.')
        check(env.releaseRoot(scope.token)==true,'Owned rhythm root release was refused.')
        scope.released=true;report.root_released=true;report.stop_reason=reason
        return true
    end
    local function fail(problem)
        report.phase='failed';report.passed=false;report.error=tostring(problem)
        local ok,cleanup=pcall(stopOwned,'probe failed')
        if not ok then report.cleanup_error=tostring(cleanup) end
        return false
    end
    local function state()
        local manager=managerIdentity()
        unbound(manager)
        report.native_queue_count=#manager.BeatQueue;report.native_index=manager.CurrentBeatIndex;report.native_total=manager.TotalStrokes;report.native_running=manager:IsSequenceRunning()==true
        if finalize and scope.resumed and #manager.BeatQueue==0 then
            check(manager:IsSequenceRunning()==false and manager.CurrentBeatIndex==0 and manager.TotalStrokes==#rows,'Owned native finalization left an inconsistent stopped manager.')
            scope.queueEmptied=true;report.native_finalized=true
        elseif scope.queueEmptied then check(#manager.BeatQueue==0,'Finalized owned queue acquired unknown entries.')
        else queueMatches(manager) end
        discover()
        check(env.binding()==scope.binding,'Owned rhythm profile/session binding changed.')
        local instance=env.instance()
        check(sameObject(instance,scope.instanceAddress),'Owned rhythm game instance changed.')
        check(sameObject(instance:GetWorld(),scope.worldAddress),'Owned rhythm active world changed.')
        local position=manager:GetMasterTimelinePosition()
        check(finite(position) and position>=0,'Owned rhythm manager clock is invalid.')
        local completed,index=manager.CompletedBeats,manager.CurrentBeatIndex
        check(finite(completed) and completed%1==0 and completed>=0 and completed<=2,'Owned rhythm completion counter is invalid.')
        check(finite(index) and index%1==0 and index>=0 and index<=2,'Owned rhythm queue index is invalid.')
        report.position=position;report.completed=completed;report.index=index
        return manager,position,completed,index
    end
    function self:start()
        check(report.phase=='idle','Owned rhythm probe cannot be restarted or reused.')
        local ok,problem=pcall(function()
            local binding=env.binding();check(type(binding)=='string' and #binding>0,'Owned rhythm profile/session binding is unavailable.')
            local instance=env.instance();check(valid(instance),'Owned rhythm game instance is unavailable.')
            local world=instance:GetWorld();check(valid(world) and world:IsA('/Script/Engine.World'),'Owned rhythm world is unavailable.')
            local managerClass=env.find('/Script/CockHero.BeatSpawnerManager')
            local widgetClass=env.find('/Script/CockHero.PreciseBeatWidget')
            local imageClass=env.find('/Script/UMG.Image')
            check(valid(managerClass) and valid(widgetClass) and valid(imageClass),'Owned native rhythm classes are unavailable.')
            scope={binding=binding,instance=instance,instanceAddress=address(instance),worldAddress=address(world),managerClassAddress=address(managerClass),widgetClassAddress=address(widgetClass),imageClassAddress=address(imageClass)}
            local started=wall();scope.started=started;scope.deadline=started+(reconcile and 40 or audio and 25 or 15)
            local token,managerAddress=env.createRoot(instance)
            scope.token=token;report.lease_token=token
            check(token~=nil and finite(managerAddress) and managerAddress>0 and managerAddress%1==0,'Native rhythm factory returned invalid ownership.')
            scope.managerAddress=managerAddress
            local candidates=env.managers() or {};check(#candidates<=10000,'Owned rhythm manager enumeration exceeds its limit.')
            for _,manager in ipairs(candidates) do
                if address(manager)==managerAddress then check(scope.manager==nil,'Owned rhythm manager identity is ambiguous.');scope.manager=manager end
            end
            check(scope.manager~=nil,'Fresh native rhythm manager was not found.')
            local manager=scope.manager
            check(sameObject(manager:GetClass(),scope.managerClassAddress) and sameObject(manager:GetOuter(),scope.instanceAddress),'Native rhythm factory returned a foreign manager.')
            check(manager:IsSequenceRunning()==false and #manager.BeatQueue==0,'Fresh native rhythm manager is not stopped and empty.')
            unbound(manager)
            scope.expectedCount=0
            for _,name in ipairs({'LinkedMediaController','MediaControllerRef','LatencyManager'}) do check(not valid(manager[name]),'Fresh rhythm manager contains a foreign media/latency reference.') end
            manager:SetWorld(world);scope.worldReady=true;managerIdentity()
            manager.TestBeatWidgetClass=widgetClass
            manager.CurrentBeatTravelTime=3.0
            manager.TotalStrokes=#rows;manager.CompletedBeats=0;manager.CurrentBeatIndex=0;manager.TimelineOffset=0
            for index,row in ipairs(rows) do manager.BeatQueue[index]=copy(row);scope.expectedCount=index end
            scope.queueReady=true;queueMatches(manager)
            if audio then
                local clock=audio:status()
                check(clock.state=='playing' and finite(clock.position) and clock.position>=0 and clock.position<0.5,'Owned audio clock must be advancing before the first beat.')
                manager.TimelineOffset=clock.position
                report.clock_source='native audio decoder';report.max_clock_error=0
                feedClock(clock.position,true)
            end
            manager:ResumeSequence()
            check(manager:IsSequenceRunning()==true,'Fresh native rhythm manager did not resume.')
            manager.CurrentBeatIndex=1
            createWidget(manager)
            if env.setClock then
                manager:OnBeatReachedCenter(copy(rows[1]))
                local accepted,suppressed,malformed,changed,generation,bypassed,deferred=env.guardStatus(scope.token)
                check(manager.CompletedBeats==0 and accepted==0 and suppressed==0 and malformed==0 and changed==0 and deferred>=1,'Owned decoder gate did not defer the premature native callback.')
                report.premature_callback_blocked=true
            end
            report.phase='running';report.started=true;report.manager_address=string.format('%x',managerAddress)
        end)
        if not ok then fail(problem);return copy(report) end
        return copy(report)
    end
    local function freeze(manager,position)
        feedClock(position,false)
        manager.bIsRunning=false;manager.TimelineOffset=position
        if scope.widget and valid(scope.widget) and widgetOwnership(scope.widget) then scope.widget.bIsMoving=false end
    end
    local function retireCurrent()
        local widget=scope.widget
        check(valid(widget) and widgetOwnership(widget),'Owned seek widget cannot be retired safely.')
        widget.bIsMoving=false;widget:RemoveFromParent()
        check(not widget:IsInViewport(),'Owned seek widget remained in the viewport.')
        scope.retired=scope.retired or {};scope.retired[address(widget)]=true
        scope.widget=nil;scope.widgetAddress=nil;report.retired_widgets=(report.retired_widgets or 0)+1
    end
    local function rebase(manager,position,running)
        manager.TimelineOffset=position
        if running and not manager:IsSequenceRunning() then manager:ResumeSequence() end
        local current=manager:GetMasterTimelinePosition()
        local platform=current+manager.MasterTimeReference-manager.TimelineOffset
        manager.MasterTimeReference=platform;manager.TimelineOffset=position;manager.bIsRunning=running
        if scope.widget and valid(scope.widget) and widgetOwnership(scope.widget) and manager.CompletedBeats==0 then
            scope.widget.MasterTimeReference=platform;scope.widget.TimelineOffset=position;scope.widget.bIsMoving=running
        end
        scope.lastAudio=position;feedClock(position,running)
    end
    function self:step()
        if not scope or report.phase=='idle' or report.phase=='complete' or report.phase=='failed' or report.phase=='stopped' then return copy(report) end
        local ok,problem=pcall(function()
            local now=wall();check(now<scope.deadline,'Owned rhythm probe timed out.')
            local manager,position,completed,index=state()
            if finalize and scope.queueEmptied then
                local accepted,suppressed,malformed,changed,generation,bypassed,deferred=env.guardStatus(scope.token)
                check(accepted==1 and malformed==0 and changed==0 and completed==1,'Owned native finalization did not retain exactly one guarded completion.')
                local worldTime=env.worldTime()
                check(finite(worldTime) and worldTime>=0,'Owned native drain world time is unavailable.')
                if not scope.drainStarted then
                    scope.drainStarted=worldTime;audio:pause();feedClock(position,false);report.phase='native_draining'
                    report.guard_accepted=accepted;report.guard_suppressed=suppressed;report.guard_generation=generation;report.guard_deferred=deferred or 0;report.guard_verified=true
                end
                check(worldTime>=scope.drainStarted,'Owned drain world time moved backwards.')
                report.drained_world_seconds=worldTime-scope.drainStarted
                if report.drained_world_seconds>=0.25 then
                    stopOwned('owned native finalization and world timer drain passed');report.phase='complete';report.passed=true
                end
                return
            end
            if reconcile and (report.phase=='seeking_forward' or report.phase=='reconnecting' or report.phase=='seeking_backward' or report.phase=='resuming_replay') then
                local clock=audio:status()
                check(finite(clock.position) and clock.position>=0 and clock.position<12,'Owned reconciliation clock is invalid.')
                check(clock.state~='error' and clock.state~='ended' and clock.state~='stopped','Owned reconciliation decoder failed.')
                check(completed==(scope.replaying and 1 or 0),'Owned completion changed during transport reconciliation.')
                freeze(manager,manager.TimelineOffset)
                if report.phase=='seeking_forward' and clock.state=='paused' and math.abs(clock.position-1.5)<=0.25 then
                    rebase(manager,clock.position,false);createWidget(manager);rebase(manager,clock.position,false)
                    scope.pausePosition=clock.position;report.seek_position=clock.position
                    audio:resume();report.phase='resuming_audio'
                elseif report.phase=='reconnecting' and clock.state=='playing' then
                    check(clock.position>=scope.reconnectFrom-0.05 and clock.position<=scope.reconnectFrom+0.5,'Owned reconnect did not restore its bound position.')
                    rebase(manager,clock.position,true);scope.reconnected=true;report.reconnect_position=clock.position;report.phase='running'
                elseif report.phase=='seeking_backward' and clock.state=='paused' and math.abs(clock.position-1.0)<=0.25 then
                    rebase(manager,clock.position,false);report.backward_position=clock.position
                    audio:resume();report.phase='resuming_replay'
                elseif report.phase=='resuming_replay' and clock.state=='playing' then
                    rebase(manager,clock.position,true);report.phase='replaying'
                end
                return
            end
            if audio then
                local clock=audio:status()
                check((clock.state=='playing' or clock.state=='paused') and finite(clock.position) and clock.position>=0 and clock.position<12,'Owned audio clock became unavailable or discontinuous.')
                check(not scope.lastAudio or clock.position>=scope.lastAudio-0.05,'Owned audio clock moved backwards without seek reconciliation.')
                local beforeCorrection=math.abs(position-clock.position)
                report.max_uncorrected_error=math.max(report.max_uncorrected_error or 0,beforeCorrection)
                check(beforeCorrection<=0.25,'Owned audio clock jumped without seek reconciliation.')
                if clock.state=='playing' and not manager:IsSequenceRunning() then manager:ResumeSequence();position=manager:GetMasterTimelinePosition() end
                local platform=position+manager.MasterTimeReference-manager.TimelineOffset
                check(finite(platform),'Owned audio platform reference is invalid.')
                manager.MasterTimeReference=platform;manager.TimelineOffset=clock.position;manager.bIsRunning=clock.state=='playing'
                if completed==0 then
                    check(valid(scope.widget) and widgetOwnership(scope.widget),'Owned audio widget binding changed.')
                    scope.widget.MasterTimeReference=platform;scope.widget.TimelineOffset=clock.position;scope.widget.bIsMoving=clock.state=='playing'
                end
                scope.lastAudio=clock.position;feedClock(clock.position,clock.state=='playing')
                position=manager:GetMasterTimelinePosition();report.position=position;report.audio_position=clock.position
                local difference=math.abs(position-clock.position)
                report.max_clock_error=math.max(report.max_clock_error or 0,difference)
                check(difference<=0.05,'Owned manager did not follow the native audio clock.')
                if env.setClock and completed==0 and clock.state=='playing' and clock.position>=rows[1].TargetHitTime then
                    retireCurrent()
                    manager:OnBeatReachedCenter(copy(rows[1]))
                    completed=manager.CompletedBeats;report.completed=completed
                    check(completed==1,'Decoder-clock delivery did not complete exactly one owned beat.')
                    report.delivery_source='observed decoder clock'
                end
            end
            check(index==1,'Owned rhythm future event fired unexpectedly.')
            if report.phase=='running' and not scope.resumed then
                check(completed==0,'Owned rhythm widget completed before the pause proof.')
                check(valid(scope.widget) and widgetOwnership(scope.widget),'Owned rhythm moving widget is unavailable.')
                if position>=0.5 then
                    check(position<rows[1].TargetHitTime,'Owned rhythm pause window was missed.')
                    local platform=position+manager.MasterTimeReference-manager.TimelineOffset
                    check(finite(platform),'Owned rhythm platform reference is invalid.')
                    local widget=scope.widget
                    scope.widgetPosition=platform-widget.MasterTimeReference+widget.TimelineOffset
                    check(finite(scope.widgetPosition) and scope.widgetPosition<rows[1].TargetHitTime,'Owned widget pause position is invalid.')
                    if audio then
                        audio:pause();local paused=audio:status()
                        check(paused.state=='paused' and finite(paused.position) and math.abs(paused.position-position)<=0.05,'Owned decoder did not acknowledge pause.')
                        position=paused.position;scope.widgetPosition=position
                    end
                    feedClock(position,false)
                    widget.bIsMoving=false;manager.bIsRunning=false;manager.TimelineOffset=position
                    scope.pauseTime=now;scope.pausePosition=position;report.paused_position=position;report.phase='paused'
                end
            elseif report.phase=='paused' then
                check(completed==0 and manager:IsSequenceRunning()==false and near(position,scope.pausePosition),'Owned rhythm clock or completion advanced during pause.')
                check(valid(scope.widget) and widgetOwnership(scope.widget) and scope.widget.bIsMoving==false,'Owned rhythm widget moved during pause.')
                if now-scope.pauseTime>=2 then
                    if reconcile then
                        retireCurrent();audio:seek(1.5);report.phase='seeking_forward';return
                    end
                    if audio then
                        audio:resume()
                        if audio:status().state~='playing' then report.phase='resuming_audio';return end
                    end
                    manager:ResumeSequence()
                    check(manager:IsSequenceRunning()==true,'Owned rhythm manager did not resume after pause.')
                    local resumed=manager:GetMasterTimelinePosition()
                    local platform=resumed+manager.MasterTimeReference-manager.TimelineOffset
                    check(finite(platform) and finite(resumed) and resumed>=scope.pausePosition
                        and resumed-scope.pausePosition<=0.05,'Owned rhythm resume position changed unexpectedly.')
                    local widget=scope.widget
                    widget.MasterTimeReference=platform;widget.TimelineOffset=scope.widgetPosition;widget.bIsMoving=true
                    scope.resumed=true;report.resumed_position=resumed;report.phase='running'
                end
            elseif report.phase=='resuming_audio' then
                if audio:status().state=='playing' then
                    check(position>=scope.pausePosition and position-scope.pausePosition<=0.25,'Owned decoder resume position changed unexpectedly.')
                    check(completed==0,'Owned audio widget completed during resume acknowledgement.')
                    scope.resumed=true;report.resumed_position=position;report.phase='running'
                end
            elseif report.phase=='running' and scope.resumed then
                if reconcile and not scope.reconnected and position>=2.0 then
                    check(completed==0,'Owned beat completed before reconnect proof.')
                    freeze(manager,position);scope.reconnectFrom=position;audio:reconnect();report.phase='reconnecting';return
                end
                check(completed<=1,'Owned rhythm widget delivered a duplicate completion.')
                if completed==1 then
                    if env.guardStatus and not finalize then
                        local accepted,suppressed,malformed,changed,generation,bypassed,deferred=env.guardStatus(scope.token)
                        check(accepted==1 and suppressed==0 and malformed==0 and changed==0 and finite(generation) and generation>0,'Owned reflected hit guard did not observe the native completion.')
                        manager:OnBeatReachedCenter(copy(rows[1]))
                        local altered=copy(rows[1]);altered.TargetHitTime=altered.TargetHitTime+0.1
                        manager:OnBeatReachedCenter(altered)
                        accepted,suppressed,malformed,changed,generation,bypassed,deferred=env.guardStatus(scope.token)
                        check(manager.CompletedBeats==1 and accepted==1 and suppressed==2 and malformed==0 and changed==1,'Owned reflected guard did not suppress duplicate and changed-identity hits.')
                        report.guard_accepted=accepted;report.guard_suppressed=suppressed;report.guard_changed=changed;report.guard_generation=generation;report.guard_bypassed=bypassed;report.guard_deferred=deferred or 0;report.guard_verified=true
                    end
                    scope.observedTime=now;report.phase='observing'
                end
            elseif report.phase=='observing' then
                check(completed==1,'Owned rhythm completion was not stable.')
                if finalize then return end
                if reconcile and now-scope.observedTime>=1 then
                    audio:pause();freeze(manager,position);scope.replaying=true
                    if scope.widget and valid(scope.widget) and widgetOwnership(scope.widget) then retireCurrent() end
                    audio:seek(1.0);report.phase='seeking_backward';return
                end
                if now-scope.observedTime>=1 then
                    stopOwned(audio and 'audio-driven pause/resume probe passed' or 'pause/resume probe passed');report.phase='complete';report.passed=true
                end
            elseif report.phase=='replaying' then
                check(completed==1,'Backward replay delivered a duplicate completion.')
                if position>=3.5 then
                    stopOwned('owned seek/reconnect/replay reconciliation passed');report.phase='complete';report.passed=true;report.replay_verified=true
                end
            end
        end)
        if not ok then fail(problem) end
        return copy(report)
    end
    function self:status() return copy(report) end
    function self:stop(reason)
        if report.phase=='complete' or report.phase=='stopped' then return copy(report) end
        local ok,problem=pcall(stopOwned,reason or 'probe stopped')
        if not ok then report.phase='failed';report.passed=false;report.cleanup_error=tostring(problem)
        else report.phase='stopped';report.passed=false end
        return copy(report)
    end
    return self
end
return Probe
