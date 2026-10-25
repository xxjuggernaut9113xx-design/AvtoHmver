local Music = assert(loadfile('mod/runtime/Scripts/music.lua'))()
local passed = 0
local function eq(actual, expected, message) assert(actual == expected, (message or 'unexpected value') .. ': ' .. tostring(actual) .. ' ~= ' .. tostring(expected)) end
local function fails(fn, fragment)
    local ok, problem = pcall(fn)
    assert(not ok and tostring(problem):find(fragment, 1, true), 'Expected failure containing ' .. fragment .. ', got ' .. tostring(problem))
end
local function test(name, fn) fn(); passed = passed + 1; print('PASS ' .. name) end
local function fixture()
    local nextAddress = 0
    local function object()
        nextAddress = nextAddress + 1
        return {address=nextAddress, valid=true, IsValid=function(self) return self.valid end, GetAddress=function(self) return self.address end}
    end
    local original = object()
    original.state, original.pauseCalls, original.resumeCalls = 0,0,0
    function original:GetPlayState() return self.state end
    function original:SetPaused(paused) self.state = paused and 2 or 0; if paused then self.pauseCalls = self.pauseCalls + 1 else self.resumeCalls = self.resumeCalls + 1 end end
    local actor, player, sound = object(),object(),object()
    actor.ActiveMusicComponent = original
    player.ready, player.preparing, player.playing, player.paused, player.buffering, player.failed = false,false,false,false,false,false
    player.position, player.duration, player.playCalls, player.closeCalls, player.seekCalls, player.reopenCalls = 0,10,0,0,0,0
    player.seekOK, player.playOK, player.pauseOK, player.openOK, player.seekSupported = true,true,true,true,true
    function player:SetLooping(loop) self.loop = loop; return true end
    function player:OpenUrl(url) self.url = url; return self.openOK end
    function player:OpenFile(path) self.file = path; return self.openOK end
    function player:Close() self.closeCalls = self.closeCalls + 1; self.playing = false end
    function player:IsPreparing() return self.preparing end
    function player:IsReady() return self.ready end
    function player:IsPlaying() return self.playing end
    function player:IsPaused() return self.paused end
    function player:IsBuffering() return self.buffering end
    function player:HasError() return self.failed end
    function player:GetTime() return {seconds=self.position} end
    function player:GetDuration() return {seconds=self.duration} end
    function player:SupportsSeeking() return self.seekSupported end
    function player:Play() self.playCalls = self.playCalls + 1; if self.playOK then self.playing, self.paused = true,false end; return self.playOK end
    function player:Pause() if self.pauseOK then self.playing,self.paused = false,true end; return self.pauseOK end
    function player:Seek(span) self.seekCalls = self.seekCalls + 1; self.seekTarget = span.seconds; if self.seekOK and not self.asyncSeek then self.position = span.seconds end; return self.seekOK end
    function player:Reopen() self.reopenCalls = self.reopenCalls + 1; self.ready,self.position,self.playing,self.paused = false,0,false,false; return true end
    sound.starts, sound.stops, sound.destroys = 0,0,0
    function sound:SetMediaPlayer(value) self.player = value end
    function sound:SetVolumeMultiplier(value) self.volume = value end
    function sound:Start() self.starts = self.starts + 1 end
    function sound:Stop() self.stops = self.stops + 1 end
    function sound:K2_DestroyComponent(owner) eq(owner,actor); self.destroys = self.destroys + 1; self.valid = false end
    function actor:AddComponentByClass(class, manual, transform, deferred)
        eq(manual,true); eq(deferred,false); eq(transform.Rotation.W,1); eq(transform.Scale3D.X,1)
        return sound
    end
    local mathLibrary, playerClass, soundClass = object(),object(),object()
    function mathLibrary:GetTotalSeconds(span) return span.seconds end
    function mathLibrary:FromSeconds(seconds) return {seconds=seconds} end
    local scope = {binding='profile-one', allowed=true, now=0}
    local env = {now=function() return scope.now end, currentBinding=function() return scope.binding end,
        authorize=function(url,binding) return scope.allowed and binding == scope.binding and (url == 'http://127.0.0.1:42170/synthetic.m4a' or url == 'file:///E:/lab/owned.m4a') end,
        find=function(path) if path == '/Script/MediaAssets.MediaPlayer' then return playerClass elseif path == '/Script/MediaAssets.MediaSoundComponent' then return soundClass elseif path == '/Script/Engine.Default__KismetMathLibrary' then return mathLibrary end end,
        spawn=function(class,owner) eq(class,playerClass); eq(owner,actor); return player end}
    local transport = Music.new(env)
    local function open() return transport:open('http://127.0.0.1:42170/synthetic.m4a',actor,scope.binding) end
    local function play() open(); player.ready = true; transport:sample(); player.position = 0.5; return transport:sample() end
    return {transport=transport, player=player, sound=sound, actor=actor, original=original, env=env, scope=scope, open=open, play=play}
