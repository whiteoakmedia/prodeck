// Whether someone on this computer has confirmed, once, that Automix moves
// live faders and comes with no warranty (asked on the first Arm).
const KEY = "prodeck.automixAcknowledged";

export function automixAcknowledged(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutomixAcknowledged() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* asked again next time: harmless */
  }
}
