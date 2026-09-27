#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Viewer owns only this small preferences file. It never initializes Curator's
// database or server and every request is pinned to a Tailnet peer IP.
slint::include_modules!();

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    net::IpAddr,
    path::PathBuf,
    time::Duration,
};

const DEFAULT_PORT: u16 = 42168;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedHost {
    name: String,
    endpoint: String,
    instance_id: String,
    /// Keep preferences introduced by a newer Viewer build intact when an
    /// older build merely changes a host name or endpoint.
    #[serde(default, flatten)]
    extra: BTreeMap<String, Value>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
struct HostStore {
    #[serde(default)]
    hosts: Vec<SavedHost>,
    #[serde(default, flatten)]
    extra: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
struct SystemInfo {
    edition: String,
    api_protocol: String,
    instance_id: String,
    tailnet_only: bool,
    #[serde(default)]
    viewer_permissions: curator::native::ViewerPermissions,
}
#[derive(Deserialize)]
struct TailscaleStatus {
    #[serde(rename = "BackendState")]
    backend_state: Option<String>,
    #[serde(rename = "Peer", default)]
    peers: HashMap<String, TailscaleNode>,
    #[serde(rename = "Self")]
    self_node: Option<TailscaleNode>,
}
#[derive(Deserialize)]
struct TailscaleNode {
    #[serde(rename = "DNSName")]
    dns_name: Option<String>,
    #[serde(rename = "HostName")]
    host_name: Option<String>,
    #[serde(rename = "TailscaleIPs", default)]
    tailscale_ips: Vec<String>,
}
struct TailnetPeer {
    names: BTreeSet<String>,
    ips: BTreeSet<IpAddr>,
}

fn preferences_path() -> Result<PathBuf, String> {
    let directory = dirs::config_dir()
        .ok_or("No user configuration directory is available.")?
        .join("tech.webmaster19083.curator.viewer");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("hosts.json"))
}
fn legacy_preferences_path() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("No user configuration directory is available.")?
        .join("Curator Viewer")
        .join("hosts.json"))
}
fn load_hosts() -> Result<HostStore, String> {
    let primary = preferences_path()?;
    match std::fs::read_to_string(&primary) {
        Ok(text) => serde_json::from_str(&text).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let legacy = legacy_preferences_path()?;
            match std::fs::read_to_string(legacy) {
                Ok(text) => serde_json::from_str(&text).map_err(|error| error.to_string()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Ok(HostStore::default())
                }
                Err(error) => Err(error.to_string()),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}
fn write_hosts(store: &HostStore) -> Result<(), String> {
    use std::io::Write;
    let path = preferences_path()?;
    let parent = path.parent().ok_or("Invalid Viewer preferences path")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut file, store).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}
fn save_host(mut host: SavedHost) -> Result<(), String> {
    let mut store = load_hosts()?;
    if let Some(previous) = store
        .hosts
        .iter_mut()
        .find(|item| item.instance_id == host.instance_id)
    {
        host.extra = std::mem::take(&mut previous.extra);
        *previous = host;
    } else {
        store.hosts.push(host);
    }
    write_hosts(&store)
}
fn remove_host(index: usize) -> Result<(), String> {
    let mut store = load_hosts()?;
    if index >= store.hosts.len() {
        return Err("The saved Host no longer exists.".into());
    }
    store.hosts.remove(index);
    write_hosts(&store)
}
fn normalized_endpoint(raw: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(raw.trim())
        .map_err(|_| "Enter an http:// Tailnet host URL.".to_string())?;
    if url.scheme() != "http"
        || url.host_str().is_none()
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Enter only an http:// Tailnet host origin without credentials or a path.".into(),
        );
    }
    if url.port().is_none() {
        url.set_port(Some(DEFAULT_PORT))
            .map_err(|_| "Could not set the Curator port.")?;
    }
    Ok(url)
}
async fn tailnet_peers() -> Result<Vec<TailnetPeer>, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        curator::process::command("tailscale")
            .args(["status", "--json"])
            .output(),
    )
    .await
    .map_err(|_| "Timed out waiting for Tailscale.")?
    .map_err(|_| "Tailscale is not available on this device.")?;
    if !output.status.success() {
        return Err("Tailscale did not return a connected peer inventory.".into());
    }
    let status: TailscaleStatus = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Tailscale returned unreadable peer data.")?;
    if !status
        .backend_state
        .as_deref()
        .is_some_and(|state| state.eq_ignore_ascii_case("running"))
    {
        return Err("Tailscale is not connected.".into());
    }
    let mut nodes: Vec<_> = status.peers.into_values().collect();
    if let Some(node) = status.self_node {
        nodes.push(node);
    }
    Ok(nodes
        .into_iter()
        .filter_map(|node| {
            let ips = node
                .tailscale_ips
                .iter()
                .filter_map(|value| value.parse().ok())
                .collect::<BTreeSet<IpAddr>>();
            if ips.is_empty() {
                return None;
            }
            let mut names = BTreeSet::new();
            if let Some(name) = node.dns_name {
                names.insert(name.trim_end_matches('.').to_ascii_lowercase());
            }
            if let Some(name) = node.host_name {
                names.insert(name.to_ascii_lowercase());
            }
            Some(TailnetPeer { names, ips })
        })
        .collect())
}
fn origin(ip: IpAddr, port: u16) -> String {
    match ip {
        IpAddr::V4(ip) => format!("http://{ip}:{port}"),
        IpAddr::V6(ip) => format!("http://[{ip}]:{port}"),
    }
}
/// Outcome of one connect flow: the handshake data and the pinned origin that
/// actually answered (which may differ from the saved endpoint when the host
/// moved to a new Tailnet address).
struct ConnectedHost {
    instance_id: String,
    pinned: String,
    permissions: curator::native::ViewerPermissions,
}

