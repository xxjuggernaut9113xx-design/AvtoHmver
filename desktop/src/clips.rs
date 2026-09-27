//! Native Host clip service.
//!
//! The Server keeps its HTTP clip route (`src/routes/clips.rs`); the Host
//! drives ffmpeg directly so the UI can report real encode progress and
//! cancel mid-encode. One encode runs at a time per Host, mirroring the
//! Server's single slot. The ffmpeg invocation mirrors the Server route's
//! arguments, plus `-progress pipe:1` for percent reporting.
//!
//! DB note: `curator::db` is crate-private, so the small clip-job statements
//! here intentionally mirror the canonical helpers in `src/db.rs`.

use super::Update;
use curator::{maintenance::BackgroundWorkerLease, AppState};
use rusqlite::OptionalExtension;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{io::AsyncBufReadExt, sync::mpsc};

/// Events the supervising task reports back to the desktop worker lane.
#[derive(Debug, Clone)]
pub enum ClipEvent {
    Progress {
        job_id: i64,
        percent: i64,
    },
    Finished {
        job_id: i64,
        status: String,
        clip_count: i64,
        error: Option<String>,
    },
}

impl From<ClipEvent> for Update {
    fn from(event: ClipEvent) -> Self {
        match event {
            ClipEvent::Progress { job_id, percent } => Update::ClipJob {
                job_id,
                status: "running".to_string(),
                clip_count: 0,
                error: None,
                progress: percent as f64,
            },
            ClipEvent::Finished {
                job_id,
                status,
                clip_count,
                error,
            } => Update::ClipJob {
                job_id,
                status: status.clone(),
                clip_count,
                error,
                progress: if status == "done" { 100.0 } else { 0.0 },
            },
        }
    }
}

