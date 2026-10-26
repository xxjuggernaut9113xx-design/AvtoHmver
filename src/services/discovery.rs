//! Typed discovery: provider registry, search orchestration, and the
//! provider-normalized result adapters shared by native Host and the Server
//! HTTP adapter.
//!
//! AvtoHmver never downloads search results itself. Providers return source or
//! gallery URLs and the selected compatible URLs are handed to the
//! established gallery-dl source queue.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
    pub authentication_required: bool,
    pub availability: String,
    pub generated: bool,
    pub curated: bool,
    pub result_types: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_template: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderRegistry {
    pub providers: Vec<ProviderDescriptor>,
    pub gallery_dl_version: Option<String>,
}

impl ProviderRegistry {
    pub fn descriptor(&self, id: &str) -> Option<&ProviderDescriptor> {
        let normalized = if id == "gallery-dl" { "local" } else { id };
        self.providers
            .iter()
            .find(|provider| provider.id == normalized)
    }

    /// Linear membership check. The registry holds roughly a hundred
    /// descriptors; building a throwaway `HashSet` per search request costs
    /// more than the scan it avoids.
    pub fn contains(&self, id: &str) -> bool {
        let normalized = if id == "gallery-dl" { "local" } else { id };
        self.providers
            .iter()
            .any(|provider| provider.id == normalized)
    }

    pub fn ids(&self) -> HashSet<String> {
        self.providers
            .iter()
            .map(|provider| provider.id.clone())
            .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderCatalog {
    pub providers: Vec<ProviderDescriptor>,
    pub gallery_dl_version: Option<String>,
}

pub fn providers(state: &AppState) -> Result<ProviderCatalog, &'static str> {
    if !state.edition.owns_library() {
        return Err("Viewer cannot inspect a local discovery registry");
    }
    if state.shutdown.is_cancelled() {
        return Err("AvtoHmver is shutting down");
    }
    Ok(ProviderCatalog {
        providers: state.search_registry.providers.clone(),
        gallery_dl_version: state.search_registry.gallery_dl_version.clone(),
    })
}

// ─── Registry construction ───────────────────────────────────────────────────

fn descriptor(
    id: &str,
    name: &str,
    capabilities: &[&str],
    authentication_required: bool,
    availability: &str,
    result_types: &[&str],
    search_template: Option<&str>,
) -> ProviderDescriptor {
    let direct_url_only = id != "local" && !capabilities.contains(&"search");
    ProviderDescriptor {
        id: id.into(),
        name: name.into(),
        capabilities: capabilities.iter().map(|value| (*value).into()).collect(),
        authentication_required,
        availability: if direct_url_only {
            "direct_url_only".into()
        } else {
            availability.into()
        },
        generated: false,
        curated: true,
        result_types: result_types.iter().map(|value| (*value).into()).collect(),
        search_template: (!direct_url_only)
            .then(|| search_template.map(str::to_owned))
            .flatten(),
    }
}

/// A curated baseline intentionally exceeds forty adapters.  Many are
/// download-only until gallery-dl exposes a query/tag extractor for that
/// version, but they remain visible and their capability status is explicit.
fn curated_providers() -> Vec<ProviderDescriptor> {
    let page = &["page", "download"];
    // Only providers with a verified query adapter advertise search.
    let searchable = &["page", "download", "direct_url"];
    vec![
        descriptor(
            "local",
            "AvtoHmver library",
            &["catalog"],
            false,
            "available",
            &["creator", "album", "post"],
            None,
        ),
        descriptor(
            "balbums",
            "Balbums / Bunkr",
            &["search", "page", "download"],
            false,
            "available",
            &["album", "collection"],
            Some("https://balbums.st/?search={QUERY}"),
        ),
        descriptor("bunkr", "Bunkr", page, false, "available", &["album"], None),
        descriptor(
            "kemono",
            "Kemono",
            &["search", "page", "download", "direct_url"],
            false,
            "available",
            &["creator", "post"],
            Some("https://kemono.cr/{QUERY}"),
        ),
        descriptor(
            "erome",
            "Erome",
            &["search", "page", "download", "direct_url"],
            false,
            "available",
            &["album", "creator"],
            Some("https://www.erome.com/search?q={QUERY}"),
        ),
        descriptor(
            "redgifs",
            "Redgifs",
            &["search", "page", "download", "direct_url"],
            false,
            "available",
            &["post", "creator"],
            Some("https://www.redgifs.com/search?query={QUERY}"),
        ),
        descriptor(
            "deviantart",
            "DeviantArt",
            searchable,
            true,
            "authentication_optional",
            &["creator", "album", "post"],
            Some("https://www.deviantart.com/search?q={QUERY}"),
        ),
        descriptor(
            "pixiv",
            "Pixiv",
            searchable,
            true,
            "authentication_optional",
            &["creator", "tag", "post"],
            Some("https://www.pixiv.net/en/tags/{QUERY}/artworks"),
        ),
        descriptor(
            "twitter",
            "X / Twitter",
            searchable,
            true,
            "authentication_optional",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "bluesky",
            "Bluesky",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://bsky.app/search?q={QUERY}"),
        ),
        descriptor(
            "mastodon",
            "Mastodon",
            searchable,
            false,
            "experimental",
            &["creator", "post", "tag"],
            None,
        ),
        descriptor(
            "instagram",
            "Instagram",
            page,
            true,
            "authentication_required",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "tumblr",
            "Tumblr",
            searchable,
            false,
            "available",
            &["creator", "tag", "post"],
            Some("https://www.tumblr.com/search/{QUERY}"),
        ),
        descriptor(
            "reddit",
            "Reddit",
            searchable,
            false,
            "available",
            &["creator", "tag", "post"],
            Some("https://www.reddit.com/search/?q={QUERY}"),
        ),
        descriptor(
            "imgur",
            "Imgur",
            searchable,
            false,
            "available",
            &["album", "post"],
            Some("https://imgur.com/search?q={QUERY}"),
        ),
        descriptor(
            "flickr",
            "Flickr",
            searchable,
            false,
            "available",
            &["creator", "album", "post"],
            Some("https://www.flickr.com/search/?text={QUERY}"),
        ),
        descriptor(
            "pinterest",
            "Pinterest",
            searchable,
            true,
            "authentication_optional",
            &["creator", "board", "post"],
            None,
        ),
        descriptor(
            "artstation",
            "ArtStation",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://www.artstation.com/search?q={QUERY}"),
        ),
        descriptor(
            "behance",
            "Behance",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://www.behance.net/search/projects?search={QUERY}"),
        ),
        descriptor(
            "fanbox",
            "FANBOX",
            page,
            true,
            "authentication_required",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "fantia",
            "Fantia",
            page,
            true,
            "authentication_required",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "patreon",
            "Patreon",
            page,
            true,
            "authentication_required",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "coomer",
            "Coomer",
            &["search", "page", "download", "direct_url"],
            false,
            "available",
            &["creator", "post"],
            Some("https://coomer.st/{QUERY}"),
        ),
        descriptor(
            "danbooru",
            "Danbooru",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://danbooru.donmai.us/posts?tags={TAG}"),
        ),
        descriptor(
            "gelbooru",
            "Gelbooru",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://gelbooru.com/index.php?page=post&s=list&tags={TAG}"),
        ),
        descriptor(
            "safebooru",
            "Safebooru",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://safebooru.org/index.php?page=post&s=list&tags={TAG}"),
        ),
        descriptor(
            "yandere",
            "yande.re",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://yande.re/post?tags={TAG}"),
        ),
        descriptor(
            "konachan",
            "Konachan",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://konachan.com/post?tags={TAG}"),
        ),
        descriptor(
            "e621",
            "e621",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://e621.net/posts?tags={TAG}"),
        ),
        descriptor(
            "e926",
            "e926",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://e926.net/posts?tags={TAG}"),
        ),
        descriptor(
            "rule34",
            "Rule 34",
            searchable,
            false,
            "available",
            &["tag", "post"],
            Some("https://rule34.xxx/index.php?page=post&s=list&tags={TAG}"),
        ),
        descriptor(
            "sankaku",
            "Sankaku",
            searchable,
            true,
            "authentication_optional",
            &["tag", "post"],
            None,
        ),
        descriptor(
            "nhentai",
            "nhentai",
            searchable,
            false,
            "available",
            &["tag", "album"],
            Some("https://nhentai.net/search/?q={QUERY}"),
        ),
        descriptor(
            "hentaifoundry",
            "Hentai Foundry",
            page,
            true,
            "authentication_optional",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "newgrounds",
            "Newgrounds",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://www.newgrounds.com/search/conduct/art?terms={QUERY}"),
        ),
        descriptor(
            "weasyl",
            "Weasyl",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://www.weasyl.com/search?q={QUERY}"),
        ),
        descriptor(
            "inkbunny",
            "Inkbunny",
            searchable,
            true,
            "authentication_required",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "furaffinity",
            "Fur Affinity",
            page,
            true,
            "authentication_required",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "smugmug",
            "SmugMug",
            page,
            false,
            "available",
            &["album", "post"],
            None,
        ),
        descriptor(
            "vsco",
            "VSCO",
            page,
            false,
            "available",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "500px",
            "500px",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://500px.com/search?q={QUERY}"),
        ),
        descriptor(
            "gofile",
            "GoFile",
            page,
            false,
            "available",
            &["album"],
            None,
        ),
        descriptor("mega", "MEGA", page, false, "available", &["album"], None),
        descriptor(
            "telegram",
            "Telegram",
            page,
            false,
            "experimental",
            &["creator", "post"],
            None,
        ),
        descriptor(
            "youtube",
            "YouTube",
            searchable,
            false,
            "available",
            &["creator", "playlist", "post"],
            Some("https://www.youtube.com/results?search_query={QUERY}"),
        ),
        descriptor(
            "vimeo",
            "Vimeo",
            searchable,
            false,
            "available",
            &["creator", "post"],
            Some("https://vimeo.com/search?q={QUERY}"),
        ),
        descriptor(
            "soundcloud",
            "SoundCloud",
            searchable,
            false,
            "available",
            &["creator", "playlist"],
            Some("https://soundcloud.com/search?q={QUERY}"),
        ),
    ]
}

fn generated_provider_templates(extractors: &str) -> Vec<ProviderDescriptor> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for line in extractors.lines() {
        let lower = line.to_ascii_lowercase();
        if !(lower.contains("query")
            || lower.contains("{query}")
            || lower.contains("<query>")
            || lower.contains("tag"))
        {
            continue;
        }
        let raw = line.split_whitespace().next().unwrap_or_default();
        let id = raw
            .trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_')
            .to_ascii_lowercase();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        // Keep the extractor identity as the provider id.  This lets a
        // curated adapter with the same id replace the generated template
        // when gallery-dl learns a new search extractor or changes its list.
        output.push(ProviderDescriptor {
            id: id.clone(),
            name: format!("gallery-dl: {id}"),
            capabilities: vec!["page".into(), "download".into(), "direct_url".into()],
            authentication_required: false,
            availability: "direct_url_only".into(),
            generated: true,
            curated: false,
            result_types: vec!["post".into(), "tag".into()],
            // A gallery-dl extractor listing is useful for discovery but not
            // proof that AvtoHmver has a safe, normalized query adapter. Keep
            // generated providers direct-URL-only until an adapter exists.
            search_template: None,
        });
    }
    output
}

