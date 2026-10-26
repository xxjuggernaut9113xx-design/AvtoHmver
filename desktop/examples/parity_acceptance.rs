//! Isolated manual acceptance launcher. Never opens an existing unmarked data directory.
use std::{path::PathBuf, sync::Arc};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let argument = std::env::args()
        .nth(1)
        .ok_or("Usage: parity_acceptance.exe FIXTURE_DIRECTORY [--server]")?;
    let root = PathBuf::from(argument);
    if !root.is_absolute() {
        return Err("Fixture directory must be absolute".into());
    }
    if root.exists() && !root.join(".parity-fixture").is_file() {
        return Err(
            "Refusing to open an existing directory without the parity fixture marker".into(),
        );
    }
    std::fs::create_dir_all(&root)?;
    std::fs::write(
        root.join(".parity-fixture"),
        b"AvtoHmver disposable acceptance fixture\n",
    )?;
    let config = root.join("config");
    std::fs::create_dir_all(&config)?;
    std::env::set_var("AVTOHMVER_CONFIG_DIR", &config);
    std::env::set_var("AVTOHMVER_DATA_DIR", root.join("data"));
    let server_only = std::env::args().any(|argument| argument == "--server");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let state = Arc::new(runtime.block_on(avtohmver::initialize_with_options(
        avtohmver::InitOptions {
            edition: if server_only {
                avtohmver::ProductEdition::Server
            } else {
                avtohmver::ProductEdition::Host
            },
            install_scope: avtohmver::edition::InstallScope::CurrentUser,
            data_dir_override: Some(root.join("data")),
        },
    ))?);
    let port = runtime.block_on(avtohmver::remote::start_http_server_on(&state, 0))?;
    std::fs::write(
        root.join("ready.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "port":port, "pid":std::process::id(), "data_dir":state.data_dir, "library_dir":state.library_dir,
            "edition":state.edition.as_str(),
        }))?,
    )?;
    let result = if server_only {
        runtime
            .block_on(tokio::signal::ctrl_c())
            .map_err(Into::into)
    } else {
        let client = avtohmver::native::LocalClient::new((*state).clone())?;
        avtohmver_desktop::run_ui_host(
            &runtime,
            avtohmver::native::Client::Local(client),
            false,
            state.clone(),
        )
    };
    runtime.block_on(avtohmver::shutdown(&state));
    result
}
