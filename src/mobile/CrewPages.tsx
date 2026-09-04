import { useEffect, useState } from "react";
import { usePages } from "../pagesStore";
import { usePco, isDeclined } from "../pcoStore";
import { IS_WEB, identityList, checkinList, type CrewPage, type CrewUser } from "../lib/tauri";
import { CREW_SESSION_KEY } from "../chatStore";
import { buzz, pageTone } from "../lib/sound";

// S06a / S06b / S07a — pages (design/mobile/README.md).

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hhmmss = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
const secsSince = (ms: number) => Math.max(0, Math.round((Date.now() - ms) / 1000));
const elapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/** Re-render once a second so mono elapsed counters actually count. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const iv = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [on]);
}

// ---------------------------------------------------------------- S07a
// Full takeover. Confirming is the ONLY exit — no dismiss, no snooze — so this
// renders above everything and swallows the screen until the booth records the
// ack. The confirm target is the largest control in the app and needs no aim.
export function CrewPageTakeover() {
  const { incoming, ack, acking, error } = usePages();
  useTick(!!incoming);
  // A page RINGS while it's on screen — siren tone + (Android) heavy buzz
  // every 1.8s until confirmed. Deliberately ignores the chat sound toggle:
  // pages are the emergency channel; the phone's silent switch still has
  // final say. (iPhones can't vibrate from the page — their physical buzz
  // comes from the push notification; the louder tone is the in-app punch.)
  useEffect(() => {
    if (!incoming) return;
    ring();
    const iv = setInterval(ring, 1800);
    function ring() {
      pageTone();
      buzz([600, 120, 600, 120, 1000]);
    }
    return () => clearInterval(iv);
  }, [incoming?.id]);
  // Mounted app-wide, not just in the phone shell: a tablet or a full-size
  // browser renders the DESKTOP shell, and a page that only appears under 760px
  // silently misses every one of them.
  //
  // Guarded on having a crew session, because confirming is the only way out of
  // this screen and only a signed-in device can ack. Showing it where an ack is
  // impossible (the booth app, a signed-out browser) would black out the app
  // with no way back.
  const canAck = IS_WEB && !!localStorage.getItem(CREW_SESSION_KEY);
  if (!incoming || !canAck) return null;
  return (
    <div className="crew-takeover">
      <div className="crew-takeover-head">
        <span className="pulse-dot" style={{ background: "var(--warn)" }} />
        <span className="mono" style={{ color: "var(--warn)" }}>
          Page · {hhmm(incoming.sent_ms)}
        </span>
      </div>
      <p className="crew-takeover-body">{incoming.body}</p>
      <div className="crew-takeover-from">
        <span className="crew-avatar warn">{initials(incoming.from)}</span>
        <div>
          <div className="crew-takeover-name">{incoming.from}</div>
          <div className="crew-takeover-sub">
            {incoming.buzz ? "Booth · buzzing until you confirm" : "Booth"}
          </div>
        </div>
      </div>
      <button
        className="crew-confirm"
        disabled={acking}
        onClick={() => ack(incoming.id).catch(() => {})}
      >
        <span className="crew-confirm-tick">✓</span>
        <span className="crew-confirm-label">{acking ? "Sending…" : "Got it"}</span>
      </button>
      {error ? (
        <p className="crew-takeover-hint err">{error} — try again.</p>
      ) : (
        <p className="crew-takeover-hint">Tap anywhere in the green to confirm</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- S06a
// Composer. Presets exist because most pages are one of five phrases and
// typing one-handed mid-service is the failure mode. The count on the send
// button is the last chance to catch a mis-selected recipient set.
const PRESETS = ["Standby", "Go to black", "Mic check", "Cam 2 hot"];

export function CrewPageComposer({
  onClose,
  preset,
}: {
  onClose: () => void;
  // Pre-filled from the leader board's Nudge, so chasing a no-show is one tap
  // rather than retyping their name mid-service.
  preset?: { recipientId?: string; body?: string };
}) {
  const { send } = usePages();
  const pco = usePco();
  const [body, setBody] = useState(preset?.body ?? "");
  const [scope, setScope] = useState<"person" | "role" | "everyone">(
    preset?.recipientId ? "person" : "everyone",
  );
  const [role, setRole] = useState("");
  const [picked, setPicked] = useState<string[]>(
    preset?.recipientId ? [preset.recipientId] : [],
  );
  const [buzz, setBuzz] = useState(true);
  const [roster, setRoster] = useState<CrewUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The pageable universe is people RELEVANT TO THIS SUNDAY: checked in for
  // the current service, or on this week's PCO plan. Every account ever
  // created is behind an explicit toggle — a broadcast must never buzz
  // someone whose last serve was in March. A Nudge preset names one specific
  // person, so it starts with the full roster visible.
  const [here, setHere] = useState<Set<string> | null>(null);
  const [includeAll, setIncludeAll] = useState(!!preset?.recipientId);

  useEffect(() => {
    identityList()
      .then((u) => setRoster(u.filter((x) => x.approved)))
      .catch((e) => setErr(String(e)));
    checkinList("")
      .then((sheet: any) => setHere(new Set(Object.keys(sheet?.at ?? {}))))
      .catch(() => setHere(new Set()));
  }, []);

  const isHere = (id: string) => here === null || here.has(id);
  // Same normalized-name matching the call-time nudge uses, honoring the
  // healed PCO spelling when one exists.
  const normN = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  const scheduledNames = new Set(
    pco.team.filter((m) => !isDeclined(m.status)).map((m) => normN(m.name)),
  );
  const isScheduled = (u: CrewUser) =>
    scheduledNames.has(normN((u as any).pco_name || u.name));
  const relevant = (u: CrewUser) => includeAll || isHere(u.id) || isScheduled(u);

  const universe = roster.filter(relevant);
  const roles = Array.from(new Set(universe.map((u) => u.role).filter(Boolean))).sort();
  const inRole = universe.filter((u) => u.role === role).map((u) => u.id);
  // Always send explicit ids: the default universe (here ∪ scheduled) is wider
  // than the server's empty-recipients path (checked-in only), which stays as
  // the strict fallback for one-button senders like the Stream Deck.
  const everyoneIds = universe.map((u) => u.id);
  const recipients =
    scope === "everyone" ? everyoneIds : scope === "role" ? inRole : picked;
  const count =
    scope === "everyone" ? everyoneIds.length : scope === "role" ? inRole.length : picked.length;
  const othersCount = roster.length - roster.filter((u) => isHere(u.id) || isScheduled(u)).length;

  async function go() {
    setBusy(true);
    setErr("");
    try {
      await send(body, recipients, buzz);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crew-sheet">
      <header className="crew-sheet-head">
        <button className="crew-sheet-cancel" onClick={onClose}>
          Cancel
        </button>
        <span className="crew-sheet-title">Send a page</span>
        <span style={{ width: 54 }} />
      </header>

      <textarea
        className="crew-page-field"
        placeholder="What do they need to do?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <div className="crew-presets">
        {PRESETS.map((p) => (
          <button key={p} className="crew-preset" onClick={() => setBody(p)}>
            {p}
          </button>
        ))}
      </div>

      <span className="mono crew-sheet-label">Recipients</span>
      <div className="crew-seg">
        {(["person", "role", "everyone"] as const).map((t) => (
          <button
            key={t}
            className={`crew-seg-btn ${scope === t ? "on" : ""}`}
            onClick={() => setScope(t)}
          >
            {t === "person" ? "Person" : t === "role" ? "Role" : includeAll ? "Everyone" : "This Sunday"}
          </button>
        ))}
      </div>

      <label className="crew-away-toggle">
        <input
          type="checkbox"
          checked={includeAll}
          onChange={(e) => setIncludeAll(e.target.checked)}
        />
        <span>
          Include people not here or on this week&apos;s plan
          {!includeAll && othersCount > 0 && ` (${othersCount} more)`}
        </span>
      </label>

      {scope === "role" && (
        <div className="crew-recips">
          {roles.length === 0 ? (
            <p className="crew-hint muted">
              No roles set yet — give people a role under Settings → Crew.
            </p>
          ) : (
            roles.map((r) => {
              const on = role === r;
              const n = universe.filter((u) => u.role === r).length;
              return (
                <button
                  key={r}
                  className={`crew-recip ${on ? "on" : ""}`}
                  onClick={() => setRole(on ? "" : r)}
                >
                  <span className={`crew-check ${on ? "on" : ""}`}>{on ? "✓" : ""}</span>
                  <span className="crew-recip-name">{r}</span>
                  <span className="mono-data crew-recip-seen">
                    {n} {includeAll ? "with accounts" : "here or scheduled"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {scope === "person" && (
        <div className="crew-recips">
          {universe.length === 0 && (
            <p className="crew-hint muted">
              No approved crew yet — approve someone under Settings → Crew.
            </p>
          )}
          {universe.map((u) => {
            const on = picked.includes(u.id);
            return (
              <button
                key={u.id}
                className={`crew-recip ${on ? "on" : ""}`}
                onClick={() =>
                  setPicked((p) => (on ? p.filter((x) => x !== u.id) : [...p, u.id]))
                }
              >
                <span className={`crew-check ${on ? "on" : ""}`}>{on ? "✓" : ""}</span>
                <span className="crew-recip-name">{u.name}</span>
                {u.last_seen_ms > 0 && (
                  <span className="mono-data crew-recip-seen">
                    seen {hhmm(u.last_seen_ms)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="crew-buzz">
        <div>
          <div className="crew-buzz-title">Buzz until read</div>
          <div className="crew-buzz-sub">Re-fires to whoever hasn't confirmed</div>
        </div>
        <button
          className={`crew-toggle ${buzz ? "on" : ""}`}
          role="switch"
          aria-checked={buzz}
          onClick={() => setBuzz((v) => !v)}
        >
          <span className="crew-toggle-knob" />
        </button>
      </div>

      {err && <p className="crew-join-err">{err}</p>}

      <button
        className="crew-send-page"
        disabled={busy || !body.trim() || count === 0}
        onClick={go}
      >
        {busy ? "Sending…" : `Send page to ${count}`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- S06b
// Read tracking. WAITING sits above READ because the unresolved half is why
// the operator opened this screen at all.
export function CrewPageTracking({ page, onClose }: { page: CrewPage; onClose: () => void }) {
  const { rebuzz } = usePages();
  const [roster, setRoster] = useState<CrewUser[]>([]);
  const [msg, setMsg] = useState("");
  useTick(true);

  useEffect(() => {
    identityList()
      .then(setRoster)
      .catch(() => {});
  }, []);

  const read = page.receipts;
  const waiting = page.recipients.filter((r) => !read.some((x) => x.user_id === r.id));
  const pct = page.recipients.length
    ? Math.round((read.length / page.recipients.length) * 100)
    : 0;
  const lastSeen = (id: string) => roster.find((u) => u.id === id)?.last_seen_ms ?? 0;

  return (
    <div className="crew-sheet">
      <header className="crew-sheet-head">
        <span style={{ width: 54 }} />
        <span className="crew-sheet-title">Page · {hhmm(page.sent_ms)}</span>
        <button className="crew-sheet-cancel" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="crew-card edge">
        <p className="crew-quote">{page.body}</p>
        <div className="crew-quote-meta">
          <span className="mono-data">
            {read.length} of {page.recipients.length} read
          </span>
          <span className="mono-data" style={{ color: "var(--dim)" }}>
            {elapsed(secsSince(page.sent_ms))} elapsed
          </span>
        </div>
        <div className="crew-progress">
          <div className="crew-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {waiting.length > 0 && (
        <>
          <span className="mono crew-sheet-label">Waiting</span>
          {waiting.map((r) => (
            <div key={r.id} className="crew-wait-row edge-warn">
              <span className="pulse-dot" style={{ background: "var(--warn)" }} />
              <div className="crew-recip-name">
                {r.name}
                {lastSeen(r.id) > 0 && (
                  <span className="mono-data crew-recip-seen">
                    last seen {hhmm(lastSeen(r.id))}
                  </span>
                )}
              </div>
              <span className="mono-data" style={{ color: "var(--warn)" }}>
                {elapsed(secsSince(page.sent_ms))}
              </span>
            </div>
          ))}
        </>
      )}

      {read.length > 0 && (
        <>
          <span className="mono crew-sheet-label">Read</span>
          {read.map((r) => (
            <div key={r.user_id} className="crew-read-row">
              <span className="crew-check on green">✓</span>
              <span className="crew-recip-name">{r.name}</span>
              <span className="mono-data" style={{ color: "var(--success)" }}>
                {hhmmss(r.read_ms)} · {elapsed(Math.round((r.read_ms - page.sent_ms) / 1000))}
              </span>
            </div>
          ))}
        </>
      )}

      {msg && <p className="crew-hint muted">{msg}</p>}

      {waiting.length > 0 && (
        <button
          className="crew-rebuzz"
          onClick={() =>
            rebuzz(page.id)
              .then((n) => setMsg(`Re-buzzed ${n}.`))
              .catch((e) => setMsg(String(e)))
          }
        >
          Re-buzz {waiting.length}
        </button>
      )}
    </div>
  );
}
