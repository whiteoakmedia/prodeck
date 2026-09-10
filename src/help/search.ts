import { HELP_TOPICS, type HelpTopic } from "./topics";

/**
 * Help search, tuned for how people actually ask.
 *
 * No library: the corpus is a few dozen topics and the whole thing runs on
 * every keystroke. Scoring favours the question-shaped `aliases` over body
 * text, because "why does the join link not work" should land on joining even
 * though "join" appears in five other topics' bodies. Plain substring matching
 * on normalised tokens; a query token that matches nothing is simply ignored
 * rather than sinking the result, so a typo or a stray word doesn't blank the
 * list.
 */

export interface HelpHit {
  topic: HelpTopic;
  score: number;
}

const STOP = new Set([
  "the", "a", "an", "to", "is", "it", "my", "i", "do", "does", "how", "what", "why",
  "can", "cant", "can't", "won't", "wont", "not", "on", "in", "of", "for", "and",
  "or", "me", "with", "this", "that", "are", "be", "when", "up", "get", "set",
]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9:]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function scoreTopic(t: HelpTopic, qs: string[], raw: string): number {
  const title = t.title.toLowerCase();
  const aliases = t.aliases.map((a) => a.toLowerCase());
  const body = t.body.toLowerCase();
  let score = 0;

  // A whole alias contained in the query, or the query contained in an alias,
  // is the strongest possible signal — that's the exact question.
  for (const a of aliases) {
    if (a.length > 3 && (raw.includes(a) || a.includes(raw))) score += 40;
  }
  if (raw.length > 3 && title.includes(raw)) score += 30;

  for (const q of qs) {
    if (title.includes(q)) score += 12;
    for (const a of aliases) if (a.includes(q)) score += 6;
    if (t.id.includes(q)) score += 4;
    // Body hits count, but capped, so a long topic can't win on volume.
    const n = body.split(q).length - 1;
    score += Math.min(n, 4) * 2;
  }
  return score;
}

export function searchHelp(query: string, limit = 8): HelpHit[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const qs = tokens(raw);
  if (qs.length === 0 && raw.length < 3) return [];
  return HELP_TOPICS.map((topic) => ({ topic, score: scoreTopic(topic, qs, raw) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Topics whose text the assistant should see for this question. */
export function contextFor(query: string, max = 5): HelpTopic[] {
  const hits = searchHelp(query, max);
  return hits.length ? hits.map((h) => h.topic) : HELP_TOPICS.slice(0, 3);
}
