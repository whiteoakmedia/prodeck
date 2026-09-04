import { useEffect, useRef, useState } from "react";
import { usePco } from "../pcoStore";
import { ppGet, ppPut } from "../lib/tauri";

// ---------------------------------------------------------------------------
// ProPresenter setlist swap. Zach's playlists are hand-built scaffolds
// (welcome, countdown, Song Look presets, sermon templates) with SONG SLOTS
// in between. This swaps ONLY the marked slots to this week's PCO songs — in
// plan order, using his own library masters (his layout, never a PCO import)
// — and writes the playlist back byte-faithfully around them.
//
// The target playlist is remembered PER SERVICE TYPE (Sunday → "Sunday",
// Youth → "Youth"), and song picks PER SONG+KEY — masters aren't key-named,
// so "I Speak Jesus | D" and "| C" are separate remembered answers.
// ---------------------------------------------------------------------------

const SWAP_KEY = "prodeck.proSwap";

interface SwapCfg {
  /** PCO service-type id → Pro playlist uuid ("" key = legacy/default). */
  playlistByType: Record<string, string>;
  /** "normalized title|Key" → library presentation uuid. */
  aliases: Record<string, string>;
  /** Presentation uuids placed by the last swap — how next week's "old
   *  songs" are recognized without guessing. */
  lastSongRows: string[];
}

const swapNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function loadSwapCfg(): SwapCfg {
  try {
    const j = JSON.parse(localStorage.getItem(SWAP_KEY) ?? "");
    const byType = j.playlistByType ?? {};
    // v1 stored a single playlistUuid; carry it over as the default.
    if (j.playlistUuid && !byType[""]) byType[""] = j.playlistUuid;
    return { playlistByType: byType, aliases: j.aliases ?? {}, lastSongRows: j.lastSongRows ?? [] };
  } catch {
    return { playlistByType: {}, aliases: {}, lastSongRows: [] };
  }
}

/** The write schema demands fields the read omits — learned the hard way. */
function patchRowForWrite(r: any, index: number): any {
  const out = { ...r, target_uuid: r.target_uuid ?? "", id: { ...r.id, index } };
  if (r.type === "presentation") {
    out.presentation_info = {
      presentation_uuid: r.presentation_info?.presentation_uuid ?? "",
      arrangement_name: r.presentation_info?.arrangement_name ?? "",
      arrangement_uuid: r.presentation_info?.arrangement_uuid ?? "",
      target_uuid: r.presentation_info?.target_uuid ?? "",
    };
  }
  return out;
}

