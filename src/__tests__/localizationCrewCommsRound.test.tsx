import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CrewComms } from "../mobile/CrewComms";

const api = vi.hoisted(() => ({
  talk: vi.fn(), setLine: vi.fn(), setListening: vi.fn(), toggle: vi.fn(),
  snapshot: { state: "on", openMic: false, talking: false, talkOn: "Cámara 東京", listen: ["Cámara 東京"], me: "self", roster: { channels: ["Cámara 東京"], members: [] }, linked: [], links: {}, unreachable: [], err: "", needsTap: false },
}));
vi.mock("../lib/intercom", () => ({
  commsSnapshot: () => api.snapshot, onComms: () => () => {}, joinBlocker: () => "", joinComms: vi.fn(), leaveComms: vi.fn(),
  setListening: api.setListening, setOpenMic: vi.fn(), setTalkLine: api.setLine, talk: api.talk, talkLabel: () => "Mantené presionado para hablar", toggleMute: api.toggle, talkers: () => [],
}));
it("conserva la línea y deja de transmitir al soltar el botón", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<CrewComms onBack={() => {}} />); });
  expect(host.textContent).toContain("Comunicaciones");
  const line = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Cámara 東京")!;
  await act(async () => line.click());
  expect(api.setLine).toHaveBeenCalledWith("Cámara 東京");
  const talk = host.querySelector<HTMLButtonElement>("button.crew-talk")!;
  await act(async () => { talk.dispatchEvent(new Event("pointerdown", { bubbles: true })); talk.dispatchEvent(new Event("pointerup", { bubbles: true })); });
  expect(api.talk.mock.calls.map(c => c[0])).toEqual([true, false]);
  await act(async () => root.unmount()); host.remove();
});
