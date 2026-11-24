import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import defaults from "../lib/demoSettingsDefaults.json";
import { demoInvoke } from "../lib/demo";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

// Set the external webview environment BEFORE App/tauri evaluate their layout
// constants. No tauri wrapper, component, provider, hook or dirty flag is mocked.
const io = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  Object.defineProperty(window, "matchMedia", {
    configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  return { invoke: vi.fn(), check: vi.fn(), download: vi.fn(), relaunch: vi.fn(), unlisten: vi.fn() };
});
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...await original<typeof import("@tauri-apps/api/core")>(), invoke: io.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => io.unlisten }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.3" }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: io.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: io.relaunch }));
import App from "../App";
import { SEEN_KEY, WHATS_NEW_EDITION } from "../lib/whatsNew";

let host: HTMLDivElement;
let root: Root;
const savedHost = "booth.example.invalid";
const editedHost = "  Home / page_ack / 東京  ";
const newVersion = "2.4.6-home";
const notes = "# Release Home 東京\n- Keep page_ack English\nRaw diagnostic stays in English.";
function update() { return { version: newVersion, body: notes, downloadAndInstall: io.download }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network forbidden in desktop tests")));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  localStorage.setItem(SEEN_KEY, WHATS_NEW_EDITION);
  io.unlisten.mockReset();
  io.relaunch.mockReset().mockResolvedValue(undefined);
  io.check.mockReset().mockResolvedValue(update());
  io.download.mockReset().mockResolvedValue(undefined);
  io.invoke.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    // Full application settings shape, answered at the native host boundary.
    if (command === "get_settings") return { ...structuredClone(defaults), pp_host: savedHost, crash_reports: false };
    if (command === "load_dashboards") return [{ id: "desktop-fixture", name: "Home page_ack 東京", widgets: [] }];
    if (command === "identity_list") return [];
    if (command === "pp_is_connected") return false;
    if (command === "pco_get") return { data: [] };
    if (command === "release_single_instance") return undefined;
    if (command === "relaunch_after_update") throw new Error("synthetic host fallback");
    // Reuse the repository's existing shaped host fixtures, not substitute
    // implementations of providers. App is still native, NOT in demo mode.
    return demoInvoke(command, args);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});
