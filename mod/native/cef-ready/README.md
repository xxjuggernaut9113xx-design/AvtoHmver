# Exact v0.05.1 CEF readiness helper

This owned Lua module reads the native CEF singleton's runnable state. It calls
no game functions and writes no game memory. It registers
`FanserviceCefReady() -> readyBoolean, stateString` only after verifying the exact
game and UE4SS DLL hashes. Unknown pointers, layouts, states or identity fail
closed. `running` means native `InitInter` succeeded; it does not establish that
an individual browser document has loaded.

Build with the retained pinned external UE4SS/UEPseudo headers:

```powershell
python mod/native/cef-ready/build.py --dependencies D:/reJOIce/Deliverables/fanservice-native-session-20261026/delegate-reader-build/deps --loader E:/fanservice-mod-lab/isolated-d7-cover-test/game/CockHero/Binaries/Win64/ue4ss/UE4SS.dll --output E:/avtohmver-build/cef-ticket27
```

The build runs `contract.exe` and writes `build-manifest.json` with source,
game, loader and output hashes. Dependency headers and game binaries remain
outside the repository. This requires the existing Visual Studio C++ toolchain.

The installer takes `--cef-ready-dll` and accepts only its explicitly pinned
helper SHA-256. A rebuilt artifact must be reviewed and its installer pin updated
before distribution; an arbitrary rebuilt DLL is not accepted automatically.
The currently pinned artifact is
`278ba5379ecc43c41fe3142d629a0ade0e1f447d5f2a102bf4f9f89fa7a04c86`.

The runtime requires both the original menu/age guard and native RUN before
constructing a browser. A native browser still needs its exact first-document
handshake before reparenting. A startup time delay is not a readiness signal.
