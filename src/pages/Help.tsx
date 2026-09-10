import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HELP_BY_ID, HELP_GROUP_ORDER, HELP_TOPICS, type HelpTopic } from "../help/topics";
import { contextFor, searchHelp } from "../help/search";
import { getSettings, helpAsk, IS_WEB, diagOpenIssue, REPORT_REPO, DOCS_URL, helpOpen } from "../lib/tauri";
import { Icon } from "../components/Icon";

/**
 * Help: ask a question, get an answer, inside the app.
 *
 * Search runs over the topics as you type. If a Gemini key is configured the
 * same box can ask the assistant, which answers ONLY from those topics and says
 * so when it can't. Neither path needs the internet for the basic case; the
 * topics are compiled in, so this works on a booth with no connection and on a
 * phone in a basement.
 */

// Tiny renderer for the topic markup: bullets, steps, callouts, **bold**, `code`.
function Body({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, k) => {
      if (part.startsWith("**")) return <strong key={k}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>;
      return part;
    });
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    if (l.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      blocks.push(<ul key={blocks.length}>{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\. /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ""));
      blocks.push(<ol key={blocks.length}>{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ol>);
      continue;
    }
    if (l.startsWith("> ")) {
      blocks.push(<p key={blocks.length} className="help-callout">{inline(l.slice(2))}</p>);
      i++;
      continue;
    }
    blocks.push(<p key={blocks.length}>{inline(l)}</p>);
    i++;
  }
  return <>{blocks}</>;
}

export function HelpPage({
  initialTopic,
  onNavigate,
}: {
  initialTopic?: string;
  onNavigate: (page: string, anchor?: string) => void;
}) {
  const [q, setQ] = useState("");
  const [topicId, setTopicId] = useState<string | null>(initialTopic ?? null);
  const [canAsk, setCanAsk] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialTopic) setTopicId(initialTopic);
  }, [initialTopic]);

  // The assistant needs the church's Gemini key. Members don't see the key
  // (settings arrive redacted) and can't call help_ask anyway, so on the crew
  // tier this simply never appears.
  useEffect(() => {
    getSettings()
      .then((s) => setCanAsk(!!(s as { gemini_api_key?: string | null }).gemini_api_key))
      .catch(() => setCanAsk(false));
  }, []);

  useEffect(() => {
    if (!topicId) inputRef.current?.focus();
  }, [topicId]);

  const hits = useMemo(() => searchHelp(q), [q]);
  const topic: HelpTopic | null = topicId ? HELP_BY_ID[topicId] ?? null : null;

  async function ask() {
    const question = q.trim();
    if (!question) return;
    setAsking(true);
    setAskErr("");
    setAnswer(null);
    try {
      const ctx = contextFor(question)
        .map((t) => `## ${t.title}\n${t.body}`)
        .join("\n\n");
      setAnswer(await helpAsk(question, ctx));
    } catch (e) {
      setAskErr(String(e));
    } finally {
      setAsking(false);
    }
  }

  function askOnGithub() {
    const title = q.trim().slice(0, 80) || "Question";
    diagOpenIssue(REPORT_REPO, title, `**Question:** ${q.trim()}\n\n(What I was trying to do, and what happened:)\n`, "").catch(() =>
      window.open(`https://github.com/${REPORT_REPO}/issues/new`, "_blank", "noopener"),
    );
  }

  const openTopic = (id: string) => {
    setTopicId(id);
    setAnswer(null);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="page help-page">
      <header className="page-head">
        <h1>Help</h1>
        <span className="page-sub">Ask a question, or browse by area. Everything here works offline.</span>
      </header>

      <div className="help-ask">
        <div className="help-ask-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="input help-ask-input"
            placeholder="Ask anything — “why does the join link say closed”, “tap disc url”, “page not arriving”…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAnswer(null);
              setAskErr("");
              if (topicId) setTopicId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) openTopic(hits[0].topic.id);
              if (e.key === "Escape") setQ("");
            }}
          />
          {q && (
            <button className="btn small ghost" onClick={() => setQ("")}>Clear</button>
          )}
        </div>

        {q.trim() && (
          <div className="help-results">
            {hits.length === 0 && (
              <p className="muted small">Nothing in the built-in help matches that yet.</p>
            )}
            {hits.map((h) => (
              <button key={h.topic.id} className="help-hit" onClick={() => openTopic(h.topic.id)}>
                <span className="help-hit-group">{h.topic.group}</span>
                <span className="help-hit-title">{h.topic.title}</span>
              </button>
            ))}
            <div className="help-more">
              {canAsk && (
                <button className="btn small primary" disabled={asking} onClick={ask}>
                  {asking ? "Thinking…" : "Ask the assistant"}
                </button>
              )}
              <button className="btn small" onClick={askOnGithub}>Ask on GitHub</button>
              <button
                className="btn small ghost"
                onClick={() => (IS_WEB ? window.open(DOCS_URL, "_blank", "noopener") : helpOpen().catch(() => window.open(DOCS_URL, "_blank", "noopener")))}
              >
                Open the full guide
              </button>
              {!canAsk && !IS_WEB && (
                <span className="muted small">
                  Add a Gemini key in Settings → Gemini Smart Matching and this box can answer questions in its own words, using only this help.
                </span>
              )}
            </div>
            {askErr && <p className="error small">{askErr}</p>}
            {answer && (
              <div className="help-answer">
                <span className="help-answer-label">Assistant · answered from the built-in help</span>
                <p>{answer}</p>
                <span className="muted small">Check it against the topics above before acting on it during a service.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {topic ? (
        <article className="card help-topic">
          <button className="btn small ghost help-back" onClick={() => setTopicId(null)}>← All topics</button>
          <span className="help-hit-group">{topic.group}</span>
          <h2>{topic.title}</h2>
          <div className="help-body">
            <Body text={topic.body} />
          </div>
          <div className="help-topic-actions">
            {topic.settings && (
              <button className="btn small primary" onClick={() => onNavigate("settings", topic.settings)}>
                Open the setting
              </button>
            )}
            {topic.guide && (
              <button
                className="btn small"
                onClick={() =>
                  IS_WEB
                    ? window.open(`${DOCS_URL}#${topic.guide}`, "_blank", "noopener")
                    : helpOpen(topic.guide).catch(() => window.open(`${DOCS_URL}#${topic.guide}`, "_blank", "noopener"))
                }
              >
                Long version in the guide
              </button>
            )}
          </div>
          {topic.related && topic.related.length > 0 && (
            <div className="help-related">
              <span className="muted small">Related</span>
              {topic.related.map((r) =>
                HELP_BY_ID[r] ? (
                  <button key={r} className="help-hit" onClick={() => openTopic(r)}>
                    <span className="help-hit-title">{HELP_BY_ID[r].title}</span>
                  </button>
                ) : null,
              )}
            </div>
          )}
        </article>
      ) : (
        !q.trim() && (
          <div className="help-groups">
            {HELP_GROUP_ORDER.map((g) => {
              const items = HELP_TOPICS.filter((t) => t.group === g);
              if (!items.length) return null;
              return (
                <section key={g} className="card help-group">
                  <h3>{g}</h3>
                  {items.map((t) => (
                    <button key={t.id} className="help-hit" onClick={() => openTopic(t.id)}>
                      <span className="help-hit-title">{t.title}</span>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
