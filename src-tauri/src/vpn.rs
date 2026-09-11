//! Platform VPN lifecycle adapter.
//!
//! Android delegates to its `VpnService`. Linux only generates a bounded
//! connection request and sends it to the authenticated root-owned daemon.
//! The GUI never launches Xray, edits routes, or owns privileged processes.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::split::SplitInput;
use crate::subscription::{server_endpoints, VlessServer};
use crate::xray::{build_connection_probe_config, build_xray_config, validate_server, TunMode};

#[derive(Serialize, Deserialize)]
pub struct HelperResponse {
    pub ok: bool,
    pub state: String,
    pub pid: Option<u32>,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u32>,
}

impl HelperResponse {
    #[cfg(target_os = "android")]
    fn connected(pid: u32) -> Self {
        Self {
            ok: true,
            state: "connected".into(),
            pid: Some(pid),
            error: None,
            rtt_ms: None,
        }
    }

    fn disconnected() -> Self {
        Self {
            ok: true,
            state: "disconnected".into(),
            pid: None,
            error: None,
            rtt_ms: None,
        }
    }

    fn dropped() -> Self {
        Self {
            ok: true,
            state: "dropped".into(),
            pid: None,
            error: None,
            rtt_ms: None,
        }
    }
}

fn vpn_op_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[cfg(target_os = "linux")]
fn response_from_daemon(state: varmlend::protocol::DaemonState) -> HelperResponse {
    use varmlend::protocol::ConnectionPhase;

    match state.phase {
        ConnectionPhase::Connected => HelperResponse {
            ok: true,
            state: "connected".into(),
            pid: None,
            error: None,
            rtt_ms: None,
        },
        ConnectionPhase::Blocking | ConnectionPhase::RecoveryRequired => HelperResponse::dropped(),
        _ => HelperResponse::disconnected(),
    }
}

#[cfg(target_os = "linux")]
async fn resolve_server_ips(server: &VlessServer) -> Result<Vec<std::net::IpAddr>, String> {
    let mut unique = BTreeSet::new();
    for (host, port) in server_endpoints(server) {
        let addresses = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|error| format!("could not resolve VPN endpoint {host}:{port}: {error}"))?;
        unique.extend(addresses.map(|address| address.ip()));
    }
    if unique.is_empty() {
        return Err(format!(
            "VPN location {} did not resolve to an address",
            server.label
        ));
    }
    if unique.len() > varmlend::protocol::MAX_SERVER_IPS {
        return Err(format!(
            "VPN location resolves to {} addresses; the safe limit is {}",
            unique.len(),
            varmlend::protocol::MAX_SERVER_IPS
        ));
    }
    Ok(unique.into_iter().collect())
}

#[tauri::command]
pub async fn vpn_connect(
    app: tauri::AppHandle,
    server: VlessServer,
    split: SplitInput,
    mode: String,
    killswitch: bool,
    allow_lan: bool,
    log_level: Option<String>,
    mtu: Option<u32>,
) -> Result<HelperResponse, String> {
    let level = log_level.unwrap_or_else(|| "warn".to_string());
    // The interface MTU is the user's, clamped to what an interface can carry.
    let mtu = crate::xray::tun_mtu(mtu);
    validate_server(&server)?;

    #[cfg(target_os = "android")]
    {
        let _ = killswitch;
        let xray_config = serde_json::to_string(&build_xray_config(
            &server,
            &split,
            &mode,
            TunMode::Tun2socks,
            allow_lan,
            &level,
            mtu,
        ))
        .map_err(|error| error.to_string())?;
        let applications_are_allowlist = split.apps_selective();
        crate::mobile_vpn::connect(
            &app,
            xray_config,
            crate::xray::XRAY_SOCKS_PORT,
            split.apps.clone(),
            applications_are_allowlist,
            level,
        )?;
        return Ok(HelperResponse::connected(0));
    }

    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::{ConnectRequest, ConnectionMode, DaemonCommand};

        let _operation = vpn_op_lock().lock().await;
        let connection_mode = match mode.as_str() {
            "tun" => ConnectionMode::Tun,
            "proxy" => ConnectionMode::Proxy,
            _ => return Err(format!("unsupported VPN mode: {mode}")),
        };
        let xray_config = serde_json::to_string(&build_xray_config(
            &server,
            &split,
            &mode,
            TunMode::XrayNative,
            allow_lan,
            &level,
            mtu,
        ))
        .map_err(|error| error.to_string())?;
        let validation_config = serde_json::to_string(&build_connection_probe_config(&server)?)
            .map_err(|error| error.to_string())?;
        let excluded_apps = if connection_mode == ConnectionMode::Tun && !split.apps_selective() {
            split.enabled_apps()
        } else {
            Vec::new()
        };
        let request = ConnectRequest {
            mode: connection_mode,
            xray_config,
            validation_config,
            server_ips: resolve_server_ips(&server).await?,
            excluded_apps,
            killswitch,
            allow_lan,
        };
        let mut daemon = crate::daemon_client::DaemonClient::connect_or_start_installed()
            .await
            .map_err(|error| error.to_string())?;
        let state = daemon
            .request(DaemonCommand::Connect(request))
            .await
            .map_err(|error| error.to_string())?;
        let _ = app;
        Ok(response_from_daemon(state))
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    {
        let _ = (app, server, split, mode, killswitch, allow_lan, level);
        Err("VPN lifecycle is not implemented on this platform".into())
    }
}

