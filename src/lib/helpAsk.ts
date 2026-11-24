// Help's Ask box on Claude, through the same booth key as Ask ProDeck
// (assist.rs). It reads EVERY Help topic, not a handful matched by keyword:
// the topics are cached on Anthropic's side, so after the first question each
// one costs a fraction and answers sooner. Pure pieces live here for tests.

import type { HelpTopic } from "../help/topics";
import type { SystemBlock } from "./assist";

export type HelpMsg = { role: "user" | "assistant"; content: unknown };

/** Only the last few turns go back, so a long chat can't grow without end. */
export const HELP_HISTORY_TURNS = 6;

const RULES = `You are the Help built into ProDeck, a free app church production teams use in the booth and on their phones (ProPresenter, Planning Center, sound consoles, crew phones and pages, TV screens, cameras, NFC giving discs).

Answer the person's question using ONLY the Help topics below. They are the whole of what ProDeck does; if they don't cover something, ProDeck doesn't do it, or Help doesn't say how.

How to answer:
- Short and practical: the steps, in order, naming the exact page, card, button or setting (for example "Settings, Crew & screens, Scheduled alerts"). Under 150 words unless the steps need more.
- Plain words for a volunteer, not a developer. No dashes as punctuation, no headings, no tables.
- After each part of the answer that comes from a topic, put that topic's id in square brackets, exactly as given, like [crew-joining]. Only use ids from the list.
- If Help doesn't cover it, say so in one sentence, then suggest Report a bug or Request a feature, at the bottom of the sidebar. Never guess at a button or setting that isn't in the topics. The topics' own bullet headings (like When: or Who:) are not labels on screen, so don't tell people to look for them.
- If the question is about a sound or signal problem in their building (no sound in a channel, an in-ear mix, a mic), point them to Ask ProDeck under No sound? (on the Routing page at the booth, or More, No sound? on a phone), which can see their routing map.`;

/** The system prompt: the rules, then every topic, in one cached block. */
export function helpSystem(topics: HelpTopic[]): SystemBlock[] {
  const body = topics
    .map((t) => `### [${t.id}] ${t.title}\nGroup: ${t.group}${t.aliases?.length ? `\nAlso asked as: ${t.aliases.join(", ")}` : ""}\n\n${t.body}`)
    .join("\n\n");
  return [{ type: "text", text: `${RULES}\n\n## The Help topics\n\n${body}`, cache_control: { type: "ephemeral" } }];
}

/** The request for one question, with the recent conversation before it. */
export function helpRequest(topics: HelpTopic[], history: HelpMsg[], question: string) {
  const recent = history.slice(-HELP_HISTORY_TURNS * 2);
  // Never start on an assistant turn after trimming.
  while (recent.length && recent[0].role !== "user") recent.shift();
  return {
    system: helpSystem(topics),
    messages: [...recent, { role: "user" as const, content: question.trim().slice(0, 1500) }],
    max_tokens: 4000,
    cache_control: { type: "ephemeral" },
  };
}

/** The answer's text, from the reply's content blocks (thinking and
 *  fallback blocks are skipped). Empty when there's none. */
export function answerText(reply: { content?: unknown; stop_reason?: string } | null | undefined): string {
  if (reply?.stop_reason === "refusal") return "";
  const blocks = Array.isArray(reply?.content) ? (reply!.content as { type?: string; text?: string }[]) : [];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n")
    .trim();
}

/** A piece of the answer: plain text, or a link to a topic it cited. */
export type AnswerPart = { kind: "text"; text: string } | { kind: "topic"; id: string };

/** Split the answer into text and topic links. A bracket that isn't a real
 *  topic id stays as text, so nothing links to a page that doesn't exist. */
export function answerParts(text: string, ids: Set<string>): AnswerPart[] {
  const out: AnswerPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([a-z0-9][a-z0-9-]{1,60})\]/g)) {
    if (!ids.has(m[1])) continue;
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "topic", id: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
