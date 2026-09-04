import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { useProDeck } from "../store";
import { activePresentation, currentSlideIndex } from "../lib/status";
import { ppGet, ppPlaylistTrigger } from "../lib/tauri";
import { SlideThumb } from "./SlideThumb";
import { Icon } from "./Icon";

interface PlNode {
  uuid: string;
  name: string;
  depth: number;
}
interface PlItem {
  itemUuid: string; // playlist-item id — identity within the playlist
  presUuid: string; // real presentation/library uuid — used for slides + trigger
  plIndex: number; // this item's index within the playlist (for playlist-scoped endpoints)
  arrangementUuid: string; // the arrangement selected for this item (songs)
  arrangementName: string;
  name: string;
  type: string;
  hidden: boolean;
}
export interface Slide {
  index: number; // display position within the item's arrangement — the cue index
  group: string;
  color?: string;
  text: string;
}

// ProPresenter returns playlists possibly nested inside playlist groups.
// Flatten to the leaf playlists, tracking depth so we can indent the dropdown.
function flattenPlaylists(j: any): PlNode[] {
  const arr = Array.isArray(j) ? j : Array.isArray(j?.playlists) ? j.playlists : [];
  const out: PlNode[] = [];
  const walk = (nodes: any[], depth: number) => {
    for (const n of nodes) {
      const uuid = n?.id?.uuid;
      const name = n?.id?.name ?? "Playlist";
      const ft = (n?.field_type ?? n?.type ?? "").toString().toLowerCase();
      const kids = n?.children;
      const isGroup = ft.includes("group") || (Array.isArray(kids) && kids.length > 0);
      if (isGroup) {
        if (Array.isArray(kids)) walk(kids, depth + 1);
      } else if (uuid) {
        out.push({ uuid, name, depth });
      }
    }
  };
  walk(arr, 0);
  return out;
}

