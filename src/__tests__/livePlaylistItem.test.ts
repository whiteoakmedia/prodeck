import { describe, expect, it } from "vitest";
import { activePlaylistId, resolveLiveItem } from "../lib/livePlaylistItem";
import { parseSlides } from "../lib/slideOrder";

// Shapes as ProPresenter 7 returns them.
const ACTIVE = {
  presentation: {
    playlist: { uuid: "pl-sunday", name: "Sunday", index: 0 },
    item: { uuid: "item-2", name: "Way Maker", index: 2 },
  },
  announcements: null,
};
const PLAYLIST = {
  id: { uuid: "pl-sunday", name: "Sunday", index: 0 },
  items: [
    { id: { uuid: "item-0", name: "Countdown", index: 0 }, presentation_info: { presentation_uuid: "p-countdown", arrangement_uuid: "" } },
    { id: { uuid: "item-1", name: "Header", index: 1 }, type: "header" },
    { id: { uuid: "item-2", name: "Way Maker", index: 2 }, presentation_info: { presentation_uuid: "p-waymaker", arrangement_uuid: "arr-sunday" } },
  ],
};

describe("resolveLiveItem", () => {
  it("finds the live item and its arrangement", () => {
    expect(resolveLiveItem(ACTIVE, PLAYLIST, "p-waymaker")).toEqual({ playlistId: "pl-sunday", itemIndex: 2, arrangementUuid: "arr-sunday" });
  });

  it("refuses an item that isn't playing the live presentation", () => {
    // Someone clicked a song in the library; the playlist still names its last item.
    expect(resolveLiveItem(ACTIVE, PLAYLIST, "p-other-song")).toBeNull();
  });

  it("is null when nothing was started from a playlist", () => {
    expect(activePlaylistId({ presentation: null })).toBeNull();
    expect(resolveLiveItem({ presentation: null }, PLAYLIST, "p-waymaker")).toBeNull();
  });

  it("falls back to the item's index when its uuid isn't found", () => {
    const active = { presentation: { playlist: { uuid: "pl-sunday" }, item: { uuid: "renamed", index: 0 } } };
    expect(resolveLiveItem(active, PLAYLIST, "p-countdown")).toEqual({ playlistId: "pl-sunday", itemIndex: 0, arrangementUuid: "" });
  });

  it("accepts ids nested under `id` too", () => {
    const active = { presentation: { playlist: { id: { uuid: "pl-sunday" } }, item: { id: { uuid: "item-2", index: 2 } } } };
    expect(resolveLiveItem(active, PLAYLIST, "p-waymaker")?.itemIndex).toBe(2);
  });
});

describe("the reported case: an arrangement that reorders groups", () => {
  // Same slide count both ways (so counting cues can't tell them apart), but
  // the arrangement plays the chorus second.
  const pres = {
    presentation: {
      groups: [
        { uuid: "g-v1", name: "Verse 1", slides: [{ text: "Verse one line" }] },
        { uuid: "g-v2", name: "Verse 2", slides: [{ text: "Verse two line" }] },
        { uuid: "g-ch", name: "Chorus", slides: [{ text: "Chorus line" }] },
      ],
      arrangements: [{ id: { uuid: "arr-sunday" }, groups: ["g-v1", "g-ch", "g-v2"] }],
      current_arrangement: "",
    },
  };

  it("labels slide 2 with the chorus once the item's arrangement is known", () => {
    const live = resolveLiveItem(ACTIVE, PLAYLIST, "p-waymaker");
    const slides = parseSlides(pres, live!.arrangementUuid);
    expect(slides[1].text).toBe("Chorus line");
    // Stored order would have said Verse 2: the bug.
    expect(parseSlides(pres)[1].text).toBe("Verse two line");
  });
});
