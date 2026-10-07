import { describe, expect, it, vi } from "vitest";
import { checkSubmission, emailText } from "../../feedback-edge/src/validate";
import { type Draft, FEEDBACK_URL, loadContact, problemWith, saveContact, submitFeedback, toPayload } from "../lib/feedback";
import { scrubEvent, setCrashReportsEnabled, stripUrl } from "../lib/crashReports";

const draft = (over: Partial<Draft> = {}): Draft => ({
  kind: "bug",
  title: "Lyrics stopped following",
  details: "On the second song the slides stopped moving.",
  expected: "",
  urgency: "service",
  contact: { name: "Maya", church: "Grace", email: "maya@example.com" },
  app: { version: "0.9.98", os: "macOS 27", arch: "aarch64", console: "yamaha", web: false, page: "dashboard" },
  diagnostics: "",
  screenshot: null,
  ...over,
});

describe("feedback submission checks (shared with the Worker)", () => {
  it("accepts a complete bug report", () => {
    expect(problemWith(draft())).toBeNull();
  });

  it("asks for a title and a few words", () => {
    expect(problemWith(draft({ title: "  " }))).toBe("Add a short title.");
    expect(problemWith(draft({ details: "broken" }))).toBe("Add a few more words about it.");
  });

  it("lets the email be blank but not wrong", () => {
    expect(problemWith(draft({ contact: { name: "", church: "", email: "" } }))).toBeNull();
    expect(problemWith(draft({ contact: { name: "", church: "", email: "maya@" } }))).toMatch(/email/);
  });

  it("falls back to the mildest urgency when the value doesn't fit the kind", () => {
    const c = checkSubmission({ ...toPayload(draft({ kind: "feature", urgency: "service" })) });
    expect(c.ok && c.value.urgency).toBe("nice");
  });

  it("refuses pictures that aren't images or are too big", () => {
    expect(problemWith(draft({ screenshot: { name: "x.pdf", type: "application/pdf", data: "AAAA" } }))).toMatch(/PNG/);
    expect(problemWith(draft({ screenshot: { name: "x.png", type: "image/png", data: "A".repeat(6_000_000) } }))).toMatch(/too big/);
    expect(problemWith(draft({ screenshot: { name: "x.png", type: "image/png", data: "iVBORw0KGgo=" } }))).toBeNull();
  });

  it("treats a filled honeypot as spam", () => {
    const c = checkSubmission({ ...toPayload(draft()), website: "http://spam" });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.spam).toBe(true);
  });

  it("writes an email subject that says what it is", () => {
    const c = checkSubmission(toPayload(draft()));
    if (!c.ok) throw new Error(c.error);
    const { subject, text } = emailText(c.value, "2026-10-07-abc");
    expect(subject).toBe("[ProDeck bug] Lyrics stopped following");
    expect(text).toContain("Reply to: maya@example.com");
    expect(text).toContain("Console: yamaha");
    expect(text).toContain("Stopped or could stop a service");
  });
});

describe("submitFeedback", () => {
  it("posts to the Worker and returns the reference", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: "ref1" }), { status: 200 }));
    await expect(submitFeedback(draft(), fetchImpl as unknown as typeof fetch)).resolves.toBe("ref1");
    expect(fetchImpl).toHaveBeenCalledWith(FEEDBACK_URL, expect.objectContaining({ method: "POST" }));
  });

  it("never sends a draft the Worker would refuse", async () => {
    const fetchImpl = vi.fn();
    await expect(submitFeedback(draft({ title: "" }), fetchImpl as unknown as typeof fetch)).rejects.toThrow("Add a short title.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows the Worker's own message, and a plain one when offline", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Wait a minute." }), { status: 429 }));
    await expect(submitFeedback(draft(), refused as unknown as typeof fetch)).rejects.toThrow("Wait a minute.");
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(submitFeedback(draft(), offline as unknown as typeof fetch)).rejects.toThrow(/internet connection/);
  });
});

describe("remembered contact", () => {
  it("round trips and survives junk", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveContact({ name: "Maya", church: "Grace", email: "m@x.org" }, store);
    expect(loadContact(store)).toEqual({ name: "Maya", church: "Grace", email: "m@x.org" });
    m.set("prodeck.feedbackContact", "{nope");
    expect(loadContact(store)).toEqual({ name: "", church: "", email: "" });
  });
});

describe("crash report scrubbing", () => {
  it("drops everything while reports are off", () => {
    setCrashReportsEnabled(false);
    expect(scrubEvent({ type: undefined, message: "x" })).toBeNull();
  });

  it("removes the user, the machine name and secrets in URLs", () => {
    setCrashReportsEnabled(true);
    const out = scrubEvent({
      type: undefined,
      user: { id: "1", ip_address: "1.2.3.4" },
      server_name: "Cornerstone-Booth",
      request: { url: "http://booth.local:8088/?kiosk=lobby&token=hunter2", headers: { cookie: "a" } },
      breadcrumbs: [{ data: { url: "https://api.example.com/x?access_token=abc", from: "/a?t=1", to: "/b#frag" } }],
    });
    expect(out?.user).toBeUndefined();
    expect(out?.server_name).toBeUndefined();
    expect(out?.request).toEqual({ url: "http://booth.local:8088/" });
    expect(out?.breadcrumbs?.[0].data).toEqual({ url: "https://api.example.com/x", from: "/a", to: "/b" });
    setCrashReportsEnabled(false);
  });

  it("strips query strings and fragments", () => {
    expect(stripUrl("/join?token=abc#x")).toBe("/join");
    expect(stripUrl("/plain")).toBe("/plain");
  });
});
