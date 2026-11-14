//! A dedicated audio-only libmpv worker. It never shares the visual player.
use crate::mpv_embed::{MpvInstance, PlayerEvent};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};

#[derive(Clone, Default)]
pub struct PlaybackSnapshot {
    pub revision: u64,
    pub path: String,
    pub position: f64,
    pub paused: bool,
    pub active: bool,
}

pub fn track_key(raw: &str) -> String {
    let value = std::path::Path::new(raw)
        .canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| raw.into());
    let value = value.strip_prefix(r"\\?\").unwrap_or(&value).to_string();
    #[cfg(windows)]
    let value = value.to_lowercase();
    value
}
pub enum Command {
    Load(Vec<String>, f64),
    Pause(bool),
    Seek(f64),
    Volume(f64),
    Stop,
}
pub struct MusicPlayer {
    tx: mpsc::Sender<Command>,
    errors: mpsc::Receiver<String>,
    suspended: Arc<AtomicBool>,
    snapshot: Arc<Mutex<PlaybackSnapshot>>,
}
impl Default for MusicPlayer {
    fn default() -> Self {
        Self::new()
    }
}
impl MusicPlayer {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        let (errors_tx, errors) = mpsc::channel();
        let suspended = Arc::new(AtomicBool::new(false));
        let worker_suspended = suspended.clone();
        let snapshot = Arc::new(Mutex::new(PlaybackSnapshot::default()));
        let worker_snapshot = snapshot.clone();
        std::thread::spawn(move || {
            let mut player: Option<MpvInstance> = None;
            let mut tracks = vec![];
            let mut index = 0;
            let mut manually_paused = false;
            let mut applied_pause = false;
            let mut pending_end = false;
            let mut loaded = false;
            let mut revision = 0u64;
            let mut track_keys = Vec::new();
            loop {
                match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    Ok(command) => {
                        let result = (|| -> Result<(), String> {
                            match command {
                                Command::Load(paths, volume) => {
                                    if paths.is_empty() {
                                        return Err("Playlist has no tracks".into());
                                    }
                                    if player.is_none() {
                                        player = Some(MpvInstance::create_audio()?);
                                    }
                                    tracks = paths;
                                    track_keys = tracks
                                        .iter()
                                        .map(|path| track_key(path))
                                        .collect::<Vec<_>>();
                                    revision = revision.wrapping_add(1);
                                    index = 0;
                                    pending_end = false;
                                    loaded = false;
                                    manually_paused = false;
                                    let p = player.as_mut().unwrap();
                                    p.set_property("volume", &(volume * 100.0).to_string())?;
                                    p.command(&["loadfile", &tracks[0], "replace"])?;
                                    applied_pause = worker_suspended.load(Ordering::Acquire);
                                    p.set_property(
                                        "pause",
                                        if applied_pause { "yes" } else { "no" },
                                    )
                                }
                                Command::Pause(paused) => {
                                    manually_paused = paused;
                                    applied_pause =
                                        paused || worker_suspended.load(Ordering::Acquire);
                                    player.as_mut().ok_or("No active music")?.set_property(
                                        "pause",
                                        if applied_pause { "yes" } else { "no" },
                                    )
                                }
                                Command::Seek(seconds) => {
                                    revision = revision.wrapping_add(1);
                                    player.as_mut().ok_or("No active music")?.command(&[
                                        "seek",
                                        &seconds.to_string(),
                                        "absolute",
                                    ])
                                }
                                Command::Volume(v) => {
                                    player.as_mut().ok_or("No active music")?.set_property(
                                        "volume",
                                        &(v.clamp(0.0, 1.0) * 100.0).to_string(),
                                    )
                                }
                                Command::Stop => {
                                    tracks.clear();
                                    track_keys.clear();
                                    revision = revision.wrapping_add(1);
                                    pending_end = false;
                                    loaded = false;
                                    if let Some(p) = player.as_mut() {
                                        p.command(&["stop"])?;
                                    }
                                    Ok(())
                                }
                            }
                        })();
                        if let Err(e) = result {
                            let _ = errors_tx.send(e);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if let Some(p) = player.as_mut() {
                    let paused = manually_paused || worker_suspended.load(Ordering::Acquire);
                    if paused != applied_pause {
                        applied_pause = paused;
                        if let Err(e) = p.set_property("pause", if paused { "yes" } else { "no" }) {
                            let _ = errors_tx.send(e);
                        }
                    }
                    while let Some(event) = p.next_event() {
                        match event {
                            PlayerEvent::FileLoaded => loaded = true,
                            PlayerEvent::EndFile { eof: true, .. } if loaded => {
                                loaded = false;
                                pending_end = true;
                            }
                            PlayerEvent::EndFile { failed: true, .. } => {
                                let _ = errors_tx.send(
                                    "Music decoding failed. Retry or import a compatible file."
                                        .into(),
                                );
                            }
                            _ => {}
                        }
                    }
                    if pending_end && !paused {
                        pending_end = false;
                        index += 1;
                        if let Some(path) = tracks.get(index) {
                            revision = revision.wrapping_add(1);
                            loaded = false;
                            if let Err(e) = p.command(&["loadfile", path, "replace"]) {
                                let _ = errors_tx.send(e);
                            }
                        }
                    }
                    let position = p
                        .property("time-pos")
                        .ok()
                        .and_then(|value| value.parse::<f64>().ok())
                        .filter(|value| value.is_finite() && *value >= 0.0)
                        .unwrap_or(0.0);
                    *worker_snapshot
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()) = PlaybackSnapshot {
                        revision,
                        path: track_keys.get(index).cloned().unwrap_or_default(),
                        position,
                        paused,
                        active: loaded && !pending_end && index < tracks.len(),
                    };
                }
            }
        });
        Self {
            tx,
            errors,
            suspended,
            snapshot,
        }
    }
    pub fn suspend(&self, paused: bool) {
        self.suspended.store(paused, Ordering::Release);
    }
    pub fn send(&self, command: Command) {
        let _ = self.tx.send(command);
    }
    pub fn error(&self) -> Option<String> {
        self.errors.try_recv().ok()
    }
    pub fn snapshot(&self) -> PlaybackSnapshot {
        let mut snapshot = self
            .snapshot
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        snapshot.paused |= self.suspended.load(Ordering::Acquire);
        snapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{Duration, Instant};

    fn write_neutral_wav(path: &std::path::Path) {
        const RATE: u32 = 22_050;
        const SECONDS: u32 = 8;
        let sample_count = RATE * SECONDS;
        let data_len = sample_count * 2;
        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36 + data_len).to_le_bytes()).unwrap();
        file.write_all(b"WAVEfmt ").unwrap();
        file.write_all(&16_u32.to_le_bytes()).unwrap();
        file.write_all(&1_u16.to_le_bytes()).unwrap();
        file.write_all(&1_u16.to_le_bytes()).unwrap();
        file.write_all(&RATE.to_le_bytes()).unwrap();
        file.write_all(&(RATE * 2).to_le_bytes()).unwrap();
        file.write_all(&2_u16.to_le_bytes()).unwrap();
        file.write_all(&16_u16.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_len.to_le_bytes()).unwrap();
        for index in 0..sample_count {
            let phase = (index * 440) % RATE;
            let sample: i16 = if phase < RATE / 2 { 1_000 } else { -1_000 };
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
        file.flush().unwrap();
    }

