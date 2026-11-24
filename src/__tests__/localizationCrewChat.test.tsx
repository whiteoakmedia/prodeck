import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewChat } from "../mobile/CrewChat";

const api = vi.hoisted(() => ({
  send: vi.fn(), markRead: vi.fn(), roles: vi.fn(),
  msgs: [{ id: 3, from: "Ana 東京", text: "Original / 東京", target: "team", channel: "role:Cámara", ts: 10 }],
}));
vi.mock("../chatStore", () => ({ useChat: () => ({ name: "Paz", msgs: api.msgs, unreadBy: {}, markRead: api.markRead, send: api.send, clearConfidence: vi.fn() }) }));
vi.mock("../pagesStore", () => ({ usePages: () => ({ pages: [] }) }));
vi.mock("../lib/tauri", () => ({ IS_WEB: true, identityRoles: api.roles }));
vi.mock("../lib/perms", () => ({ usePerms: () => ({ isAdmin: true, can: () => true }) }));
vi.mock("../mobile/CrewPages", () => ({ CrewPageComposer: () => null, CrewPageTracking: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.send.mockReset().mockResolvedValue(undefined); api.markRead.mockReset();
  api.roles.mockReset().mockResolvedValue(["Cámara"]); localStorage.setItem("prodeck.crewRole", "Cámara");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem("prodeck.crewRole"); });

it("opens the original role channel and sends typed content unchanged", async () => {
  await act(async () => { root.render(<CrewChat />); });
  expect(host.textContent).toContain("Mis roles");
  expect(host.textContent).toContain("Ana 東京: Original / 東京");
  const role = [...host.querySelectorAll("button")].find(b => b.querySelector(".crew-chan-name")?.textContent === "Cámara")!;
  await act(async () => role.click());
  expect(api.markRead).toHaveBeenCalledWith("role:Cámara");
  expect(host.textContent).toContain("Original / 東京");
  const input = host.querySelector<HTMLInputElement>("input.crew-field")!;
  expect(input.placeholder).toBe("Mensaje para Cámara");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Mensaje 東京  ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')!.click());
  expect(api.send).toHaveBeenCalledWith("  Mensaje 東京  ", "team", "role:Cámara");
});
