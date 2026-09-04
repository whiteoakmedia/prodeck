use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredService {
    /// Friendly kind: "propresenter", "stage", or "ndi".
    pub kind: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub addresses: Vec<String>,
}

fn kind_for(service_type: &str) -> &'static str {
    if service_type.contains("prolink") {
        "propresenter"
    } else if service_type.contains("stagedsply") {
        "stage"
    } else if service_type.contains("ndi") {
        "ndi"
    } else {
        "other"
    }
}

/// Browse the local network for ProPresenter, Stage Display and NDI services.
/// Collects everything that resolves within `secs` seconds.
#[tauri::command]
pub async fn discover_services(secs: Option<u64>) -> Result<Vec<DiscoveredService>, String> {
    let window = Duration::from_secs(secs.unwrap_or(4));
    let service_types = [
        "_pro7prolink._tcp.local.",
        "_pro7stagedsply._tcp.local.",
        "_ndi._tcp.local.",
    ];

    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let mut receivers = Vec::new();
    for st in service_types {
        match daemon.browse(st) {
            Ok(rx) => receivers.push((st, rx)),
            Err(e) => eprintln!("browse {st} failed: {e}"),
        }
    }

    let found: std::sync::Arc<tokio::sync::Mutex<HashMap<String, DiscoveredService>>> =
        std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    let mut handles = Vec::new();
    for (st, rx) in receivers {
        let found = found.clone();
        let kind = kind_for(st).to_string();
        handles.push(tokio::spawn(async move {
            let _ = tokio::time::timeout(window, async {
                while let Ok(event) = rx.recv_async().await {
                    if let ServiceEvent::ServiceResolved(info) = event {
                        let mut addresses: Vec<String> =
                            info.get_addresses().iter().map(|a| a.to_string()).collect();
                        // Prefer IPv4 (routable, no scope/bracket issues) over
                        // IPv6 link-local addresses that ProPresenter advertises.
                        addresses.sort_by_key(|a| usize::from(a.contains(':')));
                        let service = DiscoveredService {
                            kind: kind.clone(),
                            name: info
                                .get_fullname()
                                .split('.')
                                .next()
                                .unwrap_or(info.get_fullname())
                                .replace('\\', ""),
                            host: info.get_hostname().trim_end_matches('.').to_string(),
                            port: info.get_port(),
                            addresses,
                        };
                        found
                            .lock()
                            .await
                            .insert(info.get_fullname().to_string(), service);
                    }
                }
            })
            .await;
        }));
    }

    for h in handles {
        let _ = h.await;
    }
    let _ = daemon.shutdown();

    let map = found.lock().await;
    Ok(map.values().cloned().collect())
}
