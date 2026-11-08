//! Native, managed P-HAR installation state.
//!
//! P-HAR is deliberately isolated below `data_dir/phar`. This module never
//! accepts WSL or an arbitrary Python executable. State is durable JSON, so a
//! Local Admin request can resume safely after AvtoHmver restarts.

use crate::edition::InstallScope;
use anyhow::{anyhow, Result};
use ring::digest::{Context, SHA256};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    thread,
};

pub const MANIFEST_FORMAT: &str = "curator-phar-manifest-v3";
pub const UPSTREAM_REPOSITORY: &str = "https://github.com/rlleshi/phar.git";
pub const UPSTREAM_REVISION: &str = "94adf9900cd36360795709d920b44404f29bad3e";
const STATE_FILE: &str = "state.json";
const MANIFEST_FILE: &str = "manifest.json";
const RUNTIME_FILE: &str = "runtime.json";
const CANCEL_FILE: &str = "cancel.requested";
static JOB_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static STATE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// `auto` prefers compatible CUDA and then compatible ROCm. WSL is accepted
/// only as an old config migration value and is never a runtime selection.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PharBackend {
    Auto,
    Cuda,
    Rocm,
}
impl PharBackend {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("cuda") => Self::Cuda,
            Some("rocm") => Self::Rocm,
            _ => Self::Auto,
        }
    }
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Cuda => "cuda",
            Self::Rocm => "rocm",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PharSupportTier {
    Supported,
    Unavailable,
}
#[derive(Debug, Clone, Serialize)]
pub struct PharSupport {
    pub tier: PharSupportTier,
    pub backend: &'static str,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DetectedGpu {
    pub backend: PharBackend,
    pub name: String,
    pub driver: Option<String>,
    pub compatible: bool,
    pub detail: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    Windows,
    MacOs,
    Other,
}
pub const fn current_platform() -> Platform {
    #[cfg(target_os = "linux")]
    {
        Platform::Linux
    }
    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }
    #[cfg(target_os = "macos")]
    {
        Platform::MacOs
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Platform::Other
    }
}
pub const fn default_backend(_: Platform) -> PharBackend {
    PharBackend::Auto
}
pub fn support_for(platform: Platform, backend: PharBackend) -> PharSupport {
    let backend = backend.as_str();
    match platform {
        Platform::Windows | Platform::Linux => PharSupport {
            tier: PharSupportTier::Supported,
            backend,
            detail: "Managed RGB assets install independently of hardware; native inference availability is validated separately.".into(),
        },
        Platform::MacOs => PharSupport {
            tier: PharSupportTier::Unavailable,
            backend,
            detail: "Native P-HAR CUDA/ROCm installation is unavailable on macOS.".into(),
        },
        Platform::Other => PharSupport {
            tier: PharSupportTier::Unavailable,
            backend,
            detail: "Native P-HAR is not supported on this platform.".into(),
        },
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PharManifest {
    pub format: &'static str,
    pub upstream_repository: &'static str,
    pub upstream_revision: &'static str,
    pub source_archive: &'static str,
    pub checkpoints: Vec<CheckpointManifest>,
}
#[derive(Debug, Clone, Serialize)]
pub struct CheckpointManifest {
    pub id: &'static str,
    pub source_url: &'static str,
    pub bytes: Option<u64>,
    pub sha256: Option<&'static str>,
    pub license: &'static str,
    pub release_asset_id: u64,
    pub checksum_origin: &'static str,
}
/// Exact bytes measured from the official release; not a publisher signature.
pub fn pinned_manifest() -> PharManifest {
    PharManifest {
        format: MANIFEST_FORMAT,
        upstream_repository: UPSTREAM_REPOSITORY,
        upstream_revision: UPSTREAM_REVISION,
        source_archive: "https://github.com/rlleshi/phar/archive/94adf9900cd36360795709d920b44404f29bad3e.tar.gz",
        checkpoints: vec![CheckpointManifest {
            id: "p-har-timesformer",
            source_url: "https://github.com/rlleshi/phar/releases/download/v1.0.0/timeSformer.pth",
            bytes: Some(970_440_477),
            sha256: Some("184163c9c527113432dc6bfb639e1e604614186d243a6006016772455024378f"),
            license: "Apache-2.0 (official repository LICENSE); checkpoint fetched on demand",
            release_asset_id: 68_193_860,
            checksum_origin: "Measured from official release asset on 2026-11-07; see docs/parity/evidence/phar-rgb-asset.md",
        }],
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PharPhase {
    Disabled,
    Requested,
    Detecting,
    ProvisioningRuntime,
    FetchingSource,
    InstallingDependencies,
    DownloadingModels,
    Verifying,
    Probing,
    AssetsReady,
    Ready,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize)]
pub struct PharStatus {
    pub requested: bool,
    pub ready: bool,
    pub phase: PharPhase,
    pub progress_percent: u8,
    pub backend: PharBackend,
    pub detected_gpu: Option<DetectedGpu>,
    pub support: PharSupport,
    pub message: String,
    pub actionable_error: Option<String>,
    pub job_id: Option<String>,
    pub repair_required: bool,
    pub manifest_revision: &'static str,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
struct PersistedState {
    phase: PharPhase,
    progress_percent: u8,
    message: String,
    #[serde(default)]
    actionable_error: Option<String>,
    #[serde(default)]
    detected_gpu: Option<DetectedGpu>,
    #[serde(default)]
    job_id: Option<String>,
    #[serde(default)]
    repair_required: bool,
}

pub fn environment_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("phar")
}
fn staging_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("phar.staging")
}
fn manifest_path(data_dir: &Path) -> PathBuf {
    environment_dir(data_dir).join(MANIFEST_FILE)
}
fn state_path(data_dir: &Path) -> PathBuf {
    environment_dir(data_dir).join(STATE_FILE)
}
fn cancel_path(data_dir: &Path) -> PathBuf {
    environment_dir(data_dir).join(CANCEL_FILE)
}

pub fn ensure_manifest(data_dir: &Path) -> Result<()> {
    let path = manifest_path(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&pinned_manifest())?)?;
    Ok(())
}

/// Normalizes a legacy `phar_runtime: wsl2` config immediately to `auto`.
fn configured_backend(scope: InstallScope) -> PharBackend {
    let mut cfg = crate::config::load_config_for(scope);
    let legacy = cfg.phar_runtime.take();
    let selected = cfg.phar_backend.clone().or(legacy.clone());
    let backend = PharBackend::parse(selected.as_deref());
    if cfg.phar_backend.as_deref() != Some(backend.as_str()) || legacy.is_some() {
        cfg.phar_backend = Some(backend.as_str().into());
        let _ = crate::config::save_config_for(scope, &cfg);
    }
    backend
}
fn read_state(data_dir: &Path) -> Option<PersistedState> {
    std::fs::read_to_string(state_path(data_dir))
        .ok()
        .and_then(|v| serde_json::from_str(&v).ok())
}
fn write_state(data_dir: &Path, state: PersistedState) -> Result<()> {
    ensure_manifest(data_dir)?;
    let path = state_path(data_dir);
    // Progress and Cancel may write concurrently. A shared .new name would
    // let either writer rename the other's file or fail with NotFound.
    let temporary = path.with_extension(format!(
        "json.{}.{}.new",
        std::process::id(),
        STATE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&temporary, serde_json::to_vec_pretty(&state)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}
fn new_state(phase: PharPhase, percent: u8, message: impl Into<String>) -> PersistedState {
    PersistedState {
        phase,
        progress_percent: percent,
        message: message.into(),
        actionable_error: None,
        detected_gpu: None,
        job_id: None,
        repair_required: false,
    }
}

pub fn status(data_dir: &Path, scope: InstallScope) -> PharStatus {
    let cfg = crate::config::load_config_for(scope);
    let legacy_wsl = cfg
        .phar_runtime
        .as_deref()
        .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "wsl" | "wsl2"));
    let backend = configured_backend(scope);
    let support = support_for(current_platform(), backend);
    let mut current = read_state(data_dir).unwrap_or_else(|| {
        if cfg.phar_setup_requested {
            new_state(
                PharPhase::Requested,
                0,
                "P-HAR setup was requested; choose Install / resume when ready.",
            )
        } else {
            new_state(
                PharPhase::Disabled,
                0,
                "P-HAR is opt-in and currently disabled.",
            )
        }
    });
    if legacy_wsl {
        current.repair_required = true;
        current.message = "Legacy WSL P-HAR preference migrated to native auto-detection. Run Repair to validate native files; old files stay until explicit cleanup.".into();
        let _ = write_state(data_dir, current.clone());
    }
    let ready = cfg.phar_setup_requested
        && current.phase == PharPhase::Ready
        && runtime_is_verified(data_dir);
    if current.phase == PharPhase::Ready && !ready {
        current.phase = PharPhase::Failed;
        current.repair_required = true;
        current.actionable_error =
            Some("Ready marker is incomplete or not using a managed P-HAR interpreter.".into());
    }
    if current.phase == PharPhase::AssetsReady
        && std::fs::metadata(checkpoint_path(data_dir))
            .map(|meta| meta.len())
            .ok()
            != pinned_manifest().checkpoints[0].bytes
    {
        current.phase = PharPhase::Failed;
        current.repair_required = true;
        current.actionable_error =
            Some("Installed RGB checkpoint is missing or incomplete. Run Repair.".into());
    }
    // The durable marker is authoritative, including when a late progress or
    // completion write races the Cancel state snapshot. Only an explicit
    // resume holding the job lock may clear it.
    if !cfg.phar_setup_requested {
        current.phase = PharPhase::Disabled;
        current.progress_percent = 0;
        current.message =
            "P-HAR is disabled. Managed files remain until explicit P-HAR cleanup.".into();
        current.actionable_error = None;
        current.repair_required = false;
    } else if cancelled(data_dir) {
        current.phase = PharPhase::Cancelled;
        current.progress_percent = 0;
        current.message =
            "P-HAR setup was cancelled. Choose Install / resume or Repair to continue.".into();
        current.actionable_error = None;
        current.repair_required = false;
    }
    PharStatus {
        requested: cfg.phar_setup_requested,
        ready: ready && current.phase != PharPhase::Cancelled,
        phase: current.phase,
        progress_percent: current.progress_percent,
        backend,
        detected_gpu: current.detected_gpu,
        support,
        message: current.message,
        actionable_error: current.actionable_error,
        job_id: current.job_id,
        repair_required: current.repair_required,
        manifest_revision: UPSTREAM_REVISION,
    }
}

pub fn record_install_intent(
    data_dir: &Path,
    scope: InstallScope,
    enabled: bool,
    backend: Option<PharBackend>,
) -> Result<PharStatus> {
    let mut cfg = crate::config::load_config_for(scope);
    cfg.phar_setup_requested = enabled;
    cfg.phar_runtime = None;
    if let Some(backend) = backend {
        cfg.phar_backend = Some(backend.as_str().into());
    }
    if cfg.phar_backend.is_none() {
        cfg.phar_backend = Some(default_backend(current_platform()).as_str().into());
    }
    crate::config::save_config_for(scope, &cfg)?;
    let next = if enabled {
        new_state(PharPhase::Requested, 0, "P-HAR setup requested. Installation runs after AvtoHmver starts, outside the OS installer.")
    } else {
        new_state(
            PharPhase::Disabled,
            0,
            "P-HAR is disabled. Managed files remain until explicit P-HAR cleanup.",
        )
    };
    write_state(data_dir, next)?;
    Ok(status(data_dir, scope))
}

/// Starts/resumes the durable setup job and returns its status without waiting.
pub fn start_install(data_dir: &Path, scope: InstallScope) -> Result<PharStatus> {
    start_install_with_lease(data_dir, scope, None)
}

pub fn start_install_with_lease(
    data_dir: &Path,
    scope: InstallScope,
    lease: Option<crate::maintenance::BackgroundWorkerLease>,
) -> Result<PharStatus> {
    start_install_job(data_dir, scope, lease, false)
}

pub fn start_install_explicit_with_lease(
    data_dir: &Path,
    scope: InstallScope,
    lease: Option<crate::maintenance::BackgroundWorkerLease>,
) -> Result<PharStatus> {
    start_install_job(data_dir, scope, lease, true)
}

fn start_install_job(
    data_dir: &Path,
    scope: InstallScope,
    lease: Option<crate::maintenance::BackgroundWorkerLease>,
    resume_cancelled: bool,
) -> Result<PharStatus> {
    let current = status(data_dir, scope);
    if !current.requested || current.support.tier == PharSupportTier::Unavailable {
        return Ok(current);
    }
    if current.phase == PharPhase::Ready
        || (!resume_cancelled && current.phase == PharPhase::Cancelled)
    {
        return Ok(current);
    }
    let job_lock = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(data_dir.join(".phar-setup.lock"))?;
    fs4::FileExt::try_lock(&job_lock).map_err(|_| {
        anyhow!("P-HAR setup is already running or stopping. Refresh its status and retry.")
    })?;
    if resume_cancelled {
        let _ = std::fs::remove_file(cancel_path(data_dir));
    } else if cancelled(data_dir) {
        return Ok(status(data_dir, scope));
    }
    let mut initial = new_state(
        PharPhase::Detecting,
        2,
        "Preparing managed P-HAR RGB asset installation.",
    );
    initial.job_id = Some(format!(
        "phar-{}",
        JOB_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    write_state(data_dir, initial)?;
    let owned = data_dir.to_path_buf();
    thread::Builder::new()
        .name("curator-phar-install".into())
        .spawn(move || {
            let _job_lock = job_lock;
            let _lease = lease;
            run_install(&owned, scope);
        })
        .map_err(|error| anyhow!(error))?;
    Ok(status(data_dir, scope))
}
pub fn resume_requested_setup(data_dir: &Path, scope: InstallScope) -> Result<PharStatus> {
    start_install_explicit_with_lease(data_dir, scope, None)
}
fn cancelled(data_dir: &Path) -> bool {
    cancel_path(data_dir).is_file()
}
fn cancelled_state(data_dir: &Path, gpu: Option<DetectedGpu>) {
    let mut state = new_state(
        PharPhase::Cancelled,
        0,
        "P-HAR setup was cancelled. Staged data is retained for resume or Repair.",
    );
    state.detected_gpu = gpu;
    let _ = write_state(data_dir, state);
}
fn fail(data_dir: &Path, _phase: PharPhase, gpu: Option<DetectedGpu>, message: impl Into<String>) {
    let error = message.into();
    let mut state = new_state(PharPhase::Failed, 0, error.clone());
    state.detected_gpu = gpu;
    state.actionable_error = Some(error);
    state.repair_required = true;
    let _ = write_state(data_dir, state);
}
fn run_install(data_dir: &Path, scope: InstallScope) {
    // Acquiring the RGB asset is independent of hardware. Runtime/inference
    // readiness is a separate gate and must never follow from download alone.
    let _ = configured_backend(scope);
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(anyhow::Error::from)
        .and_then(|runtime| runtime.block_on(install_assets(data_dir)));
    if cancelled(data_dir) {
        cancelled_state(data_dir, None);
    } else if let Err(error) = result {
        fail(data_dir, PharPhase::DownloadingModels, None, format!("P-HAR RGB asset installation failed: {error}. Use Install / resume or Repair to retry."));
    } else {
        let _ = write_state(data_dir, assets_ready_state());
    }
}

fn assets_ready_state() -> PersistedState {
    new_state(PharPhase::AssetsReady, 100, "Official P-HAR RGB checkpoint installed and SHA-256 verified. Native inference is not ready until its managed runtime passes a real inference probe.")
}

fn checkpoint_path(data_dir: &Path) -> PathBuf {
    environment_dir(data_dir)
        .join("checkpoints")
        .join("timeSformer.pth")
}

fn verify_checkpoint(path: &Path, checkpoint: &CheckpointManifest, data_dir: &Path) -> Result<()> {
    let expected_size = checkpoint
        .bytes
        .ok_or_else(|| anyhow!("Missing pinned asset size"))?;
    let expected_hash = checkpoint
        .sha256
        .ok_or_else(|| anyhow!("Missing measured SHA-256"))?;
    let mut file = std::fs::File::open(path)?;
    if file.metadata()?.len() != expected_size {
        return Err(anyhow!(
            "Checkpoint size does not match the pinned official asset"
        ));
    }
    let mut digest = Context::new(&SHA256);
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        if cancelled(data_dir) {
            return Err(anyhow!("Setup cancelled"));
        }
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if hex::encode(digest.finish().as_ref()) != expected_hash {
        return Err(anyhow!(
            "Checkpoint SHA-256 does not match the measured official asset"
        ));
    }
    Ok(())
}

async fn install_assets(data_dir: &Path) -> Result<()> {
    let checkpoint = pinned_manifest().checkpoints.remove(0);
    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(2 * 60 * 60))
        .user_agent(concat!("AvtoHmver/", env!("CARGO_PKG_VERSION")))
        .build()?;
    install_checkpoint(data_dir, &checkpoint, &client).await
}

/// Only publishes complete verified files. Interrupted .part files are kept
/// for diagnosis and replaced on retry, never considered installed or loaded.
async fn install_checkpoint(
    data_dir: &Path,
    checkpoint: &CheckpointManifest,
    client: &reqwest::Client,
) -> Result<()> {
    install_checkpoint_with_idle_timeout(
        data_dir,
        checkpoint,
        client,
        std::time::Duration::from_secs(60),
    )
    .await
}

async fn install_checkpoint_with_idle_timeout(
    data_dir: &Path,
    checkpoint: &CheckpointManifest,
    client: &reqwest::Client,
    idle_timeout: std::time::Duration,
) -> Result<()> {
    let destination = checkpoint_path(data_dir);
    if verify_checkpoint(&destination, checkpoint, data_dir).is_ok() {
        return Ok(());
    }
    if cancelled(data_dir) {
        return Err(anyhow!("Setup cancelled"));
    }
    std::fs::create_dir_all(staging_dir(data_dir))?;
    std::fs::create_dir_all(destination.parent().unwrap())?;
    write_state(
        data_dir,
        new_state(
            PharPhase::DownloadingModels,
            5,
            "Downloading the pinned official RGB checkpoint.",
        ),
    )?;
    let expected_size = checkpoint
        .bytes
        .ok_or_else(|| anyhow!("Missing pinned asset size"))?;
    let expected_hash = checkpoint
        .sha256
        .ok_or_else(|| anyhow!("Missing measured SHA-256"))?;
    let request = client.get(checkpoint.source_url).send();
    tokio::pin!(request);
    let headers_timeout = tokio::time::sleep(idle_timeout);
    tokio::pin!(headers_timeout);
    let mut response = loop {
        tokio::select! {
            response = &mut request => break response?.error_for_status()?,
            _ = &mut headers_timeout => return Err(anyhow!("Download response headers timed out")),
            _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                if cancelled(data_dir) { return Err(anyhow!("Setup cancelled")); }
            }
        }
    };
    if response
        .content_length()
        .is_some_and(|bytes| bytes != expected_size)
    {
        return Err(anyhow!(
            "Download Content-Length differs from pinned asset size"
        ));
    }
    let partial = staging_dir(data_dir).join("timeSformer.pth.part");
    let mut file = std::fs::File::create(&partial)?;
    let mut digest = Context::new(&SHA256);
    let mut received = 0_u64;
    let mut last_percent = 5;
    loop {
        let chunk = response.chunk();
        tokio::pin!(chunk);
        let idle = tokio::time::sleep(idle_timeout);
        tokio::pin!(idle);
        let chunk = loop {
            tokio::select! {
                chunk = &mut chunk => break chunk?,
                _ = &mut idle => return Err(anyhow!("Download stalled for 60 seconds")),
                _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                    if cancelled(data_dir) { return Err(anyhow!("Setup cancelled")); }
                }
            }
        };
        let Some(chunk) = chunk else {
            break;
        };
        received = received
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| anyhow!("Asset size overflow"))?;
        if received > expected_size {
            return Err(anyhow!("Download exceeds pinned asset size"));
        }
        file.write_all(&chunk)?;
        digest.update(&chunk);
        let percent = 5 + ((received * 85) / expected_size) as u8;
        if percent != last_percent {
            write_state(
                data_dir,
                new_state(
                    PharPhase::DownloadingModels,
                    percent,
                    format!(
                        "Downloading official RGB checkpoint: {received} / {expected_size} bytes."
                    ),
                ),
            )?;
            last_percent = percent;
        }
        if cancelled(data_dir) {
            return Err(anyhow!("Setup cancelled"));
        }
    }
    if received != expected_size || hex::encode(digest.finish().as_ref()) != expected_hash {
        return Err(anyhow!(
            "Downloaded checkpoint failed exact size / SHA-256 verification"
        ));
    }
    file.sync_all()?;
    drop(file);
    if cancelled(data_dir) {
        return Err(anyhow!("Setup cancelled"));
    }
    // Replacement happens only after verification, preserving any old file
    // while a replacement is incomplete. Both paths are on the data volume.
    std::fs::rename(partial, destination)?;
    Ok(())
}

