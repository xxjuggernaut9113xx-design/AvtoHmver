//! Safe data-directory relocation for the desktop Host.
//!
//! Moving the live data directory is unsafe: the database pool, the
//! directory lock, and every background worker are open while the UI runs,
//! so a rename or a copy can capture an inconsistent SQLite/WAL snapshot
//! (and locked files refuse to move on Windows at all). Instead the UI
//! only validates the target and records a *pending* move; the app quits,
//! and the next startup applies it in `main` before `initialize_host()`
//! opens anything.

use std::path::{Path, PathBuf};

use curator::AppState;

const PENDING_FILE: &str = "pending-move.json";
const FAILED_FILE: &str = "pending-move-failed.json";

/// Validates `raw` and records a pending move in the current data
/// directory. Returns a human-readable summary. The caller must quit the
/// app immediately after `Ok`; the move itself happens on the next launch,
/// before anything opens the database.
pub fn record_pending_move(state: &AppState, raw: &str) -> Result<String, String> {
    let target = validated_target(&state.data_dir, raw)?;
    let pending = PendingMove {
        target: target.to_string_lossy().into_owned(),
    };
    let text = serde_json::to_string_pretty(&pending)
        .map_err(|error| format!("Could not encode move request: {error}"))?;
    std::fs::write(state.data_dir.join(PENDING_FILE), text)
        .map_err(|error| format!("Could not record the pending move: {error}"))?;
    Ok(format!(
        "Move scheduled to {}. The app will now close; your data moves on the next launch, before anything opens it.",
        target.display()
    ))
}

/// Shared validation: sanitize, create, canonicalize, reject
/// self/nesting, require empty, prove writable. The target directory is
/// created (still empty) so the path is reserved and writability is real.
fn validated_target(current: &Path, raw: &str) -> Result<PathBuf, String> {
    let target = sanitize_target(raw)?;
    // `AppState.data_dir` is canonicalized at startup; the candidate is
    // canonicalized after creation below, so the comparison is sound.
    if nesting_violation(current, &target) {
        return Err(
            "The new location cannot be the data directory itself, inside it, or its parent."
                .into(),
        );
    }
    std::fs::create_dir_all(&target)
        .map_err(|error| format!("Could not create {}: {error}", target.display()))?;
    let target =
        dunce::canonicalize(&target).map_err(|error| format!("Could not resolve path: {error}"))?;
    if target == current {
        return Err("That is already the data directory.".into());
    }
    if nesting_violation(current, &target) {
        return Err(
            "The new location cannot be the data directory itself, inside it, or its parent."
                .into(),
        );
    }
    ensure_empty(&target)?;
    // Writable validation: a probe file proves real write access and is
    // removed again, mirroring first-run setup's own check.
    check_writable_dir(&target)?;
    Ok(target)
}

/// Applies a pending move recorded by [`record_pending_move`]. Called from
/// `main` before `initialize_host()`, while no database pool, directory
/// lock, or background worker exists. On success the config points at the
/// new location and the pending file is gone; on failure the pending file
/// is replaced by a failure report (surfaced by the UI on launch) and the
/// app starts with the previous location.
pub fn apply_pending_move() -> anyhow::Result<()> {
    let scope = curator::edition::InstallScope::from_environment();
    let config = curator::config::load_config_for(scope);
    let current = curator::config::resolve_data_dir_for(&config, scope, None);
    let pending_path = current.join(PENDING_FILE);
    if !pending_path.is_file() {
        return Ok(());
    }
    let text = std::fs::read_to_string(&pending_path)?;
    let pending: PendingMove = serde_json::from_str(&text)?;
    let target = PathBuf::from(&pending.target);
    let result = apply_move(&current, &target, &config, scope);
    if let Err(error) = result {
        // Don't retry forever: park the error where the UI shows it once,
        // and start with the previous location.
        let _ = std::fs::remove_file(&pending_path);
        let report = FailedMove {
            target: pending.target,
            error: format!("{error:#}"),
        };
        if let Ok(text) = serde_json::to_string_pretty(&report) {
            let _ = std::fs::write(current.join(FAILED_FILE), text);
        }
        return Err(error);
    }
    Ok(())
}

