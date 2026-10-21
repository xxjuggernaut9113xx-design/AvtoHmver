//! Embedded libmpv player bridge.
//!
//! A dedicated worker owns the libmpv handle and its software render context.
//! The UI sends bounded commands and drains bounded status/frame updates, so
//! decoding can never run on the Slint event loop or create a second window.

use crate::mpv_embed::{MpvInstance, PlayerEvent};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[cfg(test)]
use std::sync::Mutex;

const COMMAND_QUEUE_CAPACITY: usize = 32;
const STATUS_QUEUE_CAPACITY: usize = 32;
const FRAME_QUEUE_CAPACITY: usize = 1;
const RENDER_WIDTH: u32 = 960;
const RENDER_HEIGHT: u32 = 540;

#[derive(Debug, Clone)]
pub enum PlayerCommand {
    Load {
        source: String,
        volume: f64,
        speed: f64,
        looping: bool,
    },
    SetPaused(bool),
    Seek(f64),
    SetVolume(f64),
    SetSpeed(f64),
    SetLoop(bool),
    Stop,
    Shutdown,
}

#[derive(Debug, Clone, Default)]
pub struct PlayerStatus {
    pub loading: bool,
    pub failed: bool,
    pub message: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: f64,
    pub speed: f64,
    pub paused: bool,
    pub looping: bool,
    pub ended: bool,
}

impl PlayerStatus {
    fn loading() -> Self {
        Self {
            loading: true,
            message: "Loading embedded player…".into(),
            volume: 100.0,
            speed: 1.0,
            ..Self::default()
        }
    }
}

type FrameCallback = Box<dyn Fn(Vec<u8>, u32, u32)>;

enum WorkerEvent {
    FileLoaded(u64),
    AudioReady(u64),
    StartupError(String),
    EndFile {
        generation: u64,
        eof: bool,
        failed: bool,
    },
    Progress {
        generation: u64,
        position_secs: Option<f64>,
        duration_secs: Option<f64>,
        paused: Option<bool>,
    },
    Error(u64, String),
}

struct VideoFrame {
    generation: u64,
    pixels: Vec<u8>,
    width: u32,
    height: u32,
}

struct WorkerCommand {
    generation: u64,
    command: PlayerCommand,
    clip_range: Option<(f64, f64)>,
}

pub struct NativePlayer {
    clip_range: Option<(f64, f64)>,
    render_size: (u32, u32),
    suspended: Arc<AtomicBool>,
    suspended_since: Option<Instant>,
    loading_since: Option<Instant>,
    commands: Option<SyncSender<WorkerCommand>>,
    statuses: Option<Receiver<WorkerEvent>>,
    frames: Option<Receiver<VideoFrame>>,
    worker: Option<JoinHandle<()>>,
    frame_callback: Option<FrameCallback>,
    status: PlayerStatus,
    /// A file must report `file-loaded` before an EOF can advance the queue.
    /// This drops end events that belong to a file just replaced by Load.
    loaded: bool,
    /// Incremented whenever the active media is replaced or stopped. Worker
    /// output from an older generation is discarded on the UI thread.
    generation: u64,
}

impl Default for NativePlayer {
    fn default() -> Self {
        Self {
            clip_range: None,
            render_size: (RENDER_WIDTH, RENDER_HEIGHT),
            commands: None,
            statuses: None,
            frames: None,
            worker: None,
            frame_callback: None,
            status: PlayerStatus {
                message: "Choose media to play".into(),
                volume: 100.0,
                speed: 1.0,
                ..PlayerStatus::default()
            },
            loaded: false,
            generation: 0,
            suspended: Arc::new(AtomicBool::new(false)),
            suspended_since: None,
            loading_since: None,
        }
    }
}

impl NativePlayer {
    pub fn set_clip_range(&mut self, start: Option<f64>, end: Option<f64>) -> Result<(), String> {
        self.clip_range = match (start, end) {
            (None, None) => None,
            (Some(start), Some(end))
                if start.is_finite() && end.is_finite() && start >= 0.0 && end > start =>
            {
                Some((start, end))
            }
            _ => return Err("Clip has an invalid saved playback range".into()),
        };
        Ok(())
    }
    pub fn portrait() -> Self {
        let mut player = Self::default();
        player.render_size = (480, 960);
        player
    }
    /// Out-of-band safety state cannot be lost behind a full command queue.
    pub fn suspend(&mut self, value: bool) {
        if value && self.suspended_since.is_none() {
            self.suspended_since = Some(Instant::now());
        }
        if !value {
            if let Some(since) = self.suspended_since.take() {
                if let Some(start) = &mut self.loading_since {
                    *start += since.elapsed();
                }
            }
        }
        self.suspended.store(value, Ordering::SeqCst);
    }

