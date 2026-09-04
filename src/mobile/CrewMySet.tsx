import { useState } from "react";
import { usePco, splitFilesFor, chartPdfFor, type PlanItem } from "../pcoStore";
import { pcoAttachmentOpen } from "../lib/tauri";
import { isAudioFile, playTrack } from "../lib/trackPlayer";
import { ChartSheet } from "./ChartSheet";

// "My Set" — the band member's Home section. Inline, no modal: every song
// with THIS position's files as tappable chips (chart in the scheduled key,
// their stem, the master…), capped so one busy song can't eat the screen,
// with the full file list one tap away. Which files are "theirs" comes from
// the booth's Files-by-position rules (or the built-in defaults).

const CAP = 4;

export function CrewMySet({ rule }: { rule: string[] | null }) {
  const pco = usePco();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");
  const [chartFor, setChartFor] = useState<PlanItem | null>(null);
  const songs = pco.items.filter((i) => i.type === "song");
  if (songs.length === 0) return null;

  async function open(att: { id: string; name: string }) {
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

  const chip = (a: { id: string; name: string }) => (
    <button
      key={a.id}
      className="crew-chart-btn"
      disabled={busyId === a.id}
      onClick={() => open(a)}
    >
      {busyId === a.id ? "Opening…" : a.name}
    </button>
  );

  return (
    <div className="crew-card edge crew-myset">
      <div className="crew-row-head">
        <span className="mono" style={{ color: "var(--accent-hi)" }}>
          My set
        </span>
        <span className="mono-data crew-count-of">
          {songs.length} song{songs.length === 1 ? "" : "s"}
        </span>
      </div>
      {songs.map((s: PlanItem) => {
        // Generated PCO PDFs (webUrl) are replaced by the in-app renderer.
        const all = (s.attachments ?? []).filter((a: any) => !a.webUrl);
        // The uploaded MultiTracks chart IS the ♪ Chart button, so it
        // doesn't repeat as an ordinary chip.
        const chartPdf = chartPdfFor(all);
        const files = all.filter((a) => a.id !== chartPdf?.id);
        const { mine, rest } = splitFilesFor(rule, files);
        const open4 = mine.slice(0, CAP);
        const overflow = [...mine.slice(CAP), ...rest];
        const showAll = !!expanded[s.id];
        return (
          <div key={s.id} className={`crew-myset-song ${s.id === pco.liveItemId ? "live" : ""}`}>
            <div className="crew-setlist-row">
              <span className="crew-setlist-title">
                {s.id === pco.liveItemId ? "● " : ""}
                {s.title}
              </span>
              {s.key && <span className="crew-setlist-key">{s.key}</span>}
            </div>
            {s.leader && <div className="crew-setlist-sub mono-data">{s.leader} leads</div>}
            {(open4.length > 0 || overflow.length > 0 || chartPdf || (s.songId && s.arrangementId)) && (
              <div className="crew-setlist-charts" style={{ paddingLeft: 0 }}>
                {/* The band's real chart: MultiTracks PDF when the song has
                    one, else the in-app renderer from PCO chord text. */}
                {chartPdf ? (
                  <button
                    className="crew-chart-btn crew-chart-primary"
                    disabled={busyId === chartPdf.id}
                    onClick={() => open(chartPdf)}
                  >
                    {busyId === chartPdf.id ? "Opening…" : `♪ Chart${s.key ? ` · ${s.key}` : ""}`}
                  </button>
                ) : s.songId && s.arrangementId ? (
                  <button className="crew-chart-btn crew-chart-primary" onClick={() => setChartFor(s)}>
                    ♪ Chart{s.key ? ` · ${s.key}` : ""}
                  </button>
                ) : null}
                {open4.map(chip)}
                {showAll && overflow.map(chip)}
                {overflow.length > 0 && (
                  <button
                    className="crew-chart-btn crew-chart-more"
                    onClick={() => setExpanded((p) => ({ ...p, [s.id]: !showAll }))}
                  >
                    {showAll ? "less ▴" : `all files (${files.length}) ▾`}
                  </button>
                )}
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
  );
}
