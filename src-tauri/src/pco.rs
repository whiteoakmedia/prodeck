use crate::settings::SettingsState;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const PCO_BASE: &str = "https://api.planningcenteronline.com";

pub struct PcoInner {
    pub syncing: AtomicBool,
    /// How often the LIVE current-item is polled, in milliseconds. The frontend
    /// lowers this while following / auto-advancing for snappier sync and raises
    /// it again when idle. Clamped to [500, 30000].
    pub live_interval_ms: AtomicU64,
    /// Bumped on every `pco_start_sync`. A polling task exits as soon as its
    /// captured epoch no longer matches, so switching weeks can't leave a stale
    /// task emitting the previous plan's data (which caused week "flickering").
    pub epoch: AtomicU64,
    /// This week's plan team, refreshed with every team fetch (~30s). The
    /// Stream Deck reads it through the deck API so crew keys follow the PCO
    /// schedule instead of hard-coded names. Cleared when a new plan syncs.
    pub team: Mutex<Vec<TeamRow>>,
}

impl PcoInner {
    pub fn new() -> Self {
        Self {
            syncing: AtomicBool::new(false),
            live_interval_ms: AtomicU64::new(5000),
            epoch: AtomicU64::new(0),
            team: Mutex::new(Vec::new()),
        }
    }
}

/// One scheduled person on the plan, as PCO spells them.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TeamRow {
    pub name: String,
    pub position: String,
    pub team: String,
    /// PCO single-letter status: C(onfirmed) / U(nconfirmed) / D(eclined).
    pub status: String,
}

