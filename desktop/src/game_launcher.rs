//! Separate native game entry point. Paths and compatibility evidence are kept
//! outside the game; only the checked-in acceptance authority can permit launch.
use anyhow::{bail, Context, Result};
use ring::digest::{Context as DigestContext, SHA256};
use serde::{Deserialize, Serialize};
use slint::{ComponentHandle, ModelRc, VecModel};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const AUTHORITY: &str = include_str!("../../mod/compatibility.json");
const EXECUTABLE: &str = "CockHero/Binaries/Win64/CockHero.exe";
const REQUIRED: &[&str] = &[
    "lite_open_and_return_from_original_import",
    "synthetic_pack_in_native_unlocks",
    "native_purchase_and_restart",
    "streaming_playback",
    "original_game_regression_and_uninstall",
];

#[derive(Deserialize)]
struct Authority {
    schema: u32,
    candidates: Vec<Candidate>,
    supported_builds: Vec<String>,
}
#[derive(Deserialize)]
struct Candidate {
    id: String,
    status: String,
    files: BTreeMap<String, String>,
    verified: BTreeMap<String, bool>,
    blockers: Vec<String>,
}
impl Authority {
    fn parse(source: &str) -> Result<Self> {
        let authority: Self = serde_json::from_str(source)?;
        if authority.schema != 1 {
            bail!("Unsupported compatibility authority");
        }
        let mut ids = BTreeSet::new();
        for candidate in &authority.candidates {
            if !ids.insert(&candidate.id) || candidate.files.is_empty() {
                bail!("Invalid compatibility build identity");
            }
            for (relative, digest) in &candidate.files {
                if relative.contains(['\\', ':'])
                    || Path::new(relative)
                        .components()
                        .any(|c| !matches!(c, Component::Normal(_)))
                    || digest.len() != 64
                    || !digest
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                {
                    bail!("Invalid compatibility file identity");
                }
            }
        }
        for id in &authority.supported_builds {
            let candidate = authority
                .candidates
                .iter()
                .find(|c| &c.id == id)
                .context("Supported build has no identity")?;
            if candidate.status != "verified"
                || !REQUIRED
                    .iter()
                    .all(|key| candidate.verified.get(*key) == Some(&true))
            {
                bail!("Supported build lacks completed native acceptance evidence");
            }
            if !candidate.files.contains_key(EXECUTABLE) {
                bail!("Supported build has no executable identity");
            }
        }
        Ok(authority)
    }
}

#[derive(Default, Deserialize, Serialize)]
struct Registry {
    schema: u32,
    installs: Vec<Install>,
}
#[derive(Deserialize, Serialize)]
struct Install {
    path: PathBuf,
}

