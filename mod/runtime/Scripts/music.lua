local Music = {}
local identity = {Rotation={X=0,Y=0,Z=0,W=1}, Translation={X=0,Y=0,Z=0}, Scale3D={X=1,Y=1,Z=1}}
local function finite(value) return type(value) == 'number' and value == value and value > -math.huge and value < math.huge end
local function valid(object)
    local ok, result = pcall(function() return object ~= nil and object:IsValid() end)
    return ok and result
end
local function same(left, right)
    return valid(left) and valid(right) and left:GetAddress() == right:GetAddress()
end

function Music.new(env)
    assert(type(env) == 'table' and type(env.find) == 'function' and type(env.spawn) == 'function'
        and type(env.currentBinding) == 'function' and type(env.authorize) == 'function',
        'Native music requires an object factory, active profile binding and trusted URL authorization.')
    local self = {state='stopped', position=0, duration=0, desiredPaused=false, played=false}
    local player, sound, actor, binding, url, original, originalPaused, pendingSeek, reopenPosition
    local mathLibrary
    local now = env.now or os.time
    local openDeadline, seekDeadline, bufferDeadline, lastProgressAt
    local function authorize(value, owner)
        if type(value) ~= 'string' or #value == 0 or #value > 8192 or value:find('[%z\1-\31]')
            or type(owner) ~= 'string' or #owner == 0 or #owner > 2048
            or env.currentBinding() ~= owner or env.authorize(value, owner) ~= true then
            error('Soundtrack URL or active profile authorization is invalid.')
        end
    end
    local function context()
        if not binding or env.currentBinding() ~= binding then error('Native profile changed during soundtrack playback.') end
        if not valid(actor) or not valid(player) or not valid(sound) then error('Native soundtrack objects were released.') end
    end
    local function activeOriginal()
        local ok, component = pcall(function() return actor.ActiveMusicComponent end)
        return ok and valid(component) and component or nil
    end
    local function suppressOriginal()
        local component = activeOriginal()
        if not component then return end
        if not same(component, original) then original, originalPaused = component, false end
        local state = component:GetPlayState()
        if state == 0 or state == 3 or state == 4 then
            component:SetPaused(true)
            originalPaused = true
        end
    end
    function self:stop(reason, restore)
        local failures = {}
        local function attempt(operation)
            local ok, problem = pcall(operation)
            if not ok then failures[#failures + 1] = tostring(problem) end
        end
        if valid(player) then attempt(function() player:Close() end) end
        if valid(sound) then
            attempt(function() sound:Stop() end)
            attempt(function() sound:K2_DestroyComponent(actor) end)
        end
        if restore ~= false and binding and env.currentBinding() == binding and valid(actor)
            and originalPaused and same(original, activeOriginal()) then
            attempt(function() if original:GetPlayState() == 2 then original:SetPaused(false) end end)
        end
        player, sound, actor, binding, url, original, originalPaused, pendingSeek, reopenPosition = nil,nil,nil,nil,nil,nil,nil,nil,nil
        openDeadline, seekDeadline, bufferDeadline, lastProgressAt = nil,nil,nil,nil
        self.state, self.played, self.advancing = 'stopped', false, false
        self.reason = reason
        self.cleanup_error = #failures > 0 and table.concat(failures, '; ') or nil
        return self:status()
    end
    function self:status()
        return {state=self.state, position=self.position, duration=self.duration,
            advancing=self.state == 'playing' and self.advancing == true, reason=self.reason, error=self.error, cleanup_error=self.cleanup_error}
    end
    function self:open(value, owner, token)
        authorize(value, token)
        if not valid(owner) then error('Soundtrack needs a valid native actor owner.') end
        self:stop('replaced')
        actor, binding, url = owner, token, value
        openDeadline = now() + 120
        self.state, self.position, self.duration, self.played, self.desiredPaused = 'opening',0,0,false,false
        self.reason, self.error, self.cleanup_error, self.advancing = nil,nil,nil,false
        local ok, problem = pcall(function()
            local playerClass, soundClass = env.find('/Script/MediaAssets.MediaPlayer'), env.find('/Script/MediaAssets.MediaSoundComponent')
            mathLibrary = env.find('/Script/Engine.Default__KismetMathLibrary')
            if not valid(playerClass) or not valid(soundClass) or not valid(mathLibrary) then error('Native media audio classes are unavailable.') end
            player = env.spawn(playerClass, actor)
            if not valid(player) then error('Native audio player construction failed.') end
            player.PlayOnOpen = false
            player:SetLooping(false)
            sound = actor:AddComponentByClass(soundClass, true, identity, false)
            if not valid(sound) then error('Registered native media sound construction failed.') end
            sound:SetMediaPlayer(player)
            sound:Start()
            if not player:OpenUrl(url) then error('Native soundtrack URL was rejected.') end
        end)
        if not ok then
            self:stop('open failed')
            self.state, self.error = 'error', tostring(problem)
            error(problem)
        end
        return self:status()
    end
    function self:pause()
        context()
        if player:IsPlaying() and not player:Pause() then error('Native soundtrack pause was rejected.') end
        self.desiredPaused = true
        return self:sample()
    end
    function self:resume()
        context()
        self.desiredPaused = false
        lastProgressAt = now()
        if not pendingSeek and player:IsReady() and not player:Play() then error('Native soundtrack resume was rejected.') end
        return self:sample()
    end
    function self:seek(seconds)
        context()
        if not finite(seconds) or seconds < 0 or self.duration <= 0 or seconds > self.duration then error('Soundtrack seek position is outside the recording.') end
        if not player:SupportsSeeking() then error('Native soundtrack does not support seeking.') end
        local wasPlaying = player:IsPlaying()
        if wasPlaying and not player:Pause() then error('Native soundtrack could not pause for seeking.') end
        if not player:Seek(mathLibrary:FromSeconds(seconds)) then
            if wasPlaying then player:Play() end
            error('Native soundtrack seek was rejected; playback position was retained.')
        end
        pendingSeek = seconds
        seekDeadline = now() + 30
        self.state = 'seeking'
        return self:status()
    end
    function self:reconnect()
        context()
        authorize(url, binding)
        local position = mathLibrary:GetTotalSeconds(player:GetTime())
        if not finite(position) or position < 0 then error('Native reconnect position is unavailable.') end
        if not player:Reopen() then error('Native soundtrack reconnect was rejected.') end
        reopenPosition = position
        openDeadline = now() + 120
        self.state = 'opening'
        return self:status()
    end
    function self:sample()
        if not binding then return self:status() end
        if env.currentBinding() ~= binding then return self:stop('profile changed', false) end
        self.advancing = false
        local ok, problem = pcall(function()
            context()
            if player:HasError() then error('Native soundtrack decoding failed. Reconnect or select a saved recording.') end
            if player:IsPreparing() or not player:IsReady() then
                openDeadline = openDeadline or now() + 120
                lastProgressAt, bufferDeadline = nil,nil
                if openDeadline and now() > openDeadline then error('Native soundtrack opening timed out.') end
                self.state = 'opening'; return
            end
            local position = mathLibrary:GetTotalSeconds(player:GetTime())
            local duration = mathLibrary:GetTotalSeconds(player:GetDuration())
            if finite(position) and position >= 0 and duration == 0 then
                openDeadline = openDeadline or now() + 120
                lastProgressAt = nil
                if now() > openDeadline then error('Native soundtrack metadata timed out.') end
                self.state = 'opening'; return
            end
            if not finite(position) or position < 0 or not finite(duration) or duration <= 0 or position > duration + 0.05 then
                error('Native soundtrack clock is invalid: position=' .. tostring(position) .. ', duration=' .. tostring(duration) .. '.')
            end
            openDeadline = nil
            if self.played and not pendingSeek and not reopenPosition and position < self.position - 0.05 then error('Native soundtrack clock moved backwards without a seek.') end
            self.advancing = position > self.position + 0.0001
            self.position, self.duration = position, duration
            if self.advancing then lastProgressAt = now() end
            if reopenPosition then
                local target = math.min(reopenPosition, duration)
                reopenPosition = nil
                self:seek(target)
                return
            end
            local buffering = player:IsBuffering()
            local seekCompleted = false
            if pendingSeek then
                if seekDeadline and now() > seekDeadline then error('Native soundtrack seeking timed out.') end
                if math.abs(position - pendingSeek) > 0.05 or buffering then lastProgressAt = nil; self.state = 'seeking'; return end
                pendingSeek, seekDeadline = nil,nil
                seekCompleted = true
                lastProgressAt = now()
            end
            if buffering then
                bufferDeadline = bufferDeadline or now() + 120
                lastProgressAt = nil
                if now() > bufferDeadline then error('Native soundtrack buffering timed out.') end
                self.state = 'buffering'; return
            end
            bufferDeadline = nil
            if self.desiredPaused then
                if player:IsPlaying() and not player:Pause() then error('Native soundtrack pause was rejected.') end
                self.state = 'paused'
                lastProgressAt = nil
            elseif player:IsPlaying() then
                self.state, self.played = 'playing', true
                suppressOriginal()
            elseif self.played and not player:IsPaused() and position >= duration - 0.05 then
                self.state = 'ended'
            elseif not self.played or player:IsPaused() or seekCompleted then
                if not player:Play() then error('Native soundtrack playback was rejected.') end
                self.state = player:IsPlaying() and 'playing' or 'opening'
                if self.state == 'playing' then self.played = true; suppressOriginal() end
            else self.state = 'stalled' end
            if self.state == 'playing' or self.state == 'stalled' then
                lastProgressAt = lastProgressAt or now()
                if now() - lastProgressAt > 30 then error('Native soundtrack playback clock stalled.') end
                if now() - lastProgressAt > 2 then self.state = 'stalled' end
            end
        end)
        if not ok then
            self:stop('playback failed')
            self.state, self.error = 'error', tostring(problem)
        end
        return self:status()
    end
    return self
end
return Music
