import { invoke } from "./tauri";

export interface Widget {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, any>;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: Widget[];
  /**
   * Play the room's audio on any kiosk showing this dashboard, with no tile.
   * The Overflow Listen widget did this AND took a tile; on a TV in a room
   * where people are eating, the audio is wanted and the tile is not.
   */
  audio?: boolean;
}

export const loadDashboards = () =>
  invoke<Dashboard[] | null>("load_dashboards");
export const saveDashboards = (data: Dashboard[]) =>
  invoke<void>("save_dashboards", { data });

export const newId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));

// ---- Role-based dashboard templates ----------------------------------------
const mk = (
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
  config: Record<string, any> = {},
): Widget => ({ id: newId(), type, x, y, w, h, config });

export interface DashboardTemplate {
  key: string;
  name: string;
  blurb: string;
  build: () => Widget[];
  /** Play the room's audio on kiosks showing this dashboard (no tile). */
  audio?: boolean;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: "foh",
    name: "FOH Mixer",
    blurb: "SPL + RTA, the mic channel wall, and where we are in the service.",
    build: () => [
      mk("health_strip", 0, 0, 12, 2),
      mk("audio_meter", 0, 2, 5, 5),
      mk("run_order", 5, 2, 4, 4),
      mk("timer", 9, 2, 3, 3),
      mk("clock", 9, 5, 3, 2),
      mk("avantis", 0, 7, 12, 6),
    ],
  },
  {
    key: "pm",
    name: "Production Manager",
    blurb: "Run-of-show timing, the rundown, current slide, camera, audio and tracking.",
    build: () => [
      mk("health_strip", 0, 0, 12, 2),
      mk("service_clock", 0, 2, 3, 3),
      mk("run_order", 3, 2, 5, 3),
      mk("service_timeline", 8, 2, 4, 3),
      mk("show_flow", 0, 5, 4, 6),
      mk("slide_preview", 4, 5, 4, 5),
      mk("video_input", 8, 5, 4, 5),
      mk("audio_meter", 4, 10, 4, 4),
      mk("service_tracking", 8, 10, 4, 4),
    ],
  },
  {
    key: "director",
    name: "Director — Overview",
    blurb: "Everything at a glance: health, countdown, camera, slide, rundown, audio, tracking.",
    build: () => [
      mk("health_strip", 0, 0, 12, 2),
      mk("service_clock", 0, 2, 3, 3),
      mk("run_order", 3, 2, 5, 4),
      mk("service_timeline", 8, 2, 4, 2),
      mk("video_input", 8, 4, 4, 5),
      mk("slide_preview", 0, 5, 5, 5),
      mk("show_flow", 5, 6, 3, 6),
      mk("audio_meter", 0, 10, 5, 4),
      mk("service_tracking", 8, 9, 4, 5),
    ],
  },
  {
    key: "greenroom",
    name: "Green Room",
    blurb: "For a TV where the team waits: where we are, when they're on, the closing set and its keys — and the room's audio with no tile.",
    audio: true,
    build: () => [
      mk("stage_call", 0, 0, 7, 4),
      mk("service_clock", 7, 0, 5, 2),
      mk("live_viewers", 7, 2, 2, 2),
      mk("clock", 9, 2, 3, 2),
      mk("show_flow", 0, 4, 4, 4),
      mk("song_leaders", 4, 4, 4, 4),
      mk("plan_item", 8, 4, 4, 4),
    ],
  },
  {
    key: "worship",
    name: "Mics & Worship Team",
    blurb: "The mic channel wall, assignment grid, team roster, and set order.",
    build: () => [
      mk("avantis", 0, 0, 12, 6),
      mk("mic_assignment", 0, 6, 5, 5),
      mk("people", 5, 6, 3, 5),
      mk("run_order", 8, 6, 4, 4),
      mk("clock", 8, 10, 4, 2),
    ],
  },
];

export function defaultDashboards(): Dashboard[] {
  // Seed the first-run dashboard from the Director overview template, so the
  // out-of-box view actually covers the booth — system health, run order,
  // countdown, camera, current slide, rundown, audio, and tracking — instead of
  // the old graphics-only layout. Generated from the template so the two can't
  // drift apart.
  const director =
    DASHBOARD_TEMPLATES.find((t) => t.key === "director") ?? DASHBOARD_TEMPLATES[0];
  return [
    {
      id: newId(),
      name: "Overview",
      widgets: director.build(),
    },
  ];
}
