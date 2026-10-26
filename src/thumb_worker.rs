use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use anyhow::Result;
use once_cell::sync::Lazy;
use tracing::warn;

const THUMB_MAX_DIM: u32 = 360;
static THUMB_LOCKS: Lazy<Vec<Mutex<()>>> = Lazy::new(|| (0..64).map(|_| Mutex::new(())).collect());
static THUMB_WORK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(8);

// ─── Negative cache for undecodable/missing source files ─────────────────────
//
// (size, mtime) of the source file at the moment we failed on it, keyed by
// media_id. `None` means the file didn't exist / its metadata couldn't be
// read at all.
//
// Without this, a broken thumbnail (truncated download, unsupported/corrupt
// file, or a placeholder row pointing at a file that was never written) pays
// the full cost of a decode attempt — or at minimum a failed filesystem
// call — on *every single request* for it: every grid scroll, every page
// load, every poll. For a file that's permanently broken that's an unbounded
// amount of repeated wasted work for a result that will never change.
//
// Keying on the fingerprint rather than just media_id means a genuine fix —
// re-syncing the source, replacing the file — is picked up automatically
// the moment the file's size or mtime changes, with no explicit
// invalidation needed. Failed stamps also persist on disk; decoder changes
// and upgrades invalidate them even when the source file has not changed.
type Fingerprint = Option<(u64, Option<SystemTime>)>;

static FAILED_THUMBS: Lazy<Mutex<HashMap<i64, (String, String)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Administrative cache rebuilds remove the on-disk thumbnails as well as
/// this process-local negative cache, so a repaired file is retried at once.
pub fn clear_failure_cache() {
    FAILED_THUMBS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

fn fingerprint(path: &Path) -> Fingerprint {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

#[cfg(test)]
pub async fn get_or_create_thumb(
    media_id: i64,
    src: PathBuf,
    thumbs_dir: PathBuf,
    ffmpeg: String,
) -> Result<Vec<u8>> {
    get_or_create_thumb_admitted(media_id, src, thumbs_dir, ffmpeg, None).await
}

pub async fn get_or_create_thumb_admitted(
    media_id: i64,
    src: PathBuf,
    thumbs_dir: PathBuf,
    ffmpeg: String,
    lease: Option<crate::maintenance::BackgroundWorkerLease>,
) -> Result<Vec<u8>> {
    run_thumbnail_work(lease, move || {
        get_or_create_thumb_with_tool(media_id, &src, &thumbs_dir, &ffmpeg)
    })
    .await
}

async fn run_thumbnail_work(
    lease: Option<crate::maintenance::BackgroundWorkerLease>,
    work: impl FnOnce() -> Result<Vec<u8>> + Send + 'static,
) -> Result<Vec<u8>> {
    let permit = THUMB_WORK.acquire().await?;
    tokio::task::spawn_blocking(move || {
        // Cancellation of the HTTP future must not release admission while
        // an uncancellable blocking decoder is still writing the cache.
        let _permit = permit;
        let _lease = lease;
        work()
    })
    .await?
}

pub fn get_or_create_thumb_with_tool(
    media_id: i64,
    src: &Path,
    thumbs_dir: &Path,
    ffmpeg: &str,
) -> Result<Vec<u8>> {
    let _guard = THUMB_LOCKS[media_id.unsigned_abs() as usize % 64]
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    // Use dunce::simplified to handle Windows long paths (\\?\ prefix)
    let src = dunce::simplified(src).to_path_buf();
    let thumb_path = dunce::simplified(&thumbs_dir.join(format!("{}.jpg", media_id))).to_path_buf();

    let current_fp = fingerprint(&src);
    if !src.is_file() {
        return Err(anyhow::anyhow!("Media file is unavailable"));
    }
    let stamp = format!("{}:{:?}", src.display(), current_fp);
    let failure_stamp = format!("{stamp}:decoder={ffmpeg}:{}", env!("CARGO_PKG_VERSION"));
    let stamp_path = thumbs_dir.join(format!("{media_id}.stamp"));
    let failed_path = thumbs_dir.join(format!("{media_id}.failed"));
    if thumb_path.is_file() && std::fs::read_to_string(&stamp_path).ok().as_ref() == Some(&stamp) {
        // `modified` is the portable LRU signal used by Media & Storage.
        // Ignore a touch failure: serving an otherwise valid thumbnail should
        // never fail merely because a filesystem does not support it.
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .open(&thumb_path)
            .and_then(|file| file.set_modified(SystemTime::now()));
        return Ok(std::fs::read(&thumb_path)?);
    }
    if std::fs::read_to_string(&failed_path).ok().as_ref() == Some(&failure_stamp) {
        return Err(anyhow::anyhow!(
            "Thumbnail unavailable for this file version"
        ));
    }

    // Already know this exact file (same size/mtime, or same "still missing")
    // failed last time — skip straight to the cached error, no I/O.
    if let Some((cached_stamp, msg)) = FAILED_THUMBS.lock().unwrap().get(&media_id) {
        if *cached_stamp == failure_stamp {
            return Err(anyhow::anyhow!("{}", msg));
        }
    }

    std::fs::create_dir_all(thumbs_dir)?;
    let img = match decode_preview(&src, ffmpeg) {
        Ok(img) => img,
        Err(e) => {
            let msg = e.to_string();
            let mut failures = FAILED_THUMBS.lock().unwrap();
            if failures.len() >= 4096 {
                failures.clear();
            }
            failures.insert(media_id, (failure_stamp.clone(), msg.clone()));
            let _ = std::fs::write(&failed_path, &failure_stamp);
            warn!(
                "Could not decode image for thumbnail, media {}: {}",
                media_id, msg
            );
            return Err(e);
        }
    };
    let thumb = img.thumbnail(THUMB_MAX_DIM, THUMB_MAX_DIM);
    let rgb = thumb.to_rgb8();

    let mut buf = std::io::Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 82);
    encoder.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ColorType::Rgb8.into(),
    )?;

    let bytes = buf.into_inner();
    let written = std::fs::write(&thumb_path, &bytes);
    let cached = written.is_ok();
    if let Err(e) = written {
        warn!("Could not write thumbnail for media {}: {}", media_id, e);
        // Return the bytes anyway — don't fail the request
    }

    if cached {
        let _ = std::fs::write(stamp_path, stamp);
    }
    let _ = std::fs::remove_file(failed_path);
    // Successful decode — clear any stale failure recorded for this media_id.
    FAILED_THUMBS.lock().unwrap().remove(&media_id);

    Ok(bytes)
}

