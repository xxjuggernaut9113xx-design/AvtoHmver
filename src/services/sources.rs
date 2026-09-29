//! Source creation shared by native Host and the Server adapters.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use serde::Serialize;
use serde_json::{json, Value};

use super::access::Caller;
use crate::{
    db::now_iso,
    downloader::run_download,
    slug::{derive_name_from_url, normalize_for_compare, slugify},
    AppState,
};

#[derive(Debug, Clone, Serialize)]
pub struct CreateSourcesResult {
    pub sources: Vec<Value>,
    pub duplicates: Vec<Value>,
    /// Entries rejected before creation (`{"index","url","error"}`). Only the
    /// import path fills this; single-source creation still fails fast.
    #[serde(default)]
    pub invalid: Vec<Value>,
    /// Newly created sources that had exported name/included/group metadata
    /// reapplied during import.
    #[serde(default)]
    pub metadata_restored: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceError {
    Forbidden,
    ShuttingDown,
    MaintenanceActive,
    Missing,
    MissingGroup,
    NothingToUpdate,
    RetentionLimit,
    RetentionConfirmation,
    InvalidInput(String),
    InvalidUrl(String),
    Database(String),
}

impl SourceError {
    pub fn message(&self) -> &str {
        match self {
            Self::Forbidden => "Viewer cannot modify local sources",
            Self::ShuttingDown => "Curator is shutting down",
            Self::MaintenanceActive => {
                "A local maintenance job is active. Try again when it completes."
            }
            Self::Missing => "Source not found",
            Self::MissingGroup => "Group not found",
            Self::NothingToUpdate => "Nothing to update",
            Self::RetentionLimit => "Retention must be at most 1,000,000 items",
            Self::RetentionConfirmation => {
                "Type ENABLE RETENTION before adding a rule while automatic cleanup is enabled."
            }
            Self::InvalidInput(message) | Self::InvalidUrl(message) | Self::Database(message) => {
                message
            }
        }
    }
}

pub fn set_group(
    state: &AppState,
    caller: Caller,
    id: i64,
    group_id: Option<i64>,
) -> Result<Value, SourceError> {
    if !caller.can_edit_library() || !state.edition.owns_library() {
        return Err(SourceError::Forbidden);
    }
    if state.shutdown.is_cancelled() {
        return Err(SourceError::ShuttingDown);
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or(SourceError::MaintenanceActive)?;
    let conn = state
        .pool
        .get()
        .map_err(|error| SourceError::Database(error.to_string()))?;
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM sources WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(|error| SourceError::Database(error.to_string()))?;
    if exists == 0 {
        return Err(SourceError::Missing);
    }
    if let Some(group_id) = group_id {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM groups WHERE id=?1",
                [group_id],
                |row| row.get(0),
            )
            .map_err(|error| SourceError::Database(error.to_string()))?;
        if exists == 0 {
            return Err(SourceError::MissingGroup);
        }
    }
    conn.execute(
        "UPDATE sources SET group_id=?1 WHERE id=?2",
        rusqlite::params![group_id, id],
    )
    .map_err(|error| SourceError::Database(error.to_string()))?;
    conn.query_row("SELECT * FROM sources WHERE id=?1", [id], row_to_json)
        .map_err(|error| SourceError::Database(error.to_string()))
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SourcePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub included: Option<bool>,
    /// Omitted means unchanged; `Some(None)` disables retention.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_keep_newest: Option<Option<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_confirmation: Option<String>,
}

pub async fn patch(
    state: Arc<AppState>,
    caller: Caller,
    id: i64,
    patch: SourcePatch,
) -> Result<Value, SourceError> {
    if !caller.can_edit_library() || !state.edition.owns_library() {
        return Err(SourceError::Forbidden);
    }
    if state.shutdown.is_cancelled() {
        return Err(SourceError::ShuttingDown);
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or(SourceError::MaintenanceActive)?;
    let automatic_cleanup_armed = state.settings.read().await.automatic_cleanup_mode != "never";
    if state.shutdown.is_cancelled() {
        return Err(SourceError::ShuttingDown);
    }
    let conn = state
        .pool
        .get()
        .map_err(|error| SourceError::Database(error.to_string()))?;
    let mut fields: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(name) = patch.name {
        fields.push("name=?".to_owned());
        values.push(Box::new(name));
    }
    if let Some(included) = patch.included {
        fields.push("included=?".to_owned());
        values.push(Box::new(if included { 1i64 } else { 0i64 }));
    }
    if let Some(keep_newest) = patch.retention_keep_newest {
        let keep_newest = keep_newest.unwrap_or(0);
        if keep_newest > 1_000_000 {
            return Err(SourceError::RetentionLimit);
        }
        if keep_newest > 0
            && automatic_cleanup_armed
            && patch.retention_confirmation.as_deref() != Some("ENABLE RETENTION")
        {
            return Err(SourceError::RetentionConfirmation);
        }
        if keep_newest == 0 {
            fields.push("retention_keep_newest=NULL".to_owned());
        } else {
            fields.push("retention_keep_newest=?".to_owned());
            values.push(Box::new(i64::from(keep_newest)));
        }
    }
    if fields.is_empty() {
        return Err(SourceError::NothingToUpdate);
    }
    let sql = format!("UPDATE sources SET {} WHERE id=?", fields.join(", "));
    values.push(Box::new(id));
    let refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value.as_ref()).collect();
    conn.execute(&sql, refs.as_slice())
        .map_err(|error| SourceError::Database(error.to_string()))?;
    conn.query_row("SELECT * FROM sources WHERE id=?1", [id], row_to_json)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => SourceError::Missing,
            other => SourceError::Database(other.to_string()),
        })
}

