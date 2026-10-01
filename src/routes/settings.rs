//! HTTP adapter for settings. Auth and local-client admission stay here;
//! the mutation logic lives in the typed [`crate::services::settings`] ops.

use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::net::SocketAddr;

use crate::services::settings::{apply_settings_patch, SettingsAudience, SettingsPatchError};
use crate::AppState;

fn is_local_client(peer: &Option<ConnectInfo<SocketAddr>>) -> bool {
    peer.as_ref().is_none_or(|peer| peer.0.ip().is_loopback())
}

fn host_integrations_available(state: &AppState, peer: &Option<ConnectInfo<SocketAddr>>) -> bool {
    is_local_client(peer) && matches!(state.edition, crate::edition::Edition::Host)
}

/// Shared with `routes::oobe` (the Appearance step reuses the exact same
/// allow-list rather than re-declaring it) — see "Do not introduce
/// conflicting configuration systems" in the OOBE build notes.
pub(crate) use crate::services::settings::VALID_THEMES;

/// Backwards-compatible name for the PATCH payload; the struct itself moved
/// to the settings service.
pub use crate::services::settings::SettingsPatch as PatchSettingsBody;

// ─── GET /api/settings ───────────────────────────────────────────────────────

pub async fn get(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
) -> Json<Value> {
    Json(crate::services::settings::read(&state, settings_audience(&peer)).await)
}

fn settings_audience(peer: &Option<ConnectInfo<SocketAddr>>) -> SettingsAudience {
    if is_local_client(peer) {
        SettingsAudience::Local
    } else {
        SettingsAudience::Remote
    }
}

// ─── PATCH /api/settings ─────────────────────────────────────────────────────

