# AvtoHmver release language

Terms used to decide whether a product edition and release have reached parity.

## Language

**Included parity area**:
A capability in the parity ledger that applies to Host, Viewer, Server, or Viewer+ and has not been expressly excluded from the current release scope.
_Avoid_: Beta checklist item

**Parity acceptance**:
Evidence that an included parity area works in its intended editions and required environments.
_Avoid_: Implemented code, passing unit tests

**Release gate**:
The complete set of acceptance results required for the combined AvtoHmver and Fanservice release before a version is tagged and published.
_Avoid_: Beta checklist

**Pinned checkpoint**:
A classifier model file whose expected bytes and official source identity are recorded with the release.
_Avoid_: Any downloaded model

**On-device Viewer+ data**:
The Android Viewer+ user's locally saved profile, settings, media, and snapshots, including data unavailable from the Host.
_Avoid_: Pack export

**Viewer**:
The native desktop client that connects to a Host library without owning that library.
_Avoid_: Viewer+

**Viewer+**:
The Android phone client with its own on-device media, snapshots, and game profile.
_Avoid_: Viewer

**Compatibility mode**:
The state in which an upgraded Viewer+ keeps its existing on-device data usable while a required migration is pending or can be retried.

**Classifier acceptance set**:
Locally held video clips with known position labels and neutral controls used to check P-HAR inference and automatic tagging before release.
_Avoid_: Production library, bundled training data

**RGB P-HAR**:
The official P-HAR video classifier using its RGB model without the optional pose and audio models.
_Avoid_: Image position classifier

**Web app**
The Fanservice experience used in a web browser or installed from the website on a phone or computer.
_Avoid_ — Viewer+ when referring to browser use.

**Android app**
The installable Fanservice phone app for Android, with its own saved media, snapshots and game profile.
_Avoid_ — Viewer+ in the combined release plan.

**Windows game mod**
The Fanservice integration used inside the original Cock Hero game on Windows.
_Avoid_ — Viewer when the intended meaning is the game integration.

**Holding hand**
The hand selected as holding the phone during gameplay, used to place item buttons on the opposite side.
_Avoid_ — Handedness when it could mean the hand pressing buttons.