fn registry_path() -> Result<PathBuf> {
    // Explicit override supports portable use and disposable acceptance fixtures.
    if let Some(path) = std::env::var_os("FANSERVICE_CONFIGURED_GAMES") {
        return Ok(path.into());
    }
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    };
    Ok(base
        .context("Unable to locate your configuration directory")?
        .join("Fanservice/configured-games.json"))
}
fn load_registry(path: &Path) -> Result<Registry> {
    let registry: Registry = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).context("Invalid configured game registry")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Registry {
            schema: 1,
            installs: vec![],
        },
        Err(error) => return Err(error.into()),
    };
    if registry.schema != 1
        || registry
            .installs
            .iter()
            .any(|i| i.path.to_string_lossy().trim().is_empty())
    {
        bail!("Invalid configured game registry");
    }
    Ok(registry)
}
fn write_json(path: &Path, data: &impl Serialize) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut staged, data)?;
    staged.write_all(b"\n")?;
    staged.flush()?;
    staged.as_file().sync_all()?;
    staged.persist(path).map_err(|e| e.error)?;
    Ok(())
}
fn path_key(path: &Path) -> String {
    let path = dunce::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned();
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    }
}
fn add_game(registry_path: &Path, root: &Path) -> Result<()> {
    let root = dunce::canonicalize(root)?;
    if !root.is_dir() || !root.join(EXECUTABLE).is_file() {
        bail!("Choose the Windows game folder containing CockHero/Binaries/Win64/CockHero.exe");
    }
    let mut registry = load_registry(registry_path)?;
    registry
        .installs
        .retain(|i| path_key(&i.path) != path_key(&root));
    registry.installs.push(Install { path: root });
    write_json(registry_path, &registry)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Report {
    path: PathBuf,
    build_id: Option<String>,
    supported: bool,
    files: BTreeMap<String, Option<String>>,
    blockers: Vec<String>,
}
#[cfg(test)]
fn sha256(path: &Path) -> Result<String> {
    let mut input = File::open(path)?;
    sha256_input(&mut input)
}
fn sha256_input(input: &mut File) -> Result<String> {
    let mut context = DigestContext::new(&SHA256);
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        context.update(&buffer[..count]);
    }
    Ok(context
        .finish()
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
fn identify(root: &Path, authority: &Authority) -> Report {
    inspect_install(root, authority).0
}

// The launcher holds these handles until process creation completes. On Windows,
// denying write/delete sharing prevents a concurrent updater from replacing a
// hashed file or redirecting one of the directories used to reach it.
fn checked_file(path: &Path) -> Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1); // FILE_SHARE_READ
    }
    Ok(options.open(path)?)
}
#[cfg(windows)]
fn lock_path(path: &Path) -> Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    Ok(std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1) // FILE_SHARE_READ; deny reparse changes and delete/rename
        .custom_flags(0x02000000 | 0x00200000) // BACKUP_SEMANTICS | OPEN_REPARSE_POINT
        .open(path)?)
}
#[cfg(windows)]
fn lock_parents(
    path: &Path,
    root: &Path,
    locked: &mut BTreeSet<PathBuf>,
    handles: &mut Vec<File>,
) -> Result<()> {
    for parent in path.ancestors().skip(1).take_while(|p| *p != root) {
        if locked.insert(parent.to_path_buf()) {
            handles.push(lock_path(parent)?);
        }
    }
    Ok(())
}
struct Verification {
    executable: Option<PathBuf>,
    _handles: Vec<File>,
}
fn inspect_install(root: &Path, authority: &Authority) -> (Report, Verification) {
    let mut handles = Vec::new();
    let mut executable = None;
    let mut report = Report {
        path: root.into(),
        build_id: None,
        supported: false,
        files: BTreeMap::new(),
        blockers: vec![],
    };
    let mut check = || -> Result<BTreeMap<String, Option<String>>> {
        let root =
            dunce::canonicalize(root).context("Configured game installation is unavailable")?;
        #[cfg(windows)]
        handles.push(lock_path(&root)?);
        let paths: BTreeSet<_> = authority
            .candidates
            .iter()
            .flat_map(|c| c.files.keys())
            .collect();
        let mut files = BTreeMap::new();
        #[cfg(windows)]
        let mut locked_directories = BTreeSet::from([root.clone()]);
        for relative in paths {
            let path = root.join(relative);
            let observed = if path.exists() {
                #[cfg(windows)]
                lock_parents(&path, &root, &mut locked_directories, &mut handles)?;
                // Pin a leaf reparse point as well as the actual file it targets.
                #[cfg(windows)]
                handles.push(lock_path(&path)?);
                let path = dunce::canonicalize(path)?;
                if !path.starts_with(&root) {
                    bail!("Game file resolves outside the supplied installation");
                }
                #[cfg(windows)]
                lock_parents(&path, &root, &mut locked_directories, &mut handles)?;
                let mut input = checked_file(&path)?;
                let hash = sha256_input(&mut input)?;
                if relative == EXECUTABLE {
                    executable = Some(path);
                }
                handles.push(input);
                Some(hash)
            } else {
                None
            };
            files.insert(relative.clone(), observed);
        }
        Ok(files)
    };
    match check() {
        Err(error) => report.blockers.push(format!("{error:#}")),
        Ok(files) => {
            if let Some(candidate) = authority.candidates.iter().find(|c| {
                c.files
                    .iter()
                    .all(|(p, hash)| files.get(p).and_then(|v| v.as_ref()) == Some(hash))
            }) {
                report.build_id = Some(candidate.id.clone());
                report.supported = authority.supported_builds.contains(&candidate.id);
                report.blockers = candidate.blockers.clone();
            } else {
                report
                    .blockers
                    .push("Unknown game build; no verified adapter exists.".into());
            }
            report.files = files;
        }
    }
    (
        report,
        Verification {
            executable,
            _handles: handles,
        },
    )
}
#[derive(Default, Deserialize, Serialize)]
struct History {
    schema: u32,
    checks: Vec<RecordedCheck>,
}
#[derive(Deserialize, Serialize)]
struct RecordedCheck {
    checked_at_unix: u64,
    installs: Vec<Report>,
}
struct Resolution {
    reports: Vec<Report>,
    selected: Option<usize>,
    history_path: PathBuf,
}
fn resolve(registry_path: &Path, authority: &Authority) -> Result<Resolution> {
    let reports: Vec<_> = load_registry(registry_path)?
        .installs
        .iter()
        .map(|i| identify(&i.path, authority))
        .collect();
    let history_path = registry_path.with_file_name(format!(
        "{}.checks.json",
        registry_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
    ));
    let mut history = match std::fs::read(&history_path) {
        Ok(data) => {
            let value: History = serde_json::from_slice(&data)
                .context("Invalid game investigation history; retained for recovery")?;
            if value.schema != 1 {
                bail!("Unsupported game investigation history; retained for recovery");
            }
            value
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => History {
            schema: 1,
            checks: vec![],
        },
        Err(error) => return Err(error.into()),
    };
    if history.checks.last().is_none_or(|c| c.installs != reports) {
        history.checks.push(RecordedCheck {
            checked_at_unix: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
            installs: reports.clone(),
        });
        // Bound the log while retaining the initial investigation and recent recovery checks.
        if history.checks.len() > 64 {
            history.checks.remove(1);
        }
        write_json(&history_path, &history)?;
    }
    let selected = reports.iter().rposition(|report| report.supported);
    Ok(Resolution {
        reports,
        selected,
        history_path,
    })
}
fn launch_verified(path: &Path, authority: &Authority) -> Result<()> {
    // Resolve registry aliases once, then retain the verification locks through
    // spawn: UI evidence alone never authorizes launch.
    let path = dunce::canonicalize(path)?;
    let (report, verification) = inspect_install(&path, authority);
    if !report.supported {
        bail!("This installation is not verified compatible. Recheck games to review recovery options.");
    }
    let executable = verification
        .executable
        .as_deref()
        .context("Missing verified executable")?;
    std::process::Command::new(executable)
        .current_dir(
            executable
                .parent()
                .context("Missing game binary directory")?,
        )
        .spawn()?;
    Ok(())
}

slint::slint! {
    import { Button, ScrollView, VerticalBox, HorizontalBox } from "std-widgets.slint";
    export struct GameRow { path: string, label: string }
    export component GameLauncher inherits Window {
        title: "Fanservice Game Launcher";
        width: 800px; height: 650px;
        in property <[GameRow]> games;
        in-out property <int> selected: -1;
        in property <bool> busy: false;
        in property <bool> launchable: false;
        in property <string> status;
        in property <string> details;
        callback add-game(); callback recheck(); callback forget-game();
        callback select-game(int); callback launch-game();
        VerticalBox {
            padding: 20px; spacing: 12px;
            Text { text: "Fanservice games"; font-size: 26px; font-weight: 700; }
            Text { text: "Add your original game folder. You can set up Host before adding a game."; wrap: word-wrap; }
            HorizontalBox {
                Button { text: "Add game…"; enabled: !root.busy; clicked => { root.add-game(); } }
                Button { text: "Recheck games"; enabled: !root.busy; clicked => { root.recheck(); } }
                Button { text: "Forget selected game"; enabled: !root.busy && root.selected >= 0; clicked => { root.forget-game(); } }
            }
            Text { text: root.status; wrap: word-wrap; }
            ScrollView {
                height: 200px;
                VerticalBox {
                    for game[index] in root.games: Rectangle {
                        height: 64px;
                        background: root.selected == index ? #ddeafb : #f2f4f7;
                        VerticalBox { padding: 9px;
                            Text { text: game.label; color: #172333; font-weight: 600; wrap: word-wrap; }
                            Text { text: game.path; color: #172333; overflow: elide; }
                        }
                        TouchArea { enabled: !root.busy; clicked => { root.select-game(index); } }
                    }
                }
            }
            ScrollView { VerticalBox { Text { text: root.details; wrap: word-wrap; } } }
            Button { text: "Launch compatible game"; enabled: !root.busy && root.launchable; clicked => { root.launch-game(); } }
            Text { text: "Mod support requires completed original-game acceptance. Game folders and saves stay in place."; wrap: word-wrap; }
        }
    }
}

fn show_details(ui: &GameLauncher, resolution: &Resolution, index: usize) {
    if let Some(report) = resolution.reports.get(index) {
        ui.set_selected(index as i32);
        ui.set_launchable(report.supported);
        let state = if report.supported {
            "Verified compatible"
        } else {
            "Mod unavailable for this build"
        };
        ui.set_details(format!("{state}\n{}\n{}\n\n{}\n\nInvestigation history: {}\nKeep this game configured and use Recheck games after a supported update to return to this version.",
            report.path.display(), report.build_id.as_deref().unwrap_or("Unrecognized installation"),
            report.blockers.join("\n\n"), resolution.history_path.display()).into());
    }
}
fn verify_async(
    ui: &GameLauncher,
    path: PathBuf,
    launch: Option<PathBuf>,
    state: std::rc::Rc<std::cell::RefCell<Option<Resolution>>>,
    timer: &std::rc::Rc<slint::Timer>,
) {
    ui.set_busy(true);
    ui.set_launchable(false);
    ui.set_status("Verifying exact game files…".into());
    let weak = ui.as_weak();
    // Worker results cross via a channel; Rc/UI state stays on the event thread.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| {
            let authority = Authority::parse(AUTHORITY)?;
            let result = resolve(&path, &authority)?;
            if let Some(game) = launch {
                launch_verified(&game, &authority)?;
            }
            Ok::<_, anyhow::Error>(result)
        })();
        let _ = tx.send(result);
    });
    let timer_callback = std::rc::Rc::downgrade(timer);
    timer.start(slint::TimerMode::Repeated, std::time::Duration::from_millis(100), move || {
        let Ok(result) = rx.try_recv() else { return; };
        if let Some(timer) = timer_callback.upgrade() { timer.stop(); }
        let Some(ui) = weak.upgrade() else { return; };
        ui.set_busy(false);
        match result {
            Err(error) => {
                ui.set_status(format!("{error:#}").into());
                ui.set_selected(-1);
                ui.set_games(ModelRc::new(VecModel::from(Vec::<GameRow>::new())));
                ui.set_details("Use Recheck games after resolving this error.".into());
                *state.borrow_mut() = None;
            },
            Ok(result) => {
                ui.set_games(ModelRc::new(VecModel::from(result.reports.iter().map(|report| GameRow {
                    path: report.path.to_string_lossy().into_owned().into(),
                    label: format!("{} · {}", report.build_id.as_deref().unwrap_or("Unknown / unavailable game"), if report.supported { "Compatible" } else { "Blocked" }).into(),
                }).collect::<Vec<_>>())));
                ui.set_selected(-1);
                let status = if result.reports.is_empty() { "No game configured. Choose Add game when you have a game folder." }
                    else if result.selected.is_none() { "No verified compatible game or older fallback is available. Review the recorded blockers below." }
                    else if result.selected != result.reports.len().checked_sub(1) { "Newest configured game is blocked. A previously configured compatible game is offered below; the newer game remains available for recovery." }
                    else { "Newest configured compatible game is ready." };
                ui.set_status(status.into());
                ui.set_details("".into());
                if !result.reports.is_empty() { show_details(&ui, &result, result.selected.unwrap_or(result.reports.len() - 1)); }
                *state.borrow_mut() = Some(result);
            }
        }
    });
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let path = registry_path()?;
    let ui = GameLauncher::new()?;
    let state = std::rc::Rc::new(std::cell::RefCell::new(None::<Resolution>));
    let timer = std::rc::Rc::new(slint::Timer::default());
    let weak = ui.as_weak();
    let add_path = path.clone();
    let add_state = state.clone();
    let add_timer = timer.clone();
    ui.on_add_game(move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        if let Some(folder) = rfd::FileDialog::new()
            .set_title("Choose the Windows folder containing CockHero")
            .pick_folder()
        {
            match add_game(&add_path, &folder) {
                Ok(()) => verify_async(&ui, add_path.clone(), None, add_state.clone(), &add_timer),
                Err(error) => ui.set_status(format!("{error:#}").into()),
            }
        }
    });
    let weak = ui.as_weak();
    let select_state = state.clone();
    ui.on_select_game(move |index| {
        if let (Some(ui), Some(result)) = (weak.upgrade(), select_state.borrow().as_ref()) {
            if index >= 0 {
                show_details(&ui, result, index as usize);
            }
        }
    });
    let weak = ui.as_weak();
    let check_path = path.clone();
    let check_state = state.clone();
    let check_timer = timer.clone();
    ui.on_recheck(move || {
        if let Some(ui) = weak.upgrade() {
            verify_async(
                &ui,
                check_path.clone(),
                None,
                check_state.clone(),
                &check_timer,
            );
        }
    });
    let weak = ui.as_weak();
    let remove_path = path.clone();
    let remove_state = state.clone();
    let remove_timer = timer.clone();
    ui.on_forget_game(move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        let target = remove_state
            .borrow()
            .as_ref()
            .and_then(|r| r.reports.get(ui.get_selected() as usize))
            .map(|r| r.path.clone());
        if let Some(target) = target {
            let result = (|| {
                let mut registry = load_registry(&remove_path)?;
                registry
                    .installs
                    .retain(|i| path_key(&i.path) != path_key(&target));
                write_json(&remove_path, &registry)
            })();
            match result {
                Ok(()) => verify_async(
                    &ui,
                    remove_path.clone(),
                    None,
                    remove_state.clone(),
                    &remove_timer,
                ),
                Err(error) => ui.set_status(format!("{error:#}").into()),
            }
        }
    });
    let weak = ui.as_weak();
    let launch_path = path.clone();
    let launch_state = state.clone();
    let launch_timer = timer.clone();
    ui.on_launch_game(move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        let target = launch_state
            .borrow()
            .as_ref()
            .and_then(|r| r.reports.get(ui.get_selected() as usize))
            .filter(|r| r.supported)
            .map(|r| r.path.clone());
        if let Some(target) = target {
            verify_async(
                &ui,
                launch_path.clone(),
                Some(target),
                launch_state.clone(),
                &launch_timer,
            );
        }
    });
    verify_async(&ui, path, None, state, &timer);
    ui.run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> tempfile::TempDir {
        let root = std::env::var_os("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        tempfile::tempdir_in(root).unwrap()
    }

    fn fixture_authority(executable: &Path) -> Authority {
        Authority::parse(&serde_json::json!({
            "schema": 1, "supported_builds": ["accepted-fixture"],
            "candidates": [{"id":"accepted-fixture", "status":"verified",
                "files":{EXECUTABLE: sha256(executable).unwrap()},
                "verified":REQUIRED.iter().map(|k| ((*k).to_string(), true)).collect::<BTreeMap<_, _>>(),
                "blockers":[] }]
        }).to_string()).unwrap()
    }
    fn fake_game(root: &Path, data: &[u8]) -> PathBuf {
        let game = root.to_path_buf();
        std::fs::create_dir_all(game.join(EXECUTABLE).parent().unwrap()).unwrap();
        std::fs::write(game.join(EXECUTABLE), data).unwrap();
        game
    }

    #[test]
    fn game_launcher_shipping_authority_remains_fail_closed() {
        assert!(Authority::parse(AUTHORITY)
            .unwrap()
            .supported_builds
            .is_empty());
        let temp = test_directory();
        let game = fake_game(&temp.path().join("game"), b"neutral synthetic executable");
        let authority = Authority::parse(AUTHORITY).unwrap();
        assert!(!identify(&game, &authority).supported);
        assert!(launch_verified(&game, &authority).is_err());
    }

    #[test]
    fn game_launcher_retains_newer_failure_and_offers_older_until_recovered() {
        let temp = test_directory();
        let old = fake_game(&temp.path().join("older"), b"accepted");
        let new = fake_game(&temp.path().join("newer"), b"incompatible update");
        let authority = fixture_authority(&old.join(EXECUTABLE));
        let registry = temp.path().join("configured-games.json");
        add_game(&registry, &old).unwrap();
        add_game(&registry, &new).unwrap();
        let fallback = resolve(&registry, &authority).unwrap();
        assert_eq!(fallback.selected, Some(0));
        assert!(!fallback.reports[1].supported);
        assert_eq!(fallback.reports[1].path, dunce::canonicalize(&new).unwrap());
        resolve(&registry, &authority).unwrap(); // Identical checks do not hide the investigation in duplicate entries.
        std::fs::write(new.join(EXECUTABLE), b"accepted").unwrap();
        let recovered = resolve(&registry, &authority).unwrap();
        assert_eq!(recovered.selected, Some(1));
        let history: History =
            serde_json::from_slice(&std::fs::read(recovered.history_path).unwrap()).unwrap();
        assert_eq!(history.checks.len(), 2);
        assert!(!history.checks[0].installs[1].supported);
        assert!(history.checks[1].installs[1].supported);
        // A post-verification update is rejected again before any process spawn.
        std::fs::write(new.join(EXECUTABLE), b"changed after check").unwrap();
        assert!(launch_verified(&new, &authority).is_err());
    }

    #[test]
    fn game_launcher_reads_python_registry_and_preserves_unavailable_paths() {
        let temp = test_directory();
        let path = temp.path().join("configured-games.json");
        let missing = temp.path().join("uninstalled");
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({"schema":1,"installs":[{"path":missing}]}))
                .unwrap(),
        )
        .unwrap();
        let result = resolve(&path, &Authority::parse(AUTHORITY).unwrap()).unwrap();
        assert!(result.selected.is_none());
        assert_eq!(result.reports[0].path, missing);
        assert!(result.reports[0].blockers[0].contains("unavailable"));
        assert_eq!(load_registry(&path).unwrap().installs.len(), 1);
        std::fs::write(&path, br#"{"schema":1,"installs":[{"path":"   "}]}"#).unwrap();
        assert!(load_registry(&path).is_err());
    }

    #[test]
    fn game_launcher_add_moves_to_newest_and_rejects_wrong_folder() {
        let temp = test_directory();
        let path = temp.path().join("configured-games.json");
        let old = fake_game(&temp.path().join("older"), b"one");
        let new = fake_game(&temp.path().join("newer"), b"two");
        add_game(&path, &old).unwrap();
        add_game(&path, &new).unwrap();
        add_game(&path, &old).unwrap();
        assert_eq!(
            load_registry(&path)
                .unwrap()
                .installs
                .iter()
                .map(|i| i.path.clone())
                .collect::<Vec<_>>(),
            vec![
                dunce::canonicalize(&new).unwrap(),
                dunce::canonicalize(&old).unwrap()
            ]
        );
        assert!(add_game(&path, temp.path()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn game_launcher_verification_holds_files_and_directories_until_spawn() {
        let temp = test_directory();
        let game = fake_game(&temp.path().join("game"), b"accepted");
        let executable = game.join(EXECUTABLE);
        let authority = fixture_authority(&executable);
        let (report, handles) = inspect_install(&game, &authority);
        assert!(report.supported);
        assert_eq!(
            handles.executable,
            Some(dunce::canonicalize(&executable).unwrap())
        );
        assert!(std::fs::OpenOptions::new()
            .write(true)
            .open(&executable)
            .is_err());
        assert!(std::fs::rename(&executable, executable.with_extension("old")).is_err());
        assert!(std::fs::rename(&game, temp.path().join("moved")).is_err());
        let parent = executable.parent().unwrap();
        assert!(std::fs::rename(parent, parent.with_file_name("Win64-old")).is_err());
        drop(handles);
        std::fs::write(&executable, b"updated").unwrap();
        assert!(!identify(&game, &authority).supported);
    }
}
