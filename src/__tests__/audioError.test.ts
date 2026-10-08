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

  it("names a missing device", () => {
    expect(audioStartMessage("no input device available", "USB Mixer")).toBe(
      '"USB Mixer" isn\'t connected. Plug it in, or choose another input in Settings, Audio.',
    );
  });

  it("passes anything else through, readably", () => {
    expect(audioStartMessage("Error: stream closed", null)).toBe("Audio couldn't start: stream closed");
  });
});
