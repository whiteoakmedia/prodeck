// TapLink: keeps the NFC tap destination in sync with what's live in
// ProPresenter. A slide whose notes contain "tap:<keyword>" (e.g. tap:go for
// the giving moment) pushes that state to the taplink-edge worker, which 302s
// every subsequent tap to the mapped URL. State is sticky until another
// keyword, a manual override, or the edge's TTL revert; "tap:default" reverts
// explicitly. See ../../TAPLINK_PLAN.md and ../../taplink-edge/.
//
// The watcher hangs off the local status/slide stream (propresenter.rs), so
// only the instance actually connected to ProPresenter ever pushes — relay
// clients mirror events but never stream. Manual overrides are also allowed
// from the password-gated web gateway (see web.rs): the host keeps the edge
// token and the watcher on/off switch, so a phone can only choose among the
// edge's own keywords, never rewrite the mapping or read the token.

use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

// Debounce so an operator arrowing through slides doesn't spam the edge;
// last keyword wins.
const DEBOUNCE_MS: u64 = 750;
/// Manual (Stream Deck / UI) override hold — auto pushes resume after this.
const HOLD_SECS: u64 = 600;
const HEARTBEAT_SECS: u64 = 60;

pub struct TapInner {
    client: reqwest::Client,
    /// Bumped on every new keyword sighting; a pending debounced push only
    /// fires if its generation is still current when the timer lands.
    generation: u64,
    /// Deck-wide keyword of the ACTIVE presentation: set when every tagged
    /// slide in the deck agrees on one keyword (e.g. a pre-service video loop
    /// where the operator tagged a single slide). Untagged cues inherit it;
    /// mixed-keyword decks (sermon: go/notes/prayer) get None and stay
    /// strictly slide-level.
    deck_keyword: Option<String>,
    /// EXPLICIT keyword of the presentation slide that is live RIGHT NOW
    /// (None = the live slide itself carries no tag; deck inheritance is
    /// applied in effective(), not here). The heartbeat re-asserts state
    /// every minute: ProPresenter's status stream goes silent when the same
    /// cue is re-triggered (identical payload — e.g. the same PCO placeholder
    /// presentation at two playlist positions), so a state must never depend
    /// on PP re-announcing an unchanged slide.
    live_slide_kw: Option<String>,
    /// When live_slide_kw last CHANGED to a tagged slide. Paired with
    /// ann_changed below to answer "which layer is actually current?".
    live_changed: Option<std::time::Instant>,
    /// ANNOUNCEMENTS layer — a completely separate slide state in PP (the
    /// pre-service loop runs there). Watched via announcement/active (deck
    /// body with notes) + announcement/slide_index (current position).
    ann_slide_keywords: Vec<Option<String>>,
    ann_deck_keyword: Option<String>,
    ann_index: Option<usize>,
    /// EXPLICIT tag on the current announcement slide (no deck inheritance).
    ann_live_explicit: Option<String>,
    /// Deck-wide fallback for the announcements layer, only meaningful while
    /// a slide is actually up (ann_index present).
    ann_live_inherited: Option<String>,
    /// When ann_live_explicit last CHANGED to a tagged slide.
    ann_changed: Option<std::time::Instant>,
    /// Stream Deck / UI override: (keyword, when). While active, slide-driven
    /// pushes are suppressed so a pressed button actually STICKS — before
    /// this, the 2 s pollers stomped an override within a poll cycle. Expires
    /// after HOLD_SECS or on tap-auto / a new override.
    manual_hold: Option<(String, std::time::Instant)>,
    /// The slide-driven keyword at the moment the hold began. A hold only
    /// survives while the slides still say this — see hold_should_break.
    hold_baseline: Option<String>,
    /// Last keyword pushed to the edge — auto pushes dedupe against it so the
    /// pollers stop rewriting the DO every 2 s with the same state.
    last_pushed: Option<String>,
}