/// Build once at startup. gallery-dl's extractor list is version dependent;
/// generated templates supplement, but never overwrite, curated adapters.
pub fn default_provider_registry() -> ProviderRegistry {
    ProviderRegistry {
        providers: curated_providers(),
        gallery_dl_version: None,
    }
}

pub fn build_provider_registry(gallery_dl_bin: &str) -> ProviderRegistry {
    let version = crate::process::output_timeout(
        crate::process::blocking_command(gallery_dl_bin).arg("--version"),
        Duration::from_secs(3),
    )
    .ok()
    .filter(|output| output.status.success())
    .map(|output| {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string()
    })
    .filter(|value| !value.is_empty());
    let extractors = crate::process::output_timeout(
        crate::process::blocking_command(gallery_dl_bin).arg("--list-extractors"),
        Duration::from_secs(5),
    )
    .ok()
    .filter(|output| output.status.success())
    .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
    .unwrap_or_default();
    let mut providers = curated_providers();
    let curated_ids = providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect::<HashSet<_>>();
    providers.extend(
        generated_provider_templates(&extractors)
            .into_iter()
            .filter(|provider| !curated_ids.contains(&provider.id)),
    );
    ProviderRegistry {
        providers,
        gallery_dl_version: version,
    }
}

// ─── Search orchestration ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub creator: Option<String>,
    pub thumbnail: Option<String>,
    pub source: String,
    pub source_url: String,
    pub provider: String,
    pub result_type: String,
    pub item_count: Option<i64>,
    #[serde(default)]
    pub total_bytes: Option<i64>,
    pub date: Option<String>,
    pub gallery_dl_compatible: bool,
    /// Set only by AvtoHmver's adapters after the URL has passed the page-URL
    /// guard. CDN/media file URLs are preview-only.
    #[serde(default)]
    pub gallery_dl_validated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SearchQuery {
    #[serde(alias = "q")]
    pub query: Option<String>,
    pub provider: Option<String>,
    /// Comma-separated multi-select. `provider` remains compatible with
    /// older callers and is merged when both fields are present.
    pub providers: Option<String>,
    pub result_type: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub paged: bool,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProviderError {
    pub provider: String,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub providers: Vec<String>,
    pub provider_errors: Vec<ProviderError>,
    pub next_cursor: Option<String>,
}

#[derive(Default)]
pub(crate) struct SearchPages {
    snapshots: HashMap<String, SearchSnapshot>,
}

type SearchSnapshot = (
    std::time::Instant,
    SearchResponse,
    Vec<ProviderContinuation>,
);

#[derive(Clone)]
struct ProviderContinuation {
    provider: String,
    base: Option<String>,
    query: String,
    page: u64,
    result_type: String,
}

impl SearchPages {
    fn first(
        &mut self,
        mut response: SearchResponse,
        limit: usize,
        remote: Vec<ProviderContinuation>,
    ) -> SearchResponse {
        self.snapshots
            .retain(|_, (created, _, _)| created.elapsed() < Duration::from_secs(600));
        if response.results.len() <= limit && remote.is_empty() {
            return response;
        }
        if self.snapshots.len() >= 32 {
            if let Some(oldest) = self
                .snapshots
                .iter()
                .min_by_key(|(_, (created, _, _))| created)
                .map(|(id, _)| id.clone())
            {
                self.snapshots.remove(&oldest);
            }
        }
        let id = format!("{:032x}", rand::random::<u128>());
        self.snapshots.insert(
            id.clone(),
            (std::time::Instant::now(), response.clone(), remote),
        );
        response.results.truncate(limit);
        response.next_cursor = Some(format!("{id}:{}", response.results.len()));
        response
    }

    fn next(&mut self, cursor: &str, limit: usize) -> Result<SearchResponse, SearchError> {
        let bad = || {
            SearchError::BadRequest(
                "Discover search expired or cursor is invalid. Search again.".into(),
            )
        };
        let (id, offset) = cursor.split_once(':').ok_or_else(bad)?;
        let offset = offset.parse::<usize>().map_err(|_| bad())?;
        let (created, snapshot, remote) = self.snapshots.get(id).ok_or_else(bad)?;
        if created.elapsed() >= Duration::from_secs(600) || offset > snapshot.results.len() {
            return Err(bad());
        }
        let end = offset.saturating_add(limit).min(snapshot.results.len());
        Ok(SearchResponse {
            results: snapshot.results[offset..end].to_vec(),
            providers: snapshot.providers.clone(),
            provider_errors: snapshot.provider_errors.clone(),
            next_cursor: (end < snapshot.results.len() || !remote.is_empty())
                .then(|| format!("{id}:{end}")),
        })
    }

    fn pending_remote(&self, cursor: &str) -> Option<ProviderContinuation> {
        let (id, offset) = cursor.split_once(':')?;
        let offset = offset.parse::<usize>().ok()?;
        let (created, snapshot, remote) = self.snapshots.get(id)?;
        (created.elapsed() < Duration::from_secs(600) && offset == snapshot.results.len())
            .then(|| remote.first().cloned())
            .flatten()
    }

    fn append_remote(
        &mut self,
        cursor: &str,
        expected: &ProviderContinuation,
        mut results: Vec<SearchResult>,
        more: bool,
    ) {
        let Some((id, _)) = cursor.split_once(':') else {
            return;
        };
        let Some((_, snapshot, remote)) = self.snapshots.get_mut(id) else {
            return;
        };
        // Concurrent retries of a cursor may fetch twice, but commit once.
        if remote.first().map(|value| (&value.provider, value.page))
            != Some((&expected.provider, expected.page))
        {
            return;
        }
        if !expected.result_type.is_empty() {
            results.retain(|value| value.result_type == expected.result_type);
        }
        let mut seen: HashSet<_> = snapshot
            .results
            .iter()
            .map(|value| value.source_url.clone())
            .collect();
        results.retain(|value| seen.insert(value.source_url.clone()));
        let progressed = !results.is_empty();
        snapshot.results.extend(results);
        snapshot
            .provider_errors
            .retain(|error| error.provider != expected.provider);
        if more && progressed {
            remote[0].page += 1;
            remote.rotate_left(1);
        } else {
            remote.remove(0);
        }
    }

    fn failed_remote(&mut self, cursor: &str, expected: &ProviderContinuation, error: String) {
        let Some((id, _)) = cursor.split_once(':') else {
            return;
        };
        let Some((_, snapshot, remote)) = self.snapshots.get_mut(id) else {
            return;
        };
        if remote.first().map(|value| (&value.provider, value.page))
            != Some((&expected.provider, expected.page))
        {
            return;
        }
        snapshot
            .provider_errors
            .retain(|error| error.provider != expected.provider);
        snapshot.provider_errors.push(ProviderError {
            provider: expected.provider.clone(),
            error,
        });
        // Keep the failed page for retry while allowing healthy providers to advance.
        remote.rotate_left(1);
    }
}

/// Service-level search failure. The HTTP adapter maps these to the same
/// status codes and `{"error": message}` shapes the inline handler produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchError {
    BadRequest(String),
    Internal(String),
}

fn requested_provider_ids(query: &SearchQuery, defaults: &[String]) -> Vec<String> {
    let mut values = Vec::new();
    for raw in query
        .providers
        .as_deref()
        .into_iter()
        .chain(query.provider.as_deref())
    {
        values.extend(
            raw.split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_ascii_lowercase()),
        );
    }
    if values.is_empty() {
        values.extend(defaults.iter().cloned());
    }
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| {
            if value == "gallery-dl" {
                "local".to_string()
            } else {
                value
            }
        })
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

