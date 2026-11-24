// The widget library's pictures: a small drawing of each tile, plus one line
// on what it's for, so the Add widget list reads at a glance instead of as
// forty grey names cut off mid word. Drawn from a handful of shapes in the
// app's own colour tokens, so they follow the light and dark themes.

import type { ReactNode } from "react";

type C = "t" | "m" | "f" | "a" | "g" | "w" | "l" | "s" | "b" | "as" | "ls" | "gs";
const COL: Record<C, string> = {
  t: "var(--text)",
  m: "var(--muted)",
  f: "var(--faint)",
  a: "var(--accent)",
  g: "var(--good)",
  w: "var(--warn)",
  l: "var(--live)",
  s: "var(--surface-2)",
  b: "var(--border-hi)",
  as: "var(--accent-soft)",
  ls: "var(--live-soft)",
  gs: "var(--good-soft)",
};

/** A filled box. */
const B = (x: number, y: number, w: number, h: number, c: C = "s", r = 2) => (
  <rect x={x} y={y} width={w} height={h} rx={r} style={{ fill: COL[c] }} />
);
/** An outlined box. */
const O = (x: number, y: number, w: number, h: number, c: C = "b", r = 2) => (
  <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={r} style={{ fill: "none", stroke: COL[c] }} />
);
/** A line of "text": a thin rounded bar. */
const L = (x: number, y: number, w: number, c: C = "f", h = 3) => B(x, y, w, h, c, h / 2);
const D = (x: number, y: number, r: number, c: C) => <circle cx={x} cy={y} r={r} style={{ fill: COL[c] }} />;
const T = (x: number, y: number, s: string, size: number, c: C = "t", anchor: "start" | "middle" | "end" = "start", mono = true) => (
  <text
    x={x}
    y={y}
    textAnchor={anchor}
    style={{ fill: COL[c], fontSize: size, fontWeight: 600, fontFamily: mono ? "var(--mono)" : "var(--sans)" }}
  >
    {s}
  </text>
);
const rows = (n: number, f: (i: number) => ReactNode) => Array.from({ length: n }, (_, i) => <g key={i}>{f(i)}</g>);

