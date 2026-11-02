import { describe, expect, it } from "vitest";
import { sameKey } from "../lib/pushClient";

describe("a phone's push subscription against the booth's key", () => {
  const key = "BAECAwQ"; // base64url of 04 01 02 03 04
  it("matches the same key", () => {
    expect(sameKey(new Uint8Array([4, 1, 2, 3, 4]).buffer, key)).toBe(true);
  });
  it("notices a booth that has new keys", () => {
    expect(sameKey(new Uint8Array([4, 1, 2, 3, 5]).buffer, key)).toBe(false);
    expect(sameKey(new Uint8Array([4, 1, 2]).buffer, key)).toBe(false);
  });
  it("treats a missing key as different", () => {
    expect(sameKey(null, key)).toBe(false);
    expect(sameKey(new Uint8Array([4]).buffer, "")).toBe(false);
  });
});
