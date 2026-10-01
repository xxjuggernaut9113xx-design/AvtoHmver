use crate::{
    services::playback::{self, PlaybackPreset},
    AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
type ApiError = (StatusCode, Json<Value>);
fn error(e: playback::Error) -> ApiError {
    let status = match &e {
        playback::Error::Conflict => StatusCode::CONFLICT,
        playback::Error::Missing => StatusCode::NOT_FOUND,
        playback::Error::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
        playback::Error::Invalid(_) => StatusCode::BAD_REQUEST,
    };
    (status, Json(json!({"error":e.to_string()})))
}
pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"presets":playback::list(&state).map_err(error)?}),
    ))
}
pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(mut body): Json<PlaybackPreset>,
) -> Result<Json<PlaybackPreset>, ApiError> {
    body.id = None;
    body.revision = 0;
    playback::save(&state, body).map(Json).map_err(error)
}
pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(mut body): Json<PlaybackPreset>,
) -> Result<Json<PlaybackPreset>, ApiError> {
    body.id = Some(id);
    playback::save(&state, body).map(Json).map_err(error)
}
#[derive(Deserialize)]
pub struct Revision {
    revision: u64,
}
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Query(q): Query<Revision>,
) -> Result<Json<Value>, ApiError> {
    playback::delete(&state, id, q.revision).map_err(error)?;
    Ok(Json(json!({"deleted":true})))
}
pub async fn resolve(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PlaybackPreset>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"media":playback::resolve(&state,body).await.map_err(error)?}),
    ))
}

#[derive(Deserialize)]
pub struct DraftQuery {
    preset: String,
}
/// Read-only clients may resolve a draft without saving or starting a shared session.
pub async fn resolve_read(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DraftQuery>,
) -> Result<Json<Value>, ApiError> {
    let preset = serde_json::from_str::<PlaybackPreset>(&q.preset)
        .map_err(|e| error(playback::Error::Invalid(e.to_string())))?;
    Ok(Json(
        json!({"media":playback::resolve(&state,preset).await.map_err(error)?}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        extract::ConnectInfo,
        http::Request,
    };
    use tower::ServiceExt;
    #[tokio::test]
    async fn native_and_http_presets_share_revisions_and_viewer_reads() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let preset = playback::save(&state, PlaybackPreset::default()).unwrap();
        let app = crate::router((*state).clone());
        let mut request = Request::builder()
            .uri("/api/playback-presets")
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "100.64.1.2:1234".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(body["presets"][0]["id"], preset.id.unwrap());
        let mut updated = preset.clone();
        updated.name = "Changed natively".into();
        playback::save(&state, updated).unwrap();
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/playback-presets/{}", preset.id.unwrap()))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&preset).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/playback-presets")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&preset).unwrap()))
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "100.64.1.2:1234".parse::<std::net::SocketAddr>().unwrap(),
        ));
        assert_eq!(
            app.oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    #[tokio::test]
    async fn read_only_draft_resolution_reports_empty_and_missing_references() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let app = crate::router((*state).clone());
        let query =
            urlencoding::encode(&serde_json::to_string(&PlaybackPreset::default()).unwrap())
                .into_owned();
        let mut request = Request::builder()
            .uri(format!("/api/playback-presets/resolve?preset={query}"))
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "100.64.1.2:1234".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert!(body["error"].as_str().unwrap().contains("No media matches"));
        let p = PlaybackPreset {
            media_ids: vec![999],
            ..Default::default()
        };
        assert!(playback::resolve(&state, p)
            .await
            .unwrap_err()
            .to_string()
            .contains("missing"));
        let p = PlaybackPreset {
            tags: vec!["deleted-tag".into()],
            ..Default::default()
        };
        assert!(playback::resolve(&state, p)
            .await
            .unwrap_err()
            .to_string()
            .contains("missing"));
    }
}
