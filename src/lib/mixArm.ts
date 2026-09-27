// One switch for everything that moves the desk on its own: Automix's Arm.
// The automix sets it; the speech-mic autopilot (lapel, 8 MC) reads it before
// every fader or mute it would send. Disarmed = nothing is controlled.
// (Desk scenes by song leader and the key-send to Waves are separate on
// purpose and don't look at this.)

let armed = false;
const subs = new Set<(on: boolean) => void>();

export const isMixArmed = () => armed;
export function setMixArmed(on: boolean) {
  if (on === armed) return;
  armed = on;
  subs.forEach((f) => f(on));
}
export function onMixArmed(f: (on: boolean) => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