#[tauri::command]
pub async fn vpn_disconnect(app: tauri::AppHandle) -> Result<HelperResponse, String> {
    #[cfg(target_os = "android")]
    {
        crate::mobile_vpn::disconnect(&app)?;
        return Ok(HelperResponse::disconnected());
    }
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::DaemonCommand;

        let _operation = vpn_op_lock().lock().await;
        let Ok(mut daemon) = crate::daemon_client::DaemonClient::connect_installed().await else {
            return Ok(HelperResponse::disconnected());
        };
        let state = daemon
            .request(DaemonCommand::Disconnect)
            .await
            .map_err(|error| error.to_string())?;
        let _ = app;
        Ok(response_from_daemon(state))
    }
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    {
        let _ = app;
        Ok(HelperResponse::disconnected())
    }
}

/// Point a running tunnel at an edited exception list.
///
/// Split rules used to reach the daemon inside a connect only, so adding or
/// removing an application while the tunnel was up did nothing until the user
/// reconnected -- and an application taken out of the list kept going direct.
/// A daemon that is not running, or one older than this command, keeps the
/// list for the next connect and answers `false`.
#[tauri::command]
pub async fn vpn_apply_split(split: SplitInput) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::{ApplicationsRequest, DaemonCommand};

        let applications = if split.apps_selective() {
            Vec::new()
        } else {
            split.enabled_apps()
        };
        let _operation = vpn_op_lock().lock().await;
        let Ok(mut daemon) = crate::daemon_client::DaemonClient::connect_installed().await else {
            return Ok(false);
        };
        Ok(daemon
            .request(DaemonCommand::UpdateSplit(ApplicationsRequest { applications }))
            .await
            .is_ok())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = split;
        Ok(false)
    }
}

#[tauri::command]
pub async fn vpn_status(app: tauri::AppHandle) -> Result<HelperResponse, String> {
    #[cfg(target_os = "android")]
    {
        return Ok(if crate::mobile_vpn::is_running(&app) {
            HelperResponse::connected(0)
        } else {
            HelperResponse::disconnected()
        });
    }
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::DaemonCommand;

        let Ok(mut daemon) = crate::daemon_client::DaemonClient::connect_installed().await else {
            return Ok(HelperResponse::disconnected());
        };
        let state = daemon
            .request(DaemonCommand::Status)
            .await
            .map_err(|error| error.to_string())?;
        let _ = app;
        Ok(response_from_daemon(state))
    }
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    {
        let _ = app;
        Ok(HelperResponse::disconnected())
    }
}

