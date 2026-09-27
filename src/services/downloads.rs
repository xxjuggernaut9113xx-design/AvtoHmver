//! Typed download activity snapshot shared by the native shell and HTTP adapter.

use std::{collections::HashSet, sync::atomic::Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DownloadStatus {
    pub paused: bool,
    pub active_count: usize,
    pub queued_count: i64,
    pub retrying_count: i64,
    pub paused_source_ids: Vec<i64>,
    pub sources: Vec<SourceDownloadStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceDownloadStatus {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub phase: String,
    pub queue_position: Option<i64>,
    pub known_total: Option<i64>,
    pub completed_count: i64,
    pub percentage: Option<f64>,
    pub indeterminate: bool,
    pub current_filename: Option<String>,
    pub retry_at: Option<i64>,
    pub error: Option<String>,
    pub queued_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub updated_at: Option<String>,
}

pub async fn status(state: &AppState) -> DownloadStatus {
    let paused = state.downloads_paused.load(Ordering::SeqCst);
    let active_ids: HashSet<i64> = state
        .active_processes
        .lock()
        .await
        .keys()
        .copied()
        .collect();
    let active_count = active_ids.len();
    let mut paused_source_ids: Vec<i64> = state
        .paused_source_ids
        .lock()
        .await
        .iter()
        .copied()
        .collect();
    paused_source_ids.sort_unstable();
    let rows = state.pool.get().ok().and_then(|conn| {
        // The per-source indexed count is aggregated in a single grouped
        // join instead of a correlated subquery per source row: one pass
        // over media via idx_media_source rather than N index lookups.
        let mut statement = conn.prepare(
            "SELECT s.id,s.name,s.status,s.item_count,s.known_total,
                    COALESCE(m.indexed_count,0) AS indexed_count,
                    s.completed_count,s.current_filename,s.retry_at,s.error_message,s.queued_at,s.started_at,s.completed_at,s.progress_updated_at
             FROM sources s
             LEFT JOIN (SELECT source_id,COUNT(*) AS indexed_count FROM media
                        WHERE downloaded=1 AND missing=0 GROUP BY source_id) m
               ON m.source_id=s.id
             ORDER BY COALESCE(s.queued_at,s.added_at),s.id",
        ).ok()?;
        let mapped = statement.query_map([], |row| Ok((
            row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?, row.get::<_, Option<i64>>(4)?, row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?, row.get::<_, Option<String>>(7)?, row.get::<_, i64>(8)?,
            row.get::<_, Option<String>>(9)?, row.get::<_, Option<String>>(10)?, row.get::<_, Option<String>>(11)?,
            row.get::<_, Option<String>>(12)?, row.get::<_, Option<String>>(13)?,
        ))).ok()?;
        mapped.collect::<rusqlite::Result<Vec<_>>>().ok()
    }).unwrap_or_default();
    let mut queue_position = 0_i64;
    let sources: Vec<SourceDownloadStatus> = rows
        .into_iter()
        .map(|row| {
            let (
                id,
                name,
                status,
                item_count,
                known_total,
                indexed_count,
                persisted_completed,
                current_filename,
                retry_at,
                error,
                queued_at,
                started_at,
                completed_at,
                updated_at,
            ) = row;
            let phase = match status.as_str() {
                "pending" => "queued",
                "downloading" if active_ids.contains(&id) => "active",
                "downloading" => "queued",
                "indexing" => "indexing",
                "retrying" => "retrying",
                "paused" => "paused",
                "storage_limit" => "storage_limit",
                "low_disk" => "low_disk",
                "done" => "completed",
                "error" => "failed",
                _ => "queued",
            };
            let position = if phase == "queued" {
                queue_position += 1;
                Some(queue_position)
            } else {
                None
            };
            let completed = indexed_count
                .max(persisted_completed)
                .max(item_count.min(indexed_count));
            let percentage = known_total.map(|total| {
                if total == 0 {
                    if phase == "completed" {
                        100.0
                    } else {
                        0.0
                    }
                } else {
                    ((completed as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
                }
            });
            SourceDownloadStatus {
                id,
                name,
                status,
                phase: phase.into(),
                queue_position: position,
                known_total,
                completed_count: completed,
                percentage,
                indeterminate: known_total.is_none(),
                current_filename,
                retry_at: (retry_at > 0).then_some(retry_at),
                error,
                queued_at,
                started_at,
                completed_at,
                updated_at,
            }
        })
        .collect();
    let queued_count = sources.iter().filter(|row| row.phase == "queued").count() as i64;
    let retrying_count = sources.iter().filter(|row| row.phase == "retrying").count() as i64;
    DownloadStatus {
        paused,
        active_count,
        queued_count,
        retrying_count,
        paused_source_ids,
        sources,
    }
}

// ─── Typed download controls ─────────────────────────────────────────────────
// The `*_typed` ops are the canonical service API: every outcome and
// rejection is a struct, so HTTP and native callers share one contract.
// The `Value`-returning wrappers exist only for the pre-existing callers in
// `downloader`, `maintenance`, and `native`, which index the legacy JSON
// shapes directly.

/// Outcome of pausing every download source: `{"paused":true}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PauseOutcome {
    pub paused: bool,
}

/// Outcome of resuming downloads: `{"paused":false,"requeued":N}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ResumeOutcome {
    pub paused: bool,
    pub requeued: usize,
}

/// Outcome of pausing one source: `{"id":N,"paused":true}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SourcePauseOutcome {
    pub id: i64,
    pub paused: bool,
}

/// Outcome of resuming one source: `{"id":N,"paused":false,"status":"queued"}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SourceResumeOutcome {
    pub id: i64,
    pub paused: bool,
    pub status: &'static str,
}

