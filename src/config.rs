//! `config.json` — the small, pre-database bootstrap file that decides where
//! everything else lives (`data_dir`) and which external executables AvtoHmver
//! shells out to (`gallery_dl_bin`, `python_bin`, `ffprobe_bin`).
//!
//! This file is deliberately separate from `db::Settings` (`settings.json`):
//! everything in here is read once, at process startup, before the database
//! or logging exist yet — `data_dir` in particular has to be known before
//! `Settings` can even be loaded. Changing a value here (via the OOBE
//! settings endpoint or by hand) takes effect on the *next* launch, same as
//! it always has — there is no in-process hot-reload for any of these
//! fields, so OOBE surfaces that plainly rather than pretending otherwise.
//!
//! Extracted out of `main.rs` (where this used to live as private items) so
//! `oobe.rs` can read and write the exact same file through the exact same
//! resolution rules instead of re-implementing them — see the OOBE build
//! notes: "Do not duplicate existing configuration logic."

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::edition::InstallScope;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub data_dir: Option<String>,
    pub gallery_dl_bin: Option<String>,
    pub python_bin: Option<String>,
    pub ffprobe_bin: Option<String>,
    /// ffmpeg is deliberately separate from ffprobe.  The latter is enough
    /// for the ordinary clips/videos split; sampling video frames and
    /// decoding a local soundtrack require the actual encoder binary.
    pub ffmpeg_bin: Option<String>,
    /// Legacy compatibility only. Arbitrary action-model paths are no longer
    /// launched; managed P-HAR state is configured through Local Admin.
    pub action_model_path: Option<String>,
    /// Installer/first-run intent only. Managed P-HAR setup occurs after
    /// AvtoHmver starts, never inside an OS installer transaction.
    #[serde(default)]
    pub phar_setup_requested: bool,
    /// Native P-HAR backend preference: `auto`, `cuda`, or `rocm`.
    /// Older `wsl`/`wsl2` values are migrated to `auto` by `phar`.
    #[serde(default)]
    pub phar_backend: Option<String>,
    /// Kept solely so old config files deserialize. It is cleared on the
    /// first P-HAR status/intent evaluation and must never select WSL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phar_runtime: Option<String>,
}

/// Resolve an external helper binary with install-relative lookup first:
/// `<exe-dir>/tools/<file>` is where the Windows bundle stashes ffmpeg,
/// ffprobe, mpv and the isolated gallery-dl. After that, an explicit
/// `CURATOR_<ENV_KEY>` override wins, then the configured value, then the
/// plain PATH name as a last resort.
pub fn resolve_tool_bin(configured: Option<&str>, env_key: &str, file_name: &str) -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("tools").join(file_name);
            if bundled.is_file() {
                return bundled.to_string_lossy().into_owned();
            }
        }
    }
    if let Ok(value) = env_var(&format!("CURATOR_{env_key}")) {
        if !value.trim().is_empty() {
            return value;
        }
    }
    if let Some(value) = configured.filter(|s| !s.trim().is_empty()) {
        return value.to_string();
    }
    file_name.to_string()
}

/// Platform-appropriate bundled file name for a tool (`.exe` on Windows).
pub fn tool_file_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Historical releases kept `config.json` next to the running executable.
/// Keep that as a current-user read fallback so upgrades retain a library,
/// but never use it for an all-users Server installation.
fn legacy_config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("config.json")))
        .unwrap_or_else(|| PathBuf::from("config.json"))
}

fn fresh_config_dir(scope: InstallScope) -> PathBuf {
    match scope {
        InstallScope::CurrentUser => dirs::data_local_dir()
            .or_else(dirs::data_dir)
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AvtoHmver"),
        InstallScope::AllUsers => all_users_root(),
    }
}

pub fn scoped_config_dir(scope: InstallScope) -> PathBuf {
    let fresh = fresh_config_dir(scope);
    let legacy = PathBuf::from(
        fresh
            .to_string_lossy()
            .replace("AvtoHmver", "Curator")
            .replace("avtohmver", "curator"),
    );
    select_config_dir(fresh, legacy)
}