/// Local catalog search. Deliberately synchronous: a rusqlite connection
/// must never be held across a network await in an Axum handler.
fn search_local_catalog(conn: &Connection, query: &str) -> rusqlite::Result<Vec<SearchResult>> {
    let needle = format!("%{}%", query.trim());
    let mut results = Vec::new();
    let mut sources = conn.prepare(
        "SELECT s.name,s.url,s.item_count,s.added_at,
                (SELECT sm.creator FROM source_metadata sm
                 JOIN media m ON m.id=sm.media_id WHERE m.source_id=s.id
                 ORDER BY sm.id DESC LIMIT 1) AS creator,
                (SELECT CASE WHEN COUNT(*)=COUNT(file_size_bytes) THEN COALESCE(SUM(file_size_bytes),0) END FROM media WHERE source_id=s.id) AS total_bytes,
                (SELECT MIN(id) FROM media WHERE source_id=s.id AND downloaded=1 AND missing=0 AND type IN ('image','video')) AS thumbnail_id
         FROM sources s WHERE s.name LIKE ?1 COLLATE NOCASE OR s.url LIKE ?1 COLLATE NOCASE
         ORDER BY s.item_count DESC,s.id DESC LIMIT 2000",
    )?;
    for result in sources
        .query_map([&needle], |row| {
            Ok(SearchResult {
                title: row.get(0)?,
                creator: row.get(4)?,
                thumbnail: row
                    .get::<_, Option<i64>>(6)?
                    .map(|id| format!("/api/thumb/{id}")),
                source: "AvtoHmver library".to_string(),
                source_url: row.get(1)?,
                provider: "local".to_string(),
                result_type: "album".to_string(),
                item_count: row.get(2)?,
                total_bytes: row.get(5)?,
                date: row.get(3)?,
                gallery_dl_compatible: true,
                gallery_dl_validated: true,
                relevance: Some(100),
            })
        })?
        .flatten()
    {
        results.push(result);
    }

    let mut creators = conn.prepare(
        "SELECT sm.creator,COUNT(DISTINCT m.id),MIN(s.url),MAX(sm.captured_at),
                CASE WHEN COUNT(*)=COUNT(m.file_size_bytes) THEN COALESCE(SUM(m.file_size_bytes),0) END, MIN(CASE WHEN m.downloaded=1 AND m.missing=0 THEN m.id END)
         FROM (SELECT media_id,creator,MAX(captured_at) AS captured_at FROM source_metadata GROUP BY media_id,creator) sm JOIN media m ON m.id=sm.media_id
         JOIN sources s ON s.id=m.source_id
         WHERE sm.creator IS NOT NULL AND sm.creator<>''
           AND sm.creator LIKE ?1 COLLATE NOCASE
         GROUP BY sm.creator ORDER BY COUNT(DISTINCT m.id) DESC,sm.creator COLLATE NOCASE LIMIT 2000",
    )?;
    for result in creators
        .query_map([&needle], |row| {
            let title: String = row.get(0)?;
            Ok(SearchResult {
                creator: Some(title.clone()),
                title,
                thumbnail: row
                    .get::<_, Option<i64>>(5)?
                    .map(|id| format!("/api/thumb/{id}")),
                source: "AvtoHmver library".to_string(),
                source_url: row.get(2)?,
                provider: "local".to_string(),
                result_type: "creator".to_string(),
                item_count: row.get(1)?,
                total_bytes: row.get(4)?,
                date: row.get(3)?,
                gallery_dl_compatible: true,
                gallery_dl_validated: true,
                relevance: Some(90),
            })
        })?
        .flatten()
    {
        results.push(result);
    }
    Ok(results)
}

fn parse_erome(html: &str) -> Vec<SearchResult> {
    static ALBUM: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
        r#"(?is)<a\b[^>]*\bhref\s*=\s*["'](?:https://(?:www\.)?erome\.com)?/a/(?P<id>[a-zA-Z0-9]+)["'][^>]*>(?P<body>.*?)</a>"#
    ).unwrap()
    });
    static COVER: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"(?is)<img\b[^>]*\b(?:data-src|src)\s*=\s*["'](?P<url>https://[^"']+)["']"#)
            .unwrap()
    });
    static TITLE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"(?is)\b(?:title|alt)\s*=\s*["'](?P<title>[^"']+)["']"#).unwrap()
    });
    let mut results = Vec::<SearchResult>::new();
    for card in ALBUM.captures_iter(html) {
        let id = &card["id"];
        let body = &card["body"];
        let thumbnail = COVER
            .captures(body)
            .map(|cover| html_text(&cover["url"]))
            .filter(|url| crate::url_guard::normalize_public_http_url(url).is_ok());
        let title = TITLE
            .captures(card.get(0).unwrap().as_str())
            .map(|title| html_text(&title["title"]))
            .filter(|title| !title.is_empty())
            .or_else(|| {
                let text = html_text(body);
                (!text.is_empty()).then_some(text)
            })
            .unwrap_or_else(|| id.to_owned());
        let source_url = format!("https://www.erome.com/a/{id}");
        if let Some(existing) = results
            .iter_mut()
            .find(|result| result.source_url == source_url)
        {
            if existing.title == id && title != id {
                existing.title = title;
            }
            if existing.thumbnail.is_none() {
                existing.thumbnail = thumbnail;
            }
            continue;
        }
        results.push(SearchResult {
            title,
            creator: None,
            thumbnail,
            source: "erome.com".into(),
            source_url,
            provider: "erome".into(),
            result_type: "album".into(),
            item_count: None,
            total_bytes: None,
            date: None,
            gallery_dl_compatible: true,
            gallery_dl_validated: true,
            relevance: Some(80),
        });
    }
    results
}

async fn search_erome(query: &str) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    for page in 1..=3 {
        let (albums, more) = search_erome_page(query, page).await?;
        results.extend(albums);
        if !more {
            break;
        }
    }
    Ok(results)
}

async fn search_erome_page(query: &str, page: u64) -> Result<(Vec<SearchResult>, bool), String> {
    if let Some(result) = provider_direct_url_result("erome", query) {
        return Ok((vec![result], false));
    }
    if query.starts_with("https://") || query.starts_with("http://") {
        return Ok((Vec::new(), false));
    }
    let client = reqwest::Client::builder()
        .user_agent("AvtoHmver discovery")
        .timeout(Duration::from_secs(5))
        .redirect(crate::url_guard::public_redirect_policy())
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get("https://www.erome.com/search")
        .query(&[("q", query), ("page", &page.to_string())])
        .send()
        .await
        .map_err(|error| format!("Erome search unavailable: {error}; paste an album URL instead"))?
        .error_for_status()
        .map_err(|error| format!("Erome search failed: {error}; paste an album URL instead"))?;
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if bytes.len().saturating_add(chunk.len()) > 4 * 1024 * 1024 {
            return Err("Erome search response exceeded 4 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let html = String::from_utf8(bytes).map_err(|_| "Erome returned non-text search data")?;
    let lower = html.to_ascii_lowercase();
    if lower.contains("cf-chl-") || lower.contains("<title>just a moment") {
        return Err("Erome requires a browser challenge; paste an album URL instead".into());
    }
    let albums = parse_erome(&html);
    let full = albums.len() >= 36;
    Ok((albums, full))
}

async fn discovery_json(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if bytes.len().saturating_add(chunk.len()) > 4 * 1024 * 1024 {
            return Err("Search response exceeded 4 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Provider returned malformed search data".into())
}

fn parse_redgifs(value: &Value) -> Vec<SearchResult> {
    value
        .get("gifs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|gif| {
            let id = gif.get("id")?.as_str()?;
            if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
                return None;
            }
            let creator = gif
                .get("userName")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let thumbnail = gif
                .pointer("/urls/thumbnail")
                .or_else(|| gif.pointer("/urls/poster"))
                .and_then(Value::as_str)
                .filter(|url| crate::url_guard::normalize_public_http_url(url).is_ok())
                .map(str::to_owned);
            Some(SearchResult {
                title: gif
                    .get("title")
                    .and_then(Value::as_str)
                    .filter(|title| !title.is_empty())
                    .unwrap_or(id)
                    .to_owned(),
                creator,
                thumbnail,
                source: "redgifs.com".into(),
                source_url: format!("https://www.redgifs.com/watch/{id}"),
                provider: "redgifs".into(),
                result_type: "post".into(),
                // Gallery posts may contain several files; the search response
                // does not establish that count or their aggregate byte size.
                item_count: None,
                total_bytes: None,
                date: None,
                gallery_dl_compatible: true,
                gallery_dl_validated: true,
                relevance: Some(80),
            })
        })
        .collect()
}

async fn search_redgifs(query: &str) -> Result<Vec<SearchResult>, String> {
    search_redgifs_page(query, 1)
        .await
        .map(|(results, _)| results)
}

async fn search_redgifs_page(query: &str, page: u64) -> Result<(Vec<SearchResult>, bool), String> {
    if let Some(result) = provider_direct_url_result("redgifs", query) {
        return Ok((vec![result], false));
    }
    if query.starts_with("https://") || query.starts_with("http://") {
        return Ok((Vec::new(), false));
    }
    // The public temporary-token and search interfaces match gallery-dl's
    // maintained RedgifsAPI adapter. No user credentials are persisted.
    let client = reqwest::Client::builder()
        .user_agent("AvtoHmver discovery")
        .timeout(Duration::from_secs(5))
        .redirect(crate::url_guard::public_redirect_policy())
        .build()
        .map_err(|error| error.to_string())?;
    let auth = discovery_json(client.get("https://api.redgifs.com/v2/auth/temporary")).await?;
    let token = auth
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "Redgifs did not provide a temporary token".to_string())?;
    let response = discovery_json(
        client
            .get("https://api.redgifs.com/v2/gifs/search")
            .bearer_auth(token)
            .header("Origin", "https://www.redgifs.com")
            .header("Referer", "https://www.redgifs.com/")
            .query(&[
                ("search_text", query),
                ("count", "100"),
                ("page", &page.to_string()),
            ]),
    )
    .await?;
    if !response.get("gifs").is_some_and(Value::is_array) {
        return Err(
            "Redgifs returned an unsupported search response; paste a watch URL instead".into(),
        );
    }
    let more = response
        .get("pages")
        .and_then(Value::as_u64)
        .is_some_and(|pages| page < pages);
    Ok((parse_redgifs(&response), more))
}

