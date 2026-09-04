// Web Push — what makes a page reach a phone that's asleep in a pocket.
//
// Without this the crew PWA only buzzes while it's open on screen, which is
// exactly when nobody needs telling. The booth holds a VAPID keypair (generated
// once, private half never leaves this machine), phones register a push
// subscription against their crew identity, and pages fan out to them.
//
// Two limits worth knowing before debugging "it didn't push":
//  * Browsers only allow push in a SECURE context. On plain LAN http:// the
//    subscribe call never happens, so there are no subscriptions to send to.
//    This lights up when the HTTPS hostname exists.
//  * iOS delivers no web push at all until the PWA is installed to the Home
//    Screen — hence the S01 onboarding screen existing in the first place.
//
// Quiet hours are deliberately NOT implemented here: the design is explicit
// that quiet hours never suppresses a page ("pages still ring"). They belong to
// chat notifications, which aren't pushed yet.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use web_push::{
    request_builder::build_request, ContentEncoding, SubscriptionInfo, VapidSignatureBuilder,
    WebPushMessageBuilder,
};

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    /// Crew user id — a subscription belongs to a person, not a browser, so
    /// re-subscribing from the same phone replaces rather than duplicates.
    pub user_id: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub created_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    /// Raw 32-byte P-256 scalar, base64url. Leaves the booth ONLY to the
    /// crew-edge worker (edge_snapshot), so the cloud can push when the booth
    /// is off. Rotating it still invalidates every subscription.
    vapid_private: String,
    /// Uncompressed SEC1 point, base64url — this is the applicationServerKey
    /// the browser needs, and the only half that leaves the machine.
    vapid_public: String,
    subs: Vec<Subscription>,
}

#[derive(Default)]
pub struct PushInner {
    store: Mutex<Store>,
}

pub type PushState = Arc<PushInner>;

fn store_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ProDeck");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("push.json")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl PushInner {
    pub fn load() -> Self {
        let mut store: Store = std::fs::read_to_string(store_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // Generate the keypair once. Rotating it would silently invalidate every
        // existing subscription, so it is created only when genuinely absent.
        if store.vapid_private.is_empty() || store.vapid_public.is_empty() {
            let (priv_b64, pub_b64) = generate_vapid();
            store.vapid_private = priv_b64;
            store.vapid_public = pub_b64;
            let _ = std::fs::write(
                store_path(),
                serde_json::to_string_pretty(&store).unwrap_or_default(),
            );
        }
        Self {
            store: Mutex::new(store),
        }
    }

    fn persist(&self, s: &Store) {
        let _ = std::fs::write(
            store_path(),
            serde_json::to_string_pretty(s).unwrap_or_default(),
        );
    }
}

fn generate_vapid() -> (String, String) {
    use p256::ecdsa::SigningKey;
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let signing = SigningKey::random(&mut rand_core_compat::OsRng);
    let private = B64.encode(signing.to_bytes());
    let public = B64.encode(
        signing
            .verifying_key()
            .as_affine()
            .to_encoded_point(false)
            .as_bytes(),
    );
    (private, public)
}

// p256 0.13 wants a rand_core 0.6 RNG; expose the OS one under that trait.
mod rand_core_compat {
    pub use p256::elliptic_curve::rand_core::OsRng;
}

pub fn public_key(push: &PushState) -> String {
    push.store
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .vapid_public
        .clone()
}

/// What the cloud mirror needs to buzz phones while the booth is off: the
/// VAPID keypair and each person's endpoint. Sending the private half to the
/// crew-edge worker is a deliberate phase-2 decision — it is the same trust
/// domain that already holds the PCO secrets (design/CREW_CLOUD.md). The
/// p256dh/auth encryption keys stay booth-only: edge pushes are payload-less
/// (RFC 8030 allows an empty POST), so the edge never encrypts a payload and
/// never needs them.
pub fn edge_snapshot(push: &PushState) -> serde_json::Value {
    let s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    json!({
        "vapidPub": s.vapid_public,
        "vapidPriv": s.vapid_private,
        "subs": s
            .subs
            .iter()
            .map(|x| json!({ "user": x.user_id, "endpoint": x.endpoint }))
            .collect::<Vec<_>>(),
    })
}

/// Register (or replace) a phone's subscription for a crew user.
pub fn subscribe(
    push: &PushState,
    user_id: String,
    endpoint: String,
    p256dh: String,
    auth: String,
) -> Result<(), String> {
    if endpoint.is_empty() || p256dh.is_empty() || auth.is_empty() {
        return Err("incomplete push subscription".into());
    }
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    // One live subscription per person: a phone that re-subscribes (new browser
    // session, reinstalled PWA) must not leave a dead endpoint behind that we'd
    // keep pushing to forever.
    s.subs.retain(|x| x.user_id != user_id);
    s.subs.push(Subscription {
        user_id,
        endpoint,
        p256dh,
        auth,
        created_ms: now_ms(),
    });
    push.persist(&s);
    Ok(())
}