/// One in-flight encode tracked by the worker thread. The supervising task
/// owns the actual ffmpeg child; cancelling drops this entry's sender, which
/// tells the supervisor to kill the child and clean the staging directory.
struct RunningClip {
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

pub struct ClipService {
    state: Arc<AppState>,
    running: Arc<Mutex<HashMap<i64, RunningClip>>>,
    /// Serializes create-check-insert so two UI actions cannot start two
    /// encodes between the running-check and the insert.
    create_lock: Mutex<()>,
}

impl ClipService {
    pub fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            running: Arc::new(Mutex::new(HashMap::new())),
            create_lock: Mutex::new(()),
        }
    }

    fn db(&self) -> Result<impl std::ops::DerefMut<Target = rusqlite::Connection>, String> {
        self.state.pool.get().map_err(|error| error.to_string())
    }

    /// Validates, inserts the job row, and spawns the supervising task.
    /// Returns an existing done job's id without re-encoding, like the Server.
    pub async fn create(
        &self,
        media_id: i64,
        seconds: u32,
        events: mpsc::UnboundedSender<ClipEvent>,
    ) -> Result<i64, String> {
        let max = self.state.settings.read().await.max_clip_length_secs;
        if !(15..=max).contains(&seconds) {
            return Err(format!("Clip length must be 15 to {max} seconds"));
        }
        // Reserve a worker lease before the job row exists so maintenance
        // cannot snapshot halfway through the encode, mirroring the Server.
        let lease = self
            .state
            .maintenance
            .try_acquire_background_worker()
            .ok_or_else(|| "A local maintenance job is active.".to_string())?;
        let (filepath, job_id) = {
            let _guard = self.create_lock.lock().map_err(|error| error.to_string())?;
            let conn = self.db()?;
            let filepath: Option<String> = conn
                .query_row(
                    "SELECT filepath FROM media WHERE id=?1 AND type='video' AND downloaded=1 AND missing=0 AND clip_parent_id IS NULL",
                    [media_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let Some(filepath) = filepath else {
                return Err("Original downloaded video not found".into());
            };
            let existing: Option<i64> = conn
                .query_row(
                    "SELECT id FROM clip_jobs WHERE media_id=?1 AND seconds=?2 AND status='done' ORDER BY id DESC LIMIT 1",
                    rusqlite::params![media_id, seconds],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some(job_id) = existing {
                return Ok(job_id);
            }
            let running: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM clip_jobs WHERE status='running'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if running > 0 {
                return Err("Another video is being split. Please wait for it to finish.".into());
            }
            conn.execute(
                "INSERT INTO clip_jobs(media_id,seconds,status,added_at) VALUES(?1,?2,'running',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                rusqlite::params![media_id, seconds],
            )
            .map_err(|error| error.to_string())?;
            (filepath, conn.last_insert_rowid())
        };
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        self.running
            .lock()
            .map_err(|error| error.to_string())?
            .insert(
                job_id,
                RunningClip {
                    cancel_tx: Some(cancel_tx),
                },
            );
        let state = self.state.clone();
        let running = self.running.clone();
        tokio::spawn(supervise(
            state, running, job_id, media_id, seconds, filepath, max, lease, cancel_rx, events,
        ));
        Ok(job_id)
    }

    /// Asks the supervising task to kill the encode and clean up. Only jobs
    /// this Host session is encoding can be cancelled; anything else is
    /// reported honestly instead of pretending.
    pub fn cancel(&self, job_id: i64) -> Result<(), String> {
        let entry = self
            .running
            .lock()
            .map_err(|error| error.to_string())?
            .remove(&job_id);
        match entry.and_then(|running| running.cancel_tx) {
            Some(cancel_tx) => {
                let _ = cancel_tx.send(());
                Ok(())
            }
            None => {
                let status: Option<String> = self
                    .db()?
                    .query_row(
                        "SELECT status FROM clip_jobs WHERE id=?1",
                        [job_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                match status.as_deref() {
                    Some("running") => Err(
                        "That clip job is not encoding in this Host session, so it cannot be cancelled from here."
                            .into(),
                    ),
                    Some(other) => Err(format!("Clip job is already {other}; nothing to cancel.")),
                    None => Err("Clip job not found.".into()),
                }
            }
        }
    }

    /// Single DB read of a job row for the status poller.
    pub fn poll(&self, job_id: i64) -> Result<Option<JobSnapshot>, String> {
        let row: Option<(String, i64, i64, Option<String>)> = self
            .db()?
            .query_row(
                "SELECT status,progress_percent,clip_count,error FROM clip_jobs WHERE id=?1",
                [job_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(row.map(
            |(status, progress_percent, clip_count, error)| JobSnapshot {
                status,
                progress_percent,
                clip_count,
                error,
            },
        ))
    }
}

/// DB snapshot of one clip job for the UI poller.
#[derive(Debug, Clone)]
pub struct JobSnapshot {
    pub status: String,
    pub progress_percent: i64,
    pub clip_count: i64,
    pub error: Option<String>,
}

fn db_progress(state: &AppState, job_id: i64, percent: i64) {
    if let Ok(conn) = state.pool.get() {
        let _ = conn.execute(
            "UPDATE clip_jobs SET progress_percent=?1 WHERE id=?2 AND status='running'",
            rusqlite::params![percent.clamp(0, 100), job_id],
        );
    }
}

fn db_terminal(
    state: &AppState,
    job_id: i64,
    status: &str,
    clip_count: i64,
    error: Option<&str>,
) -> bool {
    let Ok(conn) = state.pool.get() else {
        return false;
    };
    let changed: usize = match status {
        "done" => conn
            .execute(
                "UPDATE clip_jobs SET status='done',clip_count=?1,progress_percent=100 WHERE id=?2 AND status='running'",
                rusqlite::params![clip_count, job_id],
            )
            .unwrap_or(0),
        "failed" => conn
            .execute(
                "UPDATE clip_jobs SET status='failed',error=?1 WHERE id=?2 AND status='running'",
                rusqlite::params![error.unwrap_or("Clip job failed"), job_id],
            )
            .unwrap_or(0),
        _ => conn
            .execute(
                "UPDATE clip_jobs SET status='cancelled',error='Cancelled by the user; original preserved' WHERE id=?1 AND status='running'",
                [job_id],
            )
            .unwrap_or(0),
    };
    changed > 0
}

/// ffprobe duration probe, mirroring the Server's five-second deadline.
fn probe_duration(ffprobe_bin: &str, path: &Path) -> Option<f64> {
    if !path.is_file() {
        return None;
    }
    let mut cmd = curator::process::blocking_command(ffprobe_bin);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
    ])
    .arg(path);
    let output = curator::process::output_timeout(&mut cmd, Duration::from_secs(5)).ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|duration| duration.is_finite() && *duration >= 0.0)
}

/// mtime+size stamp, mirroring `media_files::stamp` for the original-file
/// change guard.
fn stamp(path: &Path) -> Option<String> {
    let metadata = path.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some(format!("{}:{:?}", metadata.len(), metadata.modified().ok()))
}

/// Kills the ffmpeg child: whole process tree on Windows (mirroring the
/// downloader's taskkill seam), SIGKILL on the direct child elsewhere —
/// ffmpeg spawns no grandchildren, so the direct kill is sufficient.
async fn kill_child(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut taskkill = curator::process::command("taskkill");
        taskkill
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .kill_on_drop(true);
        let _ = tokio::time::timeout(Duration::from_secs(5), taskkill.output()).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[allow(clippy::too_many_arguments)]
async fn supervise(
    state: Arc<AppState>,
    running: Arc<Mutex<HashMap<i64, RunningClip>>>,
    job_id: i64,
    media_id: i64,
    seconds: u32,
    filepath: String,
    max_clip_length_secs: u32,
    _lease: BackgroundWorkerLease,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    events: mpsc::UnboundedSender<ClipEvent>,
) {
    let outcome = encode(
        &state,
        job_id,
        media_id,
        seconds,
        &filepath,
        max_clip_length_secs,
        &mut cancel_rx,
        &events,
    )
    .await;
    running.lock().map(|mut map| map.remove(&job_id)).ok();
    let (status, clip_count, error) = match outcome {
        EncodeOutcome::Done(count) => ("done", count, None),
        EncodeOutcome::Failed(message) => ("failed", 0, Some(message)),
        EncodeOutcome::Cancelled => ("cancelled", 0, None),
    };
    // The status guard inside db_terminal keeps a late cancel from
    // overwriting a finished encode; only announce a transition that stuck.
    if db_terminal(&state, job_id, status, clip_count, error.as_deref()) {
        let _ = events.send(ClipEvent::Finished {
            job_id,
            status: status.to_string(),
            clip_count,
            error,
        });
    }
}

enum EncodeOutcome {
    Done(i64),
    Failed(String),
    Cancelled,
}

#[allow(clippy::too_many_arguments)]
async fn encode(
    state: &Arc<AppState>,
    job_id: i64,
    media_id: i64,
    seconds: u32,
    filepath: &str,
    max_clip_length_secs: u32,
    cancel_rx: &mut tokio::sync::oneshot::Receiver<()>,
    events: &mpsc::UnboundedSender<ClipEvent>,
) -> EncodeOutcome {
    let library = match state.library_dir.canonicalize() {
        Ok(library) => library,
        Err(error) => {
            return EncodeOutcome::Failed(format!("Library directory unavailable: {error}"))
        }
    };
    let original = match library.join(filepath).canonicalize() {
        Ok(original) if original.starts_with(&library) && original.is_file() => original,
        _ => return EncodeOutcome::Failed("Video is outside the library or unavailable".into()),
    };
    let ffprobe = state.ffprobe_bin.clone();
    let probe_input = original.clone();
    let duration = tokio::task::spawn_blocking(move || probe_duration(&ffprobe, &probe_input))
        .await
        .ok()
        .flatten();
    let Some(duration) = duration else {
        return EncodeOutcome::Failed("Could not read video duration with ffprobe".into());
    };
    if duration <= f64::from(max_clip_length_secs) {
        return EncodeOutcome::Failed(format!(
            "Only videos longer than {max_clip_length_secs} seconds need splitting"
        ));
    }
    let original_stamp = stamp(&original);
    let staging = match tempfile::Builder::new()
        .prefix("clip-work-")
        .tempdir_in(&state.data_dir)
    {
        Ok(staging) => staging,
        Err(error) => {
            return EncodeOutcome::Failed(format!("Could not stage clip output: {error}"))
        }
    };
    let output_pattern = staging.path().join("clip-%04d.mp4");
    let log = match tempfile::tempfile() {
        Ok(log) => log,
        Err(error) => return EncodeOutcome::Failed(format!("Could not stage clip log: {error}")),
    };
    let log_stderr = match log.try_clone() {
        Ok(cloned) => cloned,
        Err(error) => return EncodeOutcome::Failed(format!("Could not stage clip log: {error}")),
    };
    let mut child = match curator::process::command(&state.ffmpeg_bin)
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i"])
        .arg(&original)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-sn",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-threads",
            "2",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-force_key_frames",
        ])
        .arg(format!("expr:gte(t,n_forced*{seconds})"))
        .args(["-f", "segment", "-segment_time"])
        .arg(seconds.to_string())
        .args([
            "-reset_timestamps",
            "1",
            "-segment_format_options",
            "movflags=+faststart",
        ])
        .arg("-progress")
        .arg("pipe:1")
        .arg(&output_pattern)
        .stdout(std::process::Stdio::piped())
        .stderr(log_stderr)
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return EncodeOutcome::Failed(format!("Could not start FFmpeg: {error}")),
    };
    // Drain the progress pipe on its own task: a full pipe would block
    // ffmpeg on long encodes.
    let total_us = (duration * 1_000_000.0).max(1.0);
    let (percent_tx, mut percent_rx) = mpsc::unbounded_channel::<i64>();
    let stdout = child.stdout.take();
    let reader = tokio::spawn(async move {
        let Some(stdout) = stdout else { return };
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        let mut last = -1i64;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(value) = line
                .strip_prefix("out_time_us=")
                .and_then(|raw| raw.trim().parse::<i64>().ok())
            {
                let percent = ((value as f64 / total_us) * 100.0).floor() as i64;
                let percent = percent.clamp(0, 100);
                if percent != last {
                    last = percent;
                    if percent_tx.send(percent).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let mut last_reported = 0i64;
    let exited = loop {
        tokio::select! {
            Some(percent) = percent_rx.recv() => {
                if percent != last_reported {
                    last_reported = percent;
                    db_progress(state, job_id, percent);
                    let _ = events.send(ClipEvent::Progress { job_id, percent });
                }
            }
            _ = &mut *cancel_rx => {
                reader.abort();
                kill_child(&mut child).await;
                let _ = tokio::fs::remove_dir_all(staging.path()).await;
                return EncodeOutcome::Cancelled;
            }
            result = child.wait() => {
                match result {
                    Ok(status) => break status.success(),
                    Err(_) => break false,
                }
            }
            _ = state.shutdown.cancelled() => {
                reader.abort();
                kill_child(&mut child).await;
                return EncodeOutcome::Failed("Clip creation interrupted by shutdown; original preserved".into());
            }
            _ = tokio::time::sleep(Duration::from_secs(21600)) => {
                reader.abort();
                kill_child(&mut child).await;
                return EncodeOutcome::Failed("Clip creation exceeded six hours; original preserved".into());
            }
        }
    };
    reader.abort();
    if !exited {
        use std::io::{Read, Seek, SeekFrom};
        let mut log_text = String::new();
        let mut log = log;
        if log.seek(SeekFrom::Start(0)).is_ok() {
            let _ = log.take(2000).read_to_string(&mut log_text);
        }
        let detail = log_text.trim();
        return EncodeOutcome::Failed(if detail.is_empty() {
            "FFmpeg failed".into()
        } else {
            format!("FFmpeg failed: {detail}")
        });
    }
    if stamp(&original) != original_stamp {
        return EncodeOutcome::Failed("Original changed during clip creation; retry".into());
    }
    // Post-process on a blocking thread: verify, move into the library, and
    // index every clip, mirroring the Server route.
    let state_blocking = state.clone();
    let staging_path = staging.path().to_path_buf();
    let post = tokio::task::spawn_blocking(move || {
        post_process(
            &state_blocking,
            media_id,
            job_id,
            &original,
            &staging_path,
            max_clip_length_secs,
        )
    })
    .await;
    // The staging TempDir cleans itself on drop; post-process renames it
    // into the library on success, so only suppress the cleanup then.
    match post {
        Ok(Ok(count)) => {
            let _ = staging.keep();
            EncodeOutcome::Done(count)
        }
        Ok(Err(error)) => EncodeOutcome::Failed(error.to_string()),
        Err(error) => EncodeOutcome::Failed(format!("Clip post-processing failed: {error}")),
    }
}

fn post_process(
    state: &AppState,
    media_id: i64,
    job_id: i64,
    original: &Path,
    staging: &Path,
    max_clip_length_secs: u32,
) -> anyhow::Result<i64> {
    let mut clips: Vec<_> = std::fs::read_dir(staging)?.collect::<Result<Vec<_>, _>>()?;
    clips.sort_by_key(|entry| entry.file_name());
    anyhow::ensure!(!clips.is_empty(), "FFmpeg produced no clips");
    let mut durations = Vec::new();
    for clip in &clips {
        let duration = probe_duration(&state.ffprobe_bin, &clip.path())
            .ok_or_else(|| anyhow::anyhow!("Could not verify generated clip"))?;
        anyhow::ensure!(
            duration > 0.0 && duration <= f64::from(max_clip_length_secs),
            "Generated clip exceeds the configured clip category limit"
        );
        durations.push(duration);
    }
    let library = state.library_dir.canonicalize()?;
    let destination = original
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Original has no parent directory"))?
        .join(format!("curator-clips-{media_id}-{job_id}"));
    anyhow::ensure!(
        !destination.exists(),
        "Clip output directory already exists; nothing overwritten"
    );
    std::fs::rename(staging, &destination)?;
    let conn = state
        .pool
        .get()
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    let tx = conn.unchecked_transaction()?;
    for (clip, duration) in clips.iter().zip(durations) {
        let path = destination.join(clip.file_name());
        let relative = path
            .strip_prefix(&library)
            .map_err(|_| anyhow::anyhow!("Clip escaped the library"))?
            .to_string_lossy()
            .replace('\\', "/");
        tx.execute("INSERT INTO media(source_id,filepath,filename,type,added_at,downloaded,duration_secs,duration_attempted,file_stamp,clip_parent_id,auto_rating,auto_rating_score,rating,rating_source)
            SELECT source_id,?1,?2,'video',strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,?3,1,?4,id,auto_rating,auto_rating_score,auto_rating,
            CASE WHEN auto_rating>0 THEN 'auto' ELSE 'none' END FROM media WHERE id=?5
            ON CONFLICT(filepath) DO UPDATE SET clip_parent_id=excluded.clip_parent_id,
            duration_secs=excluded.duration_secs,duration_attempted=1,
            auto_rating=excluded.auto_rating,auto_rating_score=excluded.auto_rating_score,
            rating=CASE WHEN media.rating_reviewed=0 THEN excluded.rating ELSE media.rating END,
            rating_source=CASE WHEN media.rating_reviewed=0 THEN excluded.rating_source ELSE media.rating_source END",
            rusqlite::params![relative,clip.file_name().to_string_lossy(),duration,stamp(&path),media_id])?;
        tx.execute("INSERT OR IGNORE INTO media_tags(media_id,tag_id) SELECT m.id,mt.tag_id FROM media m JOIN media_tags mt ON mt.media_id=?1 WHERE m.filepath=?2", rusqlite::params![media_id,relative])?;
    }
    tx.commit()?;
    Ok(clips.len() as i64)
}
