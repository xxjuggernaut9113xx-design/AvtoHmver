# #48 taunt — `TauntCumAdd` use found; value still unpinned

Source: hash-verified v0.05.1 build, unpacked with retoc (Oodle), converted to
legacy `.uasset`/`.uexp` with `retoc to-legacy`, mined with the session's
Python reader (`work/uasset.py`, `work/kismet2.py` in
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

## Value: NOT pinned

The value is a CDO default and was **not** established in this pass:

- The UI_Manager CDO (`Default__UI_Manager_C`, class 1484, size 1567) is
  **unversioned** property data (no FPropertyTags), so the property cannot be
  found by searching for its name index — name indices do not appear in the
  data at all. The PropWalker does not parse it.
- The CDO header contains float32 candidates **1.75** and **1.875**
  (alternating at offsets 43, 51, 59, 67, each followed by 4 zero bytes).
  These are **not** established as `TauntCumAdd`: they sit in the CDO header,
  before the Blueprint's own properties, and are most likely parent-class or
  early properties. Do not use 1.75 or 1.875 as the value on this evidence.
- The `.usmap` (`~/workspace/reJOIce/Materials/Mappings/CockHeroProgression.usmap`)
  does **not** contain `TauntCumAdd` or `UI_Manager` at all, so it cannot
  supply the property layout. (It does contain `TauntCooldownTimerDuration`
  and neighbouring UI/GM property names, so it is a partial name list, not a
  complete class layout.)
- `TauntCumAdd` has no separable property export in the package (the class's
  property definitions live inside the `UI_Manager_C` class export, 18,110
  bytes), so its type/size/offset cannot be read off an export either.

### Method to pin it

Walk the CDO's unversioned property data using the class's property
declaration order (from the `UI_Manager_C` class export's inline property
list, or a complete `.usmap`), accumulating each property's serialized size
(float 4, double 8, bool 1, int 4, object ref 4, arrays/structs variable)
until `TauntCumAdd` is reached, then read its float. Alternatively, use
UAssetAPI with a working `.usmap` against the retoc legacy files (UAssetAPI
v1.1.0 could not read retoc's legacy header as-is — that route needs the
header issue resolved first).

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

## Parser gap (blocks full ubergraph parse)

The UI_Manager ubergraph script (export offset 13633, icode 25010, storage
34198) does **not** parse end-to-end with the session's kismet2 parser: it
fails at storage offset 53 with unhandled token **0x91 (145)**. The token
appears as the first operand of an `EX_BindDelegate` (0x61) at storage 52.
0x91 is not a standard EExprToken (named tokens stop at 0x6D = 109), so this
is either a parser misalignment just before that point or a newer token.
The `TauntCumAdd` reference above was found by targeted byte search instead
of a full parse. The GM ubergraph (187,685 bytes) is likewise unparsed.
Resolving the 0x91 token would unblock full ubergraph parsing for both
packages (and the frenzy-trigger bodies in the GM ubergraph).

## What this settles / leaves open for #48 (taunt)

- Settled: `TauntCumAdd` is the cum-meter increment applied on taunt, via
  `AddToCumMeter(TauntCumAdd)`. The player's taunt implementation does not
  yet model any cum-meter addition on taunt; when the value is pinned, the
  taunt handler should add it.
- Still open: the numeric value of `TauntCumAdd`; the dialogue
  selection/weighting; the "Hot Hands Modifier" notification (presentation
  gap, separate item).