/// Typed rejection. Serializes to the exact legacy shapes: `{"error":...}`
/// for global controls, `{"id":N,"error":...}` for per-source controls (the
/// "Source not found" rejection keeps its legacy id-less shape).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ControlError {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    pub error: &'static str,
}

impl ControlError {
    fn global(error: &'static str) -> Self {
        Self { id: None, error }
    }

    fn source(id: i64, error: &'static str) -> Self {
        Self {
            id: Some(id),
            error,
        }
    }
}

fn control_value<T: Serialize>(result: Result<T, ControlError>) -> Value {
    match result {
        Ok(outcome) => serde_json::to_value(outcome).unwrap_or(Value::Null),
        Err(error) => serde_json::to_value(error).unwrap_or(Value::Null),
    }
}

/// Pause all download sources with service-level maintenance and shutdown
/// admission, independent of whether the caller used HTTP or the native UI.
pub async fn pause_typed(state: &Arc<AppState>) -> Result<PauseOutcome, ControlError> {
    if state.shutdown.is_cancelled() {
        return Err(ControlError::global("Curator is shutting down"));
    }
    let Some(_lease) = state.maintenance.try_acquire_background_worker() else {
        return Err(ControlError::global("A local maintenance job is active"));
    };
    if state.shutdown.is_cancelled() {
        return Err(ControlError::global("Curator is shutting down"));
    }
    Ok(pause_unchecked(state).await)
}

/// Legacy `Value` shape kept for the pre-existing callers in `downloader`,
/// `maintenance`, and `native`.
pub async fn pause(state: &Arc<AppState>) -> Value {
    control_value(pause_typed(state).await)
}

/// Maintenance has already closed normal admission and must pause workers as
/// part of establishing quiescence.
pub(crate) async fn pause_for_maintenance(state: &Arc<AppState>) -> Value {
    control_value(Ok(pause_unchecked(state).await))
}

