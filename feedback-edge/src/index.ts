/**
 * prodeck-feedback: the inbox behind ProDeck's "Report a bug" and "Request a
 * feature". POST /submit with a JSON submission (see validate.ts); it is kept
 * in KV for 180 days and emailed to FEEDBACK_TO through Resend.
 *
 * The app is open source, so it can't hold an email key. This Worker is the
 * only thing that does, as the RESEND_API_KEY secret.
 */
import { checkSubmission, emailText, type Submission } from "./validate";

interface Env {
  SUBMISSIONS: KVNamespace;
  PER_IP: RateLimit;
  RESEND_API_KEY?: string;
  FEEDBACK_TO: string;
  FEEDBACK_FROM: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function sendEmail(env: Env, s: Submission, id: string): Promise<string | null> {
  if (!env.RESEND_API_KEY) return "no RESEND_API_KEY";
  const { subject, text } = emailText(s, id);
  const attachments: { filename: string; content: string }[] = [];
  if (s.diagnostics) {
    const bytes = new TextEncoder().encode(s.diagnostics);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    attachments.push({ filename: "diagnostics.json", content: btoa(bin) });
  }
  if (s.screenshot) attachments.push({ filename: s.screenshot.name, content: s.screenshot.data });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FEEDBACK_FROM,
      to: [env.FEEDBACK_TO],
      ...(s.email ? { reply_to: s.email } : {}),
      subject,
      text,
      html: `<pre style="font: 14px/1.5 -apple-system, Segoe UI, sans-serif; white-space: pre-wrap">${escapeHtml(text)}</pre>`,
      ...(attachments.length ? { attachments } : {}),
      tags: [{ name: "kind", value: s.kind }],
    }),
  });
  if (res.ok) return null;
  return `resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/" && req.method === "GET") return json({ ok: true, service: "prodeck-feedback" });
    if (url.pathname !== "/submit" || req.method !== "POST") return json({ ok: false, error: "Not found." }, 404);

    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.PER_IP.limit({ key: ip });
    if (!success) return json({ ok: false, error: "That's a lot of reports at once. Wait a minute and try again." }, 429);

    if (Number(req.headers.get("Content-Length") ?? 0) > 8_000_000) {
      return json({ ok: false, error: "That's too big to send. Try a smaller picture." }, 413);
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "The report didn't come through. Try again." }, 400);
    }
    const checked = checkSubmission(body);
    if (!checked.ok) {
      // Tell a bot it worked, so it has nothing to tune against.
      if (checked.spam) return json({ ok: true, id: "ok" });
      return json({ ok: false, error: checked.error }, 400);
    }
    const s = checked.value;
    const day = new Date().toISOString().slice(0, 10);
    const id = `${day}-${crypto.randomUUID().slice(0, 8)}`;

    // Kept first, so nothing is lost if the email fails. The picture stays out
    // of KV (size); the email carries it.
    const record = { ...s, screenshot: s.screenshot ? { name: s.screenshot.name, type: s.screenshot.type } : null, at: new Date().toISOString(), country: req.headers.get("CF-IPCountry") ?? "" };
    await env.SUBMISSIONS.put(`${s.kind}/${id}`, JSON.stringify(record), { expirationTtl: 180 * 86400 });

    const err = await sendEmail(env, s, id);
    if (err) {
      console.error(`feedback ${id}: email failed: ${err}`);
      ctx.waitUntil(env.SUBMISSIONS.put(`unsent/${id}`, err, { expirationTtl: 180 * 86400 }));
    }
    // The submission is safe in KV either way, so the person is done.
    return json({ ok: true, id });
  },
};
