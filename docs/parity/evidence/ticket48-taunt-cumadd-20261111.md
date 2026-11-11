# #48 taunt — `TauntCumAdd` pinned: 0.01

Source: hash-verified v0.05.1 build, unpacked with retoc (Oodle), converted to
legacy `.uasset`/`.uexp` with `retoc to-legacy`, mined with the session's
Python reader (`work/uasset.py`, `work/kismet2.py`, `work/cdowalk.py` in
`~/workspace/rejoice-evidence/cockhero-itch/work/`).

Package: `/Game/NewSetup/UI_Manager` (`UI_Manager.uasset`, 238,916 bytes;
names 1336, imports 454, exports 1498).

## What `TauntCumAdd` is

`TauntCumAdd` is UI_Manager name index **746**. It is an **instance variable**
of UI_Manager (referenced as an `EX_InstanceVariable` with owner FPackageIndex
1484 = the CDO class `Default__UI_Manager_C`), i.e. a Blueprint member
variable whose default lives in the class defaults (CDO), not a literal in any
function.

## Where it is used — `AddToCumMeter(TauntCumAdd)`

In `ExecuteUbergraph_UI_Manager`, at script storage offset **3322** (export
offset 16963; `.uexp` offset 33417), the reference is the sole argument to a
`LocalVirtualFunction` call to **`AddToCumMeter`** (UI_Manager name 31):

```
LocalVirtualFunction AddToCumMeter( InstanceVariable TauntCumAdd [owner 1484] )
```

So on taunt, the original calls `AddToCumMeter(TauntCumAdd)` — **TauntCumAdd
is the amount added to the cum meter when the player taunts**. It is read, not
written, here. (The call ends at script offset 3334 with `EX_EndFunctionParms`;
the next statement is a `LetBool` storing an `EqualEqual_IntInt` result into
`CallFunc_EqualEqual_IntInt_ReturnValue`, a separate statement.)

This is the only reference to `TauntCumAdd` in the UI_Manager ubergraph (the
other raw hit, `.uexp` 366117, is inside the `UI_Manager_C` class export —
the class/property metadata, not a function body). It does not appear in the
BP_GlobalManager name map at all (the one raw byte-pattern hit in the GM
`.uexp` is a coincidence: the bytes `ea 02 00 00 00 00 00 00` as data, not an
FName reference).

## Value: PINNED — 0.01

`TauntCumAdd` is UI_Manager property **#227** of 247 (0-based) in the
`UI_Manager_C` class export's inline FProperty list (`DoubleProperty`,
elemsize 8; class-export offset 14860). Its CDO default is **0.01**
(IEEE-754 double `0x3F847AE147AE147B`).

### How it was pinned (CDO unversioned-property walk)

The UI_Manager CDO (`Default__UI_Manager_C`, 1567 bytes) is unversioned
property data. The format (UAssetAPI `Unversioned/FFragment.cs`,
`FUnversionedHeader.cs`) is a stream of LE uint16 fragments until one has
`bIsLast`: bits 0–6 SkipNum, bit 7 bHasAnyZeroes, bits 9–15 ValueNum,
bit 8 bIsLast; a zero mask follows only if a fragment has bHasAnyZeroes.
The CDO header is 20 bytes (10 fragments), no zero mask, with 26 present
properties: 0, 197–201, 205–206, 210–216, 218–223, **227**, 233, 241,
262–263. Property indices are the class's own properties in declaration
order (derived-first); indices past 246 are parent-class properties.

The walk (`work/cdowalk.py`) decodes the values up to #205 and confirms the
layout: UberGraphFrame 2 bytes, BeatIntervalTimeFloat 0.25, IsBeatBarActive
true, StrokeCountRequired 10, AnchorSet (AnchorData: Offsets 0,0;
Anchors 0.0, **1.75**), IsBeatSpawnable false, StrokeCounterDisplay 0.
The middle (CardArray + text arrays) was not walked end-to-end, so the
value is pinned from the CDO **tail**, verified two independent ways:

- **From the last text element:** the 15th taunt line's FText starts at
  1433 (Flags 0, HistoryType 1, Namespace length 0, Key
  `D844B45D4C1160512FE5B7924C5A6E61`, SourceString length 22,
  `"*SCREAMS OF PLEASURE*"`) and ends at 1505. After it: #214
  DecreaseDifficultyCost 25 (int), #215 DecreaseDifficultyHeatSubtract
  40.0 (double), #216 DecreaseDifficultyUseCostIncrease 5 (int), #218
  EdgeBuyPrice 150, #219 IncreaseCumChanceCost 500, #220
  AddTimetoEdgeRecoveryCost 150, #221 EdgeRecoveryLengthIncreaseAmount 2,
  #222 BuySuccubusShieldsCost 100, #223 BuySuccubusShieldsAddAmount 25
  (six ints, 24 bytes) — 40 bytes total — so #227 sits at 1505 + 40 =
  **1545**, where the double reads **0.01**.
