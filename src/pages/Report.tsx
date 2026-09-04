import { useCallback, useEffect, useState } from "react";
import { usePco } from "../pcoStore";
import { useTracking, type ServiceHistory } from "../trackingStore";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/PcoBits";
import {
  openPrintHtml,
  IS_WEB,
  loadReports,
  saveReports,
  tapStatsRange,
  checkinList,
  identityList,
  type Json,
  type TapWindow,
} from "../lib/tauri";
import { askConfirm } from "../lib/dialogs";
import type { TrackedItem } from "../trackingStore";

// A frozen snapshot of one service. Written once, never recomputed: the whole
// point is that it survives a Reset, a re-synced plan whose item ids changed,
// and any later edit to the live tracking data.
export interface SavedReport {
  id: string;
  key: string; // originating tracking bucket
  label: string;
  rehearsal: boolean;
  savedAt: number;
  startedAt?: number;
  endedAt?: number;
  rows: TrackedItem[];
  totals: Summary;
  taps: TapWindow | null;
  /// Who was on site and when, frozen with the rest of the report. Arrival is
  /// booth-recorded, so it's a fact rather than a recollection.
  checkins?: { name: string; role: string; at: number | null; expected: number | null }[];
  // Why taps are absent, when they are — so a blank section isn't ambiguous.
  tapNote?: string;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c],
  );
}

// Standalone, paper-friendly styles for the printed report (black on white, no
// app chrome) — used in the document we hand to the browser to print.
const PRINT_CSS = `
@page { margin: 0.6in; }
body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 20px; margin: 0 0 2px; }
.sub { color: #555; margin: 0 0 18px; }
.totals { display: flex; gap: 28px; margin: 0 0 20px; flex-wrap: wrap; }
.tot .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .09em; color: #777; }
.tot .v { font-size: 22px; font-weight: 700; }
.tot .s { font-size: 11px; color: #888; }
table { width: 100%; border-collapse: collapse; margin: 0 0 18px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e4e4e4; font-size: 12px; }
th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: #777; border-bottom: 1.5px solid #bbb; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
.over { color: #c0392b; } .under { color: #1f7a4d; }
h2 { font-size: 13px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .06em; color: #555; }
.team { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 28px; }
.person { display: flex; justify-content: space-between; border-bottom: 1px dotted #ddd; padding: 3px 0; }
.person .mic { font-weight: 700; }
.foot { margin-top: 24px; font-size: 10px; color: #999; }
`;

