//! Explicit soundtrack preparation and recording-bound rhythm manifests.
use crate::{services::music, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{io::Read, sync::Arc};

type Error = (StatusCode, Json<Value>);
fn bad(error: impl std::fmt::Display) -> Error {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"error":error.to_string()})),
    )
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Beatmap {
    pub recording_id: String,
    pub duration: f64,
    pub bpm: f64,
    pub offset: f64,
    pub confirmed: bool,
    pub beats: Vec<Value>,
    #[serde(default)]
    pub events: Vec<Value>,
}
fn schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS fanservice_music_maps(track_id INTEGER PRIMARY KEY,document TEXT NOT NULL)").map_err(|e|e.to_string())
}
fn recording(state: &AppState, id: i64) -> Result<(String, f64), String> {
    let path = music::track_path(state, id)?;
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut hash = Sha1::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    let duration = crate::downloader::probe_video_duration(&state.ffprobe_bin, &path)
        .filter(|v| *v > 0.0)
        .ok_or("Cannot probe recording duration; check FFprobe")?;
    Ok((format!("sha1:{:x}", hash.finalize()), duration))
}
fn validate(map: &Beatmap) -> Result<(), String> {
    if !map.duration.is_finite()
        || map.duration <= 0.0
        || !map.bpm.is_finite()
        || !(20.0..=400.0).contains(&map.bpm)
        || !map.offset.is_finite()
        || map.offset.abs() > 60.0
        || map.beats.is_empty()
        || map.beats.len() > 100000
        || map.events.len() > 10000
    {
        return Err("Invalid beatmap duration, BPM, offset or event count".into());
    }
    let mut previous = -1.0;
    for beat in &map.beats {
        let t = beat["time"].as_f64().ok_or("Beat needs a numeric time")?;
        let shifted = t + map.offset;
        if !t.is_finite()
            || t < previous
            || shifted < 0.0
            || shifted > map.duration
            || !matches!(beat["type"].as_str(), Some("stroke" | "rest" | "accent"))
        {
            return Err(
                "Beats must be sorted, in recording bounds and use a supported type".into(),
            );
        }
        previous = t;
    }
    let supported = [
        "media_change",
        "cycle_media",
        "speed_change",
        "background",
        "text",
        "disable_break",
        "restore_break",
        "grant_break",
        "dialogue",
        "edge",
        "cum_event",
    ];
    previous = -1.0;
    for event in &map.events {
        let t = event["time"].as_f64().ok_or("Event needs a numeric time")?;
        if !t.is_finite()
            || t < previous
            || t + map.offset < 0.0
            || t + map.offset > map.duration
            || !supported.contains(&event["type"].as_str().unwrap_or(""))
        {
            return Err("Invalid control event".into());
        }
        if let Some(value) = event.get("value") {
            if !matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
                || value
                    .as_str()
                    .is_some_and(|text| text.encode_utf16().count() > 2000)
            {
                return Err(
                    "Control event value must be a scalar of at most 2000 characters".into(),
                );
            }
        }
        previous = t;
    }
    Ok(())
}
fn read_map(state: &AppState, id: i64) -> Result<Option<Beatmap>, String> {
    use rusqlite::OptionalExtension;
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    schema(&conn)?;
    let value: Option<String> = conn
        .query_row(
            "SELECT document FROM fanservice_music_maps WHERE track_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    value
        .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
        .transpose()
}
pub async fn inspect(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Error> {
    tokio::task::spawn_blocking(move||{
        let (identity,duration)=recording(&state,id)?;
        let map=read_map(&state,id)?;
        let matches=map.as_ref().is_some_and(|m|m.recording_id==identity && (m.duration-duration).abs()<0.1);
        Ok::<_,String>(Json(json!({"track_id":id,"recording_id":identity,"duration":duration,"beatmap":map,"matches":matches})))
    }).await.map_err(bad)?.map_err(bad)
}
pub async fn analyze(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Error> {
    tokio::task::spawn_blocking(move||{
        let (identity,duration)=recording(&state,id)?;
        let pcm=crate::beat::decode_mono_pcm_cancellable(&state.ffmpeg_bin,&music::track_path(&state,id)?,&||false)?;
        let proposal=crate::beat::analyze_pcm(&pcm,22050);
        let mut beats=vec![];let mut t=proposal.first_beat_offset_secs;
        while t<duration && beats.len()<100000 {beats.push(json!({"time":t,"type":"stroke"}));t+=60.0/proposal.bpm;}
        Ok::<_,String>(Json(json!({"recording_id":identity,"duration":duration,"bpm":proposal.bpm,"offset":0.0,"confirmed":false,"beats":beats,"events":[],"confidence":proposal.confidence,"requires_confirmation":true})))
    }).await.map_err(bad)?.map_err(bad)
}
pub async fn read(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<Beatmap>, Error> {
    tokio::task::spawn_blocking(move || {
        let (identity, duration) = recording(&state, id)?;
        let map = read_map(&state, id)?.ok_or("Prepare this recording's beatmap first")?;
        validate(&map)?;
        if map.recording_id != identity || (map.duration - duration).abs() > 0.1 {
            return Err("Beatmap recording mismatch; analyze the current recording".to_string());
        }
        Ok(Json(map))
    })
    .await
    .map_err(bad)?
    .map_err(bad)
}

pub async fn save(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(map): Json<Beatmap>,
) -> Result<Json<Value>, Error> {
    validate(&map).map_err(bad)?;
    tokio::task::spawn_blocking(move||{
        let (identity,duration)=recording(&state,id)?;
        if map.recording_id!=identity || (map.duration-duration).abs()>0.1 {return Err("Beatmap recording mismatch; analyze the current recording".to_string());}
        let conn=state.pool.get().map_err(|e|e.to_string())?;schema(&conn)?;
        conn.execute("INSERT INTO fanservice_music_maps(track_id,document) VALUES(?1,?2) ON CONFLICT(track_id) DO UPDATE SET document=excluded.document",rusqlite::params![id,serde_json::to_string(&map).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        Ok(Json(json!({"saved":true,"confirmed":map.confirmed})))
    }).await.map_err(bad)?.map_err(bad)
}
pub async fn manifest(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Error> {
    tokio::task::spawn_blocking(move||{
        let (identity,duration)=recording(&state,id)?;
        let map=read_map(&state,id)?.ok_or("Prepare and confirm this recording's beatmap first")?;validate(&map)?;
        if !map.confirmed || map.recording_id!=identity || (map.duration-duration).abs()>0.1 {return Err("Beatmap is unconfirmed or does not match this recording".to_string());}
        let shift=|values:Vec<Value>| values.into_iter().map(|mut v|{let t=v["time"].as_f64().unwrap()+map.offset;v["time"]=json!(t);v}).collect::<Vec<_>>();
        let title=music::list(&state)?.into_iter().find(|t|t.id==id).ok_or("Track missing")?.title;
        Ok(Json(json!({"protocol":1,"library_id":state.instance_id,"recording_id":identity,"track_id":id,"duration":duration,"offset":map.offset,
            "stream_url":format!("/api/music/tracks/{id}/stream?browser=true"),"native_stream_url":format!("/api/music/tracks/{id}/stream?native=true"),
            "beatmap":{"meta":{"title":title,"duration":duration,"bpm":map.bpm,"offset":0},"beats":shift(map.beats),"events":shift(map.events)}})))
    }).await.map_err(bad)?.map_err(bad)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recording_bounds_and_control_data_are_enforced() {
        let mut m = Beatmap {
            recording_id: "sha1:test".into(),
            duration: 10.0,
            bpm: 120.0,
            offset: 0.0,
            confirmed: true,
            beats: vec![json!({"time":1.0,"type":"stroke"})],
            events: vec![],
        };
        assert!(validate(&m).is_ok());
        m.offset = -2.0;
        assert!(validate(&m).is_err());
        m.offset = 0.0;
        m.events = vec![json!({"time":2.0,"type":"unknown"})];
        assert!(validate(&m).is_err());
        m.events = vec![];
        m.beats.push(json!({"time":0.5,"type":"stroke"}));
        assert!(validate(&m).is_err());
    }

    #[test]
    fn control_event_values_are_bounded_portable_scalars() {
        let mut map = Beatmap {
            recording_id: "sha1:test".into(),
            duration: 10.0,
            bpm: 120.0,
            offset: 0.0,
            confirmed: true,
            beats: vec![json!({"time":1.0,"type":"accent"})],
            events: vec![],
        };
        for value in [
            json!("start"),
            json!(2.0),
            json!(false),
            json!("\u{1f600}".repeat(1000)),
        ] {
            map.events = vec![json!({"time":2.0,"type":"text","value":value})];
            assert!(validate(&map).is_ok(), "scalar should be accepted");
        }
        for value in [
            Value::Null,
            json!({"path":"private"}),
            json!([1]),
            json!("\u{1f600}".repeat(1001)),
        ] {
            map.events = vec![json!({"time":2.0,"type":"text","value":value})];
            assert!(
                validate(&map).is_err(),
                "nested/null/oversized values must be rejected"
            );
        }
        map.events = vec![json!({"time":2.0,"type":"restore_break"})];
        assert!(validate(&map).is_ok());
    }

    #[tokio::test]
    async fn beatmap_get_is_registered_and_reports_a_missing_recording() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let response = crate::routes::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/api/fanservice/v1/music/1/beatmap")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    #[ignore = "requires FFprobe in PATH or FANSERVICE_TEST_FFPROBE"]
    async fn beatmap_get_roundtrips_editable_offsets_and_rejects_replaced_recordings() {
        use axum::{
            body::{to_bytes, Body},
            http::Request,
        };
        use tower::ServiceExt;
        let root = tempfile::tempdir().unwrap();
        let mut state = crate::test_support::state(root.path());
        Arc::get_mut(&mut state).unwrap().ffprobe_bin =
            std::env::var("FANSERVICE_TEST_FFPROBE").unwrap_or_else(|_| "ffprobe".into());
        let samples: u32 = 16000;
        let data_bytes = samples * 2;
        let mut wav = b"RIFF".to_vec();
        wav.extend((36 + data_bytes).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(8000u32.to_le_bytes());
        wav.extend(16000u32.to_le_bytes());
        wav.extend(2u16.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(data_bytes.to_le_bytes());
        wav.resize(44 + data_bytes as usize, 0);
        let track = music::store(&state, "neutral.wav", &wav).unwrap();
        let identity = music::recording_id(&state, track.id).unwrap();
        let map = Beatmap {
            recording_id: identity.clone(),
            duration: 2.0,
            bpm: 120.0,
            offset: 0.25,
            confirmed: true,
            beats: vec![json!({"time":0.5,"type":"accent"})],
            events: vec![json!({"time":1.0,"type":"text","value":"checkpoint"})],
        };
        let app = crate::routes::build_router(state.clone());
        let uri = format!("/api/fanservice/v1/music/{}/beatmap", track.id);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(&uri)
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&map).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = app
            .clone()
            .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let editable: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(editable["recording_id"], identity);
        assert_eq!(editable["offset"], 0.25);
        assert_eq!(editable["beats"][0]["time"], 0.5);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/fanservice/v1/music/{}/manifest", track.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let manifest: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(manifest["beatmap"]["beats"][0]["time"], 0.75);
        assert_eq!(manifest["beatmap"]["events"][0]["time"], 1.25);
        wav[44] = 1;
        std::fs::write(music::track_path(&state, track.id).unwrap(), wav).unwrap();
        let response = app
            .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            read_map(&state, track.id).unwrap().unwrap().recording_id,
            identity
        );
    }
}
