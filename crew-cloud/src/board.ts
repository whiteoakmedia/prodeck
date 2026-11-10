// The Next Slide leaderboard across every church (src/mobile/NextSlide.tsx).
// One Durable Object for all of them ("global"). A church's own Durable Object
// checks the crew password, then passes the score here with the church's
// crew name, so only signed in crew can put a score on the board.
//
// Stored per player: a random id the phone made, the nickname they chose, the
// church's crew name, the best streak and when they got it. Weekly boards are
// kept 8 weeks, the all time board until White Oak Media removes someone.
// Shown to crew at every church: nickname, church and streak, never the id.

import { DurableObject } from "cloudflare:workers";
import { cleanNick, nickProblem } from "../../src/lib/boardNick";
import { weekKey } from "../../src/lib/weekKey";

export { nickProblem };

/** The highest streak the board believes. */
export const MAX_STREAK = 999;
const TOP = 20;
const KEEP_WEEKS = 8;

const PLAYER_RE = /^[a-z0-9]{16,40}$/;
const CHURCH_RE = /^[a-z0-9-]{3,32}$/;

export interface Row {
  rank: number;
  nick: string;
  church: string;
  best: number;
}

export class Leaderboard extends DurableObject {
  private sql: SqlStorage;
  /** player → recent submit times, against a phone flooding it. */
  private recent = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      board TEXT NOT NULL, player TEXT NOT NULL, church TEXT NOT NULL, nick TEXT NOT NULL,
      best INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (board, player))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS scores_rank ON scores (board, best DESC, at ASC)`);
    // Players taken off by White Oak Media stay off.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS banned (player TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
  }

  private upsert(board: string, player: string, church: string, nick: string, best: number, now: number) {
    const cur = this.sql.exec("SELECT best FROM scores WHERE board = ? AND player = ?", board, player).toArray()[0];
    if (!cur) {
      if (best > 0) this.sql.exec("INSERT INTO scores VALUES (?, ?, ?, ?, ?, ?)", board, player, church, nick, best, now);
      return;
    }
    if (best > Number(cur.best)) {
      this.sql.exec("UPDATE scores SET best = ?, at = ?, nick = ?, church = ? WHERE board = ? AND player = ?", best, now, nick, church, board, player);
    } else {
      // A new nickname shows straight away, without beating the old best.
      this.sql.exec("UPDATE scores SET nick = ?, church = ? WHERE board = ? AND player = ?", nick, church, board, player);
    }
  }

  private top(board: string): Row[] {
    return this.sql
      .exec("SELECT nick, church, best FROM scores WHERE board = ? ORDER BY best DESC, at ASC LIMIT ?", board, TOP)
      .toArray()
      .map((r, i) => ({ rank: i + 1, nick: String(r.nick), church: String(r.church), best: Number(r.best) }));
  }

  /** The player's own place: ahead of everyone lower, behind anyone who got there first. */
  private mine(board: string, player: string): { rank: number; best: number } | null {
    const r = this.sql.exec("SELECT best, at FROM scores WHERE board = ? AND player = ?", board, player).toArray()[0];
    if (!r) return null;
    const ahead = Number(
      this.sql
        .exec("SELECT COUNT(*) AS n FROM scores WHERE board = ? AND (best > ? OR (best = ? AND at < ?))", board, r.best, r.best, r.at)
        .one().n,
    );
    return { rank: ahead + 1, best: Number(r.best) };
  }

  private board(player: string, now: number) {
    const week = weekKey(now);
    return {
      week: { key: week, top: this.top(week), you: PLAYER_RE.test(player) ? this.mine(week, player) : null },
      all: { top: this.top("all"), you: PLAYER_RE.test(player) ? this.mine("all", player) : null },
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    const json = (b: unknown, status = 200) => Response.json(b, { status });

    if (req.method === "GET" && url.pathname === "/board") {
      return json({ ok: true, ...this.board(url.searchParams.get("player") ?? "", now) });
    }

    if (req.method === "POST" && url.pathname === "/submit") {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const player = String(b.player ?? "");
      const church = String(b.church ?? "");
      const nick = cleanNick(String(b.nick ?? ""));
      if (!PLAYER_RE.test(player) || !CHURCH_RE.test(church)) return json({ ok: false, error: "That score couldn't be read." }, 400);
      const problem = nickProblem(nick);
      if (problem) return json({ ok: false, error: problem }, 400);
      const n = (x: unknown) => Math.max(0, Math.min(MAX_STREAK, Math.floor(Number(x) || 0)));
      const week = n(b.week);
      const all = Math.max(n(b.all), week);
      if (this.sql.exec("SELECT 1 FROM banned WHERE player = ?", player).toArray().length) {
        return json({ ok: false, error: "This phone can't post to the leaderboard." }, 403);
      }
      const times = (this.recent.get(player) ?? []).filter((t) => now - t < 60_000);
      if (times.length >= 12) return json({ ok: false, error: "Slow down a little." }, 429);
      this.recent.set(player, [...times, now]);
      if (this.recent.size > 5000) this.recent.clear();
      this.upsert(weekKey(now), player, church, nick, week, now);
      this.upsert("all", player, church, nick, all, now);
      // Weeks older than KEEP_WEEKS go.
      const oldest = weekKey(now - KEEP_WEEKS * 7 * 86_400_000);
      this.sql.exec("DELETE FROM scores WHERE board != 'all' AND board < ?", oldest);
      return json({ ok: true, ...this.board(player, now) });
    }

    // White Oak Media only (index.ts checks BOARD_ADMIN_TOKEN): take someone off.
    if (req.method === "POST" && url.pathname === "/remove") {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const nick = cleanNick(String(b.nick ?? ""));
      const church = String(b.church ?? "");
      const players = this.sql
        .exec("SELECT DISTINCT player FROM scores WHERE nick = ? AND (? = '' OR church = ?)", nick, church, church)
        .toArray()
        .map((r) => String(r.player));
      for (const p of players) {
        this.sql.exec("INSERT OR IGNORE INTO banned VALUES (?, ?)", p, now);
        this.sql.exec("DELETE FROM scores WHERE player = ?", p);
      }
      return json({ ok: true, removed: players.length });
    }

    return json({ ok: false, error: "not found" }, 404);
  }
}