/// Parse a `team_members?include=team` response. Mirrors parseTeam in
/// pcoStore.tsx — keep the two in agreement.
pub fn parse_team(v: &serde_json::Value) -> Vec<TeamRow> {
    let mut teams: std::collections::HashMap<String, String> = Default::default();
    if let Some(inc) = v.get("included").and_then(|i| i.as_array()) {
        for t in inc {
            if t.get("type").and_then(|x| x.as_str()) == Some("Team") {
                let id = t.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let name = t.pointer("/attributes/name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                teams.insert(id, name);
            }
        }
    }
    v.get("data")
        .and_then(|d| d.as_array())
        .map(|rows| {
            rows.iter()
                .map(|d| {
                    let a = d.get("attributes").cloned().unwrap_or(serde_json::Value::Null);
                    let position = a.get("team_position_name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let team_id = d.pointer("/relationships/team/data/id").and_then(|x| x.as_str()).unwrap_or("");
                    let team = teams.get(team_id).cloned().filter(|t| !t.is_empty()).unwrap_or_else(|| position.clone());
                    TeamRow {
                        name: a.get("name").and_then(|x| x.as_str()).unwrap_or("Unknown").to_string(),
                        position,
                        team,
                        status: a.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn is_declined(status: &str) -> bool {
    let s = status.trim().to_lowercase();
    s == "d" || s == "declined"
}

const WORSHIP_WORDS: &[&str] = &[
    "worship", "band", "vocal", "singer", "choir", "music", "keys", "keyboard", "guitar", "bass",
    "drum", "piano", "violin", "cello", "sax", "horn", "strings", "acoustic", "percussion",
];
const PRODUCTION_WORDS: &[&str] = &[
    "production", "tech", "audio", "sound", "camera", "video", "lighting", "light", "media",
    "propresenter", "prodeck", "slide", "stream", "broadcast", "graphic", "switcher", "director",
    "booth", "projection", "computer",
];
const PRODUCTION_TOKENS: &[&str] = &["av", "avl", "cam", "foh", "a1", "a2", "v1", "l1"];

fn has_word(hay: &str, token: &str) -> bool {
    hay.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == token)
}

/// Same rule as isProductionMember in pcoStore.tsx: worship words exclude,
/// then production words / whole-word tokens include.
pub fn is_production(team: &str, position: &str) -> bool {
    let hay = format!("{} {}", team, position).to_lowercase();
    if WORSHIP_WORDS.iter().any(|w| hay.contains(w)) {
        return false;
    }
    PRODUCTION_WORDS.iter().any(|w| hay.contains(w)) || PRODUCTION_TOKENS.iter().any(|t| has_word(&hay, t))
}

/// The deck's crew order for this week: active people only, production
/// first (booth crew), worship after, one row per person (first position
/// wins). Stable between two polls of the same team, which is what lets a
/// key address "crew slot 3" and page the right person.
pub fn deck_roster(state: &PcoState) -> Vec<TeamRow> {
    let team = state.team.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let active: Vec<&TeamRow> = team.iter().filter(|m| !is_declined(&m.status)).collect();
    let mut out: Vec<TeamRow> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for want_prod in [true, false] {
        for m in active.iter().filter(|m| is_production(&m.team, &m.position) == want_prod) {
            let key = m.name.trim().to_lowercase();
            if key.is_empty() || seen.contains(&key) {
                continue;
            }
            seen.push(key);
            out.push((*m).clone());
        }
    }
    out
}

/// "Zachary Green" → "Zachary G" — ≤9 chars so it fits a Stream Deck key at
/// a readable size (the deck's name layer is sized for 9).
pub fn short_name(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.len() {
        0 => String::new(),
        1 => parts[0].chars().take(9).collect(),
        _ => {
            let first: String = parts[0].chars().take(7).collect();
            let initial = parts[parts.len() - 1].chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
            format!("{first} {initial}")
        }
    }
}

pub type PcoState = Arc<PcoInner>;

pub(crate) fn creds(settings: &SettingsState) -> Result<(String, String), String> {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    // Trim on USE, not just on entry. A pasted token often carries a trailing
    // space or newline, and credentials can also arrive from a restored
    // backup, a hand-edited settings.json, or the web gateway — all paths that
    // never saw the UI's trim. Basic auth sends whitespace verbatim, and
    // Planning Center answers 401 with an empty body, so this failed as
    // "wrong password" with nothing to go on.
    let a = s.pco_app_id.clone().unwrap_or_default().trim().to_string();
    let b = s.pco_secret.clone().unwrap_or_default().trim().to_string();
    if a.is_empty() || b.is_empty() {
        return Err("Planning Center credentials not set (add them on the Planning Center page)".into());
    }
    Ok((a, b))
}

/// Planning Center answers a bad credential with a bare 401 and an empty body,
/// which surfaced to operators as "PCO 401 Unauthorized:" — true, and useless.
/// The overwhelmingly common cause is the wrong kind of credential: PCO's
/// developer site offers both OAuth *applications* (Client ID/Secret, which do
/// NOT work here) and Personal Access Tokens (which do), and they look alike.
pub(crate) fn explain_pco_error(code: u16, status: &str, body: &str) -> String {
    match code {
        401 => "Planning Center rejected these credentials.\n\
                • They must be a Personal Access Token — at api.planningcenteronline.com, \
                open Personal Access Tokens and create one. A Client ID/Secret from an \
                OAuth application will always fail here, and the two look almost identical.\n\
                • Check the Application ID and Secret aren't swapped, and that neither \
                picked up a stray space when pasted."
            .to_string(),
        403 => "Planning Center accepted the credentials but refused this data. The token's \
                account needs access to Services in your organization."
            .to_string(),
        404 => "Planning Center couldn't find that — the plan or service type may have been \
                deleted."
            .to_string(),
        429 => "Planning Center is rate-limiting ProDeck. It will catch up on its own in a \
                minute."
            .to_string(),
        500..=599 => format!("Planning Center is having trouble ({status}). Nothing to fix on this end."),
        _ if body.trim().is_empty() => format!("Planning Center error {status}."),
        _ => format!("Planning Center error {status}: {body}"),
    }
}

pub(crate) async fn pco_request(
    app_id: &str,
    secret: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    pco_request_coded(app_id, secret, path).await.map_err(|(_, msg)| msg)
}

/// `pco_request` that keeps the HTTP status code.
///
/// A 404 is a *normal* answer in two places — nobody holds the LIVE controller,
/// and the plan has no live item — so those callers must recognise it. They used
/// to match the substring "PCO 404" in the error text, which silently stopped
/// working the moment that text was rewritten to be readable. Network failures
/// (no response at all) report code 0, which is never mistaken for a 404.
pub(crate) async fn pco_request_coded(
    app_id: &str,
    secret: &str,
    path: &str,
) -> Result<serde_json::Value, (u16, String)> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else {
        format!("{}/{}", PCO_BASE, path.trim_start_matches('/'))
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| (0, e.to_string()))?;
    let resp = client
        .get(&url)
        .basic_auth(app_id, Some(secret))
        .header("User-Agent", "ProDeck/0.1")
        .send()
        .await
        .map_err(|e| (0, e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        let code = status.as_u16();
        return Err((code, explain_pco_error(code, &status.to_string(), &snippet)));
    }
    resp.json().await.map_err(|e| (0, e.to_string()))
}

#[cfg(test)]
mod cred_tests {
    use super::explain_pco_error;

    #[test]
    fn a_401_names_the_actual_mistake() {
        let m = explain_pco_error(401, "401 Unauthorized", "");
        // The failure mode that actually happens: an OAuth app's Client ID and
        // Secret pasted in place of a Personal Access Token.
        assert!(m.contains("Personal Access Token"), "{m}");
        assert!(m.contains("OAuth"), "{m}");
        assert!(m.contains("space"), "should mention pasted whitespace: {m}");
        // Never leave the operator with just the status line.
        assert!(m.len() > 80);
    }

    #[test]
    fn other_statuses_stay_distinct_and_honest() {
        assert!(explain_pco_error(403, "403 Forbidden", "").contains("Services"));
        assert!(explain_pco_error(429, "429", "").contains("rate-limit"));
        assert!(explain_pco_error(503, "503 Service Unavailable", "").contains("Nothing to fix"));
        // An unknown code with a body still shows the body rather than eating it.
        assert!(explain_pco_error(418, "418 I'm a teapot", "short and stout").contains("short and stout"));
        // An unknown code with no body doesn't render a dangling colon.
        assert!(!explain_pco_error(418, "418", "   ").ends_with(": "));
    }

    /// Three call sites used to detect "no live item" / "nobody is controlling"
    /// by looking for the substring "PCO 404" in the error message. Rewriting
    /// those messages to be readable silently broke all three. The status now
    /// travels as a prefix the UI strips; this pins the format that both the
    /// desktop command and the web gateway emit and that `PcoError` in
    /// lib/tauri.ts parses.
    #[test]
    fn coded_errors_carry_a_parseable_status() {
        use super::coded_msg;
        let m = coded_msg(404, &explain_pco_error(404, "404 Not Found", ""));
        assert!(m.starts_with("PCO/404 "), "{m}");
        // What PcoError does: strip the prefix, keep the readable half.
        let (head, rest) = m.split_once(' ').expect("prefix and message");
        assert_eq!(head, "PCO/404");
        assert!(!rest.contains("PCO/"), "the shown message must be clean: {rest}");
        assert!(!rest.trim().is_empty());
        // Every code round-trips, including the ones the UI only displays.
        for c in [401u16, 403, 404, 429, 503] {
            let m = coded_msg(c, "x");
            assert_eq!(m.split_once(' ').unwrap().0, format!("PCO/{c}"));
        }
    }
}

/// Generic authenticated GET against the Planning Center API.
#[tauri::command]
pub async fn pco_get(
    path: String,
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    let (a, b) = creds(&settings)?;
    pco_get_for_ui(&a, &b, &path).await
}

/// The exact contract the `pco_get` command exposes to the UI: the HTTP status
/// rides at the front of the error, machine-readable. `pcoGet` in lib/tauri.ts
/// strips it before anything is displayed, so callers can branch on 404 without
/// matching English prose.
///
/// The web gateway serves the same command and MUST return the same shape —
/// otherwise a phone's live-item tracking behaves differently from the booth's,
/// which is exactly the class of bug this replaced.
pub(crate) async fn pco_get_for_ui(
    app_id: &str,
    secret: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    pco_request_coded(app_id, secret, path).await.map_err(|(code, msg)| coded_msg(code, &msg))
}

/// Follow `links.next` until the collection is exhausted, merging `data` and
/// `included` into one document.
///
/// Nothing in the app did this. Every list was a single request asking for
/// `per_page=100` — above PCO's cap of 100, which it silently honours as 100 —
/// so the tail of any long collection was dropped with no error and no
/// indication. It bites first on a plan whose songs carry several chord charts
/// each: past the hundredth attachment, the charts simply were not there.
pub(crate) async fn pco_get_all(
    app_id: &str,
    secret: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    let mut merged: Option<serde_json::Value> = None;
    let mut next = Some(path.to_string());
    // A plan with 2,000 rows is already pathological; the cap keeps a broken
    // `links.next` from looping forever.
    for _ in 0..20 {
        let Some(url) = next.take() else { break };
        let page = pco_request(app_id, secret, &url).await?;
        next = page
            .pointer("/links/next")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        match merged.as_mut() {
            None => merged = Some(page),
            Some(acc) => {
                for key in ["data", "included"] {
                    let Some(rows) = page.get(key).and_then(|v| v.as_array()) else { continue };
                    if let Some(dst) = acc.get_mut(key).and_then(|v| v.as_array_mut()) {
                        dst.extend(rows.iter().cloned());
                    }
                }
            }
        }
        if next.is_none() {
            break;
        }
    }
    merged.ok_or_else(|| "no response from Planning Center".to_string())
}

/// The wire format of that contract, in one place so the test can pin it.
fn coded_msg(code: u16, msg: &str) -> String {
    format!("PCO/{code} {msg}")
}

/// Verify credentials by fetching the authenticated user.
#[tauri::command]
pub async fn pco_test(
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    let (a, b) = creds(&settings)?;
    pco_request(&a, &b, "people/v2/me").await
}

pub(crate) async fn pco_post(app_id: &str, secret: &str, path: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}/{}", PCO_BASE, path.trim_start_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .basic_auth(app_id, Some(secret))
        .header("User-Agent", "ProDeck/0.1")
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("PCO {}: {}", status, snippet));
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// Drive Services LIVE: step the live controller forward/back or take control.
#[tauri::command]
pub async fn pco_live_action(
    service_type_id: String,
    plan_id: String,
    action: String,
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    let allowed = ["go_to_next_item", "go_to_previous_item", "toggle_control"];
    if !allowed.contains(&action.as_str()) {
        return Err(format!("unsupported live action: {action}"));
    }
    let (a, b) = creds(&settings)?;
    let path = format!(
        "services/v2/service_types/{}/plans/{}/live/{}",
        service_type_id, plan_id, action
    );
    pco_post(&a, &b, &path).await
}

/// Who currently holds the Services LIVE controller, and who we are.
///
/// PCO ignores `go_to_next_item` unless someone has taken control, and an
/// uncontrolled plan answers 404 here — which is the normal state, not an
/// error, so it maps to a null controller rather than failing.
#[tauri::command]
pub async fn pco_live_controller(
    service_type_id: String,
    plan_id: String,
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    let (a, b) = creds(&settings)?;
    let path = format!(
        "services/v2/service_types/{}/plans/{}/live/controller",
        service_type_id, plan_id
    );
    let (controller_id, controller_name) = match pco_request_coded(&a, &b, &path).await {
        Ok(v) => (
            v.pointer("/data/id").and_then(|x| x.as_str()).map(str::to_string),
            v.pointer("/data/attributes/full_name")
                .and_then(|x| x.as_str())
                .map(str::to_string),
        ),
        // 404 = nobody has taken control yet. This is the ordinary state of a
        // plan before anyone presses Take control, NOT an error to show.
        Err((404, _)) => (None, None),
        Err((_, msg)) => return Err(msg),
    };
    let me_id = pco_request(&a, &b, "people/v2/me")
        .await
        .ok()
        .and_then(|v| v.pointer("/data/id").and_then(|x| x.as_str()).map(str::to_string));
    Ok(serde_json::json!({
        "controllerId": controller_id,
        "controllerName": controller_name,
        "meId": me_id,
    }))
}

fn items_path(st: &str, plan: &str) -> String {
    format!(
        "services/v2/service_types/{}/plans/{}/items?per_page=100&include=song,arrangement,key,item_notes,attachments",
        st, plan
    )
}

fn team_path(st: &str, plan: &str) -> String {
    // `times` brings each member's ASSIGNED plan times — their call time for
    // this week. That's what drives per-person "expected" on check-in.
    format!(
        "services/v2/service_types/{}/plans/{}/team_members?per_page=100&include=team,times",
        st, plan
    )
}

fn live_path(st: &str, plan: &str) -> String {
    format!(
        "services/v2/service_types/{}/plans/{}/live/current_item_time?include=item",
        st, plan
    )
}

/// Begin polling a plan: LIVE current item every tick, plan items + team less
/// often. Emits `pco:live`, `pco:items`, `pco:team`.
#[tauri::command]
pub async fn pco_start_sync(
    service_type_id: String,
    plan_id: String,
    settings: tauri::State<'_, SettingsState>,
    state: tauri::State<'_, PcoState>,
    app: AppHandle,
) -> Result<(), String> {
    let (app_id, secret) = creds(&settings)?;

    // Claim this sync as the latest; any task from a previous plan will see a
    // newer epoch and stop, so two weeks can't poll/emit at once.
    let my_epoch = state.epoch.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
    state.syncing.store(true, Ordering::Release);

    let running = state.inner().clone();
    let app2 = app.clone();
    // New plan: forget last week's team until this plan's first fetch lands,
    // so the deck can't page last Sunday's crew during the hand-off.
    running.team.lock().unwrap_or_else(|p| p.into_inner()).clear();
    app.emit("pco:sync_started", &plan_id).ok();

    tokio::spawn(async move {
        // This task is current only while syncing AND it owns the latest epoch.
        let current = |r: &PcoInner| {
            r.syncing.load(Ordering::Acquire) && r.epoch.load(Ordering::Acquire) == my_epoch
        };
        let mut first = true;
        let mut last_meta = tokio::time::Instant::now();
        while current(&running) {
            // Slower-moving data: items + team on the first tick, then every ~30s.
            if first || last_meta.elapsed() >= Duration::from_secs(30) {
                if let Ok(v) = pco_get_all(&app_id, &secret, &items_path(&service_type_id, &plan_id)).await {
                    if current(&running) {
                        app2.emit("pco:items", v).ok();
                    }
                }
                if let Ok(v) = pco_get_all(&app_id, &secret, &team_path(&service_type_id, &plan_id)).await {
                    if current(&running) {
                        *running.team.lock().unwrap_or_else(|p| p.into_inner()) = parse_team(&v);
                        app2.emit("pco:team", v).ok();
                    }
                }
                // Charts live wherever the worship team attached them — the
                // plan item, the song, or the arrangement. all_attachments is
                // PCO's aggregate of every one of those for this plan.
                if let Ok(v) = pco_get_all(
                    &app_id,
                    &secret,
                    &format!(
                        "services/v2/service_types/{}/plans/{}/all_attachments?per_page=100",
                        service_type_id, plan_id
                    ),
                )
                .await
                {
                    if current(&running) {
                        app2.emit("pco:attachments", v).ok();
                    }
                }
                // Plan times ride the sync too: member phones can't call
                // pco_get (admin-only), so this event is their ONLY source for
                // the countdown and per-person call times.
                if let Ok(v) = pco_request(
                    &app_id,
                    &secret,
                    &format!(
                        "services/v2/service_types/{}/plans/{}/plan_times?per_page=100",
                        service_type_id, plan_id
                    ),
                )
                .await
                {
                    if current(&running) {
                        app2.emit("pco:times", v).ok();
                    }
                }
                last_meta = tokio::time::Instant::now();
            }
            first = false;
            // LIVE current item — may 404 when the plan isn't live; that's fine.
            let live =
                pco_request_coded(&app_id, &secret, &live_path(&service_type_id, &plan_id)).await;
            if current(&running) {
                match live {
                    Ok(v) => {
                        app2.emit("pco:live", v).ok();
                    }
                    Err(e) => {
                        // 404 = the plan genuinely has nothing live → clear.
                        // Any OTHER failure (timeout, 429, 5xx, network blip)
                        // keeps the last known item: emitting Null on a blip
                        // un-tracked the running item and made auto-advance
                        // re-fire its presentation when the next poll recovered
                        // — yanking ProPresenter mid-service.
                        if e.0 == 404 {
                            app2.emit("pco:live", serde_json::Value::Null).ok();
                        }
                    }
                }
            }
            let ms = running
                .live_interval_ms
                .load(Ordering::Acquire)
                .clamp(500, 30_000);
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
        // Only the current epoch announces a stop — a superseded task stays quiet.
        if running.epoch.load(Ordering::Acquire) == my_epoch {
            app2.emit("pco:sync_stopped", ()).ok();
        }
    });

    Ok(())
}

#[tauri::command]
pub fn pco_stop_sync(state: tauri::State<'_, PcoState>) {
    state.syncing.store(false, Ordering::Release);
}

/// Adjust how often the LIVE current-item is polled (ms). Lower = snappier
/// follow / auto-advance; higher = quieter when idle.
#[tauri::command]
pub fn pco_set_live_interval(ms: u64, state: tauri::State<'_, PcoState>) {
    state
        .live_interval_ms
        .store(ms.clamp(500, 30_000), Ordering::Release);
}

/// Resolve a Planning Center attachment (chord chart, lead sheet…) to its
/// downloadable URL. POST /attachments/{id}/open returns a short-lived link
/// the phone can fetch straight from PCO's CDN. Member-tier via the gateway:
/// worship phones open their own charts.
#[tauri::command]
pub async fn pco_attachment_open(
    id: String,
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    let (a, b) = creds(&settings)?;
    pco_post(&a, &b, &format!("services/v2/attachments/{id}/open")).await
}

/// Raw chord chart + lyrics for an arrangement — the in-app chart renderer's
/// data. Member-tier via the gateway: worship phones draw their own charts
/// (PCO's generated PDFs are login-walled web pages, so we render instead).
#[tauri::command]
pub async fn pco_chord_chart(
    song_id: String,
    arrangement_id: String,
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    if !song_id.chars().all(|c| c.is_ascii_digit())
        || !arrangement_id.chars().all(|c| c.is_ascii_digit())
    {
        return Err("bad ids".into());
    }
    let (a, b) = creds(&settings)?;
    let v = pco_request(
        &a,
        &b,
        &format!("services/v2/songs/{song_id}/arrangements/{arrangement_id}"),
    )
    .await?;
    let attrs = v.get("data").and_then(|d| d.get("attributes")).cloned().unwrap_or_default();
    Ok(serde_json::json!({
        "chordChart": attrs.get("chord_chart").cloned().unwrap_or(serde_json::Value::Null),
        "chartKey": attrs.get("chord_chart_key").cloned().unwrap_or(serde_json::Value::Null),
        "lyrics": attrs.get("lyrics").cloned().unwrap_or(serde_json::Value::Null),
        "name": attrs.get("name").cloned().unwrap_or(serde_json::Value::Null),
    }))
}
