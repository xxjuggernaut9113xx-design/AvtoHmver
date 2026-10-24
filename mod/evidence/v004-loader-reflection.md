# v0.04 runtime reflection

The exact isolated v004-exclusive-c645757d executable started with the pinned
UE4SS 3.0.1-1181-g83330635 development loader. Only FanserviceReflection was
enabled; bundled cheat, console and other mods were not installed/enabled.
The probe in mod/probes/v004-reflection.lua enumerates objects and parameter
properties on the game thread, then queries the existing native store. It does
not construct widgets, modify access state, submit age confirmation or edit saves.

The first loader launch completed three passes (51 selected objects per pass)
without a crash. Source log: E:/fanservice-mod-lab/v004-native/reflection-first.log.
The second launch's ue4ss/UE4SS.log confirms a live CHPackStoreController under
BP_CHGameInstance and GetUnlockPoints() returned 3 on all three passes. Earlier
native UP purchase changed five to three UP; this query confirms the remaining
balance survived restart. native-up-restart.log separately confirms the paid
pack remained unlocked and enabled. No currency grant function was called.

Observed reflected functions include:

- /Script/UMG.WidgetBlueprintLibrary:Create with WorldContextObject, WidgetType,
  OwningPlayer and ReturnValue.
- /Script/WebBrowserWidget.WebBrowser:LoadURL(NewURL), LoadString(Contents,
  DummyURL), ExecuteJavascript(ScriptText), GetUrl() and GetTitleText().
- /Script/CockHero.CHPackStoreController:GetUnlockPoints(), UnlockPack(PackName),
  SetPackEnabled(PackName,bEnabled), IsPackUnlocked(PackName), IsPackEnabled(PackName),
  GetAllEnabledMedia(), GetAllPackInfos() and GetPackManifest(PackName,OutManifest).

These observations replace assumptions imported from the other build's custom
WebView plugin. They establish actual reflected interfaces and loader startup,
not a working embedded widget, bridge binding or streaming adapter. No build is
added to the supported full-mod registry by this checkpoint.
