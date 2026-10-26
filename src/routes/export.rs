use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::chpack::{build_chpack_cancellable, safe_pack_filename, ExportRow};
use crate::AppState;

fn linked_local_only(
    state: &AppState,
    peer: &super::OptionalConnectInfo,
) -> Result<(), (StatusCode, Json<Value>)> {
    if !state.edition.owns_library() || peer.as_ref().is_some_and(|peer| !peer.0.ip().is_loopback())
    {
        return Err((
            StatusCode::FORBIDDEN,
            Json(
                json!({"error":"Linked staging is available only on this computer. Use portable export from another device."}),
            ),
        ));
    }
    Ok(())
}

pub async fn linked_status(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    linked_local_only(&state, &peer)?;
    Ok(Json(json!({"job":state.linked_staging.status()})))
}

pub async fn linked_start(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    linked_local_only(&state, &peer)?;
    crate::linked_packages::StagingJobs::start(&state)
        .map(|job| (StatusCode::ACCEPTED, Json(json!({"job":job}))))
        .map_err(|error| {
            (
                if state.shutdown.is_cancelled() {
                    StatusCode::SERVICE_UNAVAILABLE
                } else {
                    StatusCode::CONFLICT
                },
                Json(json!({"error":error.to_string()})),
            )
        })
}

pub async fn linked_cancel(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    linked_local_only(&state, &peer)?;
    if !state.linked_staging.cancel(&id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error":"Staging job not found"})),
        ));
    }
    Ok(Json(json!({"job":state.linked_staging.status()})))
}

// ─── GET /api/export ─────────────────────────────────────────────────────────

pub async fn export_sources(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = crate::services::export::source_list(&state)
        .await
        .map_err(|error| {
            let status = match error {
                crate::services::export::ExportError::Forbidden => StatusCode::FORBIDDEN,
                crate::services::export::ExportError::ShuttingDown
                | crate::services::export::ExportError::MaintenanceActive => {
                    StatusCode::SERVICE_UNAVAILABLE
                }
                crate::services::export::ExportError::Database(_) => {
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            };
            (status, Json(json!({"error": error.message()})))
        })?;
    Ok(Json(
        serde_json::to_value(result).expect("serializable source export"),
    ))
}

// ─── POST /api/import ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ImportBody {
    pub sources: Vec<Value>,
}

pub async fn import_sources(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = crate::services::export::import_source_list(state, body.sources)
        .await
        .map_err(|error| {
            use crate::services::sources::SourceError;
            let status = match error {
                SourceError::Forbidden => StatusCode::FORBIDDEN,
                SourceError::ShuttingDown | SourceError::MaintenanceActive => {
                    StatusCode::SERVICE_UNAVAILABLE
                }
                SourceError::InvalidInput(_)
                | SourceError::InvalidUrl(_)
                | SourceError::NothingToUpdate
                | SourceError::RetentionLimit
                | SourceError::RetentionConfirmation => StatusCode::BAD_REQUEST,
                SourceError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
                SourceError::Missing => StatusCode::NOT_FOUND,
                SourceError::MissingGroup => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({"error": error.message()})))
        })?;
    Ok(Json(
        serde_json::to_value(result).expect("serializable source import"),
    ))
}

// ─── POST /api/export/chpack ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ChpackBody {
    pub source_id: Option<i64>,
    pub name: Option<String>,
    #[serde(default = "default_author")]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub unlock_cost: i64,
}
fn default_author() -> String {
    "AvtoHmver".into()
}

