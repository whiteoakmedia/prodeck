// Pages — the priority channel (design/mobile/README.md S06/S07).
//
// Chat is a feed you read when you look; a page INTERRUPTS: it takes over the
// recipient's screen and buzzes until they confirm. That difference is the
// whole feature, so pages are a separate store with their own read receipts.
//
// Receipts are recorded only here, on the booth, from an ack that actually
// arrived. The spec is explicit that a confirm which never reached the booth
// must not render as read — so nothing in this path is optimistic, and the
// sending phone learns a page was read only via the "page:receipt" event.
//
// Like chat, history is a small in-memory ring: pages are a Sunday-morning
// tool, not a record to keep. Recipients are RESOLVED AT SEND TIME into a
// concrete list, so "Send page to 5" keeps meaning those five even if someone
// registers a minute later.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::identity::IdentityState;

const HISTORY_CAP: usize = 50;
/// "Buzz until read": re-fire every 20s for 2 minutes (design S07b). Bounded on
/// purpose — an unanswered page must not buzz someone's pocket all morning, and
/// after two minutes the sender should be looking at the tracking screen and
/// deciding, not waiting on a timer.
const BUZZ_INTERVAL_SECS: u64 = 20;
const BUZZ_WINDOW_MS: u64 = 2 * 60 * 1000;
const MAX_BODY: usize = 240;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipient {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub user_id: String,
    pub name: String,
    pub read_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: u64,
    pub from: String,
    pub body: String,
    pub recipients: Vec<Recipient>,
    pub buzz: bool,
    pub sent_ms: u64,
    pub receipts: Vec<Receipt>,
}

pub struct PagesInner {
    next_id: AtomicU64,
    pages: Mutex<VecDeque<Page>>,
}

impl PagesInner {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pages: Mutex::new(VecDeque::with_capacity(HISTORY_CAP)),
        }
    }
}

pub type PagesState = Arc<PagesInner>;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Send a page. `recipient_ids` empty means "everyone" — resolved here to every
/// approved crew member, so the stored list is always concrete.
pub fn send_core(
    app: &AppHandle,
    pages: &PagesState,
    identity: &IdentityState,
    from: String,
    body: String,
    recipient_ids: Vec<String>,
    buzz: bool,
) -> Result<Page, String> {
    let from = from.trim().to_string();
    let body = body.trim().chars().take(MAX_BODY).collect::<String>();
    if from.is_empty() {
        return Err("sender name is required".into());
    }
    if body.is_empty() {
        return Err("a page needs a message".into());
    }

    // Only approved crew can be paged — an unapproved device has no session and
    // could never ack, which would leave the sender staring at a permanent
    // "waiting" row.
    let roster = crate::identity::approved_users(identity);
    let recipients: Vec<Recipient> = if recipient_ids.is_empty() {
        // A broadcast goes only to people IN THE BUILDING (checked in for the
        // current service). Paging every account meant everyone at home got
        // Sunday-morning buzzes. Naming someone explicitly still always
        // delivers — that is how "where are you?" and the call-time nudge
        // reach people who are NOT here.
        let here = crate::checkin::arrived_ids(app, &app.state::<crate::checkin::CheckinState>());
        roster
            .into_iter()
            .filter(|(id, _)| here.contains(id))
            .map(|(id, name)| Recipient { id, name })
            .collect()
    } else {
        roster
            .into_iter()
            .filter(|(id, _)| recipient_ids.contains(id))
            .map(|(id, name)| Recipient { id, name })
            .collect()
    };
    if recipients.is_empty() {
        return Err(if recipient_ids.is_empty() {
            "nobody is checked in, so a page to \"everyone here\" has no one to reach — pick people by name to page them anyway".into()
        } else {
            "no approved crew to page — approve someone under Settings → Crew".into()
        });
    }

    let page = Page {
        id: pages.next_id.fetch_add(1, Ordering::Relaxed),
        from,
        body,
        recipients,
        buzz,
        sent_ms: now_ms(),
        receipts: Vec::new(),
    };
    {
        let mut h = pages.pages.lock().unwrap_or_else(|p| p.into_inner());
        if h.len() >= HISTORY_CAP {
            h.pop_front();
        }
        h.push_back(page.clone());
    }
    app.emit("page:new", &page).ok();
    push_page(app, &page, &page.recipients.iter().map(|r| r.id.clone()).collect::<Vec<_>>());
    if page.buzz {
        spawn_rebuzz(app, pages, page.id);
    }
    Ok(page)
}

/// Whether another buzz is owed. Split out so the stop conditions are testable
/// without waiting two real minutes.
fn should_rebuzz(elapsed_ms: u64, waiting: usize) -> bool {
    waiting > 0 && elapsed_ms < BUZZ_WINDOW_MS
}

