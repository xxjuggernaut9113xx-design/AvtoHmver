use std::io::{Read, Write};
use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;
use tempfile::NamedTempFile;
use zip::{write::FileOptions, ZipWriter};

// ─── Rating → speed tag ──────────────────────────────────────────────────────

pub fn rating_to_speed(rating: i64) -> Option<&'static str> {
    match rating {
        1 => Some("slow"),
        2 => Some("medium"),
        3 => Some("fast"),
        4 => Some("cum"),
        5 => Some("succubus"),
        _ => None,
    }
}

static SPEED_VALUES: &[&str] = &["slow", "medium", "fast", "cum", "succubus"];

pub fn is_speed_tag(tag: &str) -> bool {
    SPEED_VALUES.contains(&tag)
}

// ─── Manifest types ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ManifestEntry {
    file: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize)]
struct Manifest {
    version: &'static str,
    name: String,
    author: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
    unlock_cost: i64,
    required_challenge: &'static str,
    patreon_exclusive: bool,
    image_count: usize,
    video_count: usize,
    total_media: usize,
    media: Vec<ManifestEntry>,
    social_links: SocialLinks,
}

#[derive(Serialize, Default)]
struct SocialLinks {
    onlyfans: String,
    fansly: String,
    twitter: String,
    linktree: String,
    manyvids: String,
    redgifs: String,
    discord: String,
    patreon: String,
    subscribestar: String,
    kofi: String,
}

// ─── Media row for export ─────────────────────────────────────────────────────

pub struct ExportRow {
    pub filepath: String,
    pub kind: String, // "image" or "video"
    pub rating: i64,
    pub tags: Vec<String>,
}

// ─── build_chpack ─────────────────────────────────────────────────────────────
// Streams files directly into a NamedTempFile — no full-library RAM bomb.

pub(crate) fn copy_cancellable(
    mut source: impl Read,
    mut target: impl Write,
    cancelled: &dyn Fn() -> bool,
) -> Result<()> {
    let mut buffer = [0u8; 128 * 1024];
    loop {
        anyhow::ensure!(!cancelled(), "Package staging cancelled");
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        target.write_all(&buffer[..count])?;
    }
    Ok(())
}

pub(crate) fn build_chpack_cancellable(
    pack_name: String,
    author: String,
    description: String,
    unlock_cost: i64,
    rows: Vec<ExportRow>,
    library_dir: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<NamedTempFile> {
    build_selected_chpack(
        PackMetadata {
            name: pack_name,
            author,
            description,
            unlock_cost,
            cover: None,
        },
        rows,
        library_dir,
        cancelled,
    )
}

pub(crate) struct PackMetadata {
    pub name: String,
    pub author: String,
    pub description: String,
    pub unlock_cost: i64,
    pub cover: Option<String>,
}

pub(crate) fn build_selected_chpack(
    metadata: PackMetadata,
    rows: Vec<ExportRow>,
    library_dir: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<NamedTempFile> {
    let tmp = NamedTempFile::new().context("creating temp file for .chpack")?;
    let tmp_file = tmp.reopen().context("reopening temp file")?;
    let mut zip = ZipWriter::new(tmp_file);

    let options: FileOptions<()> = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    let mut media_entries = Vec::new();
    let library_root = dunce::canonicalize(library_dir).context("resolving package library")?;

    for (idx, row) in rows.iter().enumerate() {
        anyhow::ensure!(!cancelled(), "Package staging cancelled");
        let src_path = dunce::simplified(&library_dir.join(&row.filepath)).to_path_buf();
        anyhow::ensure!(
            src_path.exists(),
            "Selected media is missing: {}. Correct the selection or explicitly exclude this item.",
            row.filepath
        );
        let src_path = dunce::canonicalize(&src_path).context("resolving package source")?;
        anyhow::ensure!(
            src_path.starts_with(&library_root) && src_path.is_file(),
            "Package source is outside the library or is not a file"
        );

        let ext = src_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();

        let speed_tag = rating_to_speed(row.rating);

        // Strip curator tags that would collide with speed tag names
        let own_tags: Vec<String> = row
            .tags
            .iter()
            .filter(|t| speed_tag.is_none() || !is_speed_tag(t.as_str()))
            .cloned()
            .collect();

        let archive_filename = build_archive_filename(idx, &own_tags, speed_tag, &ext);
        anyhow::ensure!(
            archive_filename.len() <= 240,
            "Export filename exceeds the portable filename limit; shorten this item's tags"
        );
        let arc_path = format!("media/{}", archive_filename);

        zip.start_file(&arc_path, options)?;
        let mut f =
            std::fs::File::open(&src_path).with_context(|| format!("opening {:?}", src_path))?;
        copy_cancellable(&mut f, &mut zip, cancelled)?;

        let file_kind = if matches!(row.kind.as_str(), "video" | "clip") {
            "video"
        } else {
            "image"
        };
        media_entries.push(ManifestEntry {
            file: archive_filename,
            kind: file_kind.to_string(),
        });
    }

    if media_entries.is_empty() {
        anyhow::bail!("No accessible files on disk for this selection");
    }

    let mut preview = None;
    if let Some(cover) = metadata.cover {
        let path = dunce::canonicalize(library_dir.join(cover)).context("resolving cover")?;
        anyhow::ensure!(
            path.starts_with(&library_root) && path.is_file(),
            "Cover is outside the library or unavailable"
        );
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        anyhow::ensure!(
            matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp"),
            "Unsupported cover image"
        );
        let preview_name = format!("preview.{ext}");
        zip.start_file(&preview_name, options)?;
        copy_cancellable(std::fs::File::open(path)?, &mut zip, cancelled)?;
        preview = Some(preview_name);
    }
    let manifest = Manifest {
        version: "0.02a",
        name: metadata.name,
        author: metadata.author,
        description: metadata.description,
        preview,
        unlock_cost: metadata.unlock_cost,
        required_challenge: "",
        patreon_exclusive: false,
        image_count: media_entries
            .iter()
            .filter(|entry| entry.kind == "image")
            .count(),
        video_count: media_entries
            .iter()
            .filter(|entry| entry.kind == "video")
            .count(),
        total_media: media_entries.len(),
        media: media_entries,
        social_links: SocialLinks::default(),
    };

    zip.start_file("manifest.json", options)?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;

    anyhow::ensure!(!cancelled(), "Package staging cancelled");
    zip.finish()?;
    Ok(tmp)
}

// ─── Safe filename for download header ───────────────────────────────────────

static UNSAFE_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"[^\w\-. ]").unwrap());