pub fn unsubscribe(push: &PushState, user_id: &str) {
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.subs.retain(|x| x.user_id != user_id);
    push.persist(&s);
}

fn subs_for(push: &PushState, user_ids: &[String]) -> Vec<Subscription> {
    push.store
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .subs
        .iter()
        .filter(|s| user_ids.iter().any(|id| id == &s.user_id))
        .cloned()
        .collect()
}

fn drop_endpoint(push: &PushState, endpoint: &str) {
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.subs.retain(|x| x.endpoint != endpoint);
    push.persist(&s);
}

/// Fire-and-forget push to a set of crew users. Never blocks the caller: a
/// page must appear on open screens instantly even if a push service is slow.
pub fn notify(app: &AppHandle, user_ids: Vec<String>, payload: serde_json::Value) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let push = app.state::<PushState>().inner().clone();
        let private = {
            let s = push.store.lock().unwrap_or_else(|p| p.into_inner());
            s.vapid_private.clone()
        };
        let targets = subs_for(&push, &user_ids);
        if targets.is_empty() {
            return;
        }
        let body = serde_json::to_vec(&payload).unwrap_or_default();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build();
        let Ok(client) = client else { return };

        for sub in targets {
            let info = SubscriptionInfo::new(
                sub.endpoint.clone(),
                sub.p256dh.clone(),
                sub.auth.clone(),
            );
            let sig = match VapidSignatureBuilder::from_base64(
                &private,
                web_push::URL_SAFE_NO_PAD,
                &info,
            ) {
                Ok(b) => match b.build() {
                    Ok(s) => s,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };
            let mut builder = WebPushMessageBuilder::new(&info);
            builder.set_payload(ContentEncoding::Aes128Gcm, &body);
            builder.set_vapid_signature(sig);
            let Ok(message) = builder.build() else { continue };

            // Built by web-push, sent by the reqwest client already in the tree.
            let req = build_request::<bytes::Bytes>(message);
            let (parts, req_body) = req.into_parts();
            let mut rb = client.post(parts.uri.to_string());
            for (k, v) in parts.headers.iter() {
                rb = rb.header(k.as_str(), v.as_bytes());
            }
            match rb.body(req_body.to_vec()).send().await {
                Ok(r) => {
                    // 404/410 mean the browser threw the subscription away —
                    // keeping it would mean pushing into the void every service.
                    if r.status().as_u16() == 404 || r.status().as_u16() == 410 {
                        drop_endpoint(&push, &sub.endpoint);
                    }
                }
                Err(_) => { /* transient — keep the subscription */ }
            }
        }
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn push_public_key(push: tauri::State<'_, PushState>) -> serde_json::Value {
    json!({ "key": public_key(push.inner()) })
}

#[tauri::command]
pub fn push_subscribe(
    user_id: String,
    endpoint: String,
    p256dh: String,
    auth: String,
    push: tauri::State<'_, PushState>,
) -> Result<(), String> {
    subscribe(push.inner(), user_id, endpoint, p256dh, auth)
}

#[tauri::command]
pub fn push_unsubscribe(user_id: String, push: tauri::State<'_, PushState>) {
    unsubscribe(push.inner(), &user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A malformed key is the worst failure mode here: every phone's subscribe
    // call fails at the browser, long before anything reaches the booth, so
    // there is nothing in a log to find.
    #[test]
    fn vapid_keys_have_the_shapes_browsers_and_web_push_require() {
        let (private, public) = generate_vapid();

        let priv_bytes = B64.decode(&private).expect("private key must be base64url");
        assert_eq!(priv_bytes.len(), 32, "P-256 scalar is 32 bytes");

        let pub_bytes = B64.decode(&public).expect("public key must be base64url");
        assert_eq!(pub_bytes.len(), 65, "applicationServerKey is an uncompressed point");
        assert_eq!(pub_bytes[0], 0x04, "uncompressed points start with 0x04");

        // Neither may carry base64 padding — pushManager.subscribe rejects it.
        assert!(!private.contains('=') && !public.contains('='));
    }

    // The private half must be loadable by the signer we actually sign with.
    #[test]
    fn generated_key_is_accepted_by_the_vapid_signer() {
        let (private, _) = generate_vapid();
        let info = SubscriptionInfo::new(
            "https://push.example.com/x",
            // A syntactically valid receiver key/auth from the crate's own docs.
            "BLMbF9ffKBiWQLCKvTHb6LO8Nb6dcUh6TItC455vu2kElga6PQvUmaFyCdykxY2nOSSL3yKgfbmFLRTUaGv4yV8",
            "xS03Fi5ErfTNH_l9WHE9Ig",
        );
        let built = VapidSignatureBuilder::from_base64(&private, web_push::URL_SAFE_NO_PAD, &info)
            .expect("signer must accept our own key")
            .build();
        assert!(built.is_ok(), "VAPID signature must build");
    }
}