impl TapInner {
    /// Active manual hold, self-expiring.
    /// Should a pressed keyword give way to the slides?
    ///
    /// Only when the slide-driven keyword has genuinely MOVED ON from what
    /// was live when the button was pressed. The 2 s pollers re-assert the
    /// same keyword constantly; those must not break the hold, or a press
    /// would never stick. Zach's ask: "slide notes should still trigger the
    /// tap even if I press a manual tap, without resetting to auto."
    fn hold_should_break(baseline: Option<&str>, incoming: &str) -> bool {
        baseline != Some(incoming)
    }

    fn hold_active(&mut self) -> Option<String> {
        match &self.manual_hold {
            Some((kw, at)) if at.elapsed().as_secs() < HOLD_SECS => Some(kw.clone()),
            Some(_) => {
                self.manual_hold = None;
                None
            }
            None => None,
        }
    }

    /// The keyword the discs should reflect.
    ///
    /// Between the two EXPLICIT tags the MOST RECENTLY CHANGED LAYER WINS —
    /// "what just happened" rather than a fixed layer ranking. Pre-service
    /// the announcements loop advances every few seconds, so it keeps the
    /// disc; the moment the operator advances a tagged presentation slide,
    /// that takes over. A fixed hierarchy got this wrong in both directions:
    /// presentation-always-wins let one idle Tap:connect slide pin the disc
    /// while the loop cycled real keywords, and announcements-always-wins
    /// would let a stale loop hijack the sermon.
    ///
    /// Inherited (deck-wide) keywords stay strictly below both explicit
    /// tags, presentation first — inheritance is a weak signal and must
    /// never beat a slide someone actually tagged.
    fn effective(&self) -> Option<String> {
        let explicit = match (&self.live_slide_kw, &self.ann_live_explicit) {
            (Some(p), Some(a)) => {
                // Newer wins; ties (and missing stamps) favour the
                // presentation layer, which is what's visually on top.
                match (self.live_changed, self.ann_changed) {
                    (Some(pt), Some(at)) if at > pt => Some(a.clone()),
                    _ => Some(p.clone()),
                }
            }
            (Some(p), None) => Some(p.clone()),
            (None, Some(a)) => Some(a.clone()),
            (None, None) => None,
        };
        explicit
            .or_else(|| self.deck_keyword.clone())
            .or_else(|| self.ann_live_inherited.clone())
    }

    fn recompute_ann_live(&mut self) {
        match self.ann_index {
            None => {
                self.ann_live_explicit = None;
                self.ann_live_inherited = None;
                self.ann_changed = None;
            }
            Some(i) => {
                let next = self.ann_slide_keywords.get(i).cloned().flatten();
                if next.is_some() && next != self.ann_live_explicit {
                    self.ann_changed = Some(std::time::Instant::now());
                }
                self.ann_live_explicit = next;
                self.ann_live_inherited = self.ann_deck_keyword.clone();
            }
        }
    }
}

impl TapInner {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .build()
                .expect("reqwest client"),
            generation: 0,
            deck_keyword: None,
            live_slide_kw: None,
            live_changed: None,
            ann_slide_keywords: Vec::new(),
            ann_deck_keyword: None,
            ann_index: None,
            ann_live_explicit: None,
            ann_live_inherited: None,
            ann_changed: None,
            manual_hold: None,
            hold_baseline: None,
            last_pushed: None,
        }
    }
}

pub type TapState = Arc<Mutex<TapInner>>;

/// Edge URL + token, whenever TapLink is *configured*. Deliberately ignores
/// `tap_enabled`: that switch only disarms slide-following. The discs keep
/// working while it's off, so reading state, overriding by hand, and editing
/// the mappings must all keep working too — otherwise disarming the watcher
/// during the week would lock the operator out of their own links.
fn tap_endpoint(app: &AppHandle) -> Option<(String, String)> {
    let settings = app.state::<crate::settings::SettingsState>();
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    if s.tap_edge_url.is_empty() || s.tap_token.is_empty() {
        return None;
    }
    Some((s.tap_edge_url.trim_end_matches('/').to_string(), s.tap_token.clone()))
}

/// As above, but only when the watcher is armed — for the two paths that must
/// go quiet when the operator disarms: slide-driven pushes and the heartbeat.
fn tap_config(app: &AppHandle) -> Option<(String, String)> {
    let enabled = {
        let settings = app.state::<crate::settings::SettingsState>();
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        s.tap_enabled
    };
    enabled.then(|| tap_endpoint(app)).flatten()
}