end

test('URLs and profile bindings require trusted worker authorization before construction',function()
    local f=fixture()
    fails(function() f.transport:open('https://foreign.invalid/audio',f.actor,f.scope.binding) end,'authorization')
    fails(function() f.transport:open('file:///E:/unowned/audio',f.actor,f.scope.binding) end,'authorization')
    fails(function() f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,'foreign-profile') end,'authorization')
    eq(f.sound.starts,0); eq(f.original.pauseCalls,0)
end)
test('registered native sound owns the player without touching original music during preparation',function()
    local f=fixture(); eq(f.open().state,'opening'); eq(f.player.PlayOnOpen,false); eq(f.player.loop,false)
    eq(f.sound.player,f.player); eq(f.sound.starts,1); eq(f.original.pauseCalls,0)
end)
test('only observed native position advances the public clock',function()
    local f=fixture(); local state=f.play(); eq(state.state,'playing'); eq(state.advancing,true); eq(state.position,.5); eq(state.duration,10)
    eq(f.transport:sample().advancing,false); eq(f.original.state,2); eq(f.original.pauseCalls,1)
end)
test('pause, resume and buffering retain the actual clock',function()
    local f=fixture(); f.play(); eq(f.transport:pause().state,'paused'); eq(f.player.position,.5)
    eq(f.transport:resume().state,'playing'); f.player.buffering=true; f.player.position=.7
    local state=f.transport:sample(); eq(state.state,'buffering'); eq(state.advancing,false); eq(state.position,.7)
end)
test('async seeking holds until the native timestamp reaches the target',function()
    local f=fixture(); f.play(); f.player.asyncSeek=true; f.transport:seek(4); local calls=f.player.playCalls
    eq(f.transport:sample().state,'seeking'); eq(f.player.playCalls,calls)
    f.player.position=4; eq(f.transport:sample().state,'playing')
end)
test('rejected seeks retain playback and unsupported seeks make no native seek call',function()
    local f=fixture(); f.play(); f.player.seekOK=false
    fails(function() f.transport:seek(4) end,'seek was rejected'); eq(f.player.position,.5); eq(f.player.playing,true)
    local count=f.player.seekCalls; f.player.seekSupported=false
    fails(function() f.transport:seek(4) end,'does not support'); eq(f.player.seekCalls,count)
end)
test('invalid seek values are rejected without touching transport',function()
    local f=fixture(); f.play()
    for _,value in ipairs({-1,11,math.huge,0/0}) do fails(function() f.transport:seek(value) end,'outside the recording') end
    eq(f.player.seekCalls,0)
end)
test('reconnect restores observed position before resuming',function()
    local f=fixture(); f.play(); f.player.position=4; eq(f.transport:reconnect().state,'opening'); eq(f.player.reopenCalls,1)
    f.player.ready=true; eq(f.transport:sample().state,'seeking'); eq(f.player.seekTarget,4); eq(f.transport:sample().state,'playing')
end)
test('reconnect checks current URL authorization again',function()
    local f=fixture(); f.play(); f.scope.allowed=false
    fails(function() f.transport:reconnect() end,'authorization'); eq(f.player.reopenCalls,0)
end)
test('profile changes close owned objects without mutating the new profile music',function()
    local f=fixture(); f.play(); f.scope.binding='profile-two'; local state=f.transport:sample()
    eq(state.state,'stopped'); eq(state.reason,'profile changed'); eq(f.player.closeCalls,1); eq(f.sound.destroys,1); eq(f.original.resumeCalls,0)
end)
test('ordinary stop restores only music it explicitly paused and is idempotent',function()
    local f=fixture(); f.play(); f.transport:stop('complete'); f.transport:stop('again')
    eq(f.original.state,0); eq(f.original.resumeCalls,1); eq(f.player.closeCalls,1); eq(f.sound.destroys,1)
end)
test('preexisting paused music is never resumed',function()
    local f=fixture(); f.original.state=2; f.play(); f.transport:stop()
    eq(f.original.pauseCalls,0); eq(f.original.resumeCalls,0); eq(f.original.state,2)
end)
test('replacement native music is tracked without resuming an obsolete component',function()
    local f=fixture(); f.play(); local newer={state=0,address=100,valid=true,IsValid=f.original.IsValid,GetAddress=f.original.GetAddress,pauseCalls=0,resumeCalls=0,GetPlayState=f.original.GetPlayState,SetPaused=f.original.SetPaused}
    f.actor.ActiveMusicComponent=newer; f.transport:sample(); eq(newer.state,2); f.transport:stop()
    eq(newer.state,0); eq(f.original.resumeCalls,0)
end)
test('decoder errors close resources and retain an explicit error state',function()
    local f=fixture(); f.play(); f.player.failed=true; local state=f.transport:sample()
    eq(state.state,'error'); assert(state.error:find('decoding failed',1,true)); eq(f.sound.destroys,1); eq(f.original.state,0)
end)
test('stalled playback is not mistaken for natural completion',function()
    local f=fixture(); f.play(); f.player.playing=false; f.player.paused=false; f.player.position=2
    eq(f.transport:sample().state,'stalled'); f.player.position=10; eq(f.transport:sample().state,'ended')
end)
test('failed construction cleans partial objects before reporting failure',function()
    local f=fixture(); f.sound.valid=false; fails(f.open,'sound construction failed')
    eq(f.player.closeCalls,1); eq(f.original.pauseCalls,0); eq(f.transport:status().state,'error')
end)
test('generic probe actors do not need a native game music component',function()
    local f=fixture(); f.actor.ActiveMusicComponent=nil; eq(f.play().state,'playing'); f.transport:stop(); eq(f.original.pauseCalls,0)
end)
test('opening deadline closes stalled native objects',function()
    local f=fixture();f.open();f.scope.now=121;local state=f.transport:sample();eq(state.state,'error');assert(state.error:find('opening timed out',1,true));eq(f.sound.destroys,1)
end)
test('seeking deadline closes a transport that never reaches its target',function()
    local f=fixture();f.play();f.transport:seek(5);f.scope.now=31;local state=f.transport:sample();eq(state.state,'error');assert(state.error:find('seeking timed out',1,true));eq(f.original.resumeCalls,1)
end)
test('frozen playing clock becomes stalled and closes with original audio restored',function()
    local f=fixture();f.play();f.scope.now=3;local state=f.transport:sample()
    eq(state.state,'stalled');eq(state.position,.5);eq(state.advancing,false)
    f.scope.now=31;state=f.transport:sample();eq(state.state,'error');assert(state.error:find('clock stalled',1,true))
    eq(f.original.resumeCalls,1);eq(f.sound.destroys,1)
end)

