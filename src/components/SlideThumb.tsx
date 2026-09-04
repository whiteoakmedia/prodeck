import { useEffect, useRef, useState } from "react";
import { ppThumbnail, ppPlaylistThumbnail } from "../lib/tauri";

interface Props {
  uuid: string | null;
  index: number | null;
  // When both are provided, the thumbnail is fetched playlist-scoped (the index
  // is the display position in the item's arrangement) — always matches the slide
  // we show, regardless of ProPresenter's current_arrangement. Falls back to the
  // presentation thumbnail (by uuid) when absent.
  playlistId?: string | null;
  itemIndex?: number | null;
  label?: string;
  className?: string;
}

const QUALITY = 640;
// Bounded: ~30–100 KB of base64 per slide adds up over a long day of browsing.
// Map iterates in insertion order, so evicting the first key is simple FIFO.
const CACHE_MAX = 400;
const cache = new Map<string, string>();
function cachePut(key: string, val: string) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, val);
}
const thumbKey = (
  uuid: string,
  index: number,
  playlistId: string | null,
  itemIndex: number | null,
) =>
  !!playlistId && itemIndex != null && itemIndex >= 0
    ? `pl:${playlistId}:${itemIndex}:${index}:${QUALITY}`
    : `${uuid}:${index}:${QUALITY}`;

// Cap concurrent thumbnail fetches so a spacious "all songs open" view can't
// flood ProPresenter with hundreds of requests at once (which starves slide
// triggers and makes thumbnails fail).
const MAX = 4;
let active = 0;
const waiters: (() => void)[] = [];
function acquire(): Promise<void> {
  if (active < MAX) {
    active++;
    return Promise.resolve();
  }
  return new Promise((res) => waiters.push(res));
}
function release() {
  const w = waiters.shift();
  if (w) w(); // hand the slot to the next waiter (active unchanged)
  else active--;
}

async function getThumb(
  uuid: string,
  index: number,
  playlistId: string | null,
  itemIndex: number | null,
): Promise<string | null> {
  if (index < 0) return null;
  const usePl = !!playlistId && itemIndex != null && itemIndex >= 0;
  const k = thumbKey(uuid, index, playlistId, itemIndex);
  const hit = cache.get(k);
  if (hit) return hit;
  await acquire();
  try {
    const data = usePl
      ? await ppPlaylistThumbnail(playlistId!, itemIndex!, index, QUALITY)
      : await ppThumbnail(uuid, index, QUALITY);
    cachePut(k, data);
    return data;
  } catch {
    return null;
  } finally {
    release();
  }
}

export function SlideThumb({
  uuid,
  index,
  playlistId = null,
  itemIndex = null,
  label,
  className,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Only fetch once the thumbnail scrolls near the viewport — keeps off-screen
  // slides from fetching and flooding ProPresenter.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "250px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setFailed(false);
    if (!visible || !uuid || index === null || index < 0) {
      if (!uuid) setSrc(null);
      return;
    }
    const cached = cache.get(thumbKey(uuid, index, playlistId, itemIndex));
    if (cached) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    getThumb(uuid, index, playlistId, itemIndex).then((d) => {
      if (cancelled) return;
      if (d) setSrc(d);
      else {
        setSrc(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, uuid, index, playlistId, itemIndex]);

  return (
    <div className={`slide-thumb ${className ?? ""}`} ref={wrapRef}>
      {src ? (
        <img src={src} alt={label ?? "slide"} />
      ) : (
        <div className="thumb-placeholder">
          {failed ? "No preview" : label ? label : "—"}
        </div>
      )}
    </div>
  );
}