/// Extract the first "tap:<keyword>" from slide notes (case-insensitive).
fn parse_keyword(notes: &str) -> Option<String> {
    let lower = notes.to_lowercase();
    let start = lower.find("tap:")? + 4;
    let kw: String = lower[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    (!kw.is_empty()).then_some(kw)
}

/// Called from the presentation/active stream: refresh the deck-wide keyword.
pub async fn on_active_presentation(app: &AppHandle, data: &Value) {
    let (_, deck) = scan_groups(data.get("presentation").unwrap_or(&Value::Null));
    let state = app.state::<TapState>().inner().clone();
    state.lock().await.deck_keyword = deck;
}

/// Announcements layer: deck body changed (or cleared).
///
/// ARRANGEMENTS: slide_index counts positions within the ACTIVE ARRANGEMENT,
/// not the raw deck — Zach's pre-service loop is an 11-slide arrangement of
/// a 22-slide deck, and flattening every group shifted the keyword table by
/// 11 (index 3 on screen looked up a slide from an unused group). The API
/// gives arrangements only their total_cues (group ids in `active` carry no
/// uuids to join on), so: when the current arrangement's cue count uniquely
/// matches one deck group, scan just that group; any ambiguity falls back to
/// the whole-deck flatten (the pre-arrangement behavior).
pub async fn on_active_announcement(app: &AppHandle, data: &Value) {
    let obj = data.get("announcement").unwrap_or(&Value::Null);
    let cleared = obj.is_null();
    let scan_target: Value = (|| {
        let cur = obj.get("current_arrangement")?.as_str()?;
        let arr = obj
            .get("arrangements")?
            .as_array()?
            .iter()
            .find(|a| a.pointer("/id/uuid").and_then(|v| v.as_str()) == Some(cur))?;
        let want = arr.get("total_cues")?.as_u64()?;
        if want == 0 {
            return None;
        }
        let groups = obj.get("groups")?.as_array()?;
        let matching: Vec<&Value> = groups
            .iter()
            .filter(|g| {
                g.get("slides").and_then(|s| s.as_array()).map(|s| s.len() as u64)
                    == Some(want)
            })
            .collect();
        if matching.len() != 1 {
            return None; // ambiguous — whole-deck fallback
        }
        Some(serde_json::json!({ "groups": [matching[0]] }))
    })()
    .unwrap_or_else(|| obj.clone());
    let (per_slide, deck) = scan_groups(&scan_target);
    let state = app.state::<TapState>().inner().clone();
    let mut t = state.lock().await;
    t.ann_slide_keywords = per_slide;
    t.ann_deck_keyword = deck;
    if cleared {
        t.ann_index = None;
    }
    t.recompute_ann_live();
}

/// Announcements layer: position changed — the equivalent of a slide change.
pub async fn on_announcement_index(app: &AppHandle, data: &Value) {
    let present = data
        .pointer("/announcement_index/presentation_id/uuid")
        .and_then(|v| v.as_str())
        .is_some();
    let index = data
        .pointer("/announcement_index/index")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);
    let Some((url, token)) = tap_config(app) else {
        return;
    };
    let state = app.state::<TapState>().inner().clone();
    let keyword = {
        let mut t = state.lock().await;
        t.ann_index = if present { index } else { None };
        t.recompute_ann_live();
        t.effective()
    };
    if let Some(kw) = keyword {
        schedule_push(app.clone(), state, url, token, kw);
    }
}

/// Per-slide keywords (flattened in group order) plus the deck-wide keyword:
/// the single keyword every tag in the deck agrees on, else None (no tags, or
/// a mixed deck like a sermon carrying go/notes/prayer — slide-level rules).
fn scan_groups(obj: &Value) -> (Vec<Option<String>>, Option<String>) {
    let mut per_slide = Vec::new();
    let mut deck: Option<String> = None;
    let mut mixed = false;
    let groups = obj.get("groups").and_then(|v| v.as_array());
    for g in groups.into_iter().flatten() {
        let slides = g.get("slides").and_then(|v| v.as_array());
        for s in slides.into_iter().flatten() {
            let kw = s
                .get("notes")
                .and_then(|n| n.as_str())
                .and_then(|n| parse_keyword(n));
            if let Some(kw) = &kw {
                match &deck {
                    Some(existing) if existing != kw => mixed = true,
                    _ => deck = Some(kw.clone()),
                }
            }
            per_slide.push(kw);
        }
    }
    (per_slide, if mixed { None } else { deck })
}

