# v0.04 native runtime MCP acceptance — 2026-10-24

The packaged game connection is separate from EngineWire, which connects only to
the isolated Unreal Editor tooling project. The stdio server in mod/mcp uses a
bounded nonce-bound local file protocol with the loaded UE4SS module.

## Passed in the original isolated packaged process

- MCP initialization, tool listing, native status, catalog and profile queries.
- Active native profile: PlayerSave, user index 0. Runtime addresses are ephemeral.
- Already-owned native-panel-one enabled through native SetPackEnabled. UP stayed
  4 before and after; no UP was granted and no purchase was simulated.
- Fixed localhost synthetic H.264 video fetched by native PlayMediaEntry:
  HTTP 200, 64 x 64, 2 seconds, 10 FPS, 20 decoded frames. A separate native
  decoder created a valid 64 x 64 texture and stopped with StopPlayback(false).
  This is decoder acceptance, not visible gameplay, streaming-mode or seek proof.
- Original Unlocks remains authoritative for normal purchase and enable controls.

Local raw evidence is retained in E:/fanservice-mod-lab/v004-native:
runtime-mcp-acceptance.json, runtime-mcp-fixture-acceptance.json,
runtime-mcp-probe.log, synthetic-http.err.log. Synthetic clip SHA-256:
5a50c5ce9aea537ffdea3b6d7644ec3b0dce76016fc44a4d02aba1986a60a307.
Original isolated saves were backed up before the fixture action.

## Failed experiments retained as gaps

The attempted GetAllEnabledMedia return hook did not execute during the diagnostic
call. A separate unsaved scratch-native-array append failed its integrity check.
Neither proves gameplay insertion. Both experimental tools/hooks were removed
from the source rather than exposed as successful functionality. Raw failure
reports remain locally as runtime-mcp-pools-acceptance.json and
runtime-mcp-structs-acceptance.json. The running lab still has the experimental
revision until a permitted reload; repository source excludes it.

A subsequent combined edit/restart command was rejected by automatic approval
review with “blocked by policy”; no reason beyond that was supplied. It did not
execute. No alternative game launch or input path was attempted after rejection.

## Remaining acceptance

Live Server membership and frozen gameplay pool insertion; native remote image
and video gameplay including seek/lifecycle; real music transport; profile sync
and offline behavior; full original-game regression and uninstall acceptance.
The build remains testing and supported_builds remains empty.

Validation: 75 tests passed, one platform-specific test skipped across native
bridge, ownership, archives, installer, compatibility and MCP suites. Compatibility
verification reports shipping_ready=false.
