//! Deterministic native instruction interpreter. Time is active session time.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

const MAX_THREADS: usize = 64;
const MAX_EVENTS: usize = 8192;
const MAX_STEPS: usize = 8192;

pub fn validate_program(events: &[ProcessorEvent]) -> Result<(), String> {
    EventProcessor::validate(events)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProcessorEvent {
    Wait {
        duration_ms: u64,
    },
    Instruction {
        id: String,
        title: String,
        description: String,
        options: Vec<String>,
        blocking: bool,
    },
    ClearInstruction,
    SetTempo {
        bpm: f64,
        measure: u8,
    },
    SetBeatPattern {
        slots: Vec<f64>,
    },
    StatusEffect {
        id: String,
        message: String,
    },
    RemoveStatusEffect {
        id: String,
    },
    Audio {
        file: String,
        volume_percent: u8,
    },
    MediaNext,
    SleepThread {
        thread_id: String,
    },
    WakeThread {
        thread_id: String,
    },
    Suspend,
    Resume,
    Reset,
    GameOver,
    Sequence {
        events: Vec<ProcessorEvent>,
        blocking: bool,
    },
    Fork {
        thread_id: String,
        events: Vec<ProcessorEvent>,
        blocking: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessorInstruction {
    pub id: String,
    pub title: String,
    pub description: String,
    pub options: Vec<String>,
    pub thread_id: String,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProcessorAction {
    Instruction {
        instruction: ProcessorInstruction,
    },
    ClearInstruction {
        id: Option<String>,
    },
    SetTempo {
        bpm: f64,
        measure: u8,
    },
    SetBeatPattern {
        slots: Vec<f64>,
    },
    StatusEffect {
        id: String,
        message: String,
    },
    RemoveStatusEffect {
        id: String,
    },
    Audio {
        file: String,
        volume_percent: u8,
    },
    MediaNext,
    SleepThread {
        thread_id: String,
    },
    WakeThread {
        thread_id: String,
    },
    Suspend,
    Resume,
    Reset,
    GameOver,
    Choice {
        instruction_id: String,
        option_index: usize,
        value: String,
    },
    ThreadCompleted {
        thread_id: String,
    },
    ThreadCancelled {
        thread_id: String,
    },
    Fault {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessorOutput {
    pub at_active_ms: u64,
    pub thread_id: String,
    pub action: ProcessorAction,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessorStatus {
    #[default]
    Running,
    Suspended,
    Completed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessorThread {
    pub id: String,
    pub waiting_until_ms: Option<u64>,
    pub sleeping: bool,
    pub blocked_instruction: Option<String>,
    pub joining: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProcessorSnapshot {
    pub active_ms: u64,
    pub status: ProcessorStatus,
    pub threads: Vec<ProcessorThread>,
    pub pending_instructions: Vec<ProcessorInstruction>,
    pub status_effects: BTreeMap<String, String>,
    pub tempo_bpm: Option<f64>,
    pub measure: u8,
}

struct Thread {
    queue: VecDeque<ProcessorEvent>,
    state: ProcessorThread,
    not_before_ms: u64,
    parent: Option<String>,
    order: u64,
    injected: bool,
}

pub struct EventProcessor {
    threads: BTreeMap<String, Thread>,
    injected: VecDeque<Vec<ProcessorEvent>>,
    instructions: BTreeMap<String, ProcessorInstruction>,
    status_effects: BTreeMap<String, String>,
    status_owners: BTreeMap<String, String>,
    outputs: Vec<ProcessorOutput>,
    active_ms: u64,
    sequence: u64,
    status: ProcessorStatus,
    tempo_bpm: Option<f64>,
    measure: u8,
}

impl Default for EventProcessor {
    fn default() -> Self {
        Self::empty()
    }
}

impl EventProcessor {
    pub fn empty() -> Self {
        Self {
            threads: BTreeMap::new(),
            injected: VecDeque::new(),
            instructions: BTreeMap::new(),
            status_effects: BTreeMap::new(),
            status_owners: BTreeMap::new(),
            outputs: Vec::new(),
            active_ms: 0,
            sequence: 0,
            status: ProcessorStatus::Running,
            tempo_bpm: None,
            measure: 4,
        }
    }

    pub fn new(events: Vec<ProcessorEvent>) -> Result<Self, String> {
        let mut processor = Self::empty();
        processor.enqueue_thread("main", events)?;
        Ok(processor)
    }

    pub fn validate(events: &[ProcessorEvent]) -> Result<(), String> {
        let mut remaining = MAX_EVENTS;
        Self::validate_events(events, 0, &mut remaining)
    }

    fn validate_events(
        events: &[ProcessorEvent],
        depth: usize,
        remaining: &mut usize,
    ) -> Result<(), String> {
        if depth > 16 {
            return Err("Instruction program exceeds 16 nested sequences".into());
        }
        for event in events {
            if *remaining == 0 {
                return Err("Instruction program exceeds 8192 events".into());
            }
            *remaining -= 1;
            let valid_id = |id: &str| !id.trim().is_empty() && id.len() <= 256;
            match event {
                ProcessorEvent::Sequence { events, .. } => {
                    Self::validate_events(events, depth + 1, remaining)?
                }
                ProcessorEvent::Fork {
                    thread_id, events, ..
                } => {
                    if !valid_id(thread_id) {
                        return Err("Instruction thread id is invalid".into());
                    }
                    Self::validate_events(events, depth + 1, remaining)?;
                }
                ProcessorEvent::Instruction {
                    id,
                    title,
                    description,
                    options,
                    ..
                } => {
                    if !valid_id(id)
                        || title.len() > 4096
                        || description.len() > 16_384
                        || options.len() > 32
                        || options.iter().any(|value| value.len() > 4096)
                    {
                        return Err("Instruction prompt exceeds its bounds".into());
                    }
                }
                ProcessorEvent::SetTempo { bpm, measure }
                    if !bpm.is_finite()
                        || !(0.0..=240.0).contains(bpm)
                        || !(1..=16).contains(measure) =>
                {
                    return Err("Instruction tempo must be 0–240 BPM with a 1–16 measure".into())
                }
                ProcessorEvent::SetBeatPattern { slots }
                    if !crate::session::valid_pattern(slots) =>
                {
                    return Err("Instruction beat pattern is invalid".into())
                }
                ProcessorEvent::Audio {
                    file,
                    volume_percent,
                } if file.trim().is_empty() || file.len() > 4096 || *volume_percent > 100 => {
                    return Err("Instruction audio source or volume is invalid".into())
                }
                ProcessorEvent::StatusEffect { id, message }
                    if !valid_id(id) || message.len() > 16_384 =>
                {
                    return Err("Instruction status effect is invalid".into())
                }
                ProcessorEvent::RemoveStatusEffect { id } if !valid_id(id) => {
                    return Err("Instruction status id is invalid".into())
                }
                ProcessorEvent::SleepThread { thread_id }
                | ProcessorEvent::WakeThread { thread_id }
                    if !valid_id(thread_id) =>
                {
                    return Err("Instruction thread id is invalid".into())
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn event_count(
        events: impl IntoIterator<Item = impl std::borrow::Borrow<ProcessorEvent>>,
    ) -> usize {
        events
            .into_iter()
            .map(|event| match event.borrow() {
                ProcessorEvent::Sequence { events, .. } | ProcessorEvent::Fork { events, .. } => {
                    1 + Self::event_count(events)
                }
                _ => 1,
            })
            .sum()
    }

    fn queued_count(&self) -> usize {
        self.threads
            .values()
            .map(|thread| Self::event_count(&thread.queue))
            .sum::<usize>()
            + self.injected.iter().map(Self::event_count).sum::<usize>()
    }

    pub fn enqueue_thread(
        &mut self,
        id: impl Into<String>,
        events: Vec<ProcessorEvent>,
    ) -> Result<(), String> {
        self.enqueue_thread_at(id, events, self.active_ms)
    }

    pub fn enqueue_thread_at(
        &mut self,
        id: impl Into<String>,
        events: Vec<ProcessorEvent>,
        at_active_ms: u64,
    ) -> Result<(), String> {
        let id = id.into();
        Self::validate(&events)?;
        if self.status == ProcessorStatus::Stopped {
            return Err("Instruction processor is stopped".into());
        }
        if id.trim().is_empty() || id.len() > 256 || self.threads.contains_key(&id) {
            return Err("Instruction thread id is empty or already active".into());
        }
        if self.threads.len() >= MAX_THREADS
            || self.queued_count() + Self::event_count(&events) > MAX_EVENTS
        {
            return Err("Instruction processor capacity exceeded".into());
        }
        self.insert_thread(id, events, at_active_ms.max(self.active_ms), None, false);
        if self.status == ProcessorStatus::Completed {
            self.status = ProcessorStatus::Running;
        }
        Ok(())
    }

    fn insert_thread(
        &mut self,
        id: String,
        events: Vec<ProcessorEvent>,
        at_active_ms: u64,
        parent: Option<String>,
        injected: bool,
    ) {
        self.sequence += 1;
        self.threads.insert(
            id.clone(),
            Thread {
                queue: events.into(),
                state: ProcessorThread {
                    id,
                    waiting_until_ms: None,
                    sleeping: false,
                    blocked_instruction: None,
                    joining: None,
                },
                not_before_ms: at_active_ms,
                parent,
                order: self.sequence,
                injected,
            },
        );
    }

    pub fn inject(&mut self, events: Vec<ProcessorEvent>) -> Result<(), String> {
        Self::validate(&events)?;
        if self.status == ProcessorStatus::Stopped {
            return Err("Instruction processor is stopped".into());
        }
        if self.injected.len() + self.threads.len() >= MAX_THREADS
            || self.queued_count() + Self::event_count(&events) > MAX_EVENTS
        {
            return Err("Instruction processor capacity exceeded".into());
        }
        self.injected.push_back(events);
        Ok(())
    }

    pub fn resume(&mut self) {
        if self.status == ProcessorStatus::Suspended {
            self.status = ProcessorStatus::Running;
        }
    }

    pub fn choose(&mut self, instruction_id: &str, option_index: usize) -> Result<(), String> {
        let instruction = self
            .instructions
            .get(instruction_id)
            .ok_or("Instruction is no longer pending")?;
        let value = if instruction.options.is_empty() && option_index == 0 {
            String::new()
        } else {
            instruction
                .options
                .get(option_index)
                .cloned()
                .ok_or("Instruction option index is out of range")?
        };
        let thread_id = instruction.thread_id.clone();
        if let Some(thread) = self.threads.get_mut(&thread_id) {
            if thread.state.blocked_instruction.as_deref() == Some(instruction_id) {
                thread.state.blocked_instruction = None;
            }
        }
        self.instructions.remove(instruction_id);
        self.emit(
            &thread_id,
            ProcessorAction::Choice {
                instruction_id: instruction_id.into(),
                option_index,
                value,
            },
        );
        self.emit(
            &thread_id,
            ProcessorAction::ClearInstruction {
                id: Some(instruction_id.into()),
            },
        );
        Ok(())
    }

    pub fn next_deadline(&self) -> Option<u64> {
        if self.status == ProcessorStatus::Stopped {
            return None;
        }
        if !self.injected.is_empty() {
            return Some(self.active_ms);
        }
        self.threads
            .values()
            .filter(|thread| {
                (self.status != ProcessorStatus::Suspended || thread.injected)
                    && !thread.state.sleeping
                    && thread.state.blocked_instruction.is_none()
                    && thread.state.joining.is_none()
            })
            .map(|thread| {
                thread
                    .state
                    .waiting_until_ms
                    .unwrap_or(thread.not_before_ms)
                    .max(thread.not_before_ms)
                    .max(self.active_ms)
            })
            .min()
    }

    pub fn tick(&mut self, active_ms: u64) -> Vec<ProcessorOutput> {
        let target = active_ms.max(self.active_ms);
        if self.status == ProcessorStatus::Stopped {
            return std::mem::take(&mut self.outputs);
        }
        while let Some(events) = self.injected.pop_front() {
            let id = format!("injected-{}", self.sequence + 1);
            self.insert_thread(id, events, self.active_ms, None, true);
        }
        let mut steps = 0;
        loop {
            let ready = self
                .threads
                .iter()
                .filter(|(_, thread)| {
                    (self.status != ProcessorStatus::Suspended || thread.injected)
                        && !thread.state.sleeping
                        && thread.state.blocked_instruction.is_none()
                        && thread.state.joining.is_none()
                        && thread.not_before_ms <= self.active_ms
                        && thread
                            .state
                            .waiting_until_ms
                            .is_none_or(|deadline| deadline <= self.active_ms)
                })
                .min_by_key(|(_, thread)| (!thread.injected, thread.order))
                .map(|(id, _)| id.clone());
            if let Some(id) = ready {
                steps += 1;
                if steps > MAX_STEPS {
                    self.fault(
                        &id,
                        "Instruction processor exceeded its per-tick step budget",
                    );
                    break;
                }
                let thread = self.threads.get_mut(&id).expect("selected active thread");
                thread.state.waiting_until_ms = None;
                if let Some(event) = thread.queue.pop_front() {
                    self.execute(&id, event);
                } else {
                    self.finish_thread(&id, false);
                }
                if self.status == ProcessorStatus::Stopped {
                    break;
                }
                continue;
            }
            let next = self
                .next_deadline()
                .filter(|deadline| *deadline > self.active_ms && *deadline <= target);
            if let Some(next) = next {
                self.active_ms = next;
                continue;
            }
            self.active_ms = target;
            break;
        }
        if self.threads.is_empty()
            && self.injected.is_empty()
            && self.status == ProcessorStatus::Running
        {
            self.status = ProcessorStatus::Completed;
        }
        std::mem::take(&mut self.outputs)
    }

    fn execute(&mut self, id: &str, event: ProcessorEvent) {
        match event {
            ProcessorEvent::Wait { duration_ms } => {
                self.threads
                    .get_mut(id)
                    .expect("active thread")
                    .state
                    .waiting_until_ms = Some(self.active_ms.saturating_add(duration_ms));
            }
            ProcessorEvent::Instruction {
                id: instruction_id,
                title,
                description,
                mut options,
                blocking,
            } => {
                if self.instructions.contains_key(&instruction_id) {
                    self.fault(id, "Instruction id is already pending");
                    return;
                }
                if blocking && options.is_empty() {
                    options.push("Continue".into());
                }
                let instruction = ProcessorInstruction {
                    id: instruction_id.clone(),
                    title,
                    description,
                    options,
                    thread_id: id.into(),
                    blocking,
                };
                self.instructions
                    .insert(instruction_id.clone(), instruction.clone());
                if blocking {
                    self.threads
                        .get_mut(id)
                        .expect("active thread")
                        .state
                        .blocked_instruction = Some(instruction_id);
                }
                self.emit(id, ProcessorAction::Instruction { instruction });
            }
            ProcessorEvent::ClearInstruction => {
                let ids: Vec<_> = self
                    .instructions
                    .iter()
                    .filter(|(_, instruction)| instruction.thread_id == id)
                    .map(|(id, _)| id.clone())
                    .collect();
                for instruction_id in ids {
                    self.instructions.remove(&instruction_id);
                    self.emit(
                        id,
                        ProcessorAction::ClearInstruction {
                            id: Some(instruction_id),
                        },
                    );
                }
            }
            ProcessorEvent::SetTempo { bpm, measure } => {
                self.tempo_bpm = Some(bpm);
                self.measure = measure;
                self.emit(id, ProcessorAction::SetTempo { bpm, measure });
            }
            ProcessorEvent::SetBeatPattern { slots } => {
                self.emit(id, ProcessorAction::SetBeatPattern { slots })
            }
            ProcessorEvent::StatusEffect {
                id: effect_id,
                message,
            } => {
                self.status_owners.insert(effect_id.clone(), id.into());
                self.status_effects
                    .insert(effect_id.clone(), message.clone());
                self.emit(
                    id,
                    ProcessorAction::StatusEffect {
                        id: effect_id,
                        message,
                    },
                );
            }
            ProcessorEvent::RemoveStatusEffect { id: effect_id } => {
                self.status_owners.remove(&effect_id);
                self.status_effects.remove(&effect_id);
                self.emit(id, ProcessorAction::RemoveStatusEffect { id: effect_id });
            }
            ProcessorEvent::Audio {
                file,
                volume_percent,
            } => self.emit(
                id,
                ProcessorAction::Audio {
                    file,
                    volume_percent,
                },
            ),
            ProcessorEvent::MediaNext => self.emit(id, ProcessorAction::MediaNext),
            ProcessorEvent::SleepThread { thread_id } => {
                if let Some(thread) = self.threads.get_mut(&thread_id) {
                    thread.state.sleeping = true;
                }
                self.emit(id, ProcessorAction::SleepThread { thread_id });
            }
            ProcessorEvent::WakeThread { thread_id } => {
                if let Some(thread) = self.threads.get_mut(&thread_id) {
                    thread.state.sleeping = false;
                }
                self.emit(id, ProcessorAction::WakeThread { thread_id });
            }
            ProcessorEvent::Suspend => {
                self.status = ProcessorStatus::Suspended;
                self.emit(id, ProcessorAction::Suspend);
            }
            ProcessorEvent::Resume => {
                self.resume();
                self.emit(id, ProcessorAction::Resume);
            }
            ProcessorEvent::Reset => {
                let others: Vec<_> = self
                    .threads
                    .keys()
                    .filter(|other| other.as_str() != id)
                    .cloned()
                    .collect();
                for other in others {
                    self.finish_thread(&other, true);
                }
                self.instructions.clear();
                self.status_effects.clear();
                self.status_owners.clear();
                self.tempo_bpm = None;
                self.measure = 4;
                self.emit(id, ProcessorAction::Reset);
            }
            ProcessorEvent::GameOver => {
                self.emit(id, ProcessorAction::GameOver);
                let ids: Vec<_> = self.threads.keys().cloned().collect();
                for thread_id in ids {
                    self.finish_thread(&thread_id, true);
                }
                self.injected.clear();
                self.status = ProcessorStatus::Stopped;
            }
            ProcessorEvent::Sequence {
                events,
                blocking: true,
            } => {
                let queue = &mut self.threads.get_mut(id).expect("active thread").queue;
                for event in events.into_iter().rev() {
                    queue.push_front(event);
                }
            }
            ProcessorEvent::Sequence {
                events,
                blocking: false,
            } => {
                let child = format!("sequence-{}", self.sequence + 1);
                self.fork(id, child, events, false);
            }
            ProcessorEvent::Fork {
                thread_id,
                events,
                blocking,
            } => self.fork(id, thread_id, events, blocking),
        }
    }

    fn fork(&mut self, parent: &str, id: String, events: Vec<ProcessorEvent>, blocking: bool) {
        if self.threads.len() >= MAX_THREADS || self.threads.contains_key(&id) {
            self.fault(
                parent,
                "Instruction fork exceeds thread capacity or reuses an active id",
            );
            return;
        }
        let injected = self
            .threads
            .get(parent)
            .is_some_and(|thread| thread.injected);
        self.insert_thread(
            id.clone(),
            events,
            self.active_ms,
            Some(parent.into()),
            injected,
        );
        if blocking {
            self.threads
                .get_mut(parent)
                .expect("active parent")
                .state
                .joining = Some(id);
        }
    }

    fn finish_thread(&mut self, id: &str, cancelled: bool) {
        if !cancelled {
            if let Some(child) = self
                .threads
                .iter()
                .find(|(_, thread)| thread.parent.as_deref() == Some(id))
                .map(|(id, _)| id.clone())
            {
                if let Some(thread) = self.threads.get_mut(id) {
                    thread.state.joining = Some(child);
                }
                return;
            }
        }
        if self.threads.remove(id).is_none() {
            return;
        }
        let status_ids: Vec<_> = self
            .status_owners
            .iter()
            .filter(|(_, owner)| owner.as_str() == id)
            .map(|(id, _)| id.clone())
            .collect();
        for effect_id in status_ids {
            self.status_owners.remove(&effect_id);
            self.status_effects.remove(&effect_id);
            self.emit(id, ProcessorAction::RemoveStatusEffect { id: effect_id });
        }
        let instructions: Vec<_> = self
            .instructions
            .iter()
            .filter(|(_, instruction)| instruction.thread_id == id)
            .map(|(id, _)| id.clone())
            .collect();
        for instruction_id in instructions {
            self.instructions.remove(&instruction_id);
            self.emit(
                id,
                ProcessorAction::ClearInstruction {
                    id: Some(instruction_id),
                },
            );
        }
        for thread in self.threads.values_mut() {
            if thread.state.joining.as_deref() == Some(id) {
                thread.state.joining = None;
            }
        }
        self.emit(
            id,
            if cancelled {
                ProcessorAction::ThreadCancelled {
                    thread_id: id.into(),
                }
            } else {
                ProcessorAction::ThreadCompleted {
                    thread_id: id.into(),
                }
            },
        );
    }

    pub fn cancel_thread(&mut self, id: &str) -> Vec<ProcessorOutput> {
        let mut ids = vec![id.to_string()];
        loop {
            let children: Vec<_> = self
                .threads
                .iter()
                .filter(|(child, thread)| {
                    !ids.contains(child)
                        && thread
                            .parent
                            .as_ref()
                            .is_some_and(|parent| ids.contains(parent))
                })
                .map(|(id, _)| id.clone())
                .collect();
            if children.is_empty() {
                break;
            }
            ids.extend(children);
        }
        for id in ids.into_iter().rev() {
            self.finish_thread(&id, true);
        }
        std::mem::take(&mut self.outputs)
    }

    pub fn stop(&mut self) -> Vec<ProcessorOutput> {
        let ids: Vec<_> = self.threads.keys().cloned().collect();
        for id in ids {
            self.finish_thread(&id, true);
        }
        self.injected.clear();
        self.instructions.clear();
        self.status_effects.clear();
        self.status_owners.clear();
        self.tempo_bpm = None;
        self.status = ProcessorStatus::Stopped;
        std::mem::take(&mut self.outputs)
    }

    fn fault(&mut self, id: &str, message: &str) {
        self.emit(
            id,
            ProcessorAction::Fault {
                message: message.into(),
            },
        );
        let outputs = self.stop();
        self.outputs = outputs;
    }

    fn emit(&mut self, id: &str, action: ProcessorAction) {
        self.outputs.push(ProcessorOutput {
            at_active_ms: self.active_ms,
            thread_id: id.into(),
            action,
        });
    }

    pub fn snapshot(&self) -> ProcessorSnapshot {
        ProcessorSnapshot {
            active_ms: self.active_ms,
            status: self.status,
            threads: self
                .threads
                .values()
                .map(|thread| thread.state.clone())
                .collect(),
            pending_instructions: self.instructions.values().cloned().collect(),
            status_effects: self.status_effects.clone(),
            tempo_bpm: self.tempo_bpm,
            measure: self.measure,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delayed_ticks_match_ordered_waits_and_forks() {
        let events = vec![
            ProcessorEvent::Fork {
                thread_id: "child".into(),
                blocking: false,
                events: vec![
                    ProcessorEvent::Wait { duration_ms: 25 },
                    ProcessorEvent::MediaNext,
                ],
            },
            ProcessorEvent::Wait { duration_ms: 50 },
            ProcessorEvent::SetTempo {
                bpm: 90.0,
                measure: 4,
            },
        ];
        let mut delayed = EventProcessor::new(events.clone()).unwrap();
        let mut timely = EventProcessor::new(events).unwrap();
        let expected = delayed.tick(100);
        let mut actual = Vec::new();
        for time in 0..=100 {
            actual.extend(timely.tick(time));
        }
        assert_eq!(actual, expected);
        assert_eq!(
            expected
                .iter()
                .find(|output| matches!(output.action, ProcessorAction::MediaNext))
                .unwrap()
                .at_active_ms,
            25
        );
    }

    #[test]
    fn blocking_choice_stops_only_its_thread_and_validates_index() {
        let mut processor = EventProcessor::new(vec![
            ProcessorEvent::Instruction {
                id: "choice".into(),
                title: "Continue".into(),
                description: String::new(),
                options: vec!["Yes".into()],
                blocking: true,
            },
            ProcessorEvent::MediaNext,
        ])
        .unwrap();
        processor.tick(0);
        assert_eq!(processor.snapshot().pending_instructions.len(), 1);
        assert!(processor.choose("choice", 1).is_err());
        assert!(!processor
            .tick(100)
            .iter()
            .any(|output| matches!(output.action, ProcessorAction::MediaNext)));
        processor.choose("choice", 0).unwrap();
        assert!(processor
            .tick(100)
            .iter()
            .any(|output| matches!(output.action, ProcessorAction::MediaNext)));
        assert!(processor.snapshot().pending_instructions.is_empty());
    }

    #[test]
    fn sleeping_child_wakes_at_boundary_and_blocking_parent_joins() {
        let mut processor = EventProcessor::new(vec![
            ProcessorEvent::Fork {
                thread_id: "child".into(),
                blocking: true,
                events: vec![
                    ProcessorEvent::SleepThread {
                        thread_id: "child".into(),
                    },
                    ProcessorEvent::MediaNext,
                ],
            },
            ProcessorEvent::SetTempo {
                bpm: 80.0,
                measure: 4,
            },
        ])
        .unwrap();
        processor.tick(0);
        processor
            .inject(vec![ProcessorEvent::WakeThread {
                thread_id: "child".into(),
            }])
            .unwrap();
        let outputs = processor.tick(0);
        let media = outputs
            .iter()
            .position(|output| matches!(output.action, ProcessorAction::MediaNext))
            .unwrap();
        let tempo = outputs
            .iter()
            .position(|output| matches!(output.action, ProcessorAction::SetTempo { .. }))
            .unwrap();
        assert!(media < tempo);
    }

    #[test]
    fn cancellation_removes_descendants_and_pending_choices() {
        let mut processor = EventProcessor::new(vec![ProcessorEvent::Fork {
            thread_id: "child".into(),
            blocking: true,
            events: vec![ProcessorEvent::Instruction {
                id: "choice".into(),
                title: String::new(),
                description: String::new(),
                options: vec![],
                blocking: true,
            }],
        }])
        .unwrap();
        processor.tick(0);
        let cancelled = processor.cancel_thread("main");
        assert_eq!(
            cancelled
                .iter()
                .filter(|output| matches!(output.action, ProcessorAction::ThreadCancelled { .. }))
                .count(),
            2
        );
        assert!(processor.snapshot().threads.is_empty());
        assert!(processor.snapshot().pending_instructions.is_empty());
    }
}
