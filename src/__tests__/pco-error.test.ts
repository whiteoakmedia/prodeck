import { describe, expect, it } from "vitest";
import { PcoError } from "../lib/tauri";

/**
 * The Planning Center 404 contract.
 *
 * A 404 is a NORMAL answer in two places — nobody holds LIVE control, and the
 * plan has no live item. Three call sites used to detect it by searching the
 * error message for "PCO 404". Rewriting those messages to be readable broke
 * all three silently: "Take control" reported an error for the ordinary case,
 * and the live item pinned forever. The status now travels beside the message.
 *
 * These tests exist because that class of break has happened twice.
 */
describe("PcoError", () => {
  it("splits the status code off the message", () => {
    const e = new PcoError("PCO/404 Planning Center couldn't find that.");
    expect(e.status).toBe(404);
    expect(e.message).toBe("Planning Center couldn't find that.");
  });

  it("never shows the machine-readable prefix to a human", () => {
    const e = new PcoError("PCO/401 Planning Center rejected these credentials.");
    // Almost every caller does setStatus(String(e)) — so toString() is the
    // thing users actually read, and it must be clean.
    expect(String(e)).toBe("Planning Center rejected these credentials.");
    expect(String(e)).not.toContain("PCO/");
  });

  it("keeps multi-line guidance intact", () => {
    const body = "line one\nline two\n• a bullet";
    const e = new PcoError(`PCO/401 ${body}`);
    expect(e.message).toBe(body);
    expect(e.status).toBe(401);
  });

  it("reports status 0 for an error that carries no code", () => {
    // Credential-missing errors and transport failures have no HTTP status.
    // They must not be mistaken for a 404, which would clear the live item.
    const e = new PcoError("Planning Center credentials not set");
    expect(e.status).toBe(0);
    expect(e.message).toBe("Planning Center credentials not set");
  });

  it("unwraps a thrown Error as well as a bare string", () => {
    const e = new PcoError(new Error("PCO/429 rate limited"));
    expect(e.status).toBe(429);
    expect(e.message).toBe("rate limited");
  });

  it("treats only a real 404 as a 404", () => {
    for (const raw of [
      "PCO/500 Planning Center is having trouble",
      "PCO/403 refused this data",
      "network timeout",
    ]) {
      expect(new PcoError(raw).status).not.toBe(404);
    }
  });
});