/// Called from the status/slide stream for every slide change.
pub async fn on_slide(app: &AppHandle, data: &Value) {
    let Some(notes) = data.pointer("/current/notes").and_then(|v| v.as_str()) else {
        return;
    };
    let slide_kw = parse_keyword(notes);
    let Some((url, token)) = tap_config(app) else {
        return;
    };

    // Resolve slide tag → else the deck-wide tag → else the announcements
    // layer, and record it in event order (awaited, not spawned, so a fast
    // sequence can't interleave) — the heartbeat re-asserts it every minute.
    let state = app.state::<TapState>().inner().clone();
    let keyword = {
        let mut t = state.lock().await;
        if slide_kw.is_some() && slide_kw != t.live_slide_kw {
            t.live_changed = Some(std::time::Instant::now());
        }
        t.live_slide_kw = slide_kw;
        t.effective()
    };
    let Some(keyword) = keyword else {
        return; // no keyword anywhere → sticky: leave the current state alone
    };
    schedule_push(app.clone(), state, url, token, keyword);
}

/// Debounced, generation-guarded push. Every tagged event pushes — no local
/// dedupe. The edge's state can change underneath us (per-keyword TTL revert,
/// the phone admin remote, another writer), so "I already pushed this" is not
/// evidence it's still live. A repeat push is idempotent and restarts the
/// keyword's revert timer, which is what re-firing the giving slide expects.
fn schedule_push(app: AppHandle, state: TapState, url: String, token: String, keyword: String) {
    tauri::async_runtime::spawn(async move {
        let my_gen = {
            let mut t = state.lock().await;
            t.generation += 1;
            t.generation
        };
        tokio::time::sleep(std::time::Duration::from_millis(DEBOUNCE_MS)).await;
        {
            let mut t = state.lock().await;
            if t.generation != my_gen {
                return; // superseded by a newer keyword event
            }
            if t.hold_active().is_some() {
                let baseline = t.hold_baseline.clone();
                if !TapInner::hold_should_break(baseline.as_deref(), &keyword) {
                    return; // pollers re-asserting the same slide — hold stands
                }
                // The operator moved to a differently-tagged slide: that is a
                // deliberate act and outranks the earlier button press.
                t.manual_hold = None;
                t.hold_baseline = None;
            }
            if t.last_pushed.as_deref() == Some(keyword.as_str()) {
                return; // unchanged — don't rewrite the edge every poll
            }
        }
        push_state(&app, &state, &url, &token, &keyword, "auto", false).await;
        state.lock().await.last_pushed = Some(keyword);
    });
}

/// POST the state to the edge (with retries) and record the outcome.
/// `keyword` "default" maps to a null state (edge falls back to its default).
/// `keepalive` marks a heartbeat re-assert: the UI skips the "✓ pushed" flash
/// for those, and failures stay quiet (heartbeat health already covers them).
async fn push_state(
    app: &AppHandle,
    state: &TapState,
    url: &str,
    token: &str,
    keyword: &str,
    source: &str,
    keepalive: bool,
) {
    let body = json!({
        "state": if keyword == "default" { Value::Null } else { json!(keyword) },
        "source": source,
    });
    let client = { state.lock().await.client.clone() };
    let mut last_err = String::new();
    for attempt in 0u64..3 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(attempt)).await;
        }
        let resp = client
            .post(format!("{}/api/state", url))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let dest = r
                    .json::<Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("destination").cloned());
                app.emit(
                    "tap:pushed",
                    json!({ "state": keyword, "source": source, "destination": dest, "keepalive": keepalive }),
                )
                .ok();
                return;
            }
            // 4xx won't get better with retries (bad token, unknown keyword).
            Ok(r) if r.status().is_client_error() => {
                let status = r.status();
                let detail = r.text().await.unwrap_or_default();
                last_err = format!("{status}: {detail}");
                break;
            }
            Ok(r) => last_err = format!("HTTP {}", r.status()),
            Err(e) => last_err = e.to_string(),
        }
    }
    if !keepalive {
        app.emit("tap:error", json!({ "state": keyword, "error": last_err })).ok();
    }
}

