//! Snapshot-driven metronome using an independent native audio player.
use crate::music::{Command, MusicPlayer};
use avtohmver::session::{AudioConfig, SessionState, SessionStatus};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Default)]
struct CueCursor {
    session_id: String,
    sequence: u64,
}

impl CueCursor {
    fn select<'a>(
        &mut self,
        session_id: &str,
        now: u64,
        running: bool,
        cues: impl Iterator<Item = (u64, u64, &'a str, u8)>,
    ) -> Option<(&'a str, u8)> {
        if self.session_id != session_id {
            self.session_id = session_id.into();
            self.sequence = 0;
        }
        let previous = self.sequence;
        let mut selected = None;
        let mut newest = (0, 0);
        for (sequence, at, file, volume) in cues {
            self.sequence = self.sequence.max(sequence);
            if running
                && sequence > previous
                && at <= now
                && now - at <= 250
                && (at, sequence) > newest
            {
                newest = (at, sequence);
                selected = Some((file, volume));
            }
        }
        selected
    }
}

fn local_cue_path(file: &str) -> Result<PathBuf, String> {
    let drive_path = file.as_bytes().get(1) == Some(&b':')
        && file.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && matches!(file.as_bytes().get(2), Some(b'\\' | b'/'));
    if file.is_empty()
        || file.contains("://")
        || (file.contains(':') && !drive_path)
        || file.starts_with("\\\\")
        || file.starts_with("//")
    {
        return Err("Audio cue must name an existing local file".into());
    }
    let path = Path::new(file)
        .canonicalize()
        .map_err(|error| format!("Audio cue file unavailable: {error}"))?;
    if !path.is_file() || path.to_string_lossy().starts_with("\\\\?\\UNC\\") {
        return Err("Audio cue must name an existing local file".into());
    }
    Ok(path)
}

#[derive(Default)]
struct BeatClock {
    session_id: String,
    elapsed_ms: u64,
    offset_ms: i64,
    bpm: f64,
    phase: f64,
    running: bool,
    pattern: Vec<f64>,
}

impl BeatClock {
    fn update(&mut self, state: &SessionState) -> bool {
        let running = state.status == SessionStatus::Running && state.tempo.target_bpm > 0.0;
        let bpm = state.tempo.current_bpm;
        if !bpm.is_finite() || bpm <= 0.0 {
            self.running = false;
            return false;
        }
        let pattern = normalized_pattern(&state.tempo.pattern);
        let pattern_changed = self.pattern != pattern;
        let fresh =
            self.session_id != state.session_id || state.active_elapsed_ms < self.elapsed_ms;
        if fresh || pattern_changed {
            self.session_id.clone_from(&state.session_id);
            self.phase = 0.0;
            self.running = false;
            self.offset_ms = 0;
            self.pattern = pattern;
        }
        let was_running = self.running;
        let delta = if fresh {
            0
        } else {
            state.active_elapsed_ms - self.elapsed_ms
        };
        self.elapsed_ms = state.active_elapsed_ms;
        self.running = running;
        let before = pattern_position(self.phase, &self.pattern).0;
        let units: f64 = self
            .pattern
            .iter()
            .map(|value| if *value == 0.0 { 1.0 } else { *value })
            .sum();
        let notes = self.pattern.iter().filter(|value| **value > 0.0).count();
        let density = notes.max(1) as f64 / units;
        // Integrate the authoritative active clock. A delayed snapshot advances
        // phase once, never queues the intervening beats for playback.
        if running && was_running {
            self.phase += delta as f64 * (self.bpm + bpm) / (120_000.0 * density);
        }
        self.bpm = bpm;
        let offset_changed = self.offset_ms != state.tempo.offset_ms;
        self.phase += (i128::from(state.tempo.offset_ms) - i128::from(self.offset_ms)) as f64 * bpm
            / (60_000.0 * density);
        self.offset_ms = state.tempo.offset_ms;
        let (after, audible) = pattern_position(self.phase, &self.pattern);
        running && was_running && !offset_changed && after > before && audible
    }
}

