//! Managed local audio and validated external references. No user credentials.
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub title: String,
    pub format: String,
    pub bytes: u64,
}
pub fn schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS music_tracks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,format TEXT NOT NULL,bytes INTEGER NOT NULL)").map_err(|e|e.to_string())
}
pub fn format(name: &str) -> Result<String, String> {
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(ext.as_str(), "mp3" | "aac" | "m4a" | "wav" | "flac" | "ogg") {
        Ok(ext)
    } else {
        Err("Supported audio formats: MP3, AAC/M4A, WAV, FLAC and Ogg".into())
    }
}
pub fn list(state: &AppState) -> Result<Vec<Track>, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT id,title,format,bytes FROM music_tracks ORDER BY id")
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map([], |r| {
            Ok(Track {
                id: r.get(0)?,
                title: r.get(1)?,
                format: r.get(2)?,
                bytes: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}
pub fn store(state: &AppState, name: &str, bytes: &[u8]) -> Result<Track, String> {
    if !state.edition.owns_library() {
        return Err("Viewer cannot import music".into());
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or("Maintenance is active")?;
    if bytes.is_empty() || bytes.len() > 256 * 1024 * 1024 {
        return Err("Audio must be between 1 byte and 256 MiB".into());
    }
    let format = format(name)?;
    let title = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Audio")
        .chars()
        .take(160)
        .collect::<String>();
    let mut conn = state.pool.get().map_err(|e| e.to_string())?;
    schema(&conn)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO music_tracks(title,format,bytes) VALUES(?1,?2,?3)",
        rusqlite::params![title, format, bytes.len() as u64],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    let dir = state.data_dir.join("music");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.{format}"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    if let Err(e) = tx.commit() {
        let _ = std::fs::remove_file(path);
        return Err(e.to_string());
    }
    Ok(Track {
        id,
        title,
        format,
        bytes: bytes.len() as u64,
    })
}
pub fn import(state: &AppState, path: &Path) -> Result<Vec<Track>, String> {
    let mut tracks = vec![];
    if path.is_dir() {
        for entry in walkdir::WalkDir::new(path).follow_links(false) {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().is_file() && format(&entry.path().to_string_lossy()).is_ok() {
                tracks.extend(import(state, entry.path())?);
            }
        }
    } else {
        if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 {
            return Err("Track exceeds 256 MiB".into());
        }
        tracks.push(store(
            state,
            &path.to_string_lossy(),
            &std::fs::read(path).map_err(|e| e.to_string())?,
        )?);
    }
    if tracks.is_empty() {
        return Err("No supported audio files found".into());
    }
    Ok(tracks)
}
pub fn track_path(state: &AppState, id: i64) -> Result<PathBuf, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    schema(&conn)?;
    let format: String = conn
        .query_row("SELECT format FROM music_tracks WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|_| "Track not found")?;
    // Validate DB metadata before constructing a path.
    let format = self::format(&format!("track.{format}"))?;
    let path = state.data_dir.join("music").join(format!("{id}.{format}"));
    if !path.is_file() {
        return Err("Track file is missing; import it again".into());
    }
    Ok(path)
}
pub fn validate_reference(provider: &str, source: Option<&str>) -> Result<Option<String>, String> {
    if provider == "local" {
        if source.is_some_and(|s| !s.is_empty()) {
            return Err("Local playlists use managed track IDs".into());
        }
        return Ok(None);
    }
    let url = reqwest::Url::parse(source.ok_or("A provider link is required")?)
        .map_err(|_| "Invalid provider URL")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("Use an HTTPS provider link without credentials or a custom port".into());
    }
    let host = url.host_str().unwrap_or("");
    let parts = url
        .path_segments()
        .map(|p| p.collect::<Vec<_>>())
        .unwrap_or_default();
    let valid = match provider {
        "spotify" => {
            host == "open.spotify.com"
                && parts.len() == 2
                && matches!(parts[0], "track" | "album" | "playlist")
                && !parts[1].is_empty()
        }
        "apple_music" => {
            host == "music.apple.com"
                && parts.len() >= 3
                && parts
                    .iter()
                    .any(|s| matches!(*s, "album" | "playlist" | "song"))
        }
        "youtube" => {
            ((host == "www.youtube.com" || host == "youtube.com" || host == "m.youtube.com")
                && ((url.path() == "/watch"
                    && url.query_pairs().any(|(k, v)| k == "v" && !v.is_empty()))
                    || (url.path() == "/playlist"
                        && url.query_pairs().any(|(k, v)| k == "list" && !v.is_empty()))))
                || (host == "youtu.be" && parts.len() == 1 && !parts[0].is_empty())
        }
        "soundcloud" => {
            matches!(host, "soundcloud.com" | "www.soundcloud.com")
                && parts.len() >= 2
                && parts.iter().all(|p| !p.is_empty())
        }
        _ => false,
    };
    if !valid {
        return Err(
            "This link does not match the selected provider or supported content type".into(),
        );
    }
    Ok(Some(url.to_string()))
}
pub fn validate_tracks(
    state: &AppState,
    provider: &str,
    tracks: &serde_json::Value,
) -> Result<(), String> {
    let entries = tracks.as_array().ok_or("Tracks must be an array")?;
    if entries.len() > 10000 {
        return Err("At most 10000 tracks are allowed".into());
    }
    if provider == "local" {
        for entry in entries {
            let id = entry
                .as_i64()
                .filter(|id| *id > 0)
                .ok_or("Local tracks must be managed integer IDs")?;
            track_path(state, id)?;
        }
    } else if !entries.is_empty() {
        return Err("External playlists use a provider link, without local tracks".into());
    }
    Ok(())
}

pub fn save_playlist(
    state: &AppState,
    id: Option<i64>,
    name: &str,
    provider: &str,
    source: Option<&str>,
    tracks: serde_json::Value,
) -> Result<i64, String> {
    if !state.edition.owns_library() || state.shutdown.is_cancelled() {
        return Err("Host is unavailable for playlist editing".into());
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or("Maintenance is active")?;
    let name = name.trim();
    if name.is_empty() || name.len() > 160 {
        return Err("Playlist name is required (maximum 160 characters)".into());
    }
    let source = validate_reference(provider, source)?;
    validate_tracks(state, provider, &tracks)?;
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    if let Some(id) = id {
        let changed=conn.execute("UPDATE goon_playlists SET name=?1,provider=?2,source_url=?3,tracks=?4,updated_at=?5 WHERE id=?6",rusqlite::params![name,provider,source,tracks.to_string(),crate::db::now_iso(),id]).map_err(|e|e.to_string())?;
        if changed == 0 {
            return Err("Playlist not found".into());
        }
        Ok(id)
    } else {
        conn.execute("INSERT INTO goon_playlists(name,provider,source_url,tracks,added_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",rusqlite::params![name,provider,source,tracks.to_string(),crate::db::now_iso()]).map_err(|e|e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}
pub fn delete_playlist(state: &AppState, id: i64) -> Result<(), String> {
    if !state.edition.owns_library() || state.shutdown.is_cancelled() {
        return Err("Host is unavailable for playlist editing".into());
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or("Maintenance is active")?;
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    if conn
        .execute("DELETE FROM goon_playlists WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("Playlist not found".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_links_reject_spoofed_hosts_and_credentials() {
        assert!(
            validate_reference("spotify", Some("https://open.spotify.com/playlist/abc")).is_ok()
        );
        for url in [
            "https://open.spotify.com.evil.test/track/abc",
            "https://user@open.spotify.com/track/abc",
            "http://open.spotify.com/track/abc",
            "https://open.spotify.com:444/track/abc",
        ] {
            assert!(validate_reference("spotify", Some(url)).is_err());
        }
        assert!(validate_reference("youtube", Some("https://youtu.be/abc")).is_ok());
        assert!(validate_reference(
            "soundcloud",
            Some("https://soundcloud.com/artist/sets/album")
        )
        .is_ok());
    }
}