/// Remove a source after its owning download has stopped. This is shared by
/// the Host's direct command path and the Server's DELETE adapter.
pub async fn delete(
    state: Arc<AppState>,
    caller: Caller,
    id: i64,
    delete_files: bool,
) -> Result<Value, SourceError> {
    if !caller.can_edit_library() || !state.edition.owns_library() {
        return Err(SourceError::Forbidden);
    }
    if state.shutdown.is_cancelled() {
        return Err(SourceError::ShuttingDown);
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or(SourceError::MaintenanceActive)?;
    let slug: String = {
        let conn = state
            .pool
            .get()
            .map_err(|error| SourceError::Database(error.to_string()))?;
        conn.query_row("SELECT slug FROM sources WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => SourceError::Missing,
            other => SourceError::Database(other.to_string()),
        })?
    };
    if let Some(cancel) = state.source_cancellations.lock().await.get(&id).cloned() {
        cancel.cancel();
    }
    while state.running_sources.lock().await.contains(&id) {
        if state.shutdown.is_cancelled() {
            return Err(SourceError::ShuttingDown);
        }
        if let Some(cancel) = state.source_cancellations.lock().await.get(&id).cloned() {
            cancel.cancel();
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    if state.shutdown.is_cancelled() {
        return Err(SourceError::ShuttingDown);
    }
    {
        let conn = state
            .pool
            .get()
            .map_err(|error| SourceError::Database(error.to_string()))?;
        conn.execute("DELETE FROM sources WHERE id=?1", [id])
            .map_err(|error| SourceError::Database(error.to_string()))?;
    }
    if delete_files {
        let library_dir = state.library_dir.clone();
        let archives_dir = state.archives_dir.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let dest = library_dir.join(&slug);
            if dest.exists() {
                let dest_long = dunce::simplified(&dest).to_path_buf();
                let _ = std::fs::remove_dir_all(&dest_long);
            }
            let archive = archives_dir.join(format!("{slug}.sqlite3"));
            if archive.exists() {
                let _ = std::fs::remove_file(dunce::simplified(&archive));
            }
        })
        .await;
    }
    Ok(json!({"status":"deleted"}))
}

