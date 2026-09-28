//! Live Dante routing, read-only.
//!
//! Every 30 s: find the Dante devices on the network (mDNS), ask each one
//! for its name, channel counts, receive channels (with what each is
//! subscribed to) and transmit channel names — over Dante's control
//! protocol, the same queries Dante Controller makes. READ-ONLY: only the
//! query opcodes in `proto` are ever sent; nothing that adds, removes or
//! renames anything exists in this file. The packet layouts follow the
//! public-domain NetAudio project (github.com/chris-ritsen/network-audio-
//! controller), since Audinate doesn't publish the protocol.
//!
//! The snapshot is kept in memory and in `<config>/dante-live.json`; every
//! subscription that changes between two reads is logged ("Command-Center 27
//! now ← AllenHth 22") and written to the booth notes
//! (~/.prodeck/system/DANTE_LIVE.md) when that folder exists.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

mod proto;

#[derive(Default)]
pub struct DanteState(pub Mutex<Value>);

fn data_path() -> std::path::PathBuf {
    crate::settings::config_dir().join("dante-live.json")
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Clone, Debug)]
pub struct Found {
    pub name: String,
    pub ip: IpAddr,
    pub port: u16,
}

/// Dante devices announcing their control service, within `window`.
async fn discover(window: Duration) -> Result<Vec<Found>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS: {e}"))?;
    let rx = daemon.browse(proto::ARC_SERVICE).map_err(|e| format!("mDNS browse: {e}"))?;
    let mut out: HashMap<String, Found> = HashMap::new();
    let _ = tokio::time::timeout(window, async {
        while let Ok(ev) = rx.recv_async().await {
            if let ServiceEvent::ServiceResolved(info) = ev {
                let name = info.get_fullname().split('.').next().unwrap_or("").replace('\\', "");
                let ip = info.get_addresses().iter().find(|a| a.is_ipv4()).or_else(|| info.get_addresses().iter().next()).copied();
                if let Some(ip) = ip {
                    out.insert(name.clone(), Found { name, ip, port: info.get_port() });
                }
            }
        }
    })
    .await;
    let _ = daemon.shutdown();
    Ok(out.into_values().collect())
}

