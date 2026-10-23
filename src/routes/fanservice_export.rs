//! Portable, exact-membership export. This stages a download, never edits a library.
use super::fanservice::{authority, item, library_error};
use crate::{
    chpack::{build_selected_chpack, safe_pack_filename, ExportRow, PackMetadata},
    services::library::{self, MediaQuery},
    AppState,
};
use axum::{
    body::Body,
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use tokio_util::{io::ReaderStream, sync::CancellationToken};

#[derive(Deserialize)]
pub struct ExportRequest {
    library_id: String,
    ids: Vec<i64>,
    name: String,
    #[serde(default = "default_author")]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    unlock_cost: i64,
    cover_id: Option<i64>,
}
fn default_author() -> String {
    "fanservice".into()
}
fn error(status: StatusCode, message: impl ToString) -> Response {
    (status, Json(json!({"error": message.to_string()}))).into_response()
}
struct CancelOnDrop(CancellationToken);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

pub async fn export(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Json(request): Json<ExportRequest>,
) -> Response {
    if let Err(e) = authority(peer) {
        return e.into_response();
    }
    if request.library_id != state.instance_id {
        return error(
            StatusCode::CONFLICT,
            "Selection belongs to a different Server library",
        );
    }
    if request.name.trim().is_empty()
        || request.name.chars().count() > 120
        || request.author.chars().count() > 120
        || request.description.chars().count() > 2000
        || !(0..=i32::MAX as i64).contains(&request.unlock_cost)
        || request.ids.is_empty()
        || request.ids.len() > 10000
        || request.ids.iter().any(|id| *id <= 0)
    {
        return error(
            StatusCode::BAD_REQUEST,
            "Invalid pack metadata or selection (1–10000 media IDs required)",
        );
    }
    let ids: Vec<i64> = request
        .ids
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let library_root = match dunce::canonicalize(&state.library_dir) {
        Ok(root) => root,
        Err(e) => return error(StatusCode::SERVICE_UNAVAILABLE, e),
    };
    let mut rows = BTreeMap::new();
    for chunk in ids.chunks(500) {
        let q = MediaQuery {
            ids: Some(
                chunk
                    .iter()
                    .map(i64::to_string)
                    .collect::<Vec<_>>()
                    .join(","),
            ),
            only_included: Some(true),
            include_long_videos: Some(true),
            limit: Some(500),
            ..Default::default()
        };
        let page = match library::list(&state, q).await {
            Ok(page) => page,
            Err(e) => return library_error(e).into_response(),
        };
        for row in page.media {
            if let Some(media) = item(&row) {
                let id = media["id"].as_i64().unwrap();
                let Ok(path) = crate::media_path(&state, id) else {
                    continue;
                };
                let Ok(relative) = path.strip_prefix(&library_root) else {
                    return error(StatusCode::BAD_REQUEST, "Media path is outside the library");
                };
                rows.insert(
                    id,
                    ExportRow {
                        filepath: relative.to_string_lossy().into_owned(),
                        kind: media["type"].as_str().unwrap().into(),
                        rating: 0,
                        tags: media["tags"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect(),
                    },
                );
            }
        }
    }
    let missing: Vec<_> = ids.iter().filter(|id| !rows.contains_key(id)).collect();
    if !missing.is_empty() {
        return (StatusCode::CONFLICT, Json(json!({"error":"Selected media is unavailable. Correct the selection or explicitly exclude these items before exporting.", "missing_ids":missing}))).into_response();
    }
    let cover = match request.cover_id {
        None => None,
        Some(id) => match rows.get(&id).filter(|r| r.kind == "image") {
            Some(row) => Some(row.filepath.clone()),
            None => {
                return error(
                    StatusCode::BAD_REQUEST,
                    "Cover must be an image in this selection",
                )
            }
        },
    };
    let Some(lease) = state.maintenance.try_acquire_background_worker() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Library maintenance is active",
        );
    };
    let cancel = state.shutdown.child_token();
    let guard = CancelOnDrop(cancel.clone());
    let filename = safe_pack_filename(&request.name);
    let library_dir = state.library_dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _lease = lease;
        build_selected_chpack(
            PackMetadata {
                name: request.name.trim().into(),
                author: request.author,
                description: request.description,
                unlock_cost: request.unlock_cost,
                cover,
            },
            rows.into_values().collect(),
            &library_dir,
            &|| cancel.is_cancelled(),
        )
    })
    .await;
    let tmp = match result {
        Ok(Ok(tmp)) => tmp,
        Ok(Err(e)) => return error(StatusCode::CONFLICT, e),
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let file = match tokio::fs::File::open(tmp.path()).await {
        Ok(f) => f,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let length = file.metadata().await.ok().map(|m| m.len());
    let stream = ReaderStream::new(file).map(move |chunk| {
        let _keep = (&tmp, &guard);
        chunk
    });
    let mut response = Body::from_stream(stream).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
    if let Ok(value) = format!("attachment; filename=\"{filename}\"").parse() {
        response
            .headers_mut()
            .insert(header::CONTENT_DISPOSITION, value);
    }
    if let Some(length) = length {
        response
            .headers_mut()
            .insert(header::CONTENT_LENGTH, length.into());
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::to_bytes, extract::ConnectInfo, http::Request};
    use serde_json::{json, Value};
    use tower::ServiceExt;

    fn seed(state: &AppState) {
        crate::test_support::source(state);
        let conn = state.pool.get().unwrap();
        for id in 1..=3 {
            let name = format!("item{id}.png");
            std::fs::write(state.library_dir.join(&name), format!("synthetic {id}")).unwrap();
            conn.execute("INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded) VALUES(?1,1,?2,?2,'image','2026',1)", rusqlite::params![id,name]).unwrap();
        }
        for tag in ["slow", "fast"] {
            conn.execute("INSERT INTO tags(name,added_at) VALUES(?1,'2026')", [tag])
                .unwrap();
            let tag_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO media_tags(media_id,tag_id) VALUES(1,?1)",
                [tag_id],
            )
            .unwrap();
        }
    }
    async fn request(state: Arc<AppState>, body: Value) -> Response {
        let req = Request::post("/api/fanservice/v1/export/chpack")
            .header("content-type", "application/json")
            .extension(ConnectInfo(
                "100.101.102.103:54321"
                    .parse::<std::net::SocketAddr>()
                    .unwrap(),
            ))
            .body(Body::from(body.to_string()))
            .unwrap();
        super::super::build_router(state)
            .oneshot(req)
            .await
            .unwrap()
    }
    fn body(ids: Value) -> Value {
        json!({"library_id":"test-instance","ids":ids,"name":"Portable selection","description":"Test","unlock_cost":7,"cover_id":1})
    }

    #[tokio::test]
    async fn viewer_exports_exact_deduplicated_selection_with_cover_and_multiple_pools() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        seed(&state);
        let response = request(state.clone(), body(json!([1, 3, 1]))).await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let manifest: Value =
            serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap();
        assert_eq!(manifest["total_media"], 2);
        assert_eq!(manifest["unlock_cost"], 7);
        assert_eq!(manifest["preview"], "preview.png");
        assert_eq!(manifest["media"][0]["file"], "0_fast_slow.png");
        let mut bytes = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("media/1.png").unwrap(), &mut bytes)
            .unwrap();
        assert_eq!(bytes, "synthetic 3");
        assert_eq!(archive.len(), 4); // Two selected files, cover, manifest; item 2 is absent.
        let conn = state.pool.get().unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM media", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
    }
    #[tokio::test]
    async fn export_rejects_missing_members_wrong_library_and_invalid_cover_without_partial_archives(
    ) {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        seed(&state);
        std::fs::remove_file(state.library_dir.join("item3.png")).unwrap();
        let response = request(state.clone(), body(json!([1, 3]))).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let result: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
        assert_eq!(result["missing_ids"], json!([3]));
        let mut wrong = body(json!([1]));
        wrong["library_id"] = json!("other");
        assert_eq!(
            request(state.clone(), wrong).await.status(),
            StatusCode::CONFLICT
        );
        let mut cover = body(json!([1]));
        cover["cover_id"] = json!(2);
        assert_eq!(
            request(state.clone(), cover).await.status(),
            StatusCode::BAD_REQUEST
        );
        let mut price = body(json!([1]));
        price["unlock_cost"] = json!(-1);
        assert_eq!(
            request(state.clone(), price).await.status(),
            StatusCode::BAD_REQUEST
        );
        state.shutdown.cancel();
        assert_eq!(
            request(state, body(json!([1]))).await.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