pub async fn patch(
    State(state): State<Arc<AppState>>,
    peer: super::OptionalConnectInfo,
    Json(body): Json<PatchSettingsBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_local_client(&peer)
        && (body.ffmpeg_bin.is_some()
            || body.start_with_windows.is_some()
            || body.keep_running_in_tray.is_some()
            || body.lan_access_enabled.is_some())
    {
        return Err((
            StatusCode::FORBIDDEN,
            Json(
                json!({"error":"Executable paths and local startup/tray/network controls are available only on this device."}),
            ),
        ));
    }
    if !host_integrations_available(&state, &peer)
        && (body.start_with_windows.is_some()
            || body.keep_running_in_tray.is_some()
            || body.lan_access_enabled.is_some())
    {
        return Err((
            StatusCode::FORBIDDEN,
            Json(
                json!({"error":"Startup, tray, and LAN controls are available only in the local AvtoHmver Host app."}),
            ),
        ));
    }
    apply_settings_patch(&state, settings_audience(&peer), body)
        .await
        .map(Json)
        .map_err(|error| match error {
            SettingsPatchError::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, Json(json!({"error": message})))
            }
            SettingsPatchError::Internal(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": message})),
            ),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn remote_settings_do_not_disclose_local_tool_paths() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let Json(value) = get(
            State(state),
            Some(ConnectInfo(SocketAddr::from(([100, 80, 0, 2], 42168)))).into(),
        )
        .await;
        assert!(value.get("ffmpeg_bin").is_none());
        assert_eq!(value["external_tool_settings_local_only"], true);
        assert_eq!(value["local_integration_settings_local_only"], true);
    }

    #[tokio::test]
    async fn remote_settings_cannot_change_local_integration_controls() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let body: PatchSettingsBody = serde_json::from_value(json!({
            "keep_running_in_tray": false
        }))
        .unwrap();
        let response = patch(
            State(state),
            Some(ConnectInfo(SocketAddr::from(([100, 80, 0, 2], 42168)))).into(),
            Json(body),
        )
        .await;
        assert!(matches!(response, Err((StatusCode::FORBIDDEN, _))));
    }

    #[tokio::test]
    async fn server_settings_cannot_enable_host_tray_controls() {
        let root = tempfile::tempdir().unwrap();
        let host_state = crate::test_support::state(root.path());
        let mut server_state = (*host_state).clone();
        server_state.edition = crate::edition::Edition::Server;
        let body: PatchSettingsBody = serde_json::from_value(json!({
            "start_with_windows": true
        }))
        .unwrap();
        let response = patch(State(Arc::new(server_state)), None.into(), Json(body)).await;
        assert!(matches!(response, Err((StatusCode::FORBIDDEN, _))));
    }

    #[tokio::test]
    async fn local_settings_response_surfaces_an_actionable_stale_startup_entry() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let settings = state.settings.read().await;
        let value = crate::services::settings::response(
            &state,
            SettingsAudience::Local,
            &settings,
            Some(crate::StartupRegistration {
                supported: true,
                registered: false,
                state: "stale".into(),
                message: "Windows startup points to a different AvtoHmver executable. Enable Start with Windows to repair it.".into(),
                actual_command: Some(r#""C:\\Old AvtoHmver\\AvtoHmver.exe" --background"#.into()),
                expected_command: Some(r#""C:\\AvtoHmver\\AvtoHmver.exe" --background"#.into()),
                repair_available: true,
            }),
        );
        assert_eq!(value["startup_registration"]["state"], "stale");
        assert_eq!(value["startup_registration"]["repair_available"], true);
        assert!(value["startup_registration"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("repair"));
    }

    #[tokio::test]
    async fn displayed_settings_round_trip_through_patch_and_disk() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let body: PatchSettingsBody = serde_json::from_value(serde_json::json!({
            "max_concurrent": 8,
            "keep_running_in_tray": false,
            "max_clip_length_secs": 91,
            "max_download_file_size_bytes": 50 * 1024 * 1024,
            "max_source_storage_bytes": 1024 * 1024 * 1024,
            "minimum_free_disk_bytes": 2 * 1024 * 1024,
            "thumbnail_cache_max_bytes": 3 * 1024 * 1024,
            "apply_download_limits_to_local_imports": true,
            "automatic_cleanup_mode": "low_disk",
            "automatic_cleanup_confirmation": "ENABLE AUTOMATIC CLEANUP",
            "automatic_cleanup_low_disk_bytes": 4 * 1024 * 1024,
            "archive_retention_days": 30,
            "archive_retention_confirmation": "ENABLE ARCHIVE RETENTION",
            "default_slideshow_speed": 2500.0,
            "default_slideshow_loop": false,
            "default_slideshow_shuffle": true,
            "theme": "midnight",
            "export_reminder_days": 14,
            "export_reminder_snoozed_until": "2027-01-02T00:00:00Z",
            "ch_log_sessions": true,
            "ch_default_interval": 7.5,
            "ch_default_limit": 12,
            "ch_default_shuffle": true,
            "ch_default_media_type": "video",
            "nsfw_filter_enabled": true,
            "library_layout": "table",
            "last_play_mode": "slideshow",
            "search_providers": ["local", "booru"],
            "metronome_enabled": true,
            "metronome_volume": 0.4,
            "goon_persona": "dom",
            "tts_voice": "en-US-test",
            "tts_rate": 0.1,
            "tts_pitch": 0.0,
            "tts_volume": 0.0,
            "soundtrack_provider": "spotify"
        }))
        .unwrap();
        let Json(value) = patch(State(state.clone()), None.into(), Json(body))
            .await
            .unwrap();
        assert_eq!(value["max_download_file_size_bytes"], 50 * 1024 * 1024u64);
        assert_eq!(value["max_source_storage_bytes"], 1024 * 1024 * 1024u64);
        assert_eq!(value["automatic_cleanup_mode"], "low_disk");
        assert_eq!(value["tts_rate"], 0.1);
        assert_eq!(value["tts_pitch"], 0.0);
        assert_eq!(value["tts_volume"], 0.0);
        assert_eq!(value["nsfw_restart_required"], true);
        for (field, expected) in [
            ("max_concurrent", json!(8)),
            ("keep_running_in_tray", json!(false)),
            ("max_clip_length_secs", json!(91)),
            ("minimum_free_disk_bytes", json!(2 * 1024 * 1024)),
            ("thumbnail_cache_max_bytes", json!(3 * 1024 * 1024)),
            ("apply_download_limits_to_local_imports", json!(true)),
            ("automatic_cleanup_low_disk_bytes", json!(4 * 1024 * 1024)),
            ("archive_retention_days", json!(30)),
            ("default_slideshow_speed", json!(2500.0)),
            ("default_slideshow_loop", json!(false)),
            ("default_slideshow_shuffle", json!(true)),
            ("theme", json!("midnight")),
            ("export_reminder_days", json!(14)),
            ("nsfw_filter_enabled", json!(true)),
            ("library_layout", json!("table")),
            ("metronome_enabled", json!(true)),
            ("metronome_volume", json!(0.4)),
            ("goon_persona", json!("dom")),
            ("tts_voice", json!("en-US-test")),
            ("soundtrack_provider", json!("spotify")),
        ] {
            assert_eq!(
                value[field], expected,
                "PATCH response lost displayed {field}"
            );
        }

        let persisted = crate::db::load_settings(root.path());
        assert_eq!(persisted.max_concurrent, 8);
        assert!(!persisted.keep_running_in_tray);
        assert_eq!(persisted.max_clip_length_secs, 91);
        assert_eq!(
            persisted.max_download_file_size_bytes,
            Some(50 * 1024 * 1024)
        );
        assert_eq!(persisted.max_source_storage_bytes, Some(1024 * 1024 * 1024));
        assert_eq!(persisted.minimum_free_disk_bytes, Some(2 * 1024 * 1024));
        assert_eq!(persisted.thumbnail_cache_max_bytes, Some(3 * 1024 * 1024));
        assert!(persisted.apply_download_limits_to_local_imports);
        assert_eq!(persisted.automatic_cleanup_mode, "low_disk");
        assert_eq!(
            persisted.automatic_cleanup_low_disk_bytes,
            Some(4 * 1024 * 1024)
        );
        assert_eq!(persisted.archive_retention_days, Some(30));
        assert_eq!(persisted.default_slideshow_speed, 2500.0);
        assert!(!persisted.default_slideshow_loop);
        assert!(persisted.default_slideshow_shuffle);
        assert_eq!(persisted.theme, "midnight");
        assert_eq!(persisted.export_reminder_days, 14);
        assert!(persisted.nsfw_filter_enabled);
        assert_eq!(persisted.library_layout, "table");
        assert!(persisted.metronome_enabled);
        assert_eq!(persisted.metronome_volume, 0.4);
        assert_eq!(persisted.goon_persona, "dom");
        assert_eq!(persisted.tts_voice.as_deref(), Some("en-US-test"));
        assert_eq!(persisted.tts_rate, 0.1);
        assert_eq!(persisted.tts_pitch, 0.0);
        assert_eq!(persisted.tts_volume, 0.0);
        assert_eq!(persisted.soundtrack_provider, "spotify");

        let Json(reopened) = get(State(state), None.into()).await;
        for (field, expected) in [
            ("max_download_file_size_bytes", json!(50 * 1024 * 1024u64)),
            ("max_source_storage_bytes", json!(1024 * 1024 * 1024u64)),
            ("minimum_free_disk_bytes", json!(2 * 1024 * 1024)),
            ("thumbnail_cache_max_bytes", json!(3 * 1024 * 1024)),
            ("automatic_cleanup_mode", json!("low_disk")),
            ("default_slideshow_speed", json!(2500.0)),
            ("theme", json!("midnight")),
            ("nsfw_filter_enabled", json!(true)),
            ("goon_persona", json!("dom")),
            ("tts_voice", json!("en-US-test")),
            ("soundtrack_provider", json!("spotify")),
        ] {
            assert_eq!(
                reopened[field], expected,
                "GET after persistence lost {field}"
            );
        }
    }

    #[tokio::test]
    async fn saving_a_thumbnail_limit_evicts_derived_cache_immediately() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let cached = state.thumbs_dir.join("1.jpg");
        std::fs::write(&cached, vec![7; 16]).unwrap();

        let body: PatchSettingsBody =
            serde_json::from_value(json!({"thumbnail_cache_max_bytes": 8})).unwrap();
        let Json(value) = patch(State(state.clone()), None.into(), Json(body))
            .await
            .unwrap();

        assert_eq!(value["thumbnail_cache_max_bytes"], 8);
        assert!(
            !cached.exists(),
            "a saved cap must be enforced now, not deferred until another thumbnail request"
        );
    }

    #[tokio::test]
    async fn destructive_cleanup_policies_require_server_side_confirmation() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());

        let missing_cleanup_confirmation: PatchSettingsBody =
            serde_json::from_value(json!({"automatic_cleanup_mode": "weekly"})).unwrap();
        assert!(matches!(
            patch(
                State(state.clone()),
                None.into(),
                Json(missing_cleanup_confirmation)
            )
            .await,
            Err((StatusCode::BAD_REQUEST, _))
        ));

        let enabled_cleanup: PatchSettingsBody = serde_json::from_value(json!({
            "automatic_cleanup_mode": "weekly",
            "automatic_cleanup_confirmation": "ENABLE AUTOMATIC CLEANUP"
        }))
        .unwrap();
        assert!(
            patch(State(state.clone()), None.into(), Json(enabled_cleanup))
                .await
                .is_ok()
        );

        let missing_archive_confirmation: PatchSettingsBody =
            serde_json::from_value(json!({"archive_retention_days": 30})).unwrap();
        assert!(matches!(
            patch(
                State(state.clone()),
                None.into(),
                Json(missing_archive_confirmation)
            )
            .await,
            Err((StatusCode::BAD_REQUEST, _))
        ));

        let enabled_archive: PatchSettingsBody = serde_json::from_value(json!({
            "archive_retention_days": 30,
            "archive_retention_confirmation": "ENABLE ARCHIVE RETENTION"
        }))
        .unwrap();
        assert!(patch(State(state), None.into(), Json(enabled_archive))
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn tts_boundaries_are_accepted_and_invalid_values_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        for (field, value) in [
            ("tts_rate", 0.09),
            ("tts_rate", 3.01),
            ("tts_pitch", -0.01),
            ("tts_pitch", 2.01),
            ("tts_volume", -0.01),
            ("tts_volume", 1.01),
        ] {
            let payload = match field {
                "tts_rate" => serde_json::json!({"tts_rate": value}),
                "tts_pitch" => serde_json::json!({"tts_pitch": value}),
                _ => serde_json::json!({"tts_volume": value}),
            };
            let body: PatchSettingsBody = serde_json::from_value(payload).unwrap();
            let response = patch(State(state.clone()), None.into(), Json(body)).await;
            assert!(
                matches!(response, Err((StatusCode::BAD_REQUEST, _))),
                "{field}={value}"
            );
        }
        for payload in [
            serde_json::json!({"tts_rate": 0.1}),
            serde_json::json!({"tts_rate": 3.0}),
            serde_json::json!({"tts_pitch": 0.0}),
            serde_json::json!({"tts_pitch": 2.0}),
            serde_json::json!({"tts_volume": 0.0}),
            serde_json::json!({"tts_volume": 1.0}),
        ] {
            let body: PatchSettingsBody = serde_json::from_value(payload).unwrap();
            assert!(patch(State(state.clone()), None.into(), Json(body))
                .await
                .is_ok());
        }
    }

    #[tokio::test]
    async fn service_errors_map_to_the_legacy_status_codes_and_shapes() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let body: PatchSettingsBody = serde_json::from_value(json!({"theme": "bogus"})).unwrap();
        let Err((status, Json(value))) = patch(State(state), None.into(), Json(body)).await else {
            panic!("invalid theme must be rejected");
        };
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({"error": "Unknown theme: bogus"}));
    }
}