    pub fn status(&self) -> PlayerStatus {
        self.status.clone()
    }

    pub fn set_frame_callback(&mut self, callback: FrameCallback) {
        self.frame_callback = Some(callback);
    }

    fn mark_loading(&mut self) {
        self.loaded = false;
        self.status.ended = false;
    }

    fn start(&mut self) -> Result<(), String> {
        if self.commands.is_some() {
            return Ok(());
        }
        let (commands, command_rx) = mpsc::sync_channel(COMMAND_QUEUE_CAPACITY);
        let (status_tx, statuses) = mpsc::sync_channel(STATUS_QUEUE_CAPACITY);
        let (frame_tx, frames) = mpsc::sync_channel(FRAME_QUEUE_CAPACITY);
        let suspended = self.suspended.clone();
        let worker = thread::Builder::new()
            .name("curator-libmpv".into())
            .spawn({
                let render_size = self.render_size;
                move || player_worker(command_rx, status_tx, frame_tx, suspended, render_size)
            })
            .map_err(|error| format!("Could not start embedded player worker: {error}"))?;
        self.commands = Some(commands);
        self.statuses = Some(statuses);
        self.frames = Some(frames);
        self.worker = Some(worker);
        Ok(())
    }

    fn send(&mut self, command: PlayerCommand) -> Result<(), String> {
        let sender = self
            .commands
            .as_ref()
            .ok_or_else(|| "Embedded player is unavailable".to_owned())?;
        match sender.try_send(WorkerCommand {
            generation: self.generation,
            command,
            clip_range: self.clip_range,
        }) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err("Embedded player is busy; retry shortly".into()),
            Err(TrySendError::Disconnected(_)) => {
                Err("Embedded player stopped unexpectedly".into())
            }
        }
    }

    fn teardown(&mut self) {
        if let Some(sender) = self.commands.take() {
            let _ = sender.try_send(WorkerCommand {
                generation: self.generation,
                command: PlayerCommand::Shutdown,
                clip_range: None,
            });
        }
        self.statuses.take();
        self.frames.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }

    pub fn apply(&mut self, command: PlayerCommand) -> PlayerStatus {
        let result = match command.clone() {
            PlayerCommand::Load {
                volume,
                speed,
                looping,
                ..
            } => {
                if self
                    .worker
                    .as_ref()
                    .is_some_and(|worker| worker.is_finished())
                {
                    self.teardown();
                }
                self.generation = self.generation.wrapping_add(1);
                self.mark_loading();
                self.status = PlayerStatus::loading();
                self.loading_since = Some(Instant::now());
                self.status.volume = volume.clamp(0.0, 100.0);
                self.status.speed = speed.clamp(0.25, 4.0);
                self.status.looping = looping;
                self.start().and_then(|_| self.send(command))
            }
            PlayerCommand::SetPaused(paused) => {
                self.status.paused = paused;
                self.send(command)
            }
            PlayerCommand::Seek(position) => {
                let position = if let Some((start, end)) = self.clip_range {
                    position.clamp(0.0, end - start)
                } else {
                    position.max(0.0)
                };
                self.status.position_secs = position;
                self.send(PlayerCommand::Seek(
                    position + self.clip_range.map_or(0.0, |range| range.0),
                ))
            }
            PlayerCommand::SetVolume(volume) => {
                self.status.volume = volume.clamp(0.0, 100.0);
                self.send(command)
            }
            PlayerCommand::SetSpeed(speed) => {
                self.status.speed = speed.clamp(0.25, 4.0);
                self.send(command)
            }
            PlayerCommand::SetLoop(looping) => {
                self.status.looping = looping;
                self.send(command)
            }
            PlayerCommand::Stop => {
                self.generation = self.generation.wrapping_add(1);
                self.mark_loading();
                self.status.message = "Stopped".into();
                self.status.loading = false;
                self.status.failed = false;
                self.loading_since = None;
                self.status.position_secs = 0.0;
                self.send(command)
            }
            PlayerCommand::Shutdown => {
                self.teardown();
                self.status.message = "Stopped".into();
                Ok(())
            }
        };
        if let Err(error) = result {
            self.status.message = error;
            self.status.loading = false;
            self.status.failed = true;
            self.loading_since = None;
        }
        self.status()
    }

    /// Drains player state and at most one newest frame on the Slint thread.
    pub fn drain_events(&mut self) -> Vec<PlayerStatus> {
        let mut updates = Vec::new();
        if let Some(statuses) = &self.statuses {
            loop {
                match statuses.try_recv() {
                    Ok(WorkerEvent::FileLoaded(generation)) if generation == self.generation => {
                        self.loaded = true;
                        self.status.ended = false;
                        self.status.position_secs = 0.0;
                        self.status.message = "Playing".into();
                        updates.push(self.status());
                    }
                    Ok(WorkerEvent::AudioReady(generation)) if generation == self.generation => {
                        self.status.loading = false;
                        self.loading_since = None;
                        updates.push(self.status());
                    }
                    Ok(WorkerEvent::StartupError(error)) => {
                        self.status.message = error;
                        self.status.loading = false;
                        self.status.failed = true;
                        self.loading_since = None;
                        updates.push(self.status());
                    }
                    Ok(WorkerEvent::EndFile {
                        generation,
                        eof,
                        failed,
                    }) if generation == self.generation => {
                        if failed {
                            self.status.message = "Playback error".into();
                            self.status.failed = true;
                            self.status.loading = false;
                            self.loading_since = None;
                        } else if eof && self.loaded {
                            self.status.ended = true;
                            self.status.message = "Finished".into();
                        }
                        updates.push(self.status());
                    }
                    Ok(WorkerEvent::Progress {
                        generation,
                        position_secs,
                        duration_secs,
                        paused,
                    }) if generation == self.generation => {
                        if let Some(position_secs) = position_secs {
                            self.status.position_secs =
                                self.clip_range.map_or(position_secs, |(start, end)| {
                                    (position_secs - start).clamp(0.0, end - start)
                                });
                        }
                        if let Some(duration_secs) = duration_secs {
                            self.status.duration_secs = self
                                .clip_range
                                .map_or(duration_secs, |(start, end)| end - start);
                        }
                        if let Some(paused) = paused {
                            self.status.paused = paused;
                        }
                        updates.push(self.status());
                    }
                    Ok(WorkerEvent::Error(generation, error)) if generation == self.generation => {
                        self.status.message = error;
                        self.status.failed = true;
                        self.status.loading = false;
                        self.loading_since = None;
                        updates.push(self.status());
                    }
                    Ok(_) => {}
                    Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
                }
            }
        }
        let mut newest = None;
        if let Some(frames) = &self.frames {
            while let Ok(frame) = frames.try_recv() {
                if frame.generation == self.generation {
                    newest = Some(frame);
                }
            }
        }
        if let Some(frame) = newest {
            if let Some(callback) = &self.frame_callback {
                callback(frame.pixels, frame.width, frame.height);
            }
            if self.status.loading {
                self.status.loading = false;
                self.status.message = "Playing".into();
                self.loading_since = None;
                updates.push(self.status());
            }
        }
        if !self.suspended.load(Ordering::SeqCst)
            && self
                .loading_since
                .is_some_and(|started| started.elapsed() >= Duration::from_secs(30))
        {
            self.generation = self.generation.wrapping_add(1);
            let _ = self.send(PlayerCommand::Stop);
            self.status.loading = false;
            self.status.failed = true;
            self.status.message =
                "Playback did not become ready within 30 seconds. Retry or skip this file.".into();
            self.loading_since = None;
            updates.push(self.status());
        }
        updates
    }
}

