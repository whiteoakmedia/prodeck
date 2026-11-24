import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalkPicker, WalkView } from "../components/RoutingWalk";
import { emptyMap, type RNode } from "../lib/routing";

vi.mock("../pcoStore", () => ({ usePco: () => ({ micRoster: () => [], team: [], micAssignments: {}, micDeskMap: {}, micDeskMap2: {}, selectedPlanId: null }) }));
vi.mock("../components/AskPanel", () => ({ AskPanel: () => null }));
vi.mock("../components/StagePockets", () => ({ StagePockets: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("shows a user's channel name and selects its original identifier", async () => {
  const map = emptyMap();
  map.nodes.push({ id: "input-東京", kind: "channel", label: "Voz 東京", ref: { index: "39" } } as RNode);
  const pick = vi.fn();
  await act(async () => { root.render(<WalkPicker map={map} live={{ now: 1000 }} onPick={pick} />); });
  expect(host.textContent).toContain("Canales");
  expect(host.textContent).toContain("Voz 東京");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Voz 東京"))!.click());
  expect(pick).toHaveBeenCalledWith("input-東京");
});

it("returns from a missing map item without altering the callback", async () => {
  const back = vi.fn();
  await act(async () => { root.render(<WalkView map={emptyMap()} live={{ now: 1000 }} targetId="no-existe" onBack={back} />); });
  expect(host.textContent).toContain("Eso ya no está en el mapa.");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(back).toHaveBeenCalledOnce();
});
