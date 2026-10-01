pub mod admin;
pub mod ch;
pub mod clips;
pub mod downloads;
pub mod export;
pub mod goon;
pub mod groups;
pub mod library;
pub mod media;
pub mod misc;
pub mod music;
pub mod oobe;
pub mod playback;
pub mod remote;
pub mod search;
pub mod session;
pub mod settings;
pub mod source_tags;
pub mod sources;
pub mod storage;
pub mod system;
pub mod tags;
pub mod thumb;

use crate::AppState;
use axum::{
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use serde_json::json;
use std::{convert::Infallible, net::SocketAddr, ops::Deref, sync::Arc};

#[derive(Clone, Copy, Debug)]
pub struct OptionalConnectInfo(Option<ConnectInfo<SocketAddr>>);

impl OptionalConnectInfo {
    pub(crate) fn into_option(self) -> Option<ConnectInfo<SocketAddr>> {
        self.0
    }
}

impl From<OptionalConnectInfo> for Option<ConnectInfo<SocketAddr>> {
    fn from(peer: OptionalConnectInfo) -> Self {
        peer.into_option()
    }
}

impl From<Option<ConnectInfo<SocketAddr>>> for OptionalConnectInfo {
    fn from(peer: Option<ConnectInfo<SocketAddr>>) -> Self {
        Self(peer)
    }
}

impl Deref for OptionalConnectInfo {
    type Target = Option<ConnectInfo<SocketAddr>>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<S> FromRequestParts<S> for OptionalConnectInfo
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(
            ConnectInfo::<SocketAddr>::from_request_parts(parts, state)
                .await
                .ok(),
        ))
    }
}

/// Canonical mutation permission contract. Host and Server own their local
/// library; a Tailnet Viewer is read/play/discover-only. Keep this list in
/// sync with `build_router`: tests reject both missing and stale entries and
/// verify the rendered table in `docs/permissions.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct MutationPermission {
    pub method: &'static str,
    pub path: &'static str,
    pub host: bool,
    pub server: bool,
    pub viewer: bool,
}

macro_rules! owner_mutations {
    ($(($method:literal, $path:literal)),* $(,)?) => {
        &[$(MutationPermission {
            method: $method,
            path: $path,
            host: true,
            server: true,
            viewer: false,
        }),*]
    };
}

pub const MUTATION_PERMISSIONS: &[MutationPermission] = owner_mutations![
    ("POST", "/api/music/tracks"),
    ("POST", "/api/music/import"),
    ("PUT", "/api/goon/playlists/{id}"),
    ("DELETE", "/api/goon/playlists/{id}"),
    ("POST", "/api/playback-presets"),
    ("PUT", "/api/playback-presets/{id}"),
    ("DELETE", "/api/playback-presets/{id}"),
    ("POST", "/api/playback-presets/resolve"),
    ("POST", "/api/admin/jobs"),
    ("POST", "/api/admin/backups"),
    ("POST", "/api/admin/backups/{id}/validate"),
    ("POST", "/api/admin/backups/{id}/restore"),
    ("POST", "/api/admin/phar"),
    ("POST", "/api/admin/phar/install"),
    ("POST", "/api/admin/phar/cancel"),
    ("POST", "/api/admin/phar/repair"),
    ("POST", "/api/admin/phar/self-test"),
    ("POST", "/api/session/start"),
    ("POST", "/api/session/command"),
    ("POST", "/api/oobe/validate"),
    ("POST", "/api/oobe/settings"),
    ("POST", "/api/oobe/complete"),
    ("POST", "/api/oobe/reset"),
    ("POST", "/api/media/bulk"),
    ("POST", "/api/media/{id}/clips"),
    ("PUT", "/api/media/{id}/rating"),
    ("POST", "/api/media/{id}/rating/approve"),
    ("POST", "/api/media/{id}/rating/undo"),
    ("PUT", "/api/media/{id}/duration"),
    ("POST", "/api/media/{id}/tags"),
    ("DELETE", "/api/media/{id}/tags/{tag_id}"),
    ("DELETE", "/api/tags/{id}"),
    ("POST", "/api/source-tags/review"),
    ("POST", "/api/source-tag-rules"),
    ("DELETE", "/api/source-tag-rules/{id}"),
    ("POST", "/api/sources"),
    ("POST", "/api/sources/resync-all"),
    ("PATCH", "/api/sources/{id}"),
    ("DELETE", "/api/sources/{id}"),
    ("PATCH", "/api/sources/{id}/group"),
    ("POST", "/api/sources/{id}/resync"),
    ("POST", "/api/ch/session"),
    ("POST", "/api/search/download"),
    ("POST", "/api/groups"),
    ("PATCH", "/api/groups/{id}"),
    ("DELETE", "/api/groups/{id}"),
    ("POST", "/api/groups/{id}/tags"),
    ("DELETE", "/api/groups/{id}/tags/{tag_id}"),
    ("POST", "/api/downloads/pause"),
    ("POST", "/api/downloads/resume"),
    ("POST", "/api/downloads/sources/{id}/pause"),
    ("POST", "/api/downloads/sources/{id}/resume"),
    ("PATCH", "/api/settings"),
    ("POST", "/api/storage/sources/{id}/permit-once"),
    ("POST", "/api/storage/sources/{id}/cleanup"),
    ("POST", "/api/storage/thumbnails/clear"),
    ("POST", "/api/storage/archives/cleanup"),
    ("POST", "/api/export/chpack"),
    ("POST", "/api/import"),
    ("POST", "/api/goon/session"),
    ("POST", "/api/goon/session/complete"),
    ("POST", "/api/goon/playlists"),
    ("POST", "/api/goon/beat-maps/analyze"),
    ("PATCH", "/api/goon/beat-maps/{id}"),
    ("POST", "/api/goon/oauth/callback"),
];

