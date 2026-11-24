import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewChecklist } from "../mobile/CrewChecklist";

const api = vi.hoisted(() => ({ toggle: vi.fn(), checkin: vi.fn(), checkinList: vi.fn(), list: { id: "list-東京", name: "Original 東京", items: [{ id: "item-1", text: "Tarea original 東京", done: false }] } }));
vi.mock("../checklistStore", () => ({
  listVisibleFor: () => true,
  useChecklists: () => ({ checklists: [api.list], itemsFor: () => [], progress: () => ({ done: 0, total: 1 }), isOverdue: () => false, dueAt: () => 0, recurrenceSummary: () => "", toggleItem: api.toggle }),
}));
vi.mock("../pcoStore", () => ({ usePco: () => ({ selectedPlanId: "plan-1", selectedServiceTimeId: "time-1", serviceTimes: [], arrivalFor: () => ({ position: "" }) }) }));
vi.mock("../chatStore", () => ({ CREW_ID_KEY: "test-id", CREW_SESSION_KEY: "test-session" }));
vi.mock("../lib/tauri", () => ({ IS_WEB: false, checkinList: api.checkinList, checkinSet: api.checkin, identityWhoami: vi.fn(), webWhoami: vi.fn() }));
vi.mock("../lib/outbox", () => ({ enqueue: vi.fn(), flush: vi.fn(), queueSize: () => 0 }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.toggle.mockReset(); api.checkin.mockReset().mockResolvedValue({ at: 1000 });
  api.checkinList.mockReset().mockResolvedValue({ mine: null });
  localStorage.setItem("test-session", "session-東京");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

it("keeps task text and identifiers and submits attendance for the same event", async () => {
  await act(async () => { root.render(<CrewChecklist />); });
  expect(host.querySelector("h1")?.textContent).toBe("Lista de tareas");
  expect(host.textContent).toContain("Original 東京");
  const task = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Tarea original 東京"))!;
  await act(async () => task.click());
  expect(api.toggle).toHaveBeenCalledWith("list-東京", "item-1");
  const attendance = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Registrar asistencia")!;
  await act(async () => attendance.click());
  expect(api.checkin).toHaveBeenCalledWith("session-東京", "plan-1::time-1");
  expect(host.textContent).toContain("Asistencia registrada");
});