export function ProSetlistSwap({
  swapSignal = 0,
  onSwapped,
}: {
  /** Wizard: bump to open the review panel (its Next button drives this). */
  swapSignal?: number;
  /** Wizard: called after a successful placement so it can advance. */
  onSwapped?: () => void;
} = {}) {
  const pco = usePco();
  const [cfg, setCfg] = useState<SwapCfg>(loadSwapCfg);
  const [playlists, setPlaylists] = useState<{ uuid: string; name: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [lib, setLib] = useState<{ uuid: string; name: string }[]>([]);
  const [slots, setSlots] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  // The review panel replaces the old text-wall confirm dialog: a styled
  // placed/skipped breakdown inside the card. In the wizard it opens when
  // the user presses Next on this step (swapSignal bump) — never on entry.
  const [review, setReview] = useState(false);
  const lastSignal = useRef(0);

  const typeKey = pco.selectedServiceTypeId ?? "";
  const playlistUuid = cfg.playlistByType[typeKey] ?? cfg.playlistByType[""] ?? "";

  const saveCfg = (c: SwapCfg) => {
    setCfg(c);
    localStorage.setItem(SWAP_KEY, JSON.stringify(c));
  };

  // Pro's playlist tree + the song library, when the PP link is up.
  useEffect(() => {
    (async () => {
      try {
        const pl = (await ppGet("playlists")) as any[];
        const flat: { uuid: string; name: string }[] = [];
        const walk = (xs: any[]) => {
          for (const p of xs ?? []) {
            if (p.field_type === "playlist") flat.push({ uuid: p.id.uuid, name: p.id.name });
            walk(p.children ?? []);
          }
        };
        walk(Array.isArray(pl) ? pl : []);
        setPlaylists(flat);
        const libs = (await ppGet("libraries")) as any[];
        if (Array.isArray(libs) && libs.length > 0) {
          const items = (await ppGet(`library/${libs[0].uuid}`)) as any;
          setLib((items?.items ?? []).map((i: any) => ({ uuid: i.uuid, name: i.name })));
        }
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  // Load the target playlist's rows; auto-mark slots we placed last week,
  // plus (first run) rows whose names match this week's songs.
  const songs = pco.items.filter((i) => i.type === "song");
  useEffect(() => {
    if (!playlistUuid) return;
    (async () => {
      try {
        const d = (await ppGet(`playlist/${playlistUuid}`)) as any;
        const items = d?.items ?? [];
        setRows(items);
        const guess: Record<string, boolean> = {};
        for (const r of items) {
          const pu = r.presentation_info?.presentation_uuid ?? "";
          const nameHit = songs.some((s) => swapNorm(s.title) === swapNorm(r.id?.name ?? ""));
          if (cfg.lastSongRows.includes(pu) || nameHit) guess[r.id.uuid] = true;
        }
        setSlots(guess);
        setDone("");
      } catch (e) {
        setErr(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistUuid]);

  // Resolve each PCO song to a library master: remembered alias for this
  // song+key, then a this-session pick, then a unique exact title match.
  const aliasKey = (s: any) => `${swapNorm(s.title)}|${s.key || "?"}`;
  const resolve = (s: any): { uuid: string; name: string } | null => {
    const pick = picks[aliasKey(s)] || cfg.aliases[aliasKey(s)];
    if (pick) {
      const hit = lib.find((l) => l.uuid === pick);
      if (hit) return hit;
    }
    const exact = lib.filter((l) => swapNorm(l.name) === swapNorm(s.title));
    return exact.length === 1 ? exact[0] : null;
  };
  const candidates = (s: any) =>
    lib.filter(
      (l) => swapNorm(l.name).includes(swapNorm(s.title)) || swapNorm(s.title).includes(swapNorm(l.name)),
    );

  const unresolved = songs.filter((s) => !resolve(s));
  // Partial swaps are allowed: songs without a library master are SKIPPED
  // (their old slot rows stay as placeholders) instead of freezing the whole
  // button — one missing master must not block the other five songs.
  const ready = playlistUuid && rows.length > 0 && songs.some((s) => !!resolve(s));

  useEffect(() => {
    if (swapSignal > lastSignal.current) {
      lastSignal.current = swapSignal;
      if (ready && !busy && !done) setReview(true);
      else onSwapped?.(); // nothing to place — don't trap the wizard
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapSignal, ready]);

  async function swap() {
    setReview(false);
    setBusy(true);
    setErr("");
    try {
      const slotIdx = rows.map((r, i) => (slots[r.id.uuid] ? i : -1)).filter((i) => i >= 0);
      // Match the scheduled KEY: if a master has an arrangement named after
      // the week's key ("D", "Key of D", "D (capo 2)"…), pin it on the
      // playlist row. Masters without key-named arrangements keep their
      // default — never block the swap on this.
      const arrsByPreso: Record<string, { uuid: string; name: string }[]> = {};
      for (const sg of songs) {
        const pr = resolve(sg);
        if (!pr || arrsByPreso[pr.uuid]) continue;
        try {
          const d = (await ppGet(`presentation/${pr.uuid}`)) as any;
          arrsByPreso[pr.uuid] = ((d?.presentation ?? d)?.arrangements ?? []).map((a: any) => ({
            uuid: a.id.uuid,
            name: a.id.name ?? "",
          }));
        } catch {
          arrsByPreso[pr.uuid] = [];
        }
      }
      const keyArrangement = (presoUuid: string, key: string) => {
        if (!key) return null;
        const k = key.trim().toLowerCase();
        return (
          (arrsByPreso[presoUuid] ?? []).find((a) => {
            const n = a.name.trim().toLowerCase();
            return (
              n === k ||
              n === `key of ${k}` ||
              n.split(/[\s(\[]+/).includes(k)
            );
          }) ?? null
        );
      };
      const mkRow = (s: any) => {
        const p = resolve(s)!;
        const arr = keyArrangement(p.uuid, s.key ?? "");
        return {
          id: { uuid: crypto.randomUUID().toUpperCase(), name: p.name, index: 0 },
          type: "presentation",
          is_hidden: false,
          is_pco: false,
          presentation_info: {
            presentation_uuid: p.uuid,
            arrangement_name: arr?.name ?? "",
            arrangement_uuid: arr?.uuid ?? "",
            target_uuid: "",
          },
          destination: "presentation",
          target_uuid: "",
        };
      };
      const next: any[] = [];
      rows.forEach((r, i) => {
        const k = slotIdx.indexOf(i);
        if (k === -1) {
          next.push(r);
        } else {
          if (k < songs.length) {
            // Unmatched song: keep the old row in its slot as a placeholder.
            if (resolve(songs[k])) next.push(mkRow(songs[k]));
            else next.push(r);
          }
          if (k === slotIdx.length - 1) {
            for (let j = slotIdx.length; j < songs.length; j++) {
              if (resolve(songs[j])) next.push(mkRow(songs[j]));
            }
          }
        }
      });
      await ppPut(`playlist/${playlistUuid}`, next.map(patchRowForWrite));
      const placed = songs.filter((s) => resolve(s)).map((s) => resolve(s)!.uuid);
      const newAliases = { ...cfg.aliases };
      for (const s of songs) if (resolve(s)) newAliases[aliasKey(s)] = resolve(s)!.uuid;
      saveCfg({ ...cfg, aliases: newAliases, lastSongRows: placed });
      const d = (await ppGet(`playlist/${playlistUuid}`)) as any;
      setRows(d?.items ?? []);
      const marks: Record<string, boolean> = {};
      for (const r of d?.items ?? [])
        if (placed.includes(r.presentation_info?.presentation_uuid)) marks[r.id.uuid] = true;
      setSlots(marks);
      setDone(
        `Placed ${placed.length} song(s)` +
          (unresolved.length ? ` — skipped ${unresolved.length} without a master` : "") +
          " — the rest of the playlist untouched.",
      );
      onSwapped?.();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h3>ProPresenter setlist</h3>
        <button
          className="btn small primary"
          disabled={busy || !ready}
          title="Replace the checked song slots with this week's PCO songs, in plan order"
          onClick={() => setReview(true)}
        >
          {busy ? "Swapping…" : "Swap songs from PCO"}
        </button>
      </div>
      <p className="muted small">
        Swaps only the checked rows to this week's set — your scaffold (looks,
        templates, order) is written back untouched. Song choices are
        remembered per song <em>and key</em>; the playlist per service type.
      </p>
      {review && (
        <div
          style={{
            border: "1px solid var(--accent-hi, #7cc4ff)",
            borderRadius: 12,
            padding: "16px 18px",
            margin: "10px 0 14px",
            background: "rgba(124,196,255,0.06)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
            Ready to update “{playlists.find((pl) => pl.uuid === playlistUuid)?.name}”
          </div>
          {songs.filter((sg) => resolve(sg)).map((sg, k) => (
            <div key={sg.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 0" }}>
              <span className="muted" style={{ width: 22, textAlign: "right" }}>{k + 1}.</span>
              <span style={{ fontWeight: 600 }}>{resolve(sg)!.name}</span>
              {sg.key && (
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    padding: "1px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--accent-hi, #7cc4ff)",
                    color: "var(--accent-hi, #7cc4ff)",
                  }}
                >
                  {sg.key}
                </span>
              )}
            </div>
          ))}
          {unresolved.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(230,162,60,0.08)" }}>
              <span style={{ color: "var(--warn, #e6a23c)", fontWeight: 600 }}>
                Skipping {unresolved.length} — no master in your library:
              </span>{" "}
              <span className="muted">{unresolved.map((sg) => sg.title).join(", ")}</span>
              <div className="muted small" style={{ marginTop: 2 }}>
                Their current rows stay put. Create these in Pro once and they'll swap next week.
              </div>
            </div>
          )}
          <p className="muted small" style={{ margin: "10px 0 12px" }}>
            Everything else in the playlist stays exactly where it is.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={swap}>
              Place {songs.filter((sg) => resolve(sg)).length} song{songs.filter((sg) => resolve(sg)).length === 1 ? "" : "s"} →
            </button>
            <button className="btn ghost" onClick={() => setReview(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {playlists.length === 0 ? (
        <p className="muted small">
          Waiting on the ProPresenter link — playlists appear here once Pro is
          connected.
        </p>
      ) : (
        <div className="field-row" style={{ alignItems: "center" }}>
          <span style={{ width: 60 }}>Playlist</span>
          <select
            className="input"
            value={playlistUuid}
            onChange={(e) =>
              saveCfg({ ...cfg, playlistByType: { ...cfg.playlistByType, [typeKey]: e.target.value } })
            }
          >
            <option value="">Choose…</option>
            {playlists.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {rows.map((r) => (
        <label key={r.id.uuid} className="field-row" style={{ alignItems: "center", padding: "1px 0", gap: 8 }}>
          <input
            type="checkbox"
            checked={!!slots[r.id.uuid]}
            onChange={(e) => setSlots((p) => ({ ...p, [r.id.uuid]: e.target.checked }))}
          />
          <span className={slots[r.id.uuid] ? "" : "muted"} style={{ fontSize: 13 }}>
            {r.id.name}
          </span>
        </label>
      ))}
      {rows.length > 0 &&
        songs.map((s) => {
          const hit = resolve(s);
          const cands = candidates(s);
          return (
            <div key={s.id} className="field-row" style={{ alignItems: "center", gap: 8 }}>
              <span style={{ minWidth: 180, fontSize: 13 }}>
                {s.title} {s.key && <strong>({s.key})</strong>}
              </span>
              {hit && cands.length <= 1 ? (
                <span className="muted small">→ {hit.name}</span>
              ) : (
                <select
                  className="input"
                  value={hit?.uuid ?? ""}
                  onChange={(e) => setPicks((p) => ({ ...p, [aliasKey(s)]: e.target.value }))}
                >
                  <option value="">Pick the presentation…</option>
                  {(cands.length > 0 ? cands : lib).map((l) => (
                    <option key={l.uuid} value={l.uuid}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      {unresolved.length > 0 && rows.length > 0 && (
        <p className="muted small">
          Songs without a pick get SKIPPED (old slot stays) — choose a
          presentation to include them; picks are remembered per song &amp; key.
        </p>
      )}
      {err && <p className="small" style={{ color: "var(--warn, #e6a23c)" }}>{err}</p>}
      {done && <p className="muted small">✓ {done}</p>}
    </>
  );
}
