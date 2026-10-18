// What to tell someone when the computer won't open the audio input.
//
// The raw errors come from the audio library and mean nothing at the booth:
// "input config: A backend-specific error has occurred: An unknown error
// unknown to the coreaudio-rs API occurred" (PRODECK-4) is macOS refusing the
// device, almost always because ProDeck isn't allowed the microphone or the
// chosen input isn't plugged in. Say that, and keep the original for support.

// The booth's web gateway refuses audio commands to a phone or browser signed
// in with the crew password ("'list_audio_inputs' needs admin access"). That's
// on purpose, so say where captions get set up instead (Sentry 7798638221).
export const CREW_AUDIO_MESSAGE =
  "Captions are set up on the booth computer. This screen is signed in with the crew password, so it can't pick the audio input.";

export function isCrewRefusal(raw: unknown): boolean {
  return /needs admin access|needs the .* permission/i.test(String(raw));
}

export function audioStartMessage(raw: string, device: string | null | undefined): string {
  if (isCrewRefusal(raw)) return CREW_AUDIO_MESSAGE;
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
