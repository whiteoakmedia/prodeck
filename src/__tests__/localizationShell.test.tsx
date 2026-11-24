import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the host/network boundary is replaced. App, WebGate, TallyPage and their
// imports are real. Tally is App's existing lightweight public return path.
const hostApi = vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
  return { token: "", settings: vi.fn(), cloud: vi.fn(), save: vi.fn() };
});
vi.mock("../lib/tauri", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/tauri")>(),
  IS_WEB: true, IS_DEMO: false, IS_SHOTS: false, TALLY_PARAM: "Home page_ack 東京",
  getWebToken: () => hostApi.token,
  setWebToken: (value: string) => { hostApi.token = value; hostApi.save(value); },
  getSettings: hostApi.settings, cloudPasswordOk: hostApi.cloud,
  on: async () => () => {}, onGatewayState: () => () => {},
  atemState: async () => null,
}));
import App from "../App";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hostApi.token = "";
  hostApi.save.mockReset();
  hostApi.settings.mockReset().mockRejectedValue(new Error("unauthorized"));
  hostApi.cloud.mockReset().mockResolvedValue(false);
  // No real network even if an imported component adds a request in future.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network forbidden in shell tests")));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() { await act(async () => root.render(<App />)); }
async function password(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
const credential = "  Home / page_ack / 東京  "; // synthetic, never a real secret

describe("public App browser gate", () => {
  it("renders exact owned login copy and keeps an empty submission inert", async () => {
    await mount();
    expect(host.querySelector("img")?.alt).toBe("ProDeck de White Oak Media");
    expect(host.querySelector("p")?.textContent).toBe("Ingresa la contraseña configurada en la computadora con ProDeck. La contraseña de miembro te permite entrar; la de administrador también habilita los controles.");
    expect(host.querySelector("input")?.placeholder).toBe("Contraseña de acceso");
    expect(host.querySelector("input")?.type).toBe("password");
    expect(host.querySelector("button")?.textContent).toBe("Conectar");
    expect(host.querySelector("button")?.disabled).toBe(true);
    await submit();
    expect(hostApi.save).not.toHaveBeenCalled();
    expect(hostApi.settings).not.toHaveBeenCalled();
    expect(hostApi.cloud).not.toHaveBeenCalled();
  });
  it("preserves the credential, busy gate and successful sign-in return", async () => {
    let finish!: (value: object) => void;
    hostApi.settings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await password(credential);
    expect(host.querySelector("input")?.value).toBe(credential);
    await submit();
    expect(hostApi.save.mock.calls).toEqual([[credential]]);
    expect(hostApi.settings.mock.calls).toEqual([[]]);
    expect(host.querySelector("button")?.textContent).toBe("Conectando…");
    expect(host.querySelector("button")?.disabled).toBe(true);
    await act(async () => finish({ comms_enabled: false }));
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector(".tally-name")?.textContent).toBe("Camera Home page_ack 東京");
    expect(hostApi.cloud).not.toHaveBeenCalled();
  });
  it.each([
    ["unauthorized", false, "Contraseña incorrecta.", false],
    ["offline diagnostic Home 東京", null, "No se puede conectar con la cabina en este momento.", true],
    ["offline diagnostic Home 東京", false, "Contraseña incorrecta.", true],
  ] as const)("localizes %s feedback without changing classification or credential payload", async (error, cloud, copy, fallback) => {
    hostApi.settings.mockRejectedValue(new Error(error));
    hostApi.cloud.mockResolvedValue(cloud);
    await mount();
    await password(credential);
    await submit();
    expect(host.querySelector(".error")?.textContent).toBe(copy);
    expect(host.querySelector("input")?.value).toBe(credential);
    expect(host.querySelector("button")?.disabled).toBe(false);
    expect(hostApi.save.mock.calls).toEqual([[credential]]);
    expect(hostApi.settings.mock.calls).toEqual([[]]);
    expect(hostApi.cloud.mock.calls).toEqual(fallback ? [[credential]] : []);
    expect(host.querySelector(".tally")).toBeNull();
  });
  it("preserves offline cached-password success and session expiry", async () => {
    hostApi.settings.mockRejectedValue(new Error("offline"));
    hostApi.cloud.mockResolvedValue(true);
    await mount();
    await password(credential);
    await submit();
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector(".tally-name")?.textContent).toBe("Camera Home page_ack 東京");
    expect(hostApi.cloud.mock.calls).toEqual([[credential]]);
    await act(async () => window.dispatchEvent(new Event("prodeck-web-unauthorized")));
    expect(host.querySelector(".error")?.textContent).toBe("Tu sesión expiró. Volvé a ingresar.");
    expect(host.querySelector("input")?.value).toBe(credential);
    expect(host.querySelector(".tally")).toBeNull();
    expect(hostApi.save.mock.calls).toEqual([[credential]]);
  });
});
