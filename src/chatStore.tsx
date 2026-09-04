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
  chatClearConfidence,
  chatHistory,
  chatSend,
  chatSendAs,
  checkinList,
  getWebToken,
  identityLogin,
  identityRegister,
  setWebToken,
  identityWhoami,
  on,
  ppSetStageMessage,
  type ChatMsg,
} from "./lib/tauri";
import { useProDeck } from "./store";
import { clearServiceWorkerSession, mirrorForServiceWorker } from "./lib/swSession";
import { buzz, chime } from "./lib/sound";

// Team messaging as an app-level feature: one store feeds the Messages drawer
// (every page, unread badge, chime) and the dashboard/kiosk widget. History is
// the host's 200-message ring; nothing persists across ProDeck restarts.

const CHAT_SOUND_KEY = "prodeck.chatSound";
// Exported so the pages store can authenticate acks with the same session
// rather than duplicating the key string.
export const CREW_SESSION_KEY = "prodeck.crewSession";
const SESSION_KEY = CREW_SESSION_KEY;
const CREW_NAME_KEY = "prodeck.crewName";
export const CREW_ID_KEY = "prodeck.crewId";

// Web auth state: crew identity (name + 4-digit PIN, booth-approved).
export type CrewAuth = "in" | "pending" | "none";

