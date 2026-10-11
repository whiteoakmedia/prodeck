// Church Online on every screen.
//
// <ChopRunner/> runs on the booth only: every 30 s it asks ChOP which service
// is live or next, every 5 s it collects new webhook events from the church's
// relay inbox, keeps per-service totals (saved, so a restart mid-service keeps
// the count), pages the chosen crew about prayer requests and salvation
// responses, and publishes the summary as `chop:state`. useChop() reads that
// summary anywhere: the booth, phones and kiosks alike.

import { useEffect, useRef, useState } from "react";
import { useProDeck } from "./store";
import { IS_WEB, chopGetState, chopSetState, on, pageSend } from "./lib/tauri";
import {
  type ChopService,
  type ChopSummary,
  type ServiceTally,
  fetchCurrentService,
  fetchInbox,
  foldEvents,
  pageFor,
  summarize,
} from "./lib/chop";

const TALLY_KEY = "prodeck.chopTallies";
const CURSOR_KEY = "prodeck.chopCursor";
const SERVICE_MS = 30_000;
const INBOX_MS = 5_000;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: totals start again after a restart */
  }
}

export function useChop(): ChopSummary | null {
  const [s, setS] = useState<ChopSummary | null>(null);
  useEffect(() => {
    let alive = true;
    if (!IS_WEB) chopGetState().then((v) => alive && v && setS(v as ChopSummary)).catch(() => {});
    const un = on<ChopSummary>("chop:state", (v) => alive && setS(v));
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);
  return s;
}

export function ChopRunner() {
  const { settings } = useProDeck();
  const domain = settings?.chop_domain?.trim() ?? "";
  const inbox = settings?.chop_inbox ?? "";
  const token = settings?.chop_inbox_token ?? "";
  const pageTo = settings?.chop_page_to ?? [];
  const pagePrayer = settings?.chop_page_prayer !== false;
  const pageSalvation = settings?.chop_page_salvation !== false;

  const service = useRef<ChopService | null>(null);
  const serviceError = useRef("");
  const tallies = useRef<Record<string, ServiceTally>>(load(TALLY_KEY, {}));
  const hooks = useRef<ChopSummary["webhooks"]>({ connected: false, lastEventAt: 0, lastBadSignatureAt: 0, hasSecret: false, error: "" });
  const opts = useRef({ pageTo, pagePrayer, pageSalvation });
  opts.current = { pageTo, pagePrayer, pageSalvation };

  const publish = () => {
    chopSetState(summarize(domain, service.current, serviceError.current, tallies.current, hooks.current, Date.now())).catch(() => {});
  };

  // Which service is live or next.
  useEffect(() => {
    if (IS_WEB) return;
    if (!domain) {
      chopSetState(null).catch(() => {});
      return;
    }
    let alive = true;
    const tick = () =>
      fetchCurrentService(domain)
        .then((s) => {
          service.current = s;
          serviceError.current = "";
        })
        .catch((e) => {
          serviceError.current = e instanceof Error ? e.message : String(e);
        })
        .finally(() => alive && publish());
    tick();
    const iv = setInterval(tick, SERVICE_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // Webhook events from the relay.
  useEffect(() => {
    if (IS_WEB || !domain || !inbox || !token) {
      hooks.current = { ...hooks.current, connected: false };
      return;
    }
    let alive = true;
    let busy = false;
    const cursorKey = `${CURSOR_KEY}.${inbox}`;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        let after = load<number>(cursorKey, 0);
        for (let i = 0; i < 10; i++) {
          const page = await fetchInbox(inbox, token, after);
          const { tallies: next, fresh } = foldEvents(tallies.current, page.events);
          tallies.current = next;
          save(TALLY_KEY, next);
          const o = opts.current;
          if (o.pageTo.length) {
            for (const e of fresh) {
              const body = pageFor(e, { prayer: o.pagePrayer, salvation: o.pageSalvation }, Date.now());
              if (body) pageSend("Church Online", body, o.pageTo, true).catch(() => {});
            }
          }
          hooks.current = {
            connected: true,
            lastEventAt: page.lastEventAt,
            lastBadSignatureAt: page.lastBadSignatureAt,
            hasSecret: page.hasSecret,
            error: "",
          };
          after = page.seq;
          save(cursorKey, after);
          if (page.seq >= page.latest) break;
        }
      } catch (e) {
        const status = (e as { status?: number }).status;
        hooks.current = {
          ...hooks.current,
          connected: false,
          error:
            status === 401 || status === 404
              ? "The relay doesn't recognise this inbox any more. Set up webhooks again in Settings, Church Online."
              : e instanceof Error
                ? e.message
                : String(e),
        };
      } finally {
        busy = false;
        if (alive) publish();
      }
    };
    tick();
    const iv = setInterval(tick, INBOX_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, inbox, token]);

  return null;
}
