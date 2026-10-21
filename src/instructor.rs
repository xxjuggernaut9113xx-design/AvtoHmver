//! Native single-player preset compiler. No browser or remote generator is used.
use crate::instructor_processor::ProcessorEvent;
use crate::session::{
    EventDefinition, EventScheduling, EventTempo, GameConfig, PhaseConfig, ScheduledTask,
    TaskActivation, TaskNode, TaskWeight, TempoCurve,
};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};

/// Quarter-unit slots. Zero is a silent quarter rest.
pub const BEAT_PATTERNS: [&[f64]; 8] = [
    &[1.0],
    &[0.0, 1.0, 0.0, 1.0, 1.0, 1.0],
    &[1.0, 1.0, 0.0],
    &[0.0, 1.0, 1.0, 1.0],
    &[0.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0],
    &[2.0, 1.0, 1.0, 1.0],
    &[0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.5, 0.5],
    &[2.0, 1.0, 1.0, 0.5, 0.5, 0.0, 1.0, 1.0, 1.0],
];

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Steady,
    Intervals,
    #[default]
    Progressive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstructorOptions {
    pub preset: Preset,
    pub duration_seconds: u64,
    pub start_bpm: f64,
    pub end_bpm: f64,
    pub seed: Option<u64>,
    pub metronome: bool,
    pub cue_volume_percent: u8,
}

impl Default for InstructorOptions {
    fn default() -> Self {
        Self {
            preset: Preset::Progressive,
            duration_seconds: 900,
            start_bpm: 60.0,
            end_bpm: 120.0,
            seed: None,
            metronome: true,
            cue_volume_percent: 55,
        }
    }
}

