use crate::settings::SettingsState;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
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
}

impl PcoInner {
    pub fn new() -> Self {
        Self {
            syncing: AtomicBool::new(false),
            live_interval_ms: AtomicU64::new(5000),
            epoch: AtomicU64::new(0),
        }
    }
}

pub type PcoState = Arc<PcoInner>;

pub(crate) fn creds(settings: &SettingsState) -> Result<(String, String), String> {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    match (s.pco_app_id.clone(), s.pco_secret.clone()) {
        (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => Ok((a, b)),
        _ => Err("Planning Center credentials not set (add them on the Planning Center page)".into()),
    }
}

pub(crate) async fn pco_request(
    app_id: &str,
    secret: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else {
        format!("{}/{}", PCO_BASE, path.trim_start_matches('/'))
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .basic_auth(app_id, Some(secret))
        .header("User-Agent", "ProDeck/0.1")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("PCO {}: {}", status, snippet));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Generic authenticated GET against the Planning Center API.
#[tauri::command]
pub async fn pco_get(
    path: String,
    settings: tauri::State<'_, SettingsState>,
) -> Result<serde_json::Value, String> {
    let (a, b) = creds(&settings)?;
    pco_request(&a, &b, &path).await
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
    let (controller_id, controller_name) = match pco_request(&a, &b, &path).await {
        Ok(v) => (
            v.pointer("/data/id").and_then(|x| x.as_str()).map(str::to_string),
            v.pointer("/data/attributes/full_name")
                .and_then(|x| x.as_str())
                .map(str::to_string),
        ),
        // 404 = nobody has taken control yet.
        Err(e) if e.contains("PCO 404") => (None, None),
        Err(e) => return Err(e),
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
        "services/v2/service_types/{}/plans/{}/items?per_page=200&include=song,arrangement,key,item_notes,attachments",
        st, plan
    )
}

fn team_path(st: &str, plan: &str) -> String {
    // `times` brings each member's ASSIGNED plan times — their call time for
    // this week. That's what drives per-person "expected" on check-in.
    format!(
        "services/v2/service_types/{}/plans/{}/team_members?per_page=200&include=team,times",
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
                if let Ok(v) = pco_request(&app_id, &secret, &items_path(&service_type_id, &plan_id)).await {
                    if current(&running) {
                        app2.emit("pco:items", v).ok();
                    }
                }
                if let Ok(v) = pco_request(&app_id, &secret, &team_path(&service_type_id, &plan_id)).await {
                    if current(&running) {
                        app2.emit("pco:team", v).ok();
                    }
                }
                // Charts live wherever the worship team attached them — the
                // plan item, the song, or the arrangement. all_attachments is
                // PCO's aggregate of every one of those for this plan.
                if let Ok(v) = pco_request(
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
            let live = pco_request(&app_id, &secret, &live_path(&service_type_id, &plan_id)).await;
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
                        if e.contains("PCO 404") {
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
