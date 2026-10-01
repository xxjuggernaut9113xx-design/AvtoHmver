use super::{
    music::{Command, MusicPlayer},
    AvtoHmverNativeWindow, ViewState,
};
use avtohmver::{
    services::{
        music,
        playback::{self, PlaybackPreset},
    },
    AppState,
};
use slint::{ComponentHandle, ModelRc, VecModel};
use std::{cell::RefCell, rc::Rc, sync::Arc};

fn read(w: &AvtoHmverNativeWindow, saved: &PlaybackPreset) -> Result<PlaybackPreset, String> {
    let mut p = saved.clone();
    p.name = w.get_playback_name().into();
    p.collection_id = if w.get_playback_collection().trim().is_empty() {
        None
    } else {
        Some(
            w.get_playback_collection()
                .parse()
                .map_err(|_| "Collection ID must be a number")?,
        )
    };
    p.tags = w
        .get_playback_tags()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    p.media_types = w
        .get_playback_types()
        .split(',')
        .map(str::to_string)
        .collect();
    p.order = w.get_playback_order().into();
    p.display_fit = w.get_playback_fit().into();
    p.captions = w.get_playback_captions();
    p.music_source = w.get_playback_music_source().into();
    p.playlist_id = if w.get_playback_playlist_id().trim().is_empty() {
        None
    } else {
        Some(
            w.get_playback_playlist_id()
                .parse()
                .map_err(|_| "Playlist ID must be a number")?,
        )
    };
    p.music_volume = w
        .get_playback_music_volume()
        .parse::<f64>()
        .map_err(|_| "Music volume must be 0–100")?
        / 100.0;
    playback::validate(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
fn render(w: &AvtoHmverNativeWindow, p: &PlaybackPreset) {
    w.set_playback_name(p.name.clone().into());
    w.set_playback_collection(
        p.collection_id
            .map(|id| id.to_string())
            .unwrap_or_default()
            .into(),
    );
    w.set_playback_tags(p.tags.join(",").into());
    w.set_playback_types(p.media_types.join(",").into());
    w.set_playback_order(p.order.clone().into());
    w.set_playback_fit(p.display_fit.clone().into());
    w.set_playback_captions(p.captions);
    w.set_playback_music_source(p.music_source.clone().into());
    w.set_playback_playlist_id(
        p.playlist_id
            .map(|id| id.to_string())
            .unwrap_or_default()
            .into(),
    );
    w.set_playback_music_volume((p.music_volume * 100.0).to_string().into());
}
fn refresh(w: &AvtoHmverNativeWindow, state: &AppState) -> Result<Vec<PlaybackPreset>, String> {
    let presets = playback::list(state).map_err(|e| e.to_string())?;
    let mut names = vec!["Current draft".into()];
    names.extend(
        presets
            .iter()
            .map(|p| slint::SharedString::from(p.name.as_str())),
    );
    w.set_playback_preset_names(ModelRc::new(VecModel::from(names)));
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id,name,provider FROM goon_playlists ORDER BY id")
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |r| {
            Ok(slint::SharedString::from(format!(
                "{}: {} ({})",
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?
            )))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    w.set_playback_playlist_names(ModelRc::new(VecModel::from(names)));
    Ok(presets)
}
fn apply_music(
    state: &AppState,
    p: &PlaybackPreset,
    player: &MusicPlayer,
) -> Result<String, String> {
    if p.music_source == "none" {
        player.send(Command::Stop);
        return Ok("Music stopped".into());
    }
    let id = p.playlist_id.ok_or("Select a playlist ID")?;
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    let (provider, source, tracks): (String, Option<String>, String) = conn
        .query_row(
            "SELECT provider,source_url,tracks FROM goon_playlists WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Selected playlist is missing")?;
    if provider != p.music_source {
        return Err("Playlist does not match selected music source".into());
    }
    if provider == "local" {
        let ids: Vec<i64> = serde_json::from_str(&tracks).map_err(|_| "Invalid local track IDs")?;
        let paths = ids
            .into_iter()
            .map(|id| music::track_path(state, id).map(|p| p.to_string_lossy().into_owned()))
            .collect::<Result<Vec<_>, _>>()?;
        if paths.is_empty() {
            return Err("Playlist has no tracks".into());
        }
        player.send(Command::Load(paths, p.music_volume));
        Ok("Local music — independent audio-only libmpv playback".into())
    } else {
        let url = music::validate_reference(&provider, source.as_deref())?
            .ok_or("Provider link is missing")?;
        player.send(Command::Stop);
        #[cfg(windows)]
        avtohmver::process::blocking_command("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "linux")]
        avtohmver::process::blocking_command("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        avtohmver::process::blocking_command("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "External {provider} playback — use the service app controls"
        ))
    }
}
pub(super) fn attach(
    w: &AvtoHmverNativeWindow,
    state: Option<Arc<AppState>>,
    view: Rc<RefCell<ViewState>>,
    runtime: tokio::runtime::Handle,
) -> slint::Timer {
    let timer = slint::Timer::default();
    let Some(state) = state else {
        return timer;
    };
    let presets = Rc::new(RefCell::new(refresh(w, &state).unwrap_or_default()));
    let draft = Rc::new(RefCell::new(PlaybackPreset::default()));
    let player = Rc::new(MusicPlayer::new());
    let weak = w.as_weak();
    let select_presets = presets.clone();
    let select_draft = draft.clone();
    let selected_view = view.clone();
    w.on_playback_select(move |index| {
        if let Some(w) = weak.upgrade() {
            let mut p = select_presets
                .borrow()
                .get(index.saturating_sub(1) as usize)
                .filter(|_| index > 0)
                .cloned()
                .unwrap_or_default();
            if index == 0 {
                let v = selected_view.borrow();
                p.media_ids = v.selected.keys().copied().collect();
                p.collection_id = v.query.group_id;
                p.tags = v
                    .query
                    .tags
                    .as_deref()
                    .unwrap_or("")
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect();
            }
            render(&w, &p);
            *select_draft.borrow_mut() = p;
        }
    });
    let weak = w.as_weak();
    let action_player = player.clone();
    let action_state = state.clone();
    w.on_playback_action(move |action| {
        let Some(w) = weak.upgrade() else {
            return;
        };
        let result = (|| -> Result<String, String> {
            let mut p = read(&w, &draft.borrow())?;
            if let Some(label) = action.strip_prefix("playlist-select:") {
                let id = label
                    .split(':')
                    .next()
                    .ok_or("Playlist unavailable")?
                    .parse::<i64>()
                    .map_err(|_| "Invalid playlist ID")?;
                let conn = action_state.pool.get().map_err(|e| e.to_string())?;
                let (name, provider, url, tracks): (String, String, Option<String>, String) = conn
                    .query_row(
                        "SELECT name,provider,source_url,tracks FROM goon_playlists WHERE id=?1",
                        [id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .map_err(|_| "Playlist was deleted; Refresh")?;
                w.set_playback_playlist_id(id.to_string().into());
                w.set_playback_playlist_name(name.into());
                w.set_playback_music_source(provider.into());
                w.set_playback_provider_url(url.unwrap_or_default().into());
                let ids: Vec<i64> = serde_json::from_str(&tracks).unwrap_or_default();
                w.set_playback_track_ids(
                    ids.iter()
                        .map(|id| id.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                        .into(),
                );
                return Ok("Playlist loaded as a draft; active music is unchanged".into());
            }
            match action.as_str() {
                "playlist-new" | "playlist-save" => {
                    let id = if action == "playlist-save" {
                        Some(p.playlist_id.ok_or("Select a playlist")?)
                    } else {
                        None
                    };
                    let ids = if p.music_source == "local" {
                        w.get_playback_track_ids()
                            .split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(|s| {
                                s.parse::<i64>()
                                    .map_err(|_| "Local track IDs must be integers".to_string())
                            })
                            .collect::<Result<Vec<_>, _>>()?
                    } else {
                        vec![]
                    };
                    let source = w.get_playback_provider_url();
                    let id = music::save_playlist(
                        &action_state,
                        id,
                        &w.get_playback_playlist_name(),
                        &p.music_source,
                        if p.music_source == "local" {
                            None
                        } else {
                            Some(&source)
                        },
                        serde_json::json!(ids),
                    )?;
                    w.set_playback_playlist_id(id.to_string().into());
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    Ok("Shared playlist saved; active music is unchanged".into())
                }
                "playlist-delete" => {
                    music::delete_playlist(
                        &action_state,
                        p.playlist_id.ok_or("Select a playlist")?,
                    )?;
                    w.set_playback_playlist_id("".into());
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    Ok("Shared playlist deleted".into())
                }
                "refresh" => {
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    Ok("Shared presets and playlists refreshed".into())
                }
                "reload" => {
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    let id = draft.borrow().id.ok_or("Select a saved preset")?;
                    let saved = presets
                        .borrow()
                        .iter()
                        .find(|p| p.id == Some(id))
                        .cloned()
                        .ok_or("Preset was deleted; Save as new")?;
                    render(&w, &saved);
                    *draft.borrow_mut() = saved;
                    Ok("Preset reloaded".into())
                }
                "save" | "new" => {
                    if action == "new" {
                        p.id = None;
                        p.revision = 0;
                    }
                    let saved = playback::save(&action_state, p).map_err(|e| e.to_string())?;
                    render(&w, &saved);
                    *draft.borrow_mut() = saved;
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    Ok("Saved. Active playback is unchanged.".into())
                }
                "delete" => {
                    playback::delete(
                        &action_state,
                        p.id.ok_or("Select a saved preset")?,
                        p.revision,
                    )
                    .map_err(|e| e.to_string())?;
                    *draft.borrow_mut() = PlaybackPreset::default();
                    render(&w, &draft.borrow());
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    Ok("Preset deleted".into())
                }
                "start" => {
                    if p.id.is_none() && p.media_ids.is_empty() {
                        p.media_ids = view.borrow().selected.keys().copied().collect();
                    }
                    let items = runtime
                        .block_on(playback::resolve(&action_state, p.clone()))
                        .map_err(|e| e.to_string())?;
                    {
                        let mut v = view.borrow_mut();
                        v.goon.preset_media = items
                            .iter()
                            .cloned()
                            .map(serde_json::from_value)
                            .collect::<Result<Vec<_>, _>>()
                            .map_err(|e| format!("Invalid media response: {e}"))?;
                        v.goon.request = v.goon.request.wrapping_add(1);
                        v.goon.fetching = false;
                        v.goon.active_order =
                            items.iter().filter_map(|m| m["id"].as_i64()).collect();
                        v.goon.allowed_ids =
                            Some(items.iter().filter_map(|m| m["id"].as_i64()).collect());
                        v.goon.active_preset = Some(p.clone());
                        v.goon.candidates.clear();
                        v.goon.exhausted = false;
                        v.goon.cursor = None;
                        v.goon.last_phase = None;
                        v.goon.media_enabled = true;
                    }
                    w.set_goon_media_enabled(true);
                    w.set_playback_active_cover(p.display_fit == "cover");
                    w.set_playback_active_captions(p.captions);
                    w.invoke_session_control("Start".into());
                    apply_music(&action_state, &p, &action_player)
                }
                "apply" => apply_music(&action_state, &p, &action_player),
                "music-play" => {
                    action_player.send(Command::Pause(false));
                    Ok("Music resumed".into())
                }
                "music-pause" => {
                    action_player.send(Command::Pause(true));
                    Ok("Music paused".into())
                }
                "volume" => {
                    action_player.send(Command::Volume(p.music_volume));
                    Ok("Music volume updated".into())
                }
                "seek" => {
                    let seconds = w
                        .get_playback_seek()
                        .parse::<f64>()
                        .map_err(|_| "Seek must be nonnegative seconds")?;
                    if !seconds.is_finite() || seconds < 0.0 {
                        return Err("Seek must be nonnegative seconds".into());
                    }
                    action_player.send(Command::Seek(seconds));
                    Ok("Music seek requested".into())
                }
                "import-files" | "import-folder" => {
                    let paths = if action == "import-folder" {
                        rfd::FileDialog::new().pick_folder().map(|p| vec![p])
                    } else {
                        rfd::FileDialog::new()
                            .add_filter("Audio", &["mp3", "aac", "m4a", "wav", "flac", "ogg"])
                            .pick_files()
                    };
                    let Some(paths) = paths else {
                        return Ok("Import cancelled".into());
                    };
                    let mut imported = vec![];
                    for path in paths {
                        imported.extend(music::import(&action_state, &path)?);
                    }
                    let ids = imported.iter().map(|t| t.id).collect::<Vec<_>>();
                    let id = music::save_playlist(
                        &action_state,
                        None,
                        &p.name,
                        "local",
                        None,
                        serde_json::json!(ids),
                    )?;
                    w.set_playback_music_source("local".into());
                    w.set_playback_playlist_id(id.to_string().into());
                    w.set_playback_track_ids(
                        ids.iter()
                            .map(|id| id.to_string())
                            .collect::<Vec<_>>()
                            .join(",")
                            .into(),
                    );
                    *presets.borrow_mut() = refresh(&w, &action_state)?;
                    Ok(format!(
                        "Imported {} tracks into a shared local playlist",
                        imported.len()
                    ))
                }
                _ => Ok(String::new()),
            }
        })();
        w.set_playback_status(
            result
                .unwrap_or_else(|e| format!("{e}. Retry, Reload or Save as new."))
                .into(),
        );
    });
    let weak = w.as_weak();
    timer.start(
        slint::TimerMode::Repeated,
        std::time::Duration::from_millis(250),
        move || {
            if let Some(error) = player.error() {
                if let Some(w) = weak.upgrade() {
                    w.set_playback_status(error.into());
                }
            }
        },
    );
    timer
}
