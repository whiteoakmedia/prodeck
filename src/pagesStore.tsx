import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  IS_WEB,
  on,
  pageAck,
  pageList,
  pageRebuzz,
  pageSend,
  pageSendAs,
  type CrewPage,
} from "./lib/tauri";
import { useChat } from "./chatStore";
import { CREW_SESSION_KEY } from "./chatStore";

// Pages — the priority channel (design/mobile S06/S07). Chat is a feed you read
// when you look; a page takes the screen and buzzes until confirmed.
//
// Two rules the design is emphatic about, both enforced here:
//  1. Receipts are NEVER optimistic. Acking does not mark the page read locally
//     — the booth records it and the "page:receipt" event marks it. A confirm
//     that never reached the booth must not look delivered to the sender.
//  2. A page is dismissed only by confirming. There is no snooze and no
//     swipe-away, so `incoming` clears on server acknowledgement, not on tap.

interface PagesStore {
  pages: CrewPage[];
  /** The page addressed to me that I haven't confirmed → drives the takeover. */
  incoming: CrewPage | null;
  ack: (pageId: number) => Promise<void>;
  send: (body: string, recipientIds: string[], buzz: boolean) => Promise<CrewPage>;
  rebuzz: (pageId: number) => Promise<number>;
  acking: boolean;
  error: string | null;
}

const Ctx = createContext<PagesStore | null>(null);

export function PagesProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const [pages, setPages] = useState<CrewPage[]>([]);
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // My display name, kept in a ref so the event handlers below never need to
  // re-subscribe when it loads.
  const nameRef = useRef(chat.name);
  nameRef.current = chat.name;

  useEffect(() => {
    pageList()
      .then(setPages)
      .catch(() => {});
    const subs = [
      on<CrewPage>("page:new", (p) =>
        // Re-buzz re-emits the same page; replace rather than duplicate.
        setPages((prev) => [...prev.filter((x) => x.id !== p.id), p]),
      ),
      on<{ pageId: number; userId: string; name: string; readMs: number }>(
        "page:receipt",
        (r) =>
          setPages((prev) =>
            prev.map((p) =>
              p.id === r.pageId && !p.receipts.some((x) => x.user_id === r.userId)
                ? {
                    ...p,
                    receipts: [
                      ...p.receipts,
                      { user_id: r.userId, name: r.name, read_ms: r.readMs },
                    ],
                  }
                : p,
            ),
          ),
      ),
    ];
    return () => {
      subs.forEach((u) => u.then((f) => f()));
    };
  }, []);

  // Oldest unconfirmed page addressed to me. Oldest first: if two land while
  // the phone is face-down, the earlier command is the one still pending.
  const me = chat.name;
  const incoming =
    pages
      .filter(
        (p) =>
          p.recipients.some((r) => r.name === me) &&
          !p.receipts.some((r) => r.name === me),
      )
      .sort((a, b) => a.sent_ms - b.sent_ms)[0] ?? null;

  async function ack(pageId: number) {
    setAcking(true);
    setError(null);
    try {
      const session = localStorage.getItem(CREW_SESSION_KEY) ?? "";
      const receipt = await pageAck(session, pageId);
      // Apply the booth's OWN response. This is not an optimistic write — the
      // receipt in hand is the record the booth just made, so rule 1 holds.
      //
      // Waiting for the "page:receipt" event instead used to strand the
      // takeover in two real cases: the event stream is still reconnecting (a
      // page wakes a sleeping phone, which is the normal case), and a second
      // tap, where the booth sees a repeat ack, emits NO event, and the screen
      // could never clear again.
      setPages((prev) =>
        prev.map((p) =>
          p.id === pageId && !p.receipts.some((x) => x.user_id === receipt.user_id)
            ? { ...p, receipts: [...p.receipts, receipt] }
            : p,
        ),
      );
      // The takeover is gone; the lock-screen notification for the same page
      // should go with it rather than sitting there still demanding an answer.
      closePageNotification(pageId);
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setAcking(false);
    }
  }

  async function send(body: string, recipientIds: string[], buzz: boolean) {
    const page = IS_WEB
      ? await pageSendAs(localStorage.getItem(CREW_SESSION_KEY) ?? "", body, recipientIds, buzz)
      : await pageSend(nameRef.current || "Booth", body, recipientIds, buzz);
    setPages((prev) => [...prev.filter((x) => x.id !== page.id), page]);
    return page;
  }

  async function rebuzz(pageId: number) {
    const r = await pageRebuzz(pageId);
    return r.buzzed;
  }

  return (
    <Ctx.Provider value={{ pages, incoming, ack, send, rebuzz, acking, error }}>
      {children}
    </Ctx.Provider>
  );
}

/** Dismiss any OS notification still showing for a page we've just confirmed. */
function closePageNotification(pageId: number) {
  navigator.serviceWorker?.ready
    .then((reg) => reg.getNotifications({ tag: `page-${pageId}` }))
    .then((ns) => ns.forEach((n) => n.close()))
    .catch(() => {});
}

export function usePages(): PagesStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePages must be used within PagesProvider");
  return ctx;
}
