# Local voice packs

The native fanservice Viewer accepts user-provided recordings and captions in a
device-local folder. Recordings are optional and are not included in this project.
Missing recordings remain an explicit presentation gap.

Copy your pack to `%LOCALAPPDATA%/fanservice/VoicePacks/active`, or launch
`Start fanservice.cmd -VoicePack "C:\path\to\your\pack"`. Direct Unreal launches
accept `-FanserviceVoicePack="C:\path\to\your\pack"`. The launcher passes the
folder only when it contains `manifest.json`. The folder is never synchronized
or uploaded to a fanservice Server.

The manifest maps existing dialogue IDs to files and captions:

```json
{
  "version": 1,
  "lines": {
    "Generic_DefensiveItemUse_DLS": {
      "file": "defensive.wav",
      "caption": "Your chosen caption."
    }
  }
}
```

Recordings must be PCM WAV, signed 16-bit, mono or stereo, 8–48 kHz, at most
60 seconds and 8 MiB per line. Filenames must be in the same folder as the
manifest. The manifest is limited to 256 KiB. Captions are limited to 1,000
characters; captions are displayed through the existing notification route.
The existing voice volume and enabled settings still apply.

To retain voice-pack routing, add a `packs` object keyed by the game's canonical
voice-pack identifier; each entry contains its own `lines` object. A line may
also contain a `pronouns` object keyed by the reconstruction's existing pronoun
identifiers, with `file` and `caption` fields for that variant. Top-level `lines`
provide the fallback when no selected pack entry exists.

On mobile web/PWA and Android, open **Connection → Local voice pack**, select the
manifest and its WAV files together, then choose **Import local voice pack**.
Recordings stay in the device's IndexedDB storage. Choose a voice variant,
pronouns and volume in the same controls. Invalid imports preserve the previous
pack; missing recordings show a caption instead of silently substituting audio.
Browser eviction can remove these local files; retain your original pack.

Use the reconstruction's dialogue IDs rather than renaming events. User-provided
audio has no default license: retain the permissions and attribution belonging
to your own recordings. Headless browser checks verify WAV decode/play, captions,
reload, invalid-import rollback, missing recordings and no uploads. Physical
iPhone/Android audio output and picker behavior remain unperformed device checks.
