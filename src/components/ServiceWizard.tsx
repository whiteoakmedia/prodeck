import { useEffect, useState } from "react";
import { deskControlSupported } from "../lib/consoles";
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

// Opened from Planning Center's Service setup button. It used to open by
// itself, full screen, on the booth's first launch each day; that was removed
// (Zach, 2026-11-09: "more harm than good").
export function ServiceWizard({ onClose }: { onClose: () => void }) {
  const pco = usePco();
  const [step, setStep] = useState(0);
  const [desk, setDesk] = useState<AvantisSnapshot | null>(null);
  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState("");
  // ProPresenter step: Next means "review & place" — advance happens after a
  // successful swap (or immediately if there's nothing to place).
  const [swapSignal, setSwapSignal] = useState(0);
  const [swapped, setSwapped] = useState(false);

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
      // Every write was individually swallowed and then the count reported
      // unconditionally — "Wrote 12 channel name(s)" even when all twelve
      // failed and the desk still had last week's names on it.
      let ok = 0;
      for (const p of namePlan) {
        for (const t of p.targets) {
          try {
            await avantisSetName(t, p.label);
            ok += 1;
          } catch {
            /* counted below */
          }
        }
      }
      setWrote(
        ok === total
          ? `Wrote ${total} channel name(s) to the desk.`
          : `Wrote ${ok} of ${total} channel name(s) — the desk refused the rest.`,
      );
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
        padding: "6vh 16px",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(720px, 100%)", maxHeight: "86vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
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

        {step === 0 && (
          <>
            <p className="muted small">
              Which service are we setting up today?
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              {pco.serviceTypes.map((st) => (
                <button
                  key={st.id}
                  className={`btn ${pco.selectedServiceTypeId === st.id ? "primary" : ""}`}
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
              disabled={writing || !desk || namePlan.length === 0 || !deskControlSupported(desk.model)}
              title={desk && !deskControlSupported(desk.model) ? "ProDeck can only watch a Yamaha desk for now, so it can't rename channels on it." : undefined}
              onClick={writeBoard}
            >
              {writing ? "Writing…" : "Write names to the board"}
            </button>
            {wrote && <p className="muted small">✓ {wrote}</p>}
          </>
        )}

        {step === 4 && (
          <>
            <h2>You're all set 🎉</h2>
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

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {step > 0 && step < STEPS.length - 1 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              ← Back
            </button>
          )}
          <span style={{ flex: 1 }} />
          {step < STEPS.length - 1 ? (
            <button
              className="btn primary"
              disabled={!canNext}
              onClick={() => {
                if (step === 1 && !swapped) setSwapSignal((n) => n + 1);
                else setStep(step + 1);
              }}
            >
              Next →
            </button>
          ) : (
            <button className="btn primary" onClick={onClose}>
              Done — let's go
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
