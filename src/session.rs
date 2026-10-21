//! Versioned, deterministic session domain shared by native and remote clients.
//!
//! This module deliberately owns no UI, database connection, media player, or
//! wall-clock timer.  A caller feeds monotonic timestamps through [`SessionCommand`]
//! and performs returned [`SessionEffect`] values with the relevant adapter.

use crate::instructor_processor::{
    EventProcessor, ProcessorAction, ProcessorEvent, ProcessorOutput, ProcessorSnapshot,
};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    OnceLock,
};
use std::time::Instant;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

pub const GAME_CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GameMetadata {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EndCondition {
    pub active_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DifficultyConfig {
    pub tempo_multiplier: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TempoCurve {
    Constant {
        bpm: f64,
    },
    Linear {
        start_bpm: f64,
        end_bpm: f64,
    },
    Stepped {
        start_bpm: f64,
        end_bpm: f64,
        steps: u16,
    },
    Eased {
        start_bpm: f64,
        end_bpm: f64,
    },
    Adaptive {
        base_bpm: f64,
    },
}

impl TempoCurve {
    fn target_bpm(&self, progress: f64) -> f64 {
        let progress = progress.clamp(0.0, 1.0);
        match self {
            Self::Constant { bpm } => *bpm,
            Self::Linear { start_bpm, end_bpm } => start_bpm + (end_bpm - start_bpm) * progress,
            Self::Stepped {
                start_bpm,
                end_bpm,
                steps,
            } => {
                let steps = f64::from((*steps).max(1));
                let stepped_progress = (progress * steps).floor() / steps;
                start_bpm + (end_bpm - start_bpm) * stepped_progress
            }
            Self::Eased { start_bpm, end_bpm } => {
                let eased = progress * progress * (3.0 - 2.0 * progress);
                start_bpm + (end_bpm - start_bpm) * eased
            }
            Self::Adaptive { base_bpm } => *base_bpm,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TempoConfig {
    pub curve: TempoCurve,
    pub min_bpm: f64,
    pub max_bpm: f64,
    /// Maximum fraction of the remaining target difference applied per second.
    pub smoothing_per_second: f64,
    pub meter: u8,
    #[serde(default = "default_pattern")]
    pub pattern: Vec<f64>,
}

pub fn default_pattern() -> Vec<f64> {
    vec![1.0]
}
pub fn valid_pattern(pattern: &[f64]) -> bool {
    !pattern.is_empty()
        && pattern.len() <= 32
        && pattern
            .iter()
            .all(|slot| slot.is_finite() && (0.0..=8.0).contains(slot))
        && pattern.iter().any(|slot| *slot > 0.0)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStrategy {
    Sequential,
    Shuffle,
    SeededRandom,
    WeightedRandom,
    RatingWeighted,
    TagWeighted,
    LeastRecentlyShown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaConfig {
    pub selection_strategy: SelectionStrategy,
    pub required_tags: Vec<String>,
    pub excluded_tags: Vec<String>,
    pub allow_video_interruption: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PhaseConfig {
    pub id: String,
    pub duration_ms: u64,
    pub tempo_multiplier: f64,
    pub event_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventDefinition {
    pub id: String,
    /// 0..=10,000 chance evaluated when the applicable phase begins.
    pub probability_basis_points: u16,
    pub minimum_occurrences: u16,
    pub maximum_occurrences: u16,
    pub cooldown_ms: u64,
    pub duration_ms: u64,
    pub priority: u8,
    pub allowed_phase_ids: Vec<String>,
    pub instruction: Option<String>,
    /// Relative draw weight. None uses probability_basis_points as the weight.
    #[serde(default)]
    pub weight: Option<u32>,
    /// None is exclusive; an empty list is a non-blocking background event.
    #[serde(default)]
    pub occupies: Option<Vec<String>>,
    #[serde(default)]
    pub execution_order: Option<u16>,
    #[serde(default)]
    pub tempo: Option<EventTempo>,
    #[serde(default)]
    pub program: Vec<ProcessorEvent>,
    #[serde(default)]
    pub beat_pattern: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventTempo {
    Multiplier { factor: f64 },
    Constant { bpm: f64 },
    Ramp { start_factor: f64, end_factor: f64 },
}

impl EventTempo {
    fn validate(&self) -> bool {
        let factor_valid = |factor: f64| factor.is_finite() && (0.0..=4.0).contains(&factor);
        match self {
            Self::Multiplier { factor } => factor_valid(*factor),
            Self::Constant { bpm } => bpm.is_finite() && (20.0..=240.0).contains(bpm),
            Self::Ramp {
                start_factor,
                end_factor,
            } => factor_valid(*start_factor) && factor_valid(*end_factor),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventScheduling {
    #[default]
    Legacy,
    Weighted {
        interval_ms: [u64; 2],
        max_concurrent: u8,
    },
}

/// Declarative predicates evaluated against the authoritative active clock.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TaskActivation {
    pub after_active_ms: u64,
    pub before_active_ms: Option<u64>,
    pub progress_basis_points: Option<[u16; 2]>,
    pub minimum_completed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskWeight {
    pub start: u32,
    pub end: u32,
}

impl Default for TaskWeight {
    fn default() -> Self {
        Self { start: 1, end: 1 }
    }
}

/// Each group draws one eligible child; nested groups retain their own weights.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskNode {
    Event {
        event_id: String,
        #[serde(default)]
        activation: TaskActivation,
        #[serde(default)]
        weight: TaskWeight,
    },
    Group {
        children: Vec<TaskNode>,
        #[serde(default)]
        activation: TaskActivation,
        #[serde(default)]
        weight: TaskWeight,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScheduledTask {
    pub event_id: String,
    pub at_active_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstructorConfig {
    pub voice_pack_id: Option<String>,
    pub script_preset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AudioConfig {
    pub music_playlist_id: Option<String>,
    pub metronome_enabled: bool,
    pub music_volume_percent: u8,
    pub voice_volume_percent: u8,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            music_playlist_id: None,
            metronome_enabled: true,
            music_volume_percent: 80,
            voice_volume_percent: 80,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GameConfig {
    pub schema_version: u32,
    pub metadata: GameMetadata,
    pub duration: EndCondition,
    pub difficulty: DifficultyConfig,
    pub tempo: TempoConfig,
    pub media: MediaConfig,
    pub phases: Vec<PhaseConfig>,
    pub events: Vec<EventDefinition>,
    pub instructor: InstructorConfig,
    pub audio: AudioConfig,
    pub seed: Option<u64>,
    #[serde(default)]
    pub event_scheduling: EventScheduling,
    #[serde(default)]
    pub task_graph: Option<TaskNode>,
    #[serde(default)]
    pub scheduled_tasks: Vec<ScheduledTask>,
    #[serde(default)]
    pub script: Vec<ProcessorEvent>,
}

impl GameConfig {
    /// Conservative native Quick-mode baseline. The generator surfaces the
    /// remaining fields as it grows, but it always compiles to this same
    /// versioned configuration rather than a UI-specific runtime format.
    pub fn quick_default() -> Self {
        Self {
            schema_version: GAME_CONFIG_SCHEMA_VERSION,
            metadata: GameMetadata {
                name: "Quick session".into(),
                description: "Native quick-mode baseline".into(),
            },
            duration: EndCondition {
                active_duration_ms: 15 * 60 * 1_000,
            },
            difficulty: DifficultyConfig {
                tempo_multiplier: 1.0,
            },
            tempo: TempoConfig {
                curve: TempoCurve::Linear {
                    start_bpm: 80.0,
                    end_bpm: 120.0,
                },
                min_bpm: 40.0,
                max_bpm: 180.0,
                smoothing_per_second: 4.0,
                meter: 4,
                pattern: default_pattern(),
            },
            media: MediaConfig {
                selection_strategy: SelectionStrategy::SeededRandom,
                required_tags: Vec::new(),
                excluded_tags: Vec::new(),
                allow_video_interruption: false,
            },
            phases: vec![PhaseConfig {
                id: "main".into(),
                duration_ms: 15 * 60 * 1_000,
                tempo_multiplier: 1.0,
                event_ids: Vec::new(),
            }],
            events: Vec::new(),
            instructor: InstructorConfig {
                voice_pack_id: None,
                script_preset_id: None,
            },
            audio: AudioConfig {
                music_playlist_id: None,
                metronome_enabled: true,
                music_volume_percent: 80,
                voice_volume_percent: 80,
            },
            seed: None,
            event_scheduling: EventScheduling::Weighted {
                interval_ms: [5_000, 15_000],
                max_concurrent: 2,
            },
            task_graph: None,
            scheduled_tasks: Vec::new(),
            script: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if let EventScheduling::Weighted {
            interval_ms,
            max_concurrent,
        } = self.event_scheduling
        {
            if interval_ms[0] < 1_000
                || interval_ms[0] > interval_ms[1]
                || interval_ms[1] > 3_600_000
                || !(1..=4).contains(&max_concurrent)
            {
                return Err(
                    "Event scheduler needs a 1s–1h interval and 1–4 concurrent tasks".into(),
                );
            }
        }
        if self.schema_version != GAME_CONFIG_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported game-config schema {}",
                self.schema_version
            ));
        }
        if self.duration.active_duration_ms == 0 {
            return Err("A session requires a positive active duration".into());
        }
        if self.phases.is_empty() || self.phases.len() > 128 {
            return Err("A session requires between 1 and 128 phases".into());
        }
        if !self.difficulty.tempo_multiplier.is_finite()
            || !(0.1..=4.0).contains(&self.difficulty.tempo_multiplier)
        {
            return Err("Difficulty tempo multiplier must be between 0.1 and 4".into());
        }
        if !self.tempo.min_bpm.is_finite()
            || !self.tempo.max_bpm.is_finite()
            || self.tempo.min_bpm <= 0.0
            || self.tempo.min_bpm > self.tempo.max_bpm
            || !(1..=16).contains(&self.tempo.meter)
            || !self.tempo.smoothing_per_second.is_finite()
            || self.tempo.smoothing_per_second < 0.0
            || !valid_pattern(&self.tempo.pattern)
        {
            return Err("Tempo configuration is invalid".into());
        }
        let endpoints = [
            self.tempo.curve.target_bpm(0.0),
            self.tempo.curve.target_bpm(1.0),
        ];
        if endpoints
            .iter()
            .any(|value| !value.is_finite() || *value <= 0.0)
        {
            return Err("Tempo curve endpoints must be finite and positive".into());
        }
        let mut phase_ids = std::collections::HashSet::new();
        for phase in &self.phases {
            if phase.id.trim().is_empty() || phase.duration_ms == 0 || !phase_ids.insert(&phase.id)
            {
                return Err("Every phase needs a unique id and positive duration".into());
            }
            if !phase.tempo_multiplier.is_finite() || !(0.1..=4.0).contains(&phase.tempo_multiplier)
            {
                return Err("Phase tempo multiplier must be between 0.1 and 4".into());
            }
        }
        let mut event_ids = std::collections::HashSet::new();
        for event in &self.events {
            if event.id.trim().is_empty()
                || event.probability_basis_points > 10_000
                || event.minimum_occurrences > event.maximum_occurrences
                || event.duration_ms == 0
                || event.tempo.as_ref().is_some_and(|tempo| !tempo.validate())
                || event
                    .beat_pattern
                    .as_ref()
                    .is_some_and(|pattern| !valid_pattern(pattern))
                || !event_ids.insert(&event.id)
            {
                return Err("An event definition is invalid".into());
            }
            EventProcessor::validate(&event.program)?;
            if event
                .allowed_phase_ids
                .iter()
                .any(|id| !phase_ids.contains(id))
            {
                return Err(format!("Event {} references an unknown phase", event.id));
            }
        }
        for phase in &self.phases {
            if let Some(event_id) = phase.event_ids.iter().find(|id| !event_ids.contains(*id)) {
                return Err(format!(
                    "Phase {} references an unknown event {}",
                    phase.id, event_id
                ));
            }
        }
        if self.events.len() > 256 || self.scheduled_tasks.len() > 1024 {
            return Err("Task configuration exceeds its bounded capacity".into());
        }
        if self.audio.music_volume_percent > 100 || self.audio.voice_volume_percent > 100 {
            return Err("Audio volumes must be between 0 and 100".into());
        }
        if self.scheduled_tasks.iter().any(|task| {
            !event_ids.contains(&task.event_id)
                || task.at_active_ms >= self.duration.active_duration_ms
        }) {
            return Err("Scheduled task references an unknown event or invalid time".into());
        }
        EventProcessor::validate(&self.script)?;
        if (!self.scheduled_tasks.is_empty()
            || !self.script.is_empty()
            || self.events.iter().any(|event| !event.program.is_empty()))
            && matches!(self.event_scheduling, EventScheduling::Legacy)
        {
            return Err("Scheduled tasks require weighted scheduling".into());
        }
        if let Some(graph) = &self.task_graph {
            if matches!(self.event_scheduling, EventScheduling::Legacy) {
                return Err("Task graphs require weighted scheduling".into());
            }
            let mut budget = 1024;
            graph.validate(&event_ids, 0, &mut budget)?;
        }
        Ok(())
    }
}

impl TaskNode {
    fn properties(&self) -> (&TaskActivation, &TaskWeight) {
        match self {
            Self::Event {
                activation, weight, ..
            }
            | Self::Group {
                activation, weight, ..
            } => (activation, weight),
        }
    }

    fn validate(
        &self,
        ids: &std::collections::HashSet<&String>,
        depth: usize,
        budget: &mut usize,
    ) -> Result<(), String> {
        if depth > 16 || *budget == 0 {
            return Err("Task graph exceeds depth or node limit".into());
        }
        *budget -= 1;
        let (activation, weight) = self.properties();
        if activation
            .before_active_ms
            .is_some_and(|end| end <= activation.after_active_ms)
            || activation
                .progress_basis_points
                .is_some_and(|[start, end]| start > end || end > 10_000)
            || activation
                .minimum_completed
                .iter()
                .any(|id| !ids.contains(id))
            || weight.start > 1_000_000
            || weight.end > 1_000_000
        {
            return Err("Task graph predicate or weight is invalid".into());
        }
        match self {
            Self::Event { event_id, .. } if !ids.contains(event_id) => {
                Err("Task graph references an unknown event".into())
            }
            Self::Group { children, .. } => {
                if children.is_empty() {
                    return Err("Task groups require children".into());
                }
                for child in children {
                    child.validate(ids, depth + 1, budget)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Ready,
    Running,
    Paused,
    Completed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PhaseState {
    pub index: usize,
    pub id: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TempoState {
    pub target_bpm: f64,
    pub current_bpm: f64,
    /// User supplied audio/metronome alignment. It is deliberately stored
    /// separately from the monotonic session clock, so pause/resume cannot
    /// accumulate or reset a timing correction.
    pub offset_ms: i64,
    #[serde(default = "default_pattern")]
    pub pattern: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventRecord {
    pub id: String,
    pub started_at_active_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SessionStatistics {
    pub phase_changes: u32,
    pub events_started: u32,
    pub timing_corrections: u32,
    pub recovery_count: u32,
    #[serde(default)]
    pub media_skips: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionState {
    pub session_id: String,
    pub seed: u64,
    pub status: SessionStatus,
    pub active_elapsed_ms: u64,
    pub paused_elapsed_ms: u64,
    pub phase: PhaseState,
    pub tempo: TempoState,
    pub current_event: Option<EventRecord>,
    /// Full set for concurrent playback; current_event remains the first item
    /// for older adapters and stored checkpoints.
    #[serde(default)]
    pub active_events: Vec<EventRecord>,
    pub event_history: Vec<EventRecord>,
    pub instruction: Option<String>,
    pub statistics: SessionStatistics,
    #[serde(default)]
    pub pending_tasks: Vec<ScheduledTask>,
    #[serde(default)]
    pub completed_events: Vec<String>,
    #[serde(default)]
    pub audio: AudioConfig,
    #[serde(default)]
    pub processor: ProcessorSnapshot,
    #[serde(default)]
    pub processor_outputs: Vec<SessionProcessorOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionProcessorOutput {
    pub sequence: u64,
    pub output: ProcessorOutput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SessionCommand {
    Start {
        monotonic_ms: u64,
    },
    Tick {
        monotonic_ms: u64,
    },
    Pause {
        monotonic_ms: u64,
    },
    Resume {
        monotonic_ms: u64,
    },
    UserAction {
        name: String,
    },
    SkipMedia,
    ReportPlaybackFailure {
        detail: String,
    },
    ChangeTempoOffset {
        offset_ms: i64,
    },
    End {
        completed: bool,
        monotonic_ms: u64,
    },
    Interrupt {
        monotonic_ms: u64,
    },
    InjectEvent {
        event_id: String,
        monotonic_ms: u64,
    },
    CompleteEvent {
        event_id: String,
        monotonic_ms: u64,
    },
    ChooseOption {
        instruction_id: String,
        option_index: usize,
        monotonic_ms: u64,
    },
}

/// UI and HTTP adapters use this clock-free command shape. The shared service
/// stamps it from one process monotonic clock, keeping UI freezes and remote
/// request latency out of the session's ownership model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SessionControl {
    Tick,
    Pause,
    Resume,
    UserAction {
        name: String,
    },
    SkipMedia,
    ReportPlaybackFailure {
        detail: String,
    },
    ChangeTempoOffset {
        offset_ms: i64,
    },
    End {
        completed: bool,
    },
    Interrupt,
    InjectEvent {
        event_id: String,
    },
    CompleteEvent {
        event_id: String,
    },
    ChooseOption {
        instruction_id: String,
        option_index: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SessionEffect {
    StartMusic,
    StopMusic,
    ScheduleMetronome { target_bpm: f64, meter: u8 },
    StartPhase { phase_id: String },
    StartEvent { event_id: String, duration_ms: u64 },
    EndEvent { event_id: String },
    ShowInstruction { text: String },
    SkipMedia,
    PlaybackFailed { detail: String },
    PersistCheckpoint,
    EndSession { status: SessionStatus },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionUpdate {
    pub state: SessionState,
    pub effects: Vec<SessionEffect>,
}

/// A deterministic engine. Monotonic time is supplied by the caller, making
/// it testable and safe from UI stalls, hidden windows, and wall-clock edits.
pub struct SessionEngine {
    config: GameConfig,
    state: SessionState,
    rng: StdRng,
    last_monotonic_ms: Option<u64>,
    paused_started_ms: Option<u64>,
    next_event_draw_ms: Option<u64>,
    tempo_integrated_ms: u64,
    tempo_integrated_bpm: f64,
    processor: EventProcessor,
    processor_sequence: u64,
    program_threads: std::collections::BTreeMap<String, String>,
    processor_tempo: Vec<(u64, Option<(f64, u8)>)>,
    processor_pattern: Option<Vec<f64>>,
    processor_tempo_owners: std::collections::BTreeMap<String, (f64, u8, u64)>,
    processor_pattern_owners: std::collections::BTreeMap<String, (Vec<f64>, u64)>,
}

/// Process-shared session ownership. Desktop and HTTP adapters send commands
/// through this service; neither obtains mutable access to the engine itself.
#[derive(Clone)]
pub struct SessionService {
    engine: std::sync::Arc<std::sync::Mutex<Option<SessionEngine>>>,
    updates: broadcast::Sender<SessionUpdate>,
    runner: std::sync::Arc<std::sync::Mutex<Option<CancellationToken>>>,
    clock: std::sync::Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl Default for SessionService {
    fn default() -> Self {
        let (updates, _) = broadcast::channel(64);
        Self {
            engine: std::sync::Arc::new(std::sync::Mutex::new(None)),
            updates,
            runner: std::sync::Arc::new(std::sync::Mutex::new(None)),
            clock: std::sync::Arc::new(monotonic_ms),
        }
    }
}

impl SessionService {
    #[cfg(test)]
    fn with_clock(clock: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        Self {
            clock: std::sync::Arc::new(clock),
            ..Self::default()
        }
    }

    fn now(&self) -> u64 {
        (self.clock)()
    }

    pub fn start(&self, config: GameConfig) -> Result<SessionState, String> {
        let mut slot = self
            .engine
            .lock()
            .map_err(|_| "Session service is unavailable")?;
        if slot.as_ref().is_some_and(|engine| {
            matches!(
                engine.state.status,
                SessionStatus::Ready | SessionStatus::Running | SessionStatus::Paused
            )
        }) {
            return Err("A session is already active".into());
        }
        let mut engine = SessionEngine::new(config)?;
        // Config seeds make selection reproducible, but a durable session ID
        // must identify each run independently (including repeated test/demo
        // runs with the same seed).
        static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);
        let sequence = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        engine.state.session_id = format!("session-{:016x}-{sequence:016x}", engine.state.seed);
        let snapshot = engine.snapshot();
        *slot = Some(engine);
        Ok(snapshot)
    }

    pub fn dispatch(&self, command: SessionCommand) -> Result<SessionUpdate, String> {
        let mut slot = self
            .engine
            .lock()
            .map_err(|_| "Session service is unavailable")?;
        let update = slot
            .as_mut()
            .map(|engine| engine.dispatch(command))
            .ok_or_else(|| "No active session".to_string())?;
        let _ = self.updates.send(update.clone());
        Ok(update)
    }

    fn tick_for_session(
        &self,
        session_id: &str,
        monotonic_ms: u64,
    ) -> Result<SessionUpdate, String> {
        let mut slot = self
            .engine
            .lock()
            .map_err(|_| "Session service is unavailable")?;
        let engine = slot
            .as_mut()
            .ok_or_else(|| "No active session".to_string())?;
        if engine.state.session_id != session_id {
            return Err("Session was replaced".into());
        }
        let update = engine.dispatch(SessionCommand::Tick { monotonic_ms });
        let _ = self.updates.send(update.clone());
        Ok(update)
    }

    /// Starts a session through the shared application boundary and advances
    /// it immediately. Adapters never need to manufacture timestamps.
    pub fn start_running(&self, config: GameConfig) -> Result<SessionUpdate, String> {
        self.start(config)?;
        // Do not cancel the current runner until the new session has been
        // admitted. A racing rejected Start must leave that runner alive.
        self.stop_runner();
        let update = self.dispatch(SessionCommand::Start {
            monotonic_ms: self.now(),
        })?;
        self.start_runner(update.state.session_id.clone());
        Ok(update)
    }

    /// Start without exposing running time when playback is already paused.
    pub fn start_paused(&self, config: GameConfig) -> Result<SessionUpdate, String> {
        self.start(config)?;
        self.stop_runner();
        let now = self.now();
        let update = {
            let mut slot = self
                .engine
                .lock()
                .map_err(|_| "Session service is unavailable")?;
            let engine = slot.as_mut().ok_or("No active session")?;
            let started = engine.dispatch(SessionCommand::Start { monotonic_ms: now });
            let mut paused = engine.dispatch(SessionCommand::Pause { monotonic_ms: now });
            let mut effects = started.effects;
            effects.append(&mut paused.effects);
            paused.effects = effects;
            paused
        };
        let _ = self.updates.send(update.clone());
        self.start_runner(update.state.session_id.clone());
        Ok(update)
    }

    /// Converts an adapter intent to the engine command with an authoritative
    /// process-monotonic timestamp. This is the entry point used by native and
    /// remote UI surfaces.
    pub fn control(&self, control: SessionControl) -> Result<SessionUpdate, String> {
        let now = self.now();
        let command = match control {
            // Kept as a read-compatible remote command, but the application
            // runner alone advances authoritative time.
            SessionControl::Tick => {
                return self
                    .snapshot()
                    .map(|state| SessionUpdate {
                        state,
                        effects: Vec::new(),
                    })
                    .ok_or_else(|| "No active session".into());
            }
            SessionControl::Pause => SessionCommand::Pause { monotonic_ms: now },
            SessionControl::Resume => SessionCommand::Resume { monotonic_ms: now },
            SessionControl::UserAction { name } => SessionCommand::UserAction { name },
            SessionControl::SkipMedia => SessionCommand::SkipMedia,
            SessionControl::ReportPlaybackFailure { detail } => {
                SessionCommand::ReportPlaybackFailure { detail }
            }
            SessionControl::ChangeTempoOffset { offset_ms } => {
                SessionCommand::ChangeTempoOffset { offset_ms }
            }
            SessionControl::End { completed } => SessionCommand::End {
                completed,
                monotonic_ms: now,
            },
            SessionControl::Interrupt => SessionCommand::Interrupt { monotonic_ms: now },
            SessionControl::InjectEvent { event_id } => SessionCommand::InjectEvent {
                event_id,
                monotonic_ms: now,
            },
            SessionControl::CompleteEvent { event_id } => SessionCommand::CompleteEvent {
                event_id,
                monotonic_ms: now,
            },
            SessionControl::ChooseOption {
                instruction_id,
                option_index,
            } => SessionCommand::ChooseOption {
                instruction_id,
                option_index,
                monotonic_ms: now,
            },
        };
        self.dispatch(command)
    }

    pub fn snapshot(&self) -> Option<SessionState> {
        self.engine
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(SessionEngine::snapshot))
    }

    pub fn interrupt_active(&self) -> Option<SessionUpdate> {
        self.dispatch(SessionCommand::Interrupt {
            monotonic_ms: self.now(),
        })
        .ok()
    }

    /// Consumers can render or persist every authoritative engine transition
    /// without polling. Slow consumers may coalesce updates; timing remains
    /// owned by the runner, not by a subscriber.
    pub fn subscribe(&self) -> broadcast::Receiver<SessionUpdate> {
        self.updates.subscribe()
    }

    pub fn stop_runner(&self) {
        if let Ok(mut runner) = self.runner.lock() {
            if let Some(cancel) = runner.take() {
                cancel.cancel();
            }
        }
    }

    fn start_runner(&self, session_id: String) {
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            // The native Slint shell may be hosted without a Tokio runtime.
            // Its commands still work; the application service supplies the
            // self-advancing runner whenever it is available.
            return;
        };
        let cancellation = CancellationToken::new();
        if let Ok(mut runner) = self.runner.lock() {
            if let Some(previous) = runner.replace(cancellation.clone()) {
                previous.cancel();
            }
        }
        let service = self.clone();
        handle.spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(50));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = cancellation.cancelled() => break,
                    _ = interval.tick() => {
                        if service.snapshot().as_ref().map(|state| &state.session_id) != Some(&session_id) {
                            break;
                        }
                        match service.tick_for_session(&session_id, service.now()) {
                            Ok(update) if matches!(update.state.status, SessionStatus::Completed | SessionStatus::Cancelled | SessionStatus::Interrupted) => break,
                            Ok(_) => {},
                            Err(_) => break,
                        }
                    }
                }
            }
        });
    }
}

fn monotonic_ms() -> u64 {
    static PROCESS_STARTED: OnceLock<Instant> = OnceLock::new();
    PROCESS_STARTED
        .get_or_init(Instant::now)
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

impl SessionEngine {
    pub fn new(config: GameConfig) -> Result<Self, String> {
        config.validate()?;
        let seed = config.seed.unwrap_or_else(rand::random);
        let first = &config.phases[0];
        let target = Self::target_tempo_for(&config, 0, 0);
        let processor = EventProcessor::new(config.script.clone())?;
        Ok(Self {
            state: SessionState {
                session_id: format!("session-{seed:016x}"),
                seed,
                status: SessionStatus::Ready,
                active_elapsed_ms: 0,
                paused_elapsed_ms: 0,
                phase: PhaseState {
                    index: 0,
                    id: first.id.clone(),
                    elapsed_ms: 0,
                },
                tempo: TempoState {
                    target_bpm: target,
                    current_bpm: target,
                    offset_ms: 0,
                    pattern: config.tempo.pattern.clone(),
                },
                current_event: None,
                active_events: Vec::new(),
                event_history: Vec::new(),
                instruction: None,
                statistics: SessionStatistics::default(),
                pending_tasks: config.scheduled_tasks.clone(),
                completed_events: Vec::new(),
                audio: config.audio.clone(),
                processor: processor.snapshot(),
                processor_outputs: Vec::new(),
            },
            config,
            rng: StdRng::seed_from_u64(seed),
            last_monotonic_ms: None,
            paused_started_ms: None,
            next_event_draw_ms: None,
            tempo_integrated_ms: 0,
            tempo_integrated_bpm: target,
            processor,
            processor_sequence: 0,
            program_threads: std::collections::BTreeMap::new(),
            processor_tempo: Vec::new(),
            processor_pattern: None,
            processor_tempo_owners: std::collections::BTreeMap::new(),
            processor_pattern_owners: std::collections::BTreeMap::new(),
        })
    }

    pub fn snapshot(&self) -> SessionState {
        self.state.clone()
    }

    pub fn dispatch(&mut self, command: SessionCommand) -> SessionUpdate {
        let mut effects = Vec::new();
        if matches!(
            self.state.status,
            SessionStatus::Completed | SessionStatus::Cancelled | SessionStatus::Interrupted
        ) {
            return SessionUpdate {
                state: self.snapshot(),
                effects,
            };
        }
        match command {
            SessionCommand::Start { monotonic_ms }
                if matches!(self.state.status, SessionStatus::Ready) =>
            {
                self.state.status = SessionStatus::Running;
                self.last_monotonic_ms = Some(monotonic_ms);
                effects.push(SessionEffect::StartMusic);
                effects.push(SessionEffect::StartPhase {
                    phase_id: self.state.phase.id.clone(),
                });
                self.drive_processor(&mut effects);
                if self.state.status == SessionStatus::Running {
                    self.schedule_phase_events(&mut effects);
                }
            }
            SessionCommand::Tick { monotonic_ms } => self.tick(monotonic_ms, &mut effects),
            SessionCommand::Pause { monotonic_ms }
                if self.state.status == SessionStatus::Running =>
            {
                self.tick(monotonic_ms, &mut effects);
                if self.state.status != SessionStatus::Running {
                    return SessionUpdate {
                        state: self.snapshot(),
                        effects,
                    };
                }
                self.state.status = SessionStatus::Paused;
                self.paused_started_ms = Some(monotonic_ms);
                self.last_monotonic_ms = None;
                effects.push(SessionEffect::PersistCheckpoint);
            }
            SessionCommand::Resume { monotonic_ms }
                if self.state.status == SessionStatus::Paused =>
            {
                if let Some(started) = self.paused_started_ms.take() {
                    self.state.paused_elapsed_ms = self
                        .state
                        .paused_elapsed_ms
                        .saturating_add(monotonic_ms.saturating_sub(started));
                }
                self.state.status = SessionStatus::Running;
                self.last_monotonic_ms = Some(monotonic_ms);
                self.processor.resume();
                self.process_pending_tasks(&mut effects);
                self.drive_processor(&mut effects);
            }
            SessionCommand::UserAction { name } => {
                self.state.instruction = Some(name.clone());
                effects.push(SessionEffect::ShowInstruction { text: name });
            }
            SessionCommand::SkipMedia => {
                self.state.statistics.media_skips =
                    self.state.statistics.media_skips.saturating_add(1);
                effects.push(SessionEffect::SkipMedia);
            }
            SessionCommand::ReportPlaybackFailure { detail } => {
                self.state.statistics.recovery_count += 1;
                self.state.statistics.media_skips =
                    self.state.statistics.media_skips.saturating_add(1);
                effects.push(SessionEffect::PlaybackFailed { detail });
                effects.push(SessionEffect::SkipMedia);
            }
            SessionCommand::ChangeTempoOffset { offset_ms } => {
                self.state.tempo.offset_ms = offset_ms.clamp(-30_000, 30_000);
                self.state.statistics.timing_corrections += 1;
                effects.push(SessionEffect::PersistCheckpoint);
            }
            SessionCommand::End {
                completed,
                monotonic_ms,
            } => {
                self.settle_terminal_time(monotonic_ms, &mut effects);
                self.end(
                    if completed {
                        SessionStatus::Completed
                    } else {
                        SessionStatus::Cancelled
                    },
                    &mut effects,
                );
            }
            SessionCommand::Interrupt { monotonic_ms } => {
                self.settle_terminal_time(monotonic_ms, &mut effects);
                self.end(SessionStatus::Interrupted, &mut effects);
            }
            SessionCommand::InjectEvent {
                event_id,
                monotonic_ms,
            } if matches!(
                self.state.status,
                SessionStatus::Running | SessionStatus::Paused
            ) && matches!(
                self.config.event_scheduling,
                EventScheduling::Weighted { .. }
            ) =>
            {
                self.tick(monotonic_ms, &mut effects);
                if matches!(
                    self.state.status,
                    SessionStatus::Running | SessionStatus::Paused
                ) && self.state.pending_tasks.len() < 1024
                    && self.config.events.iter().any(|event| event.id == event_id)
                {
                    self.state.pending_tasks.push(ScheduledTask {
                        event_id,
                        at_active_ms: self.state.active_elapsed_ms,
                    });
                    if self.state.status == SessionStatus::Running {
                        self.process_pending_tasks(&mut effects);
                    }
                }
            }
            SessionCommand::CompleteEvent {
                event_id,
                monotonic_ms,
            } if matches!(
                self.state.status,
                SessionStatus::Running | SessionStatus::Paused
            ) =>
            {
                self.tick(monotonic_ms, &mut effects);
                if let Some(index) = self
                    .state
                    .active_events
                    .iter()
                    .position(|event| event.id == event_id)
                {
                    let record = self.state.active_events.remove(index);
                    let thread_id = self
                        .program_threads
                        .iter()
                        .find(|(_, event)| **event == event_id)
                        .map(|(thread, _)| thread.clone());
                    if let Some(thread_id) = thread_id {
                        let outputs = self.processor.cancel_thread(&thread_id);
                        self.apply_processor_outputs(outputs, &mut effects);
                    }
                    if let Some(history) =
                        self.state.event_history.iter_mut().rev().find(|history| {
                            history.id == record.id
                                && history.started_at_active_ms == record.started_at_active_ms
                        })
                    {
                        history.duration_ms = self
                            .state
                            .active_elapsed_ms
                            .saturating_sub(history.started_at_active_ms);
                    }
                    self.state.completed_events.push(event_id.clone());
                    effects.push(SessionEffect::EndEvent { event_id });
                    self.refresh_instruction(&mut effects);
                    if self.state.status == SessionStatus::Running {
                        self.process_pending_tasks(&mut effects);
                    }
                } else if self
                    .state
                    .current_event
                    .as_ref()
                    .is_some_and(|event| event.id == event_id)
                {
                    self.state.current_event = None;
                    self.state.completed_events.push(event_id.clone());
                    effects.push(SessionEffect::EndEvent { event_id });
                    self.state.instruction = None;
                }
            }
            SessionCommand::ChooseOption {
                instruction_id,
                option_index,
                monotonic_ms,
            } if matches!(
                self.state.status,
                SessionStatus::Running | SessionStatus::Paused
            ) =>
            {
                self.tick(monotonic_ms, &mut effects);
                if self.processor.choose(&instruction_id, option_index).is_ok()
                    && self.state.status == SessionStatus::Running
                {
                    self.drive_processor(&mut effects);
                    self.process_pending_tasks(&mut effects);
                }
            }
            _ => {}
        }
        if self.state.status == SessionStatus::Running {
            self.drive_processor(&mut effects);
        }
        self.state.processor = self.processor.snapshot();
        if matches!(
            self.state.status,
            SessionStatus::Running | SessionStatus::Paused
        ) {
            self.update_tempo(0, &mut effects);
        }
        SessionUpdate {
            state: self.snapshot(),
            effects,
        }
    }

    fn settle_terminal_time(&mut self, monotonic_ms: u64, effects: &mut Vec<SessionEffect>) {
        match self.state.status {
            SessionStatus::Running => {
                self.advance_running_time(monotonic_ms, effects);
            }
            SessionStatus::Paused => {
                if let Some(started) = self.paused_started_ms.take() {
                    self.state.paused_elapsed_ms = self
                        .state
                        .paused_elapsed_ms
                        .saturating_add(monotonic_ms.saturating_sub(started));
                }
            }
            _ => {}
        }
    }

    fn tick(&mut self, monotonic_ms: u64, effects: &mut Vec<SessionEffect>) {
        if self.state.status != SessionStatus::Running {
            return;
        }
        let target = self.advance_running_time(monotonic_ms, effects);
        if target >= self.config.duration.active_duration_ms {
            self.end(SessionStatus::Completed, effects);
        }
    }

    /// Advance accounting and scheduled milestones without deciding terminal
    /// status. Explicit End/Interrupt commands call this before applying the
    /// requested terminal transition.
    fn advance_running_time(&mut self, monotonic_ms: u64, effects: &mut Vec<SessionEffect>) -> u64 {
        let previous = self.last_monotonic_ms.unwrap_or(monotonic_ms);
        self.last_monotonic_ms = Some(previous.max(monotonic_ms));
        let target = self
            .state
            .active_elapsed_ms
            .saturating_add(monotonic_ms.saturating_sub(previous))
            .min(self.config.duration.active_duration_ms);
        let before = self.state.active_elapsed_ms;
        self.advance_to_active(target, effects);
        if self.state.status == SessionStatus::Paused {
            self.paused_started_ms =
                Some(previous.saturating_add(self.state.active_elapsed_ms.saturating_sub(before)));
            self.last_monotonic_ms = None;
        }
        self.state.active_elapsed_ms
    }

    /// Move across each meaningful active-time milestone in order. This keeps
    /// delayed scheduler ticks equivalent to a sequence of timely ticks.
    fn advance_to_active(&mut self, target: u64, effects: &mut Vec<SessionEffect>) {
        if matches!(
            self.config.event_scheduling,
            EventScheduling::Weighted { .. }
        ) {
            self.advance_weighted_events(target, effects);
            return;
        }
        while self.state.active_elapsed_ms < target {
            let current = self.state.active_elapsed_ms;
            let event_deadline = self
                .state
                .current_event
                .as_ref()
                .map(|event| event.started_at_active_ms.saturating_add(event.duration_ms));
            let phase_deadline = self.next_phase_boundary();
            let next = [Some(target), event_deadline, phase_deadline]
                .into_iter()
                .flatten()
                .filter(|deadline| *deadline > current)
                .min()
                .unwrap_or(target);
            self.state.active_elapsed_ms = next;
            self.update_phase(effects);
            if event_deadline == Some(next) {
                if let Some(event) = self.state.current_event.take() {
                    self.state.active_events.clear();
                    self.state.completed_events.push(event.id.clone());
                    effects.push(SessionEffect::EndEvent { event_id: event.id });
                    self.refresh_instruction(effects);
                    if self.state.active_elapsed_ms < self.config.duration.active_duration_ms {
                        self.schedule_phase_events(effects);
                    }
                }
            }
        }
        self.update_phase(effects);
    }

    fn next_phase_boundary(&self) -> Option<u64> {
        let mut boundary = 0_u64;
        for phase in self
            .config
            .phases
            .iter()
            .take(self.config.phases.len().saturating_sub(1))
        {
            boundary = boundary.saturating_add(phase.duration_ms);
            if boundary > self.state.active_elapsed_ms {
                return Some(boundary);
            }
        }
        None
    }

    fn update_phase(&mut self, effects: &mut Vec<SessionEffect>) {
        let mut remaining = self.state.active_elapsed_ms;
        let mut index = 0;
        for (candidate, phase) in self.config.phases.iter().enumerate() {
            if remaining < phase.duration_ms || candidate + 1 == self.config.phases.len() {
                index = candidate;
                break;
            }
            remaining = remaining.saturating_sub(phase.duration_ms);
        }
        if index != self.state.phase.index {
            self.state.phase.index = index;
            self.state.phase.id = self.config.phases[index].id.clone();
            self.state.phase.elapsed_ms = remaining;
            self.state.statistics.phase_changes += 1;
            effects.push(SessionEffect::StartPhase {
                phase_id: self.state.phase.id.clone(),
            });
            // A configured event owns its whole active-time duration even if
            // phase eligibility changes underneath it.
            if matches!(self.config.event_scheduling, EventScheduling::Legacy)
                && self.state.current_event.is_none()
                && self.state.active_elapsed_ms < self.config.duration.active_duration_ms
            {
                self.schedule_phase_events(effects);
            }
        } else {
            self.state.phase.elapsed_ms = remaining;
        }
    }

    fn update_tempo(&mut self, _elapsed_ms: u64, effects: &mut Vec<SessionEffect>) {
        let target = self.event_tempo_at(self.state.active_elapsed_ms);
        self.state.tempo.target_bpm = target;
        self.state.tempo.pattern = self
            .state
            .active_events
            .iter()
            .filter_map(|record| {
                self.config
                    .events
                    .iter()
                    .find(|event| event.id == record.id && event.beat_pattern.is_some())
            })
            .max_by_key(|event| event.priority)
            .and_then(|event| event.beat_pattern.clone())
            .or_else(|| self.processor_pattern.clone())
            .unwrap_or_else(|| self.config.tempo.pattern.clone());
        // Keep the integration grid independent of caller update frequency.
        // Fractional render intervals never mutate the committed grid state.
        let now = self.state.active_elapsed_ms;
        while self.tempo_integrated_ms.saturating_add(50) <= now {
            self.tempo_integrated_ms += 50;
            let tick_target = self.event_tempo_at(self.tempo_integrated_ms.saturating_sub(25));
            let smoothing = 1.0 - (-self.config.tempo.smoothing_per_second * 0.05).exp();
            self.tempo_integrated_bpm += (tick_target - self.tempo_integrated_bpm) * smoothing;
        }
        let remainder = now.saturating_sub(self.tempo_integrated_ms);
        let smoothing =
            1.0 - (-self.config.tempo.smoothing_per_second * remainder as f64 / 1_000.0).exp();
        self.state.tempo.current_bpm =
            self.tempo_integrated_bpm + (target - self.tempo_integrated_bpm) * smoothing;
        if self.config.audio.metronome_enabled {
            effects.push(SessionEffect::ScheduleMetronome {
                target_bpm: self.state.tempo.current_bpm,
                meter: self
                    .processor_tempo
                    .last()
                    .and_then(|(_, tempo)| tempo.as_ref())
                    .map_or(self.config.tempo.meter, |(_, meter)| *meter),
            });
        }
    }

    fn target_tempo_for(config: &GameConfig, phase_index: usize, elapsed_ms: u64) -> f64 {
        let progress = elapsed_ms as f64 / config.duration.active_duration_ms as f64;
        let phase = &config.phases[phase_index];
        (config.tempo.curve.target_bpm(progress)
            * config.difficulty.tempo_multiplier
            * phase.tempo_multiplier)
            .clamp(config.tempo.min_bpm, config.tempo.max_bpm)
    }

    fn target_tempo_at(config: &GameConfig, elapsed_ms: u64) -> f64 {
        let mut remaining = elapsed_ms;
        let index = config
            .phases
            .iter()
            .position(|phase| {
                if remaining < phase.duration_ms {
                    true
                } else {
                    remaining -= phase.duration_ms;
                    false
                }
            })
            .unwrap_or(config.phases.len() - 1);
        Self::target_tempo_for(config, index, elapsed_ms)
    }

    fn event_tempo_at(&self, elapsed_ms: u64) -> f64 {
        let base = self
            .processor_tempo
            .iter()
            .rev()
            .find(|(at, _)| *at <= elapsed_ms)
            .and_then(|(_, tempo)| tempo.as_ref())
            .map_or_else(
                || Self::target_tempo_at(&self.config, elapsed_ms),
                |(bpm, _)| *bpm,
            );
        let modifier = self
            .state
            .event_history
            .iter()
            .filter(|record| {
                record.started_at_active_ms <= elapsed_ms
                    && elapsed_ms
                        < record
                            .started_at_active_ms
                            .saturating_add(record.duration_ms)
            })
            .filter_map(|record| {
                let event = self
                    .config
                    .events
                    .iter()
                    .find(|event| event.id == record.id)?;
                Some((record, event, event.tempo.as_ref()?))
            })
            .max_by_key(|(_, event, _)| event.priority);
        let Some((record, definition, modifier)) = modifier else {
            return base;
        };
        let target = match modifier {
            EventTempo::Multiplier { factor } => base * factor,
            EventTempo::Constant { bpm } => *bpm,
            EventTempo::Ramp {
                start_factor,
                end_factor,
            } => {
                let progress = elapsed_ms.saturating_sub(record.started_at_active_ms) as f64
                    / definition.duration_ms as f64;
                base * (start_factor + (end_factor - start_factor) * progress.clamp(0.0, 1.0))
            }
        };
        target.clamp(0.0, 240.0)
    }

    fn advance_weighted_events(&mut self, target: u64, effects: &mut Vec<SessionEffect>) {
        self.drive_processor(effects);
        while self.state.active_elapsed_ms < target && self.state.status == SessionStatus::Running {
            let current = self.state.active_elapsed_ms;
            let deadline = self
                .state
                .active_events
                .iter()
                .filter(|event| !self.program_threads.values().any(|id| *id == event.id))
                .map(|event| event.started_at_active_ms.saturating_add(event.duration_ms))
                .chain(self.processor.next_deadline())
                .chain(self.next_event_draw_ms)
                .chain(self.next_phase_boundary())
                .chain(
                    self.state
                        .pending_tasks
                        .iter()
                        .map(|task| task.at_active_ms),
                )
                .chain(self.state.pending_tasks.iter().filter_map(|task| {
                    let definition = self
                        .config
                        .events
                        .iter()
                        .find(|event| event.id == task.event_id)?;
                    let last = self
                        .state
                        .event_history
                        .iter()
                        .rev()
                        .find(|event| event.id == task.event_id)?;
                    Some(
                        last.started_at_active_ms
                            .saturating_add(definition.cooldown_ms),
                    )
                }))
                .filter(|deadline| *deadline > current)
                .min()
                .unwrap_or(target)
                .min(target);
            self.state.active_elapsed_ms = deadline;
            self.drive_processor(effects);
            if self.state.status != SessionStatus::Running {
                break;
            }
            // Release resources before selecting tasks at the same timestamp.
            let mut expired = Vec::new();
            self.state.active_events.retain(|event| {
                let keep = self.program_threads.values().any(|id| *id == event.id)
                    || event.started_at_active_ms.saturating_add(event.duration_ms) > deadline;
                if !keep {
                    expired.push(event.id.clone());
                }
                keep
            });
            for event_id in expired {
                self.state.completed_events.push(event_id.clone());
                effects.push(SessionEffect::EndEvent { event_id });
            }
            self.refresh_instruction(effects);
            self.update_phase(effects);
            if deadline < self.config.duration.active_duration_ms {
                self.process_pending_tasks(effects);
            }
            if self.next_event_draw_ms.is_some_and(|draw| draw <= deadline)
                && deadline < self.config.duration.active_duration_ms
            {
                self.draw_weighted_events(effects);
            }
            self.drive_processor(effects);
        }
        self.update_phase(effects);
    }

    fn event_eligible(&self, definition: &EventDefinition) -> bool {
        let phase = &self.config.phases[self.state.phase.index];
        if !phase.event_ids.contains(&definition.id)
            || (!definition.allowed_phase_ids.is_empty()
                && !definition.allowed_phase_ids.contains(&phase.id))
            || self
                .state
                .active_events
                .iter()
                .any(|event| event.id == definition.id)
        {
            return false;
        }
        let count = self
            .state
            .event_history
            .iter()
            .filter(|event| event.id == definition.id)
            .count();
        count < usize::from(definition.maximum_occurrences)
            && self
                .state
                .event_history
                .iter()
                .rev()
                .find(|event| event.id == definition.id)
                .is_none_or(|event| {
                    self.state
                        .active_elapsed_ms
                        .saturating_sub(event.started_at_active_ms)
                        >= definition.cooldown_ms
                })
    }

    fn event_blocked(&self, candidate: &EventDefinition) -> bool {
        if candidate.occupies.as_ref().is_some_and(Vec::is_empty) {
            return false;
        }
        self.state.active_events.iter().any(|record| {
            let Some(active) = self
                .config
                .events
                .iter()
                .find(|event| event.id == record.id)
            else {
                return true;
            };
            match (&candidate.occupies, &active.occupies) {
                (_, Some(resources)) if resources.is_empty() => false,
                (Some(left), Some(right)) => left.iter().any(|resource| right.contains(resource)),
                _ => true,
            }
        })
    }

    fn start_weighted_event(
        &mut self,
        definition: &EventDefinition,
        effects: &mut Vec<SessionEffect>,
    ) {
        if !definition.program.is_empty() {
            let thread_id = format!("task:{}:{}", definition.id, self.state.active_elapsed_ms);
            if let Err(detail) = self.processor.enqueue_thread_at(
                thread_id.clone(),
                definition.program.clone(),
                self.state.active_elapsed_ms,
            ) {
                effects.push(SessionEffect::PlaybackFailed { detail });
                self.end(SessionStatus::Interrupted, effects);
                return;
            }
            self.program_threads
                .insert(thread_id, definition.id.clone());
        }
        let record = EventRecord {
            id: definition.id.clone(),
            started_at_active_ms: self.state.active_elapsed_ms,
            duration_ms: if definition.program.is_empty() {
                definition.duration_ms
            } else {
                self.config
                    .duration
                    .active_duration_ms
                    .saturating_sub(self.state.active_elapsed_ms)
            },
        };
        self.state.active_events.push(record.clone());
        self.state.current_event = self.state.active_events.first().cloned();
        self.state.event_history.push(record);
        self.state.statistics.events_started += 1;
        effects.push(SessionEffect::StartEvent {
            event_id: definition.id.clone(),
            duration_ms: definition.duration_ms,
        });
        self.refresh_instruction(effects);
    }

    fn refresh_instruction(&mut self, effects: &mut Vec<SessionEffect>) {
        self.state.current_event = self
            .state
            .active_events
            .iter()
            .max_by_key(|record| {
                self.config
                    .events
                    .iter()
                    .find(|event| event.id == record.id)
                    .map_or(0, |event| event.priority)
            })
            .cloned();
        let instruction = self
            .state
            .active_events
            .iter()
            .filter_map(|record| {
                self.config
                    .events
                    .iter()
                    .find(|event| event.id == record.id)
                    .filter(|event| event.instruction.is_some())
            })
            .max_by_key(|event| event.priority)
            .and_then(|event| event.instruction.clone());
        let instruction = self
            .state
            .processor
            .pending_instructions
            .first()
            .map(|instruction| {
                if instruction.description.is_empty() {
                    instruction.title.clone()
                } else {
                    format!("{}\n{}", instruction.title, instruction.description)
                }
            })
            .or(instruction);
        if self.state.instruction != instruction {
            self.state.instruction = instruction.clone();
            effects.push(SessionEffect::ShowInstruction {
                text: instruction.unwrap_or_default(),
            });
        }
    }

    fn occupying_count(&self) -> usize {
        self.state
            .active_events
            .iter()
            .filter(|record| {
                self.config
                    .events
                    .iter()
                    .find(|event| event.id == record.id)
                    .is_none_or(|event| !event.occupies.as_ref().is_some_and(Vec::is_empty))
            })
            .count()
    }

    fn process_pending_tasks(&mut self, effects: &mut Vec<SessionEffect>) -> bool {
        let now = self.state.active_elapsed_ms;
        self.state.pending_tasks.sort_by_key(|task| {
            let event = self
                .config
                .events
                .iter()
                .find(|event| event.id == task.event_id);
            (
                task.at_active_ms > now,
                event.and_then(|event| event.execution_order).unwrap_or(99),
                std::cmp::Reverse(event.map_or(0, |event| event.priority)),
                task.at_active_ms,
            )
        });
        let pending = std::mem::take(&mut self.state.pending_tasks);
        let mut blocked = false;
        for task in pending {
            if task.at_active_ms > now {
                self.state.pending_tasks.push(task);
                continue;
            }
            let Some(event) = self
                .config
                .events
                .iter()
                .find(|event| event.id == task.event_id)
                .cloned()
            else {
                continue;
            };
            let count = self
                .state
                .event_history
                .iter()
                .filter(|record| record.id == event.id)
                .count();
            if count >= usize::from(event.maximum_occurrences) {
                continue;
            }
            if self.event_eligible(&event) && !self.event_blocked(&event) {
                self.start_weighted_event(&event, effects);
            } else {
                blocked = true;
                self.state.pending_tasks.push(task);
            }
        }
        blocked
    }

    fn activation_matches(&self, activation: &TaskActivation) -> bool {
        let now = self.state.active_elapsed_ms;
        let duration = self.config.duration.active_duration_ms;
        let progress = (u128::from(now) * 10_000 / u128::from(duration)) as u16;
        if now < activation.after_active_ms
            || activation.before_active_ms.is_some_and(|end| now >= end)
            || activation
                .progress_basis_points
                .is_some_and(|[start, end]| progress < start || progress > end)
            || activation
                .minimum_completed
                .iter()
                .any(|id| !self.state.completed_events.contains(id))
        {
            return false;
        }
        true
    }

    fn node_active(&self, node: &TaskNode, wanted: Option<&str>) -> bool {
        if !self.activation_matches(node.properties().0) {
            return false;
        }
        match node {
            TaskNode::Event { event_id, .. } => self
                .config
                .events
                .iter()
                .find(|event| event.id == *event_id)
                .is_some_and(|event| {
                    wanted.is_none_or(|wanted| wanted == event.id) && self.event_eligible(event)
                }),
            TaskNode::Group { children, .. } => {
                children.iter().any(|child| self.node_active(child, wanted))
            }
        }
    }

    fn node_weight(&self, node: &TaskNode) -> u64 {
        if !self.node_active(node, None) {
            return 0;
        }
        let weight = node.properties().1;
        let now = self.state.active_elapsed_ms;
        let duration = self.config.duration.active_duration_ms;
        let remaining = duration.saturating_sub(now);
        ((u128::from(weight.start) * u128::from(remaining)
            + u128::from(weight.end) * u128::from(now))
            * 10_000
            / u128::from(duration)) as u64
    }

    fn draw_node(&mut self, node: &TaskNode) -> Option<String> {
        if self.node_weight(node) == 0 {
            return None;
        }
        match node {
            TaskNode::Event { event_id, .. } => Some(event_id.clone()),
            TaskNode::Group { children, .. } => {
                let weights: Vec<u64> = children
                    .iter()
                    .map(|child| self.node_weight(child))
                    .collect();
                let total: u64 = weights.iter().sum();
                if total == 0 {
                    return None;
                }
                let mut draw = self.rng.gen_range(0..total);
                for (child, weight) in children.iter().zip(weights) {
                    if draw < weight {
                        return self.draw_node(child);
                    }
                    draw -= weight;
                }
                None
            }
        }
    }

    fn draw_weighted_events(&mut self, effects: &mut Vec<SessionEffect>) {
        let EventScheduling::Weighted {
            interval_ms,
            max_concurrent,
        } = self.config.event_scheduling
        else {
            return;
        };
        let now = self.state.active_elapsed_ms;
        let delay = self.rng.gen_range(interval_ms[0]..=interval_ms[1]);
        self.next_event_draw_ms = Some(now.saturating_add(delay));
        let pending_blocked = self.process_pending_tasks(effects);
        // Required eligible events run first in stable priority order. A blocked
        // required event suppresses optional draws until the next scheduler pass.
        let mut due: Vec<_> = self
            .config
            .events
            .iter()
            .filter(|event| {
                self.event_eligible(event)
                    && self
                        .config
                        .task_graph
                        .as_ref()
                        .is_none_or(|graph| self.node_active(graph, Some(&event.id)))
                    && self
                        .state
                        .event_history
                        .iter()
                        .filter(|record| record.id == event.id)
                        .count()
                        < usize::from(event.minimum_occurrences)
            })
            .cloned()
            .collect();
        due.sort_by_key(|event| {
            (
                event.execution_order.unwrap_or(99),
                std::cmp::Reverse(event.priority),
            )
        });
        let mut due_blocked = false;
        for event in due {
            if self.event_blocked(&event) {
                due_blocked = true;
            } else {
                self.start_weighted_event(&event, effects);
            }
        }
        if due_blocked || pending_blocked {
            return;
        }
        // Weighted draws consume candidates even when occupancy prevents their
        // start. Do not redraw until an unblocked task wins: that would bias the
        // configured distribution toward short/uncontended tasks.
        // At most one ordinary occupying task starts per draw. A background
        // success extends the slot-based attempt budget once.
        let mut attempts = usize::from(max_concurrent).saturating_sub(self.occupying_count());
        let mut background_extension = false;
        while attempts > 0 {
            attempts -= 1;
            if let Some(graph) = self.config.task_graph.clone() {
                if let Some(event_id) = self.draw_node(&graph) {
                    let event = self
                        .config
                        .events
                        .iter()
                        .find(|event| event.id == event_id)
                        .cloned()
                        .expect("validated task graph");
                    let background = event.occupies.as_ref().is_some_and(Vec::is_empty);
                    if !self.event_blocked(&event)
                        && (background || self.occupying_count() < usize::from(max_concurrent))
                    {
                        self.start_weighted_event(&event, effects);
                        if !background {
                            break;
                        }
                        if !background_extension {
                            attempts += 1;
                            background_extension = true;
                        }
                    }
                }
                continue;
            }
            let candidates: Vec<_> = self
                .config
                .events
                .iter()
                .filter(|event| self.event_eligible(event))
                .filter_map(|event| {
                    let weight = event
                        .weight
                        .unwrap_or(u32::from(event.probability_basis_points));
                    (weight > 0).then(|| (event.clone(), u64::from(weight)))
                })
                .collect();
            let total: u64 = candidates.iter().map(|(_, weight)| weight).sum();
            if total == 0 {
                break;
            }
            let mut draw = self.rng.gen_range(0..total);
            for (event, weight) in candidates {
                if draw < weight {
                    let background = event.occupies.as_ref().is_some_and(Vec::is_empty);
                    if !self.event_blocked(&event)
                        && (background || self.occupying_count() < usize::from(max_concurrent))
                    {
                        self.start_weighted_event(&event, effects);
                        if !background {
                            return;
                        }
                        if !background_extension {
                            attempts += 1;
                            background_extension = true;
                        }
                    }
                    break;
                }
                draw -= weight;
            }
        }
    }

    fn schedule_phase_events(&mut self, effects: &mut Vec<SessionEffect>) {
        if matches!(
            self.config.event_scheduling,
            EventScheduling::Weighted { .. }
        ) {
            self.draw_weighted_events(effects);
            return;
        }
        let phase = &self.config.phases[self.state.phase.index];
        let event_ids = phase.event_ids.clone();
        for event_id in event_ids {
            let Some(definition) = self.config.events.iter().find(|event| event.id == event_id)
            else {
                continue;
            };
            if !definition.allowed_phase_ids.is_empty()
                && !definition
                    .allowed_phase_ids
                    .iter()
                    .any(|id| id == &phase.id)
            {
                continue;
            }
            let count = self
                .state
                .event_history
                .iter()
                .filter(|record| record.id == definition.id)
                .count() as u16;
            let cooldown_met = self
                .state
                .event_history
                .iter()
                .rev()
                .find(|record| record.id == definition.id)
                .is_none_or(|record| {
                    self.state
                        .active_elapsed_ms
                        .saturating_sub(record.started_at_active_ms)
                        >= definition.cooldown_ms
                });
            let required = count < definition.minimum_occurrences;
            let selected = count < definition.maximum_occurrences
                && cooldown_met
                && (required
                    || self.rng.gen_range(0..10_000_u16) < definition.probability_basis_points);
            if !selected {
                continue;
            }
            let record = EventRecord {
                id: definition.id.clone(),
                started_at_active_ms: self.state.active_elapsed_ms,
                duration_ms: definition.duration_ms,
            };
            self.state.current_event = Some(record.clone());
            self.state.active_events = vec![record.clone()];
            self.state.event_history.push(record);
            self.state.statistics.events_started += 1;
            effects.push(SessionEffect::StartEvent {
                event_id: definition.id.clone(),
                duration_ms: definition.duration_ms,
            });
            self.refresh_instruction(effects);
            break;
        }
    }

    fn drive_processor(&mut self, effects: &mut Vec<SessionEffect>) {
        let outputs = self.processor.tick(self.state.active_elapsed_ms);
        self.apply_processor_outputs(outputs, effects);
        self.state.processor = self.processor.snapshot();
        self.refresh_instruction(effects);
    }

    fn apply_processor_outputs(
        &mut self,
        outputs: Vec<ProcessorOutput>,
        effects: &mut Vec<SessionEffect>,
    ) {
        for output in outputs {
            match &output.action {
                ProcessorAction::MediaNext => {
                    self.state.statistics.media_skips =
                        self.state.statistics.media_skips.saturating_add(1);
                    effects.push(SessionEffect::SkipMedia);
                }
                ProcessorAction::SetTempo { bpm, measure } => {
                    self.processor_tempo_owners.insert(
                        output.thread_id.clone(),
                        (*bpm, *measure, self.processor_sequence + 1),
                    );
                    self.update_processor_overrides(output.at_active_ms);
                }
                ProcessorAction::SetBeatPattern { slots } => {
                    self.processor_pattern_owners.insert(
                        output.thread_id.clone(),
                        (slots.clone(), self.processor_sequence + 1),
                    );
                    self.update_processor_overrides(output.at_active_ms);
                }
                ProcessorAction::Reset => {
                    self.processor_tempo_owners.clear();
                    self.processor_pattern_owners.clear();
                    self.update_processor_overrides(output.at_active_ms);
                }
                ProcessorAction::ThreadCompleted { thread_id }
                | ProcessorAction::ThreadCancelled { thread_id } => {
                    let tempo_changed = self.processor_tempo_owners.remove(thread_id).is_some();
                    let pattern_changed = self.processor_pattern_owners.remove(thread_id).is_some();
                    if tempo_changed || pattern_changed {
                        self.update_processor_overrides(output.at_active_ms);
                    }
                    if let Some(event_id) = self.program_threads.remove(thread_id) {
                        if let Some(index) = self
                            .state
                            .active_events
                            .iter()
                            .position(|event| event.id == event_id)
                        {
                            let record = self.state.active_events.remove(index);
                            if let Some(history) =
                                self.state.event_history.iter_mut().rev().find(|history| {
                                    history.id == record.id
                                        && history.started_at_active_ms
                                            == record.started_at_active_ms
                                })
                            {
                                history.duration_ms = output
                                    .at_active_ms
                                    .saturating_sub(history.started_at_active_ms);
                            }
                            if matches!(output.action, ProcessorAction::ThreadCompleted { .. }) {
                                self.state.completed_events.push(event_id.clone());
                            }
                            effects.push(SessionEffect::EndEvent { event_id });
                        }
                    }
                }
                ProcessorAction::Suspend if self.state.status == SessionStatus::Running => {
                    self.state.status = SessionStatus::Paused;
                    self.paused_started_ms = self.last_monotonic_ms.take();
                    effects.push(SessionEffect::PersistCheckpoint);
                }
                ProcessorAction::GameOver => self.end(SessionStatus::Completed, effects),
                ProcessorAction::Fault { message } => {
                    effects.push(SessionEffect::PlaybackFailed {
                        detail: message.clone(),
                    });
                    self.end(SessionStatus::Interrupted, effects);
                }
                _ => {}
            }
            self.processor_sequence = self.processor_sequence.saturating_add(1);
            self.state.processor_outputs.push(SessionProcessorOutput {
                sequence: self.processor_sequence,
                output,
            });
            if self.state.processor_outputs.len() > 512 {
                self.state.processor_outputs.remove(0);
            }
        }
    }

    fn update_processor_overrides(&mut self, at_active_ms: u64) {
        let tempo = self
            .processor_tempo_owners
            .values()
            .max_by_key(|(_, _, sequence)| *sequence)
            .map(|(bpm, measure, _)| (*bpm, *measure));
        if self.processor_tempo.last().map(|(_, previous)| *previous) != Some(tempo) {
            self.processor_tempo.push((at_active_ms, tempo));
        }
        self.processor_pattern = self
            .processor_pattern_owners
            .values()
            .max_by_key(|(_, sequence)| *sequence)
            .map(|(pattern, _)| pattern.clone());
    }

    fn end(&mut self, status: SessionStatus, effects: &mut Vec<SessionEffect>) {
        if !matches!(
            self.state.status,
            SessionStatus::Running | SessionStatus::Paused
        ) {
            return;
        }
        self.state.status = status.clone();
        let outputs = self.processor.stop();
        self.apply_processor_outputs(outputs, effects);
        self.program_threads.clear();
        self.state.processor = self.processor.snapshot();
        for event in self.state.active_events.drain(..) {
            effects.push(SessionEffect::EndEvent { event_id: event.id });
        }
        self.state.current_event = None;
        self.state.instruction = None;
        self.state.pending_tasks.clear();
        self.next_event_draw_ms = None;
        effects.push(SessionEffect::ShowInstruction {
            text: String::new(),
        });
        self.last_monotonic_ms = None;
        effects.push(SessionEffect::StopMusic);
        effects.push(SessionEffect::PersistCheckpoint);
        effects.push(SessionEffect::EndSession { status });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(seed: u64) -> GameConfig {
        GameConfig {
            schema_version: GAME_CONFIG_SCHEMA_VERSION,
            metadata: GameMetadata {
                name: "Test".into(),
                description: String::new(),
            },
            duration: EndCondition {
                active_duration_ms: 10_000,
            },
            difficulty: DifficultyConfig {
                tempo_multiplier: 1.0,
            },
            tempo: TempoConfig {
                curve: TempoCurve::Linear {
                    start_bpm: 60.0,
                    end_bpm: 120.0,
                },
                min_bpm: 40.0,
                max_bpm: 180.0,
                smoothing_per_second: 4.0,
                meter: 4,
                pattern: default_pattern(),
            },
            media: MediaConfig {
                selection_strategy: SelectionStrategy::SeededRandom,
                required_tags: Vec::new(),
                excluded_tags: Vec::new(),
                allow_video_interruption: false,
            },
            phases: vec![
                PhaseConfig {
                    id: "warmup".into(),
                    duration_ms: 5_000,
                    tempo_multiplier: 1.0,
                    event_ids: vec!["cue".into()],
                },
                PhaseConfig {
                    id: "finish".into(),
                    duration_ms: 5_000,
                    tempo_multiplier: 1.25,
                    event_ids: Vec::new(),
                },
            ],
            events: vec![EventDefinition {
                id: "cue".into(),
                probability_basis_points: 10_000,
                minimum_occurrences: 0,
                maximum_occurrences: 1,
                cooldown_ms: 0,
                duration_ms: 1_000,
                priority: 1,
                allowed_phase_ids: vec!["warmup".into()],
                instruction: Some("Ready".into()),
                weight: None,
                occupies: None,
                execution_order: None,
                tempo: None,
                program: Vec::new(),
                beat_pattern: None,
            }],
            instructor: InstructorConfig {
                voice_pack_id: None,
                script_preset_id: None,
            },
            audio: AudioConfig {
                music_playlist_id: None,
                metronome_enabled: true,
                music_volume_percent: 80,
                voice_volume_percent: 80,
            },
            seed: Some(seed),
            event_scheduling: EventScheduling::Legacy,
            task_graph: None,
            scheduled_tasks: Vec::new(),
            script: Vec::new(),
        }
    }

    #[test]
    fn paused_time_is_excluded_from_active_elapsed() {
        let mut engine = SessionEngine::new(config(7)).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 100 });
        engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 1_100,
        });
        engine.dispatch(SessionCommand::Pause {
            monotonic_ms: 1_100,
        });
        engine.dispatch(SessionCommand::Resume {
            monotonic_ms: 9_100,
        });
        let update = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 10_100,
        });
        assert_eq!(update.state.active_elapsed_ms, 2_000);
        assert_eq!(update.state.paused_elapsed_ms, 8_000);
    }

    fn weighted_config() -> GameConfig {
        let mut cfg = config(71);
        cfg.phases.truncate(1);
        cfg.phases[0].duration_ms = 10_000;
        cfg.events[0].maximum_occurrences = 20;
        cfg.events[0].duration_ms = 2_000;
        cfg.events[0].occupies = Some(vec!["tempo".into()]);
        cfg.event_scheduling = EventScheduling::Weighted {
            interval_ms: [1_000, 1_000],
            max_concurrent: 2,
        };
        cfg
    }

    #[test]
    fn weighted_draws_recur_after_expiry_and_pause_freezes_draw_deadlines() {
        let mut engine = SessionEngine::new(weighted_config()).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        engine.dispatch(SessionCommand::Pause { monotonic_ms: 500 });
        engine.dispatch(SessionCommand::Resume {
            monotonic_ms: 10_500,
        });
        let update = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 12_000,
        });
        assert_eq!(update.state.active_elapsed_ms, 2_000);
        assert_eq!(update.state.event_history.len(), 2);
        assert_eq!(update.state.event_history[1].started_at_active_ms, 2_000);
        assert_eq!(update.state.active_events.len(), 1);
        let end = update
            .effects
            .iter()
            .position(|effect| matches!(effect, SessionEffect::EndEvent { .. }))
            .unwrap();
        let start = update
            .effects
            .iter()
            .position(|effect| matches!(effect, SessionEffect::StartEvent { .. }))
            .unwrap();
        assert!(end < start);
    }

    #[test]
    fn weighted_due_tasks_respect_resources_caps_and_priority() {
        let mut cfg = weighted_config();
        cfg.events[0].minimum_occurrences = 1;
        let mut other = cfg.events[0].clone();
        other.id = "other".into();
        other.priority = 9;
        cfg.phases[0].event_ids.push(other.id.clone());
        cfg.events.push(other);
        let mut engine = SessionEngine::new(cfg.clone()).unwrap();
        let start = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(start.state.active_events.len(), 1);
        assert_eq!(start.state.active_events[0].id, "other");
        // Disjoint required resources can run concurrently.
        cfg.events[1].occupies = Some(vec!["visual".into()]);
        let mut engine = SessionEngine::new(cfg).unwrap();
        let start = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(start.state.active_events.len(), 2);
        let end = engine.dispatch(SessionCommand::End {
            completed: false,
            monotonic_ms: 500,
        });
        assert!(end.state.active_events.is_empty());
        assert!(end.state.current_event.is_none());
        assert_eq!(
            end.effects
                .iter()
                .filter(|effect| matches!(effect, SessionEffect::EndEvent { .. }))
                .count(),
            2
        );
    }

    #[test]
    fn zero_weight_disables_optional_tasks_and_required_tasks_obey_cooldowns() {
        let mut cfg = weighted_config();
        cfg.events[0].weight = Some(0);
        let mut engine = SessionEngine::new(cfg.clone()).unwrap();
        assert!(engine
            .dispatch(SessionCommand::Start { monotonic_ms: 0 })
            .state
            .event_history
            .is_empty());
        cfg.events[0].minimum_occurrences = 2;
        cfg.events[0].cooldown_ms = 5_000;
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        let before = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 4_999,
        });
        assert_eq!(before.state.event_history.len(), 1);
        let after = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 5_000,
        });
        assert_eq!(after.state.event_history.len(), 2);
        assert_eq!(after.state.event_history[1].started_at_active_ms, 5_000);
    }

    #[test]
    fn weighted_delayed_ticks_preserve_seeded_event_sequence() {
        let mut cfg = weighted_config();
        cfg.event_scheduling = EventScheduling::Weighted {
            interval_ms: [1_000, 2_000],
            max_concurrent: 2,
        };
        let mut delayed = SessionEngine::new(cfg.clone()).unwrap();
        let mut timely = SessionEngine::new(cfg).unwrap();
        delayed.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        timely.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        for monotonic_ms in (100..=9_000).step_by(100) {
            timely.dispatch(SessionCommand::Tick { monotonic_ms });
        }
        delayed.dispatch(SessionCommand::Tick {
            monotonic_ms: 9_000,
        });
        assert_eq!(delayed.state.event_history, timely.state.event_history);
        assert_eq!(delayed.state.active_events, timely.state.active_events);
    }

    #[test]
    fn old_configuration_deserializes_with_legacy_scheduling() {
        let mut value = serde_json::to_value(config(1)).unwrap();
        value.as_object_mut().unwrap().remove("event_scheduling");
        for event in value["events"].as_array_mut().unwrap() {
            event.as_object_mut().unwrap().remove("weight");
            event.as_object_mut().unwrap().remove("occupies");
        }
        let config: GameConfig = serde_json::from_value(value).unwrap();
        assert_eq!(config.event_scheduling, EventScheduling::Legacy);
        config.validate().unwrap();
    }

    fn graph_event(id: &str, activation: TaskActivation) -> TaskNode {
        TaskNode::Event {
            event_id: id.into(),
            activation,
            weight: TaskWeight::default(),
        }
    }

    #[test]
    fn hierarchy_predicates_and_completion_unlock_a_child() {
        let mut cfg = weighted_config();
        cfg.events[0].duration_ms = 500;
        let mut next = cfg.events[0].clone();
        next.id = "next".into();
        cfg.phases[0].event_ids.push(next.id.clone());
        cfg.events.push(next);
        cfg.task_graph = Some(TaskNode::Group {
            activation: TaskActivation::default(),
            weight: TaskWeight::default(),
            children: vec![graph_event(
                "next",
                TaskActivation {
                    after_active_ms: 1_000,
                    minimum_completed: vec!["cue".into()],
                    ..TaskActivation::default()
                },
            )],
        });
        cfg.scheduled_tasks = vec![ScheduledTask {
            event_id: "cue".into(),
            at_active_ms: 0,
        }];
        let mut engine = SessionEngine::new(cfg).unwrap();
        let start = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(start.state.event_history.len(), 1);
        let update = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 1_000,
        });
        assert_eq!(update.state.event_history[1].id, "next");
        assert_eq!(update.state.completed_events, ["cue"]);
    }

    #[test]
    fn background_tasks_do_not_block_exclusive_due_tasks() {
        let mut cfg = weighted_config();
        cfg.events[0].minimum_occurrences = 1;
        cfg.events[0].occupies = Some(vec![]);
        let mut exclusive = cfg.events[0].clone();
        exclusive.id = "exclusive".into();
        exclusive.occupies = None;
        cfg.phases[0].event_ids.push(exclusive.id.clone());
        cfg.events.push(exclusive);
        cfg.event_scheduling = EventScheduling::Weighted {
            interval_ms: [1_000, 1_000],
            max_concurrent: 1,
        };
        let mut engine = SessionEngine::new(cfg).unwrap();
        let update = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(update.state.active_events.len(), 2);
        assert_eq!(engine.occupying_count(), 1);
    }

    #[test]
    fn queued_tasks_pause_and_manual_completion_release_resources() {
        let mut cfg = weighted_config();
        cfg.events[0].weight = Some(0);
        cfg.scheduled_tasks = vec![ScheduledTask {
            event_id: "cue".into(),
            at_active_ms: 500,
        }];
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        engine.dispatch(SessionCommand::Pause { monotonic_ms: 400 });
        engine.dispatch(SessionCommand::InjectEvent {
            event_id: "cue".into(),
            monotonic_ms: 8_000,
        });
        assert!(engine.state.active_events.is_empty());
        engine.dispatch(SessionCommand::Resume {
            monotonic_ms: 8_400,
        });
        let update = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 8_500,
        });
        assert_eq!(update.state.active_events.len(), 1);
        assert_eq!(update.state.pending_tasks.len(), 1);
        let completed = engine.dispatch(SessionCommand::CompleteEvent {
            event_id: "cue".into(),
            monotonic_ms: 8_500,
        });
        assert_eq!(completed.state.completed_events, ["cue"]);
        assert_eq!(completed.state.event_history.len(), 2);
        assert!(completed.state.pending_tasks.is_empty());
    }

    #[test]
    fn pending_due_cooldown_is_independent_of_tick_frequency() {
        let mut cfg = weighted_config();
        cfg.events[0].weight = Some(0);
        cfg.events[0].duration_ms = 100;
        cfg.events[0].cooldown_ms = 1_250;
        cfg.scheduled_tasks = vec![
            ScheduledTask {
                event_id: "cue".into(),
                at_active_ms: 0,
            },
            ScheduledTask {
                event_id: "cue".into(),
                at_active_ms: 500,
            },
        ];
        let mut timely = SessionEngine::new(cfg.clone()).unwrap();
        let mut delayed = SessionEngine::new(cfg).unwrap();
        timely.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        delayed.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        for monotonic_ms in (100..=2_000).step_by(100) {
            timely.dispatch(SessionCommand::Tick { monotonic_ms });
        }
        delayed.dispatch(SessionCommand::Tick {
            monotonic_ms: 2_000,
        });
        assert_eq!(timely.state.event_history, delayed.state.event_history);
        assert_eq!(delayed.state.event_history[1].started_at_active_ms, 1_250);
    }

    #[test]
    fn pause_at_terminal_deadline_cannot_resurrect_session() {
        let mut engine = SessionEngine::new(weighted_config()).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        let ended = engine.dispatch(SessionCommand::Pause {
            monotonic_ms: 10_000,
        });
        assert_eq!(ended.state.status, SessionStatus::Completed);
        assert!(ended.state.instruction.is_none());
        assert!(ended.state.active_events.is_empty());
        assert!(engine
            .dispatch(SessionCommand::UserAction {
                name: "late".into()
            })
            .effects
            .is_empty());
    }

    #[test]
    fn invalid_graph_and_audio_are_rejected_before_start() {
        let mut cfg = weighted_config();
        cfg.task_graph = Some(graph_event("missing", TaskActivation::default()));
        assert!(cfg.validate().is_err());
        cfg.task_graph = None;
        cfg.audio.voice_volume_percent = 101;
        assert!(cfg.validate().is_err());
        cfg.audio.voice_volume_percent = 80;
        cfg.tempo.smoothing_per_second = f64::NAN;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn nested_dynamic_weights_and_instruction_expiry_are_deterministic() {
        let mut cfg = weighted_config();
        cfg.events[0].duration_ms = 100;
        cfg.events[0].maximum_occurrences = 1;
        cfg.task_graph = Some(TaskNode::Group {
            activation: TaskActivation::default(),
            weight: TaskWeight::default(),
            children: vec![TaskNode::Group {
                activation: TaskActivation::default(),
                weight: TaskWeight { start: 0, end: 10 },
                children: vec![graph_event("cue", TaskActivation::default())],
            }],
        });
        let mut engine = SessionEngine::new(cfg).unwrap();
        assert!(engine
            .dispatch(SessionCommand::Start { monotonic_ms: 0 })
            .state
            .event_history
            .is_empty());
        let active = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 1_000,
        });
        assert_eq!(active.state.instruction.as_deref(), Some("Ready"));
        let expired = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 1_100,
        });
        assert!(expired.state.instruction.is_none());
        assert!(expired.effects.iter().any(
            |effect| matches!(effect, SessionEffect::ShowInstruction { text } if text.is_empty())
        ));
    }

    #[test]
    fn irregular_ticks_and_delayed_ticks_produce_identical_smoothed_tempo() {
        let mut cfg = config(52);
        cfg.tempo.curve = TempoCurve::Eased {
            start_bpm: 60.0,
            end_bpm: 160.0,
        };
        let mut timely = SessionEngine::new(cfg.clone()).unwrap();
        let mut delayed = SessionEngine::new(cfg).unwrap();
        timely.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        delayed.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        for monotonic_ms in (17..9_000).step_by(17) {
            timely.dispatch(SessionCommand::Tick { monotonic_ms });
        }
        let a = timely.dispatch(SessionCommand::Tick {
            monotonic_ms: 9_000,
        });
        let b = delayed.dispatch(SessionCommand::Tick {
            monotonic_ms: 9_000,
        });
        assert_eq!(a.state.tempo, b.state.tempo);
    }

    #[test]
    fn due_tasks_ignore_random_capacity_and_preserve_instruction() {
        let mut cfg = weighted_config();
        cfg.events[0].minimum_occurrences = 1;
        cfg.events[0].execution_order = Some(1);
        let mut other = cfg.events[0].clone();
        other.id = "other".into();
        other.occupies = Some(vec!["visual".into()]);
        other.priority = 9;
        other.execution_order = Some(2);
        other.instruction = None;
        cfg.events.push(other);
        cfg.phases[0].event_ids.push("other".into());
        cfg.event_scheduling = EventScheduling::Weighted {
            interval_ms: [1_000, 1_000],
            max_concurrent: 1,
        };
        let update = SessionEngine::new(cfg)
            .unwrap()
            .dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(update.state.active_events.len(), 2);
        assert_eq!(update.state.event_history[0].id, "cue");
        assert_eq!(update.state.instruction.as_deref(), Some("Ready"));
    }

    #[test]
    fn deterministic_seed_produces_the_same_effects() {
        let mut first = SessionEngine::new(config(9)).unwrap();
        let mut second = SessionEngine::new(config(9)).unwrap();
        assert_eq!(
            first.dispatch(SessionCommand::Start { monotonic_ms: 0 }),
            second.dispatch(SessionCommand::Start { monotonic_ms: 0 })
        );
        assert_eq!(
            first.dispatch(SessionCommand::Tick {
                monotonic_ms: 1_000
            }),
            second.dispatch(SessionCommand::Tick {
                monotonic_ms: 1_000
            })
        );
    }

    #[test]
    fn typed_tempo_outputs_apply_double_speed_rest_and_manual_restoration() {
        let mut cfg = weighted_config();
        cfg.tempo.curve = TempoCurve::Constant { bpm: 60.0 };
        cfg.events[0].weight = Some(0);
        cfg.events[0].tempo = Some(EventTempo::Multiplier { factor: 2.0 });
        cfg.scheduled_tasks = vec![ScheduledTask {
            event_id: "cue".into(),
            at_active_ms: 1_000,
        }];
        let mut rest = cfg.events[0].clone();
        rest.id = "rest".into();
        rest.priority = 9;
        rest.occupies = Some(vec![]);
        rest.tempo = Some(EventTempo::Multiplier { factor: 0.0 });
        cfg.events.push(rest);
        cfg.phases[0].event_ids.push("rest".into());
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(
            engine
                .dispatch(SessionCommand::Tick {
                    monotonic_ms: 1_000
                })
                .state
                .tempo
                .target_bpm,
            120.0
        );
        assert_eq!(
            engine
                .dispatch(SessionCommand::InjectEvent {
                    event_id: "rest".into(),
                    monotonic_ms: 1_200
                })
                .state
                .tempo
                .target_bpm,
            0.0
        );
        assert_eq!(
            engine
                .dispatch(SessionCommand::CompleteEvent {
                    event_id: "rest".into(),
                    monotonic_ms: 1_250
                })
                .state
                .tempo
                .target_bpm,
            120.0
        );
        assert_eq!(engine.state.event_history.last().unwrap().duration_ms, 50);
        assert_eq!(
            engine
                .dispatch(SessionCommand::CompleteEvent {
                    event_id: "cue".into(),
                    monotonic_ms: 1_500
                })
                .state
                .tempo
                .target_bpm,
            60.0
        );
    }

    #[test]
    fn ramp_outputs_preserve_delayed_tick_tempo_after_expiry() {
        let mut cfg = weighted_config();
        cfg.tempo.curve = TempoCurve::Constant { bpm: 60.0 };
        cfg.events[0].weight = Some(0);
        cfg.events[0].tempo = Some(EventTempo::Ramp {
            start_factor: 1.0,
            end_factor: 2.0,
        });
        cfg.scheduled_tasks = vec![ScheduledTask {
            event_id: "cue".into(),
            at_active_ms: 1_000,
        }];
        let mut timely = SessionEngine::new(cfg.clone()).unwrap();
        let mut delayed = SessionEngine::new(cfg).unwrap();
        timely.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        delayed.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(
            delayed
                .dispatch(SessionCommand::Tick {
                    monotonic_ms: 2_000
                })
                .state
                .tempo
                .target_bpm,
            90.0
        );
        for monotonic_ms in (17..5_000).step_by(17) {
            timely.dispatch(SessionCommand::Tick { monotonic_ms });
        }
        let a = timely.dispatch(SessionCommand::Tick {
            monotonic_ms: 5_000,
        });
        let b = delayed.dispatch(SessionCommand::Tick {
            monotonic_ms: 5_000,
        });
        assert_eq!(a.state.tempo, b.state.tempo);
        assert_eq!(b.state.tempo.target_bpm, 60.0);
    }

    #[test]
    fn invalid_phase_and_event_references_fail_before_start() {
        let mut invalid = config(1);
        invalid.events[0].allowed_phase_ids = vec!["missing".into()];
        assert!(SessionEngine::new(invalid).is_err());

        let mut invalid = config(1);
        invalid.phases[0].event_ids = vec!["missing".into()];
        assert!(SessionEngine::new(invalid).is_err());
    }

    #[test]
    fn quick_mode_compiles_to_a_valid_versioned_game_config() {
        GameConfig::quick_default().validate().unwrap();
    }

    #[test]
    fn service_is_the_only_mutation_boundary_for_an_active_engine() {
        let service = SessionService::default();
        assert!(service.start(config(13)).is_ok());
        let update = service
            .dispatch(SessionCommand::Start { monotonic_ms: 1 })
            .unwrap();
        assert_eq!(update.state.status, SessionStatus::Running);
        assert!(service.start(config(14)).is_err());
        assert_eq!(
            service.interrupt_active().unwrap().state.status,
            SessionStatus::Interrupted
        );
    }

    #[test]
    fn task_program_keeps_occupancy_until_choice_and_final_wait_complete() {
        let mut cfg = weighted_config();
        cfg.events[0].weight = Some(0);
        cfg.events[0].maximum_occurrences = 1;
        cfg.events[0].duration_ms = 100;
        cfg.events[0].program = vec![
            ProcessorEvent::Instruction {
                id: "checkpoint".into(),
                title: "Checkpoint".into(),
                description: String::new(),
                options: vec!["Continue".into()],
                blocking: true,
            },
            ProcessorEvent::Wait { duration_ms: 200 },
            ProcessorEvent::MediaNext,
        ];
        cfg.scheduled_tasks = vec![ScheduledTask {
            event_id: "cue".into(),
            at_active_ms: 0,
        }];
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        let waiting = engine.dispatch(SessionCommand::Tick { monotonic_ms: 500 });
        assert_eq!(waiting.state.active_events.len(), 1);
        assert_eq!(waiting.state.processor.pending_instructions.len(), 1);
        engine.dispatch(SessionCommand::ChooseOption {
            instruction_id: "checkpoint".into(),
            option_index: 0,
            monotonic_ms: 500,
        });
        assert_eq!(
            engine
                .dispatch(SessionCommand::Tick { monotonic_ms: 699 })
                .state
                .active_events
                .len(),
            1
        );
        let finished = engine.dispatch(SessionCommand::Tick { monotonic_ms: 700 });
        assert!(finished.state.active_events.is_empty());
        assert_eq!(finished.state.event_history[0].duration_ms, 700);
        assert_eq!(finished.state.statistics.media_skips, 1);
    }

    #[test]
    fn manual_program_completion_cleans_status_and_cancels_future_actions() {
        let mut cfg = weighted_config();
        cfg.events[0].weight = Some(0);
        cfg.events[0].maximum_occurrences = 1;
        cfg.events[0].program = vec![
            ProcessorEvent::StatusEffect {
                id: "task-status".into(),
                message: "Active".into(),
            },
            ProcessorEvent::Wait { duration_ms: 5_000 },
            ProcessorEvent::MediaNext,
        ];
        cfg.scheduled_tasks = vec![ScheduledTask {
            event_id: "cue".into(),
            at_active_ms: 0,
        }];
        let mut engine = SessionEngine::new(cfg).unwrap();
        assert_eq!(
            engine
                .dispatch(SessionCommand::Start { monotonic_ms: 0 })
                .state
                .processor
                .status_effects
                .len(),
            1
        );
        let completed = engine.dispatch(SessionCommand::CompleteEvent {
            event_id: "cue".into(),
            monotonic_ms: 100,
        });
        assert!(completed.state.processor.status_effects.is_empty());
        assert!(completed.state.processor.threads.is_empty());
        assert_eq!(
            engine
                .dispatch(SessionCommand::Tick {
                    monotonic_ms: 6_000
                })
                .state
                .statistics
                .media_skips,
            0
        );
    }

    #[test]
    fn processor_suspend_preserves_the_exact_active_boundary_and_resume_deadline() {
        let mut cfg = weighted_config();
        cfg.events.clear();
        cfg.phases[0].event_ids.clear();
        cfg.script = vec![
            ProcessorEvent::Wait { duration_ms: 100 },
            ProcessorEvent::Suspend,
            ProcessorEvent::Wait { duration_ms: 100 },
            ProcessorEvent::MediaNext,
        ];
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 10 });
        let paused = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 1_010,
        });
        assert_eq!(paused.state.status, SessionStatus::Paused);
        assert_eq!(paused.state.active_elapsed_ms, 100);
        let resumed = engine.dispatch(SessionCommand::Resume {
            monotonic_ms: 2_010,
        });
        assert_eq!(resumed.state.paused_elapsed_ms, 1_900);
        let next = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 2_110,
        });
        assert_eq!(next.state.active_elapsed_ms, 200);
        assert_eq!(next.state.statistics.media_skips, 1);
    }

    #[test]
    fn processor_output_history_is_bounded_and_terminal_cleanup_is_complete() {
        let mut cfg = weighted_config();
        cfg.events.clear();
        cfg.phases[0].event_ids.clear();
        cfg.script = vec![ProcessorEvent::MediaNext; 600];
        cfg.script.push(ProcessorEvent::Wait { duration_ms: 300 });
        cfg.script.push(ProcessorEvent::GameOver);
        let mut engine = SessionEngine::new(cfg).unwrap();
        let started = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(started.state.processor_outputs.len(), 512);
        assert_eq!(started.state.statistics.media_skips, 600);
        assert!(started
            .state
            .processor_outputs
            .windows(2)
            .all(|pair| pair[0].sequence < pair[1].sequence));
        let ended = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 1_000,
        });
        assert_eq!(ended.state.status, SessionStatus::Completed);
        assert_eq!(ended.state.active_elapsed_ms, 300);
        assert!(ended.state.processor.pending_instructions.is_empty());
        assert!(ended.state.processor.threads.is_empty());
    }

    #[test]
    fn required_tasks_obey_graph_activation_even_with_zero_weight() {
        let mut cfg = weighted_config();
        cfg.events[0].minimum_occurrences = 1;
        cfg.events[0].weight = Some(0);
        cfg.task_graph = Some(TaskNode::Event {
            event_id: "cue".into(),
            activation: TaskActivation {
                after_active_ms: 2_000,
                ..TaskActivation::default()
            },
            weight: TaskWeight { start: 0, end: 0 },
        });
        let mut engine = SessionEngine::new(cfg).unwrap();
        assert!(engine
            .dispatch(SessionCommand::Start { monotonic_ms: 0 })
            .state
            .event_history
            .is_empty());
        assert!(engine
            .dispatch(SessionCommand::Tick {
                monotonic_ms: 1_999
            })
            .state
            .event_history
            .is_empty());
        assert_eq!(
            engine
                .dispatch(SessionCommand::Tick {
                    monotonic_ms: 2_000
                })
                .state
                .event_history[0]
                .started_at_active_ms,
            2_000
        );
    }

    #[test]
    fn tempo_offset_is_stable_across_repeated_pause_resume() {
        let mut engine = SessionEngine::new(config(21)).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 100 });
        engine.dispatch(SessionCommand::ChangeTempoOffset { offset_ms: 240 });
        engine.dispatch(SessionCommand::Pause {
            monotonic_ms: 1_100,
        });
        engine.dispatch(SessionCommand::Resume {
            monotonic_ms: 2_100,
        });
        engine.dispatch(SessionCommand::Pause {
            monotonic_ms: 3_100,
        });
        let update = engine.dispatch(SessionCommand::Resume {
            monotonic_ms: 7_100,
        });

        assert_eq!(update.state.tempo.offset_ms, 240);
        assert_eq!(update.state.active_elapsed_ms, 2_000);
        assert_eq!(update.state.paused_elapsed_ms, 5_000);
    }

    #[test]
    fn terminal_commands_settle_running_and_paused_intervals_once() {
        let mut running = SessionEngine::new(config(31)).unwrap();
        running.dispatch(SessionCommand::Start { monotonic_ms: 100 });
        let ended = running.dispatch(SessionCommand::End {
            completed: false,
            monotonic_ms: 1_100,
        });
        assert_eq!(ended.state.active_elapsed_ms, 1_000);
        assert_eq!(ended.state.status, SessionStatus::Cancelled);
        assert_eq!(
            ended
                .effects
                .iter()
                .filter(|effect| matches!(effect, SessionEffect::EndSession { .. }))
                .count(),
            1
        );
        let repeated = running.dispatch(SessionCommand::End {
            completed: false,
            monotonic_ms: 2_100,
        });
        assert_eq!(repeated.state.active_elapsed_ms, 1_000);
        assert!(repeated.effects.is_empty());

        let mut paused = SessionEngine::new(config(32)).unwrap();
        paused.dispatch(SessionCommand::Start { monotonic_ms: 100 });
        paused.dispatch(SessionCommand::Pause {
            monotonic_ms: 1_100,
        });
        let ended = paused.dispatch(SessionCommand::Interrupt {
            monotonic_ms: 9_100,
        });
        assert_eq!(ended.state.active_elapsed_ms, 1_000);
        assert_eq!(ended.state.paused_elapsed_ms, 8_000);
        assert_eq!(ended.state.status, SessionStatus::Interrupted);
    }

    #[test]
    fn delayed_ticks_emit_every_crossed_phase_in_order() {
        let mut cfg = config(41);
        cfg.phases = vec![
            PhaseConfig {
                id: "one".into(),
                duration_ms: 2_000,
                tempo_multiplier: 1.0,
                event_ids: vec![],
            },
            PhaseConfig {
                id: "two".into(),
                duration_ms: 2_000,
                tempo_multiplier: 1.0,
                event_ids: vec![],
            },
            PhaseConfig {
                id: "three".into(),
                duration_ms: 6_000,
                tempo_multiplier: 1.0,
                event_ids: vec![],
            },
        ];
        cfg.events.clear();
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        let update = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 6_500,
        });
        let phases: Vec<_> = update
            .effects
            .iter()
            .filter_map(|effect| match effect {
                SessionEffect::StartPhase { phase_id } => Some(phase_id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(phases, ["two", "three"]);
        assert_eq!(update.state.statistics.phase_changes, 2);
    }

    #[test]
    fn active_event_survives_phase_change_then_expires_at_its_deadline() {
        let mut cfg = config(51);
        cfg.events[0].duration_ms = 6_000;
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        let boundary = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 5_000,
        });
        assert_eq!(boundary.state.phase.id, "finish");
        assert_eq!(
            boundary
                .state
                .current_event
                .as_ref()
                .map(|event| event.id.as_str()),
            Some("cue")
        );
        assert!(!boundary
            .effects
            .iter()
            .any(|effect| matches!(effect, SessionEffect::EndEvent { .. })));
        let expiry = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 6_000,
        });
        assert!(expiry.state.current_event.is_none());
        assert!(expiry.effects.iter().any(
            |effect| matches!(effect, SessionEffect::EndEvent { event_id } if event_id == "cue")
        ));
    }

    #[test]
    fn cooldown_uses_the_latest_matching_event_not_an_interleaved_event() {
        let mut cfg = config(61);
        cfg.phases[0].event_ids = vec!["a".into()];
        cfg.events = vec![EventDefinition {
            id: "a".into(),
            probability_basis_points: 10_000,
            minimum_occurrences: 0,
            maximum_occurrences: 3,
            cooldown_ms: 5_000,
            duration_ms: 1_000,
            priority: 1,
            allowed_phase_ids: vec!["warmup".into()],
            instruction: None,
            weight: None,
            occupies: None,
            execution_order: None,
            tempo: None,
            program: Vec::new(),
            beat_pattern: None,
        }];
        let mut engine = SessionEngine::new(cfg).unwrap();
        engine.state.active_elapsed_ms = 11_000;
        engine.state.event_history = vec![
            EventRecord {
                id: "a".into(),
                started_at_active_ms: 0,
                duration_ms: 1_000,
            },
            EventRecord {
                id: "other".into(),
                started_at_active_ms: 9_000,
                duration_ms: 1_000,
            },
        ];
        let mut effects = Vec::new();
        engine.schedule_phase_events(&mut effects);
        assert!(effects.iter().any(
            |effect| matches!(effect, SessionEffect::StartEvent { event_id, .. } if event_id == "a")
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn service_runner_completes_a_started_session_without_a_client_tick() {
        let clock = std::sync::Arc::new(AtomicU64::new(0));
        let service_clock = std::sync::Arc::clone(&clock);
        let service = SessionService::with_clock(move || service_clock.load(Ordering::SeqCst));
        let mut updates = service.subscribe();
        let mut cfg = config(71);
        cfg.duration.active_duration_ms = 100;
        cfg.phases[0].duration_ms = 100;
        cfg.phases.truncate(1);
        let started = service.start_running(cfg).unwrap();
        assert_eq!(started.state.status, SessionStatus::Running);
        assert_eq!(
            service.start_running(config(72)).unwrap_err(),
            "A session is already active"
        );
        assert_eq!(
            service.snapshot().unwrap().session_id,
            started.state.session_id
        );

        // Advance the scheduler and injected process clock together. No wall
        // clock sleep or client Tick participates in session completion.
        tokio::task::yield_now().await;
        clock.store(100, Ordering::SeqCst);
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;

        let terminal = tokio::time::timeout(std::time::Duration::from_millis(1), async {
            loop {
                let update = updates.recv().await.unwrap();
                if update
                    .effects
                    .iter()
                    .any(|effect| matches!(effect, SessionEffect::EndSession { .. }))
                {
                    return update;
                }
            }
        })
        .await
        .expect("the authoritative runner should complete from injected time");
        assert_eq!(terminal.state.status, SessionStatus::Completed);
    }

    #[tokio::test(start_paused = true)]
    async fn starting_during_playback_pause_has_no_running_interval_or_running_notification() {
        let clock = std::sync::Arc::new(AtomicU64::new(0));
        let service_clock = clock.clone();
        let service = SessionService::with_clock(move || service_clock.load(Ordering::SeqCst));
        let mut updates = service.subscribe();
        let started = service.start_paused(config(72)).unwrap();
        assert_eq!(started.state.status, SessionStatus::Paused);
        assert_eq!(started.state.active_elapsed_ms, 0);
        assert_eq!(
            updates.try_recv().unwrap().state.status,
            SessionStatus::Paused
        );
        assert!(updates.try_recv().is_err());
        clock.store(60_000, Ordering::SeqCst);
        let resumed = service.control(SessionControl::Resume).unwrap();
        assert_eq!(resumed.state.active_elapsed_ms, 0);
        assert_eq!(resumed.state.paused_elapsed_ms, 60_000);
        assert_eq!(resumed.state.session_id, started.state.session_id);
        clock.store(60_100, Ordering::SeqCst);
        assert_eq!(
            service
                .control(SessionControl::Pause)
                .unwrap()
                .state
                .active_elapsed_ms,
            100
        );
        service.stop_runner();
    }

    #[test]
    fn a_ready_session_cannot_be_replaced_before_its_start_command() {
        let service = SessionService::default();
        let first = service.start(config(81)).unwrap();
        assert_eq!(
            service.start(config(82)).unwrap_err(),
            "A session is already active"
        );
        assert_eq!(service.snapshot().unwrap().session_id, first.session_id);
    }
}
