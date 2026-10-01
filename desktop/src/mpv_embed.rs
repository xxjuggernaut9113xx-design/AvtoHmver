//! Runtime-loaded libmpv client and software-render API.
//!
//! The player worker owns this module's handles. No libmpv call crosses the
//! UI thread boundary, which keeps the render context on one thread and lets
//! the Slint UI receive bounded RGBA frame snapshots instead of a second OS
//! player window.

use libloading::Library;
use std::{
    ffi::{CStr, CString},
    os::raw::{c_char, c_double, c_int, c_ulonglong, c_void},
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

#[repr(C)]
pub struct MpvHandle {
    _opaque: [u8; 0],
}

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: c_ulonglong,
    data: *mut c_void,
}

/// The prefix of mpv_event_end_file. `reason` and `error` are ABI-stable
/// first fields; later fields are deliberately not read.
#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

#[repr(C)]
struct MpvRenderContext {
    _opaque: [u8; 0],
}

#[repr(C)]
struct MpvRenderParam {
    param_type: c_int,
    data: *mut c_void,
}

const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_END_FILE_REASON_EOF: c_int = 0;

const MPV_RENDER_PARAM_INVALID: c_int = 0;
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;
const MPV_RENDER_UPDATE_FRAME: c_ulonglong = 1;

type MpvCreate = unsafe extern "C" fn() -> *mut MpvHandle;
type MpvInitialize = unsafe extern "C" fn(*mut MpvHandle) -> c_int;
type MpvTerminateDestroy = unsafe extern "C" fn(*mut MpvHandle);
type MpvSetOptionString =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type MpvCommand = unsafe extern "C" fn(*mut MpvHandle, *const *const c_char) -> c_int;
type MpvSetPropertyString =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type MpvGetPropertyString = unsafe extern "C" fn(*mut MpvHandle, *const c_char) -> *mut c_char;
type MpvFree = unsafe extern "C" fn(*mut c_void);
type MpvWaitEvent = unsafe extern "C" fn(*mut MpvHandle, c_double) -> *mut MpvEvent;
type MpvErrorString = unsafe extern "C" fn(c_int) -> *const c_char;
type MpvRenderContextCreate = unsafe extern "C" fn(
    *mut *mut MpvRenderContext,
    *mut MpvHandle,
    *const MpvRenderParam,
) -> c_int;
type MpvRenderContextFree = unsafe extern "C" fn(*mut MpvRenderContext);
type MpvRenderContextRender =
    unsafe extern "C" fn(*mut MpvRenderContext, *const MpvRenderParam) -> c_int;
type MpvRenderUpdateCallback = unsafe extern "C" fn(*mut c_void);
type MpvRenderContextSetUpdateCallback =
    unsafe extern "C" fn(*mut MpvRenderContext, Option<MpvRenderUpdateCallback>, *mut c_void);
type MpvRenderContextUpdate = unsafe extern "C" fn(*mut MpvRenderContext) -> c_ulonglong;

/// Resolve an install-relative libmpv before asking the operating system to
/// search its library paths. An explicit override remains useful for a
/// disposable test library or an administrator managed installation.
pub fn resolve_libmpv() -> PathBuf {
    if let Some(path) = avtohmver::config::env_var_os("CURATOR_LIBMPV_PATH") {
        return PathBuf::from(path);
    }
    let name = if cfg!(windows) {
        "libmpv-2.dll"
    } else {
        "libmpv.so.2"
    };
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            let staged = directory.join("tools").join(name);
            if staged.is_file() {
                return staged;
            }
            let adjacent = directory.join(name);
            if adjacent.is_file() {
                return adjacent;
            }
        }
    }
    PathBuf::from(name)
}

pub struct MpvApi {
    _library: Library,
    create: MpvCreate,
    initialize: MpvInitialize,
    terminate_destroy: MpvTerminateDestroy,
    set_option_string: MpvSetOptionString,
    command: MpvCommand,
    set_property_string: MpvSetPropertyString,
    get_property_string: MpvGetPropertyString,
    free: MpvFree,
    wait_event: MpvWaitEvent,
    error_string: MpvErrorString,
    render_context_create: MpvRenderContextCreate,
    render_context_free: MpvRenderContextFree,
    render_context_render: MpvRenderContextRender,
    render_context_set_update_callback: MpvRenderContextSetUpdateCallback,
    render_context_update: MpvRenderContextUpdate,
}

