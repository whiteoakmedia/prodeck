import { useEffect, useMemo, useState } from "react";
import { getWebToken, invoke } from "../lib/tauri";
import { keyDelta, keyOptions, transposeChart } from "../lib/chords";

// The in-app chart: ProDeck draws the chord chart itself from PCO's raw
// text, transposed to the scheduled key — no login-walled PDF, and it works
// through the edge with the booth off. Chords render inline in accent color
// (the bracket style musicians already read in every chart app).

interface ChartData {
  chordChart: string | null;
  chartKey: string | null;
  lyrics: string | null;
  name: string | null;
}

// Plain-English readout of what the transposer is doing right now.
function TransposeNote({
  chartKey,
  targetKey,
  itemKey,
}: {
  chartKey: string;
  targetKey: string;
  itemKey: string;
}) {
  const d = keyDelta(chartKey, targetKey);
  let what: string;
  if (d === 0) what = `Showing the chart in its original key (${chartKey}).`;
  else {
    const dir = d <= 6 ? `up ${d}` : `down ${12 - d}`;
    what = `Transposing ${chartKey} → ${targetKey} (${dir} half-step${(d <= 6 ? d : 12 - d) === 1 ? "" : "s"}).`;
  }
  const sched =
    itemKey && targetKey !== itemKey ? ` Scheduled key this week is ${itemKey}.` : "";
  return <p className="crew-chart-note">{what}{sched}</p>;
}

export function ChartSheet({
  songId,
  arrangementId,
  title,
  itemKey,
  onClose,
}: {
  songId: string;
  arrangementId: string;
  title: string;
  itemKey: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ChartData | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"chords" | "lyrics">("chords");
  const [targetKey, setTargetKey] = useState("");

  useEffect(() => {
    let alive = true;
    const viaEdge = () =>
      fetch(`/edge/chart-text/${songId}/${arrangementId}?token=${encodeURIComponent(getWebToken())}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("edge unreachable"))));
    invoke<ChartData>("pco_chord_chart", { songId, arrangementId })
      .catch(viaEdge)
      .then((d) => {
        if (!alive) return;
        setData(d as ChartData);
        const dd = d as ChartData;
        setTargetKey(itemKey || dd.chartKey || "");
        if (!dd.chordChart && !dd.lyrics)
          setErr(
            "No chart found for this song — no uploaded chart PDF and no chord text in Planning Center. Attach the MultiTracks chart to the song in PCO, or paste chords into the arrangement's chord editor, and it'll show here.",
          );
        else if (!dd.chordChart) setTab("lyrics");
      })
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, arrangementId]);

  const chartKey = data?.chartKey ?? "";
  const shown = useMemo(() => {
    if (!data?.chordChart) return "";
    return chartKey && targetKey
      ? transposeChart(data.chordChart, chartKey, targetKey)
      : data.chordChart;
  }, [data, chartKey, targetKey]);

  // Real chart layout: each bracketed line becomes a CHORD LINE positioned
  // over the lyric line at the exact syllable (monospace makes the alignment
  // land). Bar lines and section headers get their own styles.
  type ChartLine =
    | { kind: "pair"; chords: string; lyric: string }
    | { kind: "bars" | "header" | "plain"; text: string };
  const lines = useMemo<ChartLine[]>(() => {
    return shown.split(/\r?\n/).map((raw): ChartLine => {
      if (!raw.includes("[")) {
        const t = raw.trimEnd();
        if (t.includes("|")) return { kind: "bars", text: t };
        if (t && t.length <= 32 && /^[A-Z0-9 ()'&/.:#-]+$/.test(t) && t === t.toUpperCase())
          return { kind: "header", text: t };
        return { kind: "plain", text: t };
      }
      let chords = "";
      let lyric = "";
      const re = /\[([^\]\s]+)\]/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) {
        lyric += raw.slice(last, m.index);
        // Pad the chord line out to where this chord lands in the lyric,
        // always leaving at least one space between neighboring chords.
        const target = Math.max(lyric.length, chords.length + (chords ? 1 : 0));
        chords = chords.padEnd(target, " ") + m[1];
        last = m.index + m[0].length;
      }
      lyric += raw.slice(last);
      return { kind: "pair", chords, lyric: lyric.trimEnd() };
    });
  }, [shown]);

  const keys = keyOptions(targetKey || chartKey || "C");
  const step = (dir: number) => {
    const cur = keys.findIndex((k) => k === (targetKey || chartKey));
    if (cur < 0) return;
    setTargetKey(keys[(cur + dir + 12) % 12]);
  };

  return (
    <div className="crew-sheet crew-guide-sheet" onClick={onClose}>
      <div className="crew-guide-body crew-chart-body" onClick={(e) => e.stopPropagation()}>
        <div className="crew-row-head">
          <span className="crew-buzz-title">{title}</span>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="crew-chart-toolbar">
          <div className="crew-chart-tabs">
            <button
              className={`crew-chart-tab ${tab === "chords" ? "on" : ""}`}
              onClick={() => setTab("chords")}
            >
              Chords
            </button>
            <button
              className={`crew-chart-tab ${tab === "lyrics" ? "on" : ""}`}
              onClick={() => setTab("lyrics")}
            >
              Lyrics
            </button>
          </div>
          {tab === "chords" && chartKey && (
            <div className="crew-chart-keys">
              <button className="crew-chart-stepbtn" onClick={() => step(-1)}>
                ▼ ♭
              </button>
              <span className="crew-setlist-key crew-chart-keynow">
                {targetKey || chartKey}
              </span>
              <button className="crew-chart-stepbtn" onClick={() => step(1)}>
                ♯ ▲
              </button>
              {itemKey && targetKey !== itemKey && (
                <button className="crew-chart-reset" onClick={() => setTargetKey(itemKey)}>
                  → {itemKey}
                </button>
              )}
            </div>
          )}
        </div>
        {tab === "chords" && chartKey && (
          <TransposeNote
            chartKey={chartKey}
            targetKey={targetKey || chartKey}
            itemKey={itemKey}
          />
        )}
        {!data && !err && <p className="crew-hint muted">Loading chart…</p>}
        {err && <p className="crew-join-err">{err}</p>}
        {data && tab === "chords" && data.chordChart && (
          <div className="crew-chart-scroll">
            <div className="crew-chart-text">
              {lines.map((l, i) => {
                if (l.kind === "pair")
                  return (
                    <div key={i} className="crew-chart-pairline">
                      {l.chords.trimEnd() && (
                        <div className="crew-chart-chord">{l.chords}</div>
                      )}
                      <div>{l.lyric || " "}</div>
                    </div>
                  );
                if (l.kind === "bars")
                  return (
                    <div key={i} className="crew-chart-chord">
                      {l.text}
                    </div>
                  );
                if (l.kind === "header")
                  return (
                    <div key={i} className="crew-chart-section">
                      {l.text}
                    </div>
                  );
                return <div key={i}>{l.text || " "}</div>;
              })}
            </div>
          </div>
        )}
        {data && tab === "lyrics" && (
          <pre className="crew-chart-text">{data.lyrics ?? "No lyrics stored."}</pre>
        )}
      </div>
    </div>
  );
}
