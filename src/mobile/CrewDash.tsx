import { useProDeck } from "../store";
import { usePco } from "../pcoStore";
import { ListenWidget } from "../widgets/registry";

// S10 — Dashboard on a phone.
//
// Deliberately NOT the desktop dashboard. That one is a freeform grid arranged
// for a 27" screen; rendered on a phone it becomes an endless scroll of widgets
// sized for a desk. This is a fixed, curated set — order of service, sound
// level, and Listen — and it is not editable. A dashboard you can rearrange
// one-handed mid-service is a dashboard you can break one-handed mid-service.
//
// Camera feeds are deliberately absent: the NDI MJPEG streams live on separate
// LAN-only ports and are never tunnelled (video would eat the church's upstream
// and starve chat and pages).

const fmtLen = (sec: number) => {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

// The bar spans 40–100 dB SPL — the range a booth actually thinks in.
const splPct = (spl: number) => Math.max(0, Math.min(100, ((spl - 40) / 60) * 100));
// Below this dBFS the input is effectively silent (console off / quiet room):
// show "quiet" rather than a floor number — "−100 dB" on a phone reads as broken.
const QUIET_DBFS = -85;

export function CrewDash() {
  const { audioDb, audioPeakDb, audioRunning, splCalibration } = useProDeck();
  const pco = usePco();
  // Same calibrated scale as the booth's big SPL readout, not raw dBFS.
  const spl = audioDb + splCalibration;
  const splPeak = audioPeakDb + splCalibration;
  const quiet = audioDb <= QUIET_DBFS;

  const liveIdx = pco.items.findIndex((i) => i.id === pco.liveItemId);

  return (
    <div className="crew-page">
      <h1 className="crew-title">Dashboard</h1>

      {/* Sound level */}
      <div className="crew-card edge">
        <div className="crew-row-head">
          <span className="mono" style={{ color: "var(--dim)" }}>Sound level</span>
          <span
            className="mono-data crew-count-of"
            style={{ color: audioRunning ? "var(--success)" : "var(--dim)" }}
          >
            {!audioRunning ? "not measuring" : quiet ? "quiet" : "measuring"}
          </span>
        </div>
        <div className="crew-spl">
          {audioRunning && !quiet ? Math.round(spl) : "—"}
          <small> dB SPL</small>
        </div>
        <div className="crew-progress">
          <div
            className="crew-progress-fill accent"
            style={{ width: `${audioRunning && !quiet ? splPct(spl) : 0}%` }}
          />
        </div>
        <div className="crew-hint muted">
          {audioRunning && !quiet
            ? `peak ${Math.round(splPeak)} dB SPL`
            : audioRunning
              ? "Room is quiet — the meter wakes with the console."
              : "The booth isn't measuring right now."}
        </div>
      </div>

      {/* Overflow Listen — the existing widget, unchanged. It uses a plain
          <audio> element so iOS routes it through the media channel. */}
      <div className="crew-card edge">
        <span className="mono" style={{ color: "var(--dim)" }}>Overflow listen</span>
        <div style={{ marginTop: 8 }}>
          <ListenWidget />
        </div>
      </div>

      {/* Order of service, straight from Planning Center */}
      <div className="crew-card edge">
        <div className="crew-row-head">
          <span className="mono" style={{ color: "var(--dim)" }}>Order of service</span>
          {pco.items.length > 0 && (
            <span className="mono-data crew-count-of">{pco.items.length} items</span>
          )}
        </div>

        {pco.items.length === 0 ? (
          <p className="crew-hint muted">No plan loaded at the booth.</p>
        ) : (
          <div className="crew-order">
            {pco.items.map((it, i) =>
              it.type === "header" ? (
                <div key={it.id} className="crew-order-head mono">
                  {it.title}
                </div>
              ) : (
                <div
                  key={it.id}
                  className={`crew-order-row ${it.id === pco.liveItemId ? "live" : ""} ${
                    liveIdx >= 0 && i < liveIdx ? "past" : ""
                  }`}
                >
                  <span className={`crew-order-dot ${it.type}`} />
                  <span className="crew-order-title">
                    {it.title}
                    {/* Songs answer the next three questions inline: who
                        leads, what key, which mic. */}
                    {it.type === "song" && (it.leader || it.key) && (
                      <span className="crew-order-sub mono-data">
                        {[
                          it.leader,
                          it.key ? `key ${it.key}` : "",
                          it.leader && pco.micForLeader(it.leader)
                            ? `mic ${pco.micForLeader(it.leader)}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  {it.id === pco.liveItemId && <span className="crew-order-now mono">Now</span>}
                  <span className="mono-data crew-order-len">{fmtLen(it.length)}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <p className="crew-hint muted">
        Camera feeds stay on the booth network — they aren't sent outside the building.
      </p>
    </div>
  );
}
