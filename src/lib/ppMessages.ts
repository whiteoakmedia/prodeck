// ProPresenter messages (Pro's Messages panel: child calls, "car lights on",
// parking notices). Each has a text with {Token} blanks; the text tokens are
// what someone types in, the timer and clock tokens fill themselves. Pure, so
// the parsing and filling can be tested without a ProPresenter.

export interface MessageToken {
  name: string;
  /** "text" is typed in; the others (timer, clock) ProPresenter fills. */
  kind: "text" | "other";
  /** What Pro has saved for a text token. */
  value: string;
}

export interface ProMessage {
  id: string;
  name: string;
  text: string;
  tokens: MessageToken[];
  showing: boolean;
  /** Pro's theme reference, as it sent it: a new message borrows it. */
  theme?: unknown;
}

/** Pro's GET /v1/messages, read defensively: older builds leave fields out. */
export function parseMessages(raw: unknown): ProMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ProMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const idObj = (r.id ?? {}) as Record<string, unknown>;
    const id = String(idObj.uuid ?? idObj.name ?? idObj.index ?? "");
    if (!id) continue;
    const tokens: MessageToken[] = [];
    for (const t of Array.isArray(r.tokens) ? r.tokens : []) {
      const tr = (t ?? {}) as Record<string, unknown>;
      const name = String(tr.name ?? "").trim();
      if (!name) continue;
      const text = tr.text as Record<string, unknown> | undefined;
      tokens.push(text ? { name, kind: "text", value: String(text.text ?? "") } : { name, kind: "other", value: "" });
    }
    out.push({
      id,
      name: String(idObj.name ?? "Message"),
      text: String(r.message ?? ""),
      tokens,
      showing: r.is_active === true,
      theme: r.theme,
    });
  }
  return out;
}

/** The blanks someone fills in, in the order they appear. */
export const textTokens = (m: ProMessage) => m.tokens.filter((t) => t.kind === "text");

/** The message as the room will read it. Unfilled blanks stay as {Name} so
 *  it's plain what's missing; timers and clocks show their name. */
export function messagePreview(m: ProMessage, values: Record<string, string>): string {
  return m.text.replace(/\{([^}]+)\}/g, (all, name: string) => {
    const tok = m.tokens.find((t) => t.name === name);
    if (!tok) return all;
    if (tok.kind !== "text") return `[${name}]`;
    const v = (values[name] ?? "").trim();
    return v || all;
  });
}

/** The body for POST /v1/message/{id}/trigger: the typed-in values only. */
export function triggerBody(m: ProMessage, values: Record<string, string>): { name: string; text: { text: string } }[] {
  return textTokens(m).map((t) => ({ name: t.name, text: { text: (values[t.name] ?? "").trim() } }));
}

/** Blanks still empty, so Show can say what's missing rather than put a
 *  half-finished notice on the screen. */
export function missingTokens(m: ProMessage, values: Record<string, string>): string[] {
  return textTokens(m)
    .filter((t) => !(values[t.name] ?? "").trim())
    .map((t) => t.name);
}

/** The message a church most likely uses for child calls, if any. */
export function likelyChildCall(list: ProMessage[]): ProMessage | null {
  const re = /child|kid|nursery|parent|pager|call/i;
  const blank = (m: ProMessage) => textTokens(m).length > 0;
  return (
    list.find((m) => re.test(m.name) && blank(m)) ??
    list.find(blank) ??
    list.find((m) => re.test(m.name)) ??
    list[0] ??
    null
  );
}

/** The blank a made-for-you child call message uses. */
export const CODE_TOKEN = "Code";
export const DEFAULT_CHILD_CALL = `Parent of {${CODE_TOKEN}}, please come to the nursery`;

/** The wording, with exactly the code blank in it somewhere. */
export function withCodeBlank(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return DEFAULT_CHILD_CALL;
  return t.includes(`{${CODE_TOKEN}}`) ? t : `${t} {${CODE_TOKEN}}`;
}

/**
 * The body for POST /v1/messages: a "Child Call" message with a code blank,
 * in the same theme as the church's other messages (Pro requires a theme, and
 * theirs already looks right on their screens). null with no message to
 * borrow a theme from.
 */
export function childCallBody(list: ProMessage[], text: string): Record<string, unknown> | null {
  const theme = list.find((m) => m.theme)?.theme;
  if (!theme) return null;
  const taken = new Set(list.map((m) => m.name));
  let name = "Child Call";
  for (let n = 2; taken.has(name); n++) name = `Child Call ${n}`;
  return {
    id: { name, uuid: "", index: list.length },
    message: withCodeBlank(text),
    tokens: [{ name: CODE_TOKEN, text: { text: "" } }],
    theme,
    visible_on_network: true,
    is_active: false,
  };
}