function fmtDur(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
function fmtClock(sec: number): string {
  // Compact "1h 6m" / "14m 41s" style used for the big totals.
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtDelta(sec: number): string {
  const r = Math.round(sec);
  if (r === 0) return "0:00";
  return `${r > 0 ? "+" : "−"}${fmtDur(Math.abs(r))}`;
}
function fmtDeltaClock(sec: number): string {
  const r = Math.round(sec);
  if (r === 0) return "on time";
  return `${r > 0 ? "+" : "−"}${fmtClock(Math.abs(r))}`;
}

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const deltaClass = (d: number) => (Math.abs(d) <= 15 ? "" : d > 0 ? "over" : "under");

interface Summary {
  planned: number;
  actual: number;
  delta: number;
  items: number;
  tracked: number;
  peak: number;
  avg: number;
}
function summarize(rows: TrackedItem[]): Summary {
  let planned = 0, actual = 0, items = 0, tracked = 0, peak = -100, avgSum = 0, avgCount = 0;
  for (const r of rows) {
    planned += r.planned;
    items++;
    if (r.tracked) {
      tracked++;
      actual += r.actual;
    }
    if (r.splPeak > -100) peak = Math.max(peak, r.splPeak);
    if (r.splAvg > -100) {
      avgSum += r.splAvg;
      avgCount++;
    }
  }
  return { planned, actual, delta: actual - planned, items, tracked, peak, avg: avgCount ? avgSum / avgCount : -100 };
}

// One per-item analytics row with a scheduled-vs-actual bar.
function ItemRow({ r, scaleMax }: { r: TrackedItem; scaleMax: number }) {
  const d = r.actual - r.planned;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  const over = r.tracked && d > 1;
  return (
    <tr>
      <td className="an-item">
        <span className={`an-dot ${r.type}`} />
        {r.title}
      </td>
      <td className="an-barcell">
        <div className="an-bar">
          {!r.tracked ? (
            <div className="an-seg sched" style={{ width: pct(r.planned) }} />
          ) : over ? (
            <>
              <div className="an-seg plan" style={{ width: pct(r.planned) }} />
              <div className="an-seg over" style={{ width: pct(d) }} />
            </>
          ) : (
            <div className="an-seg ok" style={{ width: pct(r.actual) }} />
          )}
        </div>
      </td>
      <td className="an-num">{fmtDur(r.planned)}</td>
      <td className="an-num">{r.tracked ? fmtDur(r.actual) : "—"}</td>
      <td className={`an-num ${r.tracked ? deltaClass(d) : ""}`}>
        {r.tracked ? fmtDelta(d) : "—"}
      </td>
      <td className="an-num">{r.splPeak > -100 ? Math.round(r.splPeak) : "—"}</td>
      <td className="an-num">{r.splAvg > -100 ? Math.round(r.splAvg) : "—"}</td>
    </tr>
  );
}

export function Report() {
  const pco = usePco();
  const { history, currentKey, rows: liveRows, loadError } = useTracking();
  const [selKey, setSelKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [savedErr, setSavedErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Taps for the service currently on screen (unsaved ones query live; saved
  // ones carry their own frozen copy).
  const [liveTaps, setLiveTaps] = useState<TapWindow | null>(null);
  const [liveCheckins, setLiveCheckins] = useState<SavedReport["checkins"]>([]);

  const hist = history();

  // Crew arrivals for the service on screen. Booth-recorded, so "not checked
  // in" is a fact — the report says so rather than leaving a blank.
  useEffect(() => {
    let alive = true;
    Promise.all([identityList(), checkinList("")])
      .then(([crew, ci]) => {
        if (!alive) return;
        const expected =
          pco.serviceTimes.find((t) => t.id === pco.selectedServiceTimeId)?.ts ?? null;
        setLiveCheckins(
          crew
            .filter((u) => u.approved)
            .map((u) => ({
              name: u.name,
              role: u.role ?? "",
              at: ci.at?.[u.id] ?? null,
              expected,
            })),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pco.selectedServiceTimeId, pco.selectedPlanId]);

  useEffect(() => {
    loadReports()
      .then((d) => setSaved(Array.isArray(d) ? (d as unknown as SavedReport[]) : []))
      // Same rule as tracking: a rejected load means the file is there but
      // unusable. Never silently start from empty and save over it.
      .catch((e) => setSavedErr(String(e)));
  }, []);

  const persist = useCallback(async (next: SavedReport[]) => {
    setSaved(next);
    await saveReports(next as unknown as Json);
  }, []);

  // A service is identified by WHEN it happened: "July 12, 2026 | 9:30 AM".
  // The plan title is deliberately dropped — in this PCO account it's the date
  // again, so it read "July 12, 2026 · 8:00 AM · July 12, 2026". Labelling by
  // song content is gone too: songs are what a service contained, not which
  // service it was, and it made the picker look like songs were being saved.
  function labelFor(h: ServiceHistory): string {
    const [planId, timeId] = h.key.split("::");
    const plan = pco.plans.find((p) => p.id === planId);
    let date = h.planDate ?? plan?.date ?? null;
    let time =
      h.timeName ??
      (pco.selectedPlanId === planId
        ? pco.serviceTimes.find((t) => t.id === timeId)?.name ?? null
        : null);
    // Fall back to the recorded window — for buckets Planning Center can no
    // longer resolve, when the service ran is still known from its own data.
    if ((!date || !time) && h.startedAt) {
      const d = new Date(h.startedAt);
      date ??= d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      time ??= d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    const base = date && time ? `${date} | ${time}` : date ?? time ?? "Unlabelled service";
    // Rehearsals are tracked in their own bucket — mark them so a practice run
    // is never mistaken for the service's real numbers.
    return h.rehearsal ? `${base} | REHEARSAL` : base;
  }

  // Saved snapshots are addressed as "saved:<id>" so they can share the one
  // picker with the live buckets.
  const savedSel =
    selKey && selKey.startsWith("saved:")
      ? saved.find((s) => `saved:${s.id}` === selKey) ?? null
      : null;
  // The selected service. For the live service, prefer the live rows (they
  // include the in-progress item's elapsed time); otherwise use stored rows.
  const sel = savedSel ? null : hist.find((h) => h.key === selKey) ?? hist[0] ?? null;
  const isLive = !!sel && sel.key === currentKey;
  const rows = savedSel
    ? savedSel.rows
    : sel
      ? isLive
        ? liveRows.filter((r) => r.tracked || r.planned > 0)
        : sel.rows
      : [];
  const sum = savedSel ? savedSel.totals : summarize(rows);
  const scaleMax = Math.max(1, ...rows.map((r) => Math.max(r.planned, r.actual)));
  const label = savedSel ? savedSel.label : sel ? labelFor(sel) : "";
  const taps = savedSel ? savedSel.taps : liveTaps;
  const checkins = (savedSel ? savedSel.checkins : liveCheckins) ?? [];

  // Window this service occupied. Buckets recorded before startedAt existed
  // have none — taps can't be attributed to them, and we say so rather than
  // guessing a window and reporting numbers that belong to another service.
  const serviceWindow = savedSel
    ? savedSel.startedAt && savedSel.endedAt
      ? { from: savedSel.startedAt, to: savedSel.endedAt }
      : null
    : sel?.startedAt
      ? { from: sel.startedAt, to: isLive ? Date.now() : sel.endedAt ?? sel.startedAt }
      : null;

  // Pull taps for an unsaved service so they're visible before saving.
  useEffect(() => {
    if (savedSel || !serviceWindow) {
      setLiveTaps(null);
      return;
    }
    let alive = true;
    tapStatsRange(serviceWindow.from, serviceWindow.to)
      .then((t) => alive && setLiveTaps(t))
      .catch(() => alive && setLiveTaps(null));
    return () => {
      alive = false;
    };
    // Re-run when the selected service changes, not on every render tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSel?.id, sel?.key, serviceWindow?.from]);

  if (hist.length === 0 && saved.length === 0) {
    // A failed load looks identical to "nothing tracked yet" from here — and
    // that is the single worst moment to show a cheerful empty state, because
    // the data DOES exist on disk and the operator would assume it's gone.
    return (
      <div className="page">
        <header className="page-head"><h1>Analytics</h1></header>
        <div className="empty">
          <div className="eic"><Icon name="report" size={22} /></div>
          {loadError || savedErr ? (
            <>
              <h4>Can't read saved data — nothing has been lost</h4>
              <p className="error">{loadError ?? savedErr}</p>
              <p>
                Your services are still on disk. ProDeck has stopped writing to that file so it
                can't be overwritten, and it won't record new services until this is fixed —
                restore the file (a <code>.bak.json</code> copy sits next to it) and restart
                ProDeck.
              </p>
            </>
          ) : (
            <>
              <h4>No services tracked yet</h4>
              <p>
                Load a Planning Center plan and run a service (advance through items in PCO Live).
                The app captures planned vs. actual time and SPL per item, and every service is
                saved here so you can come back to it any week.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }


  function copySummary() {
    const lines: string[] = [];
    lines.push(`PRODUCTION REPORT — ${label}`);
    lines.push("=".repeat(52));
    lines.push(
      `Total: planned ${fmtClock(sum.planned)} · actual ${fmtClock(sum.actual)} · ` +
        `${fmtDeltaClock(sum.delta)} · peak ${sum.peak > -100 ? Math.round(sum.peak) : "—"}dB · ` +
        `avg ${sum.avg > -100 ? Math.round(sum.avg) : "—"}dB`,
    );
    if (checkins.length) {
      lines.push("");
      lines.push("CREW CHECK-IN");
      for (const c of checkins) {
        const d = c.at && c.expected ? Math.round((c.at - c.expected) / 60000) : null;
        lines.push(
          `  ${c.name.slice(0, 20).padEnd(21)}${(c.role || "—").slice(0, 14).padEnd(15)}` +
            `${(c.at ? fmtTime(c.at) : "not checked in").padEnd(16)}` +
            `${d === null ? "" : d === 0 ? "on time" : `${d > 0 ? "+" : ""}${d}m`}`,
        );
      }
    }
    if (taps)
      lines.push(
        `NFC taps: ${taps.total}` +
          (taps.keywords.length
            ? ` (${taps.keywords.map((k) => `${k.state} ${k.taps}`).join(", ")})`
            : ""),
      );
    lines.push("");
    lines.push(`  ${"Item".padEnd(28)} ${"Sched".padEnd(8)} ${"Actual".padEnd(8)} ${"+/-".padEnd(8)} pk/avg`);
    for (const r of rows) {
      lines.push(
        `  ${r.title.slice(0, 27).padEnd(28)} ${fmtDur(r.planned).padEnd(8)} ` +
          `${(r.tracked ? fmtDur(r.actual) : "—").padEnd(8)} ` +
          `${(r.tracked ? fmtDelta(r.actual - r.planned) : "—").padEnd(8)} ` +
          `${r.splPeak > -100 ? `${Math.round(r.splPeak)}/${Math.round(r.splAvg)}` : "—"}`,
      );
    }
    const text = lines.join("\n");
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done, () => {});
    } else {
      // Phones load over plain http:// (LAN), where navigator.clipboard doesn't
      // exist — fall back to the legacy textarea trick instead of no-oping.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand("copy")) done();
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  // Freeze the selected service into reports.json, taps included. Re-saving the
  // same service replaces its snapshot rather than piling up duplicates.
  async function saveReport() {
    if (!sel) return;
    setSaveMsg("");
    setBusy(true);
    try {
      let taps: TapWindow | null = null;
      let tapNote: string | undefined;
      if (!serviceWindow) {
        tapNote =
          "No start/end time was recorded for this service, so taps can't be attributed to it.";
      } else {
        try {
          taps = await tapStatsRange(serviceWindow.from, serviceWindow.to);
        } catch (e) {
          // A saved report is worth more than the taps in it — never block it.
          tapNote = `Tap counts unavailable: ${e}`;
        }
      }
      const now = Date.now();
      const report: SavedReport = {
        id: `${sel.key}@${now}`,
        key: sel.key,
        label: labelFor(sel),
        rehearsal: sel.rehearsal,
        savedAt: now,
        startedAt: sel.startedAt,
        endedAt: isLive ? now : sel.endedAt,
        rows,
        totals: sum,
        taps,
        tapNote,
        checkins: liveCheckins,
      };
      await persist([report, ...saved.filter((s) => s.key !== sel.key)]);
      setSelKey(`saved:${report.id}`);
      setSaveMsg(
        taps
          ? `✓ Saved — ${taps.total} tap${taps.total === 1 ? "" : "s"} included.`
          : "✓ Saved.",
      );
    } catch (e) {
      setSaveMsg(`✗ ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSaved(r: SavedReport) {
    if (!(await askConfirm(`Delete the saved report "${r.label}"?`, "Delete"))) return;
    await persist(saved.filter((s) => s.id !== r.id));
    if (selKey === `saved:${r.id}`) setSelKey(null);
  }

  const roster = isLive ? pco.micRoster() : [];

  // Build a standalone, printable HTML document of the current report (no app
  // chrome) and print it via the browser — WebView window.print() is unreliable.
  function buildReportHtml(): string {
    const checkinHtml = checkins.length
      ? `<h2>Crew Check-in</h2><table><thead><tr><th>Name</th><th>Role</th>` +
        `<th class="n">Expected</th><th class="n">Arrived</th><th class="n">+/−</th></tr></thead><tbody>` +
        [...checkins]
          .sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || (a.at ?? 0) - (b.at ?? 0))
          .map((c) => {
            const d = c.at && c.expected ? Math.round((c.at - c.expected) / 60000) : null;
            return (
              `<tr><td>${esc(c.name)}</td><td>${esc(c.role || "—")}</td>` +
              `<td class="n">${c.expected ? fmtTime(c.expected) : "—"}</td>` +
              `<td class="n">${c.at ? fmtTime(c.at) : "not checked in"}</td>` +
              `<td class="n ${d === null ? "" : d > 0 ? "over" : "under"}">` +
              `${d === null ? "—" : d === 0 ? "on time" : `${d > 0 ? "+" : ""}${d}m`}</td></tr>`
            );
          })
          .join("") +
        `</tbody></table>`
      : "";
    const tapsHtml = taps
      ? `<h2>NFC Taps</h2><div class="team"><div class="person"><span>Total during service</span>` +
        `<span class="mic">${taps.total}</span></div>` +
        taps.keywords
          .map(
            (k) =>
              `<div class="person"><span>${esc(k.state)}</span><span class="mic">${k.taps}</span></div>`,
          )
          .join("") +
        `</div>`
      : "";
    const tot = (k: string, v: string, s: string) =>
      `<div class="tot"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`;
    const totals = [
      tot("Actual total", fmtClock(sum.actual), `${fmtClock(sum.planned)} planned`),
      tot("Variance", fmtDeltaClock(sum.delta), "vs. plan"),
      tot("Peak SPL", sum.peak > -100 ? `${Math.round(sum.peak)} dB` : "—", "loudest moment"),
      tot("Avg SPL", sum.avg > -100 ? `${Math.round(sum.avg)} dB` : "—", `${sum.tracked}/${sum.items} items run`),
    ].join("");
    const body = rows
      .map((r) => {
        const d = r.actual - r.planned;
        const dc = r.tracked ? deltaClass(d) : "";
        return (
          `<tr><td>${esc(r.title)}</td>` +
          `<td class="n">${fmtDur(r.planned)}</td>` +
          `<td class="n">${r.tracked ? fmtDur(r.actual) : "—"}</td>` +
          `<td class="n ${dc}">${r.tracked ? fmtDelta(d) : "—"}</td>` +
          `<td class="n">${r.splPeak > -100 ? Math.round(r.splPeak) : "—"}</td>` +
          `<td class="n">${r.splAvg > -100 ? Math.round(r.splAvg) : "—"}</td></tr>`
        );
      })
      .join("");
    const team = roster.length
      ? `<h2>Team &amp; Mic Assignments</h2><div class="team">` +
        roster
          .map((m) => {
            const mic = pco.micFor(m.id, m.position).mic;
            return `<div class="person"><span>${esc(m.name)} <span style="color:#999">${esc(m.position)}</span></span><span class="mic">${mic ? "Mic " + esc(mic) : "—"}</span></div>`;
          })
          .join("") +
        `</div>`
      : "";
    return (
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>Production Report — ${esc(label)}</title><style>${PRINT_CSS}</style></head><body>` +
      `<h1>Production Report</h1><div class="sub">${esc(label)}${isLive ? " · live" : ""}</div>` +
      `<div class="totals">${totals}</div>` +
      tapsHtml +
      checkinHtml +
      `<table><thead><tr><th>Item</th><th class="n">Sched</th><th class="n">Actual</th><th class="n">+/−</th><th class="n">Peak</th><th class="n">Avg</th></tr></thead><tbody>${body}</tbody></table>` +
      team +
      `<div class="foot">Generated by ProDeck</div>` +
      `<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>` +
      `</body></html>`
    );
  }

  function doPrint() {
    const html = buildReportHtml();
    if (IS_WEB) {
      // Real browser: open a clean print window (its onload triggers print).
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } else {
      // Desktop: open in the default browser, where print/save-as-PDF works.
      openPrintHtml(html).catch(() => {});
    }
  }

  return (
    <div className="page report-page">
      <header className="page-head">
        <h1>Analytics</h1>
        <select
          className="input an-picker"
          value={savedSel ? `saved:${savedSel.id}` : sel?.key ?? ""}
          onChange={(e) => setSelKey(e.target.value)}
          title="Choose a service to review"
        >
          {/* Services the picker can name, then rehearsals, then the buckets
              PCO can no longer resolve — five bare "Unlabelled service" rows
              used to sit interleaved with the real ones. */}
          {(() => {
            const labeled = hist.filter(
              (h) => !h.rehearsal && labelFor(h) !== "Unlabelled service",
            );
            const rehearsals = hist.filter(
              (h) => h.rehearsal && labelFor(h) !== "Unlabelled service | REHEARSAL",
            );
            const unlabeled = hist.filter(
              (h) => !labeled.includes(h) && !rehearsals.includes(h),
            );
            const opt = (h: ServiceHistory) => (
              <option key={h.key} value={h.key}>
                {labelFor(h)}
                {h.key === currentKey ? "  (live)" : ""}
              </option>
            );
            return (
              <>
                <optgroup label="Services">{labeled.map(opt)}</optgroup>
                {rehearsals.length > 0 && (
                  <optgroup label="Rehearsals">{rehearsals.map(opt)}</optgroup>
                )}
                {unlabeled.length > 0 && (
                  <optgroup label="Old / unidentified runs">{unlabeled.map(opt)}</optgroup>
                )}
              </>
            );
          })()}
          {saved.length > 0 && (
            <optgroup label="Saved reports">
              {saved.map((r) => (
                <option key={r.id} value={`saved:${r.id}`}>
                  ★ {r.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <div className="grow" style={{ flex: 1 }} />
        <button className="btn small ghost" onClick={copySummary}>
          {copied ? "Copied ✓" : "Copy summary"}
        </button>
        {!IS_WEB && !savedSel && sel && (
          <button
            className="btn small"
            onClick={saveReport}
            disabled={busy}
            title="Freeze this service — items, times, SPL and tap counts — into a saved report that Reset can't touch."
          >
            {busy ? "Saving…" : "Save report"}
          </button>
        )}
        {!IS_WEB && savedSel && (
          <button className="btn small ghost" onClick={() => deleteSaved(savedSel)}>
            Delete
          </button>
        )}
        <button className="btn small ghost" onClick={doPrint}>
          Print
        </button>
      </header>

      {loadError && (
        <div className="banner">
          <span className="error">
            Live tracking is NOT recording this session — {loadError} Saved reports below are
            unaffected.
          </span>
        </div>
      )}
      {savedErr && (
        <div className="banner">
          <span className="error">Saved reports couldn't be read — {savedErr}</span>
        </div>
      )}
      {saveMsg && <div className="banner">{saveMsg}</div>}
      {savedSel && (
        <div className="banner">
          Saved report — frozen {new Date(savedSel.savedAt).toLocaleString()}. Live tracking
          changes and Reset don't affect it.
        </div>
      )}

      {/* Big totals — planned / actual / variance, like the PCO analytics header */}
      <section className="card an-totals">
        <div className="an-total">
          <span className="an-total-k">Actual total</span>
          <span className="an-total-v">{fmtClock(sum.actual)}</span>
          <span className="an-total-sub">{fmtClock(sum.planned)} planned</span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Variance</span>
          <span className={`an-total-v ${deltaClass(sum.delta)}`}>{fmtDeltaClock(sum.delta)}</span>
          {/* actual covers only items that ran; planned covers the whole plan —
              so mid-service (or with cut items) this reads "under" by design */}
          <span className="an-total-sub">vs. full plan</span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Peak SPL</span>
          <span className="an-total-v">{sum.peak > -100 ? `${Math.round(sum.peak)}` : "—"}<small> dB</small></span>
          <span className="an-total-sub">loudest moment</span>
        </div>
        <div className="an-total">
          <span className="an-total-k">Avg SPL</span>
          <span className="an-total-v">{sum.avg > -100 ? `${Math.round(sum.avg)}` : "—"}<small> dB</small></span>
          <span className="an-total-sub">{sum.tracked}/{sum.items} items run</span>
        </div>
      </section>

      {/* NFC taps inside this service's own window */}
      <section className="card">
        <div className="card-head">
          <h3>NFC taps</h3>
          {serviceWindow && (
            <span className="muted small">
              {new Date(serviceWindow.from).toLocaleTimeString()} –{" "}
              {new Date(serviceWindow.to).toLocaleTimeString()}
            </span>
          )}
        </div>
        {taps ? (
          taps.total > 0 ? (
            <>
              <div className="an-totals" style={{ padding: 0, border: 0 }}>
                <div className="an-total">
                  <span className="an-total-k">Taps</span>
                  <span className="an-total-v">{taps.total}</span>
                  <span className="an-total-sub">during this service</span>
                </div>
              </div>
              <div className="field-row" style={{ flexWrap: "wrap" }}>
                {taps.keywords.map((k) => (
                  <span key={k.state} className="chip">
                    {k.state} {k.taps}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">No taps during this service.</p>
          )
        ) : (
          <p className="muted small">
            {savedSel?.tapNote ??
              (serviceWindow
                ? "Tap counts unavailable — the edge couldn't be reached."
                : "No start/end time was recorded for this service, so taps can't be attributed to it. Services tracked from now on will have one.")}
          </p>
        )}
      </section>

      {/* Crew check-in — who was here, and when */}
      {checkins.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Crew check-in</h3>
            <span className="muted small">
              {checkins.filter((c) => c.at).length} of {checkins.length} checked in
            </span>
          </div>
          <div className="rep-scroll">
            <table className="track an-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="an-num">Expected</th>
                  <th className="an-num">Arrived</th>
                  <th className="an-num">+/−</th>
                </tr>
              </thead>
              <tbody>
                {[...checkins]
                  // Not-arrived first: the exceptions are the reason to look.
                  .sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || (a.at ?? 0) - (b.at ?? 0))
                  .map((c) => {
                    const d =
                      c.at && c.expected ? Math.round((c.at - c.expected) / 60000) : null;
                    return (
                      <tr key={c.name}>
                        <td className="an-item">{c.name}</td>
                        <td className="muted">{c.role || "—"}</td>
                        <td className="an-num">
                          {c.expected ? fmtTime(c.expected) : "—"}
                        </td>
                        <td className={`an-num ${c.at ? "" : "over"}`}>
                          {c.at ? fmtTime(c.at) : "not checked in"}
                        </td>
                        <td className={`an-num ${d === null ? "" : d > 0 ? "over" : "under"}`}>
                          {d === null ? "—" : d === 0 ? "on time" : `${d > 0 ? "+" : ""}${d}m`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Per-item analytics with bars */}
      <section className="card">
        <div className="card-head">
          <h3>Items</h3>
          {isLive && <span className="chip online">live</span>}
          {(savedSel?.rehearsal ?? sel?.rehearsal) && <span className="chip">rehearsal</span>}
        </div>
        <div className="rep-scroll">
          <table className="track an-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="an-barhead">Scheduled vs. actual</th>
                <th className="an-num">Sched</th>
                <th className="an-num">Actual</th>
                <th className="an-num">+/−</th>
                <th className="an-num">Peak</th>
                <th className="an-num">Avg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ItemRow key={r.itemId} r={r} scaleMax={scaleMax} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="an-legend">
          <span><i className="an-key ok" /> under / on time</span>
          <span><i className="an-key plan" /> within plan</span>
          <span><i className="an-key over" /> over</span>
          <span><i className="an-key sched" /> scheduled (not run)</span>
        </div>
      </section>

      {/* Team & mic reference (live service only) */}
      {roster.length > 0 && (
        <section className="card">
          <div className="card-head"><h3>Team &amp; Mic Assignments</h3><span className="count">{roster.length}</span></div>
          <div className="cb-pad">
            <div className="rep-team">
              {roster.map((m) => {
                const mic = pco.micFor(m.id, m.position).mic;
                return (
                  <div key={m.id} className="rep-person">
                    <Avatar src={m.photo} name={m.name} size={26} />
                    <span className="rep-name">{m.name}</span>
                    <span className="rep-pos muted small">{m.position}</span>
                    <span className="rep-mic">{mic ? `Mic ${mic}` : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
