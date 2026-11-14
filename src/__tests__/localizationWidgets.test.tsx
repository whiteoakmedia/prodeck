import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import { WIDGETS, WIDGET_MAP, WIDGET_GROUP_ORDER } from "../widgets/registry";
import { WidgetPreview, WIDGET_BLURBS } from "../widgets/previews";
import { glossary } from "../lib/uiText";
import copy from "./fixtures/localization/widgetsCopy.json";
import { loadDashboards, saveDashboards } from "../lib/dashboards";

vi.mock("../store", () => ({ useProDeck: () => ({ connected: true, settings: {}, connect: vi.fn() }) }));
vi.mock("../relayStore", () => ({ useRelay: () => ({ mode: "host" }) }));
vi.mock("../lib/perms", () => ({ usePerms: () => ({ isAdmin: true, loaded: true }) }));
vi.mock("../lib/dashboards", async (original) => ({
  ...await original<typeof import("../lib/dashboards")>(), loadDashboards: vi.fn(), saveDashboards: vi.fn(async () => {}), newId: () => "added-widget",
}));
vi.mock("react-grid-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>, WidthProvider: (component: unknown) => component,
}));
vi.mock("../components/DashTopBar", () => ({ DashTopBar: (props: {
  active: { name: string }; onAddWidget: () => void; onToggleEdit: () => void;
}) => <header><h1>{props.active.name}</h1><button onClick={props.onAddWidget}>Open picker</button><button onClick={props.onToggleEdit}>Toggle edit</button></header> }));
// The renderer is an external boundary to this catalog slice. Keep real metadata,
// and expose the exact config/update props without running operational widgets.
vi.mock("../widgets/registry", async (original) => {
  const registry = await original<typeof import("../widgets/registry")>();
  const widgets = registry.WIDGETS.map((def) => ({ ...def, component: ({ widget, update }: import("../widgets/registry").WidgetProps) =>
    <button className="probe" onClick={() => update({ probe: "Home page_ack" })}>{widget.config.title}</button> }));
  return { ...registry, WIDGETS: widgets, WIDGET_MAP: Object.fromEntries(widgets.map((w) => [w.type, w])) };
});

let host: HTMLDivElement;
let root: Root;
const saved = [{ id: "saved", name: "Dashboard Home 東京", widgets: [{ id: "original", type: "run_order", x: 2, y: 3, w: 4, h: 4, config: { title: "Run Order Home 東京", custom: "service" } }] }];
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in localization tests"); }));
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  localStorage.clear();
  vi.mocked(loadDashboards).mockResolvedValue(structuredClone(saved));
  vi.mocked(saveDashboards).mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(node: ReactNode = <Dashboard onNavigate={vi.fn()} />) { await act(async () => root.render(node)); }
