// Secure local address: https on the church network with nothing to set up.
//
// Phones only give a web page the microphone (comms) and page notifications
// on https, and a booth that only lives on the church network has plain http.
// So the booth claims a name, <name>.local.prodeck.live, from the
// prodeck-local Worker (local-edge/), which points it at this computer's
// address on the church network. The booth then gets its own Let's Encrypt
// certificate for that name (ACME dns-01, the Worker writing the challenge
// record) and serves https itself. Phones on the church Wi-Fi talk to the
// booth directly; only the name lookup goes out to the internet.
//
// The https side is a thin front: it finishes TLS, then passes each request to
// the ordinary gateway on loopback, adding X-ProDeck-Peer with the phone's
// real address (web.rs trusts it only from loopback, after Cloudflare's own
// header) so password throttling and on-site check-in still see the phone,
// not 127.0.0.1.
//
// Everything secret stays on this computer: the claim secret in settings
// (never sent to a browser), the ACME account key and the certificate's key
// in <data>/local-https/.

use base64::Engine;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::settings::SettingsState;

/// The Worker that hands out names. Overridable for testing.
fn edge() -> String {
    std::env::var("PRODECK_LOCAL_EDGE").unwrap_or_else(|_| "https://prodeck-local.taplink-edge.workers.dev".into())
}
fn acme_directory() -> String {
    std::env::var("PRODECK_ACME_DIRECTORY").unwrap_or_else(|_| "https://acme-v02.api.letsencrypt.org/directory".into())
}
pub const BASE: &str = "local.prodeck.live";
/// 443 so the address is just the name; 8443 when something else has 443.
const PORTS: [u16; 2] = [443, 8443];
/// How often the booth checks its address and certificate.
const TICK: Duration = Duration::from_secs(15 * 60);

const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

#[derive(Debug, Clone, Serialize, Default)]
pub struct Status {
    /// off | claimed | addressing | certifying | serving | error
    pub phase: String,
    pub name: String,
    pub host: String,
    /// What phones open, e.g. https://stjohns.local.prodeck.live
    pub url: String,
    pub ip: String,
    /// Every private address this computer has, for the picker.
    pub ips: Vec<String>,
    pub port: u16,
    /// Certificate expiry, epoch ms; 0 = none yet.
    pub expires_ms: u64,
    pub error: String,
    /// Plain words for what's happening right now.
    pub detail: String,
}

static STATUS: Mutex<Option<Status>> = Mutex::new(None);
/// The running https front, so a new certificate replaces it.
static FRONT: Mutex<Option<tokio::task::JoinHandle<()>>> = Mutex::new(None);
/// One check at a time: the timer and a button press must not both issue.
static BUSY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn set_status(app: &AppHandle, f: impl FnOnce(&mut Status)) {
    let snap = {
        let mut g = STATUS.lock().unwrap_or_else(|p| p.into_inner());
        let s = g.get_or_insert_with(Status::default);
        f(s);
        s.clone()
    };
    app.emit("localhttps:status", &snap).ok();
}

fn status() -> Status {
    STATUS.lock().unwrap_or_else(|p| p.into_inner()).clone().unwrap_or_default()
}

fn dir() -> PathBuf {
    let mut d = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    d.push("ProDeck");
    d.push("local-https");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn now_ms() -> u64 {
    crate::identity::now_ms()
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("ProDeck/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- addresses

/// This computer's private IPv4 addresses (the ones a phone could reach).
fn private_ips() -> Vec<String> {
    crate::dante::local_ips().into_iter().filter(|ip| is_private(ip)).collect()
}

pub fn is_private(ip: &str) -> bool {
    match ip.parse::<std::net::Ipv4Addr>() {
        Ok(a) => {
            let o = a.octets();
            o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168)
        }
        Err(_) => false,
    }
}

/// The address on the default route: where the phones' Wi-Fi is, on a booth
/// that also has a Dante network. Asking the OS which source it would use for
/// an outside address sends nothing.
fn default_route_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("1.1.1.1:53").ok()?;
    let ip = s.local_addr().ok()?.ip().to_string();
    is_private(&ip).then_some(ip)
}

/// Which address the name should point at: the chosen one if it's still
/// here, else the default route, else the first private address.
pub fn pick_ip(chosen: &str, default_route: Option<&str>, all: &[String]) -> Option<String> {
    if !chosen.is_empty() && all.iter().any(|x| x == chosen) {
        return Some(chosen.to_string());
    }
    if let Some(d) = default_route.filter(|d| all.iter().any(|x| x == d)) {
        return Some(d.to_string());
    }
    all.first().cloned()
}

// ---------------------------------------------------------------- the Worker

async fn edge_call(method: reqwest::Method, path: &str, body: Value) -> Result<Value, String> {
    let c = http()?;
    let r = c
        .request(method, format!("{}{path}", edge()))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach ProDeck's address service: {e}"))?;
    let ok = r.status().is_success();
    let v: Value = r.json().await.unwrap_or(Value::Null);
    if ok {
        Ok(v)
    } else {
        Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("The address service refused.").to_string())
    }
}

