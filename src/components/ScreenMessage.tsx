import { useEffect, useState } from "react";
import { chatHistory, on, IS_WEB, type ChatMsg } from "../lib/tauri";
import { chime } from "../lib/sound";
import { isBoothScreen } from "../lib/resi";
import { forThisScreen, SCREEN_HOLD_MS } from "../lib/screenMessage";

/**
 * A message from the crew, across a kiosk or TV screen: "Five minutes to
 * stage" on the green room TV. Nobody is standing at these screens to press
 * anything, so it comes down on its own after a few minutes, or when it's
 * cleared from Messages, or when the next one replaces it.
 */
export function ScreenMessage({ dashboard }: { dashboard: string }) {
  const [msg, setMsg] = useState<ChatMsg | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    // A message sent just before this screen came on (a TV waking up) still shows.
    chatHistory()
      .then((all) => {
        const last = [...all].reverse().find((m) => m.target === "screen" && forThisScreen(m.channel, dashboard));
        if (last && Date.now() - last.ts < SCREEN_HOLD_MS) setMsg(last);
      })
      .catch(() => {});
    const subs = [
      on<ChatMsg>("chat:message", (m) => {
        if (m.target !== "screen" || !forThisScreen(m.channel, dashboard)) return;
        setMsg(m);
        // A soft chime so the room looks up. Never on the booth computer: its
        // sound goes to the house.
        if (IS_WEB && !isBoothScreen(IS_WEB, location.hostname)) chime();
      }),
      on<{ channel: string }>("chat:screen_clear", (c) => {
        if (forThisScreen(c?.channel ?? "", dashboard)) setMsg(null);
      }),
    ];
    const t = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => {
      clearInterval(t);
      subs.forEach((u) => u.then((fn) => fn()).catch(() => {}));
    };
  }, [dashboard]);

  if (!msg || Date.now() - msg.ts >= SCREEN_HOLD_MS) return null;
  return (
    <div className="screen-msg" role="alert" aria-live="assertive">
      <div className="screen-msg-card">
        <div className="screen-msg-text">{msg.text}</div>
        <div className="screen-msg-from">
          {msg.from} · {new Date(msg.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}