async fn search_remote_provider(
    provider: String,
    text: String,
) -> Result<Vec<SearchResult>, String> {
    match provider.as_str() {
        "balbums" => search_balbums(&text).await,
        "kemono" => search_kemono_like("kemono", &text).await,
        "coomer" => search_kemono_like("coomer", &text).await,
        "redgifs" => search_redgifs(&text).await,
        "deviantart" => {
            if let Some(result) = provider_direct_url_result(&provider, &text) {
                Ok(vec![result])
            } else {
                Err("DeviantArt search requires a registered OAuth application; paste a gallery/page URL instead".to_string())
            }
        }
        "erome" => search_erome(&text).await,
        _ => Err(
            "Search is not available for this provider in the installed gallery-dl version"
                .to_string(),
        ),
    }
}

async fn search_provider_page(
    provider: &str,
    query: &str,
    page: u64,
    base: Option<&str>,
) -> Result<(Vec<SearchResult>, bool), String> {
    match provider {
        "redgifs" => search_redgifs_page(query, page).await,
        "erome" => search_erome_page(query, page).await,
        "balbums" => search_balbums_page(query, page).await,
        "kemono" | "coomer" => search_kemono_page(provider, query, page, base).await,
        _ => search_remote_provider(provider.into(), query.into())
            .await
            .map(|results| (results, false)),
    }
}

pub async fn search(
    state: &Arc<AppState>,
    query: SearchQuery,
) -> Result<SearchResponse, SearchError> {
    let bad = SearchError::BadRequest;
    let limit = query
        .limit
        .unwrap_or(if query.paged { 40 } else { 100 })
        .clamp(1, 250);
    if let Some(cursor) = query.cursor.as_deref() {
        let pending = state
            .discovery_pages
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pending_remote(cursor);
        if let Some(remote) = pending {
            let fetched = tokio::time::timeout(
                Duration::from_secs(10),
                search_provider_page(
                    &remote.provider,
                    &remote.query,
                    remote.page,
                    remote.base.as_deref(),
                ),
            )
            .await
            .map_err(|_| {
                format!(
                    "{} search timed out; retry or paste a direct URL",
                    remote.provider
                )
            })
            .and_then(|result| {
                result.map_err(|error| {
                    format!("{}: {error}. Retry or paste a direct URL", remote.provider)
                })
            });
            let (results, more) = match fetched {
                Ok(value) => value,
                Err(error) => {
                    state
                        .discovery_pages
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .failed_remote(cursor, &remote, error.clone());
                    return Err(bad(error));
                }
            };
            state
                .discovery_pages
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .append_remote(cursor, &remote, results, more);
        }
        return state
            .discovery_pages
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .next(cursor, limit);
    }
    let text = query.query.clone().unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Err(bad("A search query is required".to_string()));
    }
    if text.len() > 2_000 {
        return Err(bad("Search query is too long".to_string()));
    }
    let defaults = state.settings.read().await.search_providers.clone();
    let requested = requested_provider_ids(&query, &defaults);
    if let Some(unknown) = requested
        .iter()
        .find(|provider| !state.search_registry.contains(provider))
    {
        return Err(bad(format!("Unknown search provider: {unknown}")));
    }

    let mut results = Vec::new();
    let mut provider_errors = Vec::new();
    let mut remote_continuations = Vec::new();
    if requested.iter().any(|provider| provider == "local") {
        let catalog_results = {
            let conn = state
                .pool
                .get()
                .map_err(|error| SearchError::Internal(error.to_string()))?;
            search_local_catalog(&conn, &text)
                .map_err(|error| SearchError::Internal(error.to_string()))?
        };
        results.extend(catalog_results);
        if let Some(result) = direct_url_result(&text) {
            results.push(result);
        }
    }

    // No more than four remote providers run at once. Every request has its
    // own ten-second wall-clock deadline and returns partial results.
    let remote_ids = requested
        .iter()
        .filter(|provider| provider.as_str() != "local")
        .cloned()
        .collect::<Vec<_>>();
    let remote_outcomes = futures::stream::iter(remote_ids.into_iter().map(|provider| {
        let text = text.clone();
        let paged = query.paged;
        async move {
            let result = tokio::time::timeout(Duration::from_secs(10), async {
                if paged {
                    search_provider_page(&provider, &text, 1, None).await
                } else {
                    search_remote_provider(provider.clone(), text)
                        .await
                        .map(|results| (results, false))
                }
            })
            .await;
            match result {
                Ok(Ok(results)) => (provider, Ok(results)),
                Ok(Err(error)) => (provider, Err(error)),
                Err(_) => (
                    provider,
                    Err("Search timed out after 10 seconds".to_string()),
                ),
            }
        }
    }))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;
    for (provider, outcome) in remote_outcomes {
        match outcome {
            Ok((values, more)) => {
                if more
                    && query.result_type.as_deref().is_none_or(|kind| {
                        kind.is_empty()
                            || values
                                .iter()
                                .any(|row| row.result_type.eq_ignore_ascii_case(kind))
                    })
                {
                    remote_continuations.push(ProviderContinuation {
                        provider: provider.clone(),
                        base: values
                            .first()
                            .filter(|_| matches!(provider.as_str(), "kemono" | "coomer"))
                            .map(|row| format!("https://{}", row.source)),
                        query: text.clone(),
                        page: 2,
                        result_type: query
                            .result_type
                            .clone()
                            .unwrap_or_default()
                            .to_ascii_lowercase(),
                    });
                }
                results.extend(values.into_iter().take(2000));
            }
            Err(error) => provider_errors.push(ProviderError { provider, error }),
        }
    }

    let requested_type = query.result_type.unwrap_or_default().to_ascii_lowercase();
    if !requested_type.is_empty() {
        results.retain(|result| result.result_type == requested_type);
    }
    let mut seen = HashSet::new();
    results.retain(|result| {
        seen.insert((
            result.provider.clone(),
            result.source_url.clone(),
            result.result_type.clone(),
        ))
    });
    match query.sort.as_deref().unwrap_or("relevance") {
        "relevance" => results.sort_by(|a, b| {
            b.relevance
                .cmp(&a.relevance)
                .then_with(|| a.title.cmp(&b.title))
        }),
        "date_desc" => {
            results.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.title.cmp(&b.title)))
        }
        "date_asc" => {
            results.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.title.cmp(&b.title)))
        }
        _ => return Err(bad("Unknown search sort".to_string())),
    }
    if !query.paged {
        results.truncate(limit);
    }
    let response = SearchResponse {
        results,
        providers: requested,
        provider_errors,
        next_cursor: None,
    };
    Ok(if query.paged {
        state
            .discovery_pages
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .first(response, limit, remote_continuations)
    } else {
        response
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadSearchResultsBody {
    #[serde(default)]
    pub results: Vec<SearchResult>,
}

/// Filters queued search results down to verified gallery-dl page URLs.
/// CDN/media file URLs stay preview-only even if a client forged the
/// `gallery_dl_compatible` flag on the way back in.
pub fn select_download_urls(
    state: &AppState,
    results: Vec<SearchResult>,
) -> Result<Vec<String>, SearchError> {
    if results.is_empty() || results.len() > 500 {
        return Err(SearchError::BadRequest(
            "Select between one and 500 compatible search results".to_string(),
        ));
    }
    let urls = results
        .into_iter()
        .filter(|result| {
            result.gallery_dl_compatible
                && result.gallery_dl_validated
                && state.search_registry.descriptor(&result.provider).is_some()
                && is_verified_page_url(&result.source_url)
        })
        .map(|result| result.source_url.trim().to_string())
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Err(SearchError::BadRequest(
            "Selected results must be verified gallery-dl page URLs; CDN/media links are preview-only"
                .to_string(),
        ));
    }
    Ok(urls)
}

// ─── Provider adapters ───────────────────────────────────────────────────────

const BALBUMS_MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

static BALBUMS_CARD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<a\s+href="(?P<url>[^"]+)"(?P<attrs>[^>]*)>(?P<body>.*?)</a>"#)
        .expect("valid balbums card matcher")
});
static BALBUMS_TITLE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<h3[^>]*>(?P<title>.*?)</h3>"#).expect("valid balbums title matcher")
});
static BALBUMS_IMAGE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<img\s+[^>]*src="(?P<url>[^"]+)"[^>]*>"#)
        .expect("valid balbums image matcher")
});
static BALBUMS_COUNT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)>\s*(?P<count>\d+)\s+files?\s*</span>"#)
        .expect("valid balbums file-count matcher")
});
static HTML_TAGS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<[^>]+>").expect("valid HTML tag matcher"));

fn is_balbums_url(value: &str) -> bool {
    value
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_ascii_lowercase()
        .starts_with("balbums.st/")
}

fn is_bunkr_album_url(value: &str) -> bool {
    let Some((_, authority_and_path)) = value.split_once("://") else {
        return false;
    };
    let mut parts = authority_and_path.split('/');
    let host = parts
        .next()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default();
    let path = parts.collect::<Vec<_>>().join("/");
    (host.eq_ignore_ascii_case("bunkr.cr") || host.to_ascii_lowercase().ends_with(".bunkr.cr"))
        && path.starts_with("a/")
}