async fn pause_unchecked(state: &Arc<AppState>) -> PauseOutcome {
    let _control = state.download_control.lock().await;
    state.downloads_paused.store(true, Ordering::SeqCst);

    if let Ok(conn) = state.pool.get() {
        let _ = conn.execute(
            "UPDATE sources SET status='paused',progress_updated_at=?1 WHERE status IN ('pending','retrying')",
            [crate::db::now_iso()],
        );
    }
    let procs: Vec<(i64, u32)> = {
        let guard = state.active_processes.lock().await;
        guard
            .iter()
            .map(|(&source_id, &pid)| (source_id, pid))
            .collect()
    };
    for &(source_id, pid) in &procs {
        state.paused_source_ids.lock().await.insert(source_id);
        if let Some(cancel) = state
            .source_cancellations
            .lock()
            .await
            .get(&source_id)
            .cloned()
        {
            cancel.cancel();
        }
        crate::downloader::kill_pid(pid).await;
    }
    // Index the active source ids once instead of scanning the pid vec for
    // every cancellation entry.
    let active_ids: HashSet<i64> = procs.iter().map(|(id, _)| *id).collect();
    let cancellations: Vec<(i64, tokio_util::sync::CancellationToken)> = state
        .source_cancellations
        .lock()
        .await
        .iter()
        .filter(|(source_id, _)| !active_ids.contains(source_id))
        .map(|(source_id, token)| (*source_id, token.clone()))
        .collect();
    for (source_id, cancel) in cancellations {
        state.paused_source_ids.lock().await.insert(source_id);
        cancel.cancel();
        if let Ok(conn) = state.pool.get() {
            let _ = conn.execute(
                "UPDATE sources SET status='paused',progress_updated_at=?1 WHERE id=?2 AND status IN ('downloading','indexing')",
                rusqlite::params![crate::db::now_iso(), source_id],
            );
        }
    }
    PauseOutcome { paused: true }
}

pub async fn resume_typed(state: Arc<AppState>) -> Result<ResumeOutcome, ControlError> {
    if state.shutdown.is_cancelled() {
        return Err(ControlError::global("Curator is shutting down"));
    }
    let Some(_lease) = state.maintenance.try_acquire_background_worker() else {
        return Err(ControlError::global("A local maintenance job is active"));
    };
    if state.shutdown.is_cancelled() {
        return Err(ControlError::global("Curator is shutting down"));
    }
    resume_unchecked(state).await
}

/// Legacy `Value` shape kept for the pre-existing callers in `downloader`
/// and `native`.
pub async fn resume(state: Arc<AppState>) -> Value {
    control_value(resume_typed(state).await)
}

pub(crate) async fn resume_after_maintenance(state: Arc<AppState>) -> Value {
    control_value(resume_unchecked(state).await)
}

async fn resume_unchecked(state: Arc<AppState>) -> Result<ResumeOutcome, ControlError> {
    let _control = state.download_control.lock().await;
    while state.downloads_paused.load(Ordering::SeqCst) {
        if state.running_sources.lock().await.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let paused_ids: Vec<i64> = {
        let conn = match state.pool.get() {
            Ok(conn) => conn,
            Err(_) => return Err(ControlError::global("Database unavailable")),
        };
        let mut statement = match conn.prepare("SELECT id FROM sources WHERE status='paused'") {
            Ok(statement) => statement,
            Err(_) => return Err(ControlError::global("Database unavailable")),
        };
        statement
            .query_map([], |row| row.get(0))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    };
    if !paused_ids.is_empty() {
        let conn = match state.pool.get() {
            Ok(conn) => conn,
            Err(_) => return Err(ControlError::global("Database unavailable")),
        };
        let transaction = match conn.unchecked_transaction() {
            Ok(transaction) => transaction,
            Err(_) => return Err(ControlError::global("Database unavailable")),
        };
        for id in &paused_ids {
            if transaction
                .execute(
                    "UPDATE sources SET status='pending',queued_at=?1,progress_updated_at=?1,current_filename=NULL WHERE id=?2 AND status='paused'",
                    rusqlite::params![crate::db::now_iso(), id],
                )
                .is_err()
            {
                return Err(ControlError::global("Database unavailable"));
            }
        }
        if transaction.commit().is_err() {
            return Err(ControlError::global("Database unavailable"));
        }
    }
    state.paused_source_ids.lock().await.clear();
    state.downloads_paused.store(false, Ordering::SeqCst);
    for id in &paused_ids {
        state
            .download_tasks
            .spawn(crate::downloader::run_download(Arc::clone(&state), *id));
    }
    Ok(ResumeOutcome {
        paused: false,
        requeued: paused_ids.len(),
    })
}

pub async fn pause_source_typed(
    state: &Arc<AppState>,
    id: i64,
) -> Result<SourcePauseOutcome, ControlError> {
    if let Some(error) = admission_error(state) {
        return Err(ControlError::source(id, error));
    }
    let Some(_lease) = state.maintenance.try_acquire_background_worker() else {
        return Err(ControlError::source(
            id,
            "A local maintenance job is active",
        ));
    };
    if state.shutdown.is_cancelled() {
        return Err(ControlError::source(id, "Curator is shutting down"));
    }
    let _control = state.download_control.lock().await;
    let exists = state
        .pool
        .get()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sources WHERE id=?1)",
                [id],
                |row| row.get::<_, bool>(0),
            )
            .ok()
        })
        .unwrap_or(false);
    if !exists {
        return Err(ControlError::global("Source not found"));
    }
    state.paused_source_ids.lock().await.insert(id);
    if let Some(cancel) = state.source_cancellations.lock().await.get(&id).cloned() {
        cancel.cancel();
    }
    if let Some(pid) = state.active_processes.lock().await.get(&id).copied() {
        crate::downloader::kill_pid(pid).await;
    }
    if let Ok(conn) = state.pool.get() {
        let _ = conn.execute(
            "UPDATE sources SET status='paused',progress_updated_at=?1 WHERE id=?2",
            rusqlite::params![crate::db::now_iso(), id],
        );
    }
    Ok(SourcePauseOutcome { id, paused: true })
}

