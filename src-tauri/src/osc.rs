use rosc::{OscPacket, OscType};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct OscInner {
    pub running: AtomicBool,
}

impl OscInner {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
        }
    }
}

pub type OscState = Arc<OscInner>;

#[tauri::command]
pub async fn start_osc(
    port: u16,
    state: tauri::State<'_, OscState>,
    app: AppHandle,
) -> Result<(), String> {
    // Stop any existing listener first.
    state.running.store(false, Ordering::Release);
    tokio::time::sleep(Duration::from_millis(80)).await;

    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("OSC bind failed on port {port}: {e}"))?;

    state.running.store(true, Ordering::Release);
    let running = state.inner().clone();
    let app2 = app.clone();

    tokio::spawn(async move {
        app2.emit("osc:listening", port).ok();
        let mut buf = vec![0u8; 65_535];
        while running.running.load(Ordering::Acquire) {
            match tokio::time::timeout(Duration::from_millis(500), sock.recv_from(&mut buf)).await {
                Ok(Ok((size, _addr))) => {
                    if let Ok((_, packet)) = rosc::decoder::decode_udp(&buf[..size]) {
                        handle_packet(&app2, packet);
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => {} // recv timeout — loop to re-check running flag
            }
        }
        app2.emit("osc:stopped", ()).ok();
    });

    Ok(())
}

#[tauri::command]
pub fn stop_osc(state: tauri::State<'_, OscState>) {
    state.running.store(false, Ordering::Release);
}

/// Push the current key to a rig on the LAN as OSC: `/key <name> <pc>` and
/// `/key/pc <pc>` (pc = pitch class 0–11). Connectionless UDP, fire-and-forget —
/// a bridge (Companion / a script) on the other PC maps it to the rig.
#[tauri::command]
pub async fn osc_send_key(host: String, port: u16, name: String, pc: i32) -> Result<(), String> {
    use rosc::{encoder, OscMessage};
    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", 0))
        .await
        .map_err(|e| e.to_string())?;
    let dest = format!("{host}:{port}");
    for msg in [
        OscPacket::Message(OscMessage {
            addr: "/key".into(),
            args: vec![OscType::String(name), OscType::Int(pc)],
        }),
        OscPacket::Message(OscMessage {
            addr: "/key/pc".into(),
            args: vec![OscType::Int(pc)],
        }),
    ] {
        let buf = encoder::encode(&msg).map_err(|e| e.to_string())?;
        sock.send_to(&buf, &dest).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn handle_packet(app: &AppHandle, packet: OscPacket) {
    match packet {
        OscPacket::Message(msg) => {
            let args: Vec<serde_json::Value> = msg.args.iter().map(osc_arg_to_json).collect();
            app.emit(
                "osc:message",
                serde_json::json!({ "addr": msg.addr, "args": args }),
            )
            .ok();
        }
        OscPacket::Bundle(bundle) => {
            for p in bundle.content {
                handle_packet(app, p);
            }
        }
    }
}

fn osc_arg_to_json(arg: &OscType) -> serde_json::Value {
    use serde_json::Value;
    match arg {
        OscType::Int(i) => Value::from(*i),
        OscType::Long(i) => Value::from(*i),
        OscType::Float(f) => Value::from(*f),
        OscType::Double(d) => Value::from(*d),
        OscType::String(s) => Value::from(s.clone()),
        OscType::Bool(b) => Value::from(*b),
        OscType::Char(c) => Value::from(c.to_string()),
        _ => Value::Null,
    }
}
