import { useEffect, useState } from "react";
import { IS_WEB, on, webWhoami, type Perm, type WhoAmI } from "./tauri";

/**
 * What may this screen do? One hook, so every phone screen and widget asks the
 * same question the gateway answers — never "which password was typed".
 *
 * Refreshes when the booth changes anyone's account (approval, grants), so a
 * grant lands on the volunteer's phone without them signing out and in.
 */
const ALL: WhoAmI = { tier: "admin", perms: ["page", "stage", "control", "tap", "manage"], name: null };

export function usePerms() {
  const [who, setWho] = useState<WhoAmI | null>(IS_WEB ? null : ALL);
  useEffect(() => {
    if (!IS_WEB) return;
    let alive = true;
    const load = () => webWhoami().then((w) => alive && setWho(w)).catch(() => {});
    load();
    const sub = on("identity:changed", load);
    // A sign-in or sign-out on this phone changes who we are.
    const onStorage = () => load();
    window.addEventListener("prodeck:session", onStorage);
    return () => {
      alive = false;
      sub.then((fn) => fn()).catch(() => {});
      window.removeEventListener("prodeck:session", onStorage);
    };
  }, []);
  const isAdmin = who?.tier === "admin";
  const can = (p: Perm) => isAdmin || !!who?.perms.includes(p);
  return { who, loaded: who !== null, isAdmin, can };
}