interface ChatStore {
  msgs: ChatMsg[];
  /** Total unread across every channel — the nav badge. */
  unread: number;
  /** Unread per channel id ("team", "role:Camera") — the channel list rows. */
  unreadBy: Record<string, number>;
  /** Clear one channel, or every channel when called with no argument. */
  markRead: (channel?: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  sound: boolean;
  setSound: (v: boolean) => void;
  send: (text: string, target: ChatMsg["target"], channel?: string) => Promise<void>;
  clearConfidence: () => void;
  name: string;
  /** Web crew auth ("in" always on desktop). */
  auth: CrewAuth;
  register: (name: string, pin: string, role?: string, invite?: string) => Promise<void>;
  /** Forget this device entirely — session AND stored name — so the join
   *  screen returns to registration. signOut() deliberately keeps the name so
   *  a returning volunteer only types a PIN; that is exactly what strands a
   *  device whose account was deleted at the booth. */
  forgetDevice: () => void;
  login: (name: string, pin: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<ChatStore | null>(null);

// Tones + haptics live in lib/sound (shared with the page takeover, and
// primed on first touch so iOS actually lets them play).

export function ChatProvider({ children }: { children: ReactNode }) {
  const { settings } = useProDeck();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  // Per-channel so the list can show where the traffic actually is. The total
  // is derived, never stored twice.
  const [unreadBy, setUnreadBy] = useState<Record<string, number>>({});
  const unread = Object.values(unreadBy).reduce((a, b) => a + b, 0);
  const [open, setOpenState] = useState(false);
  const [sound, setSoundState] = useState(
    () => localStorage.getItem(CHAT_SOUND_KEY) !== "0",
  );
  const [session, setSession] = useState(
    () => (IS_WEB ? localStorage.getItem(SESSION_KEY) ?? "" : ""),
  );
  const [name, setName] = useState(
    () => (IS_WEB ? localStorage.getItem(CREW_NAME_KEY) ?? "" : ""),
  );
  const [auth, setAuth] = useState<CrewAuth>(() =>
    !IS_WEB ? "in" : localStorage.getItem(SESSION_KEY) ? "in" : "none",
  );

  const openRef = useRef(open);
  openRef.current = open;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  // The booth signs as its device name (updates when settings load).
  const effectiveName = IS_WEB ? name : settings?.device_name || "Booth";
  const nameRef = useRef(effectiveName);
  nameRef.current = effectiveName;

  // Devices that signed in before login returned ids learn theirs once here —
  // checklist-item owners are matched by id, so a phone must know its own.
  useEffect(() => {
    if (!IS_WEB || !session || localStorage.getItem(CREW_ID_KEY)) return;
    identityWhoami(session)
      .then((w) => localStorage.setItem(CREW_ID_KEY, w.id))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatHistory().then(setMsgs).catch(() => {});
    const un = on<ChatMsg>("chat:message", (m) => {
      setMsgs((p) => (p.some((x) => x.id === m.id) ? p : [...p.slice(-199), m]));
      if (m.from !== nameRef.current) {
        if (!openRef.current) {
          const ch = m.channel || "team";
          setUnreadBy((u) => ({ ...u, [ch]: (u[ch] ?? 0) + 1 }));
        }
        if (soundRef.current) {
          chime();
          buzz(120);
        }
      }
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setOpen(v: boolean) {
    setOpenState(v);
    // The desktop drawer shows every channel at once, so opening it reads all.
    if (v) setUnreadBy({});
  }

  // The phone has no drawer: it opens a single channel, and only that one is
  // read. Without this the mobile badge only ever counted up.
  function markRead(channel?: string) {
    if (channel === undefined) setUnreadBy({});
    else setUnreadBy((u) => (u[channel] ? { ...u, [channel]: 0 } : u));
  }

  function setSound(v: boolean) {
    setSoundState(v);
    localStorage.setItem(CHAT_SOUND_KEY, v ? "1" : "0");
  }

  async function register(n: string, pin: string, role = "", invite = "") {
    const r = await identityRegister(n, pin, role, invite);
    localStorage.setItem(CREW_NAME_KEY, r.name);
    setName(r.name);
    // Invite claims come back pre-approved WITH a session and the durable
    // gateway token — the phone lands on Home with zero waiting.
    if (r.status === "ok" && r.session) {
      localStorage.setItem(SESSION_KEY, r.session);
      if (r.id) localStorage.setItem(CREW_ID_KEY, r.id);
      if (r.role) localStorage.setItem("prodeck.crewRole", r.role);
      if (r.web_token) setWebToken(r.web_token);
      setSession(r.session);
      setAuth("in");
      return;
    }
    setAuth("pending"); // booth/admin approval comes next
  }

  async function login(n: string, pin: string) {
    const r = await identityLogin(n, pin);
    localStorage.setItem(CREW_NAME_KEY, r.name);
    setName(r.name);
    if (r.status === "ok" && r.session) {
      localStorage.setItem(SESSION_KEY, r.session);
      if (r.id) localStorage.setItem(CREW_ID_KEY, r.id);
      setSession(r.session);
      setAuth("in");
    } else {
      setAuth("pending");
    }
  }

  function signOut() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CREW_ID_KEY);
    setSession("");
    setAuth("none");
  }

  function forgetDevice() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CREW_NAME_KEY);
    localStorage.removeItem(CREW_ID_KEY);
    setSession("");
    setName("");
    setAuth("none");
  }

  async function send(text: string, target: ChatMsg["target"], channel = "team") {
    const t = text.trim();
    if (!t) return;
    if (IS_WEB) {
      try {
        await chatSendAs(session, t, target, channel);
      } catch (e) {
        // A revoked/stale session bounces server-side — drop to the join panel.
        if (String(e).includes("sign in")) signOut();
        throw e;
      }
    } else {
      await chatSend(nameRef.current, t, target, channel);
    }
    // Stage messages also drive the real ProPresenter stage displays.
    if (target === "stage") ppSetStageMessage(t);
  }

  // If the booth deleted or revoked this account, the device is still holding a
  // session token and would look signed in while every action silently failed.
  // Check once on launch and forget the device outright, so the join screen
  // comes back at registration rather than stuck asking for a dead name's PIN.
  useEffect(() => {
    if (!IS_WEB) return;
    const tok = localStorage.getItem(SESSION_KEY);
    if (!tok) return;
    checkinList(tok)
      .then((r) => {
        if (r && r.sessionValid === false) forgetDevice();
      })
      .catch(() => {
        /* unreachable booth is not proof the account is gone */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the service worker's copy in step. It needs these to confirm a page
  // from the lock screen without opening the app; a stale copy would let a
  // signed-out phone answer for the previous person.
  useEffect(() => {
    if (!IS_WEB) return;
    if (session) mirrorForServiceWorker(session, getWebToken());
    else clearServiceWorkerSession();
  }, [session]);

  const value: ChatStore = {
    msgs,
    unread,
    unreadBy,
    markRead,
    open,
    setOpen,
    sound,
    setSound,
    send,
    clearConfidence: () => chatClearConfidence().catch(() => {}),
    name: effectiveName,
    auth,
    register,
    login,
    signOut,
    forgetDevice,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): ChatStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