/// Devices seen before (name, address, control port) — asked directly when
/// mDNS comes back empty, so a quiet multicast moment isn't "no devices".
fn remembered(prev: &Value) -> Vec<Found> {
    prev["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| Some(Found { name: d["name"].as_str()?.to_string(), ip: d["ip"].as_str()?.parse().ok()?, port: d["port"].as_u64()? as u16 }))
        .collect()
}

/// One device, read in full.
async fn read_device(f: &Found) -> Value {
    let addr = SocketAddr::new(f.ip, f.port);
    match proto::read_all(addr).await {
        Ok(d) => json!({
            "name": d.name.clone().unwrap_or_else(|| f.name.clone()),
            "ip": f.ip.to_string(),
            "port": f.port,
            "model": d.model,
            "rxCount": d.rx_count,
            "txCount": d.tx_count,
            "rx": d.rx.iter().map(|r| json!({
                "ch": r.ch, "name": r.name, "txChannel": r.tx_channel, "txDevice": r.tx_device,
                "status": r.status_text(), "ok": r.ok(),
            })).collect::<Vec<_>>(),
            "tx": d.tx.iter().map(|t| json!({ "ch": t.ch, "name": t.name })).collect::<Vec<_>>(),
            "error": d.error,
        }),
        Err(e) => json!({ "name": f.name, "ip": f.ip.to_string(), "port": f.port, "rx": [], "tx": [], "error": e }),
    }
}

/// "Command-Center 27: AllenHth-114454 · 22 → (none)" for everything that differs.
pub fn diff(old: &Value, new: &Value) -> Vec<String> {
    let key = |r: &Value| match (r["txDevice"].as_str(), r["txChannel"].as_str()) {
        (Some(d), Some(c)) => format!("{d} · {c}"),
        _ => "(nothing)".to_string(),
    };
    let index = |snap: &Value| -> HashMap<(String, u64), String> {
        let mut m = HashMap::new();
        for d in snap["devices"].as_array().into_iter().flatten() {
            if d["error"].is_string() && d["rx"].as_array().map(|a| a.is_empty()).unwrap_or(true) {
                continue; // a device we couldn't read isn't a routing change
            }
            let name = d["name"].as_str().unwrap_or("").to_string();
            for r in d["rx"].as_array().into_iter().flatten() {
                m.insert((name.clone(), r["ch"].as_u64().unwrap_or(0)), key(r));
            }
        }
        m
    };
    let (a, b) = (index(old), index(new));
    let mut out: Vec<String> = vec![];
    for ((dev, ch), now) in &b {
        match a.get(&(dev.clone(), *ch)) {
            Some(was) if was != now => out.push(format!("{dev} {ch}: {was} → {now}")),
            None if !a.is_empty() && a.keys().any(|(d, _)| d == dev) && now != "(nothing)" => out.push(format!("{dev} {ch}: now ← {now}")),
            _ => {}
        }
    }
    // Gone = no longer announcing at all (an unreadable device is still there).
    let present: std::collections::HashSet<String> = new["devices"].as_array().into_iter().flatten().filter_map(|d| d["name"].as_str().map(String::from)).collect();
    let seen: std::collections::HashSet<&String> = present.iter().collect();
    let mut gone: Vec<&String> = a.keys().map(|(d, _)| d).filter(|d| !seen.contains(d)).collect();
    gone.sort();
    gone.dedup();
    for d in gone {
        out.push(format!("{d} left the network"));
    }
    out.sort();
    out
}

fn write_notes(snap: &Value) {
    let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".prodeck/system");
    if !dir.is_dir() {
        return;
    }
    let mut s = String::from("# Dante — live subscriptions\n\nWritten by ProDeck (dante.rs) from the devices themselves, read-only, whenever something changes.\n\n");
    for d in snap["devices"].as_array().into_iter().flatten() {
        s += &format!("## {} ({})\n\n", d["name"].as_str().unwrap_or("?"), d["ip"].as_str().unwrap_or(""));
        if let Some(e) = d["error"].as_str() {
            s += &format!("_couldn't read: {e}_\n\n");
        }
        let subs: Vec<&Value> = d["rx"].as_array().into_iter().flatten().filter(|r| r["txDevice"].is_string()).collect();
        if subs.is_empty() {
            s += "No receive subscriptions.\n\n";
            continue;
        }
        s += "| rx | name | from | status |\n|---|---|---|---|\n";
        for r in subs {
            s += &format!("| {} | {} | {} · {} | {} |\n", r["ch"], r["name"].as_str().unwrap_or(""), r["txDevice"].as_str().unwrap_or(""), r["txChannel"].as_str().unwrap_or(""), r["status"].as_str().unwrap_or(""));
        }
        s += "\n";
    }
    if let Some(ch) = snap["changes"].as_array().filter(|c| !c.is_empty()) {
        s += "## Recent changes\n\n";
        for c in ch.iter().take(40) {
            s += &format!("- {} — {}\n", c["when"].as_str().unwrap_or(""), c["text"].as_str().unwrap_or(""));
        }
    }
    let _ = std::fs::write(dir.join("DANTE_LIVE.md"), s);
}

fn stamp(t: u64) -> String {
    unsafe {
        let tt = t as libc::time_t;
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&tt, &mut tm);
        format!("{:04}-{:02}-{:02} {:02}:{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min)
    }
}

async fn poll_once(app: &AppHandle, prev: &Value) -> Value {
    let mut note: Option<String> = None;
    let mut found = match discover(Duration::from_secs(4)).await {
        Ok(f) => f,
        Err(e) => {
            note = Some(e);
            vec![]
        }
    };
    if found.is_empty() {
        // One more look, then fall back to the devices it knew.
        found = discover(Duration::from_secs(4)).await.unwrap_or_default();
    }
    if found.is_empty() {
        found = remembered(prev);
        if !found.is_empty() {
            note = Some(note.unwrap_or_else(|| "no mDNS answers — asked the devices it already knew".into()));
        }
    }
    let mut devices = vec![];
    for f in &found {
        devices.push(read_device(f).await);
    }
    devices.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let t = now_s();
    let local = local_dvs_name(&devices);
    let mut snap = json!({ "at": t, "devices": devices, "localName": local, "note": note });
    // Keep the last 200 changes, newest first.
    let mut changes: Vec<Value> = prev["changes"].as_array().cloned().unwrap_or_default();
    let fresh = if prev["devices"].is_array() { diff(prev, &snap) } else { vec![] };
    for c in fresh.iter().rev() {
        changes.insert(0, json!({ "at": t, "when": stamp(t), "text": c }));
        crate::follow::follow_debug_log(json!({ "kind": "routing", "source": "dante", "text": c }));
    }
    changes.truncate(200);
    snap["changes"] = json!(changes);
    if !fresh.is_empty() || !prev["devices"].is_array() {
        write_notes(&snap);
    }
    if !fresh.is_empty() {
        app.emit("routing:dante_changes", &fresh).ok();
    }
    snap
}

