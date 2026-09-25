import { useEffect, useMemo, useState } from "react";
import { getSettings, IS_WEB, streamReportGet, streamReportsList, updateSettings } from "../lib/tauri";
import { useProDeck } from "../store";
import { BAND_LABELS, summarize, TARGET_LUFS, type StreamReportData, type StreamReportMeta, type StreamSummary } from "../lib/streamReport";

// The weekly stream report: what the people watching at home heard, from the
// stream mix the booth records every service (src-tauri/src/streamrep.rs).

const fmtLu = (x: number | null) => (x == null ? "—" : x.toFixed(1));
const when = (t: number) =>
  new Date(t * 1000).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function StreamReportCard() {
  const { settings, refreshSettings } = useProDeck();
  const [list, setList] = useState<StreamReportMeta[]>([]);
  const [sel, setSel] = useState<string>("");
  const [data, setData] = useState<StreamReportData | null>(null);
  const [prev, setPrev] = useState<StreamReportData | null>(null);
  const [err, setErr] = useState("");
  const offset = settings?.stream_report_offset_db ?? 0;
  const channels = settings?.stream_report_channels ?? [];

  useEffect(() => {
    if (IS_WEB) return;
    streamReportsList()
      .then((l) => {
        setList(l);
        if (l.length && !sel) setSel(l[0].id);
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!sel) return;
    streamReportGet(sel).then(setData).catch((e) => setErr(String(e)));
    const i = list.findIndex((m) => m.id === sel);
    const p = i >= 0 ? list[i + 1] : undefined;
    if (p) streamReportGet(p.id).then(setPrev).catch(() => setPrev(null));
    else setPrev(null);
  }, [sel, list]);

  const s = useMemo(() => (data ? summarize(data, offset) : null), [data, offset]);
  const ps = useMemo(() => (prev ? summarize(prev, offset) : null), [prev, offset]);

  async function save(patch: Partial<NonNullable<typeof settings>>) {
    const cur = await getSettings();
    await updateSettings({ ...cur, ...patch });
    await refreshSettings();
  }

  if (IS_WEB) return null;
  return (
    <section className="card sr-card">
      <div className="card-head">
        <h3>Stream mix</h3>
        {list.length > 0 && (
          <select className="input sr-pick" value={sel} onChange={(e) => setSel(e.target.value)} title="Choose a recorded service">
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {when(m.start)} · {Math.round(m.soundSecs / 60)} min
              </option>
            ))}
          </select>
        )}
      </div>
      {!channels.length && (
        <p className="muted small">
          Not recording. Set the input channels that carry the stream mix below (left, right) and every service is measured
          from then on.
        </p>
      )}
      {channels.length > 0 && !list.length && (
        <p className="muted small">Recording channels {channels.join(" + ")}. The first report appears after a service (at least 10 minutes of sound).</p>
      )}
      {err && <p className="error small">{err}</p>}
      {s && <Summary s={s} ps={ps} />}
      <div className="controls-row sr-settings">
        <label className="field">
          <span>Stream mix channels (L, R)</span>
          <input
            className="input mono"
            defaultValue={channels.join(", ")}
            placeholder="3, 4"
            onBlur={(e) => {
              const v = e.target.value
                .split(/[,\s]+/)
                .map((x) => parseInt(x, 10))
                .filter((x) => x > 0)
                .slice(0, 2);
              save({ stream_report_channels: v, stream_report_on: v.length > 0 });
            }}
          />
        </label>
        <label className="field">
          <span>Encoder offset (YouTube loudness − feed, dB)</span>
          <input className="input mono" type="number" step={0.5} defaultValue={offset} onBlur={(e) => save({ stream_report_offset_db: Number(e.target.value) || 0 })} />
        </label>
      </div>
      <p className="muted small">
        Measured at the feed into this Mac. If OBS or the encoder changes the level, measure one stream on YouTube (Stats for
        nerds → content loudness, or a download) and put the difference in the offset. Tone is compared with a
        professionally mixed worship record, band by band.
      </p>
    </section>
  );
}