fn apply_move(
    current: &Path,
    target: &Path,
    config: &curator::config::Config,
    scope: curator::edition::InstallScope,
) -> anyhow::Result<()> {
    let current = dunce::canonicalize(current)?;
    if target == current.as_path() {
        anyhow::bail!("The pending target is already the data directory.");
    }
    if nesting_violation(&current, target) {
        anyhow::bail!("The pending target nests inside the data directory or vice versa.");
    }
    // Validation created the target; drop the empty shell so the rename
    // lands cleanly on every platform.
    if target.is_dir() {
        ensure_empty(target).map_err(|error| anyhow::anyhow!("{error}"))?;
        std::fs::remove_dir(target)?;
    } else if target.exists() {
        anyhow::bail!("The pending target exists and is not a directory.");
    }
    // Prefer the atomic rename; fall back to a recursive copy when the
    // target lives on another device.
    let copied = match std::fs::rename(&current, target) {
        Ok(()) => false,
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {
            copy_dir_all(&current, target)?;
            true
        }
        Err(error) => anyhow::bail!("Could not move {}: {error}", current.display()),
    };
    // Point the next launch at the new location. The pending file moved
    // along with the directory, so it is removed from the new home.
    let mut config = config.clone();
    config.data_dir = Some(target.to_string_lossy().into_owned());
    curator::config::save_config_for(scope, &config).map_err(|error| {
        anyhow::anyhow!("Data moved, but config.json could not be updated: {error}")
    })?;
    let _ = std::fs::remove_file(target.join(PENDING_FILE));
    if copied {
        eprintln!(
            "Data directory copied to {}; the original at {} is kept as a backup — remove it yourself once the new location works.",
            target.display(),
            current.display()
        );
    }
    Ok(())
}

/// Reads and clears a failure report left by [`apply_pending_move`], so the
/// UI can show the last move error once on launch.
pub fn take_failed_move(data_dir: &Path) -> Option<String> {
    let path = data_dir.join(FAILED_FILE);
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    let report: FailedMove = serde_json::from_str(&text).ok()?;
    Some(format!(
        "The scheduled move to {} failed: {}. Your data is still at the previous location.",
        report.target, report.error
    ))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PendingMove {
    target: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct FailedMove {
    target: String,
    error: String,
}

pub(crate) fn sanitize_target(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Enter a target directory.".into());
    }
    if trimmed.contains('\0') {
        return Err("The path contains a NUL byte.".into());
    }
    if trimmed.len() > 4096 {
        return Err("The path is too long.".into());
    }
    Ok(PathBuf::from(trimmed))
}

pub(crate) fn nesting_violation(current: &Path, target: &Path) -> bool {
    target == current || target.starts_with(current) || current.starts_with(target)
}

pub(crate) fn ensure_empty(path: &Path) -> Result<(), String> {
    let mut entries = std::fs::read_dir(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    if entries.next().is_some() {
        return Err(format!(
            "{} is not empty. Choose an empty directory.",
            path.display()
        ));
    }
    Ok(())
}

pub(crate) fn check_writable_dir(path: &Path) -> Result<(), String> {
    let probe = path.join(".curator_write_test");
    std::fs::write(&probe, b"writable")
        .map_err(|error| format!("{} is not writable: {error}", path.display()))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn copy_dir_all(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let destination_path = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &destination_path)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &destination_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rejects_blank_nul_and_overlong() {
        assert!(sanitize_target("").is_err());
        assert!(sanitize_target("   ").is_err());
        assert!(sanitize_target("a\0b").is_err());
        assert!(sanitize_target(&"a".repeat(4097)).is_err());
        assert!(sanitize_target("  /tmp/data  ").is_ok());
    }

    #[test]
    fn nesting_violation_catches_self_child_and_parent() {
        let current = Path::new("/data/curator");
        assert!(nesting_violation(current, Path::new("/data/curator")));
        assert!(nesting_violation(current, Path::new("/data/curator/sub")));
        assert!(nesting_violation(current, Path::new("/data")));
        assert!(!nesting_violation(current, Path::new("/data/other")));
    }

    #[test]
    fn ensure_empty_rejects_nonempty_directories() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ensure_empty(dir.path()).is_ok());
        std::fs::write(dir.path().join("file.txt"), b"x").unwrap();
        assert!(ensure_empty(dir.path()).is_err());
    }

    #[test]
    fn check_writable_dir_probes_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        assert!(check_writable_dir(dir.path()).is_ok());
        assert!(!dir.path().join(".curator_write_test").exists());
    }

    #[test]
    fn validated_target_rejects_nesting_without_creating_anything() {
        let current = tempfile::tempdir().unwrap();
        let nested = current.path().join("sub");
        assert!(validated_target(current.path(), nested.to_str().unwrap()).is_err());
        assert!(!nested.exists());
    }
}
