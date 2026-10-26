//! Same-PC staging. Only the managed package is invalidated; sources are never deleted.
use crate::{
    chpack::{build_chpack_cancellable, copy_cancellable, ExportRow},
    AppState,
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
pub struct StagingStatus {
    pub id: String,
    pub phase: String,
    pub path: Option<String>,
    pub error: Option<String>,
}

struct StagingJob {
    status: StagingStatus,
    cancel: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
pub struct StagingJobs {
    job: std::sync::Mutex<Option<StagingJob>>,
}

impl StagingJobs {
    pub fn status(&self) -> Option<StagingStatus> {
        let mut slot = self.job.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(job) = slot.as_mut() {
            if job.status.phase == "complete"
                && job
                    .status
                    .path
                    .as_ref()
                    .is_some_and(|path| !Path::new(path).is_file())
            {
                job.status.phase = "invalidated".into();
                job.status.path = None;
                job.status.error = Some(
                    "Sources changed or managed staging was removed. Stage the library again."
                        .into(),
                );
            }
        }
        slot.as_ref().map(|job| job.status.clone())
    }

    pub fn cancel(&self, id: &str) -> bool {
        let mut slot = self.job.lock().unwrap_or_else(|error| error.into_inner());
        let Some(job) = slot.as_mut().filter(|job| job.status.id == id) else {
            return false;
        };
        if matches!(job.status.phase.as_str(), "running" | "cancelling") {
            job.cancel.store(true, std::sync::atomic::Ordering::Release);
            job.status.phase = "cancelling".into();
        }
        true
    }

    pub fn start(state: &Arc<AppState>) -> Result<StagingStatus> {
        anyhow::ensure!(
            state.edition.owns_library(),
            "Viewer cannot stage local packages"
        );
        anyhow::ensure!(!state.shutdown.is_cancelled(), "AvtoHmver is shutting down");
        let _admission = state
            .maintenance
            .try_acquire_background_worker()
            .context("A maintenance job is active")?;
        let mut slot = state
            .linked_staging
            .job
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        anyhow::ensure!(
            !slot
                .as_ref()
                .is_some_and(|job| matches!(job.status.phase.as_str(), "running" | "cancelling")),
            "Package staging is already running"
        );
        let status = StagingStatus {
            id: format!("{:032x}", rand::random::<u128>()),
            phase: "running".into(),
            path: None,
            error: None,
        };
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        *slot = Some(StagingJob {
            status: status.clone(),
            cancel: cancel.clone(),
        });
        let state = state.clone();
        let id = status.id.clone();
        state.clone().download_tasks.spawn(async move {
            let result = stage_with_cancel(&state, cancel.clone()).await;
            let mut slot = state
                .linked_staging
                .job
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if let Some(job) = slot.as_mut().filter(|job| job.status.id == id) {
                // A completed archive is committed even if Cancel races with completion.
                // Never report a committed package as an abandoned partial write.
                match result {
                    Ok(path) => {
                        job.status.phase = "complete".into();
                        job.status.path = Some(path.to_string_lossy().into_owned());
                    }
                    Err(error) => {
                        job.status.phase = if cancel.load(std::sync::atomic::Ordering::Acquire)
                            || state.shutdown.is_cancelled()
                        {
                            "cancelled"
                        } else {
                            "failed"
                        }
                        .into();
                        job.status.error = Some(error.to_string());
                    }
                }
            }
        });
        Ok(status)
    }
}

#[derive(Serialize, Deserialize)]
struct Source {
    path: PathBuf,
    link: String,
    identity: (u64, u64),
    size: u64,
    modified_ns: u128,
}

fn identity(path: &Path) -> Result<(u64, u64)> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let file = fs::File::open(path)?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(), &mut info) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok((
            info.dwVolumeSerialNumber.into(),
            (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        ))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::metadata(path)?;
        Ok((metadata.dev(), metadata.ino()))
    }
    #[cfg(not(any(windows, unix)))]
    {
        anyhow::bail!(
            "Linked staging is unsupported on this platform: {}",
            path.display()
        )
    }
}

fn stamp(path: &Path) -> Result<(u64, u128)> {
    let metadata = fs::metadata(path)?;
    anyhow::ensure!(metadata.is_file(), "Source is not a regular file");
    Ok((
        metadata.len(),
        metadata.modified()?.duration_since(UNIX_EPOCH)?.as_nanos(),
    ))
}