pub fn create(
    state: Arc<AppState>,
    candidates: Vec<String>,
) -> Result<CreateSourcesResult, SourceError> {
    if !state.edition.owns_library() {
        return Err(SourceError::Forbidden);
    }
    if state.shutdown.is_cancelled() {
        return Err(SourceError::ShuttingDown);
    }
    let _lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or(SourceError::MaintenanceActive)?;
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for candidate in candidates {
        let url = crate::url_guard::normalize_public_http_url(&candidate)
            .map_err(|error| SourceError::InvalidUrl(error.to_string()))?;
        if seen.insert(url.clone()) {
            normalized.push(url);
        }
    }
    if normalized.is_empty() {
        return Ok(CreateSourcesResult {
            sources: Vec::new(),
            duplicates: Vec::new(),
            invalid: Vec::new(),
            metadata_restored: 0,
        });
    }
    let conn = state
        .pool
        .get()
        .map_err(|error| SourceError::Database(error.to_string()))?;
    let existing: HashMap<String, String> = {
        let mut stmt = conn
            .prepare("SELECT url, name FROM sources")
            .map_err(|error| SourceError::Database(error.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| SourceError::Database(error.to_string()))?;
        rows.filter_map(Result::ok)
            .map(|(url, name)| (normalize_for_compare(&url), name))
            .collect()
    };
    let mut existing = existing;
    let mut to_create = Vec::new();
    let mut duplicates = Vec::new();
    for url in &normalized {
        let key = normalize_for_compare(url);
        if let Some(name) = existing.get(&key) {
            duplicates.push(json!({"url": url, "name": name}));
        } else {
            existing.insert(key, String::new());
            to_create.push(url.clone());
        }
    }
    let mut created_ids = Vec::new();
    for url in &to_create {
        let name = derive_name_from_url(url);
        let base_slug = slugify(&name);
        conn.execute(
            "INSERT INTO sources (name, url, slug, status, added_at, queued_at, progress_updated_at) VALUES (?1,?2,?3,'pending',?4,?4,?4)",
            rusqlite::params![name, url, base_slug, now_iso()],
        ).map_err(|error| SourceError::Database(error.to_string()))?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE sources SET slug=?1 WHERE id=?2",
            rusqlite::params![format!("{id}-{base_slug}"), id],
        )
        .map_err(|error| SourceError::Database(error.to_string()))?;
        created_ids.push(id);
    }
    for &id in &created_ids {
        state
            .download_tasks
            .spawn(run_download(Arc::clone(&state), id));
    }
    let sources = if created_ids.is_empty() {
        Vec::new()
    } else {
        let placeholders = created_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("SELECT * FROM sources WHERE id IN ({placeholders})");
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|error| SourceError::Database(error.to_string()))?;
        let params: Vec<&dyn rusqlite::ToSql> = created_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        let rows = stmt
            .query_map(params.as_slice(), row_to_json)
            .map_err(|error| SourceError::Database(error.to_string()))?;
        rows.filter_map(Result::ok).collect()
    };
    Ok(CreateSourcesResult {
        sources,
        duplicates,
        invalid: Vec::new(),
        metadata_restored: 0,
    })
}

