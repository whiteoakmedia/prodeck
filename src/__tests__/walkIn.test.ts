import { describe, expect, it } from "vitest";
import { fadeDue } from "../lib/walkIn";

const at = (hhmmss: string) => Date.parse(`2026-10-11T${hhmmss}`);
const TIMES = [
  { id: "t930", name: "9:30", ts: at("09:30:00") },
  { id: "t1100", name: "11:00", ts: at("11:00:00") },
];

describe("fadeDue", () => {
  it("waits until the service is closer than the fade length", () => {
    expect(fadeDue(TIMES, at("09:29:30"), 15, [])).toBeNull();
  });

  it("starts the fade so it lands on the service start", () => {
    expect(fadeDue(TIMES, at("09:29:45"), 15, [])).toEqual({ timeId: "t930", secs: 15 });
  });

  it("fades once per service", () => {
    expect(fadeDue(TIMES, at("09:29:50"), 15, ["t930"])).toBeNull();
  });

  it("fades faster when it notices late, still finishing on time", () => {
    expect(fadeDue(TIMES, at("09:29:56"), 15, [])).toEqual({ timeId: "t930", secs: 4 });
  });

  it("does nothing during a service, and moves on to the next one", () => {
    expect(fadeDue(TIMES, at("09:45:00"), 15, ["t930"])).toBeNull();
    expect(fadeDue(TIMES, at("10:59:50"), 15, ["t930"])).toEqual({ timeId: "t1100", secs: 10 });
  });

  it("does nothing with no service times", () => {
    expect(fadeDue([], at("09:29:50"), 15, [])).toBeNull();
  });
});