test('observed clock progress resets the stall deadline',function()
    local f=fixture();f.play();f.scope.now=29;f.player.position=1;eq(f.transport:sample().state,'playing')
    f.scope.now=58;eq(f.transport:sample().state,'stalled');f.player.position=2;eq(f.transport:sample().state,'playing')
    eq(f.original.resumeCalls,0)
end)

test('intentional pause has no stall deadline and resume starts a fresh observation window',function()
    local f=fixture();f.play();f.transport:pause();f.scope.now=500;eq(f.transport:sample().state,'paused')
    eq(f.transport:resume().state,'playing');f.scope.now=503;eq(f.transport:sample().state,'stalled')
    f.player.position=1;eq(f.transport:sample().state,'playing')
end)

test('buffering has a bounded deadline even when native timestamps move',function()
    local f=fixture();f.play();f.player.buffering=true;eq(f.transport:sample().state,'buffering')
    f.scope.now=121;f.player.position=1;local state=f.transport:sample();eq(state.state,'error')
    assert(state.error:find('buffering timed out',1,true));eq(f.original.resumeCalls,1)
end)

test('buffer recovery starts a fresh stall observation window',function()
    local f=fixture();f.play();f.player.buffering=true;f.transport:sample();f.scope.now=119
    f.player.buffering=false;eq(f.transport:sample().state,'playing');f.scope.now=122;eq(f.transport:sample().state,'stalled')
    eq(f.original.resumeCalls,0)
end)

