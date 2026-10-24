# v0.04 browser construction investigation

The bounded browser probe inspected the already-open ordinary Import menu. The
returned ImportMenuWidget_C had a live WidgetTree and CanvasPanel root under
the original MainMenu widget. Those object names were logged immediately before
construction. No Import access state was changed.

Calling the development loader's StaticConstructObject(WebBrowserClass,
ImportWidgetTree) crashed the isolated game inside StaticConstructObject_Internal.
The game log is E:/fanservice-mod-lab/v004-native/browser-adapter.log; the fault
was RVA 0x194f4f7. Exact-build PDB public-symbol inspection confirms the loader's
scanned function entry RVA 0x194ea40 is correct. Therefore a wrong scan address
does not explain this failure. A construction-parameter ABI/layout mismatch is
a hypothesis, not a proven root cause.

The next probe revision uses reflected UGameplayStatics::SpawnObject to let the
game construct its own parameter structure. It first inspects that reflected
function's properties. This changed call path succeeded. The resulting UWebBrowser
was owned by the existing Import WidgetTree and attached to its CanvasPanel with
the original Back control left accessible. The test HTML rendered inside the
original game window.

Navigation to the shared Lite frontend then succeeded at the loopback static
test server. Library and Organization were the only main tabs. Organization
responded to a real click, and the native Back button returned to the original
main menu. The static-only test server reported API 404 correctly; this check
does not establish Server browsing, bridge purchases or streaming playback.

The first HTTP navigation failed because the Python windowless test server had
no stderr stream for request logging. Relaunching the owned loopback server with
redirected output fixed HTTP responses without changing the game. No remote
server or user media was involved.

The probe accepts only inspect, attach, detach and lite commands from its fixed
isolated-lab development command file. It cannot evaluate source from that file.
It refuses attachment unless the ordinary original Import menu is in the viewport.
This development probe is not a distributable full mod and is not enabled in the
supported-build registry.
