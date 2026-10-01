#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|arg| arg == "--version" || arg == "-V") {
        println!("AvtoHmver Host {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let runtime = tokio::runtime::Runtime::new()?;
    // A data-directory move scheduled from the UI lands here, before the
    // database pool, directory lock, or any worker exists — the only safe
    // moment to rename or copy the whole tree.
    if let Err(error) = avtohmver_desktop::datadir::apply_pending_move() {
        eprintln!(
            "scheduled data directory move failed: {error:#}; starting with the previous location"
        );
    }
    let state = runtime.block_on(avtohmver::initialize_host())?;
    let arguments: Vec<String> = std::env::args().collect();
    let background = arguments.iter().any(|argument| argument == "--background");
    // The Windows Host always owns its HTTP listener. The phone/browser
    // client must remain reachable during an ordinary desktop launch and
    // after the window hides to the tray; LAN exposure itself remains
    // opt-in, while loopback and detected Tailscale addresses are safe
    // defaults. Listener failure must never prevent local native use.
    if let Err(error) = runtime.block_on(avtohmver::remote::start_http_server(&state)) {
        eprintln!("Remote access could not start; local library remains available: {error}");
    }
    let client = avtohmver::native::LocalClient::new(state.clone())?;
    let shared = std::sync::Arc::new(state);
    let result = avtohmver_desktop::run_ui_host(
        &runtime,
        avtohmver::native::Client::Local(client),
        background,
        shared.clone(),
    );
    runtime.block_on(avtohmver::shutdown(&shared));
    result
}
