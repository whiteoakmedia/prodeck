// One-time migration from the legacy localStorage prefix. Crew sessions,
// kiosk tokens, and device prefs all live in localStorage — a bare rename
// would sign out every phone and kiosk in the building. Old keys are left in
// place so a rollback build still finds them. Deliberately the only place in
// the frontend where the old name appears.
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("prodlink.")) {
      const nk = "prodeck." + k.slice("prodlink.".length);
      if (localStorage.getItem(nk) === null) {
        localStorage.setItem(nk, localStorage.getItem(k) ?? "");
      }
    }
  }
} catch {
  // storage unavailable (private mode etc.) — nothing to migrate
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
