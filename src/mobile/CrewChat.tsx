import { useEffect, useRef, useState } from "react";
import { useChat } from "../chatStore";
import { usePages } from "../pagesStore";
import { CrewPageComposer, CrewPageTracking } from "./CrewPages";
import { CrewChannels, type Channel } from "./CrewChannels";
import { IS_WEB, webWhoami, type ChatMsg, type CrewPage } from "../lib/tauri";

// S05a / S05b — chat thread (design/mobile/README.md).
//
// Opens on the S04 channel list (CrewChannels) and drills into a thread scoped
// to one channel. DIRECT messages are still absent — the event stream is not
// identity-aware, so a "private" thread would in fact reach every device.
//
// S05b's Page button is live as of the pages/ACK backend: amber, outlined and a
// different shape from send, so it is never hit by accident mid-service.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function CrewChat() {
  const chat = useChat();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<ChatMsg["target"]>("team");
  const [err, setErr] = useState("");
  const [composing, setComposing] = useState(false);
  const [tracking, setTracking] = useState<CrewPage | null>(null);
  const { pages } = usePages();
  const listRef = useRef<HTMLDivElement | null>(null);
  // Members only get Team; the gateway enforces it server-side, so hiding the
  // control is just honest UI. Fail-open (admin) if the probe fails — the
  // server still rejects a restricted send.
  const [isMember, setIsMember] = useState(false);
  // null = the channel list (S04). Opening a channel scopes the thread to it.
  const [channel, setChannel] = useState<Channel | null>(null);
  const myRole = localStorage.getItem("prodeck.crewRole") ?? "";
  useEffect(() => {
    if (!IS_WEB) return;
    webWhoami()
      .then((w) => setIsMember(w.tier === "member"))
      .catch(() => {});
  }, []);

  // Messages filed to the open channel. Older messages predate channels and
  // default to "team", so nothing disappears from the main thread.
  const shown = chat.msgs.filter((m) => (m.channel || "team") === (channel?.id ?? "team"));

  // The NEW rule is pinned to a message ID, not an index, so it stays put as
  // messages arrive while you're reading instead of sliding down the list.
  const [newAtId, setNewAtId] = useState<number | null>(null);

  function openChannel(c: Channel) {
    const mine = chat.msgs.filter((m) => (m.channel || "team") === c.id);
    const n = chat.unreadBy[c.id] ?? 0;
    setNewAtId(n > 0 && n <= mine.length ? mine[mine.length - n].id : null);
    chat.markRead(c.id);
    setChannel(c);
  }

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // Messages landing while you're looking at the channel are already read —
    // otherwise the badge would count the conversation you're having.
    if (channel) chat.markRead(channel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, channel]);

  async function send() {
    if (!text.trim()) return;
    setErr("");
    try {
      await chat.send(text, target, channel?.id ?? "team");
      setText("");
    } catch (e) {
      setErr(String(e));
    }
  }

  const placeholder =
    target === "team"
      ? `Message ${channel?.label ?? "Sunday Team"}`
      : target === "stage"
        ? "Send to Stage"
        : "Send to Confidence";

  if (!channel) return <CrewChannels myRole={myRole} onOpen={openChannel} />;

  return (
    <div className="crew-thread">
      <header className="crew-thread-head">
        <button className="crew-back" onClick={() => setChannel(null)} aria-label="Back">
          ‹
        </button>
        <h1 className="crew-title">{channel.label}</h1>
        {!isMember && IS_WEB && <span className="crew-chip-admin mono">Admin</span>}
      </header>

      <div className="crew-msgs" ref={listRef}>
        {shown.length === 0 && (
          <p className="crew-hint muted">No messages yet — say something.</p>
        )}
        {shown.map((m) => (
          <div key={m.id}>
            {m.id === newAtId && (
              <div className="crew-new">
                <span className="mono">New</span>
              </div>
            )}
            {m.target !== "team" ? (
              // Broadcasts are records, not conversation: centred, no bubble.
              <div className="crew-bcast edge-mid">
                <span className="mono crew-bcast-label">
                  → {m.target} · {hhmm(m.ts)}
                </span>
                <span className="crew-bcast-body">{m.text}</span>
              </div>
            ) : m.from === chat.name ? (
              <div className="crew-row own">
                <div className="crew-bubble own">{m.text}</div>
                <span className="mono-data crew-stamp">{hhmm(m.ts)}</span>
              </div>
            ) : (
              <div className="crew-row">
                <span className="crew-avatar">{initials(m.from)}</span>
                <div className="crew-bubble-wrap">
                  <span className="crew-sender">
                    {m.from} <span className="mono-data crew-stamp">{hhmm(m.ts)}</span>
                  </span>
                  <div className="crew-bubble">{m.text}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <p className="crew-join-err">{err}</p>}

      {/* A sent page reads as a record in the thread and opens read tracking —
          the counter is the whole reason an operator comes back to it. */}
      {!isMember &&
        pages
          .filter((p) => p.from === chat.name)
          .slice(-2)
          .map((p) => (
            <button key={p.id} className="crew-sent-page" onClick={() => setTracking(p)}>
              <span className="mono">
                Page → {p.recipients.length} · {hhmm(p.sent_ms)}
              </span>
              <span className="body">{p.body}</span>
              <span className="mono-data" style={{ color: "var(--warn)" }}>
                {p.receipts.length}/{p.recipients.length} read
              </span>
            </button>
          ))}

      <div className="crew-compose">
        {!isMember && (
          // S05b: destination persists per thread; the field's placeholder
          // follows it so there's no doubt where a message is about to land.
          <div className="crew-seg">
            {(["team", "stage", "confidence"] as const).map((t) => (
              <button
                key={t}
                className={`crew-seg-btn ${target === t ? "on" : ""}`}
                onClick={() => setTarget(t)}
              >
                {t === "team" ? "Team" : t === "stage" ? "Stage" : "Confidence"}
              </button>
            ))}
          </div>
        )}
        <div className="crew-compose-row">
          <input
            className="crew-field"
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button className="crew-send" onClick={send} aria-label="Send">
            ↑
          </button>
          {!isMember && (
            <button className="crew-page-btn" onClick={() => setComposing(true)}>
              Page
            </button>
          )}
        </div>
        {!isMember && target === "confidence" && (
          <button className="crew-clear" onClick={chat.clearConfidence}>
            Clear confidence banner
          </button>
        )}
      </div>

      {composing && <CrewPageComposer onClose={() => setComposing(false)} />}
      {tracking && (
        <CrewPageTracking
          // Re-read from the store so receipts arriving while it's open land.
          page={pages.find((p) => p.id === tracking.id) ?? tracking}
          onClose={() => setTracking(null)}
        />
      )}
    </div>
  );
}
