// The address phones and kiosks on the church network use to reach the booth.
//
// Built from the computer's real ".local" name (lan_address in lan.rs), not
// the settings' device name: on a network whose router adds its own domain
// that name reads "Mac.localdomain", and ProDeck made links like
// http://Mac.localdomain.local:8088 that never loaded. The IP address is the
// fallback for devices that can't look up ".local" names.

import { useEffect, useState } from "react";
import { IS_WEB, lanAddress, type LanAddress } from "./tauri";

/** "Mac.localdomain" → "Mac.local" (used only until the booth answers). */
export const hostLabel = (name: string): string => `${(name || "").trim().split(".")[0] || "this-computer"}.local`;

/** The main address: the church's own domain if set, else this computer's .local name. */
export function lanBaseUrl(publicUrl: string | undefined, lan: LanAddress | null, deviceName: string, port: number): string {
  const pub = (publicUrl ?? "").trim().replace(/\/+$/, "");
  if (pub) return pub;
  return `http://${lan?.host || hostLabel(deviceName)}:${port || 8088}`;
}

/** The same place by IP address, for devices that can't use .local names. */
export function ipBaseUrl(lan: LanAddress | null, port: number): string | null {
  const ip = lan?.ips?.[0];
  return ip ? `http://${ip}:${port || 8088}` : null;
}

/** This computer's network address, from the booth. Null in a browser. */
export function useLanAddress(): LanAddress | null {
  const [lan, setLan] = useState<LanAddress | null>(null);
  useEffect(() => {
    if (IS_WEB) return;
    lanAddress().then(setLan).catch(() => {});
  }, []);
  return lan;
}