impl InstructorOptions {
    pub fn compile(&self) -> Result<GameConfig, String> {
        if !(60..=14_400).contains(&self.duration_seconds) {
            return Err("Session duration must be between 60 and 14400 seconds".into());
        }
        if [self.start_bpm, self.end_bpm]
            .iter()
            .any(|bpm| !bpm.is_finite() || !(20.0..=240.0).contains(bpm))
        {
            return Err("Tempo must be between 20 and 240 BPM".into());
        }
        if self.cue_volume_percent > 100 {
            return Err("Cue volume must be between 0 and 100 percent".into());
        }
        let mut config = GameConfig::quick_default();
        config.metadata.name = format!("Native {:?}", self.preset);
        config.metadata.description = "Independent single-player task runtime".into();
        config.seed = Some(self.seed.unwrap_or_else(rand::random));
        config.duration.active_duration_ms = self.duration_seconds * 1_000;
        config.tempo.min_bpm = 20.0;
        config.tempo.max_bpm = 240.0;
        config.tempo.curve = match self.preset {
            Preset::Steady => TempoCurve::Constant {
                bpm: self.start_bpm,
            },
            Preset::Intervals => TempoCurve::Stepped {
                start_bpm: self.start_bpm,
                end_bpm: self.end_bpm,
                steps: 4,
            },
            Preset::Progressive => TempoCurve::Eased {
                start_bpm: self.start_bpm,
                end_bpm: self.end_bpm,
            },
        };
        let total = config.duration.active_duration_ms;
        let phase_specs: &[(&str, u64, f64)] = match self.preset {
            Preset::Steady => &[("medium", 100, 1.0)],
            Preset::Intervals => &[
                ("slow", 20, 0.8),
                ("fast", 25, 1.15),
                ("recovery", 10, 0.6),
                ("medium", 25, 1.0),
                ("cooldown", 20, 0.7),
            ],
            Preset::Progressive => &[
                ("slow", 20, 1.0),
                ("medium", 35, 1.0),
                ("fast", 30, 1.0),
                ("cooldown", 15, 0.7),
            ],
        };
        config.events = vec![
            event(
                "focus",
                "Follow the current tempo.",
                8_000,
                20,
                Some(vec!["guidance".into()]),
            ),
            event(
                "breathing",
                "Keep breathing comfortably.",
                6_000,
                8,
                Some(vec!["guidance".into()]),
            ),
            event("media-next", "", 1_000, 12, Some(vec![])),
            event("checkpoint", "Session checkpoint.", 3_000, 0, Some(vec![])),
        ];
        config.events[3].program = vec![
            ProcessorEvent::Instruction {
                id: "checkpoint".into(),
                title: "Session checkpoint".into(),
                description: "Continue when ready. Pause remains available.".into(),
                options: vec!["Continue".into()],
                blocking: true,
            },
            ProcessorEvent::Wait { duration_ms: 500 },
        ];
        if self.preset != Preset::Steady {
            for (id, text, duration, tempo) in [
                (
                    "double-tempo",
                    "Temporary double tempo.",
                    10_000,
                    EventTempo::Multiplier { factor: 2.0 },
                ),
                (
                    "acceleration",
                    "Tempo increases gradually.",
                    20_000,
                    EventTempo::Ramp {
                        start_factor: 0.75,
                        end_factor: 1.5,
                    },
                ),
                (
                    "rest",
                    "Rest until the tempo returns.",
                    5_000,
                    EventTempo::Multiplier { factor: 0.0 },
                ),
            ] {
                let mut task = event(id, text, duration, 4, Some(vec!["tempo".into()]));
                task.priority = 5;
                task.cooldown_ms = 30_000;
                task.tempo = Some(tempo);
                config.events.push(task);
            }
            let mut pattern = event(
                "beat-pattern",
                "Follow the rhythm pattern.",
                15_000,
                3,
                Some(vec!["tempo".into()]),
            );
            pattern.priority = 5;
            pattern.beat_pattern =
                Some(BEAT_PATTERNS[config.seed.unwrap() as usize % BEAT_PATTERNS.len()].to_vec());
            config.events.push(pattern);
            if self.preset == Preset::Intervals {
                let mut rng = StdRng::seed_from_u64(config.seed.unwrap() ^ 0x7268_7974_686d);
                let fast = self.start_bpm.max(self.end_bpm);
                let slow = self.start_bpm.min(self.end_bpm);
                let notes_wait = |count: u64, bpm: f64| ProcessorEvent::Wait {
                    duration_ms: (count as f64 * 60_000.0 / bpm).ceil() as u64,
                };
                let mut clusters = event(
                    "clusters",
                    "Alternating rhythm clusters.",
                    1,
                    2,
                    Some(vec!["tempo".into()]),
                );
                clusters
                    .program
                    .push(ProcessorEvent::SetBeatPattern { slots: vec![1.0] });
                let sets = rng.gen_range(3..=6);
                let reps: u64 = rng.gen_range(3..=15);
                for set in 0..sets {
                    clusters.program.extend([
                        ProcessorEvent::SetTempo {
                            bpm: fast,
                            measure: 4,
                        },
                        notes_wait(reps.div_ceil(2), fast),
                        ProcessorEvent::SetTempo {
                            bpm: 0.0,
                            measure: 4,
                        },
                        ProcessorEvent::Wait { duration_ms: 1_000 },
                        ProcessorEvent::SetTempo {
                            bpm: slow,
                            measure: 4,
                        },
                        notes_wait(reps.div_ceil(2), slow),
                    ]);
                    if set + 1 != sets {
                        clusters.program.extend([
                            ProcessorEvent::SetTempo {
                                bpm: 0.0,
                                measure: 4,
                            },
                            ProcessorEvent::Wait { duration_ms: 1_000 },
                        ]);
                    }
                }
                clusters.cooldown_ms = 60_000;
                clusters.priority = 5;
                config.events.push(clusters);
                let mut random = event(
                    "random-beat",
                    "Alternating fast and slow beats.",
                    1,
                    2,
                    Some(vec!["tempo".into()]),
                );
                random
                    .program
                    .push(ProcessorEvent::SetBeatPattern { slots: vec![1.0] });
                let range = fast - slow;
                let fast_bpm = slow + range * f64::from(rng.gen_range(50..=100)) / 100.0;
                let slow_bpm = slow + range * f64::from(rng.gen_range(5..=50)) / 100.0;
                let fast_reps = rng.gen_range(2..=10);
                let slow_reps = rng.gen_range(1..=5);
                for _ in 0..rng.gen_range(3..=6) {
                    random.program.extend([
                        ProcessorEvent::SetTempo {
                            bpm: fast_bpm,
                            measure: 4,
                        },
                        notes_wait(fast_reps, fast_bpm),
                        ProcessorEvent::SetTempo {
                            bpm: slow_bpm,
                            measure: 4,
                        },
                        notes_wait(slow_reps, slow_bpm),
                    ]);
                }
                random.cooldown_ms = 60_000;
                random.priority = 5;
                config.events.push(random);
            }
        }
        let ids = config
            .events
            .iter()
            .map(|event| event.id.clone())
            .collect::<Vec<_>>();
        let mut allocated = 0;
        config.phases = phase_specs
            .iter()
            .enumerate()
            .map(|(index, (id, percentage, multiplier))| {
                let duration_ms = if index + 1 == phase_specs.len() {
                    total - allocated
                } else {
                    total * percentage / 100
                };
                allocated += duration_ms;
                PhaseConfig {
                    id: (*id).into(),
                    duration_ms,
                    tempo_multiplier: *multiplier,
                    event_ids: ids.clone(),
                }
            })
            .collect();
        config.audio.metronome_enabled = self.metronome;
        config.audio.voice_volume_percent = self.cue_volume_percent;
        config.instructor.script_preset_id =
            Some(format!("native-{:?}", self.preset).to_lowercase());
        config.event_scheduling = EventScheduling::Weighted {
            interval_ms: [5_000, 15_000],
            max_concurrent: 2,
        };
        let leaf = |id: &str, start, end| TaskNode::Event {
            event_id: id.into(),
            activation: TaskActivation::default(),
            weight: TaskWeight { start, end },
        };
        let mut children = vec![
            TaskNode::Group {
                activation: TaskActivation::default(),
                weight: TaskWeight { start: 3, end: 3 },
                children: vec![leaf("focus", 20, 30), leaf("breathing", 15, 8)],
            },
            leaf("media-next", 2, 2),
            leaf("checkpoint", 0, 0),
        ];
        if self.preset != Preset::Steady {
            let mut rhythms = vec![
                leaf("double-tempo", 2, 2),
                leaf("acceleration", 2, 3),
                leaf("rest", 1, 1),
                leaf("beat-pattern", 2, 2),
            ];
            if self.preset == Preset::Intervals {
                rhythms.extend([leaf("clusters", 1, 1), leaf("random-beat", 2, 2)]);
            }
            children.push(TaskNode::Group {
                activation: TaskActivation {
                    progress_basis_points: Some([1_000, 8_500]),
                    ..Default::default()
                },
                weight: TaskWeight { start: 2, end: 2 },
                children: rhythms,
            });
        }
        config.task_graph = Some(TaskNode::Group {
            activation: TaskActivation::default(),
            weight: TaskWeight::default(),
            children,
        });
        config.scheduled_tasks = vec![ScheduledTask {
            event_id: "checkpoint".into(),
            at_active_ms: total / 2,
        }];
        config.validate()?;
        Ok(config)
    }
}