/// Legacy `Value` shape kept for the pre-existing callers in `native`.
pub async fn pause_source(state: &Arc<AppState>, id: i64) -> Value {
    control_value(pause_source_typed(state, id).await)
}

pub async fn resume_source_typed(
    state: Arc<AppState>,
    id: i64,
) -> Result<SourceResumeOutcome, ControlError> {
    if let Some(error) = admission_error(&state) {
        return Err(ControlError::source(id, error));
    }
    let Some(_lease) = state.maintenance.try_acquire_background_worker() else {
        return Err(ControlError::source(
            id,
            "A local maintenance job is active",
        ));
    };
    if state.shutdown.is_cancelled() {
        return Err(ControlError::source(id, "Curator is shutting down"));
    }
    let _control = state.download_control.lock().await;
    if state.downloads_paused.load(Ordering::SeqCst) {
        return Err(ControlError::source(id, "Downloads are globally paused"));
    }
    let changed = state.pool.get().ok().and_then(|conn| conn.execute(
        "UPDATE sources SET status='pending',queued_at=?1,progress_updated_at=?1,current_filename=NULL WHERE id=?2 AND status IN ('paused','storage_limit','low_disk','error','done','retrying')",
        rusqlite::params![crate::db::now_iso(),id],
    ).ok()).unwrap_or(0);
    if changed == 0 {
        return Err(ControlError::source(id, "Source is not resumable"));
    }
    state.paused_source_ids.lock().await.remove(&id);
    state
        .download_tasks
        .spawn(crate::downloader::run_download(Arc::clone(&state), id));
    Ok(SourceResumeOutcome {
        id,
        paused: false,
        status: "queued",
    })
}

/// Legacy `Value` shape kept for the pre-existing callers in `native`.
pub async fn resume_source(state: Arc<AppState>, id: i64) -> Value {
    control_value(resume_source_typed(state, id).await)
}

