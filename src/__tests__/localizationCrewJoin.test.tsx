import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewJoin } from "../mobile/CrewJoin";

const api = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), forget: vi.fn() }));
vi.mock("../chatStore", () => ({ useChat: () => ({ name: "", auth: "out", register: api.register, login: api.login, forgetDevice: api.forget }) }));
vi.mock("../pcoStore", () => ({ productionRoster: () => [], usePco: () => ({ team: [] }) }));
vi.mock("../lib/tauri", () => ({ INVITE_KEY: "test-invite", IS_SHOTS: false, SHOT_TAB: "", inviteInfo: vi.fn() }));
vi.mock("../components/BackToChurches", () => ({ BackToChurches: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.register.mockReset().mockResolvedValue(undefined); api.login.mockReset().mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem("prodeck.crewPendingAt"); });

it("registers the same name and PIN entered through the translated controls", async () => {
  await act(async () => { root.render(<CrewJoin />); });
  expect(host.querySelector("h1")?.textContent).toBe("Sumate al equipo");
  const name = host.querySelector<HTMLInputElement>('input[placeholder="Tu nombre"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Ana 東京"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  for (const digit of ["1", "2", "3", "4"]) {
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button.crew-key")].find(b => b.textContent === digit)!.click());
  }
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Confirmar PIN")!.click());
  expect(api.register).toHaveBeenCalledWith("Ana 東京", "1234", "", "");
});
