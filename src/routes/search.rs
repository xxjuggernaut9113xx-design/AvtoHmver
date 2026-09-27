//! HTTP adapter for provider-normalized discovery search.
//! Orchestration and provider adapters live in the typed
//! [`crate::services::discovery`] ops; this module only translates between
//! HTTP and those ops.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};

use crate::services::discovery::SearchError;
use crate::AppState;

pub use crate::services::discovery::{
    build_provider_registry, default_provider_registry, DownloadSearchResultsBody,
    ProviderDescriptor, ProviderRegistry, SearchQuery, SearchResult,
};

/// GET /api/search/providers.  The registry is built at startup from the
/// installed gallery-dl version plus Curator's curated overlay.
pub async fn providers(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(match crate::services::discovery::providers(&state) {
        Ok(catalog) => serde_json::to_value(catalog).unwrap_or_default(),
        Err(error) => json!({"error":error}),
    })
}

fn search_error_response(error: SearchError) -> (StatusCode, Json<Value>) {
    match error {
        SearchError::BadRequest(message) => {
            (StatusCode::BAD_REQUEST, Json(json!({"error": message})))
        }
        SearchError::Internal(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": message})),
        ),
    }
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match crate::services::discovery::search(&state, query).await {
        Ok(response) => Ok(Json(serde_json::to_value(response).unwrap_or_default())),
        Err(error) => Err(search_error_response(error)),
    }
}

pub async fn download_selected(
    State(state): State<Arc<AppState>>,
    Json(body): Json<DownloadSearchResultsBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let urls = crate::services::discovery::select_download_urls(&state, body.results)
        .map_err(search_error_response)?;
    let queued = super::sources::create_sources_from_urls(state, urls).await?;
    Ok(Json(
        json!({"queued":queued,"status":"queued_with_gallery_dl"}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;

    #[tokio::test]
    async fn direct_urls_use_existing_source_queue_contract() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let result = search(
            State(state),
            Query(SearchQuery {
                query: Some("https://example.test/post/1".into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(result["results"][0]["provider"], "gallery-dl");
        assert_eq!(result["results"][0]["gallery_dl_compatible"], true);
    }

    #[tokio::test]
    async fn balbums_index_entries_are_not_sent_to_the_downloader_until_resolved() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let result = search(
            State(state),
            Query(SearchQuery {
                query: Some("balbums.st/collection/example".into()),
                provider: Some("balbums".into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(result["results"][0]["gallery_dl_compatible"], false);
    }

    #[tokio::test]
    async fn search_adapter_preserves_legacy_error_shapes() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let Err((status, Json(value))) = search(
            State(state),
            Query(SearchQuery {
                query: Some("x".into()),
                provider: Some("nope".into()),
                ..Default::default()
            }),
        )
        .await
        else {
            panic!("unknown provider must be rejected");
        };
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({"error": "Unknown search provider: nope"}));
    }
}
