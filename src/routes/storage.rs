//! Media & Storage dashboard and confirmed cleanup controls.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    Json,
};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::AppState;

fn local_only(
    state: &AppState,
    peer: &Option<ConnectInfo<SocketAddr>>,
) -> Result<crate::maintenance::BackgroundWorkerLease, (StatusCode, Json<Value>)> {
    if !state.edition.has_local_admin()
        || !peer.as_ref().is_none_or(|peer| peer.0.ip().is_loopback())
    {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Storage cleanup is available only from this device."})),
        ));
    }
    if state.shutdown.is_cancelled() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":"AvtoHmver is shutting down"})),
        ));
    }
    state
        .maintenance
        .try_acquire_background_worker()
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":"A local maintenance job is active"})),
            )
        })
}

#[derive(Debug, Deserialize, Default)]
pub struct StorageQuery {
    pub sort: Option<String>,
}

pub async fn dashboard(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StorageQuery>,
) -> Result<Json<crate::services::storage::StorageDashboard>, (StatusCode, Json<Value>)> {
    use crate::services::storage::StorageError;
    crate::services::storage::dashboard(&state, query.sort)
        .await
        .map(Json)
        .map_err(|error| {
            let status = match error {
                StorageError::Forbidden => StatusCode::FORBIDDEN,
                StorageError::ShuttingDown | StorageError::Maintenance => {
                    StatusCode::SERVICE_UNAVAILABLE
                }
                StorageError::AccountingFailed => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (status, Json(json!({"error":error.message()})))
        })
}

pub async fn permit_one_sync(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Path(id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _lease = local_only(&state, &peer)?;
    let conn = state.pool.get().map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        )
    })?;
    let changed = conn
        .execute(
            "UPDATE sources SET storage_override_once=1 WHERE id=?1",
            [id],
        )
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":error.to_string()})),
            )
        })?;
    if changed == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error":"Source not found"})),
        ));
    }
    Ok(Json(json!({
        "id": id,
        "storage_override_once": true,
        "message": "One source sync is permitted even if the source is already at its quota. It can exceed the quota by one file."
    })))
}

#[derive(Debug, Deserialize)]
pub struct CleanupSourceBody {
    pub confirmation: String,
    #[serde(default)]
    pub keep_newest: Option<u32>,
}

pub async fn cleanup_source(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Path(id): Path<i64>,
    Json(body): Json<CleanupSourceBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let lease = local_only(&state, &peer)?;
    if body.confirmation != "DELETE OLD MEDIA" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Type DELETE OLD MEDIA to remove existing originals."})),
        ));
    }
    let running = state.running_sources.clone().lock_owned().await;
    if running.contains(&id) {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({"error":"Pause this source before removing old media."})),
        ));
    }
    let configured = {
        let conn = state.pool.get().map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":error.to_string()})),
            )
        })?;
        conn.query_row(
            "SELECT retention_keep_newest FROM sources WHERE id=?1",
            [id],
            |row| row.get::<_, Option<u32>>(0),
        )
        .optional()
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":error.to_string()})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error":"Source not found"})),
            )
        })?
    };
    let keep_newest = body
        .keep_newest
        .or(configured)
        .filter(|value| (1..=1_000_000).contains(value))
        .ok_or_else(|| (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Set a source retention rule to keep between 1 and 1,000,000 newest items before removing old media."})),
        ))?;
    let worker_state = state.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let _lease = lease;
        let _source_admission = running;
        crate::storage::cleanup_source_keep_newest(&worker_state, id, keep_newest)
    })
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Storage cleanup did not complete."})),
        )
    })?
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        )
    })?;
    Ok(Json(json!({
        "removed_items": outcome.removed_items,
        "removed_bytes": outcome.removed_bytes,
        "message": "Originals removed by retention remain as unavailable metadata placeholders."
    })))
}

#[derive(Debug, Deserialize)]
pub struct ConfirmationBody {
    pub confirmation: String,
}

