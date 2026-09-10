import { describe, expect, it } from "vitest";
import { searchHelp, contextFor } from "../help/search";
import { HELP_TOPICS, HELP_BY_ID } from "../help/topics";
import { ANCHOR_TOPIC } from "../help/nav";

/**
 * Help search has one job: the way a volunteer actually phrases a problem must
 * land on the topic that answers it, first. These are real phrasings, not
 * keywords, and each pins the top hit.
 */
describe("help search", () => {
  const top = (q: string) => searchHelp(q)[0]?.topic.id;

  it("lands questions on the topic that answers them", () => {
    expect(top("why does the join link say closed")).toBe("crew-joining");
    expect(top("what url goes on the disc")).toBe("taplink-discs");
    expect(top("page not arriving")).toBe("pages");
    expect(top("PCO 401")).toBe("pco-connect");
    expect(top("blank widget on kiosk")).toBe("blank-tile");
    expect(top("ndi not showing")).toBe("ndi");
    expect(top("where do I get the token")).toBe("taplink-deploy");
    expect(top("too many attempts")).toBe("crew-signout");
    expect(top("child alert")).toBe("stage-message");
  });

  it("ignores a stray word instead of blanking the list", () => {
    // "please" matches nothing; the rest must still find the topic.
    expect(top("please how do I approve a volunteer")).toBe("crew-approve");
  });

  it("returns nothing for an empty query", () => {
    expect(searchHelp("")).toEqual([]);
    expect(searchHelp("   ")).toEqual([]);
  });

  it("never hands the assistant an empty reference", () => {
    expect(contextFor("zzzz qqqq").length).toBeGreaterThan(0);
    expect(contextFor("tap disc").map((t) => t.id)).toContain("taplink-discs");
  });
});

describe("help topics", () => {
  it("have unique ids and every related link resolves", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of HELP_TOPICS) for (const r of t.related ?? []) {
      expect(HELP_BY_ID[r], `${t.id} → ${r}`).toBeDefined();
    }
  });

  it("every Settings card the ? points at has a real topic", () => {
    for (const [anchor, topic] of Object.entries(ANCHOR_TOPIC)) {
      expect(HELP_BY_ID[topic], `${anchor} → ${topic}`).toBeDefined();
    }
  });

  it("uses only the markup the renderer understands", () => {
    // A "* " bullet or a "#" heading would render as literal text.
    for (const t of HELP_TOPICS) {
      for (const line of t.body.split("\n")) {
        expect(line.startsWith("* "), `${t.id}: use "- " bullets`).toBe(false);
        expect(line.startsWith("#"), `${t.id}: no headings in bodies`).toBe(false);
      }
    }
  });
});