/// Events the background connect task streams to the UI so a stalled or
/// moved host is never a silent spinner.
enum ConnectEvent {
    Progress(String),
    Attempt(u32),
    Finished(String, String, Result<ConnectedHost, String>),
}

/// One `/api/system/info` handshake against a pinned Tailnet origin.
async fn handshake(
    client: &reqwest::Client,
    pinned: &str,
) -> Result<(String, curator::native::ViewerPermissions), String> {
    let info = client
        .get(format!("{pinned}/api/system/info"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?
        .json::<SystemInfo>()
        .await
        .map_err(|_| format!("{pinned}: invalid system information"))?;
    if info.api_protocol == curator::API_PROTOCOL
        && matches!(info.edition.as_str(), "host" | "server")
        && info.tailnet_only
    {
        Ok((info.instance_id, info.viewer_permissions))
    } else {
        Err(format!("{pinned}: incompatible Curator host"))
    }
}

async fn connect_once(
    endpoint: &str,
    peers: &[TailnetPeer],
    client: &reqwest::Client,
) -> Result<(String, String, curator::native::ViewerPermissions), String> {
    let url = normalized_endpoint(endpoint)?;
    let name = url
        .host_str()
        .unwrap()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let peer = peers
        .iter()
        .find(|peer| {
            name.parse::<IpAddr>()
                .map(|ip| peer.ips.contains(&ip))
                .unwrap_or_else(|_| peer.names.contains(&name))
        })
        .ok_or("That host is not in this device's Tailnet peer inventory.")?;
    let mut addresses = if let Ok(ip) = name.parse() {
        vec![ip]
    } else {
        tokio::net::lookup_host((
            name.as_str(),
            url.port_or_known_default().unwrap_or(DEFAULT_PORT),
        ))
        .await
        .map_err(|_| "Could not resolve that Tailnet hostname.")?
        .map(|address| address.ip())
        .collect()
    };
    addresses.sort();
    addresses.dedup();
    if addresses.is_empty() || addresses.iter().any(|ip| !peer.ips.contains(ip)) {
        return Err(
            "The host did not resolve solely to the Tailnet peer reported by Tailscale.".into(),
        );
    }
    let port = url.port_or_known_default().unwrap_or(DEFAULT_PORT);
    let mut failures = Vec::new();
    for address in addresses {
        let pinned = origin(address, port);
        match handshake(client, &pinned).await {
            Ok((instance_id, permissions)) => return Ok((instance_id, pinned, permissions)),
            Err(error) => failures.push(format!("{address}: {error}")),
        }
    }
    Err(format!(
        "Could not connect to a compatible Tailnet Curator host ({})",
        failures.join("; ")
    ))
}

/// Connect to `endpoint`. When the saved host no longer answers at its saved
/// address, sweep the Tailnet peer inventory for the same library identity
/// (`expected_instance_id`) and reconnect wherever it moved. Progress goes
/// to the UI through `progress` so the wait is always visible.
async fn connect_flow(
    endpoint: &str,
    expected_instance_id: Option<String>,
    progress: &std::sync::mpsc::Sender<ConnectEvent>,
) -> Result<ConnectedHost, String> {
    let send = |event: ConnectEvent| {
        let _ = progress.send(event);
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|error| error.to_string())?;
    let peers = tailnet_peers().await?;
    let mut attempts: u32 = 0;
    let mut failures = Vec::new();
    match connect_once(endpoint, &peers, &client).await {
        Ok((instance_id, pinned, permissions)) => {
            return Ok(ConnectedHost {
                instance_id,
                pinned,
                permissions,
            });
        }
        Err(error) => {
            attempts += 1;
            send(ConnectEvent::Attempt(attempts));
            failures.push(error);
        }
    }
    // The host may have moved to a new Tailnet address. Sweep the peer
    // inventory for the same library identity instead of giving up on the
    // saved endpoint.
    if let Some(expected) = expected_instance_id {
        send(ConnectEvent::Progress(
            "Host is not at its saved address; looking for it elsewhere on the Tailnet…".into(),
        ));
        let port = normalized_endpoint(endpoint)
            .ok()
            .and_then(|url| url.port())
            .unwrap_or(DEFAULT_PORT);
        let mut seen = BTreeSet::new();
        'sweep: for peer in &peers {
            for ip in &peer.ips {
                if !seen.insert(*ip) {
                    continue;
                }
                let pinned = origin(*ip, port);
                attempts += 1;
                send(ConnectEvent::Attempt(attempts));
                send(ConnectEvent::Progress(format!(
                    "Attempt {attempts}: trying {ip}…"
                )));
                match handshake(&client, &pinned).await {
                    Ok((instance_id, permissions)) if instance_id == expected => {
                        return Ok(ConnectedHost {
                            instance_id,
                            pinned,
                            permissions,
                        });
                    }
                    Ok((instance_id, _)) => {
                        failures.push(format!(
                            "{ip}: a different library answered ({instance_id})"
                        ));
                    }
                    Err(error) => failures.push(format!("{ip}: {error}")),
                }
                if attempts >= 12 {
                    break 'sweep;
                }
            }
        }
    }
    Err(format!(
        "Could not connect to a compatible Tailnet Curator host after {attempts} attempt(s) ({})",
        failures.join("; ")
    ))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let runtime = tokio::runtime::Runtime::new()?;
    while let Some(client) = choose_host(&runtime)? {
        if curator_desktop::run_ui_with_exit(&runtime, client, false)?
            != curator_desktop::NativeExit::SwitchHost
        {
            break;
        }
    }
    Ok(())
}

/// Kick off one connect flow in the background. The saved host matching
/// `endpoint` supplies the expected library identity so a moved host can be
/// found at its new address; every attempt is reported back to the UI.
fn start_connect(
    weak: &slint::Weak<CuratorViewerWindow>,
    handle: &tokio::runtime::Handle,
    tx: &std::sync::mpsc::Sender<ConnectEvent>,
    name: String,
    endpoint: String,
) {
    if let Some(w) = weak.upgrade() {
        w.set_status("Validating Tailnet host…".into());
        w.set_busy(true);
        w.set_retry_count(0);
        w.set_last_error("".into());
    }
    let tx = tx.clone();
    handle.spawn(async move {
        let expected = load_hosts().ok().and_then(|store| {
            store
                .hosts
                .into_iter()
                .find(|host| host.endpoint == endpoint)
                .map(|host| host.instance_id)
        });
        let progress = tx.clone();
        let result = connect_flow(&endpoint, expected, &progress).await;
        let _ = tx.send(ConnectEvent::Finished(name, endpoint, result));
    });
}

fn choose_host(
    runtime: &tokio::runtime::Runtime,
) -> Result<Option<curator::native::Client>, Box<dyn std::error::Error>> {
    use slint::ComponentHandle;
    use std::{cell::RefCell, rc::Rc, sync::mpsc};
    let window = CuratorViewerWindow::new()?;
    let selected = Rc::new(RefCell::new(None));
    let (tx, rx) = mpsc::channel::<ConnectEvent>();
    let handle = runtime.handle().clone();
    let weak = window.as_weak();
    let tx_connect = tx.clone();
    let handle_connect = handle.clone();
    window.on_connect(move |name, endpoint| {
        start_connect(
            &weak,
            &handle_connect,
            &tx_connect,
            name.to_string(),
            endpoint.to_string(),
        );
    });
    let weak = window.as_weak();
    let tx_retry = tx.clone();
    let handle_retry = handle.clone();
    window.on_retry(move |name, endpoint| {
        start_connect(
            &weak,
            &handle_retry,
            &tx_retry,
            name.to_string(),
            endpoint.to_string(),
        );
    });
    let weak = window.as_weak();
    window.on_select_saved(move |index| {
        let Ok(store) = load_hosts() else {
            return;
        };
        let Some(host) = store.hosts.get(index as usize) else {
            return;
        };
        if let Some(w) = weak.upgrade() {
            w.set_host_name(host.name.clone().into());
            w.set_endpoint(host.endpoint.clone().into());
            w.set_status(format!("Selected saved Host: {}", host.name).into());
        }
    });
    let weak = window.as_weak();
    window.on_remove_saved(move |index| match remove_host(index as usize) {
        Ok(()) => {
            if let Some(w) = weak.upgrade() {
                match load_hosts() {
                    Ok(store) => {
                        w.set_saved_hosts(slint::ModelRc::new(slint::VecModel::from(
                            store
                                .hosts
                                .iter()
                                .map(|host| format!("{} — {}", host.name, host.endpoint).into())
                                .collect::<Vec<slint::SharedString>>(),
                        )));
                        w.set_status("Saved Host removed.".into());
                    }
                    Err(error) => w.set_status(error.into()),
                }
            }
        }
        Err(error) => {
            if let Some(w) = weak.upgrade() {
                w.set_status(error.into());
            }
        }
    });
    let timer = slint::Timer::default();
    let weak = window.as_weak();
    let target = selected.clone();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(50),
        move || {
            let Some(w) = weak.upgrade() else {
                return;
            };
            while let Ok(event) = rx.try_recv() {
                match event {
                    ConnectEvent::Progress(text) => {
                        w.set_status(text.into());
                    }
                    ConnectEvent::Attempt(count) => {
                        w.set_retry_count(count as i32);
                    }
                    ConnectEvent::Finished(name, endpoint, result) => {
                        w.set_busy(false);
                        let outcome = (|| -> Result<(), String> {
                            let host = result?;
                            let store = load_hosts()?;
                            if store.hosts.iter().any(|saved| {
                                saved.endpoint == endpoint && saved.instance_id != host.instance_id
                            }) {
                                return Err(
                                    "This saved address now identifies a different library.".into(),
                                );
                            }
                            let client =
                                curator::native::RemoteClient::from_validated_peer_with_identity(
                                    &host.pinned,
                                    host.permissions,
                                    host.instance_id.clone(),
                                )?;
                            if name.trim().is_empty() {
                                return Err("Give the host a name.".into());
                            }
                            // Persist the address that actually answered, so a
                            // moved host stays reachable next time.
                            save_host(SavedHost {
                                name,
                                endpoint: host.pinned,
                                instance_id: host.instance_id,
                                extra: BTreeMap::new(),
                            })?;
                            *target.borrow_mut() = Some(client);
                            w.hide().map_err(|e| e.to_string())?;
                            slint::quit_event_loop().map_err(|e| e.to_string())?;
                            Ok(())
                        })();
                        if let Err(error) = outcome {
                            w.set_last_error(error.clone().into());
                            w.set_status(format!("Could not connect: {error}").into());
                        }
                    }
                }
            }
        },
    );
    match load_hosts() {
        Ok(store) => {
            window.set_saved_hosts(slint::ModelRc::new(slint::VecModel::from(
                store
                    .hosts
                    .iter()
                    .map(|host| format!("{} — {}", host.name, host.endpoint).into())
                    .collect::<Vec<slint::SharedString>>(),
            )));
            if let Some(host) = store.hosts.first() {
                window.set_host_name(host.name.clone().into());
                window.set_endpoint(host.endpoint.clone().into());
            }
        }
        Err(error) => window.set_status(error.into()),
    }
    window.run()?;
    timer.stop();
    drop(timer);
    drop(window);
    let selected_client = selected
        .borrow_mut()
        .take()
        .map(curator::native::Client::Remote);
    Ok(selected_client)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_requires_a_plain_http_origin() {
        assert!(normalized_endpoint("https://example.com").is_err());
        assert!(normalized_endpoint("http://example.com/a").is_err());
        assert_eq!(
            normalized_endpoint("http://host.tailnet.ts.net")
                .unwrap()
                .port(),
            Some(DEFAULT_PORT)
        );
    }

    #[test]
    fn saved_hosts_preserve_unknown_fields_during_migration() {
        let store: HostStore = serde_json::from_value(serde_json::json!({
            "hosts": [{
                "name": "Desk",
                "endpoint": "http://100.64.1.2:42168",
                "instance_id": "library-1",
                "future_host_preference": {"reconnect": true}
            }],
            "future_store_preference": "kept"
        }))
        .unwrap();
        let value = serde_json::to_value(store).unwrap();
        assert_eq!(value["future_store_preference"], "kept");
        assert_eq!(
            value["hosts"][0]["future_host_preference"]["reconnect"],
            true
        );
    }

    /// Serve one canned `/api/system/info` response from a loopback socket so
    /// the handshake validation is testable without Tailscale.
    async fn serve_system_info(body: serde_json::Value) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let mut read = 0;
            while read < buf.len() {
                let n = stream.read(&mut buf[read..]).await.unwrap();
                if n == 0 {
                    break;
                }
                read += n;
                if buf[..read].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let body = serde_json::to_string(&body).unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn info_json(edition: &str, protocol: &str, tailnet_only: bool) -> serde_json::Value {
        serde_json::json!({
            "edition": edition,
            "api_protocol": protocol,
            "instance_id": "library-1",
            "tailnet_only": tailnet_only,
            "viewer_permissions": {}
        })
    }

    #[tokio::test]
    async fn handshake_accepts_compatible_hosts_and_rejects_the_rest() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        let good = serve_system_info(info_json("host", curator::API_PROTOCOL, true)).await;
        let (instance_id, permissions) = handshake(&client, &good).await.unwrap();
        assert_eq!(instance_id, "library-1");
        // Missing permission fields grant only the read/playback defaults.
        assert!(permissions.playback);
        assert!(!permissions.library_edit);

        let server = serve_system_info(info_json("server", curator::API_PROTOCOL, true)).await;
        assert!(handshake(&client, &server).await.is_ok());

        for bad in [
            info_json("viewer", curator::API_PROTOCOL, true),
            info_json("host", "bogus-protocol", true),
            info_json("host", curator::API_PROTOCOL, false),
        ] {
            let origin = serve_system_info(bad).await;
            assert!(handshake(&client, &origin).await.is_err());
        }

        // Unreachable origins fail instead of hanging the connect flow.
        assert!(handshake(&client, "http://127.0.0.1:1").await.is_err());
    }
}
