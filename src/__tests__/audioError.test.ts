import { describe, expect, it } from "vitest";
import { audioStartMessage } from "../lib/audioError";

describe("audioStartMessage", () => {
  it("turns the CoreAudio refusal into something to do (PRODECK-4)", () => {
    const m = audioStartMessage(
      "input config: A backend-specific error has occurred: An unknown error unknown to the coreaudio-rs API occurred",
      "Dante Virtual Soundcard",
    );
    expect(m).toMatch(/Microphone|plugged in/);
    expect(m).toContain('"Dante Virtual Soundcard"');
    expect(m).not.toMatch(/coreaudio/);
  });

  // start_audio_capture now names the device and says what to do instead of
  // "input config: …". The CoreAudio refusal inside it still gets the
  // microphone wording; any other refusal shows the backend's own advice.
  it("still recognises the CoreAudio refusal inside the named message", () => {
    const m = audioStartMessage(
      "Dante Virtual Soundcard: can't read its input format (A backend-specific error has occurred: An unknown error unknown to the coreaudio-rs API occurred). Pick a different input in Settings → Audio, or reconnect the interface.",
      "Dante Virtual Soundcard",
    );
    expect(m).toMatch(/Microphone|plugged in/);
    expect(m).not.toMatch(/coreaudio/);
  });

  it("passes a named format refusal through with its advice", () => {
    expect(
      audioStartMessage(
        "Scarlett 2i2: can't read its input format (The requested stream format is not supported). Pick a different input in Settings → Audio, or reconnect the interface.",
        "Scarlett 2i2",
      ),
    ).toBe(
      "Audio couldn't start: Scarlett 2i2: can't read its input format (The requested stream format is not supported). Pick a different input in Settings → Audio, or reconnect the interface.",
    );
  });

  it("names a missing device", () => {
    expect(audioStartMessage("no input device available", "USB Mixer")).toBe(
      '"USB Mixer" isn\'t connected. Plug it in, or choose another input in Settings, Audio.',
    );
  });

  it("passes anything else through, readably", () => {
    expect(audioStartMessage("Error: stream closed", null)).toBe("Audio couldn't start: stream closed");
  });
});