pub async fn check_name(name: &str) -> Result<Value, String> {
    let c = http()?;
    let r = c
        .get(format!("{}/v1/available", edge()))
        .query(&[("name", name)])
        .send()
        .await
        .map_err(|e| format!("Couldn't reach ProDeck's address service: {e}"))?;
    r.json::<Value>().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- ACME

/// The ACME account: a P-256 key kept on this computer.
struct Account {
    key: SigningKey,
    /// The account URL once registered (the JWS "kid").
    kid: Option<String>,
}

fn account_path() -> PathBuf {
    dir().join("account.json")
}

fn load_account() -> Account {
    let saved: Option<Value> = std::fs::read_to_string(account_path()).ok().and_then(|t| serde_json::from_str(&t).ok());
    let key = saved
        .as_ref()
        .and_then(|v| v["key"].as_str())
        .and_then(|k| B64.decode(k).ok())
        .and_then(|b| SigningKey::from_slice(&b).ok())
        .unwrap_or_else(|| SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng));
    let kid = saved.as_ref().and_then(|v| v["kid"].as_str()).map(String::from);
    Account { key, kid }
}

fn save_account(a: &Account) {
    let body = json!({ "key": B64.encode(a.key.to_bytes()), "kid": a.kid });
    let _ = crate::settings::write_json_atomic_backed_up(account_path(), body.to_string());
}

/// The account key as a JWK, members in the order RFC 7638 hashes them.
fn jwk(key: &SigningKey) -> Value {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let p = key.verifying_key().as_affine().to_encoded_point(false);
    json!({
        "crv": "P-256",
        "kty": "EC",
        "x": B64.encode(p.x().expect("uncompressed point")),
        "y": B64.encode(p.y().expect("uncompressed point")),
    })
}

/// RFC 7638 thumbprint: SHA-256 of the JWK's required members, no spaces.
pub fn thumbprint(jwk: &Value) -> String {
    let canon = format!(
        r#"{{"crv":"{}","kty":"{}","x":"{}","y":"{}"}}"#,
        jwk["crv"].as_str().unwrap_or(""),
        jwk["kty"].as_str().unwrap_or(""),
        jwk["x"].as_str().unwrap_or(""),
        jwk["y"].as_str().unwrap_or("")
    );
    B64.encode(Sha256::digest(canon.as_bytes()))
}

/// The dns-01 TXT value for a challenge token (RFC 8555 8.4).
pub fn dns01_value(token: &str, thumb: &str) -> String {
    B64.encode(Sha256::digest(format!("{token}.{thumb}").as_bytes()))
}

struct Acme {
    c: reqwest::Client,
    dir: Value,
    nonce: Option<String>,
    acct: Account,
}

impl Acme {
    async fn new() -> Result<Self, String> {
        let c = http()?;
        let dir: Value = c
            .get(acme_directory())
            .send()
            .await
            .map_err(|e| format!("Couldn't reach Let's Encrypt: {e}"))?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        Ok(Self { c, dir, nonce: None, acct: load_account() })
    }

    fn url(&self, k: &str) -> Result<String, String> {
        self.dir[k].as_str().map(String::from).ok_or_else(|| format!("Let's Encrypt has no {k}"))
    }

    async fn fresh_nonce(&mut self) -> Result<String, String> {
        if let Some(n) = self.nonce.take() {
            return Ok(n);
        }
        let r = self.c.head(self.url("newNonce")?).send().await.map_err(|e| e.to_string())?;
        r.headers()
            .get("replay-nonce")
            .and_then(|v| v.to_str().ok())
            .map(String::from)
            .ok_or_else(|| "Let's Encrypt gave no nonce".into())
    }