fn event(
    id: &str,
    text: &str,
    duration_ms: u64,
    weight: u32,
    occupies: Option<Vec<String>>,
) -> EventDefinition {
    EventDefinition {
        id: id.into(),
        probability_basis_points: 10_000,
        minimum_occurrences: 0,
        maximum_occurrences: 4_000,
        cooldown_ms: duration_ms + 5_000,
        duration_ms,
        priority: 1,
        execution_order: None,
        tempo: None,
        beat_pattern: None,
        program: vec![],
        allowed_phase_ids: vec![],
        instruction: (!text.is_empty()).then(|| text.into()),
        weight: Some(weight),
        occupies,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{SessionCommand, SessionEngine, SessionStatus};

    #[test]
    fn presets_compile_play_and_release_every_task() {
        for preset in [Preset::Steady, Preset::Intervals, Preset::Progressive] {
            let options = InstructorOptions {
                preset,
                duration_seconds: 60,
                seed: Some(19),
                ..Default::default()
            };
            let config = options.compile().unwrap();
            assert_eq!(
                config.phases.iter().map(|p| p.duration_ms).sum::<u64>(),
                60_000
            );
            let mut engine = SessionEngine::new(config).unwrap();
            engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
            let update = engine.dispatch(SessionCommand::Tick {
                monotonic_ms: 60_000,
            });
            assert_eq!(update.state.status, SessionStatus::Completed);
            assert!(!update.state.event_history.is_empty());
            assert!(update.state.active_events.is_empty());
        }
    }

    #[test]
    fn invalid_options_fail_before_start() {
        for options in [
            InstructorOptions {
                duration_seconds: 0,
                ..Default::default()
            },
            InstructorOptions {
                start_bpm: f64::NAN,
                ..Default::default()
            },
            InstructorOptions {
                cue_volume_percent: 101,
                ..Default::default()
            },
        ] {
            assert!(options.compile().is_err());
        }
    }

    #[test]
    fn exported_script_runs_choices_concurrent_work_and_cleanup() {
        let config: GameConfig = serde_json::from_str(include_str!(
            "../docs/examples/native-instructor-script.json"
        ))
        .unwrap();
        config.validate().unwrap();
        let mut engine = SessionEngine::new(config).unwrap();
        let start = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(start.state.processor.pending_instructions[0].id, "start");
        let chosen = engine.dispatch(SessionCommand::ChooseOption {
            instruction_id: "start".into(),
            option_index: 0,
            monotonic_ms: 0,
        });
        assert_eq!(chosen.state.tempo.pattern, vec![0.0, 1.0, 1.0, 1.0]);
        let ready = engine.dispatch(SessionCommand::Tick {
            monotonic_ms: 3_000,
        });
        assert_eq!(ready.state.processor.pending_instructions[0].id, "finish");
        assert!(!ready
            .state
            .processor
            .status_effects
            .contains_key("progress"));
        let ended = engine.dispatch(SessionCommand::ChooseOption {
            instruction_id: "finish".into(),
            option_index: 0,
            monotonic_ms: 3_000,
        });
        assert_eq!(ended.state.status, SessionStatus::Completed);
        assert!(ended.state.processor.pending_instructions.is_empty());
        assert!(ended.state.processor.status_effects.is_empty());
        assert!(ended.state.active_events.is_empty());
    }

    #[test]
    fn task_program_restores_tempo_when_its_resource_lease_ends() {
        let mut config = GameConfig::quick_default();
        config.tempo.curve = TempoCurve::Constant { bpm: 80.0 };
        config.tempo.max_bpm = 240.0;
        let mut task = event("temporary-tempo", "", 1, 0, Some(vec!["tempo".into()]));
        task.minimum_occurrences = 1;
        task.maximum_occurrences = 1;
        task.program = vec![
            ProcessorEvent::SetTempo {
                bpm: 160.0,
                measure: 4,
            },
            ProcessorEvent::Wait { duration_ms: 100 },
        ];
        config.phases[0].event_ids = vec![task.id.clone()];
        config.events = vec![task];
        let mut engine = SessionEngine::new(config).unwrap();
        let start = engine.dispatch(SessionCommand::Start { monotonic_ms: 0 });
        assert_eq!(start.state.tempo.target_bpm, 160.0);
        let finish = engine.dispatch(SessionCommand::Tick { monotonic_ms: 100 });
        assert!(finish.state.active_events.is_empty());
        assert_eq!(finish.state.tempo.target_bpm, 80.0);
    }
}
