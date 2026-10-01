//! Shared presentation drafts and optimistic, transactional preset storage.
use crate::AppState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct PlaybackPreset {
    pub version: u32,
    pub id: Option<i64>,
    pub revision: u64,
    pub name: String,
    pub media_ids: Vec<i64>,
    pub collection_id: Option<i64>,
    pub tags: Vec<String>,
    pub media_types: Vec<String>,
    pub order: String,
    pub display_fit: String,
    pub captions: bool,
    pub music_source: String,
    pub playlist_id: Option<i64>,
    pub music_volume: f64,
}

impl Default for PlaybackPreset {
    fn default() -> Self {
        Self {
            version: 1,
            id: None,
            revision: 0,
            name: "Untitled".into(),
            media_ids: vec![],
            collection_id: None,
            tags: vec![],
            media_types: vec!["image".into(), "video".into()],
            order: "shuffled".into(),
            display_fit: "contain".into(),
            captions: true,
            music_source: "none".into(),
            playlist_id: None,
            music_volume: 0.5,
        }
    }
}

#[derive(Debug)]
pub enum Error {
    Invalid(String),
    Missing,
    Conflict,
    Database(String),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(s) | Self::Database(s) => f.write_str(s),
            Self::Missing => f.write_str("Preset not found"),
            Self::Conflict => f.write_str("This preset changed. Reload it or Save as new."),
        }
    }
}
fn db(e: impl std::fmt::Display) -> Error {
    Error::Database(e.to_string())
}

