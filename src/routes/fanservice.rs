//! Read-only game adapter. Pack definitions and purchases belong to game profiles,
//! never to library organization. Existing listener authorization applies.
use crate::{
    services::{
        access::Caller,
        library::{self, MediaQuery},
    },
    AppState,
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

type Error = (StatusCode, Json<Value>);
fn bad(message: impl std::fmt::Display) -> Error {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":message.to_string()})),
    )
}
pub(super) fn authority(peer: super::OptionalConnectInfo) -> Result<(), Error> {
    let caller = Caller::for_peer(
        peer.into_option().map(|p| p.0),
        crate::native::ViewerPermissions::default(),
    );
    if caller.can_read_library() && caller.can_stream_media() {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Library playback permission required"})),
        ))
    }
}
#[derive(Default, Deserialize)]
pub struct RequestQuery {
    /// JSON selection; GET resolution performs no writes.
    selection: Option<String>,
    query: Option<String>,
    cursor: Option<String>,
}
#[derive(Default, Deserialize)]
struct Selection {
    #[serde(default)]
    ids: Vec<i64>,
    #[serde(default)]
    rules: Vec<Value>,
}
fn rule(value: Value) -> Result<MediaQuery, Error> {
    let mut q: MediaQuery = serde_json::from_value(value).map_err(bad)?;
    q.cursor = None;
    q.after_id = None;
    q.shuffle_seed = None;
    q.only_included = Some(true);
    q.include_long_videos = Some(true);
    q.limit = Some(500);
    q.sort = Some("default".into());
    Ok(q)
}
pub(super) fn library_error(error: library::LibraryError) -> Error {
    let status = match error {
        library::LibraryError::BadRequest(_) => StatusCode::BAD_REQUEST,
        library::LibraryError::Maintenance | library::LibraryError::ShuttingDown => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        library::LibraryError::Forbidden => StatusCode::FORBIDDEN,
        library::LibraryError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({"error":error.message()})))
}
pub(super) fn item(row: &HashMap<String, Value>) -> Option<Value> {
    if row.get("downloaded").and_then(Value::as_i64) != Some(1)
        || row.get("retention_deleted").and_then(Value::as_i64) == Some(1)
    {
        return None;
    }
    let id = row.get("id")?.as_i64()?;
    let kind = row.get("type")?.as_str()?;
    if !matches!(kind, "image" | "video") {
        return None;
    }
    let mut tags = row
        .get("tags")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(inherited) = row.get("inherited_tags").and_then(Value::as_array) {
        tags.extend(inherited.iter().cloned());
    }
    if let Some(pace) = row
        .get("pace_label")
        .and_then(Value::as_str)
        .filter(|p| matches!(*p, "slow" | "medium" | "fast" | "cum" | "succubus"))
    {
        tags.push(json!(pace));
    }
    let mut normalized: Vec<String> = tags
        .iter()
        .filter_map(Value::as_str)
        .map(|s| s.to_lowercase())
        .collect();
    for tag in normalized.clone() {
        if let Some((prefix, value)) = tag.split_once(':') {
            if matches!(prefix, "pace" | "position") {
                normalized.push(value.into());
            }
        }
    }
    normalized.sort();
    normalized.dedup();
    Some(
        json!({"id":id,"file":row.get("filename"),"name":row.get("filename"),"type":kind,
        "rating":row.get("rating"),"tags":normalized,"source_id":row.get("source_id"),
        "url":format!("/api/media/{id}/stream"),"thumbnail":format!("/api/thumb/{id}")}),
    )
}
pub async fn capabilities(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
) -> Result<Json<Value>, Error> {
    authority(peer)?;
    Ok(Json(
        json!({"product":"fanservice","protocol":1,"library_id":state.instance_id,
        "capabilities":{"library_read":true,"live_selection":true,"library_edit":false,
        "music_streaming":true,"music_beatmaps":true,"server_profiles":true,"chpack_export":true,"server_offline_packs":false},
        "selection_limit":10000}),
    ))
}
pub async fn browse(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Query(request): Query<RequestQuery>,
) -> Result<Json<Value>, Error> {
    authority(peer)?;
    let value = request
        .query
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(bad)?
        .unwrap_or(json!({}));
    let mut q = rule(value.clone())?;
    q.sort = value
        .get("sort")
        .and_then(Value::as_str)
        .map(str::to_string);
    q.limit = Some(60);
    q.cursor = request.cursor;
    let page = library::list(&state, q).await.map_err(library_error)?;
    Ok(Json(
        json!({"library_id":state.instance_id,"items":page.media.iter().filter_map(item).collect::<Vec<_>>(),
        "has_more":page.has_more,"next_cursor":page.next_cursor}),
    ))
}
pub async fn resolve(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Query(request): Query<RequestQuery>,
) -> Result<Json<Value>, Error> {
    authority(peer)?;
    let selection: Selection = serde_json::from_str(
        request
            .selection
            .as_deref()
            .ok_or_else(|| bad("Missing selection"))?,
    )
    .map_err(bad)?;
    if selection.rules.len() > 32
        || selection.ids.len() > 500
        || selection.ids.iter().any(|id| *id <= 0)
    {
        return Err(bad("Selection exceeds limits or contains invalid IDs"));
    }
    let mut queries = selection
        .rules
        .into_iter()
        .map(rule)
        .collect::<Result<Vec<_>, _>>()?;
    if !selection.ids.is_empty() {
        let mut q = rule(json!({}))?;
        q.ids = Some(
            selection
                .ids
                .iter()
                .map(i64::to_string)
                .collect::<Vec<_>>()
                .join(","),
        );
        queries.push(q);
    }
    let mut selected = BTreeMap::new();
    for mut q in queries {
        loop {
            let page = library::list(&state, q.clone())
                .await
                .map_err(library_error)?;
            for row in &page.media {
                if let Some(value) = item(row) {
                    let id = value["id"].as_i64().unwrap();
                    // Confirm underlying media still exists; never substitute content.
                    if crate::media_path(&state, id).is_ok() {
                        selected.insert(id, value);
                    }
                }
            }
            if selected.len() > 10000 {
                return Err(bad("Pack exceeds 10000 items; narrow its selection"));
            }
            if !page.has_more {
                break;
            }
            let next = page
                .next_cursor
                .ok_or_else(|| bad("Library pagination failed"))?;
            if q.cursor.as_ref() == Some(&next) {
                return Err(bad("Library cursor did not advance"));
            }
            q.cursor = Some(next);
        }
    }
    let media: Vec<Value> = selected.into_values().collect();
    let missing_ids: Vec<i64> = selection
        .ids
        .into_iter()
        .filter(|id| !media.iter().any(|m| m["id"].as_i64() == Some(*id)))
        .collect();
    Ok(Json(
        json!({"protocol":1,"library_id":state.instance_id,"media":media,"missing_ids":missing_ids}),
    ))
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
    #[ignore = "Interactive isolated browser fixture; stop with Ctrl+C"]
    async fn lite_browser_fixture() {
        let root = tempfile::tempdir().unwrap();
        let base = crate::test_support::state(root.path());
        let mut state = (*base).clone();
        state.edition = crate::edition::Edition::Server;
        state.static_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("static");
        crate::test_support::source(&state);
        std::fs::create_dir_all(&state.library_dir).unwrap();
        let bytes = std::fs::read(
            state
                .static_dir
                .join("fanservice/assets/button_rectangle_flat.png"),
        )
        .unwrap();
        for id in 1..=3 {
            std::fs::write(state.library_dir.join(format!("sample{id}.png")), &bytes).unwrap();
            state.pool.get().unwrap().execute("INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded,human_rating) VALUES(?1,1,?2,?2,'image','2026',1,2)", rusqlite::params![id,format!("sample{id}.png")]).unwrap();
        }
        // Explicit metadata covers every gameplay pool without original media.
        let conn = state.pool.get().unwrap();
        for tag in ["slow", "medium", "fast", "succubus", "cum", "ass", "boobs"] {
            conn.execute("INSERT INTO tags(name,added_at) VALUES(?1,'2026')", [tag])
                .unwrap();
            let tag_id = conn.last_insert_rowid();
            for id in 1..=3 {
                conn.execute(
                    "INSERT INTO media_tags(media_id,tag_id) VALUES(?1,?2)",
                    rusqlite::params![id, tag_id],
                )
                .unwrap();
            }
        }
        drop(conn);
        if let Some(music) = std::env::var_os("FANSERVICE_FIXTURE_MUSIC") {
            state.ffmpeg_bin =
                std::env::var("AVTOHMVER_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into());
            state.ffprobe_bin =
                std::env::var("AVTOHMVER_TEST_FFPROBE").unwrap_or_else(|_| "ffprobe".into());
            crate::services::music::store(
                &state,
                "synthetic-tone.m4a",
                &std::fs::read(music).unwrap(),
            )
            .unwrap();
        }
        // Optional non-sensitive native-video fixture. It is copied into the
        // temporary library only; the production library is never opened.
        if let Some(video) = std::env::var_os("FANSERVICE_FIXTURE_VIDEO") {
            std::fs::copy(video, state.library_dir.join("sample4.mp4")).unwrap();
            state.pool.get().unwrap().execute("INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded,human_rating) VALUES(4,1,'sample4.mp4','sample4.mp4','video','2026',1,3)", []).unwrap();
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:42169")
            .await
            .unwrap();
        println!("Isolated fanservice fixture: http://127.0.0.1:42169/fanservice/");
        axum::serve(
            listener,
            crate::router(state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn live_rules_union_explicit_ids_and_freeze_returned_manifest() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        std::fs::create_dir_all(&state.library_dir).unwrap();
        std::fs::write(state.library_dir.join("one.jpg"), b"test").unwrap();
        let conn = state.pool.get().unwrap();
        conn.execute_batch("INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded) VALUES(1,1,'one.jpg','one.jpg','image','2026',1);").unwrap();
        let app = crate::routes::build_router(state.clone());
        let selection = json!({"ids":[1],"rules":[{"source_id":1}]}).to_string();
        let path = format!(
            "/api/fanservice/v1/resolve?selection={}",
            urlencoding::encode(&selection)
        );
        let get = || Request::builder().uri(&path).body(Body::empty()).unwrap();
        let response = app.clone().oneshot(get()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let first: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(first["media"].as_array().unwrap().len(), 1);
        assert!(first["media"][0].get("filepath").is_none());
        conn.execute("UPDATE media SET missing=1 WHERE id=1", [])
            .unwrap();
        let response = app.oneshot(get()).await.unwrap();
        let second: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(second["media"].as_array().unwrap().len(), 0);
        assert_eq!(first["media"].as_array().unwrap().len(), 1);
        assert_eq!(second["missing_ids"], json!([1]));
    }
    #[tokio::test]
    async fn empty_selection_does_not_select_entire_library() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let result = resolve(
            State(state),
            None.into(),
            Query(RequestQuery {
                selection: Some("{}".into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.0["media"], json!([]));
    }
}