impl MpvApi {
    pub fn load() -> Result<Self, String> {
        let path = resolve_libmpv();
        // SAFETY: the library stays in this structure for the lifetime of all
        // copied function pointers below.
        let library = unsafe { Library::new(&path) }
            .map_err(|error| format!("Could not load libmpv from {}: {error}", path.display()))?;
        // SAFETY: each symbol is copied out while the library is live and its
        // ABI is defined by libmpv's public C header.
        unsafe fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
            Ok(*library.get::<T>(name).map_err(|error| {
                format!(
                    "libmpv is missing {}: {error}",
                    String::from_utf8_lossy(name)
                )
            })?)
        }
        // SAFETY: see `symbol`; every requested symbol is part of the stable
        // client/render APIs used by bundled libmpv.
        unsafe {
            Ok(Self {
                create: symbol(&library, b"mpv_create\0")?,
                initialize: symbol(&library, b"mpv_initialize\0")?,
                terminate_destroy: symbol(&library, b"mpv_terminate_destroy\0")?,
                set_option_string: symbol(&library, b"mpv_set_option_string\0")?,
                command: symbol(&library, b"mpv_command\0")?,
                set_property_string: symbol(&library, b"mpv_set_property_string\0")?,
                get_property_string: symbol(&library, b"mpv_get_property_string\0")?,
                free: symbol(&library, b"mpv_free\0")?,
                wait_event: symbol(&library, b"mpv_wait_event\0")?,
                error_string: symbol(&library, b"mpv_error_string\0")?,
                render_context_create: symbol(&library, b"mpv_render_context_create\0")?,
                render_context_free: symbol(&library, b"mpv_render_context_free\0")?,
                render_context_render: symbol(&library, b"mpv_render_context_render\0")?,
                render_context_set_update_callback: symbol(
                    &library,
                    b"mpv_render_context_set_update_callback\0",
                )?,
                render_context_update: symbol(&library, b"mpv_render_context_update\0")?,
                _library: library,
            })
        }
    }

    fn describe_error(&self, code: c_int) -> String {
        // SAFETY: libmpv returns a process-lifetime string for this function.
        unsafe {
            let text = (self.error_string)(code);
            if text.is_null() {
                format!("libmpv error {code}")
            } else {
                CStr::from_ptr(text).to_string_lossy().into_owned()
            }
        }
    }
}

/// An initialized handle used only by the player worker thread.
pub struct MpvInstance {
    api: MpvApi,
    handle: *mut MpvHandle,
}

impl MpvInstance {
    pub fn create() -> Result<Self, String> {
        Self::create_mode(false)
    }

    pub fn create_audio() -> Result<Self, String> {
        Self::create_mode(true)
    }

    fn create_mode(audio_only: bool) -> Result<Self, String> {
        let api = MpvApi::load()?;
        // SAFETY: `mpv_create` takes no arguments and returns either a valid
        // handle or null.
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("libmpv could not allocate a player handle".into());
        }
        let mut instance = Self { api, handle };
        for (name, value) in [
            ("terminal", "no"),
            ("msg-level", "all=no"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            ("osc", "no"),
            ("ytdl", "no"),
            ("force-window", "no"),
            // The render context supplies the video output; without this,
            // mpv can decode and advance a file while never producing frames.
            ("vo", if audio_only { "null" } else { "libmpv" }),
            ("vid", if audio_only { "no" } else { "auto" }),
        ] {
            instance.set_option(name, value)?;
        }
        // SAFETY: handle is initialized and all init-only options are set.
        let code = unsafe { (instance.api.initialize)(instance.handle) };
        if code < 0 {
            return Err(format!(
                "libmpv initialization failed: {}",
                instance.api.describe_error(code)
            ));
        }
        Ok(instance)
    }

    fn cstring(value: &str, field: &str) -> Result<CString, String> {
        CString::new(value).map_err(|_| format!("{field} contains a NUL byte"))
    }

