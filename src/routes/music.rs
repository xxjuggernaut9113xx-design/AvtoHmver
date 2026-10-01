use crate::{services::music, AppState};
use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
type Error = (StatusCode, Json<Value>);
fn bad(e: impl std::fmt::Display) -> Error {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":e.to_string()})),
    )
}
pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, Error> {
    Ok(Json(json!({"tracks":music::list(&state).map_err(bad)?})))
}
pub async fn access(peer: super::OptionalConnectInfo) -> Json<Value> {
    let local = peer.into_option().is_none_or(|p| p.0.ip().is_loopback());
    Json(json!({"can_edit":local,"role":if local {"host"} else {"viewer"}}))
}

#[derive(Deserialize)]
pub struct Upload {
    name: String,
}
pub async fn upload(
    State(state): State<Arc<AppState>>,
    Query(q): Query<Upload>,
    bytes: Bytes,
) -> Result<Json<music::Track>, Error> {
    tokio::task::spawn_blocking(move || music::store(&state, &q.name, &bytes))
        .await
        .map_err(bad)?
        .map(Json)
        .map_err(bad)
}
#[derive(Deserialize)]
pub struct Import {
    path: String,
}
pub async fn import(
    State(state): State<Arc<AppState>>,
    Json(q): Json<Import>,
) -> Result<Json<Value>, Error> {
    let tracks =
        tokio::task::spawn_blocking(move || music::import(&state, std::path::Path::new(&q.path)))
            .await
            .map_err(bad)?
            .map_err(bad)?;
    Ok(Json(json!({"tracks":tracks})))
}
#[derive(Deserialize)]
pub struct StreamQuery {
    #[serde(default)]
    browser: bool,
}
pub async fn stream(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Query(q): Query<StreamQuery>,
    headers: HeaderMap,
    method: Method,
    peer: super::OptionalConnectInfo,
) -> Response {
    let caller = crate::services::access::Caller::for_peer(
        peer.into_option().map(|p| p.0),
        crate::native::ViewerPermissions::default(),
    );
    if !caller.can_stream_media() {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut path = match music::track_path(&state, id) {
        Ok(p) => p,
        Err(e) => return (StatusCode::NOT_FOUND, Json(json!({"error":e}))).into_response(),
    };
    if q.browser
        && !matches!(
            path.extension().and_then(|s| s.to_str()),
            Some("mp3" | "wav" | "m4a")
        )
    {
        let converted = path.with_extension("browser.mp3");
        if !converted.is_file() {
            let _lease = match state.maintenance.try_acquire_background_worker() {
                Some(l) => l,
                None => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
            };
            let tmp = match tempfile::Builder::new()
                .suffix(".mp3")
                .tempfile_in(state.data_dir.join("music"))
            {
                Ok(t) => t,
                Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            };
            let mut command = crate::process::command(&state.ffmpeg_bin);
            command.kill_on_drop(true);
            command
                .args(["-nostdin", "-v", "error", "-y", "-i"])
                .arg(&path)
                .args(["-vn", "-codec:a", "libmp3lame", "-q:a", "2"])
                .arg(tmp.path());
            let output =
                tokio::time::timeout(std::time::Duration::from_secs(300), command.output()).await;
            if !output.is_ok_and(|o| o.is_ok_and(|o| o.status.success())) {
                return (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(json!({"error":"Audio conversion failed. Retry or import MP3/M4A/WAV."})),
                )
                    .into_response();
            }
            if let Err(e) = tmp.persist_noclobber(&converted) {
                if !converted.is_file() {
                    return bad(e).into_response();
                }
            }
        }
        path = converted;
    }
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let total = match file.metadata().await {
        Ok(m) => m.len(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let range = match headers.get(header::RANGE).map(|v| v.to_str()).transpose() {
        Ok(r) => r,
        Err(_) => return StatusCode::RANGE_NOT_SATISFIABLE.into_response(),
    };
    let plan = match crate::services::media::plan_range(total, range) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{total}"))],
                Body::empty(),
            )
                .into_response()
        }
    };
    let mime = match path.extension().and_then(|s| s.to_str()) {
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        _ => "audio/ogg",
    };
    let mut out = HeaderMap::new();
    out.insert(header::CONTENT_TYPE, mime.parse().unwrap());
    out.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    out.insert(
        header::CONTENT_LENGTH,
        plan.length.to_string().parse().unwrap(),
    );
    out.insert(header::CACHE_CONTROL, "private, no-cache".parse().unwrap());
    if plan.partial {
        out.insert(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{total}", plan.start, plan.end())
                .parse()
                .unwrap(),
        );
    }
    let status = if plan.partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    if method == Method::HEAD {
        return (status, out, Body::empty()).into_response();
    }
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    if file
        .seek(std::io::SeekFrom::Start(plan.start))
        .await
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    (
        status,
        out,
        Body::from_stream(tokio_util::io::ReaderStream::new(file.take(plan.length))),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::to_bytes, http::Request};
    use tower::ServiceExt;
    #[tokio::test]
    #[ignore = "requires AVTOHMVER_TEST_FFMPEG pointing to a real FFmpeg executable"]
    async fn real_audio_conversion_is_cached_and_range_streamable() {
        let ffmpeg = std::env::var("AVTOHMVER_TEST_FFMPEG").expect("set AVTOHMVER_TEST_FFMPEG");
        let root = tempfile::tempdir().unwrap();
        let mut state = crate::test_support::state(root.path());
        Arc::get_mut(&mut state).unwrap().ffmpeg_bin = ffmpeg.clone();
        let app = crate::router((*state).clone());
        for format in ["aac", "flac", "ogg"] {
            let source = root.path().join(format!("tone.{format}"));
            let generated = std::process::Command::new(&ffmpeg)
                .args([
                    "-nostdin",
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=0.2",
                ])
                .arg(&source)
                .output()
                .unwrap();
            assert!(
                generated.status.success(),
                "{}",
                String::from_utf8_lossy(&generated.stderr)
            );
            let track = music::store(
                &state,
                &format!("tone.{format}"),
                &std::fs::read(source).unwrap(),
            )
            .unwrap();
            let uri = format!("/api/music/tracks/{}/stream?browser=true", track.id);
            let response = app
                .clone()
                .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CONTENT_TYPE], "audio/mpeg");
            let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
            assert!(!bytes.is_empty());
            let cache = music::track_path(&state, track.id)
                .unwrap()
                .with_extension("browser.mp3");
            assert_eq!(std::fs::read(&cache).unwrap(), bytes.as_ref());
            let modified = std::fs::metadata(&cache).unwrap().modified().unwrap();
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(uri)
                        .header("range", "bytes=0-15")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(
                to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
                &bytes[..16]
            );
            assert_eq!(
                std::fs::metadata(cache).unwrap().modified().unwrap(),
                modified
            );
        }
    }
    #[tokio::test]
    async fn upload_managed_track_and_stream_ranges_preserve_bytes() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let app = crate::router((*state).clone());
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/music/tracks?name=track.mp3")
                    .body(Body::from("0123456789"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        let track: music::Track = serde_json::from_slice(&body).unwrap();
        assert_eq!(music::list(&state).unwrap()[0].id, track.id);
        let uri = format!("/api/music/tracks/{}/stream", track.id);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&uri)
                    .header("range", "bytes=2-5")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            b"2345"
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("HEAD")
                    .uri(&uri)
                    .header("range", "bytes=-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "3");
        assert!(to_bytes(response.into_body(), 1024)
            .await
            .unwrap()
            .is_empty());
        let response = app
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("range", "bytes=50-")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes */10");
    }
}
