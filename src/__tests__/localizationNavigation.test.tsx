import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import navigation from "./fixtures/localization/navigationBaseline.json";
import connections from "./fixtures/localization/connectionsBaseline.json";
import {
  NeedsConnection, NeedsPro, NeedsPco, NeedsDesk, NeedsAudio, NeedsObs,
  NeedsAtem, NeedsGa4, NeedsTap, NeedsWeb, NeedsNdi,
} from "../components/NeedsConnection";

const boundary = vi.hoisted(() => ({ navigate: vi.fn(), kiosk: null as string | null }));
vi.mock("../lib/navigate", () => ({ requestNavigate: boundary.navigate }));
vi.mock("../lib/tauri", () => ({ get KIOSK_DASH() { return boundary.kiosk; } }));

// Registered HERE only: App.tsx and NeedsConnection.tsx. The central guard
// remains unchanged. This hash freezes the full ordered AST/token projection
// from the pre-migration source, not just identifiers selected by these tests.
// Ordinary comments and non-JSX trivia are absent; JSDoc nodes, JSX whitespace
// and every unreviewed literal/expression remain exact. No baseline regeneration
// mode is provided. English JSDoc examples are frozen with the original source.
type Baseline = typeof navigation;
function inspect(text: string, baseline: Baseline) {
  const source = ts.createSourceFile(baseline.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const slots = new Map(baseline.slots.map((s) => [s.path, s]));
  const seen = new Map<string, string>();
  function walk(node: ts.Node, path: number[]): unknown {
    const children = node.getChildren(source);
    if (children.length) return [node.kind, children.map((child, i) => walk(child, [...path, i]))];
    const value = ts.isJsxText(node) ? node.text : node.getText(source);
    const key = path.join(".");
    const slot = slots.get(key);
    if (!slot) return [node.kind, value];
    if (value !== slot.original && value !== slot.spanish) throw new Error(`Unreviewed copy at ${key}`);
    seen.set(key, value);
    return [node.kind, `COPY:${key}`];
  }
  const hash = createHash("sha256").update(JSON.stringify(walk(source, []))).digest("hex");
  if (seen.size !== slots.size || hash !== baseline.sha256) throw new Error(`Protected structure changed: ${baseline.file}`);
  return seen;
}
const sources = new Map([navigation, connections].map((b) => [b.file, readFileSync(b.file, "utf8")]));

describe("bounded navigation and connection source contracts", () => {
  for (const baseline of [navigation, connections]) {
    it(`preserves the frozen executable structure of ${baseline.file}`, () => {
      expect(inspect(sources.get(baseline.file)!, baseline).size).toBe(baseline.slots.length);
    });
    it(`translates every reviewed slot in ${baseline.file}`, () => {
      const seen = inspect(sources.get(baseline.file)!, baseline);
      for (const slot of baseline.slots) expect(seen.get(slot.path), slot.path).toBe(slot.spanish);
    });
    it(`accepts the exact original copy for manual baseline review of ${baseline.file}`, () => {
      // In-memory reconstruction from the explicitly reviewed slot pairs only.
      let original = sources.get(baseline.file)!;
      for (const slot of baseline.slots) original = original.replace(slot.spanish, slot.original);
      expect(inspect(original, baseline).size).toBe(baseline.slots.length);
    });
  }
  const mutations: [Baseline, string, string][] = [
    [navigation, 'id: "dashboard"', 'id: "settings"'],
    [navigation, 'icon: "dashboard"', 'icon: "settings"'],
    [navigation, "setPage(n.id)", 'setPage("help")'],
    [navigation, 'switchLayout("crew")', 'switchLayout("desktop")'],
    [navigation, '<span className="brand-name">ProDeck</span>', '<span className="brand-name"> ProDeck</span>'],
    [navigation, 'label: "ProPresenter"', 'label: "Evento"'],
    [navigation, 'setPage(n.id)', 'setPage(n.id); requestSettingsJump("set-pp")'],
    [connections, 'page="planning"', 'page="settings"'],
    [connections, 'anchor="set-pp"', 'anchor="set-obs"'],
    [connections, 'requestNavigate(page, anchor)', 'requestNavigate(page, "set-obs")'],
    [connections, 'onAction ? onAction()', 'onAction ? onAction'],
    [connections, 'hint ??', '"Overridden" ??'],
    [connections, 'icon="slides"', 'icon="mic"'],
    [connections, '{...p}', '{...{}}'],
    [connections, 'KIOSK_DASH !== null', 'KIOSK_DASH === null'],
    [connections, '${what}', '${page}'],
  ];
  it.each(mutations)("rejects unapproved structure in %j: %s → %s", (baseline, before, after) => {
    const source = sources.get(baseline.file)!;
    expect(source).toContain(before);
    expect(() => inspect(source.replace(before, after), baseline)).toThrow();
  });
  it("rejects arbitrary JSX expressions and unreviewed wording in copy slots", () => {
    const source = sources.get(navigation.file)!;
    const slot = navigation.slots.find((s) => s.original === "Messages")!;
    for (const replacement of ['{String("Mensajes")}', "Otros mensajes", " Mensajes "]) {
      const actual = source.includes(`<span>${slot.spanish}</span>`) ? slot.spanish : slot.original;
      expect(() => inspect(source.replace(`<span>${actual}</span>`, `<span>${replacement}</span>`), navigation)).toThrow();
    }
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  boundary.kiosk = null;
  boundary.navigate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function mount(node: ReactNode) { await act(async () => root.render(node)); }
async function click() { await act(async () => host.querySelector("button")!.click()); }
const presets = [
  [NeedsPro, "Conecta ProPresenter para ver diapositivas y temporizadores en vivo", "Configurar ProPresenter", "settings", "set-pp"],
  [NeedsPco, "Conecta Planning Center para ver el plan y el equipo de esta semana", "Configurar Planning Center", "planning", undefined],
  [NeedsDesk, "Conecta tu consola de audio Allen & Heath para ver los silenciamientos y faders", "Configurar la consola de audio", "settings", "set-avantis"],
  [NeedsAudio, "Inicia el monitoreo de audio para ver el SPL y el RTA", "Configurar audio", "settings", "set-audio"],
  [NeedsObs, "Conecta OBS Studio para ver la escena y saber si estás en vivo", "Configurar OBS", "settings", "set-obs"],
  [NeedsAtem, "Conecta tu Blackmagic ATEM para ver Program y Preview y cambiar desde aquí", "Configurar el mezclador", "settings", "set-atem"],
  [NeedsGa4, "Conecta Google Analytics para ver los espectadores en vivo", "Configurar Google Analytics", "settings", "set-ga4"],
  [NeedsTap, "Activa TapLink para ver a dónde apuntan los discos NFC", "Configurar TapLink", "settings", "set-taplink"],
  [NeedsWeb, "Activa el acceso desde el navegador para conectar teléfonos y pantallas", "Configurar el acceso desde el navegador", "settings", "set-web"],
  [NeedsNdi, "Elige una fuente NDI para ver la señal del escenario. Edita este panel para elegir una", null, "dashboard", undefined],
] as const;

describe("mounted connection prompts through public props", () => {
  it.each(presets)("renders preset %# copy and preserves its destination and anchor", async (Preset, hint, action, page, anchor) => {
    await mount(<Preset />);
    expect(host.querySelector("p")?.textContent).toBe(hint);
    expect(host.querySelector("button")?.textContent ?? null).toBe(action);
    if (action) {
      await click();
      expect(boundary.navigate.mock.calls).toEqual([[page, anchor]]);
    } else expect(boundary.navigate).not.toHaveBeenCalled();
  });
  it("localizes defaults without translating caller dependency names or routing values", async () => {
    const what = "  Home page_ack 東京  ";
    await mount(<NeedsConnection what={what} page="settings" />);
    expect(host.querySelector("p")?.textContent).toBe(`Conecta ${what} para ver este contenido`);
    expect(host.querySelector("button")?.textContent).toBe("Abrir Configuración");
    await click();
    expect(boundary.navigate.mock.calls).toEqual([["settings", undefined]]);
    await mount(<NeedsConnection what={what} page="caller-route" anchor="caller-anchor" />);
    expect(host.querySelector("button")?.textContent).toBe(`Configurar ${what}`);
    await click();
    expect(boundary.navigate).toHaveBeenLastCalledWith("caller-route", "caller-anchor");
  });
  it("preserves every preset's caller overrides and callback precedence", async () => {
    const callback = vi.fn();
    const down = vi.fn();
    for (const [Preset] of presets) {
      await mount(<div onMouseDown={down}><Preset what="Home" hint="  Caller hint 東京  " action="Keep English / page_ack" page="custom-page" anchor="custom-anchor" onAction={callback} /></div>);
      expect(host.querySelector("p")?.textContent).toBe("  Caller hint 東京  ");
      expect(host.querySelector("button")?.textContent).toBe("Keep English / page_ack");
      await act(async () => host.querySelector("button")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
      await click();
    }
    expect(callback).toHaveBeenCalledTimes(presets.length);
    expect(down).not.toHaveBeenCalled();
    expect(boundary.navigate).not.toHaveBeenCalled();
    await mount(<NeedsPro hint="" action="" />);
    expect(host.querySelector("p")?.textContent).toBe("");
    expect(host.querySelector("button")).toBeNull();
    await mount(<NeedsPro hint="Original" action="Original action" page="custom-page" anchor="custom-anchor" />);
    await click();
    expect(boundary.navigate.mock.calls).toEqual([["custom-page", "custom-anchor"]]);
  });
  it("preserves offline, null action and kiosk button suppression", async () => {
    await mount(<NeedsConnection what="Caller OBS" page="settings" offline />);
    expect(host.querySelector("p")?.textContent).toBe("Caller OBS sin conexión. Reconectando…");
    expect(host.querySelector(".offline")).not.toBeNull();
    expect(host.querySelector("button")).toBeNull();
    await mount(<NeedsConnection what="OBS" page="settings" offline action="Retry original" />);
    await click();
    expect(boundary.navigate.mock.calls).toEqual([["settings", undefined]]);
    await mount(<NeedsConnection what="OBS" page="settings" action={null} />);
    expect(host.querySelector("button")).toBeNull();
    boundary.kiosk = "Original kiosk";
    await mount(<NeedsPro action="Caller action" />);
    expect(host.querySelector("button")).toBeNull();
    expect(boundary.navigate).toHaveBeenCalledTimes(1);
  });
});