/// Maintenance owns the library exclusively while it takes a safety backup
/// and applies a recovery transaction.  Individual download routes also
/// cooperate with that mode, but this router-level gate keeps tags, groups,
/// ratings, settings, and every other mutation from racing a backup or
/// rollback through a route that was added later.
async fn maintenance_write_guard(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let mutating_method = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    if mutating_method {
        // The capability handshake currently grants Viewer read access only.
        // The TCP peer supplied by axum::serve is the authority here; a
        // caller-provided header cannot turn a Tailnet request into Host.
        if request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .is_some_and(|peer| !peer.0.ip().is_loopback())
        {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"Viewer role does not permit this operation"})),
            )
                .into_response();
        }
        // Hold a lease for the full request, rather than merely checking the
        // flag once.  This closes the otherwise unavoidable race where a
        // maintenance job starts between a middleware check and a handler's
        // SQLite write.
        let Some(_request_lease) = state.maintenance.try_acquire_background_worker() else {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "A local maintenance job is active. Try this change again when it completes."
                })),
            )
                .into_response();
        };
        return next.run(request).await;
    }
    next.run(request).await
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/music/access", get(music::access))
        .route(
            "/api/music/apple-configuration",
            get(goon::apple_configuration),
        )
        .route("/api/music/tracks", get(music::list).post(music::upload))
        .route("/api/music/import", post(music::import))
        .route(
            "/api/music/tracks/{id}/stream",
            get(music::stream).head(music::stream),
        )
        .route(
            "/api/goon/playlists/{id}",
            put(goon::update_playlist).delete(goon::delete_playlist),
        )
        .layer(axum::extract::DefaultBodyLimit::max(256 * 1024 * 1024))
        .route(
            "/api/playback-presets",
            get(playback::list).post(playback::create),
        )
        .route(
            "/api/playback-presets/{id}",
            put(playback::update).delete(playback::delete),
        )
        .route(
            "/api/playback-presets/resolve",
            get(playback::resolve_read).post(playback::resolve),
        )
        .route("/api/system/info", get(system::info))
        .route(
            "/api/admin/jobs",
            get(admin::list_jobs).post(admin::start_job),
        )
        .route("/api/admin/jobs/{id}", get(admin::get_job))
        .route(
            "/api/admin/backups",
            get(admin::list_backups).post(admin::create_backup),
        )
        .route("/api/admin/backups/{id}", get(admin::download_backup))
        .route(
            "/api/admin/backups/{id}/validate",
            post(admin::validate_backup),
        )
        .route(
            "/api/admin/backups/{id}/restore",
            post(admin::restore_backup),
        )
        .route(
            "/api/admin/phar",
            get(admin::phar_status).post(admin::phar_intent),
        )
        .route("/api/admin/phar/install", post(admin::phar_install))
        .route("/api/admin/phar/cancel", post(admin::phar_cancel))
        .route("/api/admin/phar/repair", post(admin::phar_repair))
        .route("/api/admin/phar/self-test", post(admin::phar_self_test))
        .route("/api/library/summary", get(crate::hierarchy::endpoint))
        // Shared session service: native Slint and remote/recovery clients use
        // these same typed operations, rather than owning competing clocks.
        .route("/api/session", get(session::current))
        .route("/api/session/start", post(session::start))
        .route("/api/session/command", post(session::control))
        // ── First-run OOBE ─────────────────────────────────────────────────
        // Explicit routes on "/" and "/index.html" take priority over the
        // static-file fallback_service registered in main.rs, so a
        // not-yet-configured install is handed oobe.html instead of the
        // normal app shell without needing any change to app.js's own
        // startup sequence.
        .route("/", get(oobe::serve_root))
        .route("/index.html", get(oobe::serve_root))
        .route("/api/oobe/status", get(oobe::status))
        .route("/api/oobe/validate", post(oobe::validate))
        .route("/api/oobe/settings", post(oobe::save_settings))
        .route("/api/oobe/complete", post(oobe::complete))
        .route("/api/oobe/reset", post(oobe::reset))
        // ── Media ──────────────────────────────────────────────────────────
        .route("/api/media", get(media::list))
        .route(
            "/api/media/{id}/stream",
            get(media::stream).head(media::stream),
        )
        .route("/api/media/bulk", post(media::bulk))
        .route("/api/media/{id}/clips", post(clips::create))
        .route("/api/clip-jobs/{id}", get(clips::status))
        .route("/api/media/{id}/rating", put(media::set_rating))
        .route(
            "/api/media/{id}/rating/approve",
            post(media::approve_rating),
        )
        .route("/api/media/{id}/rating/undo", post(media::undo_rating))
        .route("/api/media/{id}/duration", put(media::set_duration))
        .route("/api/media/{id}/tags", post(media::add_tag))
        .route("/api/media/{id}/tags/{tag_id}", delete(media::remove_tag))
        // ── Thumbnails ─────────────────────────────────────────────────────
        .route("/api/thumb/{id}", get(thumb::get_thumbnail))
        // ── Tags ───────────────────────────────────────────────────────────
        .route("/api/tags", get(tags::list))
        .route("/api/tags/quick", get(tags::quick))
        .route("/api/tags/{id}", delete(tags::delete_tag))
        .route(
            "/api/source-tags/review",
            get(source_tags::review_list).post(source_tags::review),
        )
        .route(
            "/api/source-tag-rules",
            get(source_tags::list_rules).post(source_tags::save_rule),
        )
        .route(
            "/api/source-tag-rules/{id}",
            delete(source_tags::delete_rule),
        )
        // ── Sources ────────────────────────────────────────────────────────
        .route("/api/sources", get(sources::list).post(sources::add))
        .route("/api/sources/resync-all", post(sources::resync_all))
        .route(
            "/api/sources/{id}",
            get(sources::get)
                .patch(sources::patch)
                .delete(sources::delete),
        )
        .route("/api/sources/{id}/group", patch(sources::set_group))
        .route("/api/sources/{id}/resync", post(sources::resync))
        .route("/api/sources/{id}/log", get(misc::source_log))
        // ── Cock Hero ──────────────────────────────────────────────────────
        .route("/api/ch/playlist", get(ch::get_playlist))
        .route("/api/ch/session", post(ch::log_session))
        .route("/api/ch/sessions", get(ch::get_sessions))
        // ── Unified discovery ───────────────────────────────────────────────
        .route("/api/search/providers", get(search::providers))
        .route("/api/search", get(search::search))
        .route("/api/search/download", post(search::download_selected))
        // ── Groups ─────────────────────────────────────────────────────────
        .route("/api/groups", get(groups::list).post(groups::create))
        .route(
            "/api/groups/{id}",
            patch(groups::update).delete(groups::delete),
        )
        .route("/api/groups/{id}/tags", post(groups::add_tag))
        .route("/api/groups/{id}/tags/{tag_id}", delete(groups::remove_tag))
        // ── Downloads ──────────────────────────────────────────────────────
        .route("/api/downloads/status", get(downloads::status))
        .route("/api/downloads/pause", post(downloads::pause))
        .route("/api/downloads/resume", post(downloads::resume))
        .route(
            "/api/downloads/sources/{id}/pause",
            post(downloads::pause_source),
        )
        .route(
            "/api/downloads/sources/{id}/resume",
            post(downloads::resume_source),
        )
        // ── Settings ───────────────────────────────────────────────────────
        .route("/api/settings", get(settings::get).patch(settings::patch))
        .route("/api/remote-access", get(remote::status))
        .route("/api/storage", get(storage::dashboard))
        .route(
            "/api/storage/sources/{id}/permit-once",
            post(storage::permit_one_sync),
        )
        .route(
            "/api/storage/sources/{id}/cleanup",
            post(storage::cleanup_source),
        )
        .route(
            "/api/storage/thumbnails/clear",
            post(storage::clear_thumbnails),
        )
        .route(
            "/api/storage/archives/cleanup",
            post(storage::cleanup_archives),
        )
        // ── Export / Import ────────────────────────────────────────────────
        .route("/api/export", get(export::export_sources))
        .route("/api/export/chpack", post(export::export_chpack))
        .route("/api/import", post(export::import_sources))
        // ── Stats / Log ────────────────────────────────────────────────────
        .route("/api/stats", get(misc::stats))
        .route("/api/log", get(misc::get_log))
        // ── AvtoHmver interactive sessions ────────────────────────────────────
        .route("/api/goon/session", post(goon::start))
        .route("/api/goon/session/complete", post(goon::complete))
        .route("/api/goon/connectors", get(goon::connector_status))
        .route(
            "/api/goon/playlists",
            get(goon::list_playlists).post(goon::save_playlist),
        )
        .route("/api/goon/beat-maps/analyze", post(goon::analyze_beat_map))
        .route("/api/goon/beat-maps/{id}", patch(goon::update_beat_map))
        .route("/api/goon/oauth/callback", post(goon::oauth_callback))
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(&state),
            maintenance_write_guard,
        ))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use std::collections::BTreeSet;
    use tower::ServiceExt;

    fn router_mutations_from_source() -> BTreeSet<(String, String)> {
        let source = include_str!("mod.rs");
        let mut routes = BTreeSet::new();
        let mut offset = 0;
        while let Some(relative) = source[offset..].find(".route(") {
            let start = offset + relative + ".route".len();
            let mut depth = 0i32;
            let mut in_string = false;
            let mut escaped = false;
            let mut end = start;
            for (relative_index, character) in source[start..].char_indices() {
                end = start + relative_index + character.len_utf8();
                if in_string {
                    if escaped {
                        escaped = false;
                    } else if character == '\\' {
                        escaped = true;
                    } else if character == '"' {
                        in_string = false;
                    }
                    continue;
                }
                match character {
                    '"' => in_string = true,
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            let block = &source[start..end];
            let first_quote = block.find('"').expect("route path opening quote");
            let rest = &block[first_quote + 1..];
            let closing_quote = rest.find('"').expect("route path closing quote");
            let path = &rest[..closing_quote];
            for (token, method) in [
                ("post(", "POST"),
                ("put(", "PUT"),
                ("patch(", "PATCH"),
                ("delete(", "DELETE"),
            ] {
                if block.contains(token) {
                    routes.insert((method.to_owned(), path.to_owned()));
                }
            }
            offset = end;
        }
        routes
    }

    fn documented_mutation_table() -> String {
        let mut rows = MUTATION_PERMISSIONS.to_vec();
        rows.sort();
        let mut output =
            String::from("| Method | Route | Host | Server | Viewer |\n|---|---|---:|---:|---:|\n");
        for permission in rows {
            output.push_str(&format!(
                "| {} | `{}` | {} | {} | {} |\n",
                permission.method,
                permission.path,
                if permission.host { "Allow" } else { "Deny" },
                if permission.server { "Allow" } else { "Deny" },
                if permission.viewer { "Allow" } else { "Deny" },
            ));
        }
        output
    }

    fn concrete_path(pattern: &str) -> String {
        pattern.replace("{tag_id}", "1").replace("{id}", "1")
    }

    #[test]
    fn every_router_mutation_has_exactly_one_permission_entry() {
        let actual = router_mutations_from_source();
        let declared = MUTATION_PERMISSIONS
            .iter()
            .map(|permission| (permission.method.to_owned(), permission.path.to_owned()))
            .collect::<BTreeSet<_>>();
        assert_eq!(
            declared.len(),
            MUTATION_PERMISSIONS.len(),
            "duplicate permission entry"
        );
        assert_eq!(
            actual, declared,
            "router mutations and permission matrix differ"
        );
    }

    #[test]
    fn permission_document_is_generated_from_the_executable_matrix() {
        // Git may check out Markdown with CRLF on Windows; compare the
        // generated table using one line ending on every platform.
        let document = include_str!("../../docs/permissions.md").replace("\r\n", "\n");
        let start_marker = "<!-- BEGIN GENERATED MUTATION MATRIX -->\n";
        let end_marker = "<!-- END GENERATED MUTATION MATRIX -->";
        let start = document.find(start_marker).expect("matrix start marker") + start_marker.len();
        let end = document[start..]
            .find(end_marker)
            .map(|offset| start + offset)
            .expect("matrix end marker");
        assert_eq!(&document[start..end], documented_mutation_table());
    }

    #[tokio::test]
    async fn every_mutating_route_enforces_the_role_matrix() {
        for (role, peer, edition) in [
            (
                crate::services::access::Role::Host,
                SocketAddr::from(([127, 0, 0, 1], 49150)),
                crate::edition::Edition::Host,
            ),
            (
                crate::services::access::Role::Server,
                SocketAddr::from(([127, 0, 0, 1], 49151)),
                crate::edition::Edition::Server,
            ),
            (
                crate::services::access::Role::Viewer,
                SocketAddr::from(([100, 64, 1, 2], 49152)),
                crate::edition::Edition::Host,
            ),
        ] {
            let root = tempfile::tempdir().unwrap();
            let original = crate::test_support::state(root.path());
            let mut role_state = (*original).clone();
            role_state.edition = edition;
            let app = build_router(Arc::new(role_state));
            for permission in MUTATION_PERMISSIONS {
                let expected = match role {
                    crate::services::access::Role::Host => permission.host,
                    crate::services::access::Role::Server => permission.server,
                    crate::services::access::Role::Viewer => permission.viewer,
                };
                let mut request = axum::http::Request::builder()
                    .method(permission.method)
                    .uri(concrete_path(permission.path))
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap();
                request.extensions_mut().insert(ConnectInfo(peer));
                let status = app.clone().oneshot(request).await.unwrap().status();
                assert_eq!(
                    status != StatusCode::FORBIDDEN,
                    expected,
                    "{} {} as {role:?} returned {status}",
                    permission.method,
                    permission.path
                );
            }
            original.server_tasks.close();
            original.server_tasks.wait().await;
        }
    }

    #[tokio::test]
    async fn tailnet_viewer_cannot_mutate_through_any_http_method() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let app = build_router(state);
        let peer = ConnectInfo(SocketAddr::from(([100, 64, 1, 2], 49152)));
        for (method, path) in [
            (Method::POST, "/api/sources"),
            (Method::PUT, "/api/media/1/rating"),
            (Method::PATCH, "/api/settings"),
            (Method::DELETE, "/api/groups/1"),
            (Method::POST, "/api/session/start"),
            (Method::POST, "/api/admin/jobs"),
        ] {
            let mut request = axum::http::Request::builder()
                .method(method)
                .uri(path)
                .body(Body::empty())
                .unwrap();
            request.extensions_mut().insert(peer);
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
        }
        let mut request = axum::http::Request::builder()
            .uri("/api/system/info")
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(peer);
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::OK
        );

        let mut local = axum::http::Request::builder()
            .method(Method::PATCH)
            .uri("/api/settings")
            .header("x-forwarded-for", "100.64.1.2")
            .body(Body::empty())
            .unwrap();
        local
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 49153))));
        assert_ne!(
            app.oneshot(local).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn maintenance_mode_rejects_all_normal_mutations() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        // Hold quiescence just long enough to prove the router cannot race a
        // queued job. The task itself uses the direct pause function, so it
        // is not blocked by this HTTP-only guard.
        state.running_sources.lock().await.insert(1);
        state
            .maintenance
            .start(
                Arc::clone(&state),
                crate::maintenance::MaintenanceRequest {
                    kind: crate::maintenance::MaintenanceKind::CreateBackup,
                    confirmation: String::new(),
                    backup_id: None,
                },
            )
            .await
            .unwrap();
        assert!(state.maintenance.is_active());

        let response = build_router(Arc::clone(&state))
            .oneshot(
                axum::http::Request::builder()
                    .method(Method::POST)
                    .uri("/api/groups")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"must wait"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        state.running_sources.lock().await.clear();
        for _ in 0..100 {
            if !state.maintenance.is_active() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(!state.maintenance.is_active());
        assert!(
            !state
                .downloads_paused
                .load(std::sync::atomic::Ordering::SeqCst),
            "a completed job must restore the prior unpaused download state"
        );
        state.server_tasks.close();
        state.server_tasks.wait().await;
    }
}
