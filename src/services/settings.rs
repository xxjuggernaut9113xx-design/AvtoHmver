//! Settings reads and typed PATCH operations shared by native Host and
//! the Server HTTP adapter.
//! Local integration details are available only to a client on the library
//! device; a Tailnet Viewer never receives executable paths.

use std::sync::Arc;

use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use tokio::sync::Semaphore;

use crate::{config::Config, db::Settings, edition::Edition, AppState, StartupRegistration};

/// Accepted persistent theme names shared by Server validation and native
/// device preferences. Legacy names remain valid for existing libraries.
pub const VALID_THEMES: &[&str] = &[
    "system",
    "atelier-dark",
    "midnight",
    "ember",
    "linen",
    "sage",
    "aurora",
    "oled",
    "gtk-system",
    "adwaita-light",
    "adwaita-dark",
    "yaru-light",
    "yaru-dark",
    "arc-light",
    "arc-dark",
    "breeze-light",
    "breeze-dark",
    "yotsuba",
    "yotsuba-b",
    "futaba",
    "burichan",
    "tomorrow",
    "photon",
    "light",
    "oled-dark",
    "dark",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsAudience {
    Local,
    Remote,
}

impl SettingsAudience {
    fn is_local(self) -> bool {
        matches!(self, Self::Local)
    }
}

pub async fn read(state: &AppState, audience: SettingsAudience) -> Value {
    // The local Host verifies its startup entry on every open. A persisted
    // preference alone cannot tell whether the entry points at this binary.
    let startup = if audience.is_local() && matches!(state.edition, Edition::Host) {
        Some(crate::reconcile_start_with_windows_preference(state).await)
    } else {
        None
    };
    let settings = state.settings.read().await;
    response(state, audience, &settings, startup)
}

pub fn response(
    state: &AppState,
    audience: SettingsAudience,
    settings: &Settings,
    startup: Option<StartupRegistration>,
) -> Value {
    let config = crate::config::load_config_for(state.install_scope);
    response_with_config(state, audience, settings, startup, &config)
}

/// Variant of [`response`] that reuses an already-loaded bootstrap config.
/// PATCH loads `config.json` once for the ffmpeg block; reloading it here
/// would be a redundant disk read and JSON parse for every settings write.
fn response_with_config(
    state: &AppState,
    audience: SettingsAudience,
    settings: &Settings,
    startup: Option<StartupRegistration>,
    config: &Config,
) -> Value {
    let mut value = serde_json::to_value(settings).unwrap_or_default();
    if let Some(object) = value.as_object_mut() {
        let local = audience.is_local() && state.edition.owns_library();
        let host_integrations = local && matches!(state.edition, Edition::Host);
        object.insert(
            "host_integration_settings_available".into(),
            json!(host_integrations),
        );
        if local {
            object.insert(
                "ffmpeg_bin".into(),
                json!(config.ffmpeg_bin.clone().unwrap_or_else(|| "ffmpeg".into())),
            );
            object.insert(
                "external_tool_settings_restart_required".into(),
                json!(true),
            );
            if let Some(startup) = startup {
                object.insert("startup_registration".into(), json!(startup));
            }
        } else {
            object.insert("external_tool_settings_local_only".into(), json!(true));
            object.insert("local_integration_settings_local_only".into(), json!(true));
        }
    }
    value
}

// ─── Typed PATCH ─────────────────────────────────────────────────────────────

// `Option<Option<T>>` normally cannot distinguish a missing JSON property
// from an explicit `null`. Settings uses that distinction for optional byte
// limits: null means "Unlimited", while omission means "leave unchanged".
fn deserialize_nullable_u64<'de, D>(deserializer: D) -> Result<Option<Option<u64>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<u64>::deserialize(deserializer)?))
}

fn deserialize_nullable_u32<'de, D>(deserializer: D) -> Result<Option<Option<u32>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<u32>::deserialize(deserializer)?))
}

fn normalize_optional_bytes(value: Option<u64>) -> Option<u64> {
    value.filter(|value| *value > 0)
}

fn normalize_optional_days(value: Option<u32>) -> Result<Option<u32>, &'static str> {
    match value {
        None | Some(0) => Ok(None),
        Some(value) if value <= 36_500 => Ok(Some(value)),
        Some(_) => Err("Archive retention must be at most 36,500 days"),
    }
}

