import type { ReactNode } from "react";

// A deliberately small Markdown subset, rendered to REACT ELEMENTS rather than
// to an HTML string.
//
// That choice is the whole security story: there is no `dangerouslySetInnerHTML`
// anywhere in here, so a guide pasted out of a Word document — or anything else
// carrying stray `<script>` or `<img onerror=…>` — is displayed as the text it
// is. It also means plain unformatted prose renders perfectly well: every rule
// below is opt-in, so pasting a job description with no markup at all just
// produces paragraphs.
//
// Supported: # / ## / ### headings, - and * bullets, 1. numbered lists,
// **bold**, *italic*, `code`, [text](https://…), --- rules, and blank-line
// paragraphs. Everything else is literal.

/** Inline spans: bold, italic, code, links. Applied in one pass so the
 *  delimiters can't nest ambiguously. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: ** before * so bold isn't eaten by italic.
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={k} className="md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = m[2];
      // http(s) only — the regex already refuses javascript: and data:.
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render a guide. Returns block elements ready to drop into a card. */
export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  // One level of nesting, which is what real job descriptions actually use
  // ("Confirm the system is ready:" followed by the four things to check).
  // Indent the child lines by two spaces or a tab.
  type Item = { text: string; kids: string[]; kidsOrdered: boolean };
  let list: { ordered: boolean; items: Item[] } | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const body = para.join(" ");
    blocks.push(<p key={`p${k++}`}>{inline(body, `p${k}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => (
      <li key={i}>
        {inline(it.text, `l${k}-${i}`)}
        {it.kids.length > 0 &&
          (it.kidsOrdered ? (
            <ol>
              {it.kids.map((c, j) => (
                <li key={j}>{inline(c, `l${k}-${i}-${j}`)}</li>
              ))}
            </ol>
          ) : (
            <ul>
              {it.kids.map((c, j) => (
                <li key={j}>{inline(c, `l${k}-${i}-${j}`)}</li>
              ))}
            </ul>
          ))}
      </li>
    ));
    blocks.push(
      list.ordered ? <ol key={`l${k++}`}>{items}</ol> : <ul key={`l${k++}`}>{items}</ul>,
    );
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushAll();
      blocks.push(<hr key={`h${k++}`} />);
      continue;
    }
    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    if (head) {
      flushAll();
      const depth = head[1].length;
      const content = inline(head[2], `h${k}`);
      blocks.push(
        depth === 1 ? (
          <h3 key={`t${k++}`}>{content}</h3>
        ) : depth === 2 ? (
          <h4 key={`t${k++}`}>{content}</h4>
        ) : (
          <h5 key={`t${k++}`}>{content}</h5>
        ),
      );
      continue;
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    const num = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      const indent = (bullet ? bullet[1] : num![1]).replace(/\t/g, "  ").length;
      const text = bullet ? bullet[2] : num![3];
      const ordered = !bullet;
      // Indented, and there is a parent to hang it on → it's a child.
      if (indent >= 2 && list && list.items.length > 0) {
        const parent = list.items[list.items.length - 1];
        if (parent.kids.length === 0) parent.kidsOrdered = ordered;
        parent.kids.push(text);
        continue;
      }
      // Switching between bulleted and numbered starts a new list.
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push({ text, kids: [], kidsOrdered: false });
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return <div className="md">{blocks}</div>;
}