fn select_config_dir(fresh: PathBuf, legacy: PathBuf) -> PathBuf {
    if fresh.join("config.json").is_file() || fresh.join("data.db").is_file() {
        fresh
    } else if legacy.exists() {
        legacy
    } else {
        fresh
    }
}

fn all_users_root() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
            .join("AvtoHmver")
    }
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/Library/Application Support/AvtoHmver")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        PathBuf::from("/var/lib/avtohmver")
    }
    #[cfg(not(any(windows, target_os = "macos", unix)))]
    {
        PathBuf::from("./AvtoHmver")
    }
}

pub fn config_path_for(scope: InstallScope) -> PathBuf {
    if let Some(directory) = crate::config::env_var_os("CURATOR_CONFIG_DIR") {
        return PathBuf::from(directory).join("config.json");
    }
    let scoped = scoped_config_path(scope);
    if scope == InstallScope::AllUsers || scoped.exists() || !legacy_config_path().exists() {
        scoped
    } else {
        legacy_config_path()
    }
}

/// The unambiguous scoped path. Writes use this instead of the legacy
/// compatibility fallback so an all-users migration never mutates a Host
/// config adjacent to an older executable.
pub fn scoped_config_path(scope: InstallScope) -> PathBuf {
    scoped_config_dir(scope).join("config.json")
}

pub fn load_config_for(scope: InstallScope) -> Config {
    let path = config_path_for(scope);
    if let Ok(text) = std::fs::read_to_string(path) {
        if let Ok(cfg) = serde_json::from_str::<Config>(&text) {
            return cfg;
        }
    }
    Config::default()
}

pub fn load_config() -> Config {
    load_config_for(InstallScope::from_environment())
}

/// Writes `cfg` to the scope's configuration location. Used both by the
/// first-launch bootstrap (`ensure_config_json_for`, which only ever writes
/// `data_dir` once) and by the OOBE/settings endpoints. We intentionally do
/// not write an executable-adjacent legacy config, because that could make an
/// all-users Server mutate a former current-user Host installation.
pub fn save_config_for(scope: InstallScope, cfg: &Config) -> std::io::Result<()> {
    let path = if crate::config::env_var_os("CURATOR_CONFIG_DIR").is_some() {
        config_path_for(scope)
    } else {
        scoped_config_path(scope)
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(std::io::Error::other)?;
    std::fs::write(path, text)
}

pub fn save_config(cfg: &Config) -> std::io::Result<()> {
    save_config_for(InstallScope::from_environment(), cfg)
}

pub fn default_data_dir(scope: InstallScope) -> PathBuf {
    scoped_config_dir(scope)
}

pub fn resolve_data_dir_for(
    cfg: &Config,
    scope: InstallScope,
    data_dir_override: Option<&Path>,
) -> PathBuf {
    if let Some(path) = data_dir_override {
        return path.to_path_buf();
    }
    // 1. Environment variable
    if let Ok(env_val) = crate::config::env_var("CURATOR_DATA_DIR") {
        if !env_val.is_empty() {
            return PathBuf::from(env_val);
        }
    }
    // 2. config.json data_dir
    if let Some(ref configured) = cfg.data_dir {
        if !configured.is_empty() {
            return PathBuf::from(configured);
        }
    }
    default_data_dir(scope)
}

/// First-launch bootstrap: if `config.json` doesn't exist at all yet, seed
/// it with just the resolved `data_dir` so future runs (and diagnostics
/// like `tools/diagnose_nsfw.py`, which looks for this exact file) find the
/// same place without the person ever having to hand-edit JSON. Never
/// overwrites an existing file — OOBE's settings endpoint (`save_config`)
/// is the only thing that updates an already-present config.json.
pub fn ensure_config_json_for(scope: InstallScope, data_dir: &Path) {
    let path = if crate::config::env_var_os("CURATOR_CONFIG_DIR").is_some() {
        config_path_for(scope)
    } else {
        scoped_config_path(scope)
    };
    if !path.exists() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let content = serde_json::json!({ "data_dir": data_dir.to_string_lossy() });
        let _ = std::fs::write(&path, serde_json::to_string_pretty(&content).unwrap());
    }
}

