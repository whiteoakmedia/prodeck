import { describe, expect, it } from "vitest";
import { keepBreadcrumb, scrubEvent, scrubText } from "../../crew-app/src/scrub";

// The crew app's crash reports must never carry where the church's booth is
// or what it's called (crew-app/src/crash.ts).
describe("crew app crash report scrubbing", () => {
  it("blanks addresses and booth names", () => {
    expect(scrubText("Can't reach 172.16.0.243:8088")).toBe("Can't reach x.x.x.x:8088");
    expect(scrubText("Booth-Mac.local answered")).toBe("<booth>.local answered");
    expect(scrubText("open https://grace.local.prodeck.live:8443/manifest.json")).toBe(
      "open https://<host>/manifest.json",
    );
    expect(scrubText("grace.local.prodeck.live refused")).toBe("<booth>.local.prodeck.live refused");
    expect(scrubText("fetch http://10.0.0.5:8088/api/origin")).toBe("fetch http://<host>/api/origin");
  });

  it("leaves the app's own address and plain counts alone", () => {
    expect(scrubText("capacitor://localhost/index.html")).toBe("capacitor://localhost/index.html");
    expect(scrubText("capacitor://localhost/?crewpush=apns:abc")).toBe("capacitor://localhost/");
    expect(scrubText("509 checked: 0 answered, 4 refused, 505 silent, 2.1s")).toBe(
      "509 checked: 0 answered, 4 refused, 505 silent, 2.1s",
    );
  });

  it("strips identity and query strings from events", () => {
    const e = scrubEvent({
      user: { id: "x" },
      server_name: "phone",
      message: "join http://192.168.1.4:8088/?invite=abc",
      exception: { values: [{ value: "Booth-Mac.local timed out" }] },
      request: { url: "capacitor://localhost/?crewpush=apns:abc#x" },
    });
    expect(e.user).toBeUndefined();
    expect(e.server_name).toBeUndefined();
    expect(e.message).toBe("join http://<host>/");
    expect(e.exception?.values?.[0].value).toBe("<booth>.local timed out");
    expect(e.request?.url).toBe("capacitor://localhost/");
  });

  it("drops network and console breadcrumbs, keeps taps", () => {
    expect(keepBreadcrumb({ category: "fetch", message: "GET http://10.0.0.5" })).toBeNull();
    expect(keepBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(keepBreadcrumb({ category: "navigation" })).toBeNull();
    expect(keepBreadcrumb({ category: "ui.click", message: "button.primary" })).toEqual({
      category: "ui.click",
      message: "button.primary",
    });
  });
});