fn normalized_pattern(pattern: &[f64]) -> Vec<f64> {
    if pattern.is_empty()
        || pattern.len() > 32
        || pattern.iter().all(|value| *value == 0.0)
        || pattern
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0 || *value > 8.0)
    {
        vec![1.0]
    } else {
        pattern.to_vec()
    }
}

fn pattern_position(phase: f64, pattern: &[f64]) -> (f64, bool) {
    let units: f64 = pattern
        .iter()
        .map(|value| if *value == 0.0 { 1.0 } else { *value })
        .sum();
    let cycle = (phase / units).floor();
    let within = phase.rem_euclid(units);
    let mut boundary = 0.0;
    for (index, note) in pattern.iter().enumerate() {
        boundary += if *note == 0.0 { 1.0 } else { *note };
        if within < boundary {
            let completed = (index + pattern.len() - 1) % pattern.len();
            return (
                cycle * pattern.len() as f64 + index as f64,
                pattern[completed] > 0.0,
            );
        }
    }
    (
        cycle * pattern.len() as f64,
        pattern[pattern.len() - 1] > 0.0,
    )
}

pub struct SessionAudio {
    clock: BeatClock,
    player: Option<MusicPlayer>,
    click: Option<tempfile::NamedTempFile>,
    config: Option<AudioConfig>,
    pending_error: Option<String>,
    sounding: bool,
    cue_cursor: CueCursor,
    cue_player: Option<MusicPlayer>,
    cue_sounding: bool,
}

impl Default for SessionAudio {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionAudio {
    pub fn new() -> Self {
        Self {
            clock: BeatClock::default(),
            player: None,
            click: None,
            config: None,
            pending_error: None,
            sounding: false,
            cue_cursor: CueCursor::default(),
            cue_player: None,
            cue_sounding: false,
        }
    }

    pub fn configure(&mut self, config: AudioConfig) {
        if !config.metronome_enabled || config.voice_volume_percent == 0 {
            self.silence();
        }
        self.config = Some(config);
    }

    pub fn update(&mut self, state: &SessionState) {
        self.configure(state.audio.clone());
        self.update_cues(state);
        let beat = self.clock.update(state);
        let config = self.config.as_ref().expect("audio configuration applied");
        if state.status != SessionStatus::Running
            || state.tempo.target_bpm == 0.0
            || !config.metronome_enabled
            || config.voice_volume_percent == 0
        {
            self.silence();
            return;
        }
        if !beat {
            return;
        }
        let volume = f64::from(config.voice_volume_percent.min(100)) / 100.0;
        if self.click.is_none() {
            match click_file() {
                Ok(file) => self.click = Some(file),
                Err(error) => {
                    self.pending_error = Some(format!("Metronome audio creation failed: {error}"));
                    return;
                }
            }
        }
        let player = self.player.get_or_insert_with(MusicPlayer::new);
        let path = self
            .click
            .as_ref()
            .unwrap()
            .path()
            .to_string_lossy()
            .into_owned();
        player.send(Command::Load(vec![path], volume));
        self.sounding = true;
    }

    fn silence(&mut self) {
        if self.sounding {
            if let Some(player) = &self.player {
                player.send(Command::Stop);
            }
            self.sounding = false;
        }
    }

    pub fn stop(&mut self) {
        self.silence();
        self.silence_cues();
        self.clock.running = false;
    }

    pub fn error(&mut self) -> Option<String> {
        self.pending_error
            .take()
            .or_else(|| self.player.as_ref().and_then(MusicPlayer::error))
            .or_else(|| self.cue_player.as_ref().and_then(MusicPlayer::error))
    }

    fn silence_cues(&mut self) {
        if self.cue_sounding {
            if let Some(player) = &self.cue_player {
                player.send(Command::Stop);
            }
            self.cue_sounding = false;
        }
    }