test('decoder readiness lost after playback receives a new opening deadline',function()
    local f=fixture();f.play();f.player.ready=false;eq(f.transport:sample().state,'opening')
    f.scope.now=121;local state=f.transport:sample();eq(state.state,'error')
    assert(state.error:find('opening timed out',1,true));eq(f.original.resumeCalls,1)
end)

test('unrequested backwards clock movement fails without manufacturing timeline progress',function()
    local f=fixture();f.play();f.player.position=.1;local state=f.transport:sample();eq(state.state,'error')
    assert(state.error:find('moved backwards',1,true));eq(f.original.resumeCalls,1)
end)

test('explicit backwards seek is accepted and rebases stall monitoring',function()
    local f=fixture();f.play();f.scope.now=20;f.transport:seek(.1);eq(f.transport:sample().state,'playing')
    f.scope.now=49;eq(f.transport:sample().state,'stalled');f.player.position=.2;eq(f.transport:sample().state,'playing')
end)

test('ready decoder with pending duration waits for metadata without muting original audio',function()
    local f=fixture();f.open();f.player.ready=true;f.player.duration=0
    eq(f.transport:sample().state,'opening');eq(f.original.pauseCalls,0);eq(f.player.playCalls,1);eq(f.sound.volume,0)
    f.scope.now=2;f.player.duration=10;eq(f.transport:sample().state,'playing');eq(f.original.pauseCalls,1)
end)

test('missing duration has a bounded metadata deadline',function()
    local f=fixture();f.open();f.player.ready=true;f.player.duration=0;f.transport:sample();f.scope.now=121
    local state=f.transport:sample();eq(state.state,'error');assert(state.error:find('metadata timed out',1,true));eq(f.original.pauseCalls,0)
end)

test('nonfinite clocks report observed values and close the decoder',function()
    local f=fixture();f.play();f.player.position=0/0;local state=f.transport:sample()
    eq(state.state,'error');assert(state.error:find('position=',1,true));eq(f.sound.destroys,1)
end)

test('confirmed recording duration is validated before native construction or replacement',function()
    local f=fixture();f.play()
    for _,value in ipairs({0,-1,86401,math.huge,0/0,'10'}) do
        fails(function() f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,f.scope.binding,value) end,'duration is invalid')
    end
    eq(f.transport:status().state,'playing');eq(f.player.closeCalls,0)
end)

test('matching confirmed duration permits playback within decoder rounding tolerance',function()
    local f=fixture();f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,f.scope.binding,10.2)
    f.player.ready=true;f.player.duration=10.55;eq(f.transport:sample().state,'playing');eq(f.original.pauseCalls,1)
end)

test('mismatching confirmed duration fails before playback or original-audio suppression',function()
    local f=fixture();f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,f.scope.binding,11)
    f.player.ready=true;local state=f.transport:sample();eq(state.state,'error')
    assert(state.error:find('does not match the confirmed recording',1,true));eq(f.player.playCalls,0);eq(f.original.pauseCalls,0);eq(f.sound.destroys,1)
end)

test('pending metadata does not trigger a false confirmed-duration mismatch',function()
    local f=fixture();f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,f.scope.binding,10)
    f.player.ready=true;f.player.duration=0;eq(f.transport:sample().state,'opening');eq(f.original.pauseCalls,0)
    f.player.duration=10;eq(f.transport:sample().state,'playing')
end)

test('duration changed during playback closes the wrong recording and restores original audio',function()
    local f=fixture();f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,f.scope.binding,10)
    f.player.ready=true;f.transport:sample();f.player.duration=12;local state=f.transport:sample()
    eq(state.state,'error');eq(f.original.resumeCalls,1);eq(f.sound.destroys,1)
end)

