import { useEffect, useState } from "react";
import { usePco , isDeclined } from "../pcoStore";
import { avantisSetName, avantisState, on, type AvantisSnapshot } from "../lib/tauri";
import { MicSelect } from "./PcoBits";
import { askConfirm } from "../lib/dialogs";
import { ProSetlistSwap } from "./ProSetlistSwap";

// ---------------------------------------------------------------------------
// Service setup wizard — the Sunday-morning (or Youth-night) runbook as four
// guided steps: pick the service, swap the Pro setlist, confirm mics, write
// names to the desk. Every step is the SAME machinery as the standing cards
// (nothing wizard-only can drift out of sync); the wizard just walks it in
// order so setup never depends on remembering where each card lives.
// ---------------------------------------------------------------------------

const STEPS = ["Service", "ProPresenter", "Mics", "Board", "Done"] as const;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
const todayLine = () =>
  new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

export function ServiceWizard({
  onClose,
  locked = false,
}: {
  onClose: () => void;
  /** Startup mode: full-screen, no ✕, backdrop clicks ignored. The only ways
   *  out are finishing the runbook — or the owner's secret dismiss: hold
   *  SHIFT and press ↑ ↑ ↓ ↓ (resets on a wrong key or 3 s of silence).
   *  Deliberately undocumented in the UI. */
  locked?: boolean;
}) {
  const pco = usePco();
  const [step, setStep] = useState(0);
  const [desk, setDesk] = useState<AvantisSnapshot | null>(null);
  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState("");
  // ProPresenter step: Next means "review & place" — advance happens after a
  // successful swap (or immediately if there's nothing to place).
  const [swapSignal, setSwapSignal] = useState(0);
  const [swapped, setSwapped] = useState(false);

  // Secret dismiss for the locked startup wizard.
  useEffect(() => {
    if (!locked) return;
    const SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown"];
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.key !== SEQ[i]) {
        i = 0;
        return;
      }
      i += 1;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        i = 0;
      }, 3000);
      if (i === SEQ.length) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  useEffect(() => {
    avantisState()
      .then((s) => setDesk(s.connected ? s : null))
      .catch(() => {});
    const un = on<AvantisSnapshot>("avantis:state", (s) => setDesk(s.connected ? s : null));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const roster = pco.micRoster();
  const micUse: Record<string, number> = {};
  for (const m of roster) {
    if (isDeclined(m.status)) continue;
    const mic = pco.micFor(m.id, m.position).mic;
    if (mic) micUse[mic] = (micUse[mic] ?? 0) + 1;
  }
  const namePlan = pco.weeklyMicNames();

  async function writeBoard() {
    const total = namePlan.reduce((n, p) => n + p.targets.length, 0);
    const summary = namePlan.map((p) => `Mic ${p.mic} → ${p.label}`).join(" · ");
    if (!(await askConfirm(`Rename ${total} channels on the Avantis for this week?\n${summary}`)))
      return;
    setWriting(true);
    try {
      for (const p of namePlan) {
        for (const t of p.targets) {
          await avantisSetName(t, p.label).catch(() => {});
        }
      }
      setWrote(`Wrote ${total} channel name(s) to the desk.`);
    } finally {
      setWriting(false);
    }
  }

  const canNext =
    step !== 0 || (!!pco.selectedServiceTypeId && !!pco.selectedPlanId);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: locked ? 0 : "6vh 16px",
      }}
      onClick={locked ? undefined : onClose}
    >
      <div
        className="card"
        style={
          locked
            ? { width: "100vw", height: "100vh", maxHeight: "none", borderRadius: 0, overflowY: "auto", padding: "6vh 0 8vh" }
            : { width: "min(720px, 100%)", maxHeight: "86vh", overflowY: "auto" }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div style={locked ? { maxWidth: 860, margin: "0 auto", padding: "0 32px" } : undefined}>
        {locked ? (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 15, letterSpacing: 2, textTransform: "uppercase", color: "var(--accent-hi, #7cc4ff)", fontWeight: 700 }}>
              ProDeck · Service setup
            </div>
            <h1 style={{ fontSize: 40, margin: "6px 0 2px", fontWeight: 800 }}>{greeting()}.</h1>
            <p className="muted" style={{ fontSize: 17, margin: 0 }}>
              {todayLine()} — let's get the service ready. Four quick steps.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 26 }}>
              {STEPS.map((label, i) => (
                <div key={label} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 64 }}>
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 15,
                        background: i < step ? "var(--accent-hi, #7cc4ff)" : i === step ? "var(--accent-hi, #7cc4ff)" : "rgba(255,255,255,0.08)",
                        color: i <= step ? "#0b1220" : "var(--muted, #8a94a6)",
                        opacity: i === step ? 1 : i < step ? 0.85 : 1,
                        transition: "background .2s",
                      }}
                    >
                      {i < step ? "✓" : i + 1}
                    </div>
                    <span className={i === step ? "" : "muted"} style={{ fontSize: 13, fontWeight: i === step ? 700 : 400 }}>
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{ flex: 1, height: 2, margin: "0 8px 22px", background: i < step ? "var(--accent-hi, #7cc4ff)" : "rgba(255,255,255,0.1)" }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card-head">
            <h3>Service setup</h3>
            <span className="muted small" style={{ flex: 1 }}>
              {STEPS.map((s, i) => (
                <span key={s} style={{ marginRight: 10, opacity: i === step ? 1 : 0.45, fontWeight: i === step ? 700 : 400 }}>
                  {i + 1}. {s}
                </span>
              ))}
            </span>
            <button className="btn small ghost" onClick={onClose}>
              ✕
            </button>
          </div>
        )}

        {step === 0 && (
          <>
            <p className={locked ? "muted" : "muted small"} style={locked ? { fontSize: 16 } : undefined}>
              Which service are we setting up today?
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              {pco.serviceTypes.map((st) => (
                <button
                  key={st.id}
                  className={`btn ${pco.selectedServiceTypeId === st.id ? "primary" : ""}`}
                  style={locked ? { fontSize: 18, padding: "14px 26px" } : undefined}
                  onClick={() => pco.selectServiceType(st.id)}
                >
                  {st.name}
                </button>
              ))}
            </div>
            {pco.plans.length > 0 && (
              <div className="field-row" style={{ alignItems: "center" }}>
                <span style={{ width: 50 }}>Plan</span>
                <select
                  className="input"
                  value={pco.selectedPlanId ?? ""}
                  onChange={(e) => pco.selectPlan(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {pco.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.date ? `${p.date} — ${p.title}` : p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!pco.selectedPlanId && pco.selectedServiceTypeId && (
              <p className="muted small">Pick the plan for this service.</p>
            )}
          </>
        )}

        {step === 1 && (
          <ProSetlistSwap
            swapSignal={swapSignal}
            onSwapped={() => {
              setSwapped(true);
              setStep(2);
            }}
          />
        )}

        {step === 2 && (
          <>
            <p className="muted small">
              Who's on which mic this week. Assignments come from the standing
              template; change anyone who's different today. Red = two people
              on one mic.
            </p>
            {roster.length === 0 && (
              <p className="muted small">Nobody scheduled on this plan yet.</p>
            )}
            {roster.map((m) => {
              const info = pco.micFor(m.id, m.position);
              return (
                <div key={`${m.id}|${m.position}`} className="field-row" style={{ alignItems: "center", padding: "3px 0", gap: 8 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                  <span className="muted small" style={{ flex: 1 }}>
                    {m.position}
                  </span>
                  <MicSelect
                    value={info.mic}
                    count={pco.micCount}
                    fromTemplate={info.fromTemplate}
                    conflict={!!info.mic && (micUse[info.mic] ?? 0) > 1}
                    onChange={(mic) => pco.setMic(m.id, mic)}
                  />
                </div>
              );
            })}
          </>
        )}

        {step === 3 && (
          <>
            <p className="muted small">
              Stamp this week's names onto the Avantis — each mic's primary and
              mirror channel.
            </p>
            {!desk && (
              <p className="small" style={{ color: "var(--warn, #e6a23c)" }}>
                The desk isn't connected — names can't be written until the
                Avantis mirror is up.
              </p>
            )}
            {namePlan.length === 0 && (
              <p className="muted small">
                No mic assignments to write — set mics in the previous step.
              </p>
            )}
            {namePlan.map((p) => (
              <div key={p.mic} className="field-row" style={{ padding: "2px 0" }}>
                <span style={{ width: 70, fontWeight: 600 }}>Mic {p.mic}</span>
                <span>{p.label}</span>
                <span className="muted small" style={{ marginLeft: "auto" }}>
                  {p.targets.length} channel{p.targets.length === 1 ? "" : "s"}
                </span>
              </div>
            ))}
            <button
              className="btn primary"
              style={{ marginTop: 10 }}
              disabled={writing || !desk || namePlan.length === 0}
              onClick={writeBoard}
            >
              {writing ? "Writing…" : "Write names to the board"}
            </button>
            {wrote && <p className="muted small">✓ {wrote}</p>}
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={locked ? { fontSize: 26, marginTop: 0 } : undefined}>You're all set 🎉</h2>
            <p className="muted">Here's what's ready for today:</p>
            <ul className="muted small" style={{ lineHeight: 1.8 }}>
              <li>Service: {pco.serviceTypes.find((s) => s.id === pco.selectedServiceTypeId)?.name ?? "—"} · {pco.plans.find((p) => p.id === pco.selectedPlanId)?.date ?? ""}</li>
              <li>ProPresenter setlist swapped to this week's songs (your layout).</li>
              <li>Mics confirmed{wrote ? " and written to the desk." : " — remember the desk write if you skipped it."}</li>
            </ul>
            <p className="muted small">
              Every step can be re-run any time — the same controls live on the
              Planning Center tabs.
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: locked ? 30 : 14 }}>
          {step > 0 && step < STEPS.length - 1 && (
            <button className="btn" style={locked ? { fontSize: 16, padding: "12px 22px" } : undefined} onClick={() => setStep(step - 1)}>
              ← Back
            </button>
          )}
          <span style={{ flex: 1 }} />
          {step < STEPS.length - 1 ? (
            <button
              className="btn primary"
              style={locked ? { fontSize: 17, padding: "12px 34px" } : undefined}
              disabled={!canNext}
              onClick={() => {
                if (step === 1 && !swapped) setSwapSignal((n) => n + 1);
                else setStep(step + 1);
              }}
            >
              Next →
            </button>
          ) : (
            <button className="btn primary" style={locked ? { fontSize: 17, padding: "12px 34px" } : undefined} onClick={onClose}>
              Done — let's go
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
