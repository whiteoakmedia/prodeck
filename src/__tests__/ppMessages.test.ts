import { describe, expect, it } from "vitest";
import { likelyChildCall, messagePreview, missingTokens, parseMessages, triggerBody } from "../lib/ppMessages";

// The shape ProPresenter's GET /v1/messages returns (from Pro's API spec).
const RAW = [
  {
    id: { name: "Welcome", uuid: "W", index: 0 },
    message: "Welcome, guests",
    tokens: [],
    is_active: false,
  },
  {
    id: { name: "Child Call", uuid: "C", index: 1 },
    message: "Parent of {Number}, please come to {Room}. Ends in {Timer 1}",
    tokens: [
      { name: "Number", text: { text: "142" } },
      { name: "Room", text: { text: "" } },
      { name: "Timer 1", timer: { configuration: {} } },
    ],
    is_active: true,
  },
];

describe("ProPresenter messages for the Child Call tile", () => {
  const list = parseMessages(RAW);

  it("reads the messages, their blanks, and which one is on screen", () => {
    expect(list.map((m) => m.name)).toEqual(["Welcome", "Child Call"]);
    expect(list[1].tokens).toEqual([
      { name: "Number", kind: "text", value: "142" },
      { name: "Room", kind: "text", value: "" },
      { name: "Timer 1", kind: "other", value: "" },
    ]);
    expect(list[1].showing).toBe(true);
  });

  it("ignores junk rather than crashing on an older Pro", () => {
    expect(parseMessages(null)).toEqual([]);
    expect(parseMessages([null, 3, { id: {} }])).toEqual([]);
  });

  it("previews the message with what was typed, leaving empty blanks visible", () => {
    expect(messagePreview(list[1], { Number: "57" })).toBe("Parent of 57, please come to {Room}. Ends in [Timer 1]");
  });

  it("sends only the typed-in blanks, trimmed, in Pro's shape", () => {
    expect(triggerBody(list[1], { Number: " 57 ", Room: "the nursery" })).toEqual([
      { name: "Number", text: { text: "57" } },
      { name: "Room", text: { text: "the nursery" } },
    ]);
  });

  it("says which blanks are still empty", () => {
    expect(missingTokens(list[1], { Number: "57" })).toEqual(["Room"]);
    expect(missingTokens(list[0], {})).toEqual([]);
  });

  it("picks the church's child call message on its own", () => {
    expect(likelyChildCall(list)?.name).toBe("Child Call");
    expect(likelyChildCall([])).toBeNull();
  });
});