/// This Mac's IPv4 addresses (the Dante device answering on one of them is
/// this Mac's Virtual Soundcard — the Live tab and the Recording page use it).
fn local_ips() -> Vec<String> {
    let out = std::process::Command::new("/sbin/ifconfig").output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    out.lines().filter_map(|l| l.trim().strip_prefix("inet ")).filter_map(|r| r.split_whitespace().next()).filter(|ip| *ip != "127.0.0.1").map(String::from).collect()
}

fn local_dvs_name(devices: &[Value]) -> Option<String> {
    let ips = local_ips();
    devices.iter().find(|d| d["ip"].as_str().map(|ip| ips.iter().any(|x| x == ip)).unwrap_or(false)).and_then(|d| d["name"].as_str().map(String::from))
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut prev: Value = std::fs::read_to_string(data_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        loop {
            let snap = poll_once(&app, &prev).await;
            *app.state::<DanteState>().0.lock().unwrap_or_else(|p| p.into_inner()) = snap.clone();
            let tmp = data_path().with_extension("json.tmp");
            if std::fs::write(&tmp, snap.to_string()).is_ok() {
                let _ = std::fs::rename(&tmp, data_path());
            }
            app.emit("routing:dante", &snap).ok();
            prev = snap;
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

#[tauri::command]
pub fn dante_snapshot(st: tauri::State<'_, DanteState>) -> Value {
    let v = st.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
    if v.is_null() {
        std::fs::read_to_string(data_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
    } else {
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_changed_subscription_is_one_line() {
        let a = json!({ "devices": [{ "name": "Command-Center", "rx": [
            { "ch": 27, "txDevice": null, "txChannel": null },
            { "ch": 30, "txDevice": "AllenHth-114454", "txChannel": "57" } ] }] });
        let b = json!({ "devices": [{ "name": "Command-Center", "rx": [
            { "ch": 27, "txDevice": "AllenHth-114454", "txChannel": "22" },
            { "ch": 30, "txDevice": "AllenHth-114454", "txChannel": "57" } ] }] });
        assert_eq!(diff(&a, &b), vec!["Command-Center 27: (nothing) → AllenHth-114454 · 22".to_string()]);
        assert!(diff(&b, &b).is_empty());
        // A device that couldn't be read this time isn't "everything unsubscribed".
        let c = json!({ "devices": [{ "name": "Command-Center", "rx": [], "error": "timeout" }] });
        assert_eq!(diff(&b, &c), Vec::<String>::new());
    }

    #[tokio::test]
    #[ignore] // live, read-only: cargo test --lib dante::tests::live -- --ignored --nocapture
    async fn live() {
        let found = discover(Duration::from_secs(4)).await.unwrap();
        println!("found {} devices", found.len());
        for f in &found { println!("SEED {} {} {}", f.name, f.ip, f.port); }
        for f in &found {
            let v = read_device(f).await;
            let subs: Vec<String> = v["rx"].as_array().unwrap().iter().filter(|r| r["txDevice"].is_string())
                .map(|r| format!("{}←{}·{} [{}]", r["ch"], r["txDevice"].as_str().unwrap(), r["txChannel"].as_str().unwrap_or("?"), r["status"].as_str().unwrap())).collect();
            println!("{} {} rx={} tx={} err={:?} subs={} first: {:?}", v["name"], v["ip"], v["rxCount"], v["txCount"], v["error"], subs.len(), subs.iter().take(6).collect::<Vec<_>>());
            if v["name"] == "Command-Center" { println!("ALL: {}", subs.join(", ")); }
        }
    }
}
