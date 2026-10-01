//! A dedicated audio-only libmpv worker. It never shares the visual player.
use crate::mpv_embed::{MpvInstance, PlayerEvent};
use std::sync::mpsc;
pub enum Command {
    Load(Vec<String>, f64),
    Pause(bool),
    Seek(f64),
    Volume(f64),
    Stop,
}
pub struct MusicPlayer {
    tx: mpsc::Sender<Command>,
    errors: mpsc::Receiver<String>,
}
impl MusicPlayer {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        let (errors_tx, errors) = mpsc::channel();
        std::thread::spawn(move || {
            let mut player: Option<MpvInstance> = None;
            let mut tracks = vec![];
            let mut index = 0;
            loop {
                match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    Ok(command) => {
                        let result = (|| -> Result<(), String> {
                            match command {
                                Command::Load(paths, volume) => {
                                    if paths.is_empty() {
                                        return Err("Playlist has no tracks".into());
                                    }
                                    if player.is_none() {
                                        player = Some(MpvInstance::create_audio()?);
                                    }
                                    tracks = paths;
                                    index = 0;
                                    let p = player.as_mut().unwrap();
                                    p.set_property("volume", &(volume * 100.0).to_string())?;
                                    p.command(&["loadfile", &tracks[0], "replace"])?;
                                    p.set_property("pause", "no")
                                }
                                Command::Pause(paused) => player
                                    .as_mut()
                                    .ok_or("No active music")?
                                    .set_property("pause", if paused { "yes" } else { "no" }),
                                Command::Seek(seconds) => player
                                    .as_mut()
                                    .ok_or("No active music")?
                                    .command(&["seek", &seconds.to_string(), "absolute"]),
                                Command::Volume(v) => {
                                    player.as_mut().ok_or("No active music")?.set_property(
                                        "volume",
                                        &(v.clamp(0.0, 1.0) * 100.0).to_string(),
                                    )
                                }
                                Command::Stop => {
                                    tracks.clear();
                                    if let Some(p) = player.as_mut() {
                                        p.command(&["stop"])?;
                                    }
                                    Ok(())
                                }
                            }
                        })();
                        if let Err(e) = result {
                            let _ = errors_tx.send(e);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if let Some(p) = player.as_mut() {
                    while let Some(event) = p.next_event() {
                        match event {
                            PlayerEvent::EndFile { eof: true, .. } => {
                                index += 1;
                                if let Some(path) = tracks.get(index) {
                                    if let Err(e) = p.command(&["loadfile", path, "replace"]) {
                                        let _ = errors_tx.send(e);
                                    }
                                }
                            }
                            PlayerEvent::EndFile { failed: true, .. } => {
                                let _ = errors_tx.send(
                                    "Music decoding failed. Retry or import a compatible file."
                                        .into(),
                                );
                            }
                            _ => {}
                        }
                    }
                }
            }
        });
        Self { tx, errors }
    }
    pub fn send(&self, command: Command) {
        let _ = self.tx.send(command);
    }
    pub fn error(&self) -> Option<String> {
        self.errors.try_recv().ok()
    }
}