pub fn row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let count = row.as_ref().column_count();
    let mut map = serde_json::Map::new();
    for index in 0..count {
        let name = row.as_ref().column_name(index).unwrap_or("?").to_string();
        let value = match row.get_ref(index)? {
            rusqlite::types::ValueRef::Null => Value::Null,
            rusqlite::types::ValueRef::Integer(number) => json!(number),
            rusqlite::types::ValueRef::Real(number) => json!(number),
            rusqlite::types::ValueRef::Text(bytes) | rusqlite::types::ValueRef::Blob(bytes) => {
                json!(std::str::from_utf8(bytes).unwrap_or(""))
            }
        };
        map.insert(name, value);
    }
    Ok(Value::Object(map))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, Json};

    #[tokio::test]
    async fn duplicate_source_result_matches_the_server_adapter() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let url: String = state
            .pool
            .get()
            .unwrap()
            .query_row("SELECT url FROM sources LIMIT 1", [], |row| row.get(0))
            .unwrap();
        let direct = create(state.clone(), vec![url.clone()]).unwrap();
        let http = crate::routes::sources::add(
            State(state.clone()),
            Json(crate::routes::sources::AddSourcesBody {
                urls: vec![url],
                text: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert!(direct.sources.is_empty());
        assert_eq!(
            serde_json::to_value(direct.duplicates).unwrap(),
            http["duplicates"]
        );
    }

    #[tokio::test]
    async fn source_creation_denies_viewer_shutdown_and_invalid_urls() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let mut viewer = (*state).clone();
        viewer.edition = crate::edition::Edition::Viewer;
        assert_eq!(
            create(Arc::new(viewer), vec![]).unwrap_err(),
            SourceError::Forbidden
        );
        assert!(matches!(
            create(state.clone(), vec!["file:///private".into()]),
            Err(SourceError::InvalidUrl(_))
        ));
        state.shutdown.cancel();
        assert_eq!(
            create(state, vec![]).unwrap_err(),
            SourceError::ShuttingDown
        );
    }

    #[tokio::test]
    async fn source_creation_waits_out_maintenance_admission() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let lease = state.maintenance.try_acquire_background_worker().unwrap();
        state
            .maintenance
            .start(
                state.clone(),
                crate::maintenance::MaintenanceRequest {
                    kind: crate::maintenance::MaintenanceKind::CreateBackup,
                    confirmation: String::new(),
                    backup_id: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            create(state.clone(), vec![]).unwrap_err(),
            SourceError::MaintenanceActive
        );
        drop(lease);
        state.server_tasks.close();
        state.server_tasks.wait().await;
    }

    #[tokio::test]
    async fn source_delete_keeps_or_removes_files_and_matches_http_adapter() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let file = state.library_dir.join("test").join("media.jpg");
        std::fs::write(&file, b"disposable media").unwrap();
        assert_eq!(
            delete(state.clone(), Caller::host(), 1, false)
                .await
                .unwrap(),
            json!({"status":"deleted"})
        );
        assert!(file.exists());
        assert_eq!(
            delete(state.clone(), Caller::host(), 1, false).await,
            Err(SourceError::Missing)
        );

        crate::test_support::source(&state);
        let archive = state.archives_dir.join("test.sqlite3");
        std::fs::write(&archive, b"disposable archive").unwrap();
        let http = crate::routes::sources::delete(
            axum::extract::State(state.clone()),
            axum::extract::Path(1),
            axum::extract::Query(crate::routes::sources::DeleteQuery { delete_files: true }),
            None,
        )
        .await
        .unwrap()
        .0;
        assert_eq!(http, json!({"status":"deleted"}));
        assert!(!file.exists());
        assert!(!archive.exists());
    }

    #[tokio::test]
    async fn source_delete_denies_viewer_and_shutdown_before_mutation() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let viewer = Caller::viewer(crate::native::ViewerPermissions::default());
        assert_eq!(
            delete(state.clone(), viewer, 1, false).await,
            Err(SourceError::Forbidden)
        );
        state.shutdown.cancel();
        assert_eq!(
            delete(state.clone(), Caller::host(), 1, false).await,
            Err(SourceError::ShuttingDown)
        );
        let count: i64 = state
            .pool
            .get()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sources WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn source_delete_is_excluded_during_maintenance() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let lease = state.maintenance.try_acquire_background_worker().unwrap();
        state
            .maintenance
            .start(
                state.clone(),
                crate::maintenance::MaintenanceRequest {
                    kind: crate::maintenance::MaintenanceKind::CreateBackup,
                    confirmation: String::new(),
                    backup_id: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            delete(state.clone(), Caller::host(), 1, true).await,
            Err(SourceError::MaintenanceActive)
        );
        assert!(state.library_dir.join("test").exists());
        drop(lease);
        state.server_tasks.close();
        state.server_tasks.wait().await;
    }

    #[tokio::test]
    async fn source_patch_matches_http_and_preserves_nullable_retention() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let direct = patch(
            state.clone(),
            Caller::host(),
            1,
            SourcePatch {
                name: Some("renamed".into()),
                included: Some(false),
                retention_keep_newest: Some(Some(9)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(direct["name"], "renamed");
        assert_eq!(direct["included"], 0);
        assert_eq!(direct["retention_keep_newest"], 9);
        let http = crate::routes::sources::patch(
            axum::extract::State(state.clone()),
            axum::extract::Path(1),
            None,
            Json(crate::routes::sources::PatchSourceBody {
                name: None,
                included: Some(true),
                retention_keep_newest: Some(None),
                retention_confirmation: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(http["included"], 1);
        assert_eq!(http["retention_keep_newest"], Value::Null);
        assert_eq!(http["name"], direct["name"]);
    }

    #[tokio::test]
    async fn source_patch_rejects_viewer_and_shutdown() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let patch_name = || SourcePatch {
            name: Some("blocked".into()),
            ..Default::default()
        };
        assert_eq!(
            patch(
                state.clone(),
                Caller::viewer(crate::native::ViewerPermissions::default()),
                1,
                patch_name(),
            )
            .await,
            Err(SourceError::Forbidden)
        );
        state.shutdown.cancel();
        assert_eq!(
            patch(state.clone(), Caller::host(), 1, patch_name()).await,
            Err(SourceError::ShuttingDown)
        );
        let name: String = state
            .pool
            .get()
            .unwrap()
            .query_row("SELECT name FROM sources WHERE id=1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "test");
    }

    #[tokio::test]
    async fn source_patch_is_excluded_during_maintenance() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        let lease = state.maintenance.try_acquire_background_worker().unwrap();
        state
            .maintenance
            .start(
                state.clone(),
                crate::maintenance::MaintenanceRequest {
                    kind: crate::maintenance::MaintenanceKind::CreateBackup,
                    confirmation: String::new(),
                    backup_id: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            patch(
                state.clone(),
                Caller::host(),
                1,
                SourcePatch {
                    included: Some(false),
                    ..Default::default()
                },
            )
            .await,
            Err(SourceError::MaintenanceActive)
        );
        drop(lease);
        state.server_tasks.close();
        state.server_tasks.wait().await;
    }

    #[tokio::test]
    async fn source_group_assignment_matches_http_and_rejects_viewer() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        crate::test_support::source(&state);
        state
            .pool
            .get()
            .unwrap()
            .execute(
                "INSERT INTO groups(id,name,added_at) VALUES(4,'Group','now')",
                [],
            )
            .unwrap();
        let direct = set_group(&state, Caller::host(), 1, Some(4)).unwrap();
        assert_eq!(direct["group_id"], 4);
        let http = crate::routes::sources::set_group(
            axum::extract::State(state.clone()),
            axum::extract::Path(1),
            None,
            Json(crate::routes::sources::SetGroupBody { group_id: None }),
        )
        .await
        .unwrap()
        .0;
        assert!(http["group_id"].is_null());
        assert_eq!(http["id"], direct["id"]);
        assert_eq!(
            set_group(
                &state,
                Caller::viewer(crate::native::ViewerPermissions::default()),
                1,
                Some(4)
            ),
            Err(SourceError::Forbidden)
        );
        assert_eq!(
            set_group(&state, Caller::host(), 1, Some(999)),
            Err(SourceError::MissingGroup)
        );
    }
}
