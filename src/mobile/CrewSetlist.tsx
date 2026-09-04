import { useState } from "react";
import { usePco, chartPdfFor, type PlanItem } from "../pcoStore";
import { pcoAttachmentOpen } from "../lib/tauri";
import { isAudioFile, playTrack } from "../lib/trackPlayer";
import { ChartSheet } from "./ChartSheet";

// The worship view: songs only, keys HUGE, leader and notes underneath, and
// every PCO attachment (chord chart, lead sheet) one tap away. Opens as a
// full sheet from the Home card — glanceable from a music stand.
//
// Deliberately no BPM (nobody plays tempo off a number) and no controls:
// this screen is read-only reference, so nothing can be fired by accident.

export function CrewSetlist({ onClose }: { onClose: () => void }) {
  const pco = usePco();
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");
  const [chartFor, setChartFor] = useState<PlanItem | null>(null);
  const songs = pco.items.filter((i) => i.type === "song");
  const liveId = pco.liveItemId;

  async function openChart(att: { id: string; name: string }) {
    setBusyId(att.id);
    setErr("");
    // Documents need their tab opened BEFORE any await — Safari kills
    // window.open calls that aren't in the direct tap call stack. Audio
    // never leaves the app: it goes to the in-app player.
    const audio = isAudioFile(att.name);
    const tab = audio ? null : window.open("about:blank", "_blank");
    try {
      // Generated charts only exist as PCO web pages (login-gated there).
      const url = (att as any).webUrl ?? (await pcoAttachmentOpen(att.id));
      if (audio) playTrack(url, att.name);
      else if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setErr(String(e));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="crew-sheet crew-guide-sheet" onClick={onClose}>
      <div className="crew-guide-body" onClick={(e) => e.stopPropagation()}>
        <div className="crew-row-head">
          <span className="crew-buzz-title">Setlist</span>
          <span className="mono-data crew-count-of">{songs.length} songs</span>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {songs.length === 0 && (
          <p className="crew-hint muted">No songs on this week's plan yet.</p>
        )}
        {songs.map((s: PlanItem, i: number) => {
          const files = (s.attachments ?? []).filter((a: any) => !a.webUrl);
          // The band's real chart: MultiTracks PDF when the song has one,
          // else the in-app renderer from PCO chord text. The PDF doesn't
          // repeat as an ordinary chip below.
          const chartPdf = chartPdfFor(files);
          const others = files.filter((a) => a.id !== chartPdf?.id);
          return (
            <div key={s.id} className={`crew-setlist-song ${s.id === liveId ? "live" : ""}`}>
              <div className="crew-setlist-row">
                <span className="crew-setlist-num mono-data">{i + 1}</span>
                <span className="crew-setlist-title">{s.title}</span>
                {s.key && <span className="crew-setlist-key">{s.key}</span>}
              </div>
              {(s.leader || s.id === liveId) && (
                <div className="crew-setlist-sub mono-data">
                  {s.id === liveId ? "● NOW · " : ""}
                  {s.leader ? `${s.leader} leads` : ""}
                </div>
              )}
              <div className="crew-setlist-charts">
                {chartPdf ? (
                  <button
                    className="crew-chart-btn crew-chart-primary"
                    disabled={busyId === chartPdf.id}
                    onClick={() => openChart(chartPdf)}
                  >
                    {busyId === chartPdf.id ? "Opening…" : `♪ Chart${s.key ? ` · ${s.key}` : ""}`}
                  </button>
                ) : s.songId && s.arrangementId ? (
                  <button className="crew-chart-btn crew-chart-primary" onClick={() => setChartFor(s)}>
                    ♪ Chart{s.key ? ` · ${s.key}` : ""}
                  </button>
                ) : null}
              </div>
              {others.length > 0 && (
                <div className="crew-setlist-charts">
                  {others.map((a) => (
                    <button
                      key={a.id}
                      className="crew-chart-btn"
                      disabled={busyId === a.id}
                      onClick={() => openChart(a)}
                    >
                      {busyId === a.id ? "Opening…" : `📄 ${a.name}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {err && <p className="crew-join-err">{err}</p>}
        {chartFor && (
          <ChartSheet
            songId={chartFor.songId!}
            arrangementId={chartFor.arrangementId!}
            title={chartFor.title}
            itemKey={chartFor.key}
            onClose={() => setChartFor(null)}
          />
        )}
      </div>
    </div>
  );
}
