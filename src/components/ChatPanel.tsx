import { useEffect, useRef, useState } from "react";
import { useChat } from "../chatStore";
import { IS_WEB, webWhoami, type ChatMsg, type CrewPage } from "../lib/tauri";
import { usePages } from "../pagesStore";
import { CrewPageComposer, CrewPageTracking } from "../mobile/CrewPages";

// The message feed + compose row, shared by the Messages drawer (app-level)
// and the dashboard/kiosk widget. Destinations: Team (crew chat), Stage
// (ProPresenter stage displays, logged to the feed), Confidence (banner
// takeover on every ConfidenceWidget).
// First-run crew join: name + 4-digit PIN. Register creates a pending account
// (an admin approves it); Login resumes an approved one. Functional layout —
// the designed version lands with the mobile UI pass.
function JoinPanel() {
  const chat = useChat();
  const [name, setName] = useState(chat.name);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(mode: "register" | "login") {
    setErr("");
    setBusy(true);
    try {
      if (mode === "register") await chat.register(name, pin);
      else await chat.login(name, pin);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (chat.auth === "pending") {
    return (
      <div className="w-chat-join">
        <p>
          <strong>{chat.name}</strong> — waiting for booth approval.
        </p>
        <p className="muted small">
          Ask at the booth (or an admin phone) to approve you under Settings →
          Crew, then tap below.
        </p>
        <button className="btn primary" disabled={busy || !pin} onClick={() => go("login")}>
          I'm approved — sign in
        </button>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="Your 4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        {err && <p className="error small">{err}</p>}
      </div>
    );
  }

  return (
    <div className="w-chat-join">
      <p>
        <strong>Join the crew</strong> — pick a name and a 4-digit PIN.
      </p>
      <input
        className="input"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input"
        type="password"
        inputMode="numeric"
        maxLength={4}
        placeholder="4-digit PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
      />
      <div className="field-row">
        <button
          className="btn primary"
          disabled={busy || !name.trim() || pin.length !== 4}
          onClick={() => go("register")}
        >
          Join
        </button>
        <button
          className="btn ghost"
          disabled={busy || !name.trim() || pin.length !== 4}
          onClick={() => go("login")}
        >
          Sign in
        </button>
      </div>
      {err && <p className="error small">{err}</p>}

    </div>
  );
}

export function ChatPanel() {
  const chat = useChat();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<ChatMsg["target"]>("team");
  const [err, setErr] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  // Members only get Team; the gateway enforces this server-side — hiding the
  // picker is just honest UI. Fail-open to admin so the picker still shows if
  // the whoami probe fails (the server still rejects restricted sends).
  const [isMember, setIsMember] = useState(false);
  // Pages from the booth. The composer/tracking sheets are the same ones the
  // phone shell uses — the booth is where you'd most want to send a page
  // mid-service, with a real keyboard.
  const [composing, setComposing] = useState(false);
  const [tracking, setTracking] = useState<CrewPage | null>(null);
  const { pages } = usePages();
  useEffect(() => {
    if (!IS_WEB) return;
    webWhoami()
      .then((w) => setIsMember(w.tier === "member"))
      .catch(() => {});
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.msgs]);

  async function send() {
    setErr("");
    try {
      await chat.send(text, target);
      setText("");
    } catch (e) {
      setErr(String(e));
    }
  }

  if (IS_WEB && chat.auth !== "in") return <JoinPanel />;

  return (
    <div className="w-chat">
      <div className="w-chat-list" ref={listRef}>
        {chat.msgs.length === 0 && (
          <div className="muted small">No messages yet — say something.</div>
        )}
        {chat.msgs.map((m) => (
          <div key={m.id} className={`w-chat-msg t-${m.target}`}>
            <span className="w-chat-from">{m.from}</span>
            {m.target !== "team" && <span className="chip w-chat-target">{m.target}</span>}
            <span className="w-chat-text">{m.text}</span>
            <span className="w-chat-time">
              {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
      {!isMember &&
        pages.slice(-2).map((p) => (
          <button key={p.id} className="chat-sent-page" onClick={() => setTracking(p)}>
            <span className="mono">
              Page → {p.recipients.length} · {new Date(p.sent_ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="chat-sent-body">{p.body}</span>
            <span className="mono-data chat-sent-count">
              {p.receipts.length}/{p.recipients.length} read
            </span>
          </button>
        ))}

      <div className="field-row w-chat-compose" onMouseDown={(e) => e.stopPropagation()}>
        {!isMember && (
          <select
            className="input w-chat-dest"
            value={target}
            onChange={(e) => setTarget(e.target.value as ChatMsg["target"])}
            title="Destination"
          >
            <option value="team">Team</option>
            <option value="stage">Stage</option>
            <option value="confidence">Confidence</option>
          </select>
        )}
        <input
          className="input"
          value={text}
          placeholder={
            target === "team"
              ? "Message the crew…"
              : target === "stage"
                ? "Text for the stage displays…"
                : "Banner for confidence screens…"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button className="btn small primary" onClick={send}>
          Send
        </button>
        {!isMember && (
          <button
            className="btn small chat-page-btn"
            title="Send a page — buzzes the chosen crew until each one confirms"
            onClick={() => setComposing(true)}
          >
            Page
          </button>
        )}
        {!isMember && target === "confidence" && (
          <button
            className="btn small ghost"
            title="Clear the confidence banner"
            onClick={chat.clearConfidence}
          >
            Clear
          </button>
        )}
      </div>
      {err && <p className="error small">{err}</p>}

      {composing && <CrewPageComposer onClose={() => setComposing(false)} />}
      {tracking && (
        <CrewPageTracking
          // Re-read from the store so receipts landing while it's open show up.
          page={pages.find((p) => p.id === tracking.id) ?? tracking}
          onClose={() => setTracking(null)}
        />
      )}
    </div>
  );
}