#[tauri::command]
pub async fn vpn_log(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        return crate::mobile_vpn::read_log(&app);
    }
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::DaemonCommand;

        let _ = app;
        let Ok(mut daemon) = crate::daemon_client::DaemonClient::connect_installed().await else {
            return Ok(String::new());
        };
        let state = daemon
            .request(DaemonCommand::LogTail)
            .await
            .map_err(|error| error.to_string())?;
        Ok(state.log_tail.unwrap_or_default())
    }
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    {
        let _ = app;
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn clear_vpn_log(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::mobile_vpn::clear_log(&app);
    }
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::DaemonCommand;

        let _ = app;
        let mut daemon = crate::daemon_client::DaemonClient::connect_installed()
            .await
            .map_err(|error| error.to_string())?;
        daemon
            .request(DaemonCommand::ClearLog)
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn read_clipboard(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        return crate::mobile_vpn::read_clipboard(&app);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("use navigator.clipboard on desktop".into())
    }
}

#[tauri::command]
pub async fn set_status_bar(app: tauri::AppHandle, light: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::mobile_vpn::set_bar_style(&app, light);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, light);
        Ok(())
    }
}

#[tauri::command]
pub async fn notifications_enabled(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "android")]
    {
        return crate::mobile_vpn::notifications_enabled(&app).unwrap_or(false);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        true
    }
}

#[tauri::command]
pub async fn open_notification_settings(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::mobile_vpn::open_notification_settings(&app);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn tcp_ping_host(
    app: tauri::AppHandle,
    host: String,
    port: u16,
    timeout_ms: Option<u32>,
) -> Result<u32, String> {
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::{DaemonCommand, TcpPingRequest};

        let mut daemon = crate::daemon_client::DaemonClient::connect_or_start_installed()
            .await
            .map_err(|error| error.to_string())?;
        let state = daemon
            .request(DaemonCommand::TcpPing(TcpPingRequest {
                host,
                port,
                timeout_ms: timeout_ms.unwrap_or(2500),
            }))
            .await
            .map_err(|error| error.to_string())?;
        let _ = app;
        state
            .rtt_ms
            .ok_or_else(|| "daemon did not return a TCP RTT".to_string())
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, host, port, timeout_ms);
        Err("TCP location ping is unavailable on this platform".into())
    }
}

/// The ping ceiling of a daemon built before UDP probes were given 15 s.
const LEGACY_MAX_PING_TIMEOUT_MS: u32 = 10_000;

#[tauri::command]
pub async fn proxy_get_ping(
    app: tauri::AppHandle,
    server: VlessServer,
    timeout_ms: Option<u32>,
) -> Result<u32, String> {
    #[cfg(target_os = "linux")]
    {
        use varmlend::protocol::{DaemonCommand, DaemonErrorCode, ProxyPingRequest};

        validate_server(&server)?;
        let socks_ports = crate::xray::ping_placeholder_ports(&server)?;
        let socks_port = socks_ports[0];
        let xray_config =
            serde_json::to_string(&crate::xray::build_ping_config(&server, &socks_ports)?)
                .map_err(|error| error.to_string())?;
        let timeout_ms = timeout_ms.unwrap_or(5000);
        let dns_probe_urls = crate::xray::dns_probe_urls(&server);
        let mut daemon = crate::daemon_client::DaemonClient::connect_or_start_installed()
            .await
            .map_err(|error| error.to_string())?;
        let request = ProxyPingRequest {
            xray_config,
            socks_port,
            socks_ports: socks_ports.clone(),
            dns_probe_urls: dns_probe_urls.clone(),
            timeout_ms,
        };
        let state = match daemon
            .request(DaemonCommand::ProxyPing(ProxyPingRequest { ..request }))
            .await
        {
            Ok(state) => state,
            Err(crate::daemon_client::ClientError::Daemon(DaemonErrorCode::InvalidRequest, _)) => {
                // Package upgrades deliberately do not interrupt a running
                // tunnel, so an older daemon keeps answering until the next
                // restart. Such a daemon rejects both the multi-path probe
                // shape and the 15 s budget a UDP transport needs, which used to
                // read as "Hysteria2 never pings". Fall back to its single-path
                // config and to the ceiling it accepts.
                let xray_config = serde_json::to_string(&crate::xray::build_legacy_ping_config(
                    &server, socks_port,
                )?)
                .map_err(|error| error.to_string())?;
                daemon
                    .request(DaemonCommand::ProxyPing(ProxyPingRequest {
                        xray_config,
                        socks_port,
                        socks_ports: Vec::new(),
                        dns_probe_urls,
                        timeout_ms: timeout_ms.min(LEGACY_MAX_PING_TIMEOUT_MS),
                    }))
                    .await
                    .map_err(|error| error.to_string())?
            }
            Err(error) => return Err(error.to_string()),
        };
        let _ = app;
        state
            .rtt_ms
            .ok_or_else(|| "daemon did not return an HTTP RTT".to_string())
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, server, timeout_ms);
        Err("HTTP location ping is unavailable on this platform".into())
    }
}

