// LAN relay: one instance acts as Host (runs a WebSocket server on the local
// network and broadcasts its live state); other instances connect as Clients
// and receive that state. The host forwards its Tauri events as JSON frames;
// the client re-emits them locally so the existing stores mirror with no
// special-casing. NDI video is consumed by clients straight from the host's
// MJPEG server (which now binds the LAN), so frames aren't relayed twice.

use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message};

pub struct RelayManager {
    pub mode: String, // "off" | "host" | "client"
    pub host_port: u16,
    pub clients: Vec<mpsc::UnboundedSender<Message>>,
    pub server_running: Arc<AtomicBool>,
    pub client_running: Arc<AtomicBool>,
}

impl RelayManager {
    pub fn new() -> Self {
        Self {
            mode: "off".into(),
            host_port: 51421,
            clients: Vec::new(),
            server_running: Arc::new(AtomicBool::new(false)),
            client_running: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub type RelayState = Arc<Mutex<RelayManager>>;

async fn stop_internal(state: &RelayState) {
    let mut s = state.lock().await;
    s.server_running.store(false, Ordering::Release);
    s.client_running.store(false, Ordering::Release);
    s.clients.clear();
    s.mode = "off".into();
}

// ---------------------------------------------------------------- Host

#[tauri::command]
pub async fn relay_start_host(
    port: u16,
    state: tauri::State<'_, RelayState>,
    app: AppHandle,
) -> Result<(), String> {
    stop_internal(&state).await;
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("Could not bind port {port}: {e}"))?;
    let running = Arc::new(AtomicBool::new(true));
    {
        let mut s = state.lock().await;
        s.mode = "host".into();
        s.host_port = port;
        s.server_running = running.clone();
        s.clients.clear();
    }

    let st: RelayState = state.inner().clone();
    let app2 = app.clone();
    tokio::spawn(async move {
        let _ = app2.emit(
            "relay:status",
            serde_json::json!({ "mode": "host", "running": true, "port": port, "clients": 0 }),
        );
        while running.load(Ordering::Acquire) {
            let (stream, _addr) = match listener.accept().await {
                Ok(v) => v,
                // A transient accept error (fd pressure, aborted handshake) must
                // not kill the host loop for the rest of the service.
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    continue;
                }
            };
            let ws = match accept_async(stream).await {
                Ok(w) => w,
                Err(_) => continue,
            };
            let (mut write, mut read) = ws.split();
            let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
            {
                let mut s = st.lock().await;
                s.clients.push(tx);
                let _ = app2.emit(
                    "relay:status",
                    serde_json::json!({ "mode": "host", "running": true, "port": port, "clients": s.clients.len() }),
                );
            }
            // Per-client writer.
            tokio::spawn(async move {
                while let Some(m) = rx.recv().await {
                    if write.send(m).await.is_err() {
                        break;
                    }
                }
            });
            // Drain inbound (clients are receive-only for now); detect close.
            tokio::spawn(async move {
                while let Some(msg) = read.next().await {
                    if matches!(msg, Ok(Message::Close(_)) | Err(_)) {
                        break;
                    }
                }
            });
        }
    });
    Ok(())
}

// Send a JSON frame to every connected client (called by the host frontend as
// it observes its own live events / dashboards / NDI source map).
#[tauri::command]
pub async fn relay_broadcast(
    payload: serde_json::Value,
    state: tauri::State<'_, RelayState>,
) -> Result<(), String> {
    let text = payload.to_string();
    let mut s = state.lock().await;
    s.clients
        .retain(|tx| tx.send(Message::Text(text.clone())).is_ok());
    Ok(())
}

// ---------------------------------------------------------------- Client

#[tauri::command]
pub async fn relay_connect_client(
    url: String,
    state: tauri::State<'_, RelayState>,
    app: AppHandle,
) -> Result<(), String> {
    stop_internal(&state).await;
    let running = Arc::new(AtomicBool::new(true));
    {
        let mut s = state.lock().await;
        s.mode = "client".into();
        s.client_running = running.clone();
    }
    let app2 = app.clone();
    tokio::spawn(async move {
        while running.load(Ordering::Acquire) {
            match connect_async(&url).await {
                Ok((ws, _)) => {
                    let _ = app2.emit(
                        "relay:status",
                        serde_json::json!({ "mode": "client", "running": true, "connected": true }),
                    );
                    let (_w, mut read) = ws.split();
                    while let Some(msg) = read.next().await {
                        if !running.load(Ordering::Acquire) {
                            break;
                        }
                        match msg {
                            Ok(Message::Text(t)) => {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                                    let _ = app2.emit("relay:message", v);
                                }
                            }
                            Ok(Message::Close(_)) | Err(_) => break,
                            _ => {}
                        }
                    }
                    let _ = app2.emit(
                        "relay:status",
                        serde_json::json!({ "mode": "client", "running": true, "connected": false }),
                    );
                }
                Err(_) => {}
            }
            // Reconnect after a short delay while still in client mode.
            for _ in 0..8 {
                if !running.load(Ordering::Acquire) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(350)).await;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn relay_stop(state: tauri::State<'_, RelayState>, app: AppHandle) -> Result<(), String> {
    stop_internal(&state).await;
    let _ = app.emit("relay:status", serde_json::json!({ "mode": "off", "running": false }));
    Ok(())
}

#[derive(serde::Serialize)]
pub struct RelayStatus {
    pub mode: String,
    pub running: bool,
    pub port: u16,
    pub clients: usize,
}

#[tauri::command]
pub async fn get_relay_status(
    state: tauri::State<'_, RelayState>,
) -> Result<RelayStatus, String> {
    let s = state.lock().await;
    Ok(RelayStatus {
        mode: s.mode.clone(),
        running: s.mode != "off",
        port: s.host_port,
        clients: s.clients.len(),
    })
}