/// The complete PATCH /api/settings payload. Field groups are applied by the
/// typed `apply_*` operations below in the exact order the legacy inline
/// handler used, so validation precedence and partial-application semantics
/// are unchanged.
#[derive(Debug, Deserialize)]
pub struct SettingsPatch {
    pub start_with_windows: Option<bool>,
    pub keep_running_in_tray: Option<bool>,
    /// Opt-in LAN wildcard listener; takes effect on the next listener
    /// refresh (within seconds) without a restart.
    pub lan_access_enabled: Option<bool>,
    pub max_clip_length_secs: Option<u32>,
    pub goon_default_limit: Option<u32>,
    pub goon_log_sessions: Option<bool>,
    pub max_concurrent: Option<u32>,
    #[serde(default, deserialize_with = "deserialize_nullable_u64")]
    pub max_download_file_size_bytes: Option<Option<u64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_u64")]
    pub max_source_storage_bytes: Option<Option<u64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_u64")]
    pub minimum_free_disk_bytes: Option<Option<u64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_u64")]
    pub thumbnail_cache_max_bytes: Option<Option<u64>>,
    pub apply_download_limits_to_local_imports: Option<bool>,
    pub automatic_cleanup_mode: Option<String>,
    /// A browser confirmation is repeated at the API boundary so a direct
    /// PATCH cannot silently arm deletion of existing originals.
    pub automatic_cleanup_confirmation: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_u64")]
    pub automatic_cleanup_low_disk_bytes: Option<Option<u64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_u32")]
    pub archive_retention_days: Option<Option<u32>>,
    /// Archive deletion is separately acknowledged because clearing the
    /// gallery-dl archive can make old posts eligible on a later sync.
    pub archive_retention_confirmation: Option<String>,
    pub default_slideshow_speed: Option<f64>,
    pub default_slideshow_loop: Option<bool>,
    pub default_slideshow_shuffle: Option<bool>,
    pub theme: Option<String>,
    pub export_reminder_days: Option<u32>,
    pub export_reminder_snoozed_until: Option<String>,
    // Cock Hero settings
    pub ch_log_sessions: Option<bool>,
    pub ch_default_interval: Option<f64>,
    pub ch_default_limit: Option<u32>,
    pub ch_default_shuffle: Option<bool>,
    pub ch_default_media_type: Option<String>,
    // NSFW auto-rating
    pub nsfw_filter_enabled: Option<bool>,
    pub library_layout: Option<String>,
    pub last_play_mode: Option<String>,
    pub search_providers: Option<Vec<String>>,
    pub metronome_enabled: Option<bool>,
    pub metronome_volume: Option<f64>,
    pub goon_persona: Option<String>,
    pub tts_voice: Option<String>,
    pub tts_rate: Option<f64>,
    pub tts_pitch: Option<f64>,
    pub tts_volume: Option<f64>,
    pub soundtrack_provider: Option<String>,
    /// Bootstrap settings live in config.json because they are consumed
    /// before the database is opened. They are exposed here for the normal
    /// Settings UI but intentionally take effect on the next launch.
    pub ffmpeg_bin: Option<String>,
}

/// Service-level PATCH failure. The HTTP adapter maps these to the same
/// status codes and `{"error": message}` shapes the inline handler produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsPatchError {
    BadRequest(String),
    Internal(String),
}

/// Applies a validated settings PATCH: bootstrap integrations (config.json,
/// Windows Run registration), the typed field-group mutations, persistence,
/// and the LAN-listener / thumbnail-cache side effects. Returns the same
/// settings response document the GET handler produces.
pub async fn apply_settings_patch(
    state: &Arc<AppState>,
    audience: SettingsAudience,
    patch: SettingsPatch,
) -> Result<Value, SettingsPatchError> {
    let thumbnail_cache_limit_changed = patch.thumbnail_cache_max_bytes.is_some();
    // Borrow rather than clone the current settings: validation only needs
    // two fields, and the write lock below re-reads everything anyway.
    {
        let current = state.settings.read().await;
        validate_patch(&patch, &current)?;
    }
    // Load config.json once and share it with the response builder instead
    // of reading and parsing the file a second time below.
    let mut config = crate::config::load_config_for(state.install_scope);
    let ffmpeg_changed = apply_bootstrap_integrations(state, &patch, &mut config).await?;

    let mut settings = state.settings.write().await;
    let lan_mode_before = settings.lan_access_enabled;
    apply_integrations(&patch, &mut settings);
    apply_download_limits(state, &patch, &mut settings).await;
    apply_cleanup_policies(&patch, &mut settings)?;
    apply_slideshow_defaults(&patch, &mut settings);
    apply_appearance(&patch, &mut settings)?;
    apply_session_features(&patch, &mut settings)?;
    apply_search_providers(&patch, &mut settings)?;
    apply_audio(&patch, &mut settings)?;

    if ffmpeg_changed {
        settings.ffmpeg_restart_required = true;
    }
    // A cache limit is an explicit opt-in to evict derived artifacts. Apply
    // it before confirming the PATCH so Settings does not misleadingly show
    // a ceiling that will only be enforced on some later thumbnail request
    // or automatic-cleanup timer tick. Removing the limit remains
    // non-destructive and therefore does not trim anything.
    let thumbnail_cache_limit_to_enforce = if thumbnail_cache_limit_changed {
        settings.thumbnail_cache_max_bytes
    } else {
        None
    };
    let response = response_with_config(state, audience, &settings, None, &config);
    let lan_mode_changed = lan_mode_before != settings.lan_access_enabled;
    crate::db::save_settings(&state.data_dir, &settings);
    drop(settings);
    if lan_mode_changed {
        crate::remote::refresh_lan_listener(state).await;
    }
    if let Some(limit) = thumbnail_cache_limit_to_enforce {
        let thumbs_dir = state.thumbs_dir.clone();
        match tokio::task::spawn_blocking(move || {
            crate::storage::trim_thumbnail_cache(&thumbs_dir, limit)
        })
        .await
        {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => tracing::warn!("Could not enforce thumbnail cache limit: {error}"),
            Err(error) => tracing::warn!("Thumbnail cache limiter did not complete: {error}"),
        }
    }
    Ok(response)
}