    /// A signed POST (payload None = POST-as-GET). Retries once on badNonce.
    async fn post(&mut self, url: &str, payload: Option<&Value>) -> Result<(reqwest::header::HeaderMap, Value, String), String> {
        for attempt in 0..2 {
            let nonce = self.fresh_nonce().await?;
            let mut protected = json!({ "alg": "ES256", "nonce": nonce, "url": url });
            match &self.acct.kid {
                Some(kid) => protected["kid"] = json!(kid),
                None => protected["jwk"] = jwk(&self.acct.key),
            }
            let p64 = B64.encode(protected.to_string());
            let b64 = payload.map(|p| B64.encode(p.to_string())).unwrap_or_default();
            let sig: Signature = self.acct.key.sign(format!("{p64}.{b64}").as_bytes());
            let body = json!({ "protected": p64, "payload": b64, "signature": B64.encode(sig.to_bytes()) });
            let r = self
                .c
                .post(url)
                .header("content-type", "application/jose+json")
                .body(body.to_string())
                .send()
                .await
                .map_err(|e| format!("Let's Encrypt: {e}"))?;
            let headers = r.headers().clone();
            self.nonce = headers.get("replay-nonce").and_then(|v| v.to_str().ok()).map(String::from);
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            if status.is_success() {
                return Ok((headers, v, text));
            }
            if attempt == 0 && v["type"].as_str() == Some("urn:ietf:params:acme:error:badNonce") {
                continue;
            }
            return Err(format!("Let's Encrypt: {}", v["detail"].as_str().unwrap_or(status.as_str())));
        }
        Err("Let's Encrypt kept refusing the request".into())
    }

    async fn ensure_account(&mut self) -> Result<(), String> {
        if self.acct.kid.is_some() {
            return Ok(());
        }
        let url = self.url("newAccount")?;
        let (h, _, _) = self.post(&url, Some(&json!({ "termsOfServiceAgreed": true }))).await?;
        let kid = h.get("location").and_then(|v| v.to_str().ok()).map(String::from).ok_or("Let's Encrypt gave no account")?;
        self.acct.kid = Some(kid);
        save_account(&self.acct);
        Ok(())
    }

    /// Poll a URL (POST-as-GET) until its status leaves pending/processing.
    async fn poll(&mut self, url: &str) -> Result<Value, String> {
        for _ in 0..30 {
            let (_, v, _) = self.post(url, None).await?;
            match v["status"].as_str() {
                Some("pending") | Some("processing") => tokio::time::sleep(Duration::from_secs(2)).await,
                _ => return Ok(v),
            }
        }
        Err("Let's Encrypt took too long".into())
    }
}

