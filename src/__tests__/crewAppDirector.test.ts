import { describe, expect, it } from "vitest";
import { directorAnswer, directorBack, directorCode } from "../../crew-app/src/director";

const churches = [
  { base: "http://192.168.1.20:8088", name: "Booth", lastMs: 0 },
  { base: "http://10.0.0.5:1420", name: "Other", lastMs: 0, crew: "https://grace-crew.prodeck.live" },
];

describe("crew app Director Face ID", () => {
  it("goes back only to a booth this phone knows", () => {
    expect(directorBack("http://192.168.1.20:8088/?x=1#old", churches)).toBe("http://192.168.1.20:8088/?x=1");
    expect(directorBack("https://grace-crew.prodeck.live/", churches)).toBe("https://grace-crew.prodeck.live/");
    expect(directorBack("https://cornerstone.local.prodeck.live/", churches)).toBe("https://cornerstone.local.prodeck.live/");
    expect(directorBack("http://evil.example/", churches)).toBeNull();
    expect(directorBack("javascript:alert(1)", churches)).toBeNull();
    expect(directorBack("http://cornerstone.local.prodeck.live/", churches)).toBeNull();
    expect(directorBack("not a url", churches)).toBeNull();
  });

  it("answers with the code, pin, or nothing", () => {
    expect(directorAnswer("http://b/", "abc")).toBe("http://b/#crewdirector=abc");
    expect(directorAnswer("http://b/", "pin")).toBe("http://b/#crewdirector=pin");
    expect(directorAnswer("http://b/", "")).toBe("http://b/");
  });

  it("takes only a hex code", () => {
    expect(directorCode("0123456789abcdef01234567")).toBe("0123456789abcdef01234567");
    expect(directorCode("<script>")).toBe("");
    expect(directorCode(null)).toBe("");
  });
});
