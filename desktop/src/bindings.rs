//! Device-local keyboard bindings and the Windows panic hotkey lifetime.
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub key: String,
    pub modifiers: u32,
    pub vk: u32,
}

impl Binding {
    pub fn parse(text: &str, global: bool) -> Result<Self, String> {
        let mut modifiers = 0;
        let mut key = None;
        for part in text.split('+').map(str::trim) {
            match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => modifiers |= 2,
                "alt" => modifiers |= 1,
                "shift" => modifiers |= 4,
                _ if key.is_none() && !part.is_empty() => key = Some(part.to_ascii_uppercase()),
                _ => return Err("Use one key with optional Ctrl, Alt, and Shift modifiers".into()),
            }
        }
        let key = key.ok_or("Choose a key")?;
        let (key, vk) = match key.as_str() {
            "SPACE" => ("Space".to_owned(), 0x20),
            "RIGHT" => ("Right".to_owned(), 0x27),
            "LEFT" => ("Left".to_owned(), 0x25),
            "UP" => ("Up".to_owned(), 0x26),
            "DOWN" => ("Down".to_owned(), 0x28),
            "PAUSE" | "BREAK" => ("Pause".to_owned(), 0x13),
            "SCROLLLOCK" => ("ScrollLock".to_owned(), 0x91),
            key if key.starts_with('F') && key.len() > 1 => {
                let number = key[1..]
                    .parse::<u32>()
                    .map_err(|_| "Use F1–F24, a letter, Space, or an arrow key")?;
                if !(1..=24).contains(&number) {
                    return Err("Use F1–F24".into());
                }
                if global && number == 12 {
                    return Err(
                        "F12 is reserved by Windows; choose another global panic key".into(),
                    );
                }
                (format!("F{number}"), 0x70 + number - 1)
            }
            key if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => {
                (key.to_owned(), u32::from(key.as_bytes()[0]))
            }
            _ => return Err("Use F1–F24, a letter, Space, or an arrow key".into()),
        };
        Ok(Self { key, modifiers, vk })
    }

    pub fn label(&self) -> String {
        let mut label = String::new();
        for (flag, name) in [(2, "Ctrl+"), (1, "Alt+"), (4, "Shift+")] {
            if self.modifiers & flag != 0 {
                label.push_str(name);
            }
        }
        label.push_str(&self.key);
        label
    }

    pub fn matches(&self, text: &str, ctrl: bool, alt: bool, shift: bool) -> bool {
        let modifiers = (u32::from(ctrl) * 2) | u32::from(alt) | (u32::from(shift) * 4);
        if modifiers != self.modifiers {
            return false;
        }
        let expected: slint::SharedString = match self.key.as_str() {
            "Space" => " ".into(),
            "Right" => slint::platform::Key::RightArrow.into(),
            "Left" => slint::platform::Key::LeftArrow.into(),
            "Up" => slint::platform::Key::UpArrow.into(),
            "Down" => slint::platform::Key::DownArrow.into(),
            "Pause" => slint::platform::Key::Pause.into(),
            "ScrollLock" => slint::platform::Key::ScrollLock.into(),
            "F11" => slint::platform::Key::F11.into(),
            "F9" => slint::platform::Key::F9.into(),
            key if key.starts_with('F') && key.len() > 1 => {
                // Slint's function-key codes are contiguous from F1.
                let start = slint::SharedString::from(slint::platform::Key::F1)
                    .chars()
                    .next()
                    .unwrap() as u32;
                char::from_u32(start + self.vk - 0x70)
                    .unwrap()
                    .to_string()
                    .into()
            }
            key => key.into(),
        };
        text.to_uppercase() == expected.to_uppercase()
    }
}

#[derive(Clone, Debug)]
pub struct Bindings {
    pub panic: Binding,
    pub pause: Binding,
    pub next: Binding,
    pub fullscreen: Binding,
}
impl Default for Bindings {
    fn default() -> Self {
        Self::parse(["F9", "Space", "Right", "F11"]).unwrap()
    }
}
impl Bindings {
    pub fn parse(labels: [&str; 4]) -> Result<Self, String> {
        let bindings = labels
            .iter()
            .enumerate()
            .map(|(index, label)| Binding::parse(label, index == 0))
            .collect::<Result<Vec<_>, _>>()?;
        for (index, binding) in bindings.iter().enumerate() {
            if bindings[..index].contains(binding) {
                return Err("Each action needs a different key binding".into());
            }
        }
        Ok(Self {
            panic: bindings[0].clone(),
            pause: bindings[1].clone(),
            next: bindings[2].clone(),
            fullscreen: bindings[3].clone(),
        })
    }
    pub fn load(extras: &BTreeMap<String, serde_json::Value>) -> Self {
        let Some(value) = extras.get("key_bindings") else {
            return Self::default();
        };
        Self::parse([
            value["panic"].as_str().unwrap_or("F9"),
            value["pause"].as_str().unwrap_or("Space"),
            value["next"].as_str().unwrap_or("Right"),
            value["fullscreen"].as_str().unwrap_or("F11"),
        ])
        .unwrap_or_default()
    }
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({"panic": self.panic.label(), "pause": self.pause.label(), "next": self.next.label(), "fullscreen": self.fullscreen.label()})
    }
}