- **From the CDO end:** 1567 − (8 for #227 + 4 for #233 + 4 for #241 +
  6 for parent properties #262–263) = **1545**. Same offset.
  The trailing object refs confirm the alignment: #233
  ModifiersDataTable = import −102 (`ModifierInfoDataTable`), #241
  SuccuShopItemsDataTable = import −101
  (`SuccuShopModifierItems_DT`), and the last 6 bytes are zeros.

Every neighbouring value matches its property name, the object refs
resolve to the correct DataTables, and the layout accounts for exactly
1567 bytes. The value is **0.01** — one percent of the cum meter per taunt.

### Correction to the earlier candidates

The float32 candidates **1.75** and **1.875** at CDO offsets 43/51/59/67
are **not** `TauntCumAdd`: 1.75 is `AnchorSet.Anchors.Y` (a float inside
the AnchorData struct at #200), and 1.875 is a neighbouring float in the
same region. Do not use 1.75 or 1.875 as the value.

### FText format (established during this walk)

An `FText` in unversioned CDO data is: Flags int32 + HistoryType int8 +
Namespace FString + Key FString + SourceString FString. HistoryType is 0
or 1 in this build (both carry the three strings); Namespace may be
length 0 (empty, no bytes) or length 1 (just a null). FString length
includes the null terminator; length 0 means empty with no bytes. The
last taunt line's FText (offset 1433) tiles exactly against its neighbours,
confirming the layout. The middle of the CDO (CardArray at #206 and the
Slow/Medium/Fast text arrays at #211–213) was not walked end-to-end in
this pass — the CardArray count does not read as a plain int32 at the
expected offset, so a forward walk from #206 still needs its array/struct
layout resolved. That gap does not affect the pinned value, which rests
on the tail verification above.

### Class-property quirk (for future walks)

In this package's class-export property list, the struct/object
FPackageIndex tail field is stored as `(FPackageIndex << 8)` (low byte
0x00); recover it with an arithmetic right-shift by 8. Validated: all
218 Object/Struct class refs resolve correctly after the shift
(e.g. UberGraphFrame → `PointerToUberGraphFrame`, import −372;
AnchorSet → `AnchorData`, import −379; ModifiersDataTable → `DataTable`,
import −30).

## Related taunt evidence (CDO)

The CDO also holds the **15 taunt/succubus dialogue lines**, each with a
32-hex GUID + text (extracted verbatim from the raw CDO data):

1. "KEEP IT SLOW, WOULDN'T WANT YOU TO BLOW YOUR LOAD TOO FAST"
2. "SHHHH, IT'S OKAY, SLOW IT DOWN"
3. "SLOW AND STEADY BOY"
4. "DON'T GO FASTER THAN I SAY!!"
5. "GOOD BOY, IT MUST BE HELL TO HOLD BACK FROM STROKING FAST."
6. "NICE AND STEADY BOY LET ME SHOW YOU"
7. "KEEP IT GOING"
8. "LOOK AT YOU! GOOD BOY. KEEP GOING."
9. "DOING GOOD SO FAR..."
10. "I LOVE IT WHEN YOU STROKE AT THIS PACE"
11. "FASTER FASTER FASTER!!! I NEED IT ALL"
12. "CMON NOW BOY, GIVE ME YOUR CUM."
13. "SURELY THIS WILL GET YOU TO CUM"
14. "STOP HOLDING BACK AND GIVE ME IT ALL"
15. "*SCREAMS OF PLEASURE*"

(Plus a leading GUID + 'None' entry before the first line.) These are the
voicelines the taunt system draws from; the selection/weighting logic was not
decoded in this pass.

## Parser gap — RESOLVED (2026-11-11, Task 3)

The UI_Manager ubergraph script (export offset 13633, icode 25010, storage
34198) and the GM ubergraph (187,685-byte export; script icode 99921,
storage 138381) now parse end-to-end with the fixed session parser
(`work/kismet2.py`): UI_Manager 704 stmts, 0 errors, icode 25009/25010;
GM 2569 stmts, 0 errors, icode 99920/99921 (each off by 1 = the EndOfScript
byte). **0x91 was NOT a new token.** It was a parser misalignment:
`EX_BindDelegate` (0x61) is `FName FunctionName + Delegate expr +
ObjectTerm expr` (UAssetAPI `EX_BindDelegate.cs`), but the parser read it
as two bare expressions, so the FName's first byte (name index 657 = 0x91)
was mistaken for a token. Four more UAssetAPI-verified layouts were fixed
in the same pass (`EX_ClearMulticastDelegate` 0x5d = one expr;
`EX_CallMulticastDelegate` 0x63 = FPackageIndex + Delegate expr + params;
`EX_TextConst` 0x29 = FScriptText with a TextLiteralType byte and nested
string expressions, not raw FStrings; `EX_InterfaceContext` 0x51 = one expr
only) plus large-world vector sizes (`EX_VectorConst`/`EX_RotationConst` =
3 doubles, 24 B; `EX_TransformConst` = 80 B). The fix lives in the evidence
work dir, not in this repo. The `TauntCumAdd` reference above was found by
targeted byte search; the full ubergraph parse is now unblocked, and the
frenzy-event bodies and `AddFavoriteMedia` / `InitializeFavoriteLikelihood`
were decoded with it (see `ticket44-favorites-blueprint-20261111.md`).

## What this settles / leaves open for #48 (taunt)

- Settled: `TauntCumAdd` is the cum-meter increment applied on taunt, via
  `AddToCumMeter(TauntCumAdd)`, and its value is **0.01**. Implemented in
  `static/fanservice/taunts.js` (`tauntCumAdd = 0.01`; `run.state.meter`
  increases by 0.01, capped at 1, once per accepted taunt). Branch
  placement: the TauntButton handler calls it in the shared epilogue
  (`StartTauntCooldown -> AddToCumMeter`) after `Taunt()` / `Firemouth
  Taunt()`; the succubus branch falls through to the same `Taunt()` call,
  so the add applies on all three branches (see the handler trace in
  `ticket48-heat-spell-punishment-20261111.md`). Tests:
  `tests/fanservice_taunts.test.js` (all three branches, cap at 1,
  blocked taunt adds nothing).
- Still open: the dialogue selection/weighting; the "Hot Hands Modifier"
  notification (presentation gap, separate item).