    fn set_option(&mut self, name: &str, value: &str) -> Result<(), String> {
        let name = Self::cstring(name, "libmpv option name")?;
        let value = Self::cstring(value, "libmpv option value")?;
        // SAFETY: handle and NUL-terminated arguments are valid for the call.
        let code =
            unsafe { (self.api.set_option_string)(self.handle, name.as_ptr(), value.as_ptr()) };
        if code < 0 {
            Err(format!(
                "libmpv option failed: {}",
                self.api.describe_error(code)
            ))
        } else {
            Ok(())
        }
    }

    pub fn command(&mut self, args: &[&str]) -> Result<(), String> {
        let args = args
            .iter()
            .map(|argument| Self::cstring(argument, "libmpv command"))
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = args
            .iter()
            .map(|argument| argument.as_ptr())
            .collect::<Vec<_>>();
        pointers.push(std::ptr::null());
        // SAFETY: command arguments are NUL terminated and the array ends in
        // a null pointer for the duration of this synchronous call.
        let code = unsafe { (self.api.command)(self.handle, pointers.as_ptr()) };
        if code < 0 {
            Err(format!(
                "libmpv command failed: {}",
                self.api.describe_error(code)
            ))
        } else {
            Ok(())
        }
    }

    pub fn set_property(&mut self, name: &str, value: &str) -> Result<(), String> {
        let name = Self::cstring(name, "libmpv property name")?;
        let value = Self::cstring(value, "libmpv property value")?;
        // SAFETY: handle and NUL-terminated arguments are valid for the call.
        let code =
            unsafe { (self.api.set_property_string)(self.handle, name.as_ptr(), value.as_ptr()) };
        if code < 0 {
            Err(format!(
                "libmpv property failed: {}",
                self.api.describe_error(code)
            ))
        } else {
            Ok(())
        }
    }

    pub fn property(&mut self, name: &str) -> Result<String, String> {
        let name = Self::cstring(name, "libmpv property name")?;
        // SAFETY: libmpv returns an allocated string, released below with its
        // matching free function before another API call.
        let pointer = unsafe { (self.api.get_property_string)(self.handle, name.as_ptr()) };
        if pointer.is_null() {
            return Err(format!("libmpv returned no value for {name:?}"));
        }
        let value = unsafe { CStr::from_ptr(pointer).to_string_lossy().into_owned() };
        unsafe { (self.api.free)(pointer.cast()) };
        Ok(value)
    }

    pub fn next_event(&mut self) -> Option<PlayerEvent> {
        // SAFETY: the player worker is the only caller on this handle. The
        // event data is inspected before the next call invalidates it.
        let event = unsafe { (self.api.wait_event)(self.handle, 0.0) };
        if event.is_null() {
            return None;
        }
        let event = unsafe { &*event };
        match event.event_id {
            MPV_EVENT_NONE => None,
            MPV_EVENT_FILE_LOADED => Some(PlayerEvent::FileLoaded),
            MPV_EVENT_END_FILE => {
                let (eof, failed) = if event.data.is_null() {
                    (false, true)
                } else {
                    let end = unsafe { &*(event.data.cast::<MpvEventEndFile>()) };
                    (end.reason == MPV_END_FILE_REASON_EOF, end.error < 0)
                };
                Some(PlayerEvent::EndFile { eof, failed })
            }
            MPV_EVENT_SHUTDOWN => Some(PlayerEvent::Shutdown),
            _ => None,
        }
    }

    pub fn create_renderer(&mut self, width: u32, height: u32) -> Result<SoftwareRenderer, String> {
        SoftwareRenderer::create(self, width, height)
    }
}