pub async fn clear_thumbnails(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Json(body): Json<ConfirmationBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let lease = local_only(&state, &peer)?;
    if body.confirmation != "CLEAR THUMBNAILS" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Type CLEAR THUMBNAILS to delete cached thumbnails."})),
        ));
    }
    let thumbs_dir = state.thumbs_dir.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let _lease = lease;
        crate::storage::clear_thumbnail_cache(&thumbs_dir)
    })
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Thumbnail cleanup did not complete."})),
        )
    })?
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        )
    })?;
    Ok(Json(
        json!({"removed_items":outcome.removed_items,"removed_bytes":outcome.removed_bytes}),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ArchiveCleanupBody {
    pub confirmation: String,
    #[serde(default)]
    pub age_days: Option<u32>,
}

pub async fn cleanup_archives(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Json(body): Json<ArchiveCleanupBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let lease = local_only(&state, &peer)?;
    if body.confirmation != "DELETE ARCHIVES" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Type DELETE ARCHIVES to remove gallery-dl archives."})),
        ));
    }
    let archives_dir = state.archives_dir.clone();
    let age_days = body.age_days.filter(|days| *days > 0);
    let outcome = tokio::task::spawn_blocking(move || {
        let _lease = lease;
        crate::storage::remove_archives_older_than(&archives_dir, age_days)
    })
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Archive cleanup did not complete."})),
        )
    })?
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        )
    })?;
    Ok(Json(json!({
        "removed_items":outcome.removed_items,
        "removed_bytes":outcome.removed_bytes,
        "warning":"Deleted gallery-dl archives may cause gallery-dl to reconsider older posts on a later sync."
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn server_cleanup_requires_retention_and_preserves_originals_on_rejection() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let original = state.library_dir.join("test/original.mp4");
        std::fs::write(&original, b"original").unwrap();
        state
            .pool
            .get()
            .unwrap()
            .execute(
                "INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded)
             VALUES(1,1,'test/original.mp4','original.mp4','video','2026',1)",
                [],
            )
            .unwrap();
        let mut server = (*state).clone();
        server.edition = crate::edition::Edition::Server;
        let app = crate::router(server);
        for body in [
            r#"{"confirmation":"DELETE OLD MEDIA"}"#,
            r#"{"confirmation":"DELETE OLD MEDIA","keep_newest":0}"#,
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::post("/api/storage/sources/1/cleanup")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(std::fs::read(&original).unwrap(), b"original");
        }
        let newest = state.library_dir.join("test/newest.mp4");
        std::fs::write(&newest, b"newest").unwrap();
        state
            .pool
            .get()
            .unwrap()
            .execute_batch(
                "UPDATE sources SET retention_keep_newest=1 WHERE id=1;
             INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded)
             VALUES(2,1,'test/newest.mp4','newest.mp4','video','2026',1);",
            )
            .unwrap();
        let response = app
            .oneshot(
                Request::post("/api/storage/sources/1/cleanup")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"confirmation":"DELETE OLD MEDIA"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!original.exists());
        assert_eq!(std::fs::read(newest).unwrap(), b"newest");
    }

    #[tokio::test]
    async fn storage_dashboard_reports_unavailability_as_http_error() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        state.shutdown.cancel();
        let response = crate::router((*state).clone())
            .oneshot(Request::get("/api/storage").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error"], "AvtoHmver is shutting down");
    }

    #[tokio::test]
    async fn cleanup_and_classifier_configuration_respect_maintenance_and_shutdown() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let preview = state.thumbs_dir.join("1.jpg");
        std::fs::write(&preview, b"preserve cache during maintenance").unwrap();
        state.running_sources.lock().await.insert(999);
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
        let result = clear_thumbnails(
            State(state.clone()),
            super::super::OptionalConnectInfo::from(None),
            Json(ConfirmationBody {
                confirmation: "CLEAR THUMBNAILS".into(),
            }),
        )
        .await;
        assert_eq!(result.unwrap_err().0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            std::fs::read(&preview).unwrap(),
            b"preserve cache during maintenance"
        );
        assert!(matches!(
            crate::services::classifier::control(
                &state,
                crate::services::classifier::Action::Install
            ),
            Err(crate::services::classifier::Error::Unavailable(_))
        ));
        state.running_sources.lock().await.clear();
        state.server_tasks.close();
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            state.server_tasks.wait(),
        )
        .await
        .unwrap();
        state.shutdown.cancel();
        let result = clear_thumbnails(
            State(state.clone()),
            super::super::OptionalConnectInfo::from(None),
            Json(ConfirmationBody {
                confirmation: "CLEAR THUMBNAILS".into(),
            }),
        )
        .await;
        assert_eq!(result.unwrap_err().0, StatusCode::SERVICE_UNAVAILABLE);
        assert!(preview.exists());
        assert_eq!(state.maintenance.active_background_workers(), 0);
    }

    #[test]
    fn remote_storage_cleanup_stays_local_only() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let peer = Some(ConnectInfo(SocketAddr::from(([100, 64, 0, 2], 41641))));
        assert!(local_only(&state, &peer).is_err());
    }
}