pub fn cancel(data_dir: &Path, scope: InstallScope) -> Result<PharStatus> {
    let current = status(data_dir, scope);
    if current.requested {
        ensure_manifest(data_dir)?;
        std::fs::write(cancel_path(data_dir), b"cancel\n")?;
        cancelled_state(data_dir, current.detected_gpu);
    }
    Ok(status(data_dir, scope))
}
pub fn disable(data_dir: &Path, scope: InstallScope) -> Result<PharStatus> {
    record_install_intent(data_dir, scope, false, None)
}
pub fn repair(data_dir: &Path, scope: InstallScope) -> Result<PharStatus> {
    record_install_intent(data_dir, scope, true, None)?;
    start_install_explicit_with_lease(data_dir, scope, None)
}
pub fn self_test(data_dir: &Path, scope: InstallScope) -> Result<PharStatus> {
    let current = status(data_dir, scope);
    if current.requested {
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(data_dir.join(".phar-setup.lock"))?;
        fs4::FileExt::try_lock(&lock).map_err(|_| {
            anyhow!("Wait for setup cancellation or completion before running self-test")
        })?;
        if cancelled(data_dir) {
            return Ok(status(data_dir, scope));
        }
        let checkpoint = pinned_manifest().checkpoints.remove(0);
        match verify_checkpoint(&checkpoint_path(data_dir), &checkpoint, data_dir) {
            Err(error) => fail(
                data_dir,
                PharPhase::Verifying,
                current.detected_gpu,
                format!("P-HAR RGB asset self-test failed: {error}. Run Repair."),
            ),
            Ok(()) if !runtime_is_verified(data_dir) => {
                write_state(data_dir, assets_ready_state())?
            }
            Ok(()) => {}
        }
    }
    Ok(status(data_dir, scope))
}

