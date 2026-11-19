import { describe, expect, it } from "vitest";
import { HELP_TOPICS } from "../help/topics";
import { answerParts, answerText, helpRequest, helpSystem, HELP_HISTORY_TURNS } from "../lib/helpAsk";

describe("Help's Ask box on Claude", () => {
  it("gives Claude every Help topic, with its id, in one cached block", () => {
    const sys = helpSystem(HELP_TOPICS);
    expect(sys).toHaveLength(1);
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
    for (const t of HELP_TOPICS) expect(sys[0].text).toContain(`### [${t.id}] ${t.title}`);
  });

  it("keeps the system prompt identical between questions, so the cache holds", () => {
    expect(JSON.stringify(helpSystem(HELP_TOPICS))).toBe(JSON.stringify(helpSystem(HELP_TOPICS)));
  });

  it("sends the question after the recent conversation, trimmed to whole turns", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const r = helpRequest(HELP_TOPICS, history, "  how do pages work  ");
    expect(r.messages[0].role).toBe("user");
    expect(r.messages.length).toBeLessThanOrEqual(HELP_HISTORY_TURNS * 2 + 1);
    expect(r.messages[r.messages.length - 1]).toEqual({ role: "user", content: "how do pages work" });
    expect(r.cache_control).toEqual({ type: "ephemeral" });
  });

  it("reads only the answer text, and nothing from a refusal", () => {
    expect(answerText({ content: [{ type: "thinking", text: "" }, { type: "text", text: "Open Settings." }] })).toBe("Open Settings.");
    expect(answerText({ stop_reason: "refusal", content: [{ type: "text", text: "no" }] })).toBe("");
    expect(answerText(null)).toBe("");
  });

  it("turns real topic ids into links and leaves other brackets as text", () => {
    const ids = new Set(["crew-joining", "pages"]);
    expect(answerParts("Scan the code [crew-joining]. Then [not-a-topic] and [pages].", ids)).toEqual([
      { kind: "text", text: "Scan the code " },
      { kind: "topic", id: "crew-joining" },
      { kind: "text", text: ". Then [not-a-topic] and " },
      { kind: "topic", id: "pages" },
      { kind: "text", text: "." },
    ]);
  });
});
