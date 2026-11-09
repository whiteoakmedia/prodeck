// When a browser's live stream from the booth should be reopened
// (lib/tauri.ts, reconnectSse). Pure, so the rules are tested.

/** The booth sends a heartbeat frame after 15 quiet seconds (web.rs
 *  serve_sse); three missed heartbeats means the stream is dead. */
export const SSE_STALL_MS = 45_000;
/** Coming back to the screen or the network: a stream this quiet is reopened
 *  straight away rather than waiting out the full stall time. */
export const SSE_RESUME_MS = 20_000;

/** How long to wait before reopening a stream that closed, after `failures`
 *  failed tries in a row: 1, 2, 4, 8, 16 seconds, then every 30, with a
 *  little jitter so a room of phones doesn't knock all at once. */
export function sseRetryDelay(failures: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(failures, 5)));
  return Math.round(base * (0.8 + 0.4 * rand()));
}

/** Whether a stream whose last frame arrived at `lastFrame` is dead by `now`. */
export function sseStalled(lastFrame: number, now: number, limit = SSE_STALL_MS): boolean {
  return lastFrame > 0 && now - lastFrame > limit;
}