/// Pre-mutation validation. The complete request is validated before the
/// Windows Run entry, config.json, or the in-memory settings value change,
/// so a malformed multi-control PATCH cannot partially apply the controls
/// that happened to appear before its invalid field.
fn validate_patch(patch: &SettingsPatch, current: &Settings) -> Result<(), SettingsPatchError> {
    let bad = SettingsPatchError::BadRequest;
    if let Some(value) = patch.ffmpeg_bin.as_deref() {
        let value = value.trim();
        if value.is_empty() || value.len() > 4096 || value.contains('\0') {
            return Err(bad("Invalid ffmpeg executable".to_string()));
        }
    }
    if let Some(value) = patch.automatic_cleanup_mode.as_deref() {
        if !["never", "low_disk", "weekly"].contains(&value) {
            return Err(bad(
                "Automatic cleanup must be Never, low disk, or weekly".to_string()
            ));
        }
    }
    if let Some(value) = patch.archive_retention_days.flatten() {
        normalize_optional_days(Some(value)).map_err(|error| bad(error.to_string()))?;
    }
    if let Some(value) = patch.theme.as_deref() {
        if !VALID_THEMES.contains(&value) {
            return Err(bad(format!("Unknown theme: {value}")));
        }
    }
    if let Some(value) = patch.library_layout.as_deref() {
        if !["grid", "table"].contains(&value) {
            return Err(bad("Library layout must be grid or table".to_string()));
        }
    }
    if let Some(value) = patch.last_play_mode.as_deref() {
        if !matches!(
            value,
            "feed" | "mobile-feed" | "slideshow" | "portrait" | "portrait-wall" | "review" | "goon"
        ) {
            return Err(bad("Unknown playback mode".to_string()));
        }
    }
    if let Some(values) = patch.search_providers.as_ref() {
        if values.len() > 64
            || values.iter().any(|raw| {
                let provider = raw.trim().to_ascii_lowercase();
                provider.is_empty()
                    || provider.len() > 80
                    || !provider.bytes().all(|b| {
                        b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_'
                    })
            })
        {
            return Err(bad("Invalid search provider selection".to_string()));
        }
    }
    if let Some(value) = patch.metronome_volume {
        if !value.is_finite() {
            return Err(bad("Invalid metronome volume".to_string()));
        }
    }
    if let Some(value) = patch.goon_persona.as_deref() {
        if !["neutral", "mommy", "dom", "brat"].contains(&value) {
            return Err(bad("Unknown GOON persona".to_string()));
        }
    }
    if let Some(value) = patch.tts_rate {
        if !value.is_finite() || !(0.1..=3.0).contains(&value) {
            return Err(bad("TTS rate must be between 0.1 and 3.0".to_string()));
        }
    }
    if let Some(value) = patch.tts_pitch {
        if !value.is_finite() || !(0.0..=2.0).contains(&value) {
            return Err(bad("TTS pitch must be between 0 and 2.0".to_string()));
        }
    }
    if let Some(value) = patch.tts_volume {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(bad("TTS volume must be between 0 and 1.0".to_string()));
        }
    }
    if let Some(value) = patch.soundtrack_provider.as_deref() {
        if !["local", "youtube", "soundcloud", "apple_music", "spotify"].contains(&value) {
            return Err(bad("Unknown soundtrack provider".to_string()));
        }
    }
    let cleanup_mode = patch
        .automatic_cleanup_mode
        .as_deref()
        .unwrap_or(&current.automatic_cleanup_mode);
    let cleanup_threshold = patch
        .automatic_cleanup_low_disk_bytes
        .map(normalize_optional_bytes)
        .unwrap_or(current.automatic_cleanup_low_disk_bytes);
    if cleanup_mode == "low_disk" && cleanup_threshold.is_none() {
        return Err(bad(
            "Choose a low-disk cleanup threshold before enabling automatic cleanup".to_string(),
        ));
    }
    if current.automatic_cleanup_mode == "never"
        && cleanup_mode != "never"
        && patch.automatic_cleanup_confirmation.as_deref() != Some("ENABLE AUTOMATIC CLEANUP")
    {
        return Err(bad(
            "Type ENABLE AUTOMATIC CLEANUP before enabling automatic cleanup.".to_string(),
        ));
    }
    if current.archive_retention_days.is_none()
        && patch
            .archive_retention_days
            .flatten()
            .is_some_and(|days| days > 0)
        && patch.archive_retention_confirmation.as_deref() != Some("ENABLE ARCHIVE RETENTION")
    {
        return Err(bad(
            "Type ENABLE ARCHIVE RETENTION before enabling archive age cleanup.".to_string(),
        ));
    }
    Ok(())
}

