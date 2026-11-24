import { describe, expect, it } from "vitest";
import {
  appHasFaceId,
  biometricLabel,
  DIRECTOR_IDLE_MS,
  DIRECTOR_MAX_MS,
  directorOpen,
  directorUntil,
  faceIdHandoff,
  readFaceIdReturn,
} from "../lib/directorLock";
import { grants } from "../lib/perms";
import { crewTabs } from "../mobile/CrewNav";

const H = 60 * 60 * 1000;
const sunday10 = Date.UTC(2026, 10, 22, 15, 0, 0);

describe("director lock", () => {
  it("lasts the service when opened in its window", () => {
    const times = [{ id: "a", ts: sunday10 }];
    // Opened at 9:50 for a 90 minute plan: open until 10:00 + 90 + 45 overrun.
    const until = directorUntil(sunday10 - 10 * 60_000, times, 1.5 * H);
    expect(until).toBe(sunday10 + 1.5 * H + 45 * 60_000);
  });

  it("stops at the next service's window, not the overrun", () => {
    const times = [{ id: "a", ts: sunday10 }, { id: "b", ts: sunday10 + 2 * H }];
    const until = directorUntil(sunday10 + 5 * 60_000, times, 1.5 * H);
    expect(until).toBe(sunday10 + 2 * H - 15 * 60_000);
  });

  it("is an hour outside a service, and never more than the cap", () => {
    expect(directorUntil(sunday10 - 5 * H, [{ id: "a", ts: sunday10 }], H)).toBe(sunday10 - 5 * H + DIRECTOR_IDLE_MS);
    const long = directorUntil(sunday10, [{ id: "a", ts: sunday10 }], 10 * H);
    expect(long).toBe(sunday10 + DIRECTOR_MAX_MS);
  });

  it("knows open from closed", () => {
    expect(directorOpen(1000, 999)).toBe(true);
    expect(directorOpen(1000, 1000)).toBe(false);
    expect(directorOpen(0, 5)).toBe(false);
  });
});

describe("Face ID hand off", () => {
  it("goes to the app's page and back with the same code", () => {
    const url = faceIdHandoff("capacitor://localhost/?home=1", "abc123", "http://10.0.0.5:8080/crew");
    expect(url).toBe("capacitor://localhost/?director=abc123&back=http%3A%2F%2F10.0.0.5%3A8080%2Fcrew");
  });

  it("accepts only its own code, and tidies the address", () => {
    expect(readFaceIdReturn("#crewdirector=abc123", "abc123")).toEqual({ ok: true, pin: false, rest: "" });
    expect(readFaceIdReturn("#crewdirector=pin", "abc123")).toEqual({ ok: false, pin: true, rest: "" });
    expect(readFaceIdReturn("#crewdirector=nope", "abc123").ok).toBe(false);
    expect(readFaceIdReturn("#crewdirector=abc123", "").ok).toBe(false);
    expect(readFaceIdReturn("#tab=x&crewdirector=abc123", "abc123")).toEqual({ ok: true, pin: false, rest: "#tab=x" });
    expect(readFaceIdReturn("#tab=x", "abc123")).toEqual({ ok: false, pin: false, rest: "#tab=x" });
  });

  it("names Touch ID too, and fingerprints on Android", () => {
    expect(biometricLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) ProDeckCrew/0.1 Biometric")).toBe("Open with Face ID or Touch ID");
    expect(biometricLabel("Mozilla/5.0 (Linux; Android 15) ProDeckCrew/0.1 Biometric")).toBe("Open with your fingerprint");
  });

  it("only trusts an app that says it can", () => {
    expect(appHasFaceId("Mozilla/5.0 (iPhone) ProDeckCrew/0.1")).toBe(false);
    expect(appHasFaceId("Mozilla/5.0 (iPhone) ProDeckCrew/0.1 Biometric")).toBe(true);
    expect(appHasFaceId("Mozilla/5.0 (iPhone) Safari Biometric")).toBe(false);
  });
});

describe("director grant", () => {
  it("carries page, stage and control, nothing else", () => {
    expect(grants(["director"], "page")).toBe(true);
    expect(grants(["director"], "stage")).toBe(true);
    expect(grants(["director"], "control")).toBe(true);
    expect(grants(["director"], "tap")).toBe(false);
    expect(grants(["director"], "manage")).toBe(false);
    expect(grants(["control"], "director")).toBe(false);
  });

  it("takes Dashboards' place in the tab bar", () => {
    expect(crewTabs(false)).toEqual(["home", "chat", "checklist", "dashboards", "more"]);
    expect(crewTabs(true)).toEqual(["home", "chat", "checklist", "director", "more"]);
  });
});

import { orderTimers } from "../lib/liveTimers";
describe("Director countdowns", () => {
  it("puts running timers first and marks an overrun", () => {
    const out = orderTimers([
      { id: "a", name: "Sermon", time: "25:00", state: "stopped" },
      { id: "b", name: "Service Countdown", time: "04:12", state: "running" },
      { id: "c", name: "Walk in", time: "-00:30", state: "overrunning" },
    ]);
    expect(out.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(out.map((t) => t.overrun)).toEqual([false, true, false]);
    expect(orderTimers([{ id: "d", name: "x", time: "00:04:12", state: "complete" }])[0].time).toBe("04:12");
    expect(orderTimers([{ id: "e", name: "y", time: "01:04:12", state: "stopped" }])[0].time).toBe("01:04:12");
  });
});