/// Traffic through the tunnel device, in bytes, as the kernel counted it.
#[derive(Serialize)]
pub struct TunnelStats {
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    /// When the device appeared, if sysfs knew.
    ///
    /// The device belongs to the tunnel, not to this window: the daemon keeps
    /// the tunnel up across restarts of the interface on purpose, so the pill
    /// has to ask the device how old it is instead of counting from the moment
    /// the window noticed the connection. Measured against the core process:
    /// the directory timestamp and the process start agree to the second.
    pub since_unix: Option<u64>,
}

/// Read the counters of the tunnel interface.
///
/// `/sys/class/net/<if>/statistics` is world-readable, so the GUI reads it
/// itself instead of asking the daemon for a round trip. The root is a
/// parameter so the test can point it at a directory it made; the device is
/// missing whenever the tunnel is down, which is the honest `None`.
pub fn read_tunnel_stats(root: &std::path::Path) -> Option<TunnelStats> {
    let stats_dir = root.join(crate::xray::TUN_NAME).join("statistics");
    let counter = |name: &str| -> Option<u64> {
        let text = std::fs::read_to_string(stats_dir.join(name)).ok()?;
        text.trim().parse::<u64>().ok()
    };
    let appeared = std::fs::metadata(root.join(crate::xray::TUN_NAME))
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since_epoch| since_epoch.as_secs());
    Some(TunnelStats {
        tx_bytes: counter("tx_bytes")?,
        rx_bytes: counter("rx_bytes")?,
        since_unix: appeared,
    })
}

/// Traffic counters of the running tunnel, or null when there is no tunnel
/// device: disconnected, or a platform that does not expose these counters.
#[tauri::command]
pub fn tunnel_stats() -> Option<TunnelStats> {
    read_tunnel_stats(std::path::Path::new("/sys/class/net"))
}

/// The daemon intentionally outlives the GUI, so closing or restarting the
/// interface never tears down an otherwise healthy 24/7 tunnel.
pub(crate) fn teardown_on_exit(_app: &tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    #[test]
    fn linux_lifecycle_source_has_no_local_privileged_launcher() {
        let source = include_str!("vpn.rs");
        assert!(!source.contains(concat!("set", "cap")));
        assert!(!source.contains(concat!("Command", "::new")));
        assert!(!source.contains(concat!("varmlen", "-probe")));
    }

    #[test]
    fn tunnel_stats_reads_both_counters_and_gives_up_without_the_device() {
        let root = std::env::temp_dir().join("varmlen-tunnel-stats-read");
        let dir = root.join(crate::xray::TUN_NAME).join("statistics");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tx_bytes"), "1234\n").unwrap();
        std::fs::write(dir.join("rx_bytes"), "5678\n").unwrap();
        let stats = super::read_tunnel_stats(&root).expect("counters");
        assert_eq!((stats.tx_bytes, stats.rx_bytes), (1234, 5678));
        // The directory was made a moment ago, so its timestamp is "now".
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let age = now.checked_sub(stats.since_unix.unwrap()).unwrap();
        assert!(age < 60, "device timestamp should be now, was {age}s ago");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(super::read_tunnel_stats(&root).is_none());
    }

    #[test]
    fn gui_never_allocates_daemon_listener_ports() {
        let source = include_str!("vpn.rs");
        assert!(!source.contains(concat!("TcpListener", "::bind")));
    }
}
