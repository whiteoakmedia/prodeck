import { describe, expect, it } from "vitest";
import { tvStatus, type TvScreen } from "../lib/tvScreens";

const tv = (o: Partial<TvScreen>): TvScreen => ({
  id: "a", name: "Green Room", ip: "", app: 2, showing: "Green Room", online: true, seenSecs: 10,
  outdated: false, canInstall: true, updateAsked: false, note: "", ...o,
});

describe("TV status", () => {
  it("says what each TV needs", () => {
    expect(tvStatus(tv({}))).toEqual({ text: "Up to date, version 2", tone: "ok" });
    expect(tvStatus(tv({ outdated: true, app: 1 })).text).toBe("Update ready (it has version 1)");
    expect(tvStatus(tv({ outdated: true, updateAsked: true })).tone).toBe("warn");
    expect(tvStatus(tv({ note: "Downloading the update…" })).text).toBe("Downloading the update…");
    expect(tvStatus(tv({ online: false, seenSecs: 7200 })).text).toBe("Off, last seen 2 hours ago");
  });
});
