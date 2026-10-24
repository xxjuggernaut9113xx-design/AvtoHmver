# v0.04 streaming boundary

Static findings reuse the exact-build decompilation at
E:/reJOIce/Analysis/ghidra-native/integration-decompiled.c. They do not establish
network playback or a working streaming hook.

GetManifestMedia (RVA 0x8191bc0, retained file line 24811) constructs
Extracted/<pack>/media and manifest.json. At line 24915 it requires the media
directory. At line 25037 it tests each normalized media path through helper
0x1410676a0 and omits entries when that test fails. The helper behaves as a file
existence predicate in the retained callers; its exact PDB name remains unknown.
Consequently, a metadata-only pack with absent files cannot supply media through
the unchanged native manager. A manifest URL alone is insufficient.

GetAllEnabledMedia (RVA 0x81d4820, line 56998) first checks native ownership and
enablement, then calls GetManifestMedia at line 57064 and concatenates results.
Any future session adapter must preserve those ownership/enablement gates.
Replacing FullPath on existing entries alone cannot introduce absent entries.

OpenVideo (line 33498) converts its input to UTF-8 and supplies it to thunk
0x1408c7ed8 at line 33640. The surrounding call sequence is consistent with
FFmpeg avformat_open_input, but the thunk/import mapping and enabled network
protocols have not been independently verified. PlayMediaEntry (line 34584)
classifies by extension and routes recognized images to LoadStaticImage; the
remaining video branch calls OpenVideo at line 34717. Query-string handling
therefore also requires verification. The native STREAMED log describes
incremental decoding, not proven HTTP playback.

LoadStaticImage (line 33403) schedules a worker at 0x1481a5f40 whose implementation
is absent from the retained decompilation. Remote image loading is unresolved.

Required acceptance before declaring native streaming:

1. Verify reflected GetAllEnabledMedia return-array replacement, struct/FString
   lifetime, and the Blueprint consumers' behavior.
2. Insert frozen, resolved Server session membership after native ownership
   selection and before gameplay pool consumption.
3. Verify HTTP/HTTPS opening, ranges, seeking and failure behavior using synthetic
   video; verify a separate remote image path.
4. Verify profile/menu revocation, session freeze and explicit offline snapshots.

No placeholder files, modified entitlement flags, or direct save edits were used
to claim that these unresolved paths work.