fn schema(conn: &rusqlite::Connection) -> Result<(), Error> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS playback_presets (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)").map_err(db)
}
pub fn list(state: &AppState) -> Result<Vec<PlaybackPreset>, Error> {
    let conn = state.pool.get().map_err(db)?;
    schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT body FROM playback_presets ORDER BY id")
        .map_err(db)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(db)?;
    rows.map(|r| serde_json::from_str(&r.map_err(db)?).map_err(db))
        .collect()
}
pub fn validate(p: &PlaybackPreset) -> Result<(), Error> {
    if p.version != 1
        || p.name.trim().is_empty()
        || p.name.len() > 160
        || !matches!(p.order.as_str(), "shuffled" | "sequential")
        || !matches!(p.display_fit.as_str(), "contain" | "cover")
        || !matches!(
            p.music_source.as_str(),
            "none" | "local" | "spotify" | "apple_music" | "youtube" | "soundcloud"
        )
        || !p.music_volume.is_finite()
        || !(0.0..=1.0).contains(&p.music_volume)
        || p.media_ids.len() > 10000
        || p.tags.len() > 100
        || p.media_types.is_empty()
        || p.media_types
            .iter()
            .any(|s| !matches!(s.as_str(), "image" | "video" | "gif"))
        || p.media_ids.iter().any(|id| *id <= 0)
        || p.tags.iter().any(|s| s.len() > 160)
    {
        return Err(Error::Invalid("Invalid playback preset".into()));
    }
    Ok(())
}
pub fn save(state: &AppState, mut preset: PlaybackPreset) -> Result<PlaybackPreset, Error> {
    validate(&preset)?;
    if !state.edition.owns_library() || state.shutdown.is_cancelled() {
        return Err(Error::Invalid("Viewer cannot edit presets".into()));
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or_else(|| Error::Invalid("Maintenance is active".into()))?;
    let mut conn = state.pool.get().map_err(db)?;
    schema(&conn)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(db)?;
    preset.name = preset.name.trim().to_string();
    if let Some(id) = preset.id {
        let revision: u64 = tx
            .query_row(
                "SELECT revision FROM playback_presets WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| {
                if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                    Error::Missing
                } else {
                    db(e)
                }
            })?;
        if revision != preset.revision {
            return Err(Error::Conflict);
        }
        preset.revision = revision + 1;
    } else {
        tx.execute(
            "INSERT INTO playback_presets(revision,body) VALUES(1,'{}')",
            [],
        )
        .map_err(db)?;
        preset.id = Some(tx.last_insert_rowid());
        preset.revision = 1;
    }
    tx.execute(
        "UPDATE playback_presets SET revision=?1,body=?2 WHERE id=?3",
        rusqlite::params![
            preset.revision,
            serde_json::to_string(&preset).map_err(db)?,
            preset.id
        ],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(preset)
}
pub fn delete(state: &AppState, id: i64, revision: u64) -> Result<(), Error> {
    if !state.edition.owns_library() || state.shutdown.is_cancelled() {
        return Err(Error::Invalid(
            "Host is unavailable for preset editing".into(),
        ));
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or_else(|| Error::Invalid("Maintenance is active".into()))?;
    let conn = state.pool.get().map_err(db)?;
    schema(&conn)?;
    if conn
        .execute(
            "DELETE FROM playback_presets WHERE id=?1 AND revision=?2",
            rusqlite::params![id, revision],
        )
        .map_err(db)?
        == 0
    {
        return Err(Error::Conflict);
    }
    Ok(())
}

/// Resolve the draft at Start, without mutating a saved preset or session clock.
pub async fn resolve(state: &AppState, p: PlaybackPreset) -> Result<Vec<serde_json::Value>, Error> {
    validate(&p)?;
    let conn = state.pool.get().map_err(db)?;
    if let Some(id) = p.playlist_id {
        let provider: String = conn
            .query_row(
                "SELECT provider FROM goon_playlists WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| Error::Invalid("The selected playlist is missing".into()))?;
        if provider != p.music_source {
            return Err(Error::Invalid(
                "Playlist provider does not match the music source".into(),
            ));
        }
        if provider == "local" {
            let tracks: String = conn
                .query_row("SELECT tracks FROM goon_playlists WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .map_err(db)?;
            crate::services::music::validate_tracks(
                state,
                &provider,
                &serde_json::from_str(&tracks).map_err(db)?,
            )
            .map_err(Error::Invalid)?;
        }
    }
    if p.music_source != "none" && p.playlist_id.is_none() {
        return Err(Error::Invalid(
            "Select a music playlist or choose None".into(),
        ));
    }
    for id in &p.media_ids {
        conn.query_row(
            "SELECT id FROM media WHERE id=?1 AND downloaded=1",
            [id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|_| Error::Invalid(format!("Selected media {id} is missing or unavailable")))?;
    }
    for tag in &p.tags {
        conn.query_row(
            "SELECT id FROM tags WHERE LOWER(name)=LOWER(?1)",
            [tag],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|_| Error::Invalid(format!("Selected tag '{tag}' is missing")))?;
    }
    if let Some(id) = p.collection_id {
        conn.query_row("SELECT id FROM groups WHERE id=?1", [id], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|_| Error::Invalid("The selected collection is missing".into()))?;
    }
    drop(conn);
    let mut cursor = None;
    let mut items = vec![];
    loop {
        let page = crate::services::library::list(
            state,
            crate::services::library::MediaQuery {
                group_id: p.collection_id,
                tags: (!p.tags.is_empty()).then(|| p.tags.join(",")),
                limit: Some(500),
                cursor,
                sort: Some("date_asc".into()),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| Error::Invalid(e.message().into()))?;
        items.extend(
            page.media
                .into_iter()
                .filter(|m| {
                    let id = m.get("id").and_then(|v| v.as_i64()).unwrap_or_default();
                    let kind = m.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                    (p.media_ids.is_empty() || p.media_ids.contains(&id))
                        && p.media_types.iter().any(|s| s == kind)
                })
                .map(|m| serde_json::json!(m)),
        );
        if !page.has_more {
            break;
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            return Err(Error::Invalid("Library pagination is unavailable".into()));
        }
    }
    if items.is_empty() {
        return Err(Error::Invalid(
            "No media matches this draft. Check its selection and filters.".into(),
        ));
    }
    if p.order == "shuffled" {
        use rand::seq::SliceRandom;
        items.shuffle(&mut rand::thread_rng());
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_save_and_delete_cannot_overwrite_another_client() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let original = save(&state, PlaybackPreset::default()).unwrap();
        let mut draft = original.clone();
        draft.name = "Renamed".into();
        let saved = save(&state, draft).unwrap();
        assert!(matches!(
            save(&state, original.clone()),
            Err(Error::Conflict)
        ));
        assert!(matches!(
            delete(&state, original.id.unwrap(), original.revision),
            Err(Error::Conflict)
        ));
        assert_eq!(list(&state).unwrap(), vec![saved.clone()]);
        delete(&state, saved.id.unwrap(), saved.revision).unwrap();
        assert!(list(&state).unwrap().is_empty());
    }
}
