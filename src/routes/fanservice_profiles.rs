//! Game-profile writes use per-profile random keys, independent of library rights.
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::sync::Arc;
type Error = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: &str) -> Error {
    (status, Json(json!({"error":message})))
}
fn credentials(id: &str, headers: &HeaderMap) -> Result<String, Error> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid profile identity"));
    }
    let key = headers
        .get("x-fanservice-profile-key")
        .and_then(|h| h.to_str().ok())
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| {
            error(
                StatusCode::UNAUTHORIZED,
                "A 256-bit profile key is required",
            )
        })?;
    Ok(format!("{:x}", Sha1::digest(key.as_bytes())))
}
fn storage() -> Error {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Profile storage unavailable",
    )
}
fn schema(conn: &rusqlite::Connection) -> Result<(), Error> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS fanservice_profiles(id TEXT PRIMARY KEY,key_hash TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL)").map_err(|_|storage())
}
pub async fn read(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let key = credentials(&id, &headers)?;
    let conn = state.pool.get().map_err(|_| storage())?;
    schema(&conn)?;
    let row: Option<(String, i64, String)> = conn
        .query_row(
            "SELECT key_hash,revision,document FROM fanservice_profiles WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|_| storage())?;
    let (stored, revision, document) =
        row.ok_or_else(|| error(StatusCode::NOT_FOUND, "Profile has not been synchronized"))?;
    if stored != key {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "Profile key does not match",
        ));
    }
    Ok(Json(
        json!({"revision":revision,"profile":serde_json::from_str::<Value>(&document).map_err(|_|storage())?}),
    ))
}
#[derive(Deserialize)]
pub struct Write {
    expected_revision: i64,
    profile: Value,
}
pub async fn write(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(mut input): Json<Write>,
) -> Result<Json<Value>, Error> {
    let key = credentials(&id, &headers)?;
    if input.expected_revision < 0
        || input.profile["version"] != 1
        || !input.profile["packs"].is_array()
        || input.profile["packs"].as_array().unwrap().len() > 128
        || input.profile["unlock_points"]
            .as_u64()
            .is_none_or(|v| v > i32::MAX as u64)
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Invalid portable game profile",
        ));
    }
    for pack in input.profile["packs"].as_array_mut().unwrap() {
        if let Some(p) = pack.as_object_mut() {
            p.remove("manifest");
            p.remove("snapshot");
            p.remove("use_offline");
        }
    }
    let document = serde_json::to_string(&input.profile)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "Invalid profile"))?;
    if document.len() > 2 * 1024 * 1024 {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Portable profile exceeds 2 MiB",
        ));
    }
    let mut conn = state.pool.get().map_err(|_| storage())?;
    schema(&conn)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| storage())?;
    let row: Option<(String, i64)> = tx
        .query_row(
            "SELECT key_hash,revision FROM fanservice_profiles WHERE id=?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| storage())?;
    if let Some((stored, revision)) = row {
        if stored != key {
            return Err(error(
                StatusCode::UNAUTHORIZED,
                "Profile key does not match",
            ));
        }
        if revision != input.expected_revision {
            return Err(error(
                StatusCode::CONFLICT,
                "Profile changed on another device; download and review before overwriting",
            ));
        }
    } else if input.expected_revision != 0 {
        return Err(error(
            StatusCode::CONFLICT,
            "Profile revision does not exist",
        ));
    }
    let revision = input
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| error(StatusCode::CONFLICT, "Profile revision exhausted"))?;
    tx.execute("INSERT INTO fanservice_profiles(id,key_hash,revision,document) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,document=excluded.document",rusqlite::params![id,key,revision,document]).map_err(|_|storage())?;
    tx.commit().map_err(|_| storage())?;
    Ok(Json(json!({"revision":revision})))
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
    async fn sync_key_revision_and_private_media_are_enforced() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let app = crate::routes::build_router(state);
        let profile = json!({"version":1,"unlock_points":5,"packs":[{"id":"custom:a","manifest":{"media":[1]},"snapshot":"private"}]});
        let request = |key: &str, revision: i64| {
            Request::builder()
                .method("PUT")
                .uri("/api/fanservice/v1/profiles/test")
                .header("content-type", "application/json")
                .header("x-fanservice-profile-key", key)
                .body(Body::from(
                    json!({"expected_revision":revision,"profile":profile}).to_string(),
                ))
                .unwrap()
        };
        let key = "ab".repeat(32);
        assert_eq!(
            app.clone()
                .oneshot(request(&key, 0))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.clone()
                .oneshot(request(&key, 0))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            app.clone()
                .oneshot(request(&"cd".repeat(32), 1))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/fanservice/v1/profiles/test")
                    .header("x-fanservice-profile-key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let result: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(result["revision"], 1);
        assert!(result["profile"]["packs"][0].get("manifest").is_none());
        assert!(result["profile"]["packs"][0].get("snapshot").is_none());
    }
}