fn stage_root(library: &Path) -> Result<PathBuf> {
    let root = library.join(".avtohmver-linked-packages");
    fs::create_dir_all(&root)?;
    anyhow::ensure!(
        !fs::symlink_metadata(&root)?.file_type().is_symlink(),
        "Linked package root must not be a symbolic link"
    );
    Ok(root)
}

fn build(library: &Path, rows: Vec<ExportRow>, cancelled: impl Fn() -> bool) -> Result<PathBuf> {
    anyhow::ensure!(!cancelled(), "Package staging cancelled");
    anyhow::ensure!(!rows.is_empty(), "No downloaded images or videos to stage");
    let canonical_library = fs::canonicalize(library)?;
    let root = stage_root(library)?;
    let staging = tempfile::Builder::new()
        .prefix("package-")
        .tempdir_in(&root)?;
    let building_lease = fs::File::create(staging.path().join(".building.lock"))?;
    fs4::FileExt::try_lock(&building_lease).context("locking package staging")?;
    fs::create_dir(staging.path().join("media"))?;
    let mut sources = Vec::new();
    let mut staged = Vec::new();
    for (index, row) in rows.into_iter().enumerate() {
        anyhow::ensure!(!cancelled(), "Package staging cancelled");
        let original = library.join(&row.filepath);
        let source = fs::canonicalize(&original)
            .with_context(|| format!("Source unavailable: {}", row.filepath))?;
        anyhow::ensure!(
            source.starts_with(&canonical_library),
            "Package source must remain inside the library"
        );
        let (size, modified_ns) = stamp(&source)?;
        let source_identity = identity(&source)?;
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        anyhow::ensure!(
            extension.bytes().all(|byte| byte.is_ascii_alphanumeric()),
            "Unsupported source extension"
        );
        let link = format!("media/{index}.{extension}");
        let target = staging.path().join(&link);
        fs::hard_link(&source, &target).with_context(|| format!(
            "Could not link {}. Linked staging requires source and staging files on the same volume; use portable export for other volumes", source.display()))?;
        anyhow::ensure!(
            identity(&target)? == source_identity && stamp(&source)? == (size, modified_ns),
            "Source changed while staging"
        );
        sources.push(Source {
            path: original,
            link: link.clone(),
            identity: source_identity,
            size,
            modified_ns,
        });
        staged.push(ExportRow {
            filepath: link,
            ..row
        });
    }
    let package = build_chpack_cancellable(
        "AvtoHmver linked staging".into(),
        "AvtoHmver".into(),
        "Managed same-PC package; invalidated when its sources move, disappear, or change.".into(),
        0,
        staged,
        staging.path(),
        &cancelled,
    )?;
    anyhow::ensure!(!cancelled(), "Package staging cancelled");
    let path = staging.path().join("package.chpack");
    copy_cancellable(
        fs::File::open(package.path())?,
        fs::File::create(&path)?,
        &cancelled,
    )?;
    // Validate after ZIP creation too: an encode/export may take a long time.
    anyhow::ensure!(
        sources_valid(staging.path(), &sources),
        "Source changed during package creation"
    );
    fs::write(
        staging.path().join("links.json"),
        serde_json::to_vec_pretty(&sources)?,
    )?;
    anyhow::ensure!(!cancelled(), "Package staging cancelled");
    let _ = staging.keep();
    Ok(path)
}

fn sources_valid(package: &Path, sources: &[Source]) -> bool {
    !sources.is_empty()
        && sources.iter().all(|source| {
            let relative = Path::new(&source.link);
            let safe = relative
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)));
            safe && identity(&source.path).ok() == Some(source.identity)
                && identity(&package.join(relative)).ok() == Some(source.identity)
                && stamp(&source.path).ok() == Some((source.size, source.modified_ns))
        })
}

