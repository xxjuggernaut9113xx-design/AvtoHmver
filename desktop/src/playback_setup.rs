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

#[derive(Default)]
struct BeatWork {
    generation: u64,
    cancel: Option<Arc<std::sync::atomic::AtomicBool>>,
}
impl BeatWork {
    fn cancel(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        if let Some(cancel) = self.cancel.take() {
            cancel.store(true, std::sync::atomic::Ordering::Release);
        }
    }
}
impl Drop for BeatWork {
    fn drop(&mut self) {
        self.cancel();
    }
}

fn preview_beat_markers(w: &AvtoHmverNativeWindow, markers: &[f64]) {
    w.set_beat_duration(markers.last().copied().unwrap_or(1.0).max(1.0) as f32);
    w.set_beat_markers(ModelRc::new(VecModel::from(
        markers.iter().map(|v| *v as f32).collect::<Vec<_>>(),
    )));
}

fn read_beat_markers(w: &AvtoHmverNativeWindow) -> Result<Vec<f64>, String> {
    let values = w.get_beat_marker_text();
    let markers = values
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| {
            v.parse::<f64>()
                .map_err(|_| "Beat markers must be seconds separated by commas".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if markers.len() > 4096
        || markers.iter().any(|v| !v.is_finite() || *v < 0.0)
        || markers.windows(2).any(|pair| pair[1] <= pair[0])
    {
        return Err("Use at most 4096 finite, increasing, nonnegative beat markers".into());
    }
    Ok(markers)
}

fn render_beat(w: &AvtoHmverNativeWindow, value: &serde_json::Value) {
    let analysis = value.get("analysis").unwrap_or(value);
    w.set_beat_map_id(value["id"].as_i64().unwrap_or(0).to_string().into());
    w.set_beat_bpm(analysis["bpm"].as_f64().unwrap_or(120.0).to_string().into());
    w.set_beat_offset(
        analysis["first_beat_offset_secs"]
            .as_f64()
            .or_else(|| analysis["beat_offset_secs"].as_f64())
            .unwrap_or(0.0)
            .to_string()
            .into(),
    );
    w.set_beat_confirmed(analysis["confirmed"].as_bool().unwrap_or(false));
    let markers: Vec<f64> = analysis["markers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_f64())
        .collect();
    preview_beat_markers(w, &markers);
    w.set_beat_marker_text(
        markers
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ")
            .into(),
    );
    w.set_beat_status(
        format!(
            "Map {}: confidence {:.0}%. Review BPM, offset and markers before confirming.",
            value["id"],
            analysis["confidence"].as_f64().unwrap_or(0.0) * 100.0
        )
        .into(),
    );
}

fn beat_action(
    w: &AvtoHmverNativeWindow,
    action: &str,
    state: &Arc<AppState>,
    runtime: &tokio::runtime::Handle,
    work: &Rc<RefCell<BeatWork>>,
    replies: &std::sync::mpsc::Sender<(u64, Result<serde_json::Value, String>)>,
) -> Result<(), String> {
    use avtohmver::routes::goon::{BeatMapAnalyzeBody, BeatMapUpdateBody};
    if let Some(track) = action.strip_prefix("beat-track:") {
        w.set_beat_track_id(track.split(':').next().unwrap_or_default().into());
        return Ok(());
    }
    if action == "beat-cancel" {
        if w.get_beat_busy() && !w.get_beat_analyzing() {
            return Err("Wait for the beat-map save to finish".into());
        }
        work.borrow_mut().cancel();
        w.set_beat_busy(false);
        w.set_beat_analyzing(false);
        w.set_beat_status("Beat analysis cancelled.".into());
        return Ok(());
    }
    if action == "beat-preview" {
        preview_beat_markers(w, &read_beat_markers(w)?);
        return Ok(());
    }
    if action == "beat-load" {
        let id: i64 = w
            .get_beat_map_id()
            .parse()
            .map_err(|_| "Choose a saved map ID")?;
        let conn = state.pool.get().map_err(|e| e.to_string())?;
        let value = conn.query_row("SELECT id,bpm,beat_offset_secs,confidence,markers,confirmed FROM beat_maps WHERE id=?1",[id],|row| Ok(serde_json::json!({"id":row.get::<_,i64>(0)?,"bpm":row.get::<_,f64>(1)?,"beat_offset_secs":row.get::<_,f64>(2)?,"confidence":row.get::<_,f64>(3)?,"markers":serde_json::from_str::<serde_json::Value>(&row.get::<_,String>(4)?).unwrap_or_else(|_|serde_json::json!([])),"confirmed":row.get::<_,bool>(5)?}))).map_err(|e| e.to_string())?;
        render_beat(w, &value);
        return Ok(());
    }
    let analyze = if action == "beat-analyze" {
        let id: i64 = w
            .get_beat_track_id()
            .parse()
            .map_err(|_| "Choose an imported local track")?;
        let path = music::track_path(state, id)?;
        let playlist_id = if w.get_playback_playlist_id().trim().is_empty() {
            None
        } else {
            Some(
                w.get_playback_playlist_id()
                    .parse()
                    .map_err(|_| "Playlist ID must be a number")?,
            )
        };
        Some(BeatMapAnalyzeBody {
            track_path: path.to_string_lossy().into_owned(),
            playlist_id,
        })
    } else {
        None
    };
    let save = if action == "beat-save" {
        let id: i64 = w
            .get_beat_map_id()
            .parse()
            .map_err(|_| "Analyze or load a beat map first")?;
        let markers = read_beat_markers(w)?;
        Some((
            id,
            BeatMapUpdateBody {
                bpm: w
                    .get_beat_bpm()
                    .parse()
                    .map_err(|_| "BPM must be a number")?,
                beat_offset_secs: w
                    .get_beat_offset()
                    .parse()
                    .map_err(|_| "Offset must be seconds")?,
                markers,
                confirmed: w.get_beat_confirmed(),
            },
        ))
    } else {
        None
    };
    if analyze.is_none() && save.is_none() {
        return Err("Unknown beat-map action".into());
    }
    let mut work = work.borrow_mut();
    work.cancel();
    let generation = work.generation;
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    work.cancel = Some(cancel.clone());
    let state = state.clone();
    let replies = replies.clone();
    w.set_beat_busy(true);
    w.set_beat_analyzing(analyze.is_some());
    w.set_beat_status(
        if analyze.is_some() {
            "Analyzing local audio..."
        } else {
            "Saving beat map..."
        }
        .into(),
    );
    runtime.spawn(async move {
        let result = if let Some(body) = analyze {
            avtohmver::routes::goon::analyze_beat_map_cancellable(state, body, cancel).await
        } else {
            let (id, body) = save.unwrap();
            avtohmver::routes::goon::update_beat_map_local(state, id, body).await
        }
        .map(|value| value.0)
        .map_err(|(_, error)| {
            error.0["error"]
                .as_str()
                .unwrap_or("Beat-map operation failed")
                .to_owned()
        });
        let _ = replies.send((generation, result));
    });
    Ok(())
}

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
    let mut tracks = vec![slint::SharedString::from("Select an imported track")];
    tracks.extend(
        music::list(state)?
            .into_iter()
            .map(|track| slint::SharedString::from(format!("{}: {}", track.id, track.title))),
    );
    w.set_beat_track_names(ModelRc::new(VecModel::from(tracks)));
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
    let player = view.borrow().music.clone();
    let beat_work = Rc::new(RefCell::new(BeatWork::default()));
    let action_beat_work = beat_work.clone();
    let (beat_replies, beat_results) = std::sync::mpsc::channel();
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
        if action.starts_with("beat-") {
            if let Err(error) = beat_action(
                &w,
                &action,
                &action_state,
                &runtime,
                &action_beat_work,
                &beat_replies,
            ) {
                w.set_beat_status(format!("Beat-map error: {error}").into());
            }
            return;
        }
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
                    // Reject malformed gameplay settings before resolving or
                    // replacing any active media draft.
                    super::configured_instructor(&w, &view.borrow())?;
                    if p.id.is_none() && p.media_ids.is_empty() {
                        p.media_ids = view.borrow().selected.keys().copied().collect();
                    }
                    let items = if w.get_goon_media_enabled() {
                        runtime
                            .block_on(playback::resolve(&action_state, p.clone()))
                            .map_err(|e| e.to_string())?
                    } else {
                        vec![]
                    };
                    let media = items
                        .iter()
                        .cloned()
                        .map(serde_json::from_value)
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| format!("Invalid media response: {e}"))?;
                    super::start_native_instructor(&w, &view, &action_state, &runtime)?;
                    {
                        let mut v = view.borrow_mut();
                        v.goon.preset_media = media;
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
                        v.goon.media_enabled = w.get_goon_media_enabled();
                    }
                    w.set_playback_active_cover(p.display_fit == "cover");
                    w.set_playback_active_captions(p.captions);
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
            if let Some(w) = weak.upgrade() {
                for (generation, result) in beat_results.try_iter() {
                    if generation != beat_work.borrow().generation {
                        continue;
                    }
                    beat_work.borrow_mut().cancel = None;
                    w.set_beat_busy(false);
                    w.set_beat_analyzing(false);
                    match result {
                        Ok(value) if value["updated"].as_bool() == Some(true) => {
                            if let Ok(markers) = read_beat_markers(&w) {
                                preview_beat_markers(&w, &markers);
                            }
                            w.set_beat_status("Beat map saved.".into())
                        }
                        Ok(value) => render_beat(&w, &value),
                        Err(error) => w.set_beat_status(format!("Beat-map error: {error}").into()),
                    }
                }
            }
            if let Some(error) = player.error() {
                if let Some(w) = weak.upgrade() {
                    w.set_playback_status(error.into());
                }
            }
        },
    );
    timer
}
