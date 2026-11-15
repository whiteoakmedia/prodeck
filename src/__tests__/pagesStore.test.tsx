import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * PagesProvider survives a bad page list.
 *
 * In the browser build webInvoke returns `j.result`, which is undefined when
 * the booth's /api/cmd reply has no result or isn't JSON. refresh() stored
 * that straight into `pages`, the `incoming` line called `pages.filter` on
 * undefined, and the whole provider tree threw: the crew app went blank. It
 * runs on mount, on every visibilitychange and every gateway reconnect, so a
 * phone waking during a brief hiccup was enough (Sentry 7849449248).
 */
const pageList = vi.fn();
vi.mock("../lib/tauri", () => ({
  IS_WEB: true,
  on: () => Promise.resolve(() => {}),
  onGatewayState: () => () => {},
  pageAck: vi.fn(),
  pageList: () => pageList(),
  pageRebuzz: vi.fn(),
  pageSend: vi.fn(),
  pageSendAs: vi.fn(),
}));
vi.mock("../chatStore", () => ({
  useChat: () => ({ name: "Sam" }),
  CREW_SESSION_KEY: "prodeck.crewSession",
  CREW_ID_KEY: "prodeck.crewId",
}));

import { PagesProvider, usePages } from "../pagesStore";

// React only runs effects inside act() when it knows it is a test.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: ReturnType<typeof usePages> | null = null;
function Probe() {
  seen = usePages();
  return <div>{seen.incoming ? seen.incoming.body : "none"}</div>;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  seen = null;
  pageList.mockReset();
  localStorage.setItem("prodeck.crewId", "u1");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

async function mount() {
  await act(async () => {
    root.render(
      <PagesProvider>
        <Probe />
      </PagesProvider>,
    );
  });
  // Let the pageList promise settle and its state update render.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("PagesProvider with a bad page list", () => {
  it("keeps rendering when pageList resolves to undefined", async () => {
    pageList.mockResolvedValue(undefined);
    await mount();
    expect(host.textContent).toBe("none");
    expect(seen!.incoming).toBeNull();
    expect(seen!.pages).toEqual([]);
  });

  it("does not throw on a page missing its receipts", async () => {
    pageList.mockResolvedValue([
      {
        id: 1,
        from: "Booth",
        body: "Camera 2 to the pulpit",
        recipients: [{ id: "u1", name: "Sam" }],
        buzz: true,
        sent_ms: 1,
      },
    ]);
    await mount();
    expect(host.textContent).toBe("Camera 2 to the pulpit");
    expect(seen!.incoming?.id).toBe(1);
  });

  it("keeps the pages it has when a later refresh comes back empty handed", async () => {
    const page = {
      id: 2,
      from: "Booth",
      body: "Walk in loop now",
      recipients: [{ id: "u1", name: "Sam" }],
      buzz: false,
      sent_ms: 2,
      receipts: [],
    };
    pageList.mockResolvedValueOnce([page]).mockResolvedValue(undefined);
    await mount();
    expect(seen!.pages).toHaveLength(1);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(pageList).toHaveBeenCalledTimes(2);
    expect(seen!.pages).toHaveLength(1);
    expect(host.textContent).toBe("Walk in loop now");
  });
});