/// New product variables take precedence; historical names remain supported.
pub fn env_var_os(key: &str) -> Option<std::ffi::OsString> {
    let modern = key.replacen("CURATOR_", "AVTOHMVER_", 1);
    let legacy = key.replacen("AVTOHMVER_", "CURATOR_", 1);
    std::env::var_os(modern).or_else(|| std::env::var_os(legacy))
}
pub fn env_var(key: &str) -> Result<String, std::env::VarError> {
    env_var_os(key)
        .ok_or(std::env::VarError::NotPresent)?
        .into_string()
        .map_err(std::env::VarError::NotUnicode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_new_install_root_does_not_hide_an_existing_library() {
        let root = tempfile::tempdir().unwrap();
        let fresh = root.path().join("AvtoHmver");
        let legacy = root.path().join("Curator");
        std::fs::create_dir_all(&fresh).unwrap();
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("data.db"), b"existing").unwrap();
        assert_eq!(select_config_dir(fresh.clone(), legacy.clone()), legacy);
        std::fs::write(fresh.join("config.json"), b"{}").unwrap();
        assert_eq!(select_config_dir(fresh.clone(), legacy), fresh);
    }

    #[test]
    fn modern_environment_precedes_legacy_alias_in_both_directions() {
        let _guard = crate::PROCESS_ENV_LOCK.lock().unwrap();
        std::env::set_var("CURATOR_ALIAS_TEST", "legacy");
        std::env::set_var("AVTOHMVER_ALIAS_TEST", "modern");
        assert_eq!(env_var("CURATOR_ALIAS_TEST").unwrap(), "modern");
        assert_eq!(env_var("AVTOHMVER_ALIAS_TEST").unwrap(), "modern");
        std::env::remove_var("AVTOHMVER_ALIAS_TEST");
        assert_eq!(env_var("AVTOHMVER_ALIAS_TEST").unwrap(), "legacy");
        std::env::remove_var("CURATOR_ALIAS_TEST");
    }

    #[test]
    fn resolve_tool_bin_prefers_env_override() {
        // The bundled <exe-dir>/tools check looks next to the test binary,
        // where no tools dir exists, so the env override wins here.
        // Unique env key: sibling tests must not share process env.
        std::env::set_var("CURATOR_TEST_TOOL_XYZa", "/tmp/custom-tool");
        let got = resolve_tool_bin(Some("/cfg/tool"), "TEST_TOOL_XYZa", "tool");
        std::env::remove_var("CURATOR_TEST_TOOL_XYZa");
        assert_eq!(got, "/tmp/custom-tool");
    }

    #[test]
    fn resolve_tool_bin_falls_back_to_config_then_path_name() {
        std::env::remove_var("CURATOR_TEST_TOOL_XYZb");
        assert_eq!(
            resolve_tool_bin(Some("/cfg/tool"), "TEST_TOOL_XYZb", "tool"),
            "/cfg/tool"
        );
        assert_eq!(resolve_tool_bin(None, "TEST_TOOL_XYZb", "tool"), "tool");
        assert_eq!(
            resolve_tool_bin(Some("  "), "TEST_TOOL_XYZb", "tool"),
            "tool"
        );
    }

    #[test]
    fn resolve_data_dir_prefers_env_var_over_config() {
        let _guard = crate::PROCESS_ENV_LOCK.lock().unwrap();
        // Isolate from whatever the real environment/config might have —
        // this only asserts precedence, not the literal default path.
        std::env::set_var("CURATOR_DATA_DIR", "/tmp/curator-env-test-dir");
        let cfg = Config {
            data_dir: Some("/tmp/curator-config-test-dir".into()),
            ..Default::default()
        };
        let resolved = resolve_data_dir_for(&cfg, InstallScope::CurrentUser, None);
        std::env::remove_var("CURATOR_DATA_DIR");
        assert_eq!(resolved, PathBuf::from("/tmp/curator-env-test-dir"));
    }

    #[test]
    fn resolve_data_dir_falls_back_to_home_curator() {
        let _guard = crate::PROCESS_ENV_LOCK.lock().unwrap();
        std::env::remove_var("CURATOR_DATA_DIR");
        let cfg = Config::default();
        let resolved = resolve_data_dir_for(&cfg, InstallScope::CurrentUser, None);
        assert!(resolved.ends_with("AvtoHmver") || resolved.ends_with("Curator"));
    }
}