fn decode_preview(src: &Path, ffmpeg: &str) -> Result<image::DynamicImage> {
    let extension = src
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "mp4" | "m4v" | "mov" | "webm" | "mkv" | "avi" | "wmv" | "flv" | "mpeg" | "mpg" | "ts"
    ) {
        return Ok(image::open(src)?);
    }
    let mut command = crate::process::blocking_command(ffmpeg);
    command
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(src)
        .args([
            "-frames:v",
            "1",
            "-an",
            "-vf",
            "scale=360:360:force_original_aspect_ratio=decrease",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
        ]);
    let output = crate::process::output_timeout_limited(
        &mut command,
        std::time::Duration::from_secs(15),
        2 * 1024 * 1024,
    )?;
    anyhow::ensure!(output.status.success(), "Video preview generation failed");
    Ok(image::load_from_memory(&output.stdout)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn changing_the_decoder_retries_a_failed_preview_without_changing_the_original() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("video.mp4");
        let cache = root.path().join("cache");
        std::fs::write(&source, b"invalid fixture video").unwrap();
        assert!(
            get_or_create_thumb_with_tool(1947, &source, &cache, "missing-first-decoder").is_err()
        );
        let first = std::fs::read_to_string(cache.join("1947.failed")).unwrap();
        assert!(get_or_create_thumb_with_tool(
            1947,
            &source,
            &cache,
            "missing-replacement-decoder"
        )
        .is_err());
        let replacement = std::fs::read_to_string(cache.join("1947.failed")).unwrap();
        assert_ne!(first, replacement);
        assert!(replacement.contains("missing-replacement-decoder"));
        assert_eq!(std::fs::read(source).unwrap(), b"invalid fixture video");
    }

    #[tokio::test]
    async fn cancelled_thumbnail_request_keeps_its_worker_lease_until_blocking_work_finishes() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let lease = state.maintenance.try_acquire_background_worker().unwrap();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let task = tokio::spawn(run_thumbnail_work(Some(lease), move || {
            let _ = started.send(());
            wait.recv_timeout(Duration::from_secs(5))?;
            Ok(Vec::new())
        }));
        tokio::time::timeout(Duration::from_secs(5), ready)
            .await
            .unwrap()
            .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(state.maintenance.active_background_workers(), 1);
        release.send(()).unwrap();
        for _ in 0..100 {
            if state.maintenance.active_background_workers() == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(state.maintenance.active_background_workers(), 0);
    }

    #[test]
    #[ignore = "requires the installed FFmpeg runtime"]
    fn video_preview_cache_round_trip_and_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("video.mp4");
        let cache = dir.path().join("cache");
        let ffmpeg = crate::config::resolve_tool_bin(
            None,
            "FFMPEG_BIN",
            &crate::config::tool_file_name("ffmpeg"),
        );
        let generate = |color: &str| {
            let mut command = crate::process::blocking_command(&ffmpeg);
            command
                .args(["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i"])
                .arg(format!("color=c={color}:s=640x480:d=0.2"))
                .args(["-c:v", "mpeg4"])
                .arg(&src);
            assert!(crate::process::output_timeout(
                &mut command,
                std::time::Duration::from_secs(15)
            )
            .unwrap()
            .status
            .success());
        };
        generate("red");
        let first = get_or_create_thumb_with_tool(923, &src, &cache, &ffmpeg).unwrap();
        let image = image::load_from_memory(&first).unwrap();
        assert!(image.width() <= 360 && image.height() <= 360);
        // A valid cache hit needs no functioning decoder.
        assert_eq!(
            first,
            get_or_create_thumb_with_tool(923, &src, &cache, "missing-ffmpeg").unwrap()
        );
        generate("blue");
        let changed = get_or_create_thumb_with_tool(923, &src, &cache, &ffmpeg).unwrap();
        assert_ne!(first, changed);
        std::fs::write(&src, b"corrupt video").unwrap();
        assert!(get_or_create_thumb_with_tool(923, &src, &cache, &ffmpeg).is_err());
        assert!(cache.join("923.failed").is_file());
        generate("green");
        assert!(get_or_create_thumb_with_tool(923, &src, &cache, &ffmpeg).is_ok());
        assert!(!cache.join("923.failed").exists());
    }
    #[tokio::test]
    async fn concurrent_requests_and_file_version_invalidation() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("image.png");
        image::RgbImage::from_pixel(8, 8, image::Rgb([255, 0, 0]))
            .save(&src)
            .unwrap();
        let (a, b) = tokio::join!(
            get_or_create_thumb(922, src.clone(), dir.path().into(), "ffmpeg".into()),
            get_or_create_thumb(922, src.clone(), dir.path().into(), "ffmpeg".into())
        );
        let first = a.unwrap();
        assert_eq!(first, b.unwrap());
        image::RgbImage::from_pixel(12, 12, image::Rgb([0, 0, 255]))
            .save(&src)
            .unwrap();
        let changed = get_or_create_thumb(922, src.clone(), dir.path().into(), "ffmpeg".into())
            .await
            .unwrap();
        assert_ne!(first, changed);
        std::fs::remove_file(&src).unwrap();
        assert!(
            get_or_create_thumb(922, src.clone(), dir.path().into(), "ffmpeg".into())
                .await
                .is_err()
        );
        std::fs::write(&src, b"broken").unwrap();
        assert!(
            get_or_create_thumb(922, src.clone(), dir.path().into(), "ffmpeg".into())
                .await
                .is_err()
        );
        assert!(dir.path().join("922.failed").is_file());
        FAILED_THUMBS.lock().unwrap().clear(); // Simulate a restart; persistent negative cache still applies.
        assert!(
            get_or_create_thumb(922, src.clone(), dir.path().into(), "ffmpeg".into())
                .await
                .is_err()
        );
        image::RgbImage::new(16, 16).save(&src).unwrap();
        assert!(
            get_or_create_thumb(922, src, dir.path().into(), "ffmpeg".into())
                .await
                .is_ok()
        );
    }
}