/// Repeat the page to whoever still hasn't confirmed. Stops the moment the last
/// person acks — a phone that already confirmed must never buzz again.
fn spawn_rebuzz(app: &AppHandle, pages: &PagesState, page_id: u64) {
    let app = app.clone();
    let pages = pages.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(BUZZ_INTERVAL_SECS)).await;
            let snapshot = {
                let h = pages.pages.lock().unwrap_or_else(|p| p.into_inner());
                h.iter().find(|p| p.id == page_id).cloned()
            };
            let Some(page) = snapshot else { return };
            let waiting: Vec<String> = page
                .recipients
                .iter()
                .filter(|r| !page.receipts.iter().any(|x| x.user_id == r.id))
                .map(|r| r.id.clone())
                .collect();
            if !should_rebuzz(now_ms().saturating_sub(page.sent_ms), waiting.len()) {
                return;
            }
            app.emit("page:new", &page).ok();
            push_page(&app, &page, &waiting);
        }
    });
}

/// Push notification for a page. Title is ALWAYS "ProDeck · Page" and never the
/// message itself (design S07b) — a lock screen in a service is public, and the
/// body already carries the sender and text.
fn push_page(app: &AppHandle, page: &Page, to: &[String]) {
    if to.is_empty() {
        return;
    }
    let first = page.from.split_whitespace().next().unwrap_or("Booth");
    crate::push::notify(
        app,
        to.to_vec(),
        json!({
            "title": "ProDeck · Page",
            "body": format!("{first}: {}", page.body),
            // Same tag per page so a re-buzz replaces rather than stacks.
            "tag": format!("page-{}", page.id),
            "page": true,
            // The service worker needs this to confirm from the lock screen
            // without opening the app (S07b "Got it").
            "pageId": page.id,
            "url": "/",
        }),
    );
}

/// Record a confirm. Idempotent: a phone that acks twice (retry, double-tap)
/// keeps its first, honest timestamp rather than moving it later.
pub fn ack_core(
    app: &AppHandle,
    pages: &PagesState,
    identity: &IdentityState,
    page_id: u64,
    session: &str,
) -> Result<Receipt, String> {
    let (user_id, name) = crate::identity::session_user(identity, session)
        .ok_or("not signed in — a page can only be confirmed by an approved device")?;

    let mut h = pages.pages.lock().unwrap_or_else(|p| p.into_inner());
    let (receipt, read, of, is_new) = record_receipt(&mut h, page_id, &user_id, &name)?;
    drop(h);
    // Only a genuinely new confirm is worth waking the sender's screen for.
    if is_new {
        app.emit(
            "page:receipt",
            json!({
                "pageId": page_id,
                "userId": receipt.user_id,
                "name": receipt.name,
                "readMs": receipt.read_ms,
                "read": read,
                "of": of,
            }),
        )
        .ok();
    }
    Ok(receipt)
}

/// The receipt bookkeeping, free of AppHandle so it can be tested directly.
/// Returns (receipt, read count, recipient count, whether this ack was new).
fn record_receipt(
    pages: &mut VecDeque<Page>,
    page_id: u64,
    user_id: &str,
    name: &str,
) -> Result<(Receipt, usize, usize, bool), String> {
    let page = pages
        .iter_mut()
        .find(|p| p.id == page_id)
        .ok_or("that page is no longer active")?;
    if !page.recipients.iter().any(|r| r.id == user_id) {
        return Err("this page wasn't sent to you".into());
    }
    // Idempotent: a retry or double-tap keeps the FIRST timestamp. Moving it
    // later would quietly inflate how long someone took to respond.
    if let Some(existing) = page.receipts.iter().find(|r| r.user_id == user_id) {
        return Ok((
            existing.clone(),
            page.receipts.len(),
            page.recipients.len(),
            false,
        ));
    }
    let receipt = Receipt {
        user_id: user_id.to_string(),
        name: name.to_string(),
        read_ms: now_ms(),
    };
    page.receipts.push(receipt.clone());
    Ok((
        receipt,
        page.receipts.len(),
        page.recipients.len(),
        true,
    ))
}

