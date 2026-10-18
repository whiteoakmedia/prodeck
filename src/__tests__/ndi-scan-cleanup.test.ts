import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * NDI scans must clean up after themselves on every path.
 *
 * mdns-sd keeps its daemon thread (and a socket per interface plus a signal
 * socket) alive until shutdown() is called; dropping the handle isn't enough.
 * The NDI fallback scan never called it, so a booth Mac refreshing the source
 * list every minute ran out of file descriptors ("Too many open files") and
 * every later mDNS use failed too. The failed scan then surfaced in the UI as
 * an unhandled rejection because the scan buttons had try/finally, no catch.
 */

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const root = join(__dirname, "..", "..");

describe("mDNS daemons are shut down", () => {
  const rust = files(join(root, "src-tauri", "src"), /\.rs$/).filter((p) =>
    readFileSync(p, "utf8").includes("ServiceDaemon::new()"),
  );

  it("finds the Rust files that start a daemon", () => {
    expect(rust.length).toBeGreaterThan(0);
  });

  for (const p of rust) {
    const src = readFileSync(p, "utf8");
    it(`${p.slice(root.length + 1)} never bails out of a browse with ?`, () => {
      // A `?` on browse returns before shutdown() and leaks the daemon.
      expect(src).not.toMatch(/\.browse\([^;]*\)\s*(\.map_err\([^;]*\))?\?;/);
    });
    it(`${p.slice(root.length + 1)} calls shutdown once per daemon at least`, () => {
      const daemons = src.match(/ServiceDaemon::new\(\)/g)!.length;
      const shutdowns = (src.match(/\.shutdown\(\)/g) ?? []).length;
      expect(shutdowns).toBeGreaterThanOrEqual(daemons);
    });
  }
});

/** True when `node` sits inside the try block of a try statement that has a catch. */
function insideTryWithCatch(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const p: ts.Node | undefined = n.parent;
    if (p && ts.isTryStatement(p) && p.tryBlock === n && p.catchClause) return true;
    if (ts.isFunctionLike(n)) return false;
  }
  return false;
}

/** True when the call's promise is chained straight into .catch(...). */
function chainedCatch(call: ts.Node): boolean {
  const p = call.parent;
  return !!p && ts.isPropertyAccessExpression(p) && p.name.text === "catch";
}

describe("every ndiDiscover call handles a failed scan", () => {
  const tsFiles = files(join(root, "src"), /\.tsx?$/);
  const calls: { file: string; line: number; ok: boolean }[] = [];
  for (const file of tsFiles) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("ndiDiscover(")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "ndiDiscover"
      ) {
        calls.push({
          file: file.slice(root.length + 1),
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          ok: chainedCatch(n) || insideTryWithCatch(n),
        });
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }

  it("finds the scan buttons", () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it("has a catch on each one", () => {
    expect(calls.filter((c) => !c.ok)).toEqual([]);
  });
});
