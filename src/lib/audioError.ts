// What to tell someone when the computer won't open the audio input.
//
// The raw errors come from the audio library and mean nothing at the booth:
// "input config: A backend-specific error has occurred: An unknown error
// unknown to the coreaudio-rs API occurred" (PRODECK-4) is macOS refusing the
// device, almost always because ProDeck isn't allowed the microphone or the
// chosen input isn't plugged in. Say that, and keep the original for support.

export function audioStartMessage(raw: string, device: string | null | undefined): string {
  const r = raw.replace(/^Error:\s*/, "").trim();
  const name = device ? `"${device}"` : "the audio input";
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  if (/coreaudio|backend-specific|input config|permission|not authori[sz]ed|denied/i.test(r)) {
    return mac
      ? `The Mac wouldn't open ${name}. In System Settings, Privacy & Security, Microphone, make sure ProDeck is switched on, and check the input is plugged in. Then press Start again.`
      : `The computer wouldn't open ${name}. Check the input is plugged in and that ProDeck is allowed to use the microphone, then press Start again.`;
  }
  if (/no (default )?input device|device not available|not found|no such device/i.test(r)) {
    return `${device ? `"${device}" isn't connected` : "This computer has no audio input"}. Plug it in, or choose another input in Settings, Audio.`;
  }
  return `Audio couldn't start: ${r}`;
}