    fn wait_for_snapshot(
        player: &MusicPlayer,
        label: &str,
        mut ready: impl FnMut(&PlaybackSnapshot) -> bool,
    ) -> PlaybackSnapshot {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let snapshot = player.snapshot();
            if ready(&snapshot) {
                return snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {label}: active={}, position={}, revision={}",
                snapshot.active,
                snapshot.position,
                snapshot.revision
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    #[ignore = "requires CURATOR_LIBMPV_PATH set to a staged libmpv DLL"]
    fn live_music_player_clock_pause_failure_and_retry() {
        let libmpv = std::env::var_os("CURATOR_LIBMPV_PATH")
            .expect("set CURATOR_LIBMPV_PATH to the staged libmpv DLL");
        assert!(std::path::Path::new(&libmpv).is_file());

        let directory = tempfile::tempdir().unwrap();
        let track = directory.path().join("neutral.wav");
        let missing = directory.path().join("missing.wav");
        write_neutral_wav(&track);

        let player = MusicPlayer::new();
        player.send(Command::Load(
            vec![track.to_string_lossy().into_owned()],
            0.0,
        ));
        let first = wait_for_snapshot(&player, "initial audio clock", |snapshot| {
            snapshot.active && snapshot.position >= 0.25
        });
        assert_eq!(first.path, track_key(&track.to_string_lossy()));

        player.suspend(true);
        std::thread::sleep(Duration::from_millis(300));
        let paused_at = player.snapshot();
        assert!(paused_at.paused && paused_at.active);
        std::thread::sleep(Duration::from_millis(250));
        let paused_after = player.snapshot();
        assert!(
            (paused_after.position - paused_at.position).abs() <= 0.08,
            "music advanced while paused: {} -> {}",
            paused_at.position,
            paused_after.position
        );

        player.suspend(false);
        let resumed = wait_for_snapshot(&player, "audio clock after Resume", |snapshot| {
            snapshot.active && snapshot.position >= paused_after.position + 0.15
        });
        assert_eq!(resumed.revision, first.revision);

        player.send(Command::Load(
            vec![missing.to_string_lossy().into_owned()],
            0.0,
        ));
        let deadline = Instant::now() + Duration::from_secs(5);
        let error = loop {
            if let Some(error) = player.error() {
                break error;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for the failed track error"
            );
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(
            error.contains("Music decoding failed"),
            "unexpected mpv error: {error}"
        );
        let failed = wait_for_snapshot(&player, "failed track state", |snapshot| {
            !snapshot.active && snapshot.path == track_key(&missing.to_string_lossy())
        });
        assert!(failed.revision > resumed.revision);

        player.send(Command::Load(
            vec![track.to_string_lossy().into_owned()],
            0.0,
        ));
        let recovered = wait_for_snapshot(&player, "explicit music retry", |snapshot| {
            snapshot.active && snapshot.position >= 0.25 && snapshot.revision > failed.revision
        });
        assert_eq!(recovered.path, first.path);

        player.send(Command::Stop);
    }
}
