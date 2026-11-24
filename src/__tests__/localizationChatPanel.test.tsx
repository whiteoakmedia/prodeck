import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPanel } from "../components/ChatPanel";

const api = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue([{ name: "Sala 東京" }]),
  chat: { name: "Ana", auth: "in", msgs: [{ id: "1", from: "Paz", target: "stage", ts: 1, text: "Home / 東京" }] },
}));
vi.mock("../chatStore", () => ({ useChat: () => ({ ...api.chat, send: api.send, clearConfidence: api.clear }) }));
vi.mock("../lib/tauri", () => ({ IS_WEB: false, webWhoami: vi.fn(), chatClearScreens: api.clear }));
vi.mock("../lib/dashboards", () => ({ loadDashboards: api.load }));
vi.mock("../pagesStore", () => ({ usePages: () => ({ pages: [] }) }));
vi.mock("../mobile/CrewPages", () => ({ CrewPageComposer: () => null, CrewPageTracking: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api.send.mockReset().mockResolvedValue(undefined);
  api.load.mockReset().mockResolvedValue([{ name: "Sala 東京" }]);
  api.clear.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("shows translated destinations while preserving data and routing values", async () => {
  await act(async () => { root.render(<ChatPanel />); });
  expect(host.textContent).toContain("Home / 東京");
  expect(host.querySelector(".w-chat-target")?.textContent).toBe("Escenario");
  const select = host.querySelector<HTMLSelectElement>("select")!;
  expect([...select.options].map(o => [o.value, o.textContent?.trim()])).toEqual([
    ["team", "Equipo"], ["stage", "Escenario"], ["confidence", "Pantalla Retorno"],
    ["screen:all", "Todas las pantallas"], ["screen:Sala 東京", "Pantalla Sala 東京"],
  ]);
  await act(async () => { select.value = "screen:Sala 東京"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const input = host.querySelector<HTMLInputElement>(".w-chat-compose-row input")!;
  expect(input.placeholder).toBe("Mensaje para la pantalla Sala 東京…");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Original 東京  ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Enviar")!;
  await act(async () => send.click());
  expect(api.send).toHaveBeenCalledWith("  Original 東京  ", "screen", "screen:Sala 東京");
});