const ART: Record<string, () => ReactNode> = {
  health_strip: () =>
    rows(4, (i) => (
      <>
        {B(4 + i * 29, 24, 26, 20, "s", 3)}
        {D(10 + i * 29, 34, 2.5, i === 2 ? "w" : "g")}
        {L(15 + i * 29, 32.5, 11, "m")}
      </>
    )),
  run_order: () => (
    <>
      {B(8, 8, 104, 22, "as", 3)}
      {T(14, 17, "AHORA", 6, "a")}
      {L(14, 21, 60, "t", 4)}
      {T(14, 41, "SIGUIENTE", 6, "f")}
      {L(14, 45, 48, "m")}
      {L(14, 55, 36, "f")}
    </>
  ),
  service_timeline: () => (
    <>
      {B(6, 28, 30, 10, "g", 2)}
      {B(37, 28, 22, 10, "w", 2)}
      {B(60, 28, 26, 10, "s", 2)}
      {B(87, 28, 27, 10, "s", 2)}
      {B(62, 22, 2, 22, "l", 1)}
      {L(6, 48, 20)}
      {L(94, 48, 20)}
    </>
  ),
  service_clock: () => (
    <>
      {L(42, 14, 36, "f")}
      {T(60, 44, "12:30", 20, "t", "middle")}
      {L(36, 52, 48, "g")}
    </>
  ),
  service_tracking: () =>
    rows(5, (i) => (
      <>
        {L(8, 10 + i * 11, 30, "m")}
        {B(46, 9 + i * 11, 40, 5, "s", 2)}
        {B(46, 9 + i * 11, [34, 44, 30, 40, 20][i], 5, i === 1 ? "l" : "g", 2)}
        {L(96, 10 + i * 11, 16, "f")}
      </>
    )),
  slide_preview: () => (
    <>
      {B(10, 6, 100, 56, "s", 3)}
      {L(26, 26, 68, "t", 4)}
      {L(34, 34, 52, "t", 4)}
      {B(14, 10, 16, 7, "l", 2)}
    </>
  ),
  slide_grid: () =>
    rows(6, (i) => (
      <>
        {B(8 + (i % 3) * 36, 8 + Math.floor(i / 3) * 28, 32, 18, "s", 2)}
        {L(14 + (i % 3) * 36, 15 + Math.floor(i / 3) * 28, 20, "m", 2)}
        {i === 1 && O(8 + 36, 8, 32, 18, "l", 2)}
        {L(8 + (i % 3) * 36, 29 + Math.floor(i / 3) * 28, 14, "f", 2)}
      </>
    )),
  timer: () => (
    <>
      {L(40, 12, 40, "f")}
      {T(60, 40, "12:00", 18, "t", "middle")}
      {B(16, 48, 88, 5, "s")}
      {B(16, 48, 54, 5, "a")}
    </>
  ),
  tap_link: () => (
    <>
      {O(22, 10, 26, 48, "m", 5)}
      {L(30, 50, 10, "f")}
      <path d="M58 26 a10 10 0 0 1 0 16 M64 22 a16 16 0 0 1 0 24 M70 18 a22 22 0 0 1 0 32" style={{ fill: "none", stroke: COL.a, strokeWidth: 2.5, strokeLinecap: "round" }} />
      {L(80, 30, 28, "t")}
      {L(80, 37, 20, "f")}
    </>
  ),
  lobby_tv: () => (
    <>
      {O(16, 8, 88, 46, "m", 3)}
      {B(22, 14, 76, 34, "as", 2)}
      {L(32, 26, 50, "t", 4)}
      {L(32, 34, 34, "m")}
      {B(52, 56, 16, 3, "m", 1)}
    </>
  ),
  stage_message: () => (
    <>
      {B(8, 8, 104, 22, "as", 3)}
      {T(14, 16, "EN ESCENARIO", 5.5, "a")}
      {L(14, 21, 70, "t", 4)}
      {O(8, 36, 76, 12, "b", 3)}
      {B(88, 36, 24, 12, "a", 3)}
      {B(8, 53, 30, 9, "s", 3)}
      {B(42, 53, 30, 9, "s", 3)}
    </>
  ),
  child_call: () => (
    <>
      {O(8, 6, 104, 10, "b", 2)}
      {L(12, 9.5, 40, "m")}
      {O(8, 20, 104, 18, "a", 3)}
      {T(14, 33, "57", 11, "t")}
      {L(8, 43, 70, "f")}
      {B(8, 50, 50, 12, "a", 3)}
      {B(62, 50, 50, 12, "s", 3)}
    </>
  ),
  confidence: () => (
    <>
      {B(4, 14, 112, 40, "s", 3)}
      {L(12, 26, 96, "t", 6)}
      {L(12, 37, 70, "t", 6)}
      {L(12, 47, 40, "f")}
    </>
  ),
  show_flow: () => (
    <>
      {B(14, 8, 2, 52, "b", 1)}
      {rows(5, (i) => (
        <>
          {D(15, 12 + i * 11, 3, i < 2 ? "f" : i === 2 ? "l" : "b")}
          {L(24, 10.5 + i * 11, [50, 40, 66, 46, 56][i], i === 2 ? "t" : "f", i === 2 ? 4 : 3)}
          {L(96, 10.5 + i * 11, 14, "f")}
        </>
      ))}
    </>
  ),
  plan_item: () => (
    <>
      {T(10, 16, "AHORA", 6, "l")}
      {L(10, 21, 84, "t", 6)}
      {L(10, 31, 50, "m")}
      {T(10, 48, "SIGUIENTE", 6, "f")}
      {L(10, 52, 60, "m", 4)}
    </>
  ),
  people: () =>
    rows(4, (i) => (
      <>
        {D(16, 11 + i * 14, 5, i === 3 ? "f" : "a")}
        {L(26, 8 + i * 14, 44, "m")}
        {L(26, 13 + i * 14, 28, "f", 2)}
        {D(106, 11 + i * 14, 2.5, i === 3 ? "w" : "g")}
      </>
    )),
  song_leaders: () =>
    rows(3, (i) => (
      <>
        {L(8, 9 + i * 19, 50, "t", 4)}
        {D(14, 21 + i * 19, 4, "a")}
        {L(22, 19.5 + i * 19, 30, "f")}
        {B(92, 9 + i * 19, 20, 12, "as", 3)}
        {T(102, 18 + i * 19, ["G", "D", "A"][i], 8, "a", "middle")}
      </>
    )),
  mic_assignment: () =>
    rows(5, (i) => (
      <>
        {B(8, 6 + i * 12, 14, 9, "as", 2)}
        {T(15, 13 + i * 12, String(i + 1), 6.5, "a", "middle")}
        {L(28, 9 + i * 12, [46, 36, 52, 30, 40][i], "m")}
        {L(90, 9 + i * 12, 22, "f")}
      </>
    )),
  stage_call: () => (
    <>
      {T(8, 24, "-12:00", 16, "w")}
      {rows(4, (i) => (
        <>
          {D(12 + (i % 2) * 54, 37 + Math.floor(i / 2) * 14, 3, i === 3 ? "f" : "g")}
          {L(19 + (i % 2) * 54, 35.5 + Math.floor(i / 2) * 14, 36, "m")}
        </>
      ))}
    </>
  ),
  audio_meter: () => (
    <>
      {T(8, 22, "86", 18, "g")}
      {T(36, 22, "dB", 6, "f")}
      {rows(16, (i) => {
        const h = [10, 14, 18, 22, 24, 26, 25, 23, 21, 22, 20, 17, 14, 11, 8, 6][i];
        return B(8 + i * 6.6, 60 - h, 5, h, i > 3 && i < 7 ? "w" : "g", 1);
      })}
      {B(62, 12, 50, 5, "s")}
      {B(62, 12, 34, 5, "g")}
    </>
  ),
  listen: () => (
    <>
      <path d="M44 40 v-6 a16 16 0 0 1 32 0 v6" style={{ fill: "none", stroke: COL.m, strokeWidth: 3 }} />
      {B(40, 38, 9, 14, "m", 3)}
      {B(71, 38, 9, 14, "m", 3)}
      {D(98, 52, 8, "a")}
      <path d="M95.5 48 l6 4 l-6 4 z" style={{ fill: "var(--accent-ink)" }} />
    </>
  ),
  avantis: () =>
    rows(8, (i) => (
      <>
        {B(10 + i * 13, 8, 2, 40, "b", 1)}
        {B(6 + i * 13, 8 + [12, 6, 20, 10, 16, 8, 24, 14][i], 10, 6, "m", 1.5)}
        {B(6 + i * 13, 52, 10, 8, i === 2 || i === 6 ? "l" : "s", 2)}
      </>
    )),
  key_change: () => (
    <>
      {B(10, 20, 36, 28, "s", 4)}
      {T(28, 40, "G", 16, "m", "middle")}
      <path d="M52 34 h16 m-5 -5 l5 5 l-5 5" style={{ fill: "none", stroke: COL.a, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }} />
      {B(74, 20, 36, 28, "as", 4)}
      {T(92, 40, "A", 16, "a", "middle")}
    </>
  ),
  automix: () => (
    <>
      {B(8, 6, 32, 9, "gs", 4)}
      {T(24, 12.5, "ACTIVO", 5, "g", "middle")}
      {rows(5, (i) => (
        <>
          {L(8, 22 + i * 9, 22, "m")}
          {B(36, 21 + i * 9, 76, 5, "s", 2)}
          {B(36, 21 + i * 9, [50, 62, 30, 44, 56][i], 5, "a", 2)}
        </>
      ))}
    </>
  ),
  recorder: () => (
    <>
      {D(16, 16, 6, "l")}
      {T(28, 20, "00:42:10", 10, "t")}
      {rows(24, (i) => B(8 + i * 4.4, 60 - [20, 14, 24, 18, 10, 22, 16, 26, 12, 20, 8, 18, 24, 14, 22, 10, 16, 26, 12, 18, 20, 9, 15, 22][i], 3, [20, 14, 24, 18, 10, 22, 16, 26, 12, 20, 8, 18, 24, 14, 22, 10, 16, 26, 12, 18, 20, 9, 15, 22][i], "g", 1))}
    </>
  ),
  readiness: () =>
    rows(5, (i) => (
      <>
        {D(14, 11 + i * 11, 3.5, i === 3 ? "w" : "g")}
        {L(22, 9.5 + i * 11, [56, 44, 62, 38, 50][i], "m")}
      </>
    )),
  obs: () => (
    <>
      {B(8, 6, 28, 9, "l", 4)}
      {T(22, 12.5, "EN VIVO", 5, "t", "middle")}
      {rows(6, (i) => (
        <>
          {B(8 + (i % 3) * 36, 20 + Math.floor(i / 3) * 22, 32, 18, i === 0 ? "ls" : "s", 3)}
          {i === 0 && O(8, 20, 32, 18, "l", 3)}
          {L(14 + (i % 3) * 36, 27.5 + Math.floor(i / 3) * 22, 20, i === 0 ? "t" : "m")}
        </>
      ))}
    </>
  ),
  atem: () => (
    <>
      {rows(5, (i) => (
        <>
          {B(8 + i * 21, 10, 18, 14, i === 1 ? "l" : "s", 3)}
          {B(8 + i * 21, 30, 18, 14, i === 3 ? "g" : "s", 3)}
        </>
      ))}
      {B(8, 50, 50, 11, "s", 3)}
      {T(33, 57.5, "CUT", 6, "t", "middle")}
      {B(62, 50, 50, 11, "a", 3)}
      {T(87, 57.5, "AUTO", 6, "t", "middle")}
    </>
  ),
  "atem-macros": () =>
    rows(6, (i) => (
      <>
        {B(8 + (i % 3) * 36, 10 + Math.floor(i / 3) * 26, 32, 20, i === 2 ? "as" : "s", 3)}
        {L(14 + (i % 3) * 36, 18.5 + Math.floor(i / 3) * 26, 20, i === 2 ? "a" : "m")}
      </>
    )),
  pro_macros: () =>
    rows(6, (i) => (
      <>
        {B(8 + (i % 3) * 36, 10 + Math.floor(i / 3) * 26, 32, 20, "s", 3)}
        {B(8 + (i % 3) * 36, 10 + Math.floor(i / 3) * 26, 4, 20, (["a", "w", "g", "l", "a", "m"] as C[])[i], 2)}
        {L(16 + (i % 3) * 36, 18.5 + Math.floor(i / 3) * 26, 18, "m")}
      </>
    )),
  video_input: () => (
    <>
      {B(10, 6, 100, 56, "s", 3)}
      {B(10, 44, 100, 18, "b", 0)}
      {D(40, 30, 5, "m")}
      {B(35, 35, 10, 12, "m", 3)}
      {D(76, 28, 5, "m")}
      {B(71, 33, 10, 14, "m", 3)}
      {T(104, 15, "NDI", 6, "f", "end")}
    </>
  ),
  church_online: () => (
    <>
      {T(8, 24, "214", 18, "t")}
      {L(8, 30, 30, "f")}
      {B(66, 8, 46, 14, "s", 4)}
      {L(70, 13.5, 30, "m")}
      {B(60, 26, 46, 14, "as", 4)}
      {L(64, 31.5, 34, "a")}
      {B(66, 44, 46, 14, "s", 4)}
      {L(70, 49.5, 26, "m")}
    </>
  ),
  stream_monitor: () => (
    <>
      {B(10, 6, 100, 46, "s", 3)}
      <path d="M54 20 l14 9 l-14 9 z" style={{ fill: COL.m }} />
      {D(18, 14, 3, "l")}
      {B(10, 56, 100, 5, "s")}
      {B(10, 56, 76, 5, "g")}
    </>
  ),
  walk_in_music: () => (
    <>
      {B(8, 8, 34, 34, "as", 4)}
      <path d="M22 32 v-14 l10 -3 v14" style={{ fill: "none", stroke: COL.a, strokeWidth: 2.5 }} />
      {L(50, 14, 50, "t", 4)}
      {L(50, 23, 34, "m")}
      {B(8, 50, 104, 4, "s")}
      {B(8, 50, 60, 4, "a")}
      {D(100, 30, 7, "a")}
    </>
  ),
  live_viewers: () => (
    <>
      {T(8, 24, "128", 18, "t")}
      {L(8, 30, 34, "f")}
      <polyline
        points="8,58 22,52 34,54 48,44 62,46 76,36 90,38 104,26 112,28"
        style={{ fill: "none", stroke: COL.a, strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round" }}
      />
    </>
  ),
  switcher_cues: () =>
    rows(4, (i) => (
      <>
        {B(8, 7 + i * 14, 24, 10, i === 0 ? "l" : "s", 2)}
        {T(20, 14 + i * 14, `CAM ${[2, 1, 3, 2][i]}`, 5, i === 0 ? "t" : "m", "middle")}
        {L(38, 10.5 + i * 14, [56, 44, 64, 40][i], i === 0 ? "t" : "f")}
      </>
    )),
  crew_qr: () => (
    <>
      {B(36, 6, 48, 48, "t", 3)}
      {rows(25, (i) => (([0, 1, 4, 5, 6, 8, 11, 12, 13, 15, 16, 18, 19, 20, 22, 24].includes(i) ? B(40 + (i % 5) * 8, 10 + Math.floor(i / 5) * 8, 7, 7, "s", 0.5) : null)))}
      {L(40, 60, 40, "f")}
    </>
  ),
  clock: () => (
    <>
      {T(60, 40, "10:42", 22, "t", "middle")}
      {L(42, 50, 36, "f")}
    </>
  ),
  checklist: () =>
    rows(5, (i) => (
      <>
        {i < 3 ? B(8, 7 + i * 11, 8, 8, "g", 2) : O(8, 7 + i * 11, 8, 8, "b", 2)}
        {L(22, 9.5 + i * 11, [60, 48, 70, 52, 40][i], i < 3 ? "f" : "m")}
      </>
    )),
};

/** One plain line per tile, for the widget library. */
export const WIDGET_BLURBS: Record<string, string> = {
  health_strip: "Estado de Pro, Planning Center, audio y consola por color.",
  run_order: "Lo que está en curso y lo que sigue, desde Planning Center.",
  service_timeline: "Todo el evento en una barra, con el avance y el ritmo actual.",
  service_clock: "Cuenta regresiva hasta el próximo evento.",
  service_tracking: "Tiempo planeado de cada elemento comparado con su duración real.",
  slide_preview: "La diapositiva que está en pantalla ahora.",
  slide_grid: "Diapositivas de la lista. Toca una para mostrarla.",
  timer: "Temporizador de ProPresenter con inicio, parada y reinicio.",
  tap_link: "Lo que abre ahora el enlace NFC para donaciones.",
  lobby_tv: "Lo que muestran las TV del vestíbulo.",
  stage_message: "Muestra un mensaje en la Pantalla Retorno.",
  child_call: "Muestra el código de un niño con un mensaje de ProPresenter.",
  confidence: "Texto grande para que lo lean la banda y el pastor.",
  show_flow: "Orden del evento con el elemento en curso marcado.",
  plan_item: "En curso y próximo en letras grandes.",
  people: "Quiénes participan y si ya llegaron.",
  song_leaders: "Cada canción con su tonalidad y su líder.",
  mic_assignment: "Qué micrófono usa cada persona.",
  stage_call: "Quién sigue en el escenario y cuánto falta.",
  audio_meter: "Nivel de sonido de la sala y su espectro en vivo.",
  listen: "Escucha el audio del evento en esta pantalla.",
  avantis: "Muteos y faders de la consola de sonido.",
  key_change: "Envía la tonalidad de la canción a Waves.",
  automix: "Automix ajusta la mezcla. Mira lo que está haciendo.",
  recorder: "Inicia y supervisa la grabación multipista.",
  readiness: "Lista de tareas para preparar el evento.",
  obs: "Escenas de OBS con la que está en vivo marcada.",
  atem: "Program y Preview con Cut y Auto.",
  "atem-macros": "Ejecuta macros de ATEM con un toque.",
  pro_macros: "Ejecuta macros de ProPresenter con un toque.",
  video_input: "Video de la cámara del escenario por NDI.",
  church_online: "Espectadores, peticiones de oración y salvaciones de Church Online.",
  stream_monitor: "Supervisa la transmisión en vivo y su estado.",
  walk_in_music: "Reproduce música de entrada que se desvanece antes de cada evento.",
  live_viewers: "Cuántas personas están mirando en línea.",
  switcher_cues: "Qué cámara sigue en cada momento.",
  crew_qr: "Código que los voluntarios escanean para unirse al equipo.",
  clock: "La hora en grande.",
  checklist: "Una de tus listas de tareas para marcar lo completado.",
};

export function WidgetPreview({ type }: { type: string }) {
  const art = ART[type];
  return (
    <svg className="wpick-art" viewBox="0 0 120 68" aria-hidden="true" focusable="false">
      {art ? art() : (
        <>
          {L(10, 14, 60, "m", 4)}
          {L(10, 26, 90)}
          {L(10, 36, 70)}
        </>
      )}
    </svg>
  );
}
