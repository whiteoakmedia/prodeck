import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CrewNav } from "../mobile/CrewNav";

it("shows translated labels while navigating with the original tab IDs", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const select = vi.fn();
  await act(async () => { root.render(<CrewNav active="home" unread={12} overdue onSelect={select} />); });
  expect([...host.querySelectorAll(".crew-nav-label")].map(n => n.textContent)).toEqual(["Home", "Chat", "Lista de tareas", "Paneles de control", "Más"]);
  expect(host.querySelector(".crew-nav-badge")?.textContent).toBe("9+");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes("Lista de tareas"))!.click());
  expect(select).toHaveBeenCalledWith("checklist");
  await act(async () => root.unmount()); host.remove();
});
