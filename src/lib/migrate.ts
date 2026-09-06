// One-time migration from the legacy localStorage prefix. Crew sessions,
// kiosk tokens, and device prefs all live in localStorage — a bare rename
// would sign out every phone and kiosk in the building. Old keys are left in
// place so a rollback build still finds them. Deliberately the only place in
// the frontend where the old name appears.
//
// This lives in its own module imported FIRST from main.tsx: ES imports are
// hoisted, so code placed above the imports in main.tsx still ran AFTER
// lib/tauri.ts had already read the (unmigrated) web token and skipped
// opening the event stream.
try {
  // Snapshot the keys first — inserting while iterating localStorage.key(i)
  // can skip entries.
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  for (const k of keys) {
    if (k.startsWith("prodlink.")) {
      const nk = "prodeck." + k.slice("prodlink.".length);
      if (localStorage.getItem(nk) === null) {
        localStorage.setItem(nk, localStorage.getItem(k) ?? "");
      }
    }
  }
} catch {
  // storage unavailable (private mode etc.) — nothing to migrate
}

export {};