/// Bootstrap integrations that live outside settings.json: the config.json
/// ffmpeg path and the Windows Run registration. Returns whether the ffmpeg
/// path changed. Runs before the settings write lock is taken.
async fn apply_bootstrap_integrations(
    state: &Arc<AppState>,
    patch: &SettingsPatch,
    config: &mut Config,
) -> Result<bool, SettingsPatchError> {
    let mut ffmpeg_changed = false;
    if let Some(value) = patch.ffmpeg_bin.as_deref() {
        let value = value.trim();
        ffmpeg_changed = config.ffmpeg_bin.as_deref().unwrap_or("ffmpeg") != value;
        config.ffmpeg_bin = Some(value.to_string());
        crate::config::save_config_for(state.install_scope, config).map_err(|error| {
            SettingsPatchError::Internal(format!("Could not save external tool settings: {error}"))
        })?;
    }
    if let Some(enabled) = patch.start_with_windows {
        crate::set_start_with_windows_preference(state, enabled)
            .await
            .map_err(SettingsPatchError::BadRequest)?;
    }
    Ok(ffmpeg_changed)
}

/// Local device integrations stored in settings.json: tray and LAN listener.
fn apply_integrations(patch: &SettingsPatch, settings: &mut Settings) {
    if let Some(value) = patch.keep_running_in_tray {
        settings.keep_running_in_tray = value;
    }
    if let Some(value) = patch.lan_access_enabled {
        settings.lan_access_enabled = value;
    }
}

/// Download sizing limits and concurrency. Swaps the download semaphore so
/// future downloads use the new limit.
async fn apply_download_limits(
    state: &Arc<AppState>,
    patch: &SettingsPatch,
    settings: &mut Settings,
) {
    if let Some(value) = patch.max_clip_length_secs {
        settings.max_clip_length_secs = value.clamp(5, 3600);
    }
    if let Some(value) = patch.goon_default_limit {
        settings.goon_default_limit = value.clamp(1, 10_000);
    }
    if let Some(value) = patch.goon_log_sessions {
        settings.goon_log_sessions = value;
    }
    if let Some(value) = patch.max_concurrent {
        let value = value.clamp(1, 20);
        settings.max_concurrent = value;
        // Swap the semaphore so future downloads use the new limit
        let mut sem_guard = state.download_semaphore.lock().await;
        *sem_guard = Arc::new(Semaphore::new(value as usize));
    }
    if let Some(value) = patch.max_download_file_size_bytes {
        settings.max_download_file_size_bytes = normalize_optional_bytes(value);
    }
    if let Some(value) = patch.max_source_storage_bytes {
        settings.max_source_storage_bytes = normalize_optional_bytes(value);
    }
    if let Some(value) = patch.minimum_free_disk_bytes {
        settings.minimum_free_disk_bytes = normalize_optional_bytes(value);
    }
    if let Some(value) = patch.thumbnail_cache_max_bytes {
        settings.thumbnail_cache_max_bytes = normalize_optional_bytes(value);
    }
    if let Some(value) = patch.apply_download_limits_to_local_imports {
        settings.apply_download_limits_to_local_imports = value;
    }
}

