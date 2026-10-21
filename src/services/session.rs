//! Admission for the shared session clock, independent of HTTP and Slint.

use crate::{
    session::{GameConfig, SessionControl, SessionState, SessionUpdate},
    AppState,
};

#[derive(Debug, PartialEq, Eq)]
pub enum SessionError {
    ShuttingDown,
    Maintenance,
    Engine(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ShuttingDown => formatter.write_str("AvtoHmver is shutting down"),
            Self::Maintenance => formatter.write_str("A local maintenance job is active"),
            Self::Engine(message) => formatter.write_str(message),
        }
    }
}

pub fn current(state: &AppState) -> Option<SessionState> {
    state.sessions.snapshot()
}

pub fn start(state: &AppState, config: GameConfig) -> Result<SessionUpdate, SessionError> {
    let _lease = admit(state)?;
    state
        .sessions
        .start_running(config)
        .map_err(SessionError::Engine)
}

pub fn control(state: &AppState, command: SessionControl) -> Result<SessionUpdate, SessionError> {
    let _lease = admit(state)?;
    state
        .sessions
        .control(command)
        .map_err(SessionError::Engine)
}

pub fn start_paused(state: &AppState, config: GameConfig) -> Result<SessionUpdate, SessionError> {
    let _lease = admit(state)?;
    state
        .sessions
        .start_paused(config)
        .map_err(SessionError::Engine)
}

fn admit(state: &AppState) -> Result<crate::maintenance::BackgroundWorkerLease, SessionError> {
    if state.shutdown.is_cancelled() {
        return Err(SessionError::ShuttingDown);
    }
    let lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or(SessionError::Maintenance)?;
    // A shutdown that begins while taking the maintenance lease must not
    // admit a new session after the application has started quitting.
    if state.shutdown.is_cancelled() {
        return Err(SessionError::ShuttingDown);
    }
    Ok(lease)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn configured_native_session_runs_without_reference_service_and_restarts_cleanly() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let config = crate::instructor::InstructorOptions {
            duration_seconds: 60,
            seed: Some(123),
            metronome: false,
            ..Default::default()
        }
        .compile()
        .unwrap();
        let first = start(&state, config.clone()).unwrap();
        assert!(!first.state.audio.metronome_enabled);
        assert_eq!(first.state.seed, 123);
        let injected = control(
            &state,
            SessionControl::InjectEvent {
                event_id: "checkpoint".into(),
            },
        )
        .unwrap();
        assert!(injected
            .state
            .active_events
            .iter()
            .any(|e| e.id == "checkpoint"));
        let completed = control(
            &state,
            SessionControl::CompleteEvent {
                event_id: "checkpoint".into(),
            },
        )
        .unwrap();
        assert!(completed
            .state
            .completed_events
            .iter()
            .any(|e| e == "checkpoint"));
        let paused = control(&state, SessionControl::Pause).unwrap();
        assert_eq!(paused.state.status, crate::session::SessionStatus::Paused);
        let resumed = control(&state, SessionControl::Resume).unwrap();
        assert_eq!(
            resumed.state.active_elapsed_ms,
            paused.state.active_elapsed_ms
        );
        let ended = control(&state, SessionControl::End { completed: false }).unwrap();
        assert!(ended.state.active_events.is_empty());
        assert!(ended.state.pending_tasks.is_empty());
        assert_eq!(ended.state.status, crate::session::SessionStatus::Cancelled);
        let second = start_paused(&state, config).unwrap();
        assert_ne!(first.state.session_id, second.state.session_id);
        assert_eq!(second.state.status, crate::session::SessionStatus::Paused);
        assert_eq!(second.state.active_elapsed_ms, 0);
        state.sessions.interrupt_active();
        state.sessions.stop_runner();
    }

    async fn http_request(
        state: &AppState,
        method: &str,
        path: &str,
        body: serde_json::Value,
    ) -> (u16, serde_json::Value) {
        let response = crate::router(state.clone())
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status().as_u16();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[test]
    fn shutdown_denies_session_start_and_control() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        state.shutdown.cancel();
        assert!(matches!(
            start(&state, GameConfig::quick_default()),
            Err(SessionError::ShuttingDown)
        ));
        assert!(matches!(
            control(&state, SessionControl::Pause),
            Err(SessionError::ShuttingDown)
        ));
    }

    #[tokio::test]
    async fn maintenance_denies_direct_session_mutation() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        state.running_sources.lock().await.insert(1);
        state
            .maintenance
            .start(
                state.clone(),
                crate::maintenance::MaintenanceRequest {
                    kind: crate::maintenance::MaintenanceKind::CreateBackup,
                    backup_id: None,
                    confirmation: String::new(),
                },
            )
            .await
            .unwrap();
        assert!(matches!(
            start(&state, GameConfig::quick_default()),
            Err(SessionError::Maintenance)
        ));
        assert!(matches!(
            control(&state, SessionControl::Pause),
            Err(SessionError::Maintenance)
        ));
        state.running_sources.lock().await.clear();
        for _ in 0..100 {
            if !state.maintenance.is_active() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(!state.maintenance.is_active());
        state.server_tasks.close();
        state.server_tasks.wait().await;
    }

    #[tokio::test]
    async fn direct_and_http_calls_share_session_state_and_shutdown_admission() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let started = start(&state, GameConfig::quick_default()).unwrap();
        let (status, current_http) =
            http_request(&state, "GET", "/api/session", serde_json::Value::Null).await;
        assert_eq!(status, 200);
        assert_eq!(current_http["session_id"], started.state.session_id);

        let command = SessionControl::Pause;
        let (status, paused_http) = http_request(
            &state,
            "POST",
            "/api/session/command",
            serde_json::to_value(&command).unwrap(),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(
            paused_http["state"],
            serde_json::to_value(current(&state).unwrap()).unwrap()
        );

        state.shutdown.cancel();
        let (status, denied) = http_request(
            &state,
            "POST",
            "/api/session/command",
            serde_json::to_value(SessionControl::Resume).unwrap(),
        )
        .await;
        assert_eq!(status, 503);
        assert_eq!(denied["error"], "AvtoHmver is shutting down");
    }
}