/// The worker can only be launched with an interpreter contained in this
/// managed environment, never the configured general-purpose `python_bin`.
pub fn managed_python(data_dir: &Path) -> Option<PathBuf> {
    #[derive(Deserialize)]
    struct Marker {
        managed_python: String,
    }
    let text = std::fs::read_to_string(environment_dir(data_dir).join(RUNTIME_FILE)).ok()?;
    let marker: Marker = serde_json::from_str(&text).ok()?;
    let path = PathBuf::from(marker.managed_python);
    let root = environment_dir(data_dir).canonicalize().ok()?;
    let candidate = path.canonicalize().ok()?;
    (candidate.starts_with(root) && candidate.is_file()).then_some(candidate)
}
pub fn runtime_is_verified(data_dir: &Path) -> bool {
    #[derive(Deserialize)]
    struct Marker {
        format: String,
        upstream_revision: String,
        backend: PharBackend,
        checkpoints_verified: bool,
        inference_probe_passed: bool,
        managed_python: String,
        artifact_hashes: serde_json::Value,
    }
    let marker = std::fs::read_to_string(environment_dir(data_dir).join(RUNTIME_FILE))
        .ok()
        .and_then(|v| serde_json::from_str::<Marker>(&v).ok());
    let Some(marker) = marker else {
        return false;
    };
    marker.format == "curator-phar-runtime-v1"
        && marker.upstream_revision == UPSTREAM_REVISION
        && matches!(marker.backend, PharBackend::Cuda | PharBackend::Rocm)
        && marker.checkpoints_verified
        && marker.inference_probe_passed
        && !marker.managed_python.is_empty()
        && marker.artifact_hashes.is_object()
        && marker
            .artifact_hashes
            .get("p-har-timesformer")
            .and_then(|hash| hash.as_str())
            == pinned_manifest().checkpoints[0].sha256
        && std::fs::metadata(checkpoint_path(data_dir))
            .map(|meta| meta.len())
            .ok()
            == pinned_manifest().checkpoints[0].bytes
        && managed_python(data_dir).is_some()
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = crate::process::blocking_command(program);
    command.args(args);
    crate::process::output_timeout_limited(
        &mut command,
        std::time::Duration::from_secs(8),
        1024 * 1024,
    )
    .ok()
    .filter(|out| out.status.success())
    .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}
