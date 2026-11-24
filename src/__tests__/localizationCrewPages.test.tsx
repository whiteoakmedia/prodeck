import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewPageComposer, CrewPageTakeover } from "../mobile/CrewPages";

const api = vi.hoisted(() => ({
  send: vi.fn(), ack: vi.fn(), dismiss: vi.fn(), identity: vi.fn(), checkins: vi.fn(),
  state: { incoming: null as null | { id: string; from: string; body: string; sent_ms: number; buzz: boolean }, acking: false, error: "", fatal: false },
}));
vi.mock("../pagesStore", () => ({ usePages: () => ({ ...api.state, send: api.send, ack: api.ack, dismiss: api.dismiss }) }));
vi.mock("../pcoStore", () => ({ usePco: () => ({ team: [] }), isDeclined: () => false }));
vi.mock("../lib/tauri", () => ({ IS_WEB: true, identityList: api.identity, checkinList: api.checkins }));
vi.mock("../chatStore", () => ({ CREW_SESSION_KEY: "test-session" }));
vi.mock("../lib/sound", () => ({ buzz: vi.fn(), pageTone: vi.fn(), PAGE_BUZZ_STAGES: [[100]], patternMs: () => 100 }));
vi.mock("../lib/tallyMode", () => ({ useTallyMode: () => false }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  api.send.mockReset().mockResolvedValue(undefined); api.ack.mockReset().mockResolvedValue(undefined);
  api.identity.mockReset().mockResolvedValue([{ id: "user-1", name: "Ana 東京", role: "Cámara", approved: true, notify: true }]);
  api.checkins.mockReset().mockResolvedValue({ at: { "user-1": 1 } });
  api.state.incoming = null; api.state.error = ""; api.state.fatal = false; api.state.acking = false;
  localStorage.setItem("test-session", "session");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem("test-session"); });

it("sends the chosen preset to the same checked-in recipients", async () => {
  const close = vi.fn();
  await act(async () => { root.render(<CrewPageComposer onClose={close} />); });
  const preset = [...host.querySelectorAll("button")].find(b => b.textContent === "Prueba de micrófono")!;
  await act(async () => preset.click());
  expect(host.querySelector("textarea")?.value).toBe("Prueba de micrófono");
  const send = [...host.querySelectorAll("button")].find(b => b.textContent === "Enviar aviso a 1")!;
  await act(async () => send.click());
  expect(api.send).toHaveBeenCalledWith("Prueba de micrófono", ["user-1"], true);
  expect(close).toHaveBeenCalledOnce();
});

it("shows the original incoming body and acknowledges its unchanged identifier", async () => {
  api.state.incoming = { id: "page-東京", from: "Ana", body: "  Home 東京  ", sent_ms: 10, buzz: true };
  await act(async () => { root.render(<CrewPageTakeover />); });
  expect(host.querySelector(".crew-takeover-body")?.textContent).toBe("  Home 東京  ");
  expect(host.textContent).toContain("Entendido");
  await act(async () => host.querySelector<HTMLButtonElement>(".crew-confirm")!.click());
  expect(api.ack).toHaveBeenCalledWith("page-東京");
});
