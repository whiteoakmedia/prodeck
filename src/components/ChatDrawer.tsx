import { useEffect, useState } from "react";
import { useChat } from "../chatStore";
import { ChatPanel } from "./ChatPanel";
import { IS_WEB } from "../lib/tauri";

// App-level Messages drawer: docked to the right edge on every page (full-width
// sheet on phones). The nav's Messages button toggles it; while it's closed, a
// small toast surfaces the newest incoming message.
export function ChatDrawer() {
  const chat = useChat();
  const [toast, setToast] = useState<{ from: string; text: string; id: number } | null>(null);

  // Surface the newest message as a toast while the drawer is closed.
  useEffect(() => {
    if (chat.open || chat.msgs.length === 0) return;
    const last = chat.msgs[chat.msgs.length - 1];
    if (last.from === chat.name) return;
    setToast({ from: last.from, text: last.text, id: last.id });
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.msgs]);

  return (
    <>
      {toast && !chat.open && (
        <button
          className="chat-toast"
          onClick={() => {
            setToast(null);
            chat.setOpen(true);
          }}
        >
          <span className="w-chat-from">{toast.from}</span>
          <span className="chat-toast-text">{toast.text}</span>
        </button>
      )}
      {chat.open && (
        <aside className="chat-drawer">
          <header className="chat-drawer-head">
            <h3>Messages</h3>
            <span className="muted small chat-drawer-name">
              as <strong>{chat.name || "…"}</strong>
              {IS_WEB && chat.auth === "in" && (
                <button className="btn small ghost" onClick={chat.signOut} title="Sign out">
                  ⎋
                </button>
              )}
            </span>
            {/* The booth desktop never plays sounds (lib/sound.ts is hard-
                silenced there — its output feeds the house), so only web
                clients get the toggle. Icon alone read as ambiguous state,
                so it carries a word now. */}
            {IS_WEB && (
              <button
                className="btn small ghost"
                title={
                  chat.sound
                    ? "New messages play a chime — click to silence"
                    : "New messages are silent — click to enable the chime"
                }
                onClick={() => chat.setSound(!chat.sound)}
              >
                {chat.sound ? "🔔 Sound on" : "🔕 Muted"}
              </button>
            )}
            <button className="btn small ghost" onClick={() => chat.setOpen(false)}>
              ×
            </button>
          </header>
          <ChatPanel />
        </aside>
      )}
    </>
  );
}