pub fn safe_pack_filename(name: &str) -> String {
    let s = UNSAFE_RE.replace_all(name.trim(), "_");
    format!("{}.chpack", s.replace(' ', "_"))
}

/// `{idx}_{tag}_{tag}...{ext}`, tags sorted alphabetically. Matches the
/// reference "CH MediaTagger" tool's own naming exactly (decompiled and
/// confirmed: it does `'_'.join(sorted(self.selected_tags))` where the
/// difficulty tag is just one more entry in that same set — it is never
/// treated as special or forced to a fixed position). AvtoHmver's own speed
/// tag is folded into the same sort rather than appended last, so a file
/// tagged e.g. "thighs" + "cum" round-trips to the same filename
/// (`cum_thighs`, not `thighs_cum`) either tool would produce.
fn build_archive_filename(
    idx: usize,
    own_tags: &[String],
    speed_tag: Option<&str>,
    ext: &str,
) -> String {
    // Tags are human/provider data and may contain path separators or the
    // position namespace colon. Keep every archive entry a portable leaf.
    let mut tag_parts: Vec<String> = own_tags
        .iter()
        .map(|tag| {
            tag.chars()
                .map(|character| {
                    if character.is_control()
                        || matches!(
                            character,
                            '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'
                        )
                    {
                        '-'
                    } else {
                        character
                    }
                })
                .collect::<String>()
                .trim_matches([' ', '.'])
                .to_owned()
        })
        .filter(|tag| !tag.is_empty())
        .collect();
    if let Some(spd) = speed_tag {
        tag_parts.push(spd.to_string());
    }
    tag_parts.sort();
    tag_parts.dedup();

    let mut parts = vec![idx.to_string()];
    parts.extend(tag_parts);
    let extension: String = ext
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '.')
        .collect();
    format!("{}{}", parts.join("_"), extension)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_manifest_counts_physical_clips_as_video_and_rejects_library_escape() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        std::fs::create_dir(&library).unwrap();
        let mut rows = Vec::new();
        for (name, kind) in [
            ("image.png", "image"),
            ("video.mp4", "video"),
            ("clip.mp4", "clip"),
        ] {
            std::fs::write(library.join(name), b"disposable bytes").unwrap();
            rows.push(ExportRow {
                filepath: name.into(),
                kind: kind.into(),
                rating: 2,
                tags: vec![],
            });
        }
        let package = build_chpack_cancellable(
            "Test".into(),
            "AvtoHmver".into(),
            String::new(),
            0,
            rows,
            &library,
            &|| false,
        )
        .unwrap();
        let mut zip = zip::ZipArchive::new(package.reopen().unwrap()).unwrap();
        let manifest: serde_json::Value =
            serde_json::from_reader(zip.by_name("manifest.json").unwrap()).unwrap();
        assert_eq!(manifest["version"], "0.02a");
        assert_eq!(manifest["image_count"], 1);
        assert_eq!(manifest["video_count"], 2);
        assert_eq!(manifest["total_media"], 3);
        assert_eq!(manifest["media"][2]["type"], "video");
        assert!(manifest.get("preview").is_none());
        std::fs::write(root.path().join("outside.png"), b"original").unwrap();
        let escaped = build_chpack_cancellable(
            "Test".into(),
            "AvtoHmver".into(),
            String::new(),
            0,
            vec![ExportRow {
                filepath: "../outside.png".into(),
                kind: "image".into(),
                rating: 0,
                tags: vec![],
            }],
            &library,
            &|| false,
        );
        assert!(escaped
            .unwrap_err()
            .to_string()
            .contains("outside the library"));
        assert_eq!(
            std::fs::read(root.path().join("outside.png")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn archive_tags_are_portable_leaves_including_position_namespaces() {
        assert_eq!(
            build_archive_filename(
                0,
                &[
                    "position:missionary".into(),
                    "../escape\\name".into(),
                    "..".into()
                ],
                Some("slow"),
                ".jpg"
            ),
            "0_-escape-name_position-missionary_slow.jpg"
        );
    }

    #[test]
    fn archive_filename_sorts_speed_tag_with_the_rest_alphabetically() {
        // 'cum' < 'thighs' alphabetically, so it must sort first, matching
        // the reference tool exactly rather than AvtoHmver forcing speed last.
        assert_eq!(
            build_archive_filename(3, &["thighs".to_string()], Some("cum"), ".jpg"),
            "3_cum_thighs.jpg"
        );
    }

    #[test]
    fn archive_filename_with_no_tags_is_just_index_and_extension() {
        assert_eq!(build_archive_filename(5, &[], None, ".png"), "5.png");
    }

    #[test]
    fn archive_filename_with_no_speed_tag_still_sorts_own_tags() {
        assert_eq!(
            build_archive_filename(0, &["boobs".to_string(), "ass".to_string()], None, ".jpg"),
            "0_ass_boobs.jpg"
        );
    }
}
