import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Safe unlisten for desktop event subscriptions.
 *
 * Tauri's unlisten runs a webview script that reads
 * listeners[eventId].handlerId and throws a TypeError when that entry isn't
 * there (unlisten called twice, or a component that mounts and unmounts before
 * the webview defined the entry). The throw arrived as an unhandled rejection in
 * Sentry and skipped the Rust side unlisten, so the listener leaked and could
 * still call setState after unmount.
 */
const listen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

type Handler = (e: { payload: unknown }) => void;

beforeEach(() => {
  vi.resetModules();
  listen.mockReset();
  // Desktop mode: IS_WEB is false only when the Tauri internals are present.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.useFakeTimers();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.useRealTimers();
});

describe("on (desktop)", () => {
  it("swallows the unlisten TypeError, retries once, and stops the callback", async () => {
    let handler: Handler = () => {};
    const real = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')"),
      )
      .mockResolvedValueOnce(undefined);
    listen.mockImplementation(async (_event: string, h: Handler) => {
      handler = h;
      return real;
    });

    const rejections: unknown[] = [];
    const onRejection = (r: unknown) => rejections.push(r);
    process.on("unhandledRejection", onRejection);

    try {
      const { on, UNLISTEN_RETRY_MS } = await import("../lib/tauri");
      const cb = vi.fn();
      const unlisten = await on<number>("tick", cb);

      handler({ payload: 1 });
      expect(cb).toHaveBeenCalledTimes(1);

      expect(() => unlisten()).not.toThrow();
      expect(() => unlisten()).not.toThrow();
      expect(real).toHaveBeenCalledTimes(1);

      // A leaked listener must not reach the component any more.
      handler({ payload: 2 });
      expect(cb).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(UNLISTEN_RETRY_MS);
      expect(real).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1000);
      expect(real).toHaveBeenCalledTimes(2);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("does not retry when the first unlisten works, and survives a sync throw", async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const throws = vi.fn(() => {
      throw new TypeError("boom");
    });
    listen.mockResolvedValueOnce(ok).mockResolvedValueOnce(throws);
    const { on, UNLISTEN_RETRY_MS } = await import("../lib/tauri");

    const a = await on("a", () => {});
    a();
    await vi.advanceTimersByTimeAsync(UNLISTEN_RETRY_MS * 2);
    expect(ok).toHaveBeenCalledTimes(1);

    const b = await on("b", () => {});
    expect(() => b()).not.toThrow();
    await vi.advanceTimersByTimeAsync(UNLISTEN_RETRY_MS * 2);
    expect(throws).toHaveBeenCalledTimes(2);
  });
});