/// Wait until public DNS shows the challenge, so Let's Encrypt finds it on
/// its first look. Cloudflare's resolver reads Cloudflare's own zone, so this
/// is usually a few seconds.
async fn wait_for_txt(name: &str, value: &str) {
    let Ok(c) = http() else { return };
    for _ in 0..30 {
        let found = c
            .get("https://cloudflare-dns.com/dns-query")
            .query(&[("name", name), ("type", "TXT")])
            .header("accept", "application/dns-json")
            .send()
            .await
            .ok();
        if let Some(r) = found {
            if let Ok(v) = r.json::<Value>().await {
                let hit = v["Answer"].as_array().map(|a| a.iter().any(|x| x["data"].as_str().unwrap_or("").contains(value))).unwrap_or(false);
                if hit {
                    return;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

/// Issue a certificate for `host`, the Worker writing the challenge record.
async fn issue(app: &AppHandle, name: &str, secret: &str, host: &str) -> Result<(), String> {
    set_status(app, |s| {
        s.phase = "certifying".into();
        s.detail = "Getting a certificate from Let's Encrypt (about a minute)".into();
    });
    let mut acme = Acme::new().await?;
    acme.ensure_account().await?;
    let thumb = thumbprint(&jwk(&acme.acct.key));

    let new_order = acme.url("newOrder")?;
    let (h, order, _) = acme
        .post(&new_order, Some(&json!({ "identifiers": [{ "type": "dns", "value": host }] })))
        .await?;
    let order_url = h.get("location").and_then(|v| v.to_str().ok()).map(String::from).ok_or("no order address")?;

    for authz_url in order["authorizations"].as_array().cloned().unwrap_or_default() {
        let authz_url = authz_url.as_str().unwrap_or("").to_string();
        let (_, authz, _) = acme.post(&authz_url, None).await?;
        if authz["status"].as_str() == Some("valid") {
            continue;
        }
        let ch = authz["challenges"]
            .as_array()
            .and_then(|a| a.iter().find(|c| c["type"].as_str() == Some("dns-01")).cloned())
            .ok_or("Let's Encrypt offered no DNS challenge")?;
        let value = dns01_value(ch["token"].as_str().unwrap_or(""), &thumb);
        edge_call(reqwest::Method::POST, "/v1/challenge", json!({ "name": name, "secret": secret, "value": value })).await?;
        wait_for_txt(&format!("_acme-challenge.{host}"), &value).await;
        let ch_url = ch["url"].as_str().unwrap_or("").to_string();
        let result = async {
            acme.post(&ch_url, Some(&json!({}))).await?;
            let done = acme.poll(&authz_url).await?;
            if done["status"].as_str() != Some("valid") {
                let why = done["challenges"]
                    .as_array()
                    .and_then(|a| a.iter().find_map(|c| c["error"]["detail"].as_str().map(String::from)))
                    .unwrap_or_else(|| "the check failed".into());
                return Err(format!("Let's Encrypt couldn't confirm the name: {why}"));
            }
            Ok(())
        }
        .await;
        let _ = edge_call(reqwest::Method::DELETE, "/v1/challenge", json!({ "name": name, "secret": secret })).await;
        result?;
    }

    // The certificate's own key never leaves this computer: only a request
    // signed with it goes to Let's Encrypt.
    let key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
    let mut params = rcgen::CertificateParams::new(vec![host.to_string()]).map_err(|e| e.to_string())?;
    params.distinguished_name = rcgen::DistinguishedName::new();
    let csr = params.serialize_request(&key).map_err(|e| e.to_string())?;
    let finalize = order["finalize"].as_str().unwrap_or("").to_string();
    acme.post(&finalize, Some(&json!({ "csr": B64.encode(csr.der()) }))).await?;
    let done = acme.poll(&order_url).await?;
    let cert_url = done["certificate"].as_str().ok_or("Let's Encrypt didn't issue the certificate")?.to_string();
    let (_, _, pem) = acme.post(&cert_url, None).await?;
    if !pem.contains("BEGIN CERTIFICATE") {
        return Err("Let's Encrypt sent something that isn't a certificate".into());
    }
    write_private(&dir().join("key.pem"), &key.serialize_pem())?;
    std::fs::write(dir().join("cert.pem"), &pem).map_err(|e| e.to_string())?;
    std::fs::write(dir().join("host.txt"), host).map_err(|e| e.to_string())?;
    Ok(())
}

/// The certificate key: owner-only on Unix.
fn write_private(path: &std::path::Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ---------------------------------------------------------------- certificate dates

/// (notBefore, notAfter) in epoch seconds, read from the first certificate in
/// a PEM chain. A small DER walk: Certificate → tbsCertificate → validity.
pub fn cert_validity(pem: &str) -> Option<(i64, i64)> {
    use rustls::pki_types::{pem::PemObject, CertificateDer};
    let der = CertificateDer::pem_slice_iter(pem.as_bytes()).next()?.ok()?;
    let (_, cert, _) = der_tlv(der.as_ref())?; // Certificate SEQUENCE
    let (_, mut tbs, _) = der_tlv(cert)?; // tbsCertificate SEQUENCE
    // [0] version (optional), serialNumber, signature, issuer, then validity.
    let (tag, _, rest) = der_tlv(tbs)?;
    if tag == 0xa0 {
        tbs = rest;
        let (_, _, r) = der_tlv(tbs)?; // serial
        tbs = r;
    } else {
        tbs = rest; // that was the serial
    }
    let (_, _, r) = der_tlv(tbs)?; // signature algorithm
    let (_, _, r) = der_tlv(r)?; // issuer
    let (_, validity, _) = der_tlv(r)?;
    let (t1, nb, rest) = der_tlv(validity)?;
    let (t2, na, _) = der_tlv(rest)?;
    Some((der_time(t1, nb)?, der_time(t2, na)?))
}

/// One DER element: (tag, contents, what follows).
fn der_tlv(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let tag = *b.first()?;
    let first = *b.get(1)? as usize;
    let (len, hdr) = if first < 0x80 {
        (first, 2)
    } else {
        let n = first & 0x7f;
        if n == 0 || n > 4 {
            return None;
        }
        let mut len = 0usize;
        for i in 0..n {
            len = (len << 8) | *b.get(2 + i)? as usize;
        }
        (len, 2 + n)
    };
    let end = hdr.checked_add(len)?;
    if end > b.len() {
        return None;
    }
    Some((tag, &b[hdr..end], &b[end..]))
}

/// UTCTime (0x17, YYMMDDHHMMSSZ) or GeneralizedTime (0x18, YYYYMMDDHHMMSSZ).
fn der_time(tag: u8, b: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(b).ok()?.strip_suffix('Z')?;
    let (y, rest) = match tag {
        0x17 => {
            let yy: i64 = s.get(0..2)?.parse().ok()?;
            (if yy < 50 { 2000 + yy } else { 1900 + yy }, s.get(2..)?)
        }
        0x18 => (s.get(0..4)?.parse().ok()?, s.get(4..)?),
        _ => return None,
    };
    let n = |r: std::ops::Range<usize>| -> Option<i64> { rest.get(r)?.parse().ok() };
    let (mo, d, h, mi, se) = (n(0..2)?, n(2..4)?, n(4..6)?, n(6..8)?, n(8..10)?);
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Renew once two thirds of the certificate's life has passed, so a short
/// lived certificate (Let's Encrypt is shortening them) still renews in time.
pub fn needs_renewal(validity: Option<(i64, i64)>, now_s: i64) -> bool {
    match validity {
        None => true,
        Some((nb, na)) => now_s >= na - (na - nb) / 3,
    }
}

// ---------------------------------------------------------------- the https front

fn tls_config() -> Result<Arc<rustls::ServerConfig>, String> {
    use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
    let cert_pem = std::fs::read(dir().join("cert.pem")).map_err(|e| e.to_string())?;
    let key_pem = std::fs::read(dir().join("key.pem")).map_err(|e| e.to_string())?;
    let certs: Vec<CertificateDer<'static>> =
        CertificateDer::pem_slice_iter(&cert_pem).collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    let key = PrivateKeyDer::from_pem_slice(&key_pem).map_err(|e| e.to_string())?;
    let cfg = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(cfg))
}

/// The first request's head with any client-sent peer headers removed and the
/// real one added. Returns None if it isn't an HTTP request head.
pub fn rewrite_head(head: &[u8], peer: &str) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let first = lines.next()?;
    if !first.contains(" HTTP/1.") {
        return None;
    }
    let mut out = format!("{first}\r\nX-ProDeck-Peer: {peer}\r\n");
    for l in lines {
        let lower = l.to_ascii_lowercase();
        // A phone must not be able to claim to be somewhere else.
        if lower.starts_with("x-prodeck-peer:") || lower.starts_with("cf-connecting-ip:") {
            continue;
        }
        out.push_str(l);
        out.push_str("\r\n");
    }
    // `text` ended with the blank line, so the loop already wrote "\r\n\r\n"'s
    // second half; trim to exactly one blank line.
    while out.ends_with("\r\n\r\n\r\n") {
        out.truncate(out.len() - 2);
    }
    Some(out.into_bytes())
}

async fn serve_one(
    tls: tokio_rustls::TlsAcceptor,
    tcp: tokio::net::TcpStream,
    peer: std::net::SocketAddr,
    web_port: u16,
) {
    let Ok(Ok(mut stream)) = tokio::time::timeout(Duration::from_secs(10), tls.accept(tcp)).await else { return };
    // Read the request head (headers end at the blank line).
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let head_end = loop {
        let n = match tokio::time::timeout(Duration::from_secs(15), stream.read(&mut tmp)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return,
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 64 * 1024 {
            return;
        }
    };
    let Some(head) = rewrite_head(&buf[..head_end], &peer.ip().to_string()) else { return };
    let Ok(mut up) = tokio::net::TcpStream::connect(("127.0.0.1", web_port)).await else { return };
    if up.write_all(&head).await.is_err() || up.write_all(&buf[head_end..]).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut stream, &mut up).await;
}

/// (Re)start the https front with the current certificate. Returns the port.
async fn start_front(app: &AppHandle) -> Result<u16, String> {
    let cfg = tls_config()?;
    let old = FRONT.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(h) = old {
        h.abort();
        // Let the old listener's port go before binding again.
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let mut bound = None;
    for p in PORTS {
        if let Ok(l) = tokio::net::TcpListener::bind(("0.0.0.0", p)).await {
            bound = Some((l, p));
            break;
        }
    }
    let (listener, port) = bound.ok_or("Couldn't open port 443 or 8443 for the secure address. Another app is using both.")?;
    let acceptor = tokio_rustls::TlsAcceptor::from(cfg);
    let app = app.clone();
    let tauri::async_runtime::JoinHandle::Tokio(handle) = tauri::async_runtime::spawn(async move {
        loop {
            let Ok((tcp, peer)) = listener.accept().await else { continue };
            let web_port = app.state::<SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).web_port;
            tauri::async_runtime::spawn(serve_one(acceptor.clone(), tcp, peer, web_port));
        }
    });
    *FRONT.lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);
    Ok(port)
}

fn stop_front() {
    if let Some(h) = FRONT.lock().unwrap_or_else(|p| p.into_inner()).take() {
        h.abort();
    }
}

// ---------------------------------------------------------------- keeping it all up

fn save_local_url(app: &AppHandle, url: &str) {
    let state = app.state::<SettingsState>();
    let to_save = {
        let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
        if g.local_url == url {
            return;
        }
        g.local_url = url.to_string();
        g.clone()
    };
    let _ = crate::settings::save(&to_save);
    app.emit("settings:changed", ()).ok();
}

pub fn url_for(host: &str, port: u16) -> String {
    if port == 443 {
        format!("https://{host}")
    } else {
        format!("https://{host}:{port}")
    }
}

/// One pass: point the name at this computer, get or renew the certificate,
/// make sure the front is serving it. Safe to call any time.
pub async fn refresh(app: &AppHandle) {
    let _one = BUSY.lock().await;
    let (name, secret, chosen) = {
        let g = app.state::<SettingsState>();
        let g = g.lock().unwrap_or_else(|p| p.into_inner());
        (g.local_name.clone(), g.local_secret.clone(), g.local_ip.clone())
    };
    let ips = private_ips();
    if name.is_empty() || secret.is_empty() {
        stop_front();
        save_local_url(app, "");
        set_status(app, |s| {
            *s = Status { phase: "off".into(), ips: ips.clone(), ..Default::default() };
        });
        return;
    }
    let host = format!("{name}.{BASE}");
    let result: Result<(), String> = async {
        let ip = pick_ip(&chosen, default_route_ip().as_deref(), &ips)
            .ok_or("This computer has no address on a church network (like 192.168.1.20). Is it on the network?")?;
        set_status(app, |s| {
            s.name = name.clone();
            s.host = host.clone();
            s.ip = ip.clone();
            s.ips = ips.clone();
            s.error.clear();
            if s.phase != "serving" {
                s.phase = "addressing".into();
                s.detail = format!("Pointing {host} at this computer ({ip})");
            }
        });
        edge_call(reqwest::Method::POST, "/v1/address", json!({ "name": name, "secret": secret, "ip": ip })).await?;

        let have_host = std::fs::read_to_string(dir().join("host.txt")).unwrap_or_default();
        let pem = std::fs::read_to_string(dir().join("cert.pem")).unwrap_or_default();
        let validity = if have_host.trim() == host { cert_validity(&pem) } else { None };
        let renew = needs_renewal(validity, (now_ms() / 1000) as i64);
        if renew {
            issue(app, &name, &secret, &host).await?;
        }
        let running = FRONT.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|h| !h.is_finished()).unwrap_or(false);
        let port = if renew || !running { start_front(app).await? } else { status().port };
        let pem = std::fs::read_to_string(dir().join("cert.pem")).unwrap_or_default();
        let expires = cert_validity(&pem).map(|(_, na)| (na as u64) * 1000).unwrap_or(0);
        let url = url_for(&host, port);
        save_local_url(app, &url);
        set_status(app, |s| {
            s.phase = "serving".into();
            s.port = port;
            s.url = url.clone();
            s.expires_ms = expires;
            s.detail = format!("Phones on the church Wi-Fi can open {url}");
        });
        Ok(())
    }
    .await;
    if let Err(e) = result {
        crate::diag::log(format!("[local-https] {e}"));
        // Still serving the old certificate is fine; say what went wrong.
        let serving = FRONT.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|h| !h.is_finished()).unwrap_or(false);
        set_status(app, |s| {
            s.error = e.clone();
            if !serving {
                s.phase = "error".into();
            }
        });
    }
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            refresh(&app).await;
            tokio::time::sleep(TICK).await;
        }
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn local_https_status() -> Status {
    let mut s = status();
    if s.ips.is_empty() {
        s.ips = private_ips();
    }
    s
}

#[tauri::command]
pub async fn local_https_check(name: String) -> Result<Value, String> {
    check_name(&name.trim().to_lowercase()).await
}

/// Claim a name, then bring the address up straight away.
#[tauri::command]
pub async fn local_https_claim(name: String, app: AppHandle) -> Result<Status, String> {
    let name = name.trim().to_lowercase();
    {
        let g = app.state::<SettingsState>();
        if !g.lock().unwrap_or_else(|p| p.into_inner()).local_name.is_empty() {
            return Err("This computer already has a secure address. Release it first.".into());
        }
    }
    let v = edge_call(reqwest::Method::POST, "/v1/claim", json!({ "name": name })).await?;
    let secret = v["secret"].as_str().ok_or("The address service sent no secret")?.to_string();
    {
        let state = app.state::<SettingsState>();
        let to_save = {
            let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
            g.local_name = name.clone();
            g.local_secret = secret;
            g.clone()
        };
        crate::settings::save(&to_save)?;
    }
    set_status(&app, |s| {
        s.phase = "claimed".into();
        s.name = name.clone();
        s.detail = "Claimed. Setting it up".into();
    });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { refresh(&a).await });
    Ok(status())
}

#[tauri::command]
pub async fn local_https_retry(app: AppHandle) -> Status {
    refresh(&app).await;
    local_https_status()
}

/// Choose which of this computer's addresses the name points at ("" = automatic).
#[tauri::command]
pub async fn local_https_set_ip(ip: String, app: AppHandle) -> Result<Status, String> {
    if !ip.is_empty() && !is_private(&ip) {
        return Err("Pick one of this computer's church network addresses.".into());
    }
    {
        let state = app.state::<SettingsState>();
        let to_save = {
            let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
            g.local_ip = ip;
            g.clone()
        };
        crate::settings::save(&to_save)?;
    }
    refresh(&app).await;
    Ok(local_https_status())
}

/// Give the name back and stop serving it.
#[tauri::command]
pub async fn local_https_release(app: AppHandle) -> Result<Status, String> {
    let (name, secret) = {
        let g = app.state::<SettingsState>();
        let g = g.lock().unwrap_or_else(|p| p.into_inner());
        (g.local_name.clone(), g.local_secret.clone())
    };
    if !name.is_empty() {
        // Forget it here even if the service can't be reached: the name is
        // useless to anyone without its secret, and White Oak can free it.
        if let Err(e) = edge_call(reqwest::Method::POST, "/v1/release", json!({ "name": name, "secret": secret })).await {
            crate::diag::log(format!("[local-https] release: {e}"));
        }
    }
    {
        let state = app.state::<SettingsState>();
        let to_save = {
            let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
            g.local_name.clear();
            g.local_secret.clear();
            g.clone()
        };
        crate::settings::save(&to_save)?;
    }
    for f in ["cert.pem", "key.pem", "host.txt"] {
        let _ = std::fs::remove_file(dir().join(f));
    }
    refresh(&app).await;
    Ok(local_https_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_church_network_addresses_count() {
        for ip in ["10.0.0.5", "172.16.0.20", "172.31.255.1", "192.168.1.20"] {
            assert!(is_private(ip), "{ip}");
        }
        for ip in ["172.15.0.1", "172.32.0.1", "8.8.8.8", "127.0.0.1", "169.254.1.1", "100.64.0.1", "nonsense"] {
            assert!(!is_private(ip), "{ip}");
        }
    }

    // A booth with Wi-Fi and a Dante network has two addresses: the phones
    // are on the default route's one, unless someone picked.
    #[test]
    fn the_name_points_where_phones_are() {
        let all = vec!["172.16.0.20".to_string(), "192.168.1.20".to_string()];
        assert_eq!(pick_ip("", Some("192.168.1.20"), &all).as_deref(), Some("192.168.1.20"));
        assert_eq!(pick_ip("172.16.0.20", Some("192.168.1.20"), &all).as_deref(), Some("172.16.0.20"));
        // A choice that's gone (new network) falls back rather than pointing nowhere.
        assert_eq!(pick_ip("10.1.1.1", Some("192.168.1.20"), &all).as_deref(), Some("192.168.1.20"));
        assert_eq!(pick_ip("", None, &all).as_deref(), Some("172.16.0.20"));
        assert_eq!(pick_ip("", None, &[]), None);
    }

    // RFC 7638's own example key and thumbprint (section 3.1) is RSA; this
    // checks the EC form against a value computed independently.
    #[test]
    fn thumbprint_is_the_rfc_7638_shape() {
        let jwk = json!({
            "kty": "EC", "crv": "P-256",
            "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
            "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
        });
        // Member order in the input must not matter.
        let t = thumbprint(&jwk);
        assert_eq!(t.len(), 43);
        assert_eq!(t, B64.encode(Sha256::digest(
            br#"{"crv":"P-256","kty":"EC","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}"#
        )));
    }

    #[test]
    fn dns_challenge_value_is_base64url_sha256() {
        let v = dns01_value("token", "thumb");
        assert_eq!(v.len(), 43);
        assert!(!v.contains('=') && !v.contains('+') && !v.contains('/'));
        assert_eq!(v, B64.encode(Sha256::digest(b"token.thumb")));
    }

    #[test]
    fn account_signatures_verify() {
        use p256::ecdsa::{signature::Verifier, VerifyingKey};
        let key = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let sig: Signature = key.sign(b"a.b");
        assert_eq!(sig.to_bytes().len(), 64, "ES256 wants r||s, 64 bytes");
        assert!(VerifyingKey::from(&key).verify(b"a.b", &sig).is_ok());
    }

    #[test]
    fn reads_a_certificates_dates() {
        let key = rcgen::KeyPair::generate().unwrap();
        let mut p = rcgen::CertificateParams::new(vec!["x.local.prodeck.live".to_string()]).unwrap();
        p.not_before = rcgen::date_time_ymd(2026, 11, 2);
        p.not_after = rcgen::date_time_ymd(2027, 1, 31);
        let pem = p.self_signed(&key).unwrap().pem();
        let (nb, na) = cert_validity(&pem).unwrap();
        assert_eq!(nb, days_from_civil(2026, 11, 2) * 86_400);
        assert_eq!(na, days_from_civil(2027, 1, 31) * 86_400);
        assert_eq!(days_from_civil(1970, 1, 1), 0);
    }

    #[test]
    fn renews_with_a_third_of_its_life_left() {
        let (nb, na) = (0, 90 * 86_400);
        assert!(!needs_renewal(Some((nb, na)), 59 * 86_400));
        assert!(needs_renewal(Some((nb, na)), 60 * 86_400));
        assert!(needs_renewal(None, 0), "no certificate yet");
        // A six-day certificate still renews with two days to spare.
        assert!(needs_renewal(Some((0, 6 * 86_400)), 4 * 86_400));
    }

    // The https front tells the gateway who the phone really is, and a phone
    // can't put its own words in that header.
    #[test]
    fn the_front_adds_the_real_peer_and_drops_forged_ones() {
        let head = b"POST /api/cmd HTTP/1.1\r\nHost: x\r\nX-ProDeck-Peer: 10.9.9.9\r\nCF-Connecting-IP: 1.2.3.4\r\nContent-Length: 2\r\n\r\n";
        let out = String::from_utf8(rewrite_head(head, "192.168.1.50").unwrap()).unwrap();
        assert!(out.starts_with("POST /api/cmd HTTP/1.1\r\nX-ProDeck-Peer: 192.168.1.50\r\n"), "{out}");
        assert!(!out.contains("10.9.9.9") && !out.contains("1.2.3.4"), "{out}");
        assert!(out.contains("Content-Length: 2\r\n"));
        assert!(out.ends_with("\r\n\r\n") && !out.ends_with("\r\n\r\n\r\n"), "{out:?}");
        assert!(rewrite_head(b"\x16\x03\x01 not http\r\n\r\n", "1.1.1.1").is_none());
    }

    #[test]
    fn address_without_port_on_443() {
        assert_eq!(url_for("a.local.prodeck.live", 443), "https://a.local.prodeck.live");
        assert_eq!(url_for("a.local.prodeck.live", 8443), "https://a.local.prodeck.live:8443");
    }
}