fn admission_error(state: &AppState) -> Option<&'static str> {
    if state.shutdown.is_cancelled() {
        Some("Curator is shutting down")
    } else if state.maintenance.is_active() {
        Some("A local maintenance job is active")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use serde_json::json;
    use tower::ServiceExt;

    async fn http_control(state: &AppState, path: &str) -> serde_json::Value {
        let response = crate::router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn direct_and_http_status_share_the_typed_activity_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        state.pool.get().unwrap().execute(
            "UPDATE sources SET status='downloading',known_total=10,completed_count=3,current_filename='item.mp4' WHERE id=1",
            [],
        ).unwrap();
        state.active_processes.lock().await.insert(1, 42);
        let direct = status(&state).await;
        assert_eq!(direct.active_count, 1);
        assert_eq!(direct.sources[0].phase, "active");
        assert_eq!(direct.sources[0].known_total, Some(10));
        assert_eq!(
            direct.sources[0].current_filename.as_deref(),
            Some("item.mp4")
        );

        let response = crate::router((*state).clone())
            .oneshot(
                Request::builder()
                    .uri("/api/downloads/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let http: DownloadStatus = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(http, direct);

        let native = crate::native::LocalClient::new((*state).clone()).unwrap();
        assert_eq!(
            native.downloads().await.unwrap(),
            serde_json::to_value(direct).unwrap()
        );
    }

    #[tokio::test]
    async fn global_controls_keep_http_payloads_and_deny_shutdown() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let direct_pause = pause_typed(&state).await;
        assert_eq!(direct_pause, Ok(PauseOutcome { paused: true }));
        assert_eq!(
            serde_json::to_value(direct_pause.unwrap()).unwrap(),
            http_control(&state, "/api/downloads/pause").await
        );
        let direct_resume = resume_typed(state.clone()).await;
        assert_eq!(
            direct_resume,
            Ok(ResumeOutcome {
                paused: false,
                requeued: 0
            })
        );
        assert_eq!(
            serde_json::to_value(direct_resume.unwrap()).unwrap(),
            http_control(&state, "/api/downloads/resume").await
        );

        state.shutdown.cancel();
        assert_eq!(
            pause_typed(&state).await,
            Err(ControlError::global("Curator is shutting down"))
        );
        assert_eq!(
            resume_typed(state.clone()).await,
            Err(ControlError::global("Curator is shutting down"))
        );
    }

    #[tokio::test]
    async fn source_controls_keep_http_payloads_and_global_pause_precedence() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        state.downloads_paused.store(true, Ordering::SeqCst);
        let direct_pause = pause_source_typed(&state, 1).await;
        assert_eq!(
            direct_pause,
            Ok(SourcePauseOutcome {
                id: 1,
                paused: true
            })
        );
        assert_eq!(
            serde_json::to_value(direct_pause.unwrap()).unwrap(),
            http_control(&state, "/api/downloads/sources/1/pause").await
        );
        let direct_resume = resume_source_typed(state.clone(), 1).await;
        assert_eq!(
            direct_resume,
            Err(ControlError::source(1, "Downloads are globally paused"))
        );
        assert_eq!(
            serde_json::to_value(direct_resume.unwrap_err()).unwrap(),
            http_control(&state, "/api/downloads/sources/1/resume").await
        );
        assert_eq!(
            pause_source_typed(&state, 999).await,
            Err(ControlError::global("Source not found"))
        );

        state.shutdown.cancel();
        assert_eq!(
            pause_source_typed(&state, 1).await,
            Err(ControlError::source(1, "Curator is shutting down"))
        );
        assert_eq!(
            resume_source_typed(state.clone(), 1).await,
            Err(ControlError::source(1, "Curator is shutting down"))
        );
    }

    #[test]
    fn typed_outcomes_serialize_to_the_legacy_http_shapes() {
        assert_eq!(
            serde_json::to_value(PauseOutcome { paused: true }).unwrap(),
            json!({"paused": true})
        );
        assert_eq!(
            serde_json::to_value(ResumeOutcome {
                paused: false,
                requeued: 3
            })
            .unwrap(),
            json!({"paused": false, "requeued": 3})
        );
        assert_eq!(
            serde_json::to_value(SourcePauseOutcome {
                id: 7,
                paused: true
            })
            .unwrap(),
            json!({"id": 7, "paused": true})
        );
        assert_eq!(
            serde_json::to_value(SourceResumeOutcome {
                id: 7,
                paused: false,
                status: "queued"
            })
            .unwrap(),
            json!({"id": 7, "paused": false, "status": "queued"})
        );
        assert_eq!(
            serde_json::to_value(ControlError::global("nope")).unwrap(),
            json!({"error": "nope"})
        );
        assert_eq!(
            serde_json::to_value(ControlError::source(7, "nope")).unwrap(),
            json!({"id": 7, "error": "nope"})
        );
    }

    #[tokio::test]
    async fn maintenance_denies_direct_global_controls() {
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
        assert_eq!(
            pause(&state).await["error"],
            "A local maintenance job is active"
        );
        assert_eq!(
            resume(state.clone()).await["error"],
            "A local maintenance job is active"
        );
        assert_eq!(
            pause_source(&state, 1).await["error"],
            "A local maintenance job is active"
        );
        assert_eq!(
            resume_source(state.clone(), 1).await["error"],
            "A local maintenance job is active"
        );
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
}
