import { describe, expect, it } from "vitest";
import { joinFormProblem, joinPollMs } from "../lib/posterJoin";

describe("poster join", () => {
  it("needs a name and a 4 digit PIN", () => {
    expect(joinFormProblem(" ", "1234")).toBe("Ingresá tu nombre.");
    expect(joinFormProblem("D", "1234")).toBe("Ingresá tu nombre.");
    expect(joinFormProblem("Devon", "123")).toBe("Elegí un PIN de 4 dígitos. Lo vas a usar para ingresar.");
    expect(joinFormProblem("Devon", "12a4")).toBe("Elegí un PIN de 4 dígitos. Lo vas a usar para ingresar.");
    expect(joinFormProblem("Devon  Smith", "0420")).toBe("");
  });
  it("asks quickly at first, then eases off", () => {
    expect(joinPollMs(0)).toBe(3_000);
    expect(joinPollMs(5 * 60_000)).toBe(10_000);
    expect(joinPollMs(60 * 60_000)).toBe(30_000);
  });
});