#[cfg(windows)]
mod native {
    use super::Binding;
    use std::{sync::mpsc, thread, time::Duration};
    use windows_sys::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::{
            Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT},
            WindowsAndMessaging::{
                GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY,
                WM_QUIT,
            },
        },
    };
    const REBIND: u32 = WM_APP + 77;
    type Request = (Binding, mpsc::SyncSender<Result<(), String>>);
    pub struct PanicHotkey {
        thread_id: u32,
        requests: mpsc::Sender<Request>,
        pub events: mpsc::Receiver<()>,
        worker: Option<thread::JoinHandle<()>>,
    }
    impl PanicHotkey {
        pub fn new() -> Result<Self, String> {
            let (requests, inbox) = mpsc::channel::<Request>();
            let (events_tx, events) = mpsc::sync_channel(1);
            let (ready_tx, ready) = mpsc::sync_channel(1);
            let worker = thread::Builder::new().name("curator-panic-key".into()).spawn(move || {
                // Create this thread's message queue before exposing its id.
                let mut message: MSG = unsafe { std::mem::zeroed() };
                unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE); }
                let _ = ready_tx.send(unsafe { GetCurrentThreadId() });
                let mut active = None;
                while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
                    if message.message == REBIND {
                        while let Ok((binding, reply)) = inbox.try_recv() {
                            let candidate = if active == Some(1) { 2 } else { 1 };
                            let result = if unsafe { RegisterHotKey(std::ptr::null_mut(), candidate, binding.modifiers | MOD_NOREPEAT, binding.vk) } == 0 {
                                Err(format!("{} could not be registered (Windows error {}). Choose another panic key.", binding.label(), std::io::Error::last_os_error()))
                            } else {
                                if let Some(old) = active { unsafe { UnregisterHotKey(std::ptr::null_mut(), old); } }
                                active = Some(candidate);
                                Ok(())
                            };
                            let _ = reply.send(result);
                        }
                    } else if message.message == WM_HOTKEY && active == Some(message.wParam as i32) {
                        let _ = events_tx.try_send(());
                    }
                }
                if let Some(id) = active { unsafe { UnregisterHotKey(std::ptr::null_mut(), id); } }
            }).map_err(|error| error.to_string())?;
            let thread_id = ready
                .recv_timeout(Duration::from_secs(2))
                .map_err(|error| error.to_string())?;
            Ok(Self {
                thread_id,
                requests,
                events,
                worker: Some(worker),
            })
        }
        pub fn rebind(&self, binding: &Binding) -> Result<(), String> {
            let (reply, answer) = mpsc::sync_channel(1);
            self.requests
                .send((binding.clone(), reply))
                .map_err(|error| error.to_string())?;
            if unsafe { PostThreadMessageW(self.thread_id, REBIND, 0, 0) } == 0 {
                return Err("Panic key service stopped".into());
            }
            answer
                .recv_timeout(Duration::from_secs(2))
                .map_err(|error| error.to_string())?
        }
    }
    impl Drop for PanicHotkey {
        fn drop(&mut self) {
            unsafe {
                PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
            }
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }
}
#[cfg(windows)]
pub use native::PanicHotkey;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bindings_round_trip_and_reject_conflicts_and_reserved_key() {
        let bindings = Bindings::parse(["ctrl+F9", "Space", "Right", "F11"]).unwrap();
        let extras = BTreeMap::from([("key_bindings".into(), bindings.json())]);
        assert_eq!(Bindings::load(&extras).panic.label(), "Ctrl+F9");
        assert!(Bindings::parse(["F12", "Space", "Right", "F11"]).is_err());
        assert!(Bindings::parse(["F9", "F9", "Right", "F11"]).is_err());
        assert!(Bindings::parse(["F09", "F9", "Right", "F11"]).is_err());
        assert_eq!(Binding::parse("F", false).unwrap().vk, 0x46);
        assert!(bindings.pause.matches(" ", false, false, false));
        assert!(!bindings.pause.matches(" ", true, false, false));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    #[test]
    fn registration_conflict_preserves_previous_global_binding() {
        let first = PanicHotkey::new().unwrap();
        let second = PanicHotkey::new().unwrap();
        let old = Binding::parse("Ctrl+Alt+Shift+F23", true).unwrap();
        let occupied = Binding::parse("Ctrl+Alt+Shift+F24", true).unwrap();
        first.rebind(&old).unwrap();
        second.rebind(&occupied).unwrap();
        assert!(first.rebind(&occupied).is_err());
        assert!(
            second.rebind(&old).is_err(),
            "failed rebind must retain the old working key"
        );
    }
}