pub async fn export_chpack(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChpackBody>,
) -> Response {
    if state.shutdown.is_cancelled() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "AvtoHmver is shutting down"})),
        )
            .into_response();
    }
    let Some(lease) = state.maintenance.try_acquire_background_worker() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "A local maintenance job is active"})),
        )
            .into_response();
    };
    let conn = match state.pool.get() {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response()
        }
    };

    struct Row {
        filepath: String,
        kind: String,
        rating: i64,
        tags_csv: Option<String>,
    }

    let (pack_name, rows) = if let Some(sid) = body.source_id {
        let src_name: Option<String> = conn
            .query_row("SELECT name FROM sources WHERE id=?1", [sid], |r| r.get(0))
            .ok();
        if src_name.is_none() {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Source not found"})),
            )
                .into_response();
        }
        let pname = body
            .name
            .as_deref()
            .unwrap_or(src_name.as_deref().unwrap_or("AvtoHmver Export"))
            .to_string();

        let mut stmt = conn.prepare(
            "SELECT m.filepath, m.type, m.rating, \
                (SELECT GROUP_CONCAT(t.name, ',') FROM media_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.media_id=m.id) AS tags_csv \
             FROM media m WHERE m.source_id=?1 AND m.downloaded=1 AND m.clip_start_secs IS NULL AND m.type IN ('image','video','gif','clip') AND m.missing=0 AND m.retention_deleted=0 ORDER BY m.id"
        ).unwrap();
        let rows: Vec<Row> = stmt
            .query_map([sid], |r| {
                Ok(Row {
                    filepath: r.get(0)?,
                    kind: r.get(1)?,
                    rating: r.get(2)?,
                    tags_csv: r.get(3)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        (pname, rows)
    } else {
        let pname = body
            .name
            .as_deref()
            .unwrap_or("AvtoHmver Export")
            .to_string();
        let mut stmt = conn.prepare(
            "SELECT m.filepath, m.type, m.rating, \
                (SELECT GROUP_CONCAT(t.name, ',') FROM media_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.media_id=m.id) AS tags_csv \
             FROM media m WHERE m.downloaded=1 AND m.clip_start_secs IS NULL AND m.type IN ('image','video','gif','clip') AND m.missing=0 AND m.retention_deleted=0 ORDER BY m.id"
        ).unwrap();
        let rows: Vec<Row> = stmt
            .query_map([], |r| {
                Ok(Row {
                    filepath: r.get(0)?,
                    kind: r.get(1)?,
                    rating: r.get(2)?,
                    tags_csv: r.get(3)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        (pname, rows)
    };

    if rows.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "No downloaded media found for this selection"})),
        )
            .into_response();
    }

    let export_rows: Vec<ExportRow> = rows
        .into_iter()
        .map(|r| ExportRow {
            filepath: r.filepath,
            kind: r.kind,
            rating: r.rating,
            tags: r
                .tags_csv
                .as_deref()
                .unwrap_or("")
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.trim().to_lowercase())
                .collect(),
        })
        .collect();

    let library_dir = state.library_dir.clone();
    let filename = safe_pack_filename(&pack_name);
    let author = body.author.clone();
    let description = body.description.clone();
    let unlock_cost = body.unlock_cost;
    let shutdown = state.shutdown.clone();

    let result = tokio::task::spawn_blocking(move || {
        let _lease = lease;
        build_chpack_cancellable(
            pack_name,
            author,
            description,
            unlock_cost,
            export_rows,
            &library_dir,
            &|| shutdown.is_cancelled(),
        )
    })
    .await;

    match result {
        Ok(Ok(tmp)) => match File::open(tmp.path()).await {
            Ok(f) => {
                // The response owns the archive until the last byte or a
                // disconnected reader drops the stream.
                let stream = ReaderStream::new(f).map(move |chunk| {
                    let _keep_archive_alive = &tmp;
                    chunk
                });
                let body = Body::from_stream(stream);
                let cd = format!("attachment; filename=\"{}\"", filename);
                let mut resp = body.into_response();
                resp.headers_mut()
                    .insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
                resp.headers_mut()
                    .insert(header::CONTENT_DISPOSITION, cd.parse().unwrap());
                resp
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
                .into_response(),
        },
        Ok(Err(e)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod package_tests {
    use super::*;

    #[tokio::test]
    async fn linked_http_jobs_reject_remote_callers_and_support_local_cancellation() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let remote = super::super::OptionalConnectInfo::from(Some(axum::extract::ConnectInfo(
            "100.64.0.2:1234".parse().unwrap(),
        )));
        assert_eq!(
            linked_status(State(state.clone()), remote)
                .await
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            linked_start(State(state.clone()), remote)
                .await
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
        assert!(state.linked_staging.status().is_none());
        let local = super::super::OptionalConnectInfo::from(None);
        let (status, Json(value)) = linked_start(State(state.clone()), local).await.unwrap();
        assert_eq!(status, StatusCode::ACCEPTED);
        let id = value["job"]["id"].as_str().unwrap().to_string();
        assert_eq!(
            linked_cancel(
                State(state.clone()),
                remote,
                axum::extract::Path(id.clone())
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::FORBIDDEN
        );
        let _ = linked_cancel(State(state.clone()), local, axum::extract::Path(id))
            .await
            .unwrap();
        state.download_tasks.close();
        state.download_tasks.wait().await;
        let job = state.linked_staging.status().unwrap();
        assert!(matches!(job.phase.as_str(), "cancelled" | "failed"));
        assert!(job.path.is_none());
        assert_eq!(state.maintenance.active_background_workers(), 0);
        assert_eq!(
            linked_cancel(State(state), local, axum::extract::Path("unknown".into()))
                .await
                .unwrap_err()
                .0,
            StatusCode::NOT_FOUND
        );
    }
    fn request() -> ChpackBody {
        ChpackBody {
            source_id: None,
            name: Some("Round trip".into()),
            author: default_author(),
            description: String::new(),
            unlock_cost: 0,
        }
    }
    #[tokio::test]
    async fn portable_response_keeps_archive_alive_and_shutdown_denies_new_exports() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        std::fs::write(state.library_dir.join("source.png"), b"original bytes").unwrap();
        let conn = state.pool.get().unwrap();
        conn.execute(
            "INSERT INTO sources(url,name,slug,added_at) VALUES('https://example.com/a','Source','source','2026-10-01')",
            [],
        )
        .unwrap();
        let source = conn.last_insert_rowid();
        conn.execute("INSERT INTO media(source_id,filepath,filename,type,added_at,downloaded,rating) VALUES(?1,'source.png','source.png','image','2026-10-01',1,2)", [source]).unwrap();
        drop(conn);
        let response = export_chpack(State(state.clone()), Json(request())).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(state.maintenance.active_background_workers(), 0);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let manifest: Value =
            serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap();
        assert_eq!(manifest["version"], "0.02a");
        assert_eq!(manifest["image_count"], 1);
        assert_eq!(manifest["video_count"], 0);
        assert_eq!(manifest["total_media"], 1);
        let mut media = Vec::new();
        std::io::Read::read_to_end(
            &mut archive.by_name("media/0_medium.png").unwrap(),
            &mut media,
        )
        .unwrap();
        assert_eq!(media, b"original bytes");
        state.shutdown.cancel();
        assert_eq!(
            export_chpack(State(state), Json(request())).await.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
