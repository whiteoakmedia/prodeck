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
import { CREW_SESSION_KEY, CREW_ID_KEY } from "./chatStore";

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
  /** The booth refused the ack outright — offer a way out instead of retrying. */
  fatal: boolean;
  dismiss: (pageId: number) => void;
}

const Ctx = createContext<PagesStore | null>(null);

export function PagesProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const [pages, setPages] = useState<CrewPage[]>([]);
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// The booth refused this ack outright — retrying cannot help.
  const [fatal, setFatal] = useState(false);
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
  // Match by crew id, never by display name: the booth "heals" a typed name
  // to the PCO spelling ("zach green" → "Zachary Green") and the phone picks
  // up the healed name, while the booth keeps stamping pages with the typed
  // one — so a name compare silently missed every page for that person.
  // Name is only the fallback for a phone that has no id stored yet.
  const me = chat.name;
  let myId: string | null = null;
  try {
    myId = localStorage.getItem(CREW_ID_KEY);
  } catch {
    /* storage unavailable */
  }
  const isMe = (r: { id?: string; name: string }) =>
    myId && r.id ? r.id === myId : r.name === me;
  const ackedByMe = (r: { user_id?: string; name: string }) =>
    myId && r.user_id ? r.user_id === myId : r.name === me;
  const incoming =
    pages
      .filter((p) => p.recipients.some(isMe) && !p.receipts.some(ackedByMe))
      .sort((a, b) => a.sent_ms - b.sent_ms)[0] ?? null;

  /// Give up on a page the booth will never accept an ack for.
  ///
  /// Confirming was the ONLY way out of the takeover, and several terminal
  /// errors are reachable in normal operation: the booth restarted (its
  /// in-memory ring is gone, "that page is no longer active"), the 50-page ring
  /// rolled over, or the device's session was revoked. The volunteer was left
  /// with a full-screen amber siren, mid-service, that nothing could dismiss
  /// except force-quitting the app.
  function dismiss(pageId: number) {
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    setError(null);
    closePageNotification(pageId);
  }

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
      const msg = String(e);
      setError(msg);
      // The booth ANSWERED and said no. Retrying will never succeed, so offer
      // the way out rather than sirening forever. A transport failure is
      // different — that one really is worth trying again.
      setFatal(/no longer active|not signed in|not a recipient|unknown page/i.test(msg));
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
    <Ctx.Provider value={{ pages, incoming, ack, send, rebuzz, acking, error, fatal, dismiss }}>
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