async function click(selector: string) { await act(async () => (host.querySelector(selector) as HTMLButtonElement).click()); }
async function search(query: string) {
  const input = host.querySelector<HTMLInputElement>(".wpick-search")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const names = () => [...host.querySelectorAll(".wpick-name")].map((n) => n.textContent);

describe("es-419 widget catalog and picker", () => {
  it("renders every reviewed registry label and blurb, preserving lookup identity", () => {
    expect(WIDGETS).toHaveLength(39);
    for (const def of WIDGETS) {
      const expected = copy.labels[def.type as keyof typeof copy.labels][1];
      expect(def.label, def.type).toBe(expected.startsWith("glossary.") ? glossary[expected.slice(9) as keyof typeof glossary] : expected);
      expect(WIDGET_MAP[def.type]).toBe(def);
      expect(WIDGET_BLURBS[def.type]).toBe(copy.blurbs[def.type as keyof typeof copy.blurbs][1]);
      expect(WIDGET_BLURBS[def.type].length).toBeLessThanOrEqual(80);
      expect(def.label + WIDGET_BLURBS[def.type]).not.toMatch(/[—–]| - /);
    }
  });
  it("keeps technical group order separate from Spanish display", async () => {
    const { WIDGET_GROUP_LABELS } = await import("../lib/widgetText");
    expect(WIDGET_GROUP_ORDER).toEqual(["Mission Control", "ProPresenter", "Planning Center", "Audio", "Video", "General"]);
    expect(WIDGET_GROUP_ORDER.map((g) => WIDGET_GROUP_LABELS[g])).toEqual(["Centro de control", "ProPresenter", "Planning Center", "Audio", "Video", "General"]);
    await mount(); await click("header button");
    expect([...host.querySelectorAll(".wpick-gh")].map((n) => n.textContent)).toEqual(WIDGET_GROUP_ORDER.map((g) => WIDGET_GROUP_LABELS[g]));
    for (const [index, group] of WIDGET_GROUP_ORDER.entries()) {
      const rendered = host.querySelectorAll(".wpick-group")[index];
      expect([...rendered.querySelectorAll(".wpick-name")].map((n) => n.textContent)).toEqual(WIDGETS.filter((w) => w.group === group).map((w) => w.label));
    }
  });
  it("searches displayed Spanish label, blurb and group without crossing group identity", async () => {
    await mount(); await click("header button");
    expect(host.querySelector<HTMLInputElement>(".wpick-search")?.placeholder).toBe("Buscar widgets, como diapositivas, micrófonos o cuenta regresiva");
    await search("  AHORA Y SIGUIENTE  "); expect(names()).toEqual(["Ahora y siguiente", "Ahora / Siguiente"]);
    await search("espectro"); expect(names()).toEqual(["SPL + RTA"]);
    await search("centro de control");
    expect(names()).toEqual(WIDGETS.filter((w) => w.group === "Mission Control").map((w) => w.label));
    await search("ProPresenter"); expect(names()).toContain("Temporizador");
    await search("ninguna coincidencia"); expect(names()).toEqual([]);
    await search(""); expect(names()).toHaveLength(39);
    expect(saveDashboards).not.toHaveBeenCalled();
  });
  it("adds the same technical type/default config and preserves saved titles, dimensions and callbacks", async () => {
    await mount();
    expect(host.querySelector("h1")?.textContent).toBe(saved[0].name);
    expect(host.querySelector(".probe")?.textContent).toBe(saved[0].widgets[0].config.title);
    expect(saveDashboards).not.toHaveBeenCalled();
    await click("header button"); await search("tiempos del crono"); await click(".wpick-item");
    expect(host.querySelector(".wpick")).toBeNull();
    expect(host.querySelectorAll(".widget-title")[1].textContent).toBe("Tiempos del Crono");
    await act(async () => vi.advanceTimersByTime(400));
    expect(saveDashboards).toHaveBeenLastCalledWith([{ ...saved[0], widgets: [saved[0].widgets[0], {
      id: "added-widget", type: "service_timeline", x: 0, y: 7, w: 6, h: 2, config: {},
    }] }]);
    await click(".probe");
    await act(async () => vi.advanceTimersByTime(400));
    const latest = vi.mocked(saveDashboards).mock.calls.at(-1)![0];
    expect(latest[0].widgets[0]).toEqual({ ...saved[0].widgets[0], config: { ...saved[0].widgets[0].config, probe: "Home page_ack" } });
    await click("header button"); expect(host.querySelector<HTMLInputElement>(".wpick-search")?.value).toBe("");
  });
  it("localizes empty-dashboard guidance without changing its edit/add action", async () => {
    vi.mocked(loadDashboards).mockResolvedValue([{ ...saved[0], widgets: [] }]);
    await mount();
    expect(host.querySelector(".dash-empty h2")?.textContent).toBe("Este panel está vacío");
    expect(host.querySelector(".dash-empty p")?.textContent?.trim()).toBe("Activa Editar y agrega widgets para armar tu diseño.");
    expect(host.querySelector(".dash-empty button")?.textContent?.trim()).toBe("Comenzar");
    await click(".dash-empty button"); expect(names()).toHaveLength(39);
    expect(host.querySelector(".dash-empty button")).toBeNull();
    expect(saveDashboards).not.toHaveBeenCalled();
  });
  it("localizes only owned preview captions and retains protocols and musical keys", async () => {
    await mount(<><WidgetPreview type="run_order" /><WidgetPreview type="stage_message" /><WidgetPreview type="automix" /><WidgetPreview type="obs" /><WidgetPreview type="atem" /><WidgetPreview type="video_input" /><WidgetPreview type="song_leaders" /></>);
    expect([...host.querySelectorAll("text")].map((n) => n.textContent)).toEqual(["AHORA", "SIGUIENTE", "EN ESCENARIO", "ACTIVO", "EN VIVO", "CUT", "AUTO", "NDI", "G", "D", "A"]);
  });
});