/// Automatic cleanup and archive retention. The mode allow-list and the
/// retention bound are re-checked here because the pre-mutation pass runs
/// before the write lock; the checks are idempotent for valid input.
fn apply_cleanup_policies(
    patch: &SettingsPatch,
    settings: &mut Settings,
) -> Result<(), SettingsPatchError> {
    let bad = SettingsPatchError::BadRequest;
    if let Some(value) = patch.automatic_cleanup_mode.clone() {
        if !["never", "low_disk", "weekly"].contains(&value.as_str()) {
            return Err(bad(
                "Automatic cleanup must be Never, low disk, or weekly".to_string()
            ));
        }
        settings.automatic_cleanup_mode = value;
    }
    if let Some(value) = patch.automatic_cleanup_low_disk_bytes {
        settings.automatic_cleanup_low_disk_bytes = normalize_optional_bytes(value);
    }
    if let Some(value) = patch.archive_retention_days {
        settings.archive_retention_days =
            normalize_optional_days(value).map_err(|error| bad(error.to_string()))?;
    }
    if settings.automatic_cleanup_mode == "low_disk"
        && settings.automatic_cleanup_low_disk_bytes.is_none()
    {
        return Err(bad(
            "Choose a low-disk cleanup threshold before enabling automatic cleanup".to_string(),
        ));
    }
    Ok(())
}

fn apply_slideshow_defaults(patch: &SettingsPatch, settings: &mut Settings) {
    if let Some(value) = patch.default_slideshow_speed {
        settings.default_slideshow_speed = value.clamp(500.0, 60000.0);
    }
    if let Some(value) = patch.default_slideshow_loop {
        settings.default_slideshow_loop = value;
    }
    if let Some(value) = patch.default_slideshow_shuffle {
        settings.default_slideshow_shuffle = value;
    }
}

/// Theme, export reminders, and library layout.
fn apply_appearance(
    patch: &SettingsPatch,
    settings: &mut Settings,
) -> Result<(), SettingsPatchError> {
    let bad = SettingsPatchError::BadRequest;
    if let Some(theme) = patch.theme.clone() {
        if !VALID_THEMES.contains(&theme.as_str()) {
            return Err(bad(format!("Unknown theme: {theme}")));
        }
        settings.theme = theme;
    }
    if let Some(value) = patch.export_reminder_days {
        settings.export_reminder_days = value.clamp(1, 365);
    }
    if let Some(value) = patch.export_reminder_snoozed_until.clone() {
        settings.export_reminder_snoozed_until = if value.is_empty() { None } else { Some(value) };
    }
    if let Some(value) = patch.library_layout.clone() {
        if !["grid", "table"].contains(&value.as_str()) {
            return Err(bad("Library layout must be grid or table".to_string()));
        }
        settings.library_layout = value;
    }
    Ok(())
}

/// Cock Hero defaults, the NSFW auto-rating toggle, and the remembered
/// playback mode. `mobile-feed` normalizes to `feed`.
fn apply_session_features(
    patch: &SettingsPatch,
    settings: &mut Settings,
) -> Result<(), SettingsPatchError> {
    if let Some(value) = patch.ch_log_sessions {
        settings.ch_log_sessions = value;
    }
    if let Some(value) = patch.ch_default_interval {
        settings.ch_default_interval = value;
    }
    if let Some(value) = patch.ch_default_limit {
        settings.ch_default_limit = value;
    }
    if let Some(value) = patch.ch_default_shuffle {
        settings.ch_default_shuffle = value;
    }
    if let Some(value) = patch.ch_default_media_type.clone() {
        settings.ch_default_media_type = value;
    }
    if let Some(value) = patch.nsfw_filter_enabled {
        if settings.nsfw_filter_enabled != value {
            settings.nsfw_restart_required = true;
        }
        settings.nsfw_filter_enabled = value;
    }
    if let Some(value) = patch.last_play_mode.clone() {
        let normalized = match value.as_str() {
            "feed" | "mobile-feed" => "feed",
            "slideshow" | "portrait" | "portrait-wall" | "review" | "goon" => value.as_str(),
            _ => {
                return Err(SettingsPatchError::BadRequest(
                    "Unknown playback mode".to_string(),
                ));
            }
        };
        settings.last_play_mode = normalized.to_string();
    }
    Ok(())
}

