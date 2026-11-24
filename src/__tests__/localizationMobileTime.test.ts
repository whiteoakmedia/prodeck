import { afterEach, describe, expect, it, vi } from "vitest";
import { countdown, dateClock } from "../mobile/fmt";
import { DAY_NAMES } from "../checklistStore";

afterEach(() => vi.useRealTimers());
describe("fechas y horarios de la experiencia móvil", () => {
  it("keeps the schedule day indexes while displaying Spanish names", () => {
    expect(DAY_NAMES).toEqual(["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]);
  });
  it("keeps countdown boundaries and translates the captions", () => {
    const now = new Date(2026, 10, 23, 12, 0).getTime();
    vi.useFakeTimers(); vi.setSystemTime(now);
    expect(countdown(now + 24 * 60000)).toEqual({ big: "T-24", caption: "min para el evento" });
    expect(countdown(now - 13 * 60000)).toEqual({ big: "T+13", caption: "min desde el inicio" });
    expect(countdown(now - 121 * 60000)).toEqual({ big: "finalizado", caption: "el evento ya pasó" });
    expect(countdown(now + 49 * 3600000)).toEqual({ big: "2d 1h", caption: "para el evento" });
    expect(dateClock(now)).toMatch(/^hoy · /);
  });
});