impl Drop for MpvInstance {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: this is the sole owning instance and any render context
            // is dropped first by the worker's local declaration order.
            unsafe { (self.api.terminate_destroy)(self.handle) };
            self.handle = std::ptr::null_mut();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerEvent {
    FileLoaded,
    EndFile { eof: bool, failed: bool },
    Shutdown,
}

/// Software fallback frames are opaque RGBA pixels ready for Slint.
pub struct SoftwareRenderer {
    context: *mut MpvRenderContext,
    api: *const MpvApi,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
    /// libmpv may notify from a core thread. The callback can only set this
    /// flag; actual API calls stay confined to the render worker.
    update_pending: Box<AtomicBool>,
}

unsafe extern "C" fn render_update_callback(context: *mut c_void) {
    if let Some(pending) = unsafe { context.cast::<AtomicBool>().as_ref() } {
        pending.store(true, Ordering::Release);
    }
}

impl SoftwareRenderer {
    fn create(instance: &mut MpvInstance, width: u32, height: u32) -> Result<Self, String> {
        let width = width.max(1);
        let height = height.max(1);
        let api_name = CString::new("sw").expect("static string has no NUL");
        let params = [
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_API_TYPE,
                data: api_name.as_ptr().cast_mut().cast(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        let mut context = std::ptr::null_mut();
        // SAFETY: instance is initialized, parameters are terminated, and the
        // output pointer remains valid for the synchronous call.
        let code = unsafe {
            (instance.api.render_context_create)(&mut context, instance.handle, params.as_ptr())
        };
        if code < 0 || context.is_null() {
            return Err(format!(
                "libmpv software renderer failed: {}",
                instance.api.describe_error(code)
            ));
        }
        let update_pending = Box::new(AtomicBool::new(true));
        // SAFETY: the boxed flag outlives this context, the callback only
        // performs an atomic store, and it is detached before freeing.
        unsafe {
            (instance.api.render_context_set_update_callback)(
                context,
                Some(render_update_callback),
                (&*update_pending as *const AtomicBool).cast_mut().cast(),
            )
        };
        let bytes = (width as usize)
            .checked_mul(height as usize)
            .and_then(|size| size.checked_mul(4))
            .ok_or_else(|| "Requested video frame is too large".to_owned())?;
        Ok(Self {
            context,
            api: &instance.api,
            width,
            height,
            pixels: vec![0; bytes],
            update_pending,
        })
    }

    pub fn render(&mut self) -> Result<bool, String> {
        if !self.update_pending.swap(false, Ordering::AcqRel) {
            return Ok(false);
        }
        // SAFETY: the context belongs to this worker thread.
        let flags = unsafe { ((*self.api).render_context_update)(self.context) };
        if flags & MPV_RENDER_UPDATE_FRAME == 0 {
            return Ok(false);
        }
        let size = [self.width as c_int, self.height as c_int];
        let format = CString::new("rgb0").expect("static string has no NUL");
        let stride = self.width as usize * 4;
        let params = [
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_SW_SIZE,
                data: size.as_ptr().cast_mut().cast(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_SW_FORMAT,
                data: format.as_ptr().cast_mut().cast(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_SW_STRIDE,
                data: (&stride as *const usize).cast_mut().cast(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_SW_POINTER,
                data: self.pixels.as_mut_ptr().cast(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        // SAFETY: the pixel buffer is writable for stride*height bytes and
        // all parameter pointees live through this synchronous call.
        let code = unsafe { ((*self.api).render_context_render)(self.context, params.as_ptr()) };
        if code < 0 {
            return Err(format!("libmpv render failed: {}", unsafe {
                (*self.api).describe_error(code)
            }));
        }
        // `rgb0` deliberately leaves alpha undefined; Slint images require
        // opaque alpha for video pixels.
        for alpha in self.pixels.iter_mut().skip(3).step_by(4) {
            *alpha = u8::MAX;
        }
        Ok(true)
    }

    pub fn frame(&self) -> (&[u8], u32, u32) {
        (&self.pixels, self.width, self.height)
    }
}

impl Drop for SoftwareRenderer {
    fn drop(&mut self) {
        if !self.context.is_null() {
            // SAFETY: detach the callback before freeing its context and
            // backing atomic flag. The renderer is dropped before MpvInstance.
            unsafe {
                ((*self.api).render_context_set_update_callback)(
                    self.context,
                    None,
                    std::ptr::null_mut(),
                );
                ((*self.api).render_context_free)(self.context);
            };
            self.context = std::ptr::null_mut();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn libmpv_resolution_has_a_filename() {
        assert!(!resolve_libmpv().as_os_str().is_empty());
    }
}