/// Search provider selection. A local catalog is always available; keeping
/// it in the durable list makes the selection explicit while still avoiding
/// an empty search experience after a user unticks every remote provider.
fn apply_search_providers(
    patch: &SettingsPatch,
    settings: &mut Settings,
) -> Result<(), SettingsPatchError> {
    let bad = SettingsPatchError::BadRequest;
    if let Some(values) = patch.search_providers.clone() {
        if values.len() > 64 {
            return Err(bad("Choose at most 64 search providers".to_string()));
        }
        let mut providers = Vec::new();
        for raw in values {
            let provider = raw.trim().to_ascii_lowercase();
            if provider.is_empty()
                || provider.len() > 80
                || !provider
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
            {
                return Err(bad("Invalid search provider id".to_string()));
            }
            if !providers.contains(&provider) {
                providers.push(provider);
            }
        }
        if !providers.iter().any(|id| id == "local") {
            providers.insert(0, "local".to_string());
        }
        settings.search_providers = providers;
    }
    Ok(())
}

/// Metronome, GOON persona, TTS, and soundtrack provider.
fn apply_audio(patch: &SettingsPatch, settings: &mut Settings) -> Result<(), SettingsPatchError> {
    let bad = SettingsPatchError::BadRequest;
    if let Some(value) = patch.metronome_enabled {
        settings.metronome_enabled = value;
    }
    if let Some(value) = patch.metronome_volume {
        if !value.is_finite() {
            return Err(bad("Invalid metronome volume".to_string()));
        }
        settings.metronome_volume = value.clamp(0.0, 1.0);
    }
    if let Some(value) = patch.goon_persona.clone() {
        if !["neutral", "mommy", "dom", "brat"].contains(&value.as_str()) {
            return Err(bad("Unknown GOON persona".to_string()));
        }
        settings.goon_persona = value;
    }
    if let Some(value) = patch.tts_voice.clone() {
        let voice = value.trim();
        settings.tts_voice = if voice.is_empty() {
            None
        } else {
            Some(voice.chars().take(160).collect())
        };
    }
    if let Some(value) = patch.tts_rate {
        if !value.is_finite() || !(0.1..=3.0).contains(&value) {
            return Err(bad("TTS rate must be between 0.1 and 3.0".to_string()));
        }
        settings.tts_rate = value;
    }
    if let Some(value) = patch.tts_pitch {
        if !value.is_finite() || !(0.0..=2.0).contains(&value) {
            return Err(bad("TTS pitch must be between 0 and 2.0".to_string()));
        }
        settings.tts_pitch = value;
    }
    if let Some(value) = patch.tts_volume {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(bad("TTS volume must be between 0 and 1.0".to_string()));
        }
        settings.tts_volume = value;
    }
    if let Some(value) = patch.soundtrack_provider.clone() {
        if !["local", "youtube", "soundcloud", "apple_music", "spotify"].contains(&value.as_str()) {
            return Err(bad("Unknown soundtrack provider".to_string()));
        }
        settings.soundtrack_provider = value;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{ConnectInfo, State};
    use std::net::SocketAddr;

    fn patch_from(json: serde_json::Value) -> SettingsPatch {
        serde_json::from_value(json).unwrap()
    }

    #[tokio::test]
    async fn direct_host_and_http_settings_reads_agree() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let direct = read(&state, SettingsAudience::Local).await;
        let http = crate::routes::settings::get(State(state.clone()), None.into())
            .await
            .0;
        assert_eq!(direct, http);
        assert_eq!(direct["host_integration_settings_available"], true);
        assert!(direct["ffmpeg_bin"].is_string());
    }

    #[tokio::test]
    async fn direct_remote_and_http_settings_reads_hide_local_paths() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let direct = read(&state, SettingsAudience::Remote).await;
        let http = crate::routes::settings::get(
            State(state),
            Some(ConnectInfo(SocketAddr::from(([100, 80, 0, 2], 42168)))).into(),
        )
        .await
        .0;
        assert_eq!(direct, http);
        assert!(direct.get("ffmpeg_bin").is_none());
        assert_eq!(direct["host_integration_settings_available"], false);
        assert_eq!(direct["external_tool_settings_local_only"], true);
    }

    #[tokio::test]
    async fn server_local_settings_do_not_offer_host_integrations() {
        let root = tempfile::tempdir().unwrap();
        let host = crate::test_support::state(root.path());
        let mut server = (*host).clone();
        server.edition = Edition::Server;
        let value = read(&Arc::new(server), SettingsAudience::Local).await;
        assert_eq!(value["host_integration_settings_available"], false);
    }

    #[tokio::test]
    async fn viewer_cannot_claim_local_settings_audience() {
        let root = tempfile::tempdir().unwrap();
        let host = crate::test_support::state(root.path());
        let mut viewer = (*host).clone();
        viewer.edition = Edition::Viewer;
        let value = read(&viewer, SettingsAudience::Local).await;
        assert!(value.get("ffmpeg_bin").is_none());
        assert_eq!(value["host_integration_settings_available"], false);
    }

    #[tokio::test]
    async fn validate_patch_rejects_every_invalid_field_with_its_message() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let current = state.settings.read().await.clone();
        for (payload, message) in [
            (json!({"theme": "nope"}), "Unknown theme: nope"),
            (
                json!({"automatic_cleanup_mode": "sometimes"}),
                "Automatic cleanup must be Never, low disk, or weekly",
            ),
            (
                json!({"library_layout": "masonry"}),
                "Library layout must be grid or table",
            ),
            (json!({"last_play_mode": "vibes"}), "Unknown playback mode"),
            (
                json!({"search_providers": ["BAD PROVIDER!"]}),
                "Invalid search provider selection",
            ),
            (json!({"goon_persona": "villain"}), "Unknown GOON persona"),
            (
                json!({"tts_rate": 9.9}),
                "TTS rate must be between 0.1 and 3.0",
            ),
            (
                json!({"tts_pitch": 9.9}),
                "TTS pitch must be between 0 and 2.0",
            ),
            (
                json!({"tts_volume": 9.9}),
                "TTS volume must be between 0 and 1.0",
            ),
            (
                json!({"soundtrack_provider": "napster"}),
                "Unknown soundtrack provider",
            ),
            (json!({"ffmpeg_bin": ""}), "Invalid ffmpeg executable"),
        ] {
            let patch = patch_from(payload);
            assert_eq!(
                validate_patch(&patch, &current),
                Err(SettingsPatchError::BadRequest(message.to_string())),
                "payload rejected with wrong message"
            );
        }
    }

    #[tokio::test]
    async fn validate_patch_enforces_destructive_confirmations() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let current = state.settings.read().await.clone();
        // low_disk without a threshold
        let patch = patch_from(json!({"automatic_cleanup_mode": "low_disk"}));
        assert!(matches!(
            validate_patch(&patch, &current),
            Err(SettingsPatchError::BadRequest(_))
        ));
        // cleanup arming without the typed confirmation
        let patch = patch_from(json!({"automatic_cleanup_mode": "weekly"}));
        assert_eq!(
            validate_patch(&patch, &current),
            Err(SettingsPatchError::BadRequest(
                "Type ENABLE AUTOMATIC CLEANUP before enabling automatic cleanup.".to_string()
            ))
        );
        // archive retention without its own confirmation
        let patch = patch_from(json!({"archive_retention_days": 30}));
        assert_eq!(
            validate_patch(&patch, &current),
            Err(SettingsPatchError::BadRequest(
                "Type ENABLE ARCHIVE RETENTION before enabling archive age cleanup.".to_string()
            ))
        );
        // confirmations satisfy validation
        let patch = patch_from(json!({
            "automatic_cleanup_mode": "weekly",
            "automatic_cleanup_confirmation": "ENABLE AUTOMATIC CLEANUP",
            "archive_retention_days": 30,
            "archive_retention_confirmation": "ENABLE ARCHIVE RETENTION",
        }));
        assert!(validate_patch(&patch, &current).is_ok());
    }

    #[test]
    fn nullable_byte_limits_distinguish_null_from_omission() {
        let patch: SettingsPatch =
            serde_json::from_value(json!({"max_download_file_size_bytes": null})).unwrap();
        assert_eq!(patch.max_download_file_size_bytes, Some(None));
        let patch: SettingsPatch = serde_json::from_value(json!({})).unwrap();
        assert_eq!(patch.max_download_file_size_bytes, None);
        let patch: SettingsPatch =
            serde_json::from_value(json!({"max_download_file_size_bytes": 1024})).unwrap();
        assert_eq!(patch.max_download_file_size_bytes, Some(Some(1024)));
        assert_eq!(normalize_optional_bytes(Some(0)), None);
        assert_eq!(normalize_optional_bytes(Some(7)), Some(7));
        assert!(normalize_optional_days(Some(36_501)).is_err());
        assert_eq!(normalize_optional_days(Some(0)).unwrap(), None);
    }

    #[tokio::test]
    async fn apply_download_limits_clamps_and_swaps_the_semaphore() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let mut settings = state.settings.read().await.clone();
        let patch = patch_from(json!({
            "max_clip_length_secs": 99_999,
            "goon_default_limit": 0,
            "max_concurrent": 99,
            "max_download_file_size_bytes": 0,
            "thumbnail_cache_max_bytes": 4096,
        }));
        apply_download_limits(&state, &patch, &mut settings).await;
        assert_eq!(settings.max_clip_length_secs, 3600);
        assert_eq!(settings.goon_default_limit, 1);
        assert_eq!(settings.max_concurrent, 20);
        assert_eq!(settings.max_download_file_size_bytes, None);
        assert_eq!(settings.thumbnail_cache_max_bytes, Some(4096));
        assert_eq!(
            state.download_semaphore.lock().await.available_permits(),
            20
        );
    }

    #[tokio::test]
    async fn apply_appearance_validates_theme_and_layout() {
        let mut settings = Settings::default();
        let patch = patch_from(json!({"theme": "bogus"}));
        assert!(matches!(
            apply_appearance(&patch, &mut settings),
            Err(SettingsPatchError::BadRequest(_))
        ));
        let patch = patch_from(json!({
            "theme": "midnight",
            "library_layout": "table",
            "export_reminder_days": 500,
            "export_reminder_snoozed_until": "",
        }));
        apply_appearance(&patch, &mut settings).unwrap();
        assert_eq!(settings.theme, "midnight");
        assert_eq!(settings.library_layout, "table");
        assert_eq!(settings.export_reminder_days, 365);
        assert_eq!(settings.export_reminder_snoozed_until, None);
    }

    #[test]
    fn apply_session_features_normalizes_play_mode_and_flags_nsfw_restart() {
        let mut settings = Settings::default();
        let patch = patch_from(json!({
            "last_play_mode": "mobile-feed",
            "nsfw_filter_enabled": true,
            "ch_default_media_type": "video",
        }));
        apply_session_features(&patch, &mut settings).unwrap();
        assert_eq!(settings.last_play_mode, "feed");
        assert!(settings.nsfw_restart_required);
        assert_eq!(settings.ch_default_media_type, "video");
        let patch = patch_from(json!({"last_play_mode": "unknown"}));
        assert_eq!(
            apply_session_features(&patch, &mut settings),
            Err(SettingsPatchError::BadRequest(
                "Unknown playback mode".to_string()
            ))
        );
    }

    #[test]
    fn apply_search_providers_dedupes_and_keeps_local_first() {
        let mut settings = Settings::default();
        let patch = patch_from(json!({"search_providers": ["Booru", "booru", "kemono"]}));
        apply_search_providers(&patch, &mut settings).unwrap();
        assert_eq!(settings.search_providers, vec!["local", "booru", "kemono"]);
        let patch = patch_from(json!({"search_providers": ["local"]}));
        apply_search_providers(&patch, &mut settings).unwrap();
        assert_eq!(settings.search_providers, vec!["local"]);
        let many: Vec<String> = (0..65).map(|i| format!("provider{i}")).collect();
        let patch = patch_from(json!({"search_providers": many}));
        assert!(matches!(
            apply_search_providers(&patch, &mut settings),
            Err(SettingsPatchError::BadRequest(_))
        ));
    }

    #[test]
    fn apply_audio_validates_bounds_and_trims_voice() {
        let mut settings = Settings::default();
        let patch = patch_from(json!({
            "metronome_volume": 7.0,
            "tts_voice": "  en-US-test  ",
            "tts_rate": 1.5,
        }));
        apply_audio(&patch, &mut settings).unwrap();
        assert_eq!(settings.metronome_volume, 1.0);
        assert_eq!(settings.tts_voice.as_deref(), Some("en-US-test"));
        // NaN cannot arrive over JSON; construct the patch directly.
        let base = patch_from(json!({}));
        let patch = SettingsPatch {
            metronome_volume: Some(f64::NAN),
            ..base
        };
        assert!(matches!(
            apply_audio(&patch, &mut settings),
            Err(SettingsPatchError::BadRequest(_))
        ));
        let patch = patch_from(json!({"tts_voice": "   "}));
        apply_audio(&patch, &mut settings).unwrap();
        assert_eq!(settings.tts_voice, None);
    }

    #[tokio::test]
    async fn apply_cleanup_policies_rejects_low_disk_without_threshold() {
        let mut settings = Settings::default();
        let patch = patch_from(json!({"automatic_cleanup_mode": "low_disk"}));
        assert!(matches!(
            apply_cleanup_policies(&patch, &mut settings),
            Err(SettingsPatchError::BadRequest(_))
        ));
        let patch = patch_from(json!({
            "automatic_cleanup_mode": "low_disk",
            "automatic_cleanup_low_disk_bytes": 1024,
            "archive_retention_days": 0,
        }));
        apply_cleanup_policies(&patch, &mut settings).unwrap();
        assert_eq!(settings.automatic_cleanup_mode, "low_disk");
        assert_eq!(settings.automatic_cleanup_low_disk_bytes, Some(1024));
        assert_eq!(settings.archive_retention_days, None);
    }
}
