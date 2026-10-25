# Remaining runtime boundaries

Updated October 25: the later [native MCP evidence](v004-runtime-mcp.md)
confirms synthetic HTTP video decoding. The [native companion candidate](../native/README.md)
implements storage/sync/audio-preview components with separate validation scopes.
The older pending observations below are retained for investigation history.

The original Unlocks controls remain authoritative. The user verified the revised
draft-only embedded UI. The following are separate unresolved integrations.

## Native video opening over HTTP

The development-only probe mod/probes/v004-video-stream.lua is staged in the
isolated lab as FanserviceStreamProbe. It changes only an MP4 path belonging to
the configured synthetic fanservice pack, checks native ownership and enablement,
and stops after three redirects. The synthetic color-bar video is served only at
http://127.0.0.1:42170/synthetic.mp4. Original media paths are left unchanged.
This probe is excluded from the runtime installer.

The pinned loader 8333063595fa3c49ad307f3b0f732accbb760d25 supports this API:
LuaMod.cpp lines 170–211 wraps reflected pre-hook parameters, including const-ref
inputs. LuaUObject.cpp lines 1766–1777 gets FString userdata and assigns a Lua
string; lines 2377–2411 dispatch RemoteUnrealParam setters. Thus the probe uses
path:get():ToString() and path:set(url), returning nil. This source verification
does not prove that the game decoder supports HTTP or seeking.

The loader log confirms probe registration and Ready at 18:29:20 local lab time
on 2026-10-24. No HTTP request or successful decoder result has been observed.
After the user asked for another Computer Use attempt, selecting the returned
game window was denied again with "Computer Use was not approved to use cockhero".
No further game UI input was attempted.

## Native media-array insertion

Pinned LuaMod.cpp lines 347–358 supplies Context and original ReturnValue to the
post-hook. ReturnValue:get() follows ArrayProperty Get and returns LuaTArray;
direct function calls use a different conversion yielding Lua element tables.
LuaTArray.cpp lines 232–251 supports in-place append through AddZeroed and the
inner-property converter. LuaUObject.cpp lines 572–650 sets reflected struct
fields. Do not retain borrowed element wrappers across append/reallocation.

Do not return the same TArray userdata as a replacement: the whole-array setter
empties the destination before reading the source. A whole Lua table replacement
also has unresolved lifetime behavior. The zero-state construction/destruction
of FCHPackMediaEntry still requires an isolated runtime test before integration.

The recovered BP_CardManager ubergraph appends GetAllEnabledMedia results to
AllCards (retained JSON lines 1080–1160). Its ValidateMediaEntries calls shown
earlier in the file operate on saved favorite-card lists. The native validator
at RVA 0x81953c0 checks nonempty FullPath and a platform file predicate before
retaining entries. Streaming favorite persistence must therefore be handled
explicitly; successful pool insertion alone would not prove saved favorites.

## Native profile and soundtrack binding

BP_CHGameInstance has SaveSlotName, UserIndex, CurrentSave and CHPack StoreController
fields. ReloadSave replaces CurrentSave and invokes native store ReloadSave.
Durable companion identity must bind installation/build, slot and user index;
pointer/generation identity is only suitable for rejecting stale in-process work.

The game's GetMasterTimelinePosition implementations use elapsed platform time,
not actual audio position. Reusing those getters cannot satisfy buffering/seek
requirements. Original music uses AudioComponent and Quartz. A separate real
streamed-audio transport must expose playback position, pause, buffering, seek
completion and end events before driving native rhythm events. Original music
must remain unchanged outside a selected fanservice soundtrack session.

These are static findings and pending tests, not completed native integrations.
