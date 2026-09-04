import type { PpStatus } from "../store";
import type { Json } from "./tauri";

export interface SlideRef {
  uuid: string | null;
  name: string | null;
  index: number | null;
}

export function activePresentation(status: PpStatus): SlideRef {
  const p = (status.activePresentation as Json | null)?.presentation;
  return {
    uuid: p?.id?.uuid ?? null,
    name: p?.id?.name ?? null,
    index: null,
  };
}

export function currentSlideIndex(status: PpStatus): number | null {
  const idx = (status.slideIndex as Json | null)?.presentation_index?.index;
  return typeof idx === "number" ? idx : null;
}

export interface LayerState {
  name: string;
  label: string;
  active: boolean;
}

const LAYER_LABELS: Record<string, string> = {
  video_input: "Video Input",
  media: "Media",
  slide: "Slide",
  announcements: "Announcements",
  props: "Props",
  messages: "Messages",
  audio: "Audio",
};

export function activeLayers(status: PpStatus): LayerState[] {
  const raw = status.layers as Json | null;
  if (!raw || typeof raw !== "object") {
    return Object.keys(LAYER_LABELS).map((name) => ({
      name,
      label: LAYER_LABELS[name],
      active: false,
    }));
  }
  return Object.keys(LAYER_LABELS).map((name) => ({
    name,
    label: LAYER_LABELS[name],
    active: Boolean(raw[name]),
  }));
}

export interface TimerView {
  id: string;
  name: string;
  time: string;
  state: string;
}

function fmtTime(t: unknown): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") {
    const total = Math.max(0, Math.round(t));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  return "--:--";
}

export function currentTimers(status: PpStatus): TimerView[] {
  const raw = status.currentTimers as Json | null;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: Json, i: number) => ({
    id: t?.id?.uuid ?? String(i),
    name: t?.id?.name ?? t?.name ?? `Timer ${i + 1}`,
    time: fmtTime(t?.time),
    state: t?.state ?? "",
  }));
}

export function currentLookName(status: PpStatus): string | null {
  const l = status.currentLook as Json | null;
  return l?.id?.name ?? l?.name ?? null;
}

export function stageMessageText(status: PpStatus): string | null {
  const m = status.stageMessage as unknown;
  if (typeof m === "string") return m || null;
  if (m && typeof m === "object") {
    const s = (m as Json).message;
    return typeof s === "string" ? s || null : null;
  }
  return null;
}