// ProPresenter group colors come as {red,green,blue} floats (0..1).
function groupColor(c: any): string | undefined {
  if (!c) return undefined;
  if (typeof c === "string") return c;
  const { red, green, blue } = c;
  if ([red, green, blue].some((v) => typeof v !== "number")) return undefined;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to(red)}, ${to(green)}, ${to(blue)})`;
}

// Flatten a presentation into individually-triggerable slides, keeping group
// name/color so we can label them (Verse 1, Chorus, …).
//
// We follow the playlist item's selected arrangement (which repeats choruses,
// drops unused groups, etc.) so the operator sees only the active arrangement in
// performance order. The flattened position IS the cue index we use against the
// playlist-scoped endpoints (thumbnail + trigger), which interpret the index in
// this same arrangement space — so display, thumbnail, and trigger all line up.
export function parseSlides(j: any, arrangementUuid?: string): Slide[] {
  const pres = j?.presentation ?? j ?? {};
  const groups = Array.isArray(pres.groups) ? pres.groups : [];
  const byUuid = new Map<string, any>();
  for (const g of groups) if (g?.uuid) byUuid.set(g.uuid, g);
  const arrangements = Array.isArray(pres.arrangements) ? pres.arrangements : [];

  // Follow the playlist item's arrangement when present, else stored order.
  let sequence: any[] = groups;
  if (arrangementUuid) {
    const arr = arrangements.find((a: any) => a?.id?.uuid === arrangementUuid);
    const seq = Array.isArray(arr?.groups) ? arr.groups : [];
    if (seq.length) {
      const mapped = seq
        .map((gu: any) => byUuid.get(typeof gu === "string" ? gu : gu?.uuid))
        .filter(Boolean);
      if (mapped.length) sequence = mapped;
    }
  }

  const out: Slide[] = [];
  let idx = 0;
  for (const g of sequence) {
    const group = (g?.name ?? "").toString();
    const color = groupColor(g?.color);
    const slides = Array.isArray(g?.slides) ? g.slides : [];
    for (let p = 0; p < slides.length; p++) {
      const s = slides[p];
      const text = (s?.text ?? "").toString().replace(/\s+/g, " ").trim();
      out.push({ index: idx, group, color, text });
      idx += 1;
    }
  }
  return out;
}

// Slide-cache key: a presentation can appear twice with different arrangements.
const slideKey = (it: PlItem) => `${it.presUuid}|${it.arrangementUuid}`;

// Browse a ProPresenter playlist and trigger presentations / individual slides.
// Controlled: the selected playlist id is owned by the parent (widget config or
// page state) so it can persist.
export function PlaylistControl({
  selectedId,
  onSelect,
  slideSize,
  onSlideSize,
  page = false,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  slideSize?: number;
  onSlideSize?: (n: number) => void;
  page?: boolean; // spacious page layout: all songs open, no inner scroll
}) {
  const { connected, status } = useProDeck();
  const [playlists, setPlaylists] = useState<PlNode[]>([]);
  const [items, setItems] = useState<PlItem[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [slides, setSlides] = useState<Record<string, Slide[]>>({});
  const [loading, setLoading] = useState(false);
  const [trigErr, setTrigErr] = useState("");
  const sel = selectedId;

  // Slide thumbnail size (min column width, px). Persisted by the parent when
  // onSlideSize is supplied (e.g. the dashboard widget config).
  const SIZE_MIN = 120;
  const SIZE_MAX = 380;
  const SIZE_STEP = 40;
  const [size, setSize] = useState(typeof slideSize === "number" ? slideSize : 200);
  useEffect(() => {
    if (typeof slideSize === "number") setSize(slideSize);
  }, [slideSize]);
  const changeSize = (delta: number) =>
    setSize((s) => {
      const n = Math.max(SIZE_MIN, Math.min(SIZE_MAX, s + delta));
      if (n !== s) onSlideSize?.(n);
      return n;
    });

  const live = activePresentation(status);
  const liveIdx = currentSlideIndex(status);

  // Playlist list — refreshed on (re)connect.
  useEffect(() => {
    if (!connected) {
      setPlaylists([]);
      return;
    }
    ppGet("playlists")
      .then((j) => setPlaylists(flattenPlaylists(j)))
      .catch(() => setPlaylists([]));
  }, [connected]);

  // Items of the selected playlist.
  useEffect(() => {
    if (!connected || !sel) {
      setItems([]);
      setOpen(new Set());
      return;
    }
    setLoading(true);
    ppGet(`playlist/${encodeURIComponent(sel)}`)
      .then((j: any) => {
        const raw = j?.items ?? j?.playlist?.items ?? [];
        const its: PlItem[] = (Array.isArray(raw) ? raw : [])
          // rawIdx is the item's position in the playlist — that's the index the
          // playlist-scoped trigger/thumbnail endpoints expect, so capture it
          // before filtering.
          .map((it: any, rawIdx: number) => ({
            itemUuid: it?.id?.uuid ?? "",
            // The library presentation lives here — NOT in id.uuid (that's the
            // playlist-item id, which 404s on /presentation/{uuid}).
            presUuid: it?.presentation_info?.presentation_uuid ?? "",
            plIndex: rawIdx,
            arrangementUuid: it?.presentation_info?.arrangement_uuid ?? "",
            arrangementName: it?.presentation_info?.arrangement_name ?? "",
            name: it?.id?.name ?? "Item",
            type: (it?.type ?? "presentation").toString().toLowerCase(),
            hidden: !!it?.is_hidden,
          }))
          .filter((it: PlItem) => it.itemUuid);
        setItems(its);
        // On the spacious page, open every song so all slides are visible.
        setOpen(page ? new Set(its.map((i) => i.itemUuid)) : new Set());
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [connected, sel, page]);

  // Load slide lists for any open song that doesn't have them yet. Keyed by
  // presentation + arrangement, so the same song used with two arrangements
  // doesn't collide.
  useEffect(() => {
    for (const it of items) {
      const k = slideKey(it);
      if (open.has(it.itemUuid) && it.presUuid && slides[k] === undefined) {
        ppGet(`presentation/${encodeURIComponent(it.presUuid)}`)
          .then((j) =>
            setSlides((m) =>
              m[k] !== undefined ? m : { ...m, [k]: parseSlides(j, it.arrangementUuid) },
            ),
          )
          .catch(() => setSlides((m) => ({ ...m, [k]: [] })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, open]);

  const toggle = (it: PlItem) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(it.itemUuid)) n.delete(it.itemUuid);
      else n.add(it.itemUuid);
      return n;
    });

  const allOpen = items.length > 0 && items.every((i) => open.has(i.itemUuid));
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(items.map((i) => i.itemUuid)));

  // Trigger a slide WITHIN the playlist (cueIndex = display position). Goes
  // through the playlist so ProPresenter stays in this playlist, on the item's
  // own destination/screen, with its arrangement — and the slide's actions (Look,
  // macros) fire. alreadyActive (this item is the live one) skips re-activating
  // it, which would flash back to its first slide.
  const trigger = (it: PlItem, cueIndex: number, alreadyActive: boolean) => {
    if (!it.presUuid || !sel) {
      setTrigErr("This item isn't linked to a presentation, so it can't be triggered.");
      return;
    }
    setTrigErr("");
    ppPlaylistTrigger(sel, it.plIndex, cueIndex, alreadyActive).catch((e) =>
      setTrigErr(`Couldn't trigger that slide: ${e}`),
    );
  };

  if (!connected) return <div className="widget-empty">Not connected</div>;

  // Render a presentation's slides with a label row at each group boundary.
  const renderSlides = (it: PlItem, sl: Slide[], isLive: boolean) => {
    const out: ReactNode[] = [];
    let lastGroup: string | null = null;
    for (const s of sl) {
      if (s.group && s.group !== lastGroup) {
        out.push(
          <div
            key={`g-${s.index}`}
            className="pl-group"
            style={s.color ? ({ "--g": s.color } as CSSProperties) : undefined}
          >
            <span className="pl-group-bar" />
            <span className="pl-group-name">{s.group}</span>
          </div>,
        );
        lastGroup = s.group;
      }
      out.push(
        <button
          key={s.index}
          className={`pl-slide ${isLive && liveIdx === s.index ? "active" : ""}`}
          onClick={() => trigger(it, s.index, isLive)}
          title={`${s.group ? s.group + " — " : ""}slide ${s.index + 1}${
            s.text ? ": " + s.text : ""
          }`}
        >
          <SlideThumb
            uuid={it.presUuid}
            playlistId={sel}
            itemIndex={it.plIndex}
            index={s.index}
          />
          <span className="pl-slide-n">{s.index + 1}</span>
        </button>,
      );
    }
    return out;
  };

  return (
    <div className={`w-playlist ${page ? "pl-page" : ""}`}>
      <div className="pl-bar" onMouseDown={(e) => e.stopPropagation()}>
        <select
          className="input"
          value={sel ?? ""}
          onChange={(e) => onSelect(e.target.value || null)}
        >
          <option value="">Select a playlist…</option>
          {playlists.map((p) => (
            <option key={p.uuid} value={p.uuid}>
              {`${"  ".repeat(p.depth)}${p.name}`}
            </option>
          ))}
        </select>
        {items.length > 0 && (
          <button className="btn small ghost pl-expandall" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
        <div className="pl-zoom" title="Slide size">
          <button
            className="btn small ghost"
            onClick={() => changeSize(-SIZE_STEP)}
            disabled={size <= SIZE_MIN}
            aria-label="Smaller slides"
          >
            <Icon name="minus" size={13} />
          </button>
          <button
            className="btn small ghost"
            onClick={() => changeSize(SIZE_STEP)}
            disabled={size >= SIZE_MAX}
            aria-label="Bigger slides"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      {trigErr && (
        <p className="error" style={{ padding: "6px 10px", margin: "4px 0" }}>
          {trigErr}
        </p>
      )}

      {!sel ? (
        <div className="widget-empty">Choose a playlist</div>
      ) : loading ? (
        <div className="widget-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="widget-empty">Empty playlist</div>
      ) : (
        <div className="pl-items" onMouseDown={(e) => e.stopPropagation()}>
          {items.map((it) => {
            const isLive = !!live.uuid && live.uuid === it.presUuid;
            const isExpanded = open.has(it.itemUuid);
            const sl = slides[slideKey(it)];
            return (
              <div
                key={it.itemUuid}
                className={`pl-item ${isLive ? "live" : ""} ${it.hidden ? "hidden" : ""}`}
              >
                <div className="pl-row">
                  <button className="pl-name" onClick={() => toggle(it)} title="Show slides">
                    <span className={`pl-caret ${isExpanded ? "open" : ""}`}>▸</span>
                    <span className="pl-title">{it.name}</span>
                    {it.arrangementName && (
                      <span className="pl-arr" title="Active arrangement">
                        {it.arrangementName}
                      </span>
                    )}
                    {sl !== undefined && <span className="pl-count">{sl.length}</span>}
                  </button>
                  {isLive && <span className="pl-livetag">LIVE</span>}
                  <button
                    className="btn small primary pl-go"
                    title="Trigger from first slide"
                    onClick={() => trigger(it, 0, isLive)}
                    disabled={!it.presUuid}
                  >
                    <Icon name="next" size={12} />
                  </button>
                </div>
                {isExpanded && (
                  <div
                    className="pl-slides"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))`,
                    }}
                  >
                    {sl === undefined ? (
                      <span className="muted small">Loading…</span>
                    ) : sl.length === 0 ? (
                      <span className="muted small">No slides</span>
                    ) : (
                      renderSlides(it, sl, isLive)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