/// Pure selection is exposed for deterministic hardware-free tests.
pub fn select_backend(
    requested: PharBackend,
    cuda: Option<DetectedGpu>,
    rocm: Option<DetectedGpu>,
) -> Result<DetectedGpu> {
    let compatible = |gpu: Option<DetectedGpu>| gpu.filter(|gpu| gpu.compatible);
    match requested {
        PharBackend::Cuda => compatible(cuda).ok_or_else(|| anyhow!("CUDA was requested, but no compatible NVIDIA GPU/driver was detected. Update the NVIDIA driver or choose ROCm only for an AMD GPU supported by AMD's Windows matrix.")),
        PharBackend::Rocm => compatible(rocm).ok_or_else(|| anyhow!("ROCm was requested, but no supported AMD GPU/driver was detected. Install an AMD-published Windows ROCm driver or choose CUDA.")),
        PharBackend::Auto => compatible(cuda).or_else(|| compatible(rocm)).ok_or_else(|| anyhow!("No compatible native CUDA or ROCm GPU was detected. P-HAR remains disabled; NudeNet and manual review are still available.")),
    }
}
pub fn detect_gpu(requested: PharBackend) -> Result<DetectedGpu> {
    if let Ok(fake) = crate::config::env_var("CURATOR_PHAR_TEST_GPU") {
        let fake = fake.to_ascii_lowercase();
        let cuda = (fake == "cuda").then(|| DetectedGpu {
            backend: PharBackend::Cuda,
            name: "test NVIDIA GPU".into(),
            driver: Some("test".into()),
            compatible: true,
            detail: "test probe".into(),
        });
        let rocm = (fake == "rocm").then(|| DetectedGpu {
            backend: PharBackend::Rocm,
            name: "test AMD GPU".into(),
            driver: Some("test".into()),
            compatible: true,
            detail: "test probe".into(),
        });
        return select_backend(requested, cuda, rocm);
    }
    let cuda = command_output(
        "nvidia-smi",
        &["--query-gpu=name,driver_version", "--format=csv,noheader"],
    )
    .and_then(|out| {
        out.lines().next().map(|line| {
            let mut fields = line.split(',').map(str::trim);
            DetectedGpu {
                backend: PharBackend::Cuda,
                name: fields.next().unwrap_or("NVIDIA GPU").into(),
                driver: fields.next().map(str::to_owned),
                compatible: true,
                detail: "NVIDIA driver detected by nvidia-smi.".into(),
            }
        })
    });
    let rocm = command_output("wmic", &["path", "win32_VideoController", "get", "Name,DriverVersion", "/format:csv"]).and_then(|out| out.lines().find(|line| line.to_ascii_lowercase().contains("amd") || line.to_ascii_lowercase().contains("radeon")).map(|line| DetectedGpu { backend: PharBackend::Rocm, name: line.trim().into(), driver: None, compatible: false, detail: "AMD adapter found; ROCm compatibility requires AMD's published Windows matrix and provisioning probe.".into() }));
    select_backend(requested, cuda, rocm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_marker_wins_late_writes_and_failed_resume_keeps_cancelling() {
        let _guard = crate::PROCESS_ENV_LOCK.lock().unwrap();
        let data = tempfile::tempdir().unwrap();
        let previous_config = std::env::var_os("CURATOR_CONFIG_DIR");
        std::env::set_var("CURATOR_CONFIG_DIR", data.path());
        let scope = InstallScope::CurrentUser;
        record_install_intent(data.path(), scope, true, None).unwrap();
        cancel(data.path(), scope).unwrap();
        for phase in [
            PharPhase::DownloadingModels,
            PharPhase::AssetsReady,
            PharPhase::Failed,
        ] {
            write_state(data.path(), new_state(phase, 100, "late worker write")).unwrap();
            let current = status(data.path(), scope);
            assert_eq!(current.phase, PharPhase::Cancelled);
            assert!(!current.ready);
            assert_eq!(
                start_install(data.path(), scope).unwrap().phase,
                PharPhase::Cancelled
            );
        }
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(data.path().join(".phar-setup.lock"))
            .unwrap();
        fs4::FileExt::try_lock(&lock).unwrap();
        record_install_intent(data.path(), scope, true, None).unwrap();
        assert!(start_install_explicit_with_lease(data.path(), scope, None).is_err());
        assert!(cancelled(data.path()));
        drop(lock);
        assert_eq!(
            self_test(data.path(), scope).unwrap().phase,
            PharPhase::Cancelled
        );
        assert!(cancelled(data.path()));
        disable(data.path(), scope).unwrap();
        write_state(
            data.path(),
            new_state(
                PharPhase::AssetsReady,
                100,
                "late worker finish after disable",
            ),
        )
        .unwrap();
        assert_eq!(status(data.path(), scope).phase, PharPhase::Disabled);
        assert_eq!(
            start_install(data.path(), scope).unwrap().phase,
            PharPhase::Disabled
        );
        if let Some(previous) = previous_config {
            std::env::set_var("CURATOR_CONFIG_DIR", previous);
        } else {
            std::env::remove_var("CURATOR_CONFIG_DIR");
        }
    }

    #[test]
    fn progress_and_cancel_can_persist_concurrently() {
        let data = tempfile::tempdir().unwrap();
        let handles: Vec<_> = (0..4)
            .map(|index| {
                let root = data.path().to_owned();
                std::thread::spawn(move || {
                    for percent in 0..8 {
                        let phase = if index % 2 == 0 {
                            PharPhase::Cancelled
                        } else {
                            PharPhase::DownloadingModels
                        };
                        write_state(
                            &root,
                            new_state(phase, percent, "concurrent control / progress"),
                        )
                        .unwrap();
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        assert!(read_state(data.path()).is_some());
    }

    fn fixture_checkpoint(url: String, bytes: &[u8]) -> CheckpointManifest {
        CheckpointManifest {
            id: "test-rgb",
            source_url: Box::leak(url.into_boxed_str()),
            bytes: Some(bytes.len() as u64),
            sha256: Some(Box::leak(
                hex::encode(ring::digest::digest(&SHA256, bytes).as_ref()).into_boxed_str(),
            )),
            license: "test fixture",
            release_asset_id: 0,
            checksum_origin: "test fixture",
        }
    }

    fn fixture_server(
        body: &'static [u8],
        declared_length: usize,
        stall: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        fixture_server_delays(body, declared_length, stall, false)
    }

    fn fixture_server_delays(
        body: &'static [u8],
        declared_length: usize,
        stall_body: bool,
        stall_headers: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request);
            if stall_headers {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
            let _ = write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {declared_length}\r\nConnection: close\r\n\r\n"
            );
            if stall_body {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
            let _ = socket.write_all(body);
        });
        (format!("http://{address}/official-fixture"), thread)
    }

    #[tokio::test]
    async fn download_repair_reuses_verified_file_and_rejects_wrong_or_partial_bytes() {
        let data = tempfile::tempdir().unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let (url, server) = fixture_server(b"good", 4, false);
        let mut checkpoint = fixture_checkpoint(url, b"good");
        install_checkpoint(data.path(), &checkpoint, &client)
            .await
            .unwrap();
        server.join().unwrap();
        verify_checkpoint(&checkpoint_path(data.path()), &checkpoint, data.path()).unwrap();
        // A valid install is reused even while its download origin is offline.
        install_checkpoint(data.path(), &checkpoint, &client)
            .await
            .unwrap();
        std::fs::write(checkpoint_path(data.path()), b"old!").unwrap();
        let (url, server) = fixture_server(b"evil", 4, false);
        checkpoint.source_url = Box::leak(url.into_boxed_str());
        assert!(install_checkpoint(data.path(), &checkpoint, &client)
            .await
            .is_err());
        server.join().unwrap();
        assert_eq!(
            std::fs::read(checkpoint_path(data.path())).unwrap(),
            b"old!"
        );
        let (url, server) = fixture_server(b"go", 4, false);
        checkpoint.source_url = Box::leak(url.into_boxed_str());
        assert!(install_checkpoint(data.path(), &checkpoint, &client)
            .await
            .is_err());
        server.join().unwrap();
        assert_eq!(
            std::fs::read(checkpoint_path(data.path())).unwrap(),
            b"old!"
        );
        let (url, server) = fixture_server(b"good", 4, false);
        checkpoint.source_url = Box::leak(url.into_boxed_str());
        install_checkpoint(data.path(), &checkpoint, &client)
            .await
            .unwrap();
        server.join().unwrap();
        assert_eq!(
            std::fs::read(checkpoint_path(data.path())).unwrap(),
            b"good"
        );
    }

    #[tokio::test]
    async fn header_and_body_stalls_are_bounded_without_publishing() {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        for stall_headers in [true, false] {
            let data = tempfile::tempdir().unwrap();
            let (url, server) = fixture_server_delays(b"good", 4, !stall_headers, stall_headers);
            let checkpoint = fixture_checkpoint(url, b"good");
            let start = std::time::Instant::now();
            let error = install_checkpoint_with_idle_timeout(
                data.path(),
                &checkpoint,
                &client,
                std::time::Duration::from_millis(50),
            )
            .await
            .unwrap_err();
            assert!(start.elapsed() < std::time::Duration::from_millis(800));
            assert!(error.to_string().contains(if stall_headers {
                "headers timed out"
            } else {
                "stalled"
            }));
            assert!(!checkpoint_path(data.path()).exists());
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn stalled_download_cancels_without_publishing() {
        let data = tempfile::tempdir().unwrap();
        let (url, server) = fixture_server(b"good", 4, true);
        let checkpoint = fixture_checkpoint(url, b"good");
        let root = data.path().to_owned();
        let cancellation = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            std::fs::create_dir_all(environment_dir(&root)).unwrap();
            std::fs::write(cancel_path(&root), b"cancel").unwrap();
        });
        let start = std::time::Instant::now();
        assert!(install_checkpoint(
            data.path(),
            &checkpoint,
            &reqwest::Client::builder().no_proxy().build().unwrap()
        )
        .await
        .is_err());
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
        assert!(!checkpoint_path(data.path()).exists());
        cancellation.join().unwrap();
        server.join().unwrap();
    }

    #[tokio::test]
    #[ignore = "requires explicitly supplied official release asset; never bundled"]
    async fn official_rgb_asset_matches_measured_pin() {
        let _guard = crate::PROCESS_ENV_LOCK.lock().unwrap();
        let path = std::env::var_os("CURATOR_PHAR_ACCEPTANCE_ASSET")
            .expect("Set CURATOR_PHAR_ACCEPTANCE_ASSET to the official RGB checkpoint");
        let data = tempfile::tempdir().unwrap();
        verify_checkpoint(
            Path::new(&path),
            &pinned_manifest().checkpoints[0],
            data.path(),
        )
        .unwrap();
        // Use the exact measured bytes without duplicating the 970 MB asset.
        // All UI controls exercise offline reuse, not an injected manifest.
        std::fs::create_dir_all(checkpoint_path(data.path()).parent().unwrap()).unwrap();
        std::fs::hard_link(Path::new(&path), checkpoint_path(data.path())).unwrap();
        let previous_config = std::env::var_os("CURATOR_CONFIG_DIR");
        std::env::set_var("CURATOR_CONFIG_DIR", data.path());
        let state = crate::test_support::state(data.path());
        let scope = InstallScope::CurrentUser;
        record_install_intent(data.path(), scope, true, None).unwrap();
        cancel(data.path(), scope).unwrap();
        assert_eq!(
            start_install(data.path(), scope).unwrap().phase,
            PharPhase::Cancelled
        );
        let peer = Some(axum::extract::ConnectInfo(std::net::SocketAddr::from((
            [127, 0, 0, 1],
            1234,
        ))));
        let axum::Json(installed) =
            crate::routes::admin::phar_install(axum::extract::State(state.clone()), peer.into())
                .await
                .unwrap();
        assert_eq!(installed["accepted"], true);
        wait_for_assets(data.path(), scope).await;
        assert_eq!(
            self_test(data.path(), scope).unwrap().phase,
            PharPhase::AssetsReady
        );
        let axum::Json(repaired) =
            crate::routes::admin::phar_repair(axum::extract::State(state.clone()), peer.into())
                .await
                .unwrap();
        assert_eq!(repaired["requested"], true);
        wait_for_assets(data.path(), scope).await;
        assert_eq!(
            disable(data.path(), scope).unwrap().phase,
            PharPhase::Disabled
        );
        assert!(!crate::config::load_config_for(scope).phar_setup_requested);
        assert!(checkpoint_path(data.path()).is_file());
        drop(state);
        if let Some(previous) = previous_config {
            std::env::set_var("CURATOR_CONFIG_DIR", previous);
        } else {
            std::env::remove_var("CURATOR_CONFIG_DIR");
        }
    }

    async fn wait_for_assets(data_dir: &Path, scope: InstallScope) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
        loop {
            let current = status(data_dir, scope);
            assert_ne!(
                current.phase,
                PharPhase::Failed,
                "{:?}",
                current.actionable_error
            );
            if current.phase == PharPhase::AssetsReady {
                assert!(
                    !current.ready,
                    "Downloading a checkpoint cannot establish inference readiness"
                );
                let lock = std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(data_dir.join(".phar-setup.lock"))
                    .unwrap();
                if fs4::FileExt::try_lock(&lock).is_ok() {
                    return;
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Asset install did not complete"
            );
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }
    fn gpu(backend: PharBackend) -> DetectedGpu {
        DetectedGpu {
            backend,
            name: "GPU".into(),
            driver: None,
            compatible: true,
            detail: String::new(),
        }
    }
    #[test]
    fn auto_prefers_cuda() {
        assert_eq!(
            select_backend(
                PharBackend::Auto,
                Some(gpu(PharBackend::Cuda)),
                Some(gpu(PharBackend::Rocm))
            )
            .unwrap()
            .backend,
            PharBackend::Cuda
        );
    }
    #[test]
    fn explicit_backend_does_not_fallback() {
        assert!(select_backend(PharBackend::Cuda, None, Some(gpu(PharBackend::Rocm))).is_err());
    }
    #[test]
    fn legacy_wsl_maps_to_auto() {
        assert_eq!(PharBackend::parse(Some("wsl2")), PharBackend::Auto);
    }
    #[test]
    fn pinned_checkpoint_sources_require_https() {
        let manifest = pinned_manifest();
        assert_eq!(manifest.checkpoints.len(), 1);
        assert!(manifest.checkpoints.iter().all(|checkpoint| checkpoint
            .source_url
            .starts_with("https://")
            && checkpoint.bytes.is_some_and(|size| size > 0)
            && checkpoint
                .sha256
                .is_some_and(|hash| hex::decode(hash).is_ok_and(|bytes| bytes.len() == 32))
            && checkpoint.release_asset_id != 0));
    }
    #[test]
    fn saved_wsl_intent_migrates_to_auto_and_requires_repair() {
        let _guard = crate::PROCESS_ENV_LOCK.lock().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("CURATOR_CONFIG_DIR", data.path());
        let legacy = crate::config::Config {
            phar_setup_requested: true,
            phar_runtime: Some("wsl2".into()),
            ..Default::default()
        };
        crate::config::save_config_for(InstallScope::CurrentUser, &legacy).unwrap();
        let current = status(data.path(), InstallScope::CurrentUser);
        let migrated = crate::config::load_config_for(InstallScope::CurrentUser);
        std::env::remove_var("CURATOR_CONFIG_DIR");
        assert_eq!(current.backend, PharBackend::Auto);
        assert!(current.repair_required);
        assert_eq!(migrated.phar_backend.as_deref(), Some("auto"));
        assert!(migrated.phar_runtime.is_none());
    }
}
