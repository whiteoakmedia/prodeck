import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StagePockets } from "../components/StagePockets";
import { exampleMap, panelViews } from "../lib/routing";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("preserves panel names and opens the original channel", async () => {
  const map = exampleMap();
  map.panels![0].label = "Escenario 東京";
  const socket = panelViews(map)[0].sockets.find(s => !s.dead && s.lands.length > 0)!;
  const open = vi.fn();
  await act(async () => { root.render(<StagePockets map={map} live={{ now: 1000 }} onWalk={open} />); });
  expect(host.textContent).toContain("Escenario 東京");
  expect(host.textContent).toContain("en uso");
  const tile = [...host.querySelectorAll<HTMLElement>(".sp-panel:first-child .sp-tile")].find(el => el.querySelector(".sp-num")?.textContent === String(socket.n))!;
  expect(tile.title).toContain(`Conector ${socket.n}`);
  await act(async () => tile.click());
  expect(open).toHaveBeenCalledWith(socket.lands[0].channelId);
});