/// Re-fire a page at whoever hasn't confirmed. Emits the same "page:new" shape;
/// phones that already acked ignore it, so only the waiting set buzzes again.
pub fn rebuzz_core(app: &AppHandle, pages: &PagesState, page_id: u64) -> Result<usize, String> {
    let h = pages.pages.lock().unwrap_or_else(|p| p.into_inner());
    let page = h
        .iter()
        .find(|p| p.id == page_id)
        .ok_or("that page is no longer active")?
        .clone();
    drop(h);
    let waiting = page
        .recipients
        .iter()
        .filter(|r| !page.receipts.iter().any(|x| x.user_id == r.id))
        .count();
    if waiting == 0 {
        return Ok(0);
    }
    app.emit("page:new", &page).ok();
    // Only the people who haven't confirmed get buzzed again.
    let unread: Vec<String> = page
        .recipients
        .iter()
        .filter(|r| !page.receipts.iter().any(|x| x.user_id == r.id))
        .map(|r| r.id.clone())
        .collect();
    push_page(app, &page, &unread);
    Ok(waiting)
}

pub fn list_core(pages: &PagesState) -> Vec<Page> {
    pages
        .pages
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .cloned()
        .collect()
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn page_send(
    from: String,
    body: String,
    recipients: Vec<String>,
    buzz: bool,
    pages: tauri::State<'_, PagesState>,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> Result<Page, String> {
    send_core(
        &app,
        pages.inner(),
        identity.inner(),
        from,
        body,
        recipients,
        buzz,
    )
}

#[tauri::command]
pub fn page_ack(
    page_id: u64,
    session: String,
    pages: tauri::State<'_, PagesState>,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> Result<Receipt, String> {
    ack_core(&app, pages.inner(), identity.inner(), page_id, &session)
}

#[tauri::command]
pub fn page_rebuzz(
    page_id: u64,
    pages: tauri::State<'_, PagesState>,
    app: AppHandle,
) -> Result<usize, String> {
    rebuzz_core(&app, pages.inner(), page_id)
}

#[tauri::command]
pub fn page_list(pages: tauri::State<'_, PagesState>) -> Vec<Page> {
    list_core(pages.inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page_with(recipients: &[(&str, &str)]) -> VecDeque<Page> {
        let mut q = VecDeque::new();
        q.push_back(Page {
            id: 1,
            from: "Zach".into(),
            body: "Need you in the booth".into(),
            recipients: recipients
                .iter()
                .map(|(id, name)| Recipient {
                    id: (*id).into(),
                    name: (*name).into(),
                })
                .collect(),
            buzz: true,
            sent_ms: now_ms(),
            receipts: Vec::new(),
        });
        q
    }

    #[test]
    fn ack_is_idempotent_and_keeps_the_first_timestamp() {
        let mut q = page_with(&[("u1", "Sam")]);
        let (first, _, _, new1) = record_receipt(&mut q, 1, "u1", "Sam").unwrap();
        assert!(new1, "the first ack is new");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let (again, read, of, new2) = record_receipt(&mut q, 1, "u1", "Sam").unwrap();
        assert!(!new2, "a repeat ack must not count as new");
        assert_eq!(again.read_ms, first.read_ms, "must keep the original time");
        assert_eq!((read, of), (1, 1), "must not double-count the reader");
    }

    // A page is addressed to a concrete set; anyone else confirming it would
    // put a stranger's name in the sender's READ column.
    #[test]
    fn a_non_recipient_cannot_ack() {
        let mut q = page_with(&[("u1", "Sam")]);
        let err = record_receipt(&mut q, 1, "u2", "Marcus").unwrap_err();
        assert!(err.contains("wasn't sent to you"), "got: {err}");
        assert_eq!(q[0].receipts.len(), 0, "nothing may be recorded");
    }

    #[test]
    fn unknown_page_is_an_error_not_a_silent_success() {
        let mut q = page_with(&[("u1", "Sam")]);
        assert!(record_receipt(&mut q, 99, "u1", "Sam").is_err());
    }

    #[test]
    fn buzz_stops_when_everyone_has_confirmed() {
        assert!(should_rebuzz(1_000, 2), "still waiting inside the window");
        assert!(!should_rebuzz(1_000, 0), "nobody left to buzz");
    }

    #[test]
    fn buzz_stops_after_the_two_minute_window() {
        assert!(should_rebuzz(BUZZ_WINDOW_MS - 1, 1));
        assert!(
            !should_rebuzz(BUZZ_WINDOW_MS, 1),
            "an unanswered page must not buzz a pocket all morning"
        );
    }

    #[test]
    fn read_count_tracks_the_waiting_set() {
        let mut q = page_with(&[("u1", "Sam"), ("u2", "Marcus"), ("u3", "Jean")]);
        let (_, read, of, _) = record_receipt(&mut q, 1, "u2", "Marcus").unwrap();
        assert_eq!((read, of), (1, 3));
        let waiting: Vec<_> = q[0]
            .recipients
            .iter()
            .filter(|r| !q[0].receipts.iter().any(|x| x.user_id == r.id))
            .map(|r| r.name.clone())
            .collect();
        assert_eq!(waiting, vec!["Sam", "Jean"]);
    }
}