/// Heartbeat loop, spawned once at app startup. Only beats while TapLink is
/// enabled AND ProPresenter is connected here — so "last heartbeat" on the
/// edge means "the watcher is actually watching", and an idle relay client
/// never reports health it doesn't have. Deliberately does NOT extend the
/// edge's TTL (that clock runs from the last state change).
pub fn spawn_heartbeat(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(HEARTBEAT_SECS)).await;
            let Some((url, token)) = tap_config(&app) else { continue };
            let pp_connected = {
                let pp = app.state::<crate::propresenter::ProPresenterState>();
                let guard = pp.lock().await;
                guard.is_some()
            };
            let state = app.state::<TapState>().inner().clone();
            if !pp_connected {
                // No stream → we no longer know what's on stage. Forget it so
                // a reconnect can't re-assert a stale keyword.
                let mut t = state.lock().await;
                t.live_slide_kw = None;
                t.live_changed = None;
                t.deck_keyword = None;
                t.ann_index = None;
                t.recompute_ann_live();
                continue;
            }
            let client = { state.lock().await.client.clone() };
            let ok = matches!(
                client
                    .post(format!("{}/api/heartbeat", url))
                    .bearer_auth(&token)
                    .send()
                    .await,
                Ok(r) if r.status().is_success()
            );
            app.emit("tap:heartbeat", json!({ "ok": ok })).ok();
            // Re-assert the live slide's keyword (keepalive). Covers PP's
            // silent same-cue re-triggers and keeps a long-lived tagged slide
            // (e.g. a pre-service loop) from expiring out from under itself —
            // the revert timer effectively starts when the slide leaves stage.
            // Report the keepalive with the source that is actually in
            // force: re-asserting a HELD keyword as "auto" made the deck's
            // TAP MODE readout claim auto while a button press was still
            // holding the disc.
            let (live, src) = {
                let mut t = state.lock().await;
                match t.hold_active() {
                    Some(kw) => (Some(kw), "override"),
                    None => (t.effective(), "auto"),
                }
            };
            if ok {
                if let Some(kw) = live {
                    push_state(&app, &state, &url, &token, &kw, src, true).await;
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Commands (desktop only — not in the web gateway whitelist)
// ---------------------------------------------------------------------------

/// Manual override: push a keyword now, or None for default. Shared by the
/// desktop command and the web gateway so a phone press behaves identically.
pub async fn override_core(app: &AppHandle, state: Option<String>) -> Result<(), String> {
    let (url, token) = tap_endpoint(app).ok_or("TapLink isn't configured — set the edge URL and token in Settings")?;
    let tap = app.state::<TapState>().inner().clone();
    let keyword = state.unwrap_or_else(|| "default".into());
    // Bump the generation so a pending auto-push can't stomp the override,
    // and HOLD so the pollers don't re-assert the slide keyword either.
    {
        let mut t = tap.lock().await;
        t.generation += 1;
        t.hold_baseline = t.effective();
        t.manual_hold = Some((keyword.clone(), std::time::Instant::now()));
        t.last_pushed = Some(keyword.clone());
    }
    push_state(app, &tap, &url, &token, &keyword, "override", false).await;
    Ok(())
}

/// Release a manual hold and immediately re-assert the slide-driven keyword.
pub async fn resume_core(app: &AppHandle) -> Result<(), String> {
    let (url, token) = tap_endpoint(app).ok_or("TapLink isn't configured")?;
    let tap = app.state::<TapState>().inner().clone();
    let keyword = {
        let mut t = tap.lock().await;
        t.manual_hold = None;
        t.hold_baseline = None;
        t.effective()
    };
    if let Some(kw) = keyword {
        push_state(app, &tap, &url, &token, &kw, "auto", false).await;
        tap.lock().await.last_pushed = Some(kw);
    } else {
        push_state(app, &tap, &url, &token, "default", "auto", false).await;
        tap.lock().await.last_pushed = Some("default".into());
    }
    Ok(())
}

/// Manual override from the UI: push a keyword now, or None for default.
#[tauri::command]
pub async fn tap_override(state: Option<String>, app: AppHandle) -> Result<(), String> {
    override_core(&app, state).await
}

/// The shared HTTP client (one connection pool behind every edge call).
async fn edge_client(app: &AppHandle) -> reqwest::Client {
    let tap = app.state::<TapState>().inner().clone();
    let client = tap.lock().await.client.clone();
    client
}

/// Proxy the edge's current state for the UI (avoids webview CORS entirely).
/// The edge token never leaves the host — browser clients reach this through
/// the password-gated gateway and get back state only.
pub async fn edge_state_core(app: &AppHandle) -> Result<Value, String> {
    let (url, token) = tap_endpoint(app).ok_or("TapLink isn't configured — set the edge URL and token in Settings")?;
    let client = edge_client(app).await;
    let resp = client
        .get(format!("{}/api/state", url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("edge returned {}", resp.status()));
    }
    let mut state = resp.json::<Value>().await.map_err(|e| e.to_string())?;
    // Merge in the mapping's keyword list so the UI can render override
    // buttons straight from the edge config (single source of truth).
    if let Ok(m) = client
        .get(format!("{}/api/mappings", url))
        .bearer_auth(&token)
        .send()
        .await
    {
        if let Ok(mappings) = m.json::<Value>().await {
            if let Some(obj) = state.as_object_mut() {
                let keywords: Vec<String> = mappings
                    .get("keywords")
                    .and_then(|k| k.as_object())
                    .map(|k| k.keys().cloned().collect())
                    .unwrap_or_default();
                obj.insert("keywords".into(), serde_json::json!(keywords));
            }
        }
    }
    Ok(state)
}

#[tauri::command]
pub async fn tap_edge_state(app: AppHandle) -> Result<Value, String> {
    edge_state_core(&app).await
}

/// Tap counts by day + keyword, straight from the edge's own log. Read-only,
/// so the gateway exposes it too.
pub async fn stats_core(app: &AppHandle) -> Result<Value, String> {
    let (url, token) =
        tap_endpoint(app).ok_or("TapLink isn't configured — set the edge URL and token in Settings")?;
    let client = edge_client(app).await;
    let resp = client
        .get(format!("{}/api/stats", url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("edge returned {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tap_stats(app: AppHandle) -> Result<Value, String> {
    stats_core(&app).await
}

/// Tap counts for one service window (epoch ms). Day buckets can't answer this:
/// two services share a UTC day, and an evening service can straddle midnight
/// UTC. Returns `{from, to, total, keywords:[{state, taps}]}`.
pub async fn stats_range_core(app: &AppHandle, from: i64, to: i64) -> Result<Value, String> {
    let (url, token) =
        tap_endpoint(app).ok_or("TapLink isn't configured — set the edge URL and token in Settings")?;
    let client = edge_client(app).await;
    let resp = client
        .get(format!("{}/api/stats?from={}&to={}", url, from, to))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.json::<Value>().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|e| e.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("edge returned {status}"));
        return Err(reason);
    }
    Ok(body)
}

#[tauri::command]
pub async fn tap_stats_range(from: i64, to: i64, app: AppHandle) -> Result<Value, String> {
    stats_range_core(&app, from, to).await
}

/// Fetch each destination and report whether it still answers. A giving link
/// that 404s is the worst Sunday failure there is and nothing else would catch
/// it — the edge only stores URLs, it never visits them.
///
/// Checks run concurrently and report `status` (or a transport `error`); the
/// caller decides what's fatal. The browser User-Agent is insurance, not a
/// fix for anything observed: Church Center, PushPay and FaithNotes all answer
/// 200 to a bare client today (checked 2026-07-30). Bot-walls tend to appear
/// later, and the UI treats 401/403/405/429 as "can't tell" rather than dead
/// for the same reason — a false "dead giving link" would train the operator
/// to ignore this check.
#[tauri::command]
pub async fn tap_check_links(urls: Vec<String>) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        )
        .build()
        .map_err(|e| e.to_string())?;

    let mut set = tokio::task::JoinSet::new();
    for (i, url) in urls.into_iter().enumerate() {
        let client = client.clone();
        set.spawn(async move {
            // GET, not HEAD: plenty of hosts reject HEAD outright. The body is
            // never read, so this stops at the response headers.
            let out = match client.get(&url).send().await {
                Ok(r) => json!({ "url": url, "status": r.status().as_u16(), "error": Value::Null }),
                Err(e) => {
                    let why = if e.is_timeout() {
                        "timed out".to_string()
                    } else if e.is_connect() {
                        "could not connect".to_string()
                    } else {
                        e.to_string()
                    };
                    json!({ "url": url, "status": Value::Null, "error": why })
                }
            };
            (i, out)
        });
    }

    let mut results: Vec<(usize, Value)> = Vec::new();
    while let Some(joined) = set.join_next().await {
        match joined {
            Ok(pair) => results.push(pair),
            Err(e) => return Err(format!("link check failed: {e}")),
        }
    }
    results.sort_by_key(|(i, _)| *i); // answer in the order asked
    Ok(Value::Array(results.into_iter().map(|(_, v)| v).collect()))
}

/// The raw mapping config (`{default, ttl_minutes, keywords}`) for the editor.
/// Booth-only, like the rest of TapLink's configuration: the gateway exposes
/// picking a keyword, not rewriting where the discs can point.
#[tauri::command]
pub async fn tap_mappings(app: AppHandle) -> Result<Value, String> {
    let (url, token) = tap_endpoint(&app).ok_or("TapLink isn't configured — set the edge URL and token in Settings")?;
    let client = edge_client(&app).await;
    let resp = client
        .get(format!("{}/api/mappings", url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("edge returned {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

/// Replace the mapping config. The edge validates (keyword charset, http(s)
/// URLs, TTL bounds) and answers 422 with the reason, which we surface as-is;
/// a live state whose keyword just disappeared falls back to the default on
/// the edge's next read, so no separate cleanup is needed here.
#[tauri::command]
pub async fn tap_save_mappings(config: Value, app: AppHandle) -> Result<Value, String> {
    let (url, token) = tap_endpoint(&app).ok_or("TapLink isn't configured — set the edge URL and token in Settings")?;
    let client = edge_client(&app).await;
    let resp = client
        .put(format!("{}/api/mappings", url))
        .bearer_auth(&token)
        .json(&config)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.json::<Value>().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let reason = body
            .get("error")
            .and_then(|e| e.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("edge returned {status}"));
        return Err(reason);
    }
    Ok(body)
}

/// Settings "Test" button: check reachability and that the token works.
#[tauri::command]
pub async fn tap_test(
    edge_url: String,
    token: String,
    tap: tauri::State<'_, TapState>,
) -> Result<String, String> {
    let url = edge_url.trim_end_matches('/');
    let client = { tap.lock().await.client.clone() };
    let health = client
        .get(format!("{}/api/health", url))
        .send()
        .await
        .map_err(|e| format!("edge unreachable: {e}"))?;
    if !health.status().is_success() {
        return Err(format!("edge health returned {}", health.status()));
    }
    let auth = client
        .get(format!("{}/api/state", url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if auth.status().as_u16() == 401 {
        return Err("edge reachable, but the token was rejected".into());
    }
    if !auth.status().is_success() {
        return Err(format!("edge returned {}", auth.status()));
    }
    let v = auth.json::<Value>().await.map_err(|e| e.to_string())?;
    let current = v
        .get("state")
        .and_then(|s| s.as_str())
        .unwrap_or("default");
    Ok(format!("Connected — current state: {current}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_keyword, scan_groups, TapInner};

    fn deck(notes: &[&str]) -> serde_json::Value {
        serde_json::json!({ "groups": [{
            "slides": notes.iter().map(|n| serde_json::json!({"notes": n, "text": ""})).collect::<Vec<_>>()
        }]})
    }

    #[test]
    fn a_slide_move_breaks_a_manual_hold_but_pollers_do_not() {
        // Pressed MEN while the slides were showing "connect".
        let base = Some("connect");
        // The 2 s pollers keep re-asserting "connect" — the press must stick.
        assert!(!TapInner::hold_should_break(base, "connect"));
        // Operator advances to a slide tagged "give" — slides win.
        assert!(TapInner::hold_should_break(base, "give"));
        // Pressed while nothing was tagged: the first tagged slide wins.
        assert!(TapInner::hold_should_break(None, "prayer"));
    }

    #[test]
    fn most_recently_changed_layer_wins_between_explicit_tags() {
        use std::time::{Duration, Instant};
        let mut t = TapInner::new();
        // Pre-service: "Beginning of Service" sits live on a Tap:connect
        // slide while the announcements loop cycles its own keywords. The
        // loop moved most recently, so the loop owns the disc.
        t.live_slide_kw = Some("connect".into());
        t.live_changed = Some(Instant::now() - Duration::from_secs(300));
        t.ann_slide_keywords = vec![Some("groups".into()), Some("notes".into())];
        t.ann_index = Some(1);
        t.recompute_ann_live();
        assert_eq!(t.effective(), Some("notes".into()));

        // Operator advances a tagged presentation slide → it takes over.
        t.live_slide_kw = Some("go".into());
        t.live_changed = Some(Instant::now());
        assert_eq!(t.effective(), Some("go".into()));

        // Announcements cleared mid-service can't hijack the presentation.
        t.ann_index = None;
        t.recompute_ann_live();
        assert_eq!(t.effective(), Some("go".into()));
    }

    #[test]
    fn explicit_tag_always_beats_an_inherited_deck_keyword() {
        let mut t = TapInner::new();
        // Untagged live presentation slide inheriting a deck-wide keyword
        // must not outrank a slide the operator actually tagged.
        t.deck_keyword = Some("connect".into());
        t.live_slide_kw = None;
        t.ann_slide_keywords = vec![Some("prayer".into())];
        t.ann_index = Some(0);
        t.recompute_ann_live();
        assert_eq!(t.effective(), Some("prayer".into()));

        // With nothing explicit anywhere, inheritance still applies.
        t.ann_index = None;
        t.recompute_ann_live();
        assert_eq!(t.effective(), Some("connect".into()));
    }

    #[test]
    fn deck_keyword_resolution() {
        // One tagged slide among untagged video cues → whole deck inherits.
        let (slides, deck_kw) = scan_groups(&deck(&["", "", "Tap:connect", ""]));
        assert_eq!(deck_kw, Some("connect".into()));
        assert_eq!(slides, vec![None, None, Some("connect".into()), None]);
        // Same keyword twice still counts as agreement.
        assert_eq!(scan_groups(&deck(&["tap:go", "", "TAP:GO"])).1, Some("go".into()));
        // Mixed keywords → slide-level only (per-slide list still populated).
        let (slides, deck_kw) = scan_groups(&deck(&["tap:go", "tap:notes"]));
        assert_eq!(deck_kw, None);
        assert_eq!(slides, vec![Some("go".into()), Some("notes".into())]);
        // No tags at all → nothing to inherit.
        assert_eq!(scan_groups(&deck(&["", ""])).1, None);
        // Cleared / missing deck → empty.
        let (slides, deck_kw) = scan_groups(&serde_json::Value::Null);
        assert_eq!((slides.len(), deck_kw), (0, None));
    }

    #[test]
    fn parses_keywords() {
        assert_eq!(parse_keyword("tap:go"), Some("go".into()));
        assert_eq!(parse_keyword("Verse 2 — TAP:Go rest"), Some("go".into()));
        assert_eq!(parse_keyword("tap:default"), Some("default".into()));
        assert_eq!(parse_keyword("tap: go"), None); // space breaks the keyword
        assert_eq!(parse_keyword("no keyword here"), None);
        assert_eq!(parse_keyword("multitap:small-groups!"), Some("small-groups".into()));
    }
}
