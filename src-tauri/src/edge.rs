// Pushes the booth's contribution to the crew-edge worker: valid member
// tokens + the extras only this Mac knows (service type, call times,
// position guides, file filters). Lives in Rust — the webview can't make
// cross-origin authorized POSTs (CSP/CORS), and reqwest doesn't care.
//
// Phase 2 makes the heartbeat a chat SYNC: the booth mirrors its ring up
// (the cloud keeps history the in-memory ring loses on restart) and the
// response carries down messages phones sent while the booth was off, which
// are ingested into the ring and fan out like any other message.
//
// Reads pco.json from disk rather than asking the frontend: the file is the
// source of truth and this stays decoupled from React lifecycles.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

// 5 min, halved from phase 1's 10: it bounds how much chat a hard power-off
// can lose upward, and the payload is tiny.
const INTERVAL_SECS: u64 = 300;
const MIRROR_MSGS: usize = 50;

/// Highest cloud sequence already ingested. Starts at 0 each launch on
/// purpose: the fresh (empty) ring gets the last day of phone-sent messages
/// replayed, which is exactly the "sent while the booth was off" case.
static LAST_EDGE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Join ids ingested from the last response, reported as consumed on the NEXT
/// push so the edge deletes them. Losing this on a crash is fine: the edge
/// re-delivers, ingest skips the duplicate names, and the ids re-queue here.
static CONSUMED_JOINS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn pco_json_path() -> std::path::PathBuf {
    let mut d = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    d.push("ProDeck");
    d.push("pco.json");
    d
}

async fn push_once(app: &AppHandle) {
    let (admin, tokens, public_url) = {
        let st = app.state::<crate::settings::SettingsState>();
        let s = st.lock().unwrap_or_else(|p| p.into_inner());
        if s.edge_admin_token.is_empty() || s.public_url.trim().is_empty() {
            return; // edge not configured (needs a public origin + admin token)
        }
        // Mirrored as SHA-256 HASHES: the edge compares hash-to-hash, so the
        // cloud never stores a raw booth credential at rest. The ADMIN
        // password rides along too — without it, the booth owner's own
        // signed-in devices were the one identity the edge rejected, and his
        // phone showed an empty booth-off screen while every member's worked.
        let hash = |v: &str| {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(v.as_bytes());
            hex::encode(h.finalize())
        };
        let mut t = Vec::new();
        for v in [&s.web_member_password, &s.web_invite_token, &s.web_password] {
            if !v.is_empty() {
                t.push(hash(v));
            }
        }
        (s.edge_admin_token.clone(), t, s.public_url.clone())
    };

    let pco: Value = std::fs::read_to_string(pco_json_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let extras = json!({
        "serviceTypeId": pco.get("selectedServiceTypeId").cloned().unwrap_or(Value::Null),
        "checkinTimes": pco.get("checkinTimes").cloned().unwrap_or(json!({})),
        "positionGuides": pco.get("positionGuides").cloned().unwrap_or(json!({})),
        "fileFilters": pco.get("fileFilters").cloned().unwrap_or(json!({})),
    });

    // Mirror the ring up (booth-authored team messages only — ingest_edge
    // marks cloud arrivals so they never echo back).
    let msgs: Vec<Value> = {
        let chat = app.state::<crate::chat::ChatState>();
        crate::chat::recent_team(chat.inner(), MIRROR_MSGS)
            .into_iter()
            .map(|m| {
                json!({ "id": m.id, "from": m.from, "text": m.text,
                        "channel": m.channel, "ts": m.ts })
            })
            .collect()
    };

    // VAPID keypair + endpoints, so the cloud can buzz phones booth-off.
    let push_snapshot = {
        let p = app.state::<crate::push::PushState>();
        crate::push::edge_snapshot(p.inner())
    };

    // Names reserve signup spellings at the edge; consumedJoins acknowledges
    // the booth-off signups ingested from the previous response.
    let names = {
        let identity = app.state::<crate::identity::IdentityState>().inner().clone();
        crate::identity::all_names(&identity)
    };
    let consumed: Vec<String> = {
        let mut g = CONSUMED_JOINS.lock().unwrap_or_else(|p| p.into_inner());
        std::mem::take(&mut *g)
    };

    let client = match reqwest::Client::builder().timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(_) => return,
    };
    let resp = client
        .post(format!("{}/edge/push", public_url.trim_end_matches('/')))
        .bearer_auth(admin)
        .json(&json!({
            "tokens": tokens,
            "extras": extras,
            "msgs": msgs,
            "sinceSeq": LAST_EDGE_SEQ.load(Ordering::Relaxed),
            "push": push_snapshot,
            "names": names,
            "consumedJoins": consumed,
        }))
        .send()
        .await;

    // Bring down what phones said while we were away.
    let Ok(resp) = resp else { return };
    let Ok(v) = resp.json::<Value>().await else { return };
    if let Some(arr) = v.get("edgeMsgs").and_then(|x| x.as_array()) {
        let chat = app.state::<crate::chat::ChatState>();
        for m in arr {
            crate::chat::ingest_edge(
                app,
                chat.inner(),
                m.get("from").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                m.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                m.get("channel").and_then(|x| x.as_str()).unwrap_or("team").to_string(),
                m.get("ts").and_then(|x| x.as_u64()).unwrap_or(0),
            );
        }
    }
    if let Some(s) = v.get("edgeSeq").and_then(|x| x.as_u64()) {
        LAST_EDGE_SEQ.store(s, Ordering::Relaxed);
    }
    // Booth-off signups: create pending accounts + adopt their edge sessions,
    // then queue the ids so the next heartbeat tells the edge to delete them.
    if let Some(arr) = v.get("pendingJoins").and_then(|x| x.as_array()) {
        if !arr.is_empty() {
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let done = crate::identity::ingest_edge_joins(app, &identity, arr);
            if !done.is_empty() {
                let mut g = CONSUMED_JOINS.lock().unwrap_or_else(|p| p.into_inner());
                g.extend(done);
            }
        }
    }
}

pub fn spawn_edge_push(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // First push soon after launch, then a steady heartbeat.
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            push_once(&app).await;
            tokio::time::sleep(Duration::from_secs(INTERVAL_SECS)).await;
        }
    });
}