test('a pending seek cannot extend its deadline by losing decoder readiness',function()
    local f=fixture();f.play();f.player.asyncSeek=true;f.transport:seek(5);f.player.ready=false
    eq(f.transport:sample().state,'opening');f.scope.now=31;local state=f.transport:sample();eq(state.state,'error')
    assert(state.error:find('seeking timed out',1,true));eq(f.original.resumeCalls,1)
end)

test('a pending seek cannot extend its deadline while duration metadata is unavailable',function()
    local f=fixture();f.play();f.player.asyncSeek=true;f.transport:seek(5);f.player.duration=0
    eq(f.transport:sample().state,'opening');f.scope.now=31;local state=f.transport:sample();eq(state.state,'error')
    assert(state.error:find('seeking timed out',1,true));eq(f.original.resumeCalls,1)
end)

test('reconnect cancels a stale seek deadline before opening and seeks to observed position',function()
    local f=fixture();f.play();f.player.asyncSeek=true;f.transport:seek(5);f.scope.now=20;eq(f.transport:reconnect().state,'opening')
    f.scope.now=35;eq(f.transport:sample().state,'opening');f.player.ready=true;eq(f.transport:sample().state,'seeking');eq(f.player.seekTarget,.5)
    f.player.position=.5;eq(f.transport:sample().state,'playing')
end)

test('ready zero-duration decoder gets one muted preroll before metadata becomes playable',function()
    local f=fixture();f.open();f.player.ready=true;f.player.duration=0
    local state=f.transport:sample();eq(state.state,'opening');eq(state.advancing,false);eq(f.player.playCalls,1);eq(f.sound.volume,0);eq(f.original.pauseCalls,0)
    f.transport:sample();eq(f.player.playCalls,1)
    f.player.duration=10;f.player.position=.1;state=f.transport:sample();eq(state.state,'playing');eq(state.advancing,true)
    eq(f.sound.volume,1);eq(f.original.pauseCalls,1)
end)

test('recording mismatch after muted preroll never unmutes or suppresses original audio',function()
    local f=fixture();f.transport:open('http://127.0.0.1:42170/synthetic.m4a',f.actor,f.scope.binding,10)
    f.player.ready=true;f.player.duration=0;f.transport:sample();f.player.duration=12;local state=f.transport:sample()
    eq(state.state,'error');eq(f.sound.volume,0);eq(f.original.pauseCalls,0);eq(f.sound.destroys,1)
end)

test('rejected preroll closes owned objects while leaving original audio alone',function()
    local f=fixture();f.open();f.player.ready=true;f.player.duration=0;f.player.playOK=false;local state=f.transport:sample()
    eq(state.state,'error');assert(state.error:find('preroll was rejected',1,true));eq(f.original.pauseCalls,0);eq(f.sound.volume,0)
end)

test('raw native samples remain visible without fabricating a playback clock',function()
    local f=fixture();f.open();f.player.ready=true;f.player.duration=0;local state=f.transport:sample()
    eq(state.native_ready,true);eq(state.native_preparing,false);eq(state.native_position,'0');eq(state.native_duration,'0');eq(state.position,0);eq(state.advancing,false)
end)

test('failed resume retains the explicit paused intent and does not silently retry',function()
    local f=fixture();f.play();f.transport:pause();f.player.playOK=false
    fails(function() f.transport:resume() end,'resume was rejected');f.player.playOK=true;local count=f.player.playCalls
    eq(f.transport:sample().state,'paused');eq(f.player.playCalls,count)
end)

test('accepted playback that never starts has a bounded start deadline',function()
    local f=fixture();f.open();f.player.ready=true
    function f.player:Play() self.playCalls=self.playCalls+1;return true end
    eq(f.transport:sample().state,'opening');f.scope.now=31;local state=f.transport:sample()
    eq(state.state,'error');assert(state.error:find('playback start timed out',1,true));eq(f.original.pauseCalls,0)
end)

test('explicit pause cancels an outstanding playback-start deadline',function()
    local f=fixture();f.open();f.player.ready=true
    function f.player:Play() self.playCalls=self.playCalls+1;return true end
    eq(f.transport:sample().state,'opening');eq(f.transport:pause().state,'paused')
    f.scope.now=200;eq(f.transport:sample().state,'paused');eq(f.original.pauseCalls,0)
end)