/// Removes only generated containers immediately below our managed root.
pub fn invalidate_changed(library: &Path) -> Result<usize> {
    let root = library.join(".avtohmver-linked-packages");
    if !root.exists() {
        return Ok(0);
    }
    anyhow::ensure!(
        !fs::symlink_metadata(&root)?.file_type().is_symlink(),
        "Linked package root must not be a symbolic link"
    );
    let mut removed = 0;
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with("package-")
            || !entry.file_type()?.is_dir()
        {
            continue;
        }
        let directory = entry.path();
        let metadata = directory.join("links.json");
        let marker = directory.join(".building.lock");
        let owned = marker.is_file();
        if owned {
            let Ok(lease) = fs::OpenOptions::new().read(true).write(true).open(&marker) else {
                continue;
            };
            if fs4::FileExt::try_lock(&lease).is_err() {
                continue;
            }
            // The grace interval also protects the create-then-lock handoff.
            if !metadata.is_file()
                && lease.metadata()?.modified()?.elapsed().unwrap_or_default()
                    < Duration::from_secs(60)
            {
                continue;
            }
        }
        if !metadata.is_file() {
            if owned {
                fs::remove_dir_all(&directory).context("removing abandoned partial package")?;
                removed += 1;
            }
            continue;
        }
        let sources: Vec<Source> = match fs::read(&metadata)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        {
            Some(sources) => sources,
            None => {
                tracing::warn!(path = %directory.display(), "Invalid linked package metadata");
                if owned {
                    fs::remove_dir_all(&directory).context("removing corrupt managed package")?;
                    removed += 1;
                }
                continue;
            }
        };
        if !sources_valid(&directory, &sources) {
            fs::remove_dir_all(&directory).context("removing invalid generated linked package")?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub async fn stage(state: &Arc<AppState>) -> Result<PathBuf> {
    stage_with_cancel(state, Arc::new(std::sync::atomic::AtomicBool::new(false))).await
}

pub async fn stage_with_cancel(
    state: &Arc<AppState>,
    cancel: Arc<std::sync::atomic::AtomicBool>,
) -> Result<PathBuf> {
    anyhow::ensure!(
        state.edition.owns_library(),
        "Linked staging is available only to a local library owner"
    );
    anyhow::ensure!(!state.shutdown.is_cancelled(), "AvtoHmver is shutting down");
    let lease = state
        .maintenance
        .try_acquire_background_worker()
        .context("A maintenance job is active")?;
    let rows = {
        let connection = state.pool.get()?;
        let mut statement = connection.prepare(
            "SELECT m.filepath,m.type,m.rating,(SELECT GROUP_CONCAT(t.name,',') FROM media_tags mt JOIN tags t ON t.id=mt.tag_id WHERE mt.media_id=m.id) FROM media m WHERE m.downloaded=1 AND m.clip_start_secs IS NULL AND m.type IN ('image','video','gif','clip') AND m.missing=0 AND m.retention_deleted=0 ORDER BY m.id")?;
        let rows = statement
            .query_map([], |row| {
                let tags: Option<String> = row.get(3)?;
                Ok(ExportRow {
                    filepath: row.get(0)?,
                    kind: row.get(1)?,
                    rating: row.get(2)?,
                    tags: tags
                        .unwrap_or_default()
                        .split(',')
                        .filter(|tag| !tag.is_empty())
                        .map(str::to_owned)
                        .collect(),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    let library = state.library_dir.clone();
    let shutdown = state.shutdown.clone();
    tokio::task::spawn_blocking(move || {
        let _lease = lease;
        build(&library, rows, || {
            shutdown.is_cancelled() || cancel.load(std::sync::atomic::Ordering::Relaxed)
        })
    })
    .await?
}

pub(crate) fn start_monitor(state: &AppState) {
    if !state.edition.owns_library() {
        return;
    }
    let monitor = state.clone();
    state.download_tasks.spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                _ = monitor.shutdown.cancelled() => break,
                _ = interval.tick() => {
                    let Some(lease) = monitor.maintenance.try_acquire_background_worker() else { continue; };
                    let library = monitor.library_dir.clone();
                    match tokio::task::spawn_blocking(move || { let _lease = lease; invalidate_changed(&library) }).await {
                        Ok(Ok(count)) if count > 0 => tracing::info!(count, "Invalidated linked packages whose sources changed"),
                        Ok(Err(error)) => tracing::warn!(%error, "Linked package validation failed"),
                        Err(error) => tracing::warn!(%error, "Linked package validator stopped"),
                        _ => {}
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edition::Edition;

    #[test]
    fn abandoned_owned_staging_is_reclaimed_only_after_its_build_lease_is_released() {
        let root = tempfile::tempdir().unwrap();
        let directory = stage_root(root.path())
            .unwrap()
            .join("package-abandoned-test");
        fs::create_dir(&directory).unwrap();
        let lease = fs::File::create(directory.join(".building.lock")).unwrap();
        lease
            .set_modified(std::time::SystemTime::now() - Duration::from_secs(61))
            .unwrap();
        fs4::FileExt::try_lock(&lease).unwrap();
        fs::write(directory.join("partial.chpack"), b"incomplete").unwrap();
        assert_eq!(invalidate_changed(root.path()).unwrap(), 0);
        assert!(directory.exists());
        drop(lease);
        assert_eq!(invalidate_changed(root.path()).unwrap(), 1);
        assert!(!directory.exists());
    }
    #[test]
    fn cancelling_during_archive_copy_cleans_links_and_keeps_original() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        fs::write(&source, vec![42u8; 512 * 1024]).unwrap();
        let checks = std::cell::Cell::new(0);
        let result = build(root.path(), vec![row("source.png")], || {
            checks.set(checks.get() + 1);
            checks.get() >= 5
        });
        assert!(result.unwrap_err().to_string().contains("cancelled"));
        assert_eq!(fs::metadata(&source).unwrap().len(), 512 * 1024);
        assert_eq!(
            fs::read_dir(stage_root(root.path()).unwrap())
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn replacement_at_the_same_path_invalidates_by_identity() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        fs::write(&source, b"same bytes").unwrap();
        let package = build(root.path(), vec![row("source.png")], || false).unwrap();
        fs::remove_file(&source).unwrap();
        fs::write(&source, b"same bytes").unwrap();
        assert_eq!(invalidate_changed(root.path()).unwrap(), 1);
        assert!(!package.exists());
        assert_eq!(fs::read(source).unwrap(), b"same bytes");
    }
    fn row(path: &str) -> ExportRow {
        ExportRow {
            filepath: path.into(),
            kind: "image".into(),
            rating: 2,
            tags: vec!["sample".into()],
        }
    }
    #[test]
    fn linked_staging_rejects_sources_outside_library_without_touching_them() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir(&library).unwrap();
        let original = root.path().join("outside.png");
        fs::write(&original, b"original").unwrap();
        let error = build(&library, vec![row("../outside.png")], || false).unwrap_err();
        assert!(error.to_string().contains("inside the library"));
        assert_eq!(fs::read(original).unwrap(), b"original");
        assert_eq!(
            fs::read_dir(stage_root(&library).unwrap()).unwrap().count(),
            0
        );
    }
    #[test]
    fn linked_package_round_trip_and_move_invalidation_never_delete_sources() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("source.png"), b"source bytes").unwrap();
        let package = build(root.path(), vec![row("source.png")], || false).unwrap();
        let portable = root.path().join("portable.chpack");
        fs::copy(&package, &portable).unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(&package).unwrap()).unwrap();
        assert_eq!(zip.by_name("media/0_medium_sample.png").unwrap().size(), 12);
        let manifest: serde_json::Value =
            serde_json::from_reader(zip.by_name("manifest.json").unwrap()).unwrap();
        assert_eq!(manifest["version"], "0.02a");
        assert_eq!(invalidate_changed(root.path()).unwrap(), 0);
        drop(zip);
        fs::rename(
            root.path().join("source.png"),
            root.path().join("moved.png"),
        )
        .unwrap();
        assert_eq!(invalidate_changed(root.path()).unwrap(), 1);
        assert!(!package.exists());
        assert!(portable.exists());
        assert_eq!(
            fs::read(root.path().join("moved.png")).unwrap(),
            b"source bytes"
        );
    }
    #[test]
    fn modified_sources_and_missing_inputs_fail_safely() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("source.png"), b"first").unwrap();
        let package = build(root.path(), vec![row("source.png")], || false).unwrap();
        fs::write(root.path().join("source.png"), b"changed bytes").unwrap();
        assert_eq!(invalidate_changed(root.path()).unwrap(), 1);
        assert!(!package.exists());
        assert_eq!(
            fs::read(root.path().join("source.png")).unwrap(),
            b"changed bytes"
        );
        assert!(build(root.path(), vec![row("missing.png")], || false).is_err());
        assert!(build(root.path(), vec![row("source.png")], || true).is_err());
        assert_eq!(
            fs::read_dir(stage_root(root.path()).unwrap())
                .unwrap()
                .count(),
            0
        );
    }
    #[tokio::test]
    async fn library_owners_can_stage_and_viewer_and_shutdown_are_denied() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let mut server = (*state).clone();
        server.edition = Edition::Server;
        assert!(stage(&Arc::new(server))
            .await
            .unwrap_err()
            .to_string()
            .contains("No downloaded"));
        let mut viewer = (*state).clone();
        viewer.edition = Edition::Viewer;
        assert!(stage(&Arc::new(viewer))
            .await
            .unwrap_err()
            .to_string()
            .contains("local library owner"));
        let mut host = (*state).clone();
        host.edition = Edition::Host;
        host.shutdown.cancel();
        assert!(stage(&Arc::new(host))
            .await
            .unwrap_err()
            .to_string()
            .contains("shutting down"));
    }
}