impl Drop for NativePlayer {
    fn drop(&mut self) {
        self.teardown();
    }
}

fn player_worker(
    commands: Receiver<WorkerCommand>,
    statuses: SyncSender<WorkerEvent>,
    frames: SyncSender<VideoFrame>,
    suspended: Arc<AtomicBool>,
    render_size: (u32, u32),
) {
    let mut instance = match MpvInstance::create() {
        Ok(instance) => instance,
        Err(error) => {
            let _ = statuses.try_send(WorkerEvent::StartupError(error));
            return;
        }
    };
    let mut renderer = match instance.create_renderer(render_size.0, render_size.1) {
        Ok(renderer) => renderer,
        Err(error) => {
            let _ = statuses.try_send(WorkerEvent::StartupError(error));
            return;
        }
    };
    let mut last_poll = Instant::now() - Duration::from_millis(100);
    let mut generation = 0;
    let mut render_ready = false;
    let mut was_suspended = false;
    let mut restore_volume = 100.0;
    let mut restore_paused = false;
    loop {
        match commands.recv_timeout(Duration::from_millis(16)) {
            Ok(WorkerCommand {
                command: PlayerCommand::Shutdown,
                ..
            })
            | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Ok(command) => {
                generation = command.generation;
                if matches!(
                    &command.command,
                    PlayerCommand::Load { .. } | PlayerCommand::Stop
                ) {
                    render_ready = false;
                }
                if let Err(error) =
                    apply_worker_command(&mut instance, command.command, command.clip_range)
                {
                    let _ = statuses.try_send(WorkerEvent::Error(generation, error));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let hidden = suspended.load(Ordering::SeqCst);
        if hidden {
            if !was_suspended {
                restore_volume = instance
                    .property("volume")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(100.0);
                restore_paused = instance.property("pause").is_ok_and(|value| value == "yes");
            }
            let _ = instance.set_property("pause", "yes");
            let _ = instance.set_property("mute", "yes");
        } else if was_suspended {
            let _ = instance.set_property("volume", &restore_volume.to_string());
            let _ = instance.set_property("mute", "no");
            let _ = instance.set_property("pause", if restore_paused { "yes" } else { "no" });
        }
        was_suspended = hidden;
        while let Some(event) = instance.next_event() {
            match event {
                PlayerEvent::FileLoaded => {
                    render_ready = true;
                    let _ = statuses.try_send(WorkerEvent::FileLoaded(generation));
                    if instance
                        .property("vid")
                        .is_ok_and(|value| matches!(value.as_str(), "no" | "false" | "0"))
                    {
                        let _ = statuses.try_send(WorkerEvent::AudioReady(generation));
                    }
                }
                PlayerEvent::EndFile { eof, failed } => {
                    let _ = statuses.try_send(WorkerEvent::EndFile {
                        generation,
                        eof,
                        failed,
                    });
                }
                PlayerEvent::Shutdown => return,
            }
        }
        if render_ready && last_poll.elapsed() >= Duration::from_millis(100) {
            last_poll = Instant::now();
            let position_secs = instance
                .property("time-pos")
                .ok()
                .and_then(|value| value.parse::<f64>().ok());
            let duration_secs = instance
                .property("duration")
                .ok()
                .and_then(|value| value.parse::<f64>().ok());
            let paused = instance
                .property("pause")
                .ok()
                .and_then(|value| match value.as_str() {
                    "yes" | "true" | "1" => Some(true),
                    "no" | "false" | "0" => Some(false),
                    _ => None,
                });
            if position_secs.is_some() || duration_secs.is_some() || paused.is_some() {
                let _ = statuses.try_send(WorkerEvent::Progress {
                    generation,
                    position_secs,
                    duration_secs,
                    paused,
                });
            }
        }
        if !render_ready {
            continue;
        }
        match renderer.render() {
            Ok(true) => {
                let (pixels, width, height) = renderer.frame();
                let _ = frames.try_send(VideoFrame {
                    generation,
                    pixels: pixels.to_vec(),
                    width,
                    height,
                });
            }
            Ok(false) => {}
            Err(error) => {
                let _ = statuses.try_send(WorkerEvent::Error(generation, error));
                break;
            }
        }
    }
}

fn apply_worker_command(
    instance: &mut MpvInstance,
    command: PlayerCommand,
    clip_range: Option<(f64, f64)>,
) -> Result<(), String> {
    match command {
        PlayerCommand::Load {
            source,
            volume,
            speed,
            looping,
        } => {
            instance.set_property("volume", &volume.clamp(0.0, 100.0).to_string())?;
            instance.set_property("speed", &speed.clamp(0.25, 4.0).to_string())?;
            instance.set_property("loop-file", if looping { "inf" } else { "no" })?;
            if let Some((start, end)) = clip_range {
                instance.command(&[
                    "loadfile",
                    &source,
                    "replace",
                    "-1",
                    &format!("start={start},end={end}"),
                ])
            } else {
                instance.command(&["loadfile", &source, "replace"])
            }
        }
        PlayerCommand::SetPaused(paused) => {
            instance.set_property("pause", if paused { "yes" } else { "no" })
        }
        PlayerCommand::Seek(position) => {
            instance.set_property("time-pos", &position.max(0.0).to_string())
        }
        PlayerCommand::SetVolume(volume) => {
            instance.set_property("volume", &volume.clamp(0.0, 100.0).to_string())
        }
        PlayerCommand::SetSpeed(speed) => {
            instance.set_property("speed", &speed.clamp(0.25, 4.0).to_string())
        }
        PlayerCommand::SetLoop(looping) => {
            instance.set_property("loop-file", if looping { "inf" } else { "no" })
        }
        PlayerCommand::Stop => instance.command(&["stop"]),
        PlayerCommand::Shutdown => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_clip_ranges_reject_invalid_bounds_and_reset_for_physical_media() {
        let mut player = NativePlayer::default();
        for (start, end) in [
            (0.0, 0.0),
            (-1.0, 2.0),
            (2.0, 1.0),
            (f64::NAN, 2.0),
            (0.0, f64::INFINITY),
        ] {
            assert!(player.set_clip_range(Some(start), Some(end)).is_err());
        }
        assert!(player.set_clip_range(Some(0.0), None).is_err());
        player.set_clip_range(Some(0.5), Some(1.5)).unwrap();
        assert_eq!(player.clip_range, Some((0.5, 1.5)));
        player.set_clip_range(None, None).unwrap();
        assert_eq!(player.clip_range, None);
    }
    #[test]
    #[ignore = "requires CURATOR_LIBMPV_PATH and a disposable video longer than two seconds"]
    fn virtual_clip_range_survives_pause_and_does_not_leak_into_next_video() {
        let _environment = LIBMPV_ENV.lock().unwrap();
        let source = avtohmver::config::env_var("CURATOR_LIVE_RENDERER_MEDIA").unwrap();
        let mut player = NativePlayer::default();
        player.set_frame_callback(Box::new(|_, _, _| {}));
        player.set_clip_range(Some(0.5), Some(1.5)).unwrap();
        player.apply(PlayerCommand::Load {
            source: source.clone(),
            volume: 0.0,
            speed: 1.0,
            looping: false,
        });
        let deadline = Instant::now() + Duration::from_secs(8);
        while player.status().position_secs < 0.1 && !player.status().failed {
            assert!(Instant::now() < deadline, "{:?}", player.status());
            thread::sleep(Duration::from_millis(20));
            player.drain_events();
        }
        assert!(!player.status().failed, "{:?}", player.status());
        player.suspend(true);
        thread::sleep(Duration::from_millis(200));
        player.drain_events();
        let position = player.status().position_secs;
        thread::sleep(Duration::from_millis(500));
        player.drain_events();
        assert!((player.status().position_secs - position).abs() < 0.08);
        assert!(!player.status().ended);
        player.suspend(false);
        while !player.status().ended && !player.status().failed {
            assert!(Instant::now() < deadline, "{:?}", player.status());
            thread::sleep(Duration::from_millis(20));
            player.drain_events();
        }
        assert!(!player.status().failed, "{:?}", player.status());
        assert_eq!(player.status().duration_secs, 1.0);
        player.set_clip_range(None, None).unwrap();
        player.apply(PlayerCommand::Load {
            source,
            volume: 0.0,
            speed: 1.0,
            looping: false,
        });
        while player.status().duration_secs < 2.0 && !player.status().failed {
            assert!(Instant::now() < deadline, "{:?}", player.status());
            thread::sleep(Duration::from_millis(20));
            player.drain_events();
        }
        assert!(!player.status().failed, "{:?}", player.status());
        assert!(player.status().position_secs < 0.5, "{:?}", player.status());
        player.apply(PlayerCommand::Shutdown);
    }
    #[test]
    #[ignore = "requires CURATOR_LIBMPV_PATH and CURATOR_LIVE_RENDERER_MEDIA"]
    fn three_portrait_players_pause_and_teardown_independently() {
        let _environment = LIBMPV_ENV.lock().unwrap();
        let media = avtohmver::config::env_var("CURATOR_LIVE_RENDERER_MEDIA")
            .expect("disposable video required");
        let counters: Vec<_> = (0..3).map(|_| Arc::new(AtomicUsize::new(0))).collect();
        let mut players: Vec<_> = counters
            .iter()
            .map(|counter| {
                let counter = counter.clone();
                let mut player = NativePlayer::portrait();
                player.set_frame_callback(Box::new(move |pixels, width, height| {
                    assert_eq!((width, height), (480, 960));
                    assert_eq!(pixels.len(), 480 * 960 * 4);
                    counter.fetch_add(1, Ordering::SeqCst);
                }));
                player.apply(PlayerCommand::Load {
                    source: media.clone(),
                    volume: 0.0,
                    speed: 1.0,
                    looping: true,
                });
                player
            })
            .collect();
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline
            && counters
                .iter()
                .any(|counter| counter.load(Ordering::SeqCst) == 0)
        {
            for player in &mut players {
                player.drain_events();
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            counters
                .iter()
                .all(|counter| counter.load(Ordering::SeqCst) > 0),
            "Each pane must receive its own frame"
        );
        for player in &mut players {
            player.suspend(true);
        }
        thread::sleep(Duration::from_millis(200));
        for player in &mut players {
            player.drain_events();
        }
        let positions: Vec<_> = players
            .iter()
            .map(|player| player.status().position_secs)
            .collect();
        thread::sleep(Duration::from_millis(250));
        for (player, position) in players.iter_mut().zip(positions) {
            player.drain_events();
            assert!((player.status().position_secs - position).abs() < 0.08);
        }
        players[0].apply(PlayerCommand::Stop);
        for player in &mut players {
            player.suspend(false);
        }
        let stopped = counters[0].load(Ordering::SeqCst);
        let previous = counters[1].load(Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && counters[1].load(Ordering::SeqCst) == previous {
            for player in &mut players {
                player.drain_events();
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(counters[0].load(Ordering::SeqCst), stopped);
        assert!(counters[1].load(Ordering::SeqCst) > previous);
        for player in &mut players {
            player.apply(PlayerCommand::Shutdown);
        }
    }
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    static LIBMPV_ENV: Mutex<()> = Mutex::new(());

    #[test]
    fn idle_player_has_safe_defaults() {
        let player = NativePlayer::default();
        assert_eq!(player.status().message, "Choose media to play");
        assert_eq!(player.status().volume, 100.0);
        assert_eq!(player.status().speed, 1.0);
    }

    #[test]
    fn load_clamps_visible_settings_before_worker_admission() {
        let _environment = LIBMPV_ENV.lock().expect("environment lock");
        let mut player = NativePlayer::default();
        // This intentionally points nowhere, so the test proves status
        // validation without requiring a media runtime on the test host.
        std::env::set_var("CURATOR_LIBMPV_PATH", "not-a-real-libmpv-test");
        let status = player.apply(PlayerCommand::Load {
            source: "movie.mp4".into(),
            volume: 500.0,
            speed: 0.01,
            looping: true,
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        while player.status().loading && Instant::now() < deadline {
            player.drain_events();
            thread::sleep(Duration::from_millis(10));
        }
        std::env::remove_var("CURATOR_LIBMPV_PATH");
        assert_eq!(status.volume, 100.0);
        assert_eq!(status.speed, 0.25);
        assert!(status.looping);
        assert!(player.status().failed);
    }

    #[test]
    fn loading_waits_for_first_frame_and_stalled_load_fails() {
        let (status_tx, statuses) = mpsc::channel();
        let (frame_tx, frames) = mpsc::channel();
        let mut player = NativePlayer::default();
        player.statuses = Some(statuses);
        player.frames = Some(frames);
        player.status = PlayerStatus::loading();
        player.loading_since = Some(Instant::now());
        player.generation = 4;
        status_tx.send(WorkerEvent::FileLoaded(4)).unwrap();
        player.drain_events();
        assert!(player.status().loading);
        frame_tx
            .send(VideoFrame {
                generation: 3,
                pixels: vec![0, 0, 0, 255],
                width: 1,
                height: 1,
            })
            .unwrap();
        player.drain_events();
        assert!(player.status().loading);
        frame_tx
            .send(VideoFrame {
                generation: 4,
                pixels: vec![0, 0, 0, 255],
                width: 1,
                height: 1,
            })
            .unwrap();
        player.drain_events();
        assert!(!player.status().loading);
        assert!(!player.status().failed);
        player.status = PlayerStatus::loading();
        player.loading_since = Some(Instant::now() - Duration::from_secs(31));
        player.drain_events();
        assert!(player.status().failed);
        assert!(!player.status().loading);
        assert!(player.status().message.contains("30 seconds"));
        let expired = player.generation;
        status_tx
            .send(WorkerEvent::FileLoaded(expired - 1))
            .unwrap();
        player.drain_events();
        assert!(player.status().failed);
    }
    #[test]
    fn initialization_failure_is_a_terminal_loading_state() {
        let (tx, rx) = mpsc::channel();
        let mut player = NativePlayer::default();
        player.statuses = Some(rx);
        player.status = PlayerStatus::loading();
        player.loading_since = Some(Instant::now());
        tx.send(WorkerEvent::StartupError("Missing libmpv DLL".into()))
            .unwrap();
        player.drain_events();
        assert!(player.status().failed);
        assert!(!player.status().loading);
        assert!(player.loading_since.is_none());
    }

    #[test]
    fn stale_worker_output_is_ignored_after_media_switch() {
        let (status_tx, statuses) = mpsc::channel();
        let (frame_tx, frames) = mpsc::channel();
        let received = Arc::new(AtomicUsize::new(0));
        let received_frame = received.clone();
        let mut player = NativePlayer::default();
        player.statuses = Some(statuses);
        player.frames = Some(frames);
        player.generation = 2;
        player.set_frame_callback(Box::new(move |pixels, _, _| {
            received_frame.store(pixels[0] as usize, Ordering::SeqCst);
        }));
        status_tx.send(WorkerEvent::FileLoaded(1)).unwrap();
        status_tx
            .send(WorkerEvent::Progress {
                generation: 2,
                position_secs: Some(4.0),
                duration_secs: Some(10.0),
                paused: Some(false),
            })
            .unwrap();
        frame_tx
            .send(VideoFrame {
                generation: 1,
                pixels: vec![1, 0, 0, 255],
                width: 1,
                height: 1,
            })
            .unwrap();
        frame_tx
            .send(VideoFrame {
                generation: 2,
                pixels: vec![2, 0, 0, 255],
                width: 1,
                height: 1,
            })
            .unwrap();

        let updates = player.drain_events();

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].position_secs, 4.0);
        assert!(!player.loaded);
        assert_eq!(received.load(Ordering::SeqCst), 2);
    }

    /// Runs only when a caller provides a verified libmpv and a disposable
    /// video. It proves the worker can load, decode and hand a software frame
    /// back to the Slint thread without creating an external player window.
    #[test]
    #[ignore = "requires CURATOR_LIBMPV_PATH and CURATOR_LIVE_RENDERER_MEDIA"]
    fn live_renderer_delivers_a_software_frame() {
        let media = avtohmver::config::env_var("CURATOR_LIVE_RENDERER_MEDIA")
            .expect("set CURATOR_LIVE_RENDERER_MEDIA to a disposable video");
        let received = Arc::new(AtomicUsize::new(0));
        let dimensions = Arc::new(AtomicUsize::new(0));
        let mut player = NativePlayer::default();
        let received_frame = received.clone();
        let frame_dimensions = dimensions.clone();
        player.set_frame_callback(Box::new(move |pixels, width, height| {
            assert_eq!(pixels.len(), width as usize * height as usize * 4);
            assert!(pixels
                .iter()
                .skip(3)
                .step_by(4)
                .all(|alpha| *alpha == u8::MAX));
            frame_dimensions.store((width as usize) << 16 | height as usize, Ordering::SeqCst);
            received_frame.fetch_add(1, Ordering::SeqCst);
        }));
        let status = player.apply(PlayerCommand::Load {
            source: media.clone(),
            volume: 25.0,
            speed: 1.0,
            looping: false,
        });
        assert!(
            !status.message.contains("unavailable"),
            "libmpv failed to start: {}",
            status.message
        );
        // Replace the active file repeatedly before it finishes loading. The
        // final generation must still decode and the worker must stay alive.
        for _ in 0..8 {
            let status = player.apply(PlayerCommand::Load {
                source: media.clone(),
                volume: 25.0,
                speed: 1.0,
                looping: false,
            });
            assert_ne!(status.message, "Embedded player stopped unexpectedly");
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut status_messages = Vec::new();
        while Instant::now() < deadline && received.load(Ordering::SeqCst) == 0 {
            status_messages.extend(
                player
                    .drain_events()
                    .into_iter()
                    .map(|status| status.message),
            );
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            received.load(Ordering::SeqCst) > 0,
            "libmpv loaded no frame from the disposable video; statuses: {status_messages:?}"
        );
        assert_ne!(dimensions.load(Ordering::SeqCst), 0);
        player.apply(PlayerCommand::Shutdown);
    }
}