test('unreflected timespan ticks register before constructing native media objects',function()
    local f=fixture();local mathLibrary=f.env.find('/Script/Engine.Default__KismetMathLibrary');local registered=false;local calls=0
    function mathLibrary:FromSeconds(seconds) return registered and {FanserviceTimespanTicks=seconds*10000000} or {} end
    function mathLibrary:GetTotalSeconds(span) return (span.FanserviceTimespanTicks or 0)/10000000 end
    function f.player:GetTime() return registered and {FanserviceTimespanTicks=self.position*10000000} or {} end
    function f.player:GetDuration() return registered and {FanserviceTimespanTicks=self.duration*10000000} or {} end
    function f.player:Seek(span) self.seekTarget=(span.FanserviceTimespanTicks or 0)/10000000;self.position=self.seekTarget;return true end
    f.env.registerTimespan=function() eq(f.sound.starts,0);calls=calls+1;registered=true end
    eq(f.play().position,.5);eq(calls,1);f.transport:seek(4);eq(f.transport:sample().position,4);eq(f.player.seekTarget,4);eq(calls,1)
end)

test('failed timespan roundtrip never constructs or mutes native audio',function()
    local f=fixture();local mathLibrary=f.env.find('/Script/Engine.Default__KismetMathLibrary')
    function mathLibrary:GetTotalSeconds() return 0 end
    f.env.registerTimespan=function() end
    fails(f.open,'round-trip check');eq(f.sound.starts,0);eq(f.player.closeCalls,0);eq(f.original.pauseCalls,0)
end)

test('working timespan conversion does not register duplicate properties',function()
    local f=fixture();f.env.registerTimespan=function() error('Must not register a working conversion') end
    eq(f.play().position,.5)
end)

test('paused WMF seek decodes muted until its actual clock reaches the target',function()
    local f=fixture();f.play();f.transport:pause();f.player.asyncSeek=true
    local play=f.player.Play
    function f.player:Play() local result=play(self);if result and self.seekTarget then self.position=self.seekTarget end;return result end
    f.transport:seek(4);eq(f.sound.volume,0);eq(f.player.playing,true)
    local state=f.transport:sample();eq(state.state,'paused');eq(state.position,4);eq(f.player.playing,false)
    eq(f.transport:resume().state,'playing');eq(f.sound.volume,1)
end)

test('rejected seek preroll closes the accepted operation and restores original music',function()
    local f=fixture();f.play();f.player.playOK=false
    fails(function() f.transport:seek(4) end,'seek preroll was rejected')
    eq(f.transport:status().state,'error');eq(f.sound.destroys,1);eq(f.original.resumeCalls,1)
end)

test('seek observation permits decoder frame rounding without fabricating target time',function()
    local f=fixture();f.play();f.player.asyncSeek=true;f.transport:seek(4);f.player.position=4.1
    local state=f.transport:sample();eq(state.state,'playing');eq(state.position,4.1)
end)

test('a clock outside the bounded seek observation window remains pending',function()
    local f=fixture();f.play();f.player.asyncSeek=true;f.transport:seek(4);f.player.position=4.5
    eq(f.transport:sample().state,'seeking');eq(f.sound.volume,0)
end)

test('trusted local file URLs use native OpenFile with exactly one percent decode',function()
    local f=fixture();local value='file:///E:/lab/owned%20clip%25.m4a'
    f.env.authorize=function(url,binding) return url==value and binding==f.scope.binding end
    eq(f.transport:open(value,f.actor,f.scope.binding).state,'opening');eq(f.player.file,'E:/lab/owned clip%.m4a');eq(f.player.url,nil)
end)

test('invalid local file URI forms cannot replace an existing authorized transport',function()
    local f=fixture();f.play();f.env.authorize=function() return true end
    for _,value in ipairs({'file://remote/share/audio.m4a','file:///E:/bad%0.m4a','file:///E:/bad%00.m4a'}) do
        fails(function() f.transport:open(value,f.actor,f.scope.binding) end,'file URL')
    end
    eq(f.player.closeCalls,0);eq(f.transport:status().state,'playing')
end)

print(tostring(passed) .. ' native audio transport tests passed')
