// ProDeck service worker — the PWA backbone.
//
// Two jobs: keep the app openable when the booth is unreachable, and let a page
// be confirmed straight from the lock screen.
//
// CACHING RULES (the important part):
//   * The app SHELL is cached so the PWA opens with no network. Without this,
//     the "Command Center offline" screen could never render — the phone
//     couldn't even load the code that draws it.
//   * /api/* is NEVER cached. Serving a stale slide index, SPL reading or chat
//     history during a service is worse than showing nothing: the operator
//     would act on numbers that aren't true any more.
//   * Navigations are network-first, falling back to the cached shell, so a
//     new build lands as soon as the booth is reachable again.

const SHELL = "prodeck-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/manifest.json", "/icon-192.png", "/icon-512.png"]))
      .catch(() => {
        /* a failed precache must not block activation */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Live data and the event stream must always hit the booth.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Built assets are content-hashed, so cache-first is safe and instant.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".png"))) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});

// --------------------------------------------------------------- web push

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  } else {
    // Payload-less = the crew-edge worker: someone messaged while the booth
    // was off. Deliberately content-free (no encryption keys at the edge,
    // nothing readable on a lock screen); the app shows the real text.
    data = {
      title: "ProDeck · Team chat",
      body: "New message while the booth is offline — open to read.",
      tag: "chat-cloud",
    };
  }
  const title = data.title || "ProDeck";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Pages renotify so a re-buzz actually buzzes again.
      renotify: !!data.page,
      requireInteraction: !!data.page,
      // Android honors vibrate on the notification itself (iOS buzzes on its
      // own): urgent triple for pages, a short tap for everything else.
      vibrate: data.page ? [400, 150, 400, 150, 600] : [150],
      // S07b: confirm without opening the app. That is the whole point on a
      // Sunday — phone at hip, one tap, back to work.
      actions: data.page
        ? [
            { action: "ack", title: "✓ Got it" },
            { action: "open", title: "Open" },
          ]
        : [],
      data: { url: data.url || "/", page: !!data.page, pageId: data.pageId ?? null },
    }),
  );
});

// The crew session lives in localStorage, which a service worker cannot read.
// The page mirrors it into IndexedDB (see lib/swSession.ts) so "Got it" can
// authenticate without launching the app.
function readSession() {
  return new Promise((resolve) => {
    const open = indexedDB.open("prodeck", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => resolve("");
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("session");
        get.onsuccess = () => resolve(get.result || "");
        get.onerror = () => resolve("");
      } catch {
        resolve("");
      }
    };
  });
}

async function ackPage(pageId) {
  const session = await readSession();
  if (!session || !pageId) return false;
  try {
    const res = await fetch("/api/cmd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The gateway token is also needed; it rides in the same store.
      body: JSON.stringify({
        cmd: "page_ack",
        args: { pageId, session },
        token: await readToken(),
      }),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok && !j.error;
  } catch {
    return false;
  }
}

function readToken() {
  return new Promise((resolve) => {
    const open = indexedDB.open("prodeck", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => resolve("");
    open.onsuccess = () => {
      try {
        const get = open.result.transaction("kv", "readonly").objectStore("kv").get("token");
        get.onsuccess = () => resolve(get.result || "");
        get.onerror = () => resolve("");
      } catch {
        resolve("");
      }
    };
  });
}

self.addEventListener("notificationclick", (event) => {
  const { url = "/", pageId } = event.notification.data || {};
  event.notification.close();

  // "Got it" resolves without opening the app. If the ack fails (offline, dead
  // session) we fall through to opening the app rather than silently swallowing
  // it — a confirm that didn't reach the booth must never look successful.
  if (event.action === "ack") {
    event.waitUntil(
      ackPage(pageId).then((ok) => {
        if (ok) return;
        return self.clients.openWindow(url);
      }),
    );
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