async function mount() {
  await act(async () => root.render(<App />));
  expect(host.querySelector(".app > .sidebar")).not.toBeNull();
  expect(host.querySelector(".web-login, .tally, .demo-banner")).toBeNull();
  expect(host.querySelector(".nav-item.active span")?.textContent).toBe("Panel");
}
async function click(label: string, within: ParentNode = host) {
  const button = [...within.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}
function hostInput() {
  const input = host.querySelector("h3#set-pp")?.closest("section")?.querySelector("input");
  expect(input, "actual Settings pp_host input").toBeInstanceOf(HTMLInputElement);
  return input!;
}
async function editSettings() {
  await click("Configuración", host.querySelector(".nav")!);
  expect(history.state.page).toBe("settings");
  const input = hostInput();
  expect(input.value).toBe(savedHost);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, editedHost);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(hostInput().value).toBe(editedHost);
}
function dialog() {
  const result = host.querySelector(".dlg");
  expect(result).not.toBeNull();
  expect(result!.querySelector(".dlg-title")?.textContent).toBe("¿Salir de Configuración sin guardar los cambios?");
  expect([...result!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancelar", "Salir sin guardar"]);
  return result!;
}
function noSettingsWrite() {
  expect(io.invoke.mock.calls.filter(([command]) => command === "update_settings")).toEqual([]);
}
async function checkAvailable() {
  await mount();
  expect(io.check).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(io.check.mock.calls).toEqual([[]]);
  expect(host.querySelector(".update-announce-title strong")?.textContent).toBe(`ProDeck v${newVersion} está listo para instalar`);
  expect(host.querySelector(".update-announce-title .muted")?.textContent).toBe("Tienes la versión v1.2.3. La instalación toma unos segundos y reinicia la aplicación.");
}

describe("real desktop App preservation through external I/O only", () => {
  it("keeps a real edited Settings form on cancel and navigates on confirmation", async () => {
    await mount();
    await editSettings();
    await click("Panel", host.querySelector(".nav")!);
    await click("Cancelar", dialog());
    expect(host.querySelector(".dlg")).toBeNull();
    expect(history.state.page).toBe("settings");
    expect(hostInput().value).toBe(editedHost);
    noSettingsWrite();
    await click("Panel", host.querySelector(".nav")!);
    await click("Salir sin guardar", dialog());
    expect(host.querySelector(".dlg, h3#set-pp")).toBeNull();
    expect(history.state.page).toBe("dashboard");
    expect(host.querySelector(".nav-item.active span")?.textContent).toBe("Panel");
    noSettingsWrite();
  });
  it("also preserves cancel and confirm through the actual history back guard", async () => {
    await mount();
    await editSettings();
    await act(async () => { history.back(); await vi.advanceTimersByTimeAsync(10); });
    await click("Cancelar", dialog());
    expect(hostInput().value).toBe(editedHost);
    expect(history.state.page).toBe("settings");
    await act(async () => { history.back(); await vi.advanceTimersByTimeAsync(10); });
    await click("Salir sin guardar", dialog());
    expect(host.querySelector(".dlg, h3#set-pp")).toBeNull();
    expect(host.querySelector(".nav-item.active span")?.textContent).toBe("Panel");
    expect(history.state.page).toBe("dashboard");
    noSettingsWrite();
  });
  it("preserves incoming release copy, notes toggle, Later and version-specific storage", async () => {
    await checkAvailable();
    expect(host.querySelector(".update-announce-body h4")?.textContent).toBe("Release Home 東京");
    expect(host.querySelector(".update-announce-body li")?.textContent).toBe("Keep page_ack English");
    expect(host.querySelector(".update-announce-body p")?.textContent).toBe("Raw diagnostic stays in English.");
    expect(host.querySelector(".update-announce-toggle")?.textContent).toBe("Novedades ▾");
    await click("Novedades ▾");
    expect(host.querySelector(".update-announce-body")).toBeNull();
    await click("Novedades ▸");
    expect(host.querySelector(".update-announce-body p")?.textContent).toBe("Raw diagnostic stays in English.");
    await click("Más tarde");
    expect(host.querySelector(".update-announce")).toBeNull();
    expect(localStorage.getItem("prodeck.updateDismissed")).toBe(newVersion);
    expect(io.download).not.toHaveBeenCalled();
    expect(io.relaunch).not.toHaveBeenCalled();
  });
  it("renders download progress and Ready before host release, then keeps relaunch actions", async () => {
    const download = deferred<void>();
    const release = deferred<void>();
    let progress!: (event: DownloadEvent) => void;
    io.download.mockImplementation((callback: typeof progress) => { progress = callback; return download.promise; });
    const initialInvoke = io.invoke.getMockImplementation()!;
    io.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => command === "release_single_instance" ? release.promise : initialInvoke(command, args));
    await checkAvailable();
    await click("Actualizar y reiniciar");
    expect(io.download).toHaveBeenCalledTimes(1);
    expect(io.download.mock.calls[0]).toHaveLength(1);
    expect(host.querySelector(".update-banner > span")?.textContent).toBe("Descargando actualización… 0%");
    await act(async () => {
      progress({ event: "Started", data: { contentLength: 200 } });
      progress({ event: "Progress", data: { chunkLength: 50 } });
    });
    expect(host.querySelector(".update-banner > span")?.textContent).toBe("Descargando actualización… 25%");
    expect((host.querySelector(".update-fill") as HTMLElement).style.width).toBe("25%");
    await act(async () => progress({ event: "Finished" }));
    expect(host.querySelector(".update-banner > span")?.textContent).toBe("Descargando actualización… 100%");
    await act(async () => download.resolve());
    expect(host.querySelector(".update-banner > span")?.textContent).toBe("Reiniciando…");
    expect(io.invoke.mock.calls.filter(([command]) => /^(release_single_instance|relaunch_after_update)$/.test(command))).toEqual([["release_single_instance", undefined]]);
    expect(io.relaunch).not.toHaveBeenCalled();
    await act(async () => release.resolve());
    expect(io.invoke.mock.calls.filter(([command]) => /^(release_single_instance|relaunch_after_update)$/.test(command))).toEqual([["release_single_instance", undefined], ["relaunch_after_update", undefined]]);
    expect(io.relaunch.mock.calls).toEqual([[]]);
    expect(localStorage.getItem("prodeck.updateDismissed")).toBeNull();
  });
  it("preserves raw install/check failures, retry, manual URL and dismissal", async () => {
    const raw = "Error: raw Home 東京 / page_ack";
    io.download.mockRejectedValue(new Error("raw Home 東京 / page_ack"));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await checkAvailable();
    await click("Actualizar y reiniciar");
    expect(host.querySelector(".update-banner.err strong")?.parentElement?.textContent).toBe(`No se instaló la actualización. ${raw}`);
    await click("Descargar manualmente");
    expect(open.mock.calls).toEqual([["https://github.com/whiteoakmedia/prodeck/releases/latest", "_blank", "noopener"]]);
    io.check.mockRejectedValueOnce(new Error("retry diagnostic stays English"));
    await click("Reintentar");
    expect(io.check.mock.calls).toEqual([[], []]);
    expect(host.querySelector(".update-banner.err strong")?.parentElement?.textContent).toBe("No se instaló la actualización. Error: retry diagnostic stays English");
    await click("Cerrar");
    expect(host.querySelector(".update-banner, .update-announce")).toBeNull();
    expect(localStorage.getItem("prodeck.updateDismissed")).toBe(newVersion);
    expect(io.download).toHaveBeenCalledTimes(1);
    expect(io.relaunch).not.toHaveBeenCalled();
  });
});