    fn update_cues(&mut self, state: &SessionState) {
        let running =
            state.status == SessionStatus::Running && state.audio.voice_volume_percent != 0;
        if !running || self.cue_cursor.session_id != state.session_id {
            self.silence_cues();
        }
        let cue = self.cue_cursor.select(
            &state.session_id,
            state.active_elapsed_ms,
            running,
            state.processor_outputs.iter().filter_map(|cue| {
                if let avtohmver::instructor_processor::ProcessorAction::Audio {
                    file,
                    volume_percent,
                } = &cue.output.action
                {
                    Some((
                        cue.sequence,
                        cue.output.at_active_ms,
                        file.as_str(),
                        *volume_percent,
                    ))
                } else {
                    None
                }
            }),
        );
        if let Some((file, volume)) = cue {
            match local_cue_path(file) {
                Ok(path) => {
                    self.cue_player
                        .get_or_insert_with(MusicPlayer::new)
                        .send(Command::Load(
                            vec![path.to_string_lossy().into_owned()],
                            f64::from(volume.min(100))
                                * f64::from(state.audio.voice_volume_percent.min(100))
                                / 10_000.0,
                        ));
                    self.cue_sounding = true;
                }
                Err(error) => {
                    self.silence_cues();
                    self.pending_error = Some(error);
                }
            }
        }
    }
}

impl Drop for SessionAudio {
    fn drop(&mut self) {
        self.stop();
    }
}

fn click_file() -> std::io::Result<tempfile::NamedTempFile> {
    const RATE: u32 = 44_100;
    const SAMPLES: u32 = RATE / 40;
    let mut file = tempfile::Builder::new().suffix(".wav").tempfile()?;
    let data_size = SAMPLES * 2;
    file.write_all(b"RIFF")?;
    file.write_all(&(36 + data_size).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&RATE.to_le_bytes())?;
    file.write_all(&(RATE * 2).to_le_bytes())?;
    file.write_all(&2u16.to_le_bytes())?;
    file.write_all(&16u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_size.to_le_bytes())?;
    for index in 0..SAMPLES {
        let time = f64::from(index) / f64::from(RATE);
        let attack = (f64::from(index) / 44.0).min(1.0);
        let envelope = (-time * 220.0).exp() * attack;
        let sample = ((time * 1_200.0 * std::f64::consts::TAU).sin() * envelope * 16_000.0) as i16;
        file.write_all(&sample.to_le_bytes())?;
    }
    file.flush()?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use avtohmver::session::{GameConfig, SessionCommand, SessionEngine};

    #[test]
    fn cue_cursor_selects_latest_once_and_discards_old_or_stopped_cues() {
        let mut cursor = CueCursor::default();
        let cues = [
            (1, 700, "old.wav", 50),
            (2, 950, "first.wav", 60),
            (3, 980, "last.wav", 70),
        ];
        assert_eq!(
            cursor.select("s", 1000, true, cues.into_iter()),
            Some(("last.wav", 70))
        );
        assert_eq!(cursor.select("s", 1000, true, cues.into_iter()), None);
        assert_eq!(
            cursor.select("s", 2000, true, [(4, 1500, "late.wav", 50)].into_iter()),
            None
        );
        assert_eq!(
            cursor.select("s", 2000, false, [(5, 2000, "paused.wav", 50)].into_iter()),
            None
        );
        assert_eq!(
            cursor.select("s", 2000, true, [(5, 2000, "paused.wav", 50)].into_iter()),
            None
        );
        assert_eq!(
            cursor.select("new", 1000, true, cues.into_iter()),
            Some(("last.wav", 70))
        );
    }

    #[test]
    fn cue_paths_reject_urls_network_paths_directories_and_missing_files() {
        for path in [
            "https://example.com/a.wav",
            "file:///a.wav",
            "lavfi:sine",
            "\\\\server\\a.wav",
            "//server/a.wav",
            "",
            "missing-cue-file.wav",
        ] {
            assert!(local_cue_path(path).is_err(), "{path}");
        }
        let directory = tempfile::tempdir().unwrap();
        assert!(local_cue_path(directory.path().to_str().unwrap()).is_err());
        let file = tempfile::NamedTempFile::new().unwrap();
        assert!(local_cue_path(file.path().to_str().unwrap()).is_ok());
    }

    fn state() -> SessionState {
        let mut engine = SessionEngine::new(GameConfig::quick_default()).unwrap();
        engine
            .dispatch(SessionCommand::Start { monotonic_ms: 0 })
            .state
    }

    #[test]
    fn beats_skip_delayed_intervals_and_duplicates() {
        let mut state = state();
        state.tempo.current_bpm = 120.0;
        let mut clock = BeatClock::default();
        assert!(!clock.update(&state));
        state.active_elapsed_ms = 500;
        assert!(clock.update(&state));
        assert!(!clock.update(&state));
        state.active_elapsed_ms = 10_000;
        assert!(clock.update(&state));
        assert!(!clock.update(&state));
    }

    #[test]
    fn rhythm_patterns_preserve_rests_and_reference_density() {
        let mut state = state();
        state.tempo.current_bpm = 120.0;
        state.tempo.pattern = vec![0.0, 0.5, 0.5];
        let mut clock = BeatClock::default();
        assert!(!clock.update(&state));
        state.active_elapsed_ms = 499;
        assert!(!clock.update(&state));
        state.active_elapsed_ms = 500;
        assert!(!clock.update(&state));
        state.active_elapsed_ms = 750;
        assert!(clock.update(&state));
        state.active_elapsed_ms = 1_000;
        assert!(clock.update(&state));
        state.active_elapsed_ms = 1_500;
        assert!(!clock.update(&state));
        state.tempo.pattern = vec![0.0];
        assert!(!clock.update(&state));
        state.active_elapsed_ms = 50_000;
        assert!(clock.update(&state));
    }

    #[test]
    fn malformed_patterns_fall_back_to_quarter_notes() {
        for pattern in [
            vec![],
            vec![0.0],
            vec![f64::NAN],
            vec![-1.0],
            vec![8.5],
            vec![1.0; 33],
        ] {
            assert_eq!(normalized_pattern(&pattern), vec![1.0]);
        }
        assert_eq!(normalized_pattern(&[0.0, 2.0]), vec![0.0, 2.0]);
    }

    #[test]
    fn pause_resume_and_terminal_snapshots_stay_silent() {
        let mut state = state();
        let mut clock = BeatClock::default();
        clock.update(&state);
        state.status = SessionStatus::Paused;
        assert!(!clock.update(&state));
        state.status = SessionStatus::Running;
        assert!(!clock.update(&state));
        state.status = SessionStatus::Completed;
        state.active_elapsed_ms = 100_000;
        assert!(!clock.update(&state));
    }

    #[test]
    fn silence_preserves_fractional_beat_and_rest_freezes_it() {
        let mut state = state();
        state.tempo.current_bpm = 120.0;
        state.tempo.target_bpm = 120.0;
        let mut audio = SessionAudio::new();
        audio.clock.update(&state);
        state.active_elapsed_ms = 250;
        assert!(!audio.clock.update(&state));
        let phase = audio.clock.phase;
        audio.stop();
        assert_eq!(audio.clock.phase, phase);
        state.tempo.target_bpm = 0.0;
        state.active_elapsed_ms = 10_000;
        assert!(!audio.clock.update(&state));
        assert_eq!(audio.clock.phase, phase);
        state.tempo.target_bpm = 120.0;
        assert!(!audio.clock.update(&state));
        state.active_elapsed_ms = 10_250;
        assert!(audio.clock.update(&state));
    }

    #[test]
    fn generated_click_is_complete_pcm_wave() {
        let file = click_file().unwrap();
        let bytes = std::fs::read(file.path()).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(bytes.len(), 44 + (44_100 / 40) * 2);
    }
}
