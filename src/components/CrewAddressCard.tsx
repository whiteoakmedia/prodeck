import { useEffect, useState } from "react";
import { crewCloudRename, crewCloudRetry, crewCloudStatus, on, type CrewCloudStatus, type Settings } from "../lib/tauri";
import { nameProblem } from "../../local-edge/src/names";

// Settings, Crew & screens: the crew address (<name>.crew.prodeck.live,
// src-tauri/src/crewcloud.rs). On for every booth unless switched off here.
// The switch is part of the page's form (Save applies it), like Comms.

function ago(ms: number): string {
  if (!ms) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  return new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function CrewAddressCard({ form, set }: { form: Settings; set: (on: boolean) => void }) {
  const [st, setSt] = useState<CrewCloudStatus | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, tick] = useState(0);

  useEffect(() => {
    crewCloudStatus().then(setSt).catch(() => {});
    const un = on<CrewCloudStatus>("crewcloud:status", (s) => s && setSt(s));
    const iv = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      un.then((f) => f());
      clearInterval(iv);
    };
  }, []);

  const run = async (f: () => Promise<CrewCloudStatus>) => {
    setBusy(true);
    setErr("");
    try {
      setSt(await f());
      setRename(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = form.crew_cloud !== false;
  const url = st?.url || form.crew_url || "";
  const chip = !enabled
    ? { cls: "", text: "off" }
    : st?.linked
      ? { cls: "online", text: "linked" }
      : st?.phase === "error"
        ? { cls: "warn", text: "trouble" }
        : { cls: "", text: "starting" };
  const problem = rename !== null ? nameProblem(rename) : "";

  return (
    <section className="card">
      <div className="card-head">
        <h3 id="set-crewaddr">Crew address</h3>
        <span className={`chip ${chip.cls}`}>{chip.text}</span>
      </div>
      <label className="field check">
        <input type="checkbox" checked={enabled} onChange={(e) => set(e.target.checked)} />
        <span>Let the crew reach ProDeck from anywhere, and see the week while this computer is off</span>
      </label>
      <p className="muted small">
        Phones open your crew address from home or on cellular and get the live booth while ProDeck is open. With this
        computer off, they still see the last plan, checklists and team chat it sent, and anything they tick or send
        waits for the booth. Nothing to set up: no port forwarding, no domain. Comms and camera feeds stay on the church
        Wi-Fi. Press Save to apply.
      </p>
      {enabled && (
        <>
          {url ? (
            <p style={{ margin: "6px 0" }}>
              <code className="kiosk-url">{url}</code>
            </p>
          ) : (
            <p className="muted small">Getting your address</p>
          )}
          <p className="muted small">
            {st?.linked ? "Linked: phones away from church reach the live booth." : "Not linked right now."} Last copy
            sent {ago(st?.last_sync_ms ?? 0)}. Crew links and the poster keep using this computer's own address; a phone
            moves to the crew address by itself when it can't reach the booth.
          </p>
          {st?.error && (
            <div className="hint">
              <p style={{ margin: 0 }}>{st.error}</p>
              <button className="btn small" disabled={busy} style={{ marginTop: 6 }} onClick={() => void run(crewCloudRetry)}>
                {busy ? "Trying" : "Try again"}
              </button>
            </div>
          )}
          {!form.local_name &&
            (rename === null ? (
              <button className="btn ghost small" disabled={busy} onClick={() => setRename(st?.name || form.crew_name || "")}>
                Change the name
              </button>
            ) : (
              <div style={{ marginTop: 6 }}>
                <div className="local-name-row">
                  <input
                    className="input"
                    value={rename}
                    maxLength={32}
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => setRename(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  />
                  <span className="local-suffix">.crew.prodeck.live</span>
                </div>
                {problem && <p className="small local-name-bad">{problem}</p>}
                <div className="kiosk-actions">
                  <button className="btn small primary" disabled={busy || !!problem} onClick={() => void run(() => crewCloudRename(rename))}>
                    {busy ? "Saving" : "Use this name"}
                  </button>
                  <button className="btn small ghost" disabled={busy} onClick={() => setRename(null)}>
                    Cancel
                  </button>
                </div>
                <p className="muted small">Phones learn the new address the next time they reach the booth.</p>
              </div>
            ))}
          {form.local_name && (
            <p className="muted small">Uses the same name as your secure local address.</p>
          )}
          <details className="small muted" style={{ marginTop: 8 }}>
            <summary>What leaves the building</summary>
            <p>
              A copy of this week's plan as ProDeck shows it (songs, keys, leaders, times, who's on and their positions,
              call times and position guides), your checklists, crew names and roles, and team chat.
              It's kept by White Oak Media on Cloudflare for your crew to read. Passwords never leave as they are: only a
              scrambled form that can check one but not reveal it. Planning Center sign in details stay on this computer.
              While linked, what phones ask the booth passes through on its way, and isn't kept. Turn this off and the
              copy is deleted.
            </p>
          </details>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