function Summary({ s, ps }: { s: StreamSummary; ps: StreamSummary | null }) {
  const delta = (a: number | null, b: number | null | undefined) =>
    a != null && b != null ? <span className="sr-delta">{(a - b >= 0 ? "+" : "") + (a - b).toFixed(1)} vs last</span> : null;
  return (
    <>
      <p className="muted small">
        {when(s.start)} → {new Date(s.end * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {s.worshipMinutes} min
        of music, {s.messageMinutes} min of talking
      </p>
      <div className="an-totals sr-totals">
        <div className="an-total">
          <span className="an-total-k">Stream loudness</span>
          <span className={`an-total-v ${s.overall != null && Math.abs(s.overall - TARGET_LUFS) > 1.5 ? "over" : "under"}`}>
            {fmtLu(s.overall)}
            <small> LUFS</small>
          </span>
          <span className="an-total-sub">
            YouTube plays at {TARGET_LUFS} {delta(s.overall, ps?.overall)}
          </span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Worship</span>
          <span className="an-total-v">
            {fmtLu(s.worship)}
            <small> LUFS</small>
          </span>
          <span className="an-total-sub">range {fmtLu(s.worshipRange)} LU</span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Message</span>
          <span className="an-total-v">
            {fmtLu(s.message)}
            <small> LUFS</small>
          </span>
          <span className="an-total-sub">range {fmtLu(s.messageRange)} LU</span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Message vs worship</span>
          <span className={`an-total-v ${s.gap != null && (s.gap < -3 || s.gap > 2) ? "over" : "under"}`}>
            {s.gap != null ? (s.gap > 0 ? "+" : "") + s.gap.toFixed(1) : "—"}
            <small> LU</small>
          </span>
          <span className="an-total-sub">within ±2 is easy listening {delta(s.gap, ps?.gap)}</span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Peak</span>
          <span className="an-total-v">
            {s.peak.toFixed(1)}
            <small> dBFS</small>
          </span>
          <span className="an-total-sub">sample peak</span>
        </div>
      </div>
      <div className="sr-charts">
        <Timeline s={s} />
        {s.bandDiff && <Bands diff={s.bandDiff} />}
      </div>
      <ul className="sr-tips">
        {s.tips.map((t) => (
          <li key={t.text} className={`sr-tip ${t.level}`}>
            <span className="sr-dot" aria-hidden="true" />
            {t.text}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Loudness a minute at a time; music and talking in their own colours, the
 *  YouTube level as a line. */
function Timeline({ s }: { s: StreamSummary }) {
  const W = 560;
  const H = 150;
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const lo = -40;
  const hi = -6;
  const pts = s.timeline;
  if (pts.length < 2) return null;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t + 60;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const bw = Math.max(1, x(t0 + 60) - x(t0) - 1);
  const ticks = [-36, -28, -20, -14, -8];
  const hours: number[] = [];
  for (let t = Math.ceil(t0 / 900) * 900; t < t1; t += 900) hours.push(t);
  return (
    <figure className="sr-fig">
      <figcaption className="small muted">
        Loudness through the service <span className="sr-key music">music</span> <span className="sr-key talk">talking</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="sr-svg" role="img" aria-label="Stream loudness per minute">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === TARGET_LUFS ? "sr-target" : "sr-grid"} />
            <text x={pad.l - 4} y={y(v) + 3} className="sr-axis" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {pts.map((p) => (
          <rect key={p.t} x={x(p.t)} y={y(p.lufs)} width={bw} height={Math.max(0, H - pad.b - y(p.lufs))} className={p.music ? "sr-bar music" : "sr-bar talk"} />
        ))}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={H - 6} className="sr-axis" textAnchor="middle">
            {new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </text>
        ))}
      </svg>
    </figure>
  );
}

/** The worship's tone against the reference: bars above the line are more
 *  than the reference has, below are less. */
function Bands({ diff }: { diff: number[] }) {
  const W = 300;
  const H = 150;
  const pad = { l: 28, r: 6, t: 8, b: 20 };
  const R = 8;
  const y = (v: number) => pad.t + (1 - (Math.max(-R, Math.min(R, v)) + R) / (2 * R)) * (H - pad.t - pad.b);
  const cw = (W - pad.l - pad.r) / diff.length;
  return (
    <figure className="sr-fig">
      <figcaption className="small muted">Worship tone vs the reference (dB)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="sr-svg" role="img" aria-label="Octave band balance against the reference mix">
        {[-6, -3, 0, 3, 6].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "sr-zero" : "sr-grid"} />
            <text x={pad.l - 4} y={y(v) + 3} className="sr-axis" textAnchor="end">
              {v > 0 ? `+${v}` : v}
            </text>
          </g>
        ))}
        {diff.map((d, i) => {
          const top = Math.min(y(d), y(0));
          const h = Math.abs(y(d) - y(0));
          return (
            <g key={i}>
              <rect x={pad.l + i * cw + cw * 0.18} y={top} width={cw * 0.64} height={Math.max(1, h)} className={`sr-band ${Math.abs(d) > 3 ? "off" : ""}`} />
              <text x={pad.l + i * cw + cw / 2} y={H - 6} className="sr-axis" textAnchor="middle">
                {BAND_LABELS[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
