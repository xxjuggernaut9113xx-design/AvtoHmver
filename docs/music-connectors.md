# Music controls and acceptance limits

Local browser audio and native libmpv audio follow shared Pause. Automatic
track advancement waits for Resume, and a manual music pause remains paused.
Music playback owns its own clock and does not advance the session clock.

The browser uses the official [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
and [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget)
for embedded play, pause, volume and seek. Provider events stop late playback
while shared Pause is active. Resume restarts only controllers that were
running or explicitly requested. The player is destroyed and its listeners
removed when its setup sheet closes, the provider changes, or playback stops.
SDK readiness has a bounded timeout; failed or blocked embeds show an error
and retain the provider's direct link. SoundCloud seeks convert seconds to
the documented millisecond API units.

Apple Music uses the existing [MusicKit JS](https://js-cdn.music.apple.com/musickit/v3/docs/index.html)
authorization and developer-token configuration. Its controller joins shared
Pause before playback is requested. Playback-state events stop late SDK play,
and teardown removes listeners, stops playback and unauthorizes. Closing or
replacing the setup invalidates pending authorization/setup results. Missing
SDK controls or authorization failures retain the direct provider link.

Spotify remains external: no Spotify player OAuth application or Premium
playback integration is configured in this build. Native external references
open in the provider application; AvtoHmver cannot pause another application's
player. These paths must not be labeled synchronized native connectors.

Mocked SDK tests verify controller pause/resume selection, late events, manual
pause, units and teardown. Real provider autoplay, playlist end boundaries,
authorization/revocation and embedded playback remain manual acceptance gates.
The SDKs own their internal playlists; mocked tests do not prove their behavior
at every provider-owned end boundary. External-provider native references retain
the explicit limitations above.

Native GOON setup now includes imported-track selection, cancellable FFmpeg
analysis, a marker timeline, BPM and offset edits, marker edits, and explicit
human confirmation. Invalid or unordered markers are rejected before writing.
Rescanning uses the existing map identity even when no playlist is assigned.
Cancellation kills and reaps the decoder and does not save an unfinished map.
Choose **Use confirmed map for music sync** after saving confirmation. Native
session cues then follow the matching local track's libmpv audio position.
The offset aligns the first marker; an empty marker list uses the reviewed
BPM grid. Other tracks use session tempo. **Use session tempo** clears the
mapping without changing music playback. Seeking and track replacement reset
the cue cursor, manual music pause suppresses synchronized cues, and delayed
updates never queue catch-up beats. Shared Pause and panic silence cues
immediately. Fixture tests cover these boundaries; real audio and native UI
acceptance are recorded separately from those tests.