fn html_text(value: &str) -> String {
    HTML_TAGS
        .replace_all(value, " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_balbums_html(html: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();
    for card in BALBUMS_CARD.captures_iter(html) {
        let url = card
            .name("url")
            .map(|value| value.as_str())
            .unwrap_or_default();
        let attrs = card
            .name("attrs")
            .map(|value| value.as_str())
            .unwrap_or_default();
        if !attrs.to_ascii_lowercase().contains("card") || !is_bunkr_album_url(url) {
            continue;
        }
        let body = card
            .name("body")
            .map(|value| value.as_str())
            .unwrap_or_default();
        let Some(title) = BALBUMS_TITLE
            .captures(body)
            .and_then(|value| value.name("title"))
            .map(|value| html_text(value.as_str()))
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        // The provider's decorative Bunkr logo appears before a real cover,
        // so prefer the last absolute image in a card.
        let thumbnail = BALBUMS_IMAGE
            .captures_iter(body)
            .filter_map(|value| value.name("url").map(|url| url.as_str()))
            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
            .last()
            .map(ToOwned::to_owned);
        let item_count = BALBUMS_COUNT
            .captures(body)
            .and_then(|value| value.name("count"))
            .and_then(|value| value.as_str().parse::<i64>().ok());
        results.push(SearchResult {
            title,
            creator: None,
            thumbnail,
            source: "balbums.st".to_string(),
            source_url: url.to_string(),
            provider: "balbums".to_string(),
            result_type: "album".to_string(),
            item_count,
            total_bytes: None,
            date: None,
            gallery_dl_compatible: true,
            gallery_dl_validated: true,
            relevance: Some(80),
        });
    }
    results
}

async fn search_balbums(query: &str) -> Result<Vec<SearchResult>, String> {
    search_balbums_page(query, 1)
        .await
        .map(|(results, _)| results)
}

async fn search_balbums_page(query: &str, page: u64) -> Result<(Vec<SearchResult>, bool), String> {
    let trimmed = query.trim();
    if is_balbums_url(trimmed) {
        let source_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_string()
        } else {
            format!("https://{trimmed}")
        };
        return Ok((
            vec![SearchResult {
                title: "balbums.st collection".to_string(),
                creator: None,
                thumbnail: None,
                source: "balbums.st".to_string(),
                source_url,
                provider: "balbums".to_string(),
                result_type: "collection".to_string(),
                item_count: None,
                total_bytes: None,
                date: None,
                // An index URL must be resolved to its source page before it can
                // enter gallery-dl. The UI keeps it available for preview/open.
                gallery_dl_compatible: false,
                gallery_dl_validated: false,
                relevance: Some(100),
            }],
            false,
        ));
    }
    // URLs belong to the direct gallery-dl provider. Do not send them to an
    // unrelated index search endpoint.
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return Ok((Vec::new(), false));
    }
    let url = format!(
        "https://balbums.st/?mode=broad&page={page}&per=20&search={}&sort=latest",
        urlencoding::encode(trimmed)
    );
    let client = reqwest::Client::builder()
        .user_agent("AvtoHmver/0.1 discovery")
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(crate::url_guard::public_redirect_policy())
        .build()
        .map_err(|error| format!("could not initialize balbums provider: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("balbums.st is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("balbums.st search failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|size| size as usize > BALBUMS_MAX_RESPONSE_BYTES)
    {
        return Err("balbums.st returned an unexpectedly large search response".to_string());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("reading balbums.st results: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > BALBUMS_MAX_RESPONSE_BYTES {
            return Err("balbums.st returned an unexpectedly large search response".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let html = String::from_utf8(bytes)
        .map_err(|_| "balbums.st returned non-text search data".to_string())?;
    let results = parse_balbums_html(&html);
    let more = balbums_has_next(&html, page);
    Ok((results, more))
}

fn balbums_has_next(html: &str, page: u64) -> bool {
    let Some(next) = page.checked_add(1) else {
        return false;
    };
    let base = reqwest::Url::parse("https://balbums.st/").unwrap();
    BALBUMS_CARD.captures_iter(html).any(|card| {
        let Some(raw) = card.name("url") else {
            return false;
        };
        let Ok(link) = base.join(&raw.as_str().replace("&amp;", "&")) else {
            return false;
        };
        link.host_str() == Some("balbums.st")
            && link.path() == "/"
            && link
                .query_pairs()
                .any(|(key, value)| key == "page" && value.parse::<u64>().ok() == Some(next))
    })
}

// ─── Kemono / Coomer query adapter ───────────────────────────────────────────
// Both sites expose `/api/v1/posts?q=<query>&o=<offset>`, the same endpoint
// gallery-dl's kemono extractor queries. Post records carry creator/account
// metadata (service + user id), the post title, publish date, and file paths,
// so free-text search maps onto result cards without inventing behavior the
// sites do not offer. Domains migrate between suffixes, so each provider tries
// its primary base first and falls back to the secondary one.

const KEMONO_MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const KEMONO_PAGE_SIZE: usize = 50;
const KEMONO_MAX_PAGES: usize = 2;
static KEMONO_REQUESTS: Lazy<std::sync::Mutex<HashMap<String, std::time::Instant>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

fn reserve_provider_call(
    deadline: &mut std::time::Instant,
    now: std::time::Instant,
) -> Result<Duration, String> {
    let delay = deadline.saturating_duration_since(now);
    if delay > Duration::from_secs(3) {
        return Err(format!(
            "Search is busy or rate limited; retry in {} seconds",
            delay.as_secs().saturating_add(1)
        ));
    }
    *deadline = (*deadline).max(now) + Duration::from_secs(2);
    Ok(delay)
}

fn kemono_bases(provider: &str) -> &'static [&'static str] {
    match provider {
        "kemono" => &["https://kemono.cr", "https://kemono.su"],
        "coomer" => &[
            "https://coomer.st",
            "https://coomer.su",
            "https://coomer.party",
        ],
        _ => &[],
    }
}

/// Reads a string-or-number JSON value as text. The posts API is loosely
/// typed across site generations.
fn kemono_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// Extracts a file `path` from either an object or a JSON-encoded string.
/// Newer API generations embed file records as strings containing JSON.
fn kemono_file_path(value: &Value) -> Option<String> {
    kemono_file_path_depth(value, 8)
}

/// A `file` entry is either an object with a `path` field or a JSON-encoded
/// string of one. Cap the re-parse depth so a hostile response cannot nest
/// JSON-encoded strings arbitrarily deep and overflow the stack; the 4 MiB
/// response cap bounds input size but not nesting depth.
fn kemono_file_path_depth(value: &Value, depth: u8) -> Option<String> {
    if depth == 0 {
        return None;
    }
    match value {
        Value::Object(_) => value.get("path").and_then(kemono_text),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|parsed| kemono_file_path_depth(&parsed, depth - 1)),
        _ => None,
    }
}

fn parse_kemono_posts(base: &str, provider: &str, value: &Value) -> Vec<SearchResult> {
    // The live endpoint wraps results as {"posts": [...], "count": N};
    // tolerate a bare array too for older generations and tests.
    let posts = value
        .as_array()
        .cloned()
        .or_else(|| value.get("posts").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    posts
        .iter()
        .filter_map(|post| {
            let id = kemono_text(post.get("id")?)?;
            let user = kemono_text(post.get("user")?)?;
            let service = post
                .get("service")
                .and_then(|service| service.as_str())
                .unwrap_or("post")
                .to_string();
            let title = post
                .get("title")
                .and_then(|title| title.as_str())
                .filter(|title| !title.trim().is_empty())
                .map(|title| title.trim().to_string())
                .unwrap_or_else(|| "Untitled post".to_string());
            let mut file_count = 0;
            if post.get("file").and_then(kemono_file_path).is_some() {
                file_count += 1;
            }
            if let Some(attachments) = post.get("attachments").and_then(|value| value.as_array()) {
                file_count += attachments
                    .iter()
                    .filter(|attachment| kemono_file_path(attachment).is_some())
                    .count();
            }
            Some(SearchResult {
                title,
                creator: Some(format!("{service}/{user}")),
                thumbnail: None,
                source: base
                    .trim_start_matches("https://")
                    .trim_start_matches("http://")
                    .to_string(),
                source_url: format!("{base}/{service}/user/{user}/post/{id}"),
                provider: provider.to_string(),
                result_type: "post".to_string(),
                item_count: (file_count > 0).then_some(file_count as i64),
                total_bytes: None,
                date: post.get("published").and_then(kemono_text),
                // gallery-dl's kemono extractor consumes exactly these
                // canonical post URLs.
                gallery_dl_compatible: true,
                gallery_dl_validated: true,
                relevance: None,
            })
        })
        .collect()
}

async fn kemono_fetch_page(
    client: &reqwest::Client,
    base: &str,
    provider: &str,
    query: &str,
    offset: usize,
) -> Result<Vec<SearchResult>, String> {
    let delay = {
        let now = std::time::Instant::now();
        let mut requests = KEMONO_REQUESTS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reserve_provider_call(requests.entry(provider.into()).or_insert(now), now)?
    };
    tokio::time::sleep(delay).await;
    let url = format!(
        "{base}/api/v1/posts?q={}&o={offset}",
        urlencoding::encode(query)
    );
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("{provider} search request failed: {error}"))?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let seconds = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(60)
            .clamp(1, 3600);
        KEMONO_REQUESTS
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(
                provider.into(),
                std::time::Instant::now() + Duration::from_secs(seconds),
            );
        return Err(format!(
            "{provider} rate limited search; retry after {seconds} seconds or paste a direct URL"
        ));
    }
    let response = response
        .error_for_status()
        .map_err(|error| format!("{provider} search failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|size| size as usize > KEMONO_MAX_RESPONSE_BYTES)
    {
        return Err(format!(
            "{provider} returned an unexpectedly large search response"
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("reading {provider} results: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > KEMONO_MAX_RESPONSE_BYTES {
            return Err(format!(
                "{provider} returned an unexpectedly large search response"
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("{provider} returned malformed search data"))?;
    Ok(parse_kemono_posts(base, provider, &value))
}

async fn search_kemono_like(provider: &str, query: &str) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();
    // Verified page URLs keep the direct-URL path.
    if let Some(result) = provider_direct_url_result(provider, trimmed) {
        return Ok(vec![result]);
    }
    // URLs belong to the direct gallery-dl provider. Do not send them to an
    // unrelated index search endpoint.
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return Ok(Vec::new());
    }
    let bases = kemono_bases(provider);
    if bases.is_empty() {
        return Err("Search is not available for this provider".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent("AvtoHmver/0.1 discovery")
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(crate::url_guard::public_redirect_policy())
        .build()
        .map_err(|error| format!("could not initialize {provider} provider: {error}"))?;
    let mut last_error = String::new();
    for base in bases {
        let mut results = Vec::new();
        let mut failed = false;
        for page in 0..KEMONO_MAX_PAGES {
            match kemono_fetch_page(&client, base, provider, trimmed, page * KEMONO_PAGE_SIZE).await
            {
                Ok(posts) => {
                    let full_page = posts.len() >= KEMONO_PAGE_SIZE;
                    results.extend(posts);
                    if !full_page {
                        break;
                    }
                }
                Err(error) => {
                    last_error = error;
                    // A later page can be rate limited even though earlier
                    // pages are complete and useful. Keep those validated
                    // results; only fall back to another host when the first
                    // page itself failed.
                    failed = results.is_empty();
                    break;
                }
            }
        }
        if !failed {
            // Rank earlier, more relevant pages first.
            for (index, result) in results.iter_mut().enumerate() {
                result.relevance = Some(100i64.saturating_sub(index as i64));
            }
            return Ok(results);
        }
    }
    Err(if last_error.is_empty() {
        format!("{provider} search is unavailable")
    } else {
        last_error
    })
}

async fn search_kemono_page(
    provider: &str,
    query: &str,
    page: u64,
    pinned_base: Option<&str>,
) -> Result<(Vec<SearchResult>, bool), String> {
    if let Some(result) = provider_direct_url_result(provider, query) {
        return Ok((vec![result], false));
    }
    if query.starts_with("https://") || query.starts_with("http://") {
        return Ok((Vec::new(), false));
    }
    let allowed = kemono_bases(provider);
    let bases = if let Some(base) = pinned_base {
        if !allowed.contains(&base) {
            return Err("Invalid pinned provider host".into());
        }
        vec![base]
    } else {
        allowed.to_vec()
    };
    let offset = page
        .checked_sub(1)
        .and_then(|value| value.checked_mul(KEMONO_PAGE_SIZE as u64))
        .and_then(|value| usize::try_from(value).ok())
        .ok_or("Invalid provider page")?;
    let client = reqwest::Client::builder()
        .user_agent("AvtoHmver discovery")
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .redirect(crate::url_guard::public_redirect_policy())
        .build()
        .map_err(|error| error.to_string())?;
    let mut last_error = "Provider search unavailable".to_string();
    for base in bases {
        match kemono_fetch_page(&client, base, provider, query, offset).await {
            Ok(results) => {
                let more = results.len() >= KEMONO_PAGE_SIZE;
                return Ok((results, more));
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

// ─── URL guards ──────────────────────────────────────────────────────────────

/// A gallery/source page has a stable host and a non-media path. This is a
/// deliberately conservative server-side guard: CDN URLs, direct image/video
/// files, data URLs, and malformed URLs remain preview-only even if a client
/// posts a forged `gallery_dl_compatible` flag back to us.
fn is_verified_page_url(value: &str) -> bool {
    if crate::url_guard::normalize_public_http_url(value).is_err() {
        return false;
    }
    let value = value.trim();
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    if !matches!(scheme.to_ascii_lowercase().as_str(), "https" | "http") {
        return false;
    }
    let mut parts = rest.splitn(2, '/');
    let host = parts
        .next()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if host.is_empty()
        || host.starts_with("cdn.")
        || host.starts_with("media.")
        || host.starts_with("img.")
        || host.contains("image-cdn")
    {
        return false;
    }
    let path = parts
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let direct_extension = [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".mp4", ".webm", ".mkv", ".mov", ".m4v",
    ];
    !direct_extension
        .iter()
        .any(|extension| path.ends_with(extension))
}

fn direct_url_result(query: &str) -> Option<SearchResult> {
    let value = query.trim();
    if !(value.starts_with("https://") || value.starts_with("http://")) {
        return None;
    }
    let host = value
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(value)
        .split('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    Some(SearchResult {
        title: value.to_string(),
        creator: None,
        thumbnail: None,
        source: host.clone(),
        source_url: value.to_string(),
        provider: "gallery-dl".to_string(),
        result_type: "post".to_string(),
        item_count: None,
        total_bytes: None,
        date: None,
        gallery_dl_compatible: !host.ends_with("balbums.st") && is_verified_page_url(value),
        gallery_dl_validated: is_verified_page_url(value),
        relevance: Some(110),
    })
}

fn provider_direct_url_result(provider: &str, query: &str) -> Option<SearchResult> {
    if !is_verified_page_url(query) {
        return None;
    }
    let host = query
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(query)
        .split('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    Some(SearchResult {
        title: query.to_string(),
        creator: None,
        thumbnail: None,
        source: host,
        source_url: query.to_string(),
        provider: provider.to_string(),
        result_type: "post".to_string(),
        item_count: None,
        total_bytes: None,
        date: None,
        gallery_dl_compatible: true,
        gallery_dl_validated: true,
        relevance: Some(105),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;

    #[test]
    fn erome_search_deduplicates_cover_and_title_links_and_rejects_other_hosts() {
        let results = parse_erome(
            r#"
          <a href="https://www.erome.com/a/Album123"><img data-src="https://cdn.erome.com/cover.jpg" alt="A &amp; B"></a>
          <a href="https://www.erome.com/a/Album123">A &amp; B</a>
          <a href="/a/Other456">Another album</a>
          <a href="https://other.example/a/Wrong">Not an album</a>
          <a href="https://www.erome.com/a/../../Wrong">Not an album</a>
        "#,
        );
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "A & B");
        assert_eq!(
            results[0].thumbnail.as_deref(),
            Some("https://cdn.erome.com/cover.jpg")
        );
        assert_eq!(results[1].source_url, "https://www.erome.com/a/Other456");
        assert!(results
            .iter()
            .all(|result| result.item_count.is_none() && result.total_bytes.is_none()));
    }

    #[tokio::test]
    #[ignore = "requires live Erome and Redgifs services"]
    async fn live_erome_and_redgifs_searches_return_gallery_pages() {
        for provider in ["erome", "redgifs"] {
            let results = search_remote_provider(provider.into(), "cosplay".into())
                .await
                .unwrap();
            assert!(!results.is_empty(), "{provider} returned no results");
            assert!(results
                .iter()
                .all(|result| result.provider == provider
                    && is_verified_page_url(&result.source_url)));
        }
    }

    #[tokio::test]
    #[ignore = "requires live Redgifs search and temporary-token endpoints"]
    async fn live_redgifs_discover_continues_past_first_provider_page() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let first = search(
            &state,
            SearchQuery {
                query: Some("cosplay".into()),
                provider: Some("redgifs".into()),
                paged: true,
                limit: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(
            first.provider_errors.is_empty(),
            "{:?}",
            first.provider_errors
        );
        assert_eq!(first.results.len(), 100);
        let cursor = first
            .next_cursor
            .expect("search has additional provider pages");
        let next_query = SearchQuery {
            cursor: Some(cursor),
            limit: Some(100),
            ..Default::default()
        };
        let next = search(&state, next_query.clone()).await.unwrap();
        assert!(!next.results.is_empty());
        let seen: HashSet<_> = first.results.iter().map(|row| &row.source_url).collect();
        assert!(next
            .results
            .iter()
            .all(|row| !seen.contains(&row.source_url)));
        assert_eq!(search(&state, next_query).await.unwrap(), next);
    }

    #[test]
    fn redgifs_search_accepts_only_stable_watch_ids_and_keeps_unknown_sizes() {
        let results = parse_redgifs(&serde_json::json!({"gifs": [
            {"id": "ValidWatch123", "userName": "Creator", "urls": {"thumbnail": "https://thumbs.redgifs.com/preview.jpg"}},
            {"id": "../bad"}, {"id": ""}, {"id": "Other", "urls": {"poster": "file:///secret"}}
        ]}));
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].source_url,
            "https://www.redgifs.com/watch/ValidWatch123"
        );
        assert_eq!(results[0].creator.as_deref(), Some("Creator"));
        assert!(results[0].item_count.is_none());
        assert!(results[0].total_bytes.is_none());
        assert!(results[1].thumbnail.is_none());
        assert!(results.iter().all(|result| result.gallery_dl_validated));
    }

    #[test]
    fn remote_discover_continuation_is_cached_deduplicated_and_retryable() {
        let rows = |ids: &[&str]| {
            parse_redgifs(
                &serde_json::json!({"gifs": ids.iter().map(|id| serde_json::json!({"id":id})).collect::<Vec<_>>()}),
            )
        };
        let mut pages = SearchPages::default();
        let first = pages.first(
            SearchResponse {
                results: rows(&["First", "Second"]),
                providers: vec!["redgifs".into()],
                provider_errors: vec![],
                next_cursor: None,
            },
            1,
            vec![ProviderContinuation {
                provider: "redgifs".into(),
                base: None,
                query: "sample".into(),
                page: 2,
                result_type: String::new(),
            }],
        );
        let first_cursor = first.next_cursor.unwrap();
        assert!(pages.pending_remote(&first_cursor).is_none());
        let boundary = pages.next(&first_cursor, 1).unwrap().next_cursor.unwrap();
        let pending = pages.pending_remote(&boundary).unwrap();
        // Failed requests never mutate this pending page or consume its cursor.
        assert_eq!(pages.pending_remote(&boundary).unwrap().page, 2);
        pages.append_remote(
            &boundary,
            &pending,
            rows(&["Second", "Third", "Fourth"]),
            true,
        );
        pages.append_remote(&boundary, &pending, rows(&["ShouldNotAppear"]), true);
        let third = pages.next(&boundary, 1).unwrap();
        assert!(third.results[0].source_url.ends_with("/Third"));
        assert_eq!(pages.next(&boundary, 1).unwrap(), third);
        let fourth = pages
            .next(third.next_cursor.as_deref().unwrap(), 1)
            .unwrap();
        assert!(fourth.results[0].source_url.ends_with("/Fourth"));
        let end = fourth.next_cursor.unwrap();
        let pending = pages.pending_remote(&end).unwrap();
        assert_eq!(pending.page, 3);
        pages.append_remote(&end, &pending, rows(&["Fourth"]), true);
        let terminal = pages.next(&end, 1).unwrap();
        assert!(terminal.results.is_empty());
        assert!(terminal.next_cursor.is_none());
        assert!(pages.pending_remote(&end).is_none());
        assert!(pages.next("other-library:2", 1).is_err());
    }

    #[test]
    fn mixed_provider_failure_keeps_failed_page_and_allows_other_provider_to_advance() {
        let mut pages = SearchPages::default();
        let first = pages.first(
            SearchResponse {
                results: vec![],
                providers: vec!["redgifs".into(), "erome".into()],
                provider_errors: vec![],
                next_cursor: None,
            },
            40,
            ["redgifs", "erome"]
                .map(|provider| ProviderContinuation {
                    provider: provider.into(),
                    base: None,
                    query: "sample".into(),
                    page: 2,
                    result_type: String::new(),
                })
                .to_vec(),
        );
        let cursor = first.next_cursor.unwrap();
        let failed = pages.pending_remote(&cursor).unwrap();
        pages.failed_remote(&cursor, &failed, "temporary failure".into());
        let healthy = pages.pending_remote(&cursor).unwrap();
        assert_eq!(healthy.provider, "erome");
        let rows = parse_erome(
            "<a href='/a/ValidAlbum'><img src='https://example.com/cover.jpg' alt='sample'></a>",
        );
        pages.append_remote(&cursor, &healthy, rows, false);
        let page = pages.next(&cursor, 40).unwrap();
        assert_eq!(page.results.len(), 1);
        assert_eq!(page.provider_errors[0].provider, "redgifs");
        let next = page.next_cursor.unwrap();
        let retry = pages.pending_remote(&next).unwrap();
        assert_eq!(retry.provider, "redgifs");
        assert_eq!(retry.page, 2);
        pages.append_remote(&next, &retry, vec![], false);
        let terminal = pages.next(&next, 40).unwrap();
        assert!(terminal.next_cursor.is_none());
        assert!(terminal.provider_errors.is_empty());
    }

    #[test]
    fn provider_pacing_bounds_bursts_and_preserves_a_rate_limit_deadline() {
        let now = std::time::Instant::now();
        let mut deadline = now;
        assert_eq!(
            reserve_provider_call(&mut deadline, now).unwrap(),
            Duration::ZERO
        );
        assert_eq!(
            reserve_provider_call(&mut deadline, now).unwrap(),
            Duration::from_secs(2)
        );
        assert!(reserve_provider_call(&mut deadline, now).is_err());
        deadline = now + Duration::from_secs(60);
        assert!(reserve_provider_call(&mut deadline, now)
            .unwrap_err()
            .contains("retry in"));
        assert_eq!(deadline, now + Duration::from_secs(60));
        assert_eq!(
            reserve_provider_call(&mut deadline, now + Duration::from_secs(61)).unwrap(),
            Duration::ZERO
        );
        assert!(!balbums_has_next(
            "<a href=\"https://unrelated.test/?page=2\">Next</a>",
            1
        ));
        assert!(balbums_has_next(
            "<a href=\"/?search=sample&amp;per=20&amp;page=2\">Next</a>",
            1
        ));
    }

    #[tokio::test]
    #[ignore = "requires live public provider index endpoints"]
    async fn live_other_discover_providers_continue_past_the_first_page() {
        for (provider, query) in [
            ("erome", "cosplay"),
            ("balbums", "cosplay"),
            ("kemono", "a"),
            ("coomer", "a"),
        ] {
            let (first, more) = search_provider_page(provider, query, 1, None)
                .await
                .unwrap_or_else(|error| panic!("{provider}: {error}"));
            assert!(more, "{provider} requires a query with multiple pages");
            let base = matches!(provider, "kemono" | "coomer")
                .then(|| format!("https://{}", first[0].source));
            let (next, _) = search_provider_page(provider, query, 2, base.as_deref())
                .await
                .unwrap_or_else(|error| panic!("{provider}: {error}"));
            assert!(!next.is_empty(), "{provider} second page empty");
            let seen: HashSet<_> = first.iter().map(|row| &row.source_url).collect();
            assert!(
                next.iter().any(|row| !seen.contains(&row.source_url)),
                "{provider} repeated its first page"
            );
        }
    }

    #[tokio::test]
    async fn direct_and_http_provider_catalogs_match() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let direct = providers(&state).unwrap();
        let http = crate::routes::search::providers(State(state)).await.0;
        assert_eq!(serde_json::to_value(direct).unwrap(), http);
    }

    #[test]
    fn viewer_local_registry_is_denied() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let mut viewer = (*state).clone();
        viewer.edition = crate::edition::Edition::Viewer;
        assert!(providers(&viewer).is_err());
    }

    #[tokio::test]
    async fn direct_and_http_search_share_the_typed_response() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let query = SearchQuery {
            query: Some("https://example.test/post/1".into()),
            ..Default::default()
        };
        let direct = search(&state, query.clone()).await.unwrap();
        let http = crate::routes::search::search(State(state), axum::extract::Query(query))
            .await
            .unwrap()
            .0;
        assert_eq!(serde_json::to_value(&direct).unwrap(), http);
        assert_eq!(direct.results[0].provider, "gallery-dl");
        assert!(direct.results[0].gallery_dl_compatible);
        assert_eq!(direct.providers, vec!["local", "balbums"]);
        assert!(direct.provider_errors.is_empty());
    }

    #[tokio::test]
    #[ignore = "requires live balbums, Kemono, and Coomer services"]
    async fn live_required_provider_searches_return_downloadable_results() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        for (provider, query) in [
            ("balbums", "belladonna"),
            ("kemono", "test"),
            ("coomer", "test"),
        ] {
            let response = search(
                &state,
                SearchQuery {
                    query: Some(query.into()),
                    provider: Some(provider.into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap_or_else(|error| panic!("{provider} search failed: {error:?}"));
            assert!(
                response.provider_errors.is_empty(),
                "{provider} errors: {:?}",
                response.provider_errors
            );
            assert!(
                response.results.iter().any(|result| {
                    result.provider == provider
                        && result.gallery_dl_compatible
                        && result.gallery_dl_validated
                }),
                "{provider} returned no validated gallery-dl result"
            );
        }
    }

    #[tokio::test]
    async fn search_rejects_bad_input_with_legacy_messages() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let query = SearchQuery {
            query: None,
            ..Default::default()
        };
        assert_eq!(
            search(&state, query).await,
            Err(SearchError::BadRequest(
                "A search query is required".to_string()
            ))
        );
        let query = SearchQuery {
            query: Some("x".repeat(2001)),
            ..Default::default()
        };
        assert_eq!(
            search(&state, query).await,
            Err(SearchError::BadRequest(
                "Search query is too long".to_string()
            ))
        );
        let query = SearchQuery {
            query: Some("hello".into()),
            provider: Some("nope".into()),
            ..Default::default()
        };
        assert_eq!(
            search(&state, query).await,
            Err(SearchError::BadRequest(
                "Unknown search provider: nope".to_string()
            ))
        );
        let query = SearchQuery {
            query: Some("hello".into()),
            sort: Some("vibes".into()),
            ..Default::default()
        };
        assert_eq!(
            search(&state, query).await,
            Err(SearchError::BadRequest("Unknown search sort".to_string()))
        );
    }

    #[test]
    fn select_download_urls_keeps_only_verified_page_urls() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let verified = SearchResult {
            title: "post".into(),
            creator: None,
            thumbnail: None,
            source: "example.test".into(),
            source_url: "https://example.test/gallery/1".into(),
            provider: "local".into(),
            result_type: "post".into(),
            item_count: None,
            total_bytes: None,
            date: None,
            gallery_dl_compatible: true,
            gallery_dl_validated: true,
            relevance: None,
        };
        let cdn = SearchResult {
            source_url: "https://cdn.example.test/a.jpg".into(),
            ..verified.clone()
        };
        let urls = select_download_urls(&state, vec![verified.clone(), cdn]).unwrap();
        assert_eq!(urls, vec!["https://example.test/gallery/1".to_string()]);
        // Forged flags do not survive the server-side page-URL guard.
        let forged = SearchResult {
            gallery_dl_compatible: true,
            gallery_dl_validated: true,
            source_url: "https://cdn.example.test/a.jpg".into(),
            ..verified.clone()
        };
        assert!(matches!(
            select_download_urls(&state, vec![forged]),
            Err(SearchError::BadRequest(_))
        ));
        // Unknown providers cannot queue even with valid flags.
        let unknown_provider = SearchResult {
            provider: "nope".into(),
            ..verified.clone()
        };
        assert!(matches!(
            select_download_urls(&state, vec![unknown_provider]),
            Err(SearchError::BadRequest(_))
        ));
        assert!(matches!(
            select_download_urls(&state, vec![]),
            Err(SearchError::BadRequest(_))
        ));
    }

    #[test]
    fn registry_contains_matches_descriptor_normalization() {
        let registry = default_provider_registry();
        assert!(registry.contains("local"));
        assert!(registry.contains("gallery-dl"));
        assert!(registry.contains("kemono"));
        assert!(!registry.contains("nope"));
    }

    #[test]
    fn balbums_cards_are_normalized_to_gallery_dl_album_results() {
        let html = r#"
            <a href="https://bunkr.cr/a/curator-test" target="_blank" class="card search-card">
              <img src="/assets/bunkr.svg" alt="Bunkr">
              <img src="https://cdn.example.test/cover.jpg" alt="Cover">
              <h3>Example &amp; Gallery</h3>
              <span>42 files</span>
            </a>
        "#;

        let results = parse_balbums_html(html);
        assert_eq!(results.len(), 1);
        let result = &results[0];
        assert_eq!(result.title, "Example & Gallery");
        assert_eq!(result.source_url, "https://bunkr.cr/a/curator-test");
        assert_eq!(
            result.thumbnail.as_deref(),
            Some("https://cdn.example.test/cover.jpg")
        );
        assert_eq!(result.item_count, Some(42));
        assert!(result.gallery_dl_compatible);
    }

    #[test]
    fn curated_registry_exposes_at_least_forty_version_aware_adapters() {
        let registry = default_provider_registry();
        assert!(
            registry.providers.len() >= 40,
            "only {} providers",
            registry.providers.len()
        );
        let ids = registry
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(
            ids.len(),
            registry.providers.len(),
            "provider ids must be unique"
        );
        assert!(registry.providers.iter().all(|provider| provider.curated));
        assert!(registry.providers.iter().any(|provider| {
            provider.id == "kemono"
                && provider.availability != "direct_url_only"
                && provider
                    .capabilities
                    .iter()
                    .any(|capability| capability == "search")
        }));
    }

    #[test]
    fn kemono_posts_are_normalized_to_gallery_dl_post_results() {
        let payload = serde_json::json!([
            {
                "id": "101",
                "user": "alice42",
                "service": "patreon",
                "title": "Example shoot",
                "published": "2026-05-01T12:00:00",
                "file": { "name": "cover.jpg", "path": "/ab/cover.jpg" },
                "attachments": [
                    { "name": "a.mp4", "path": "/ab/a.mp4" },
                    { "name": "broken", "path": null }
                ]
            },
            {
                "id": 202,
                "user": 7,
                "service": "fanbox",
                "title": "  ",
                "file": "{\"name\":\"x.png\",\"path\":\"/xy/x.png\"}",
                "attachments": []
            }
        ]);
        let results = parse_kemono_posts("https://kemono.su", "kemono", &payload);
        assert_eq!(results.len(), 2);
        let first = &results[0];
        assert_eq!(first.title, "Example shoot");
        assert_eq!(first.creator.as_deref(), Some("patreon/alice42"));
        assert_eq!(first.source, "kemono.su");
        assert_eq!(
            first.source_url,
            "https://kemono.su/patreon/user/alice42/post/101"
        );
        assert_eq!(first.result_type, "post");
        assert_eq!(first.item_count, Some(2));
        assert_eq!(first.date.as_deref(), Some("2026-05-01T12:00:00"));
        assert!(first.gallery_dl_compatible);
        assert!(first.gallery_dl_validated);
        // Number-typed ids and JSON-encoded file records still normalize.
        let second = &results[1];
        assert_eq!(second.title, "Untitled post");
        assert_eq!(second.creator.as_deref(), Some("fanbox/7"));
        assert_eq!(second.item_count, Some(1));
    }

    #[test]
    fn kemono_posts_parse_the_live_wrapped_response_shape() {
        // The live /api/v1/posts endpoint wraps results in an object; a
        // bare-array-only parser silently returned zero results.
        let payload = serde_json::json!({
            "count": 50000,
            "true_count": 156492,
            "posts": [
                {
                    "id": "141133143",
                    "user": "80293853",
                    "service": "patreon",
                    "title": "Example post",
                    "published": "2025-10-13T17:13:13",
                    "file": { "name": "a.jpg", "path": "/35/a.jpg" },
                    "attachments": [{ "name": "b.mp4", "path": "/35/b.mp4" }]
                }
            ]
        });
        let results = parse_kemono_posts("https://kemono.cr", "coomer", &payload);
        assert_eq!(results.len(), 1);
        let first = &results[0];
        assert_eq!(first.title, "Example post");
        assert_eq!(first.creator.as_deref(), Some("patreon/80293853"));
        assert_eq!(first.source, "kemono.cr");
        assert_eq!(
            first.source_url,
            "https://kemono.cr/patreon/user/80293853/post/141133143"
        );
        assert_eq!(first.item_count, Some(2));
    }

    #[test]
    fn kemono_posts_without_ids_are_skipped() {
        let payload = serde_json::json!([{ "title": "no id" }]);
        assert!(parse_kemono_posts("https://coomer.st", "coomer", &payload).is_empty());
        assert!(
            parse_kemono_posts("https://coomer.st", "coomer", &serde_json::json!({})).is_empty()
        );
    }

    #[test]
    fn coomer_prefers_the_current_live_host() {
        assert_eq!(kemono_bases("coomer")[0], "https://coomer.st");
    }

    #[test]
    fn kemono_file_path_rejects_deeply_nested_json_strings() {
        // A hostile response could nest JSON-encoded strings arbitrarily
        // deep; the parser must bail out instead of overflowing the stack.
        // (Each nesting level roughly doubles the fixture size through
        // escaping, so a dozen levels is plenty to exceed the depth cap.)
        let mut nested = serde_json::json!({ "path": "/35/a.jpg" }).to_string();
        for _ in 0..12 {
            nested = serde_json::to_string(&nested).unwrap();
        }
        assert!(kemono_file_path(&serde_json::Value::String(nested)).is_none());

        // One level of JSON-encoded indirection still resolves.
        let single = serde_json::to_string(&serde_json::json!({ "path": "/35/a.jpg" })).unwrap();
        assert_eq!(
            kemono_file_path(&serde_json::Value::String(single)).as_deref(),
            Some("/35/a.jpg")
        );
        // Plain objects still resolve.
        assert_eq!(
            kemono_file_path(&serde_json::json!({ "path": "/35/a.jpg" })).as_deref(),
            Some("/35/a.jpg")
        );
    }

    #[test]
    fn generated_extractors_are_overridden_by_curated_ids() {
        let generated = generated_provider_templates("balbums QUERY\nnewsite TAG\nnoise");
        assert!(generated.iter().any(|provider| provider.id == "balbums"));
        let curated = curated_providers();
        let curated_ids = curated
            .iter()
            .map(|provider| provider.id.clone())
            .collect::<HashSet<_>>();
        let merged = curated
            .into_iter()
            .chain(
                generated
                    .into_iter()
                    .filter(|provider| !curated_ids.contains(&provider.id)),
            )
            .collect::<Vec<_>>();
        assert_eq!(
            merged
                .iter()
                .filter(|provider| provider.id == "balbums")
                .count(),
            1
        );
        assert!(merged
            .iter()
            .any(|provider| provider.id == "newsite" && provider.generated));
    }

    #[test]
    fn requested_provider_ids_merge_and_normalize() {
        let query = SearchQuery {
            provider: Some("Gallery-DL".into()),
            providers: Some("kemono, kemono ,".into()),
            ..Default::default()
        };
        let ids = requested_provider_ids(&query, &["local".to_string()]);
        assert_eq!(ids, vec!["kemono", "local"]);
        let query = SearchQuery::default();
        let ids = requested_provider_ids(&query, &["local".to_string(), "balbums".to_string()]);
        assert_eq!(ids, vec!["local", "balbums"]);
    }

    #[tokio::test]
    async fn discover_pages_are_stable_and_expire_without_cross_library_access() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        {
            let conn = state.pool.get().unwrap();
            for id in 1..=95 {
                conn.execute("INSERT INTO sources(id,name,url,slug,added_at,item_count) VALUES(?1,?2,?3,?2,'2026',1)", rusqlite::params![id, format!("sample-{id:03}"), format!("https://example.test/{id}")]).unwrap();
            }
            conn.execute("INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded,file_size_bytes) VALUES(1,1,'sample.png','sample.png','image','2026',1,1024)", []).unwrap();
            conn.execute("INSERT INTO media(id,source_id,filepath,filename,type,added_at,downloaded) VALUES(2,2,'unknown.png','unknown.png','image','2026',1)", []).unwrap();
        }
        let first = search(
            &state,
            SearchQuery {
                query: Some("sample".into()),
                provider: Some("local".into()),
                paged: true,
                limit: Some(40),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(first.results.len(), 40);
        assert_eq!(first.results[0].total_bytes, Some(1024));
        assert_eq!(first.results[1].total_bytes, None);
        assert_eq!(first.results[0].thumbnail.as_deref(), Some("/api/thumb/1"));
        let cursor = first.next_cursor.unwrap();
        state
            .pool
            .get()
            .unwrap()
            .execute("UPDATE sources SET name='changed'", [])
            .unwrap();
        let next = search(
            &state,
            SearchQuery {
                cursor: Some(cursor.clone()),
                limit: Some(40),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(next.results.len(), 40);
        assert_eq!(next.results[0].title, "sample-041");
        let last = search(
            &state,
            SearchQuery {
                cursor: next.next_cursor,
                limit: Some(40),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(last.results.len(), 15);
        assert!(last.next_cursor.is_none());
        let other = tempfile::tempdir().unwrap();
        let other = crate::test_support::state(other.path());
        assert!(search(
            &other,
            SearchQuery {
                cursor: Some(cursor.clone()),
                ..Default::default()
            }
        )
        .await
        .is_err());
        let id = cursor.split_once(':').unwrap().0;
        state
            .discovery_pages
            .lock()
            .unwrap()
            .snapshots
            .get_mut(id)
            .unwrap()
            .0 -= Duration::from_secs(601);
        assert!(search(
            &state,
            SearchQuery {
                cursor: Some(cursor),
                ..Default::default()
            }
        )
        .await
        .is_err());
    }
}
