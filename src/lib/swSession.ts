// Mirror the crew session + gateway token into IndexedDB.
//
// A service worker cannot read localStorage, and the "Got it" action on a page
// notification has to authenticate to the booth WITHOUT opening the app —
// that's the entire point of confirming from a lock screen. IndexedDB is the
// one store both sides can reach, so the page keeps a copy there.
//
// Only these two values are mirrored, and they're cleared on sign-out so a
// signed-out phone can't silently confirm pages for the previous person.

const DB = "prodeck";
const STORE = "kv";

function withStore(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        resolve(open.result.transaction(STORE, mode).objectStore(STORE));
      } catch {
        resolve(null);
      }
    };
  });
}

export async function mirrorForServiceWorker(session: string, token: string): Promise<void> {
  const store = await withStore("readwrite");
  if (!store) return;
  try {
    store.put(session, "session");
    store.put(token, "token");
  } catch {
    /* best-effort — the in-app confirm path still works without it */
  }
}

export async function clearServiceWorkerSession(): Promise<void> {
  const store = await withStore("readwrite");
  if (!store) return;
  try {
    store.delete("session");
    store.delete("token");
  } catch {
    /* ignore */
  }
}
