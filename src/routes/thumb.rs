use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use serde_json::json;

use crate::thumb_worker::get_or_create_thumb;
use crate::AppState;

pub async fn get_thumbnail(State(state): State<Arc<AppState>>, Path(id): Path<i64>) -> Response {
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

    let row = conn.query_row(
        "SELECT filepath, type, downloaded, origin_url, skip_reason, retention_deleted FROM media WHERE id=?1 AND missing=0",
        [id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, bool>(5)?,
            ))
        },
    );

    let (_filepath, _kind, downloaded, origin_url, skip_reason, retention_deleted) = match row {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Media not found"})),
            )
                .into_response()
        }
    };

    drop(conn);
    if skip_reason.is_some() || retention_deleted {
        return (StatusCode::NOT_FOUND, "Original is unavailable").into_response();
    }
    // Placeholder: redirect to origin_url for the frontend to stream directly
    if downloaded == 0 {
        return if let Some(url) = origin_url {
            Redirect::temporary(&url).into_response()
        } else {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Not downloaded yet"})),
            )
                .into_response()
        };
    }

    let src_path = match crate::media_path(&state, id) {
        Ok(path) => path,
        Err(_) => return (StatusCode::NOT_FOUND, "Original is unavailable").into_response(),
    };

    if !src_path.is_file() {
        let Some(_worker) = state.maintenance.try_acquire_background_worker() else {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "A local maintenance job is active."})),
            )
                .into_response();
        };
        if let Ok(conn) = state.pool.get() {
            let _ = crate::media_files::mark_missing(&conn, id);
        }
        return (StatusCode::NOT_FOUND, "Media file is unavailable").into_response();
    }

    // Images — generate/serve cached thumbnail
    // Thumbnail generation writes cache files even though this is a GET.
    // Lease it so an administrative cache rebuild has one owner at a time.
    let Some(_worker) = state.maintenance.try_acquire_background_worker() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "A local maintenance job is active."})),
        )
            .into_response();
    };
    match get_or_create_thumb(
        id,
        src_path,
        state.thumbs_dir.clone(),
        state.ffmpeg_bin.clone(),
    )
    .await
    {
        Ok(bytes) => {
            if let Some(limit) = state.settings.read().await.thumbnail_cache_max_bytes {
                let thumbs_dir = state.thumbs_dir.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    crate::storage::trim_thumbnail_cache(&thumbs_dir, limit)
                })
                .await;
            }
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "image/jpeg"),
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                bytes,
            )
                .into_response()
        }
        _ => (StatusCode::NOT_FOUND, "Preview unavailable").into_response(),
    }
}
