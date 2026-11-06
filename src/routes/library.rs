//! ServeDir handles range requests and missing files; reconcile a raced deletion on 404.
use crate::AppState;
use axum::{
    extract::{OriginalUri, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

pub async fn protect_served_files(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    // Even a file mislabeled as ordinary media must not acquire an origin
    // or execute scripts when opened as a document.
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    // CSP on the file response only protects document loads. Serve other
    // formats as generic attachments so they also cannot load as scripts or
    // styles in a trusted page. Fetch and range downloads still read the bytes.
    if let Some(content_type) = headers.get(header::CONTENT_TYPE) {
        let mime = content_type.to_str().unwrap_or_default();
        let passive = mime.starts_with("audio/")
            || mime.starts_with("video/")
            || (mime.starts_with("image/") && mime != "image/svg+xml");
        if !passive {
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            headers.insert(
                header::CONTENT_DISPOSITION,
                HeaderValue::from_static("attachment"),
            );
        }
    }
    response
}

pub async fn reconcile_not_found(
    State(state): State<Arc<AppState>>,
    OriginalUri(uri): OriginalUri,
    request: Request,
    next: Next,
) -> Response {
    let response = next.run(request).await;
    if response.status() == StatusCode::NOT_FOUND && !state.maintenance.is_active() {
        if let Some(path) = uri.path().strip_prefix("/library/") {
            if let Ok(decoded) = urlencoding::decode(path) {
                let rel = decoded.into_owned();
                if !std::path::Path::new(&rel)
                    .components()
                    .any(|c| !matches!(c, std::path::Component::Normal(_)))
                {
                    // This GET route normally only serves files, but a 404
                    // reconciles metadata.  Lease that exceptional write so
                    // it cannot overlap an Admin backup or reset.
                    let Some(_worker) = state.maintenance.try_acquire_background_worker() else {
                        return response;
                    };
                    let _=tokio::task::spawn_blocking(move || {
                        let path=state.library_dir.join(&rel);
                        if path.metadata().is_err_and(|e|e.kind()==std::io::ErrorKind::NotFound) {
                            if let Ok(conn)=state.pool.get() {
                                let _=conn.execute("UPDATE media SET missing=1,downloaded=0,nsfw_state='missing' WHERE filepath=?1 AND downloaded=1",[rel]);
                            }
                        }
                    }).await;
                }
            }
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header;
    use tower::ServiceExt;

    #[tokio::test]
    async fn library_serves_active_files_as_downloads_and_preserves_media_ranges() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let app = crate::router((*state).clone());
        for (name, mime, download) in [
            ("active.html", "application/octet-stream", true),
            ("active.svg", "application/octet-stream", true),
            ("active.js", "application/octet-stream", true),
            ("package.chpack", "application/octet-stream", true),
            ("photo.png", "image/png", false),
            ("video.mp4", "video/mp4", false),
            ("audio.m4a", "audio/m4a", false),
        ] {
            std::fs::write(state.library_dir.join(name), b"0123456789").unwrap();
            for method in ["GET", "HEAD"] {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .method(method)
                            .uri(format!("/library/{name}"))
                            .header(header::RANGE, "bytes=2-4")
                            .body(axum::body::Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                let headers = response.headers();
                assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{name}");
                assert_eq!(headers[header::CONTENT_TYPE], mime, "{name}");
                assert_eq!(headers[header::CONTENT_RANGE], "bytes 2-4/10");
                assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
                assert_eq!(headers[header::CONTENT_SECURITY_POLICY], "sandbox");
                assert_eq!(headers.contains_key(header::CONTENT_DISPOSITION), download);
                if download {
                    assert_eq!(headers[header::CONTENT_DISPOSITION], "attachment");
                }
                let body = axum::body::to_bytes(response.into_body(), 10)
                    .await
                    .unwrap();
                assert_eq!(&body[..], if method == "GET" { &b"234"[..] } else { &[] });
            }
        }
    }
    #[tokio::test]
    async fn missing_library_file_is_404_and_updates_database() {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(dir.path());
        crate::test_support::source(&state);
        state.pool.get().unwrap().execute("INSERT INTO media(source_id,filepath,filename,type,added_at) VALUES(1,'test/missing.jpg','missing.jpg','image','2026')",[]).unwrap();
        let app = axum::Router::new().nest(
            "/library",
            axum::Router::new()
                .fallback_service(tower_http::services::ServeDir::new(&state.library_dir))
                .layer(axum::middleware::from_fn_with_state(
                    state.clone(),
                    reconcile_not_found,
                )),
        );
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/library/test/missing.jpg")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            state
                .pool
                .get()
                .unwrap()
                .query_row("SELECT missing FROM media", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
