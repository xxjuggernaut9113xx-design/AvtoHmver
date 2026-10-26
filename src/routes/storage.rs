//! Media & Storage dashboard and confirmed cleanup controls.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    Json,
};
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
) -> Json<Value> {
    Json(
        match crate::services::storage::dashboard(&state, query.sort).await {
            Ok(snapshot) => serde_json::to_value(snapshot)
                .unwrap_or_else(|_| json!({"error":"Storage accounting did not complete."})),
            Err(error) => json!({"error":error.message()}),
        },
    )
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
    let keep_newest = if let Some(value) = body.keep_newest {
        value
    } else {
        let conn = state.pool.get().map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":error.to_string()})),
            )
        })?;
        conn.query_row(
            "SELECT COALESCE(retention_keep_newest,0) FROM sources WHERE id=?1",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error":"Source not found"})),
            )
        })?
        .max(0) as u32
    };
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
