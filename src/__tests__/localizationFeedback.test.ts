import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import copy from "./fixtures/localization/feedbackCopy.json";
import frozen from "./fixtures/localization/feedbackBaseline.json";

// Registered only here: these two files. Exact reviewed leaf text is allowed;
// everything else, including JSX whitespace and template delimiters, is frozen.
// Baseline provenance was checked against e4522b6, not generated at test runtime.
function inspect(file: keyof typeof copy, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const seen = new Map<number, string>();
  function walk(node: ts.Node): unknown {
    const children = node.getChildren(source);
    if (children.length) return [node.kind, children.map(walk)];
    const raw = ts.isJsxText(node) ? node.text : node.getText(source);
    for (const [i, [original, spanish]] of copy[file].entries()) {
      for (const value of [original, spanish]) {
        let expected: string | undefined;
        if (ts.isJsxText(node)) expected = value;
        else if (ts.isStringLiteral(node)) expected = JSON.stringify(value);
        else if (ts.isTemplateHead(node)) expected = "`" + value + "${";
        if (raw === expected) {
          if (seen.has(i)) throw new Error(`Duplicate copy slot ${i}`);
          seen.set(i, value);
          return [node.kind, `COPY:${i}`];
        }
      }
    }
    return [node.kind, raw];
  }
  const hash = createHash("sha256").update(JSON.stringify(walk(source))).digest("hex");
  if (seen.size !== copy[file].length || hash !== frozen[file]) throw new Error(`Protected structure changed: ${file}`);
  return seen;
}
const files = Object.keys(copy) as (keyof typeof copy)[];
const sources = Object.fromEntries(files.map((file) => [file, readFileSync(file, "utf8")])) as Record<keyof typeof copy, string>;
type Inspection = { seen: ReturnType<typeof inspect> } | { error: unknown };
const unchanged = new Map<keyof typeof copy, Inspection>();
// Lazy and limited to the immutable source strings loaded above. Cache only a
// completed inspection or its thrown error, never an in-progress/partial map.
// Mutation tests deliberately bypass this cache and inspect their changed text.
function inspectUnchanged(file: keyof typeof copy) {
  let result = unchanged.get(file);
  if (!result) {
    try {
      result = { seen: inspect(file, sources[file]) };
    } catch (error) {
      result = { error };
    }
    unchanged.set(file, result);
  }
  if ("error" in result) throw result.error;
  return result.seen;
}
describe("feedback and error presentation protection", () => {
  for (const file of files) {
    it(`freezes executable structure and exact whitespace in ${file}`, () => {
      expect(inspectUnchanged(file).size).toBe(copy[file].length);
    });
    for (const [i, [, spanish]] of copy[file].entries()) {
      it(`localizes ${file} reviewed slot ${i}: ${spanish}`, () => {
        expect(inspectUnchanged(file).get(i)).toBe(spanish);
      });
    }
    it(`rejects spaces, NBSP and expressions in every reviewed slot of ${file}`, () => {
      for (const [original, spanish] of copy[file]) {
        const source = sources[file];
        const current = source.includes(spanish) ? spanish : original;
        for (const changed of [` ${current}`, `${current}\u00a0`, `{String(${JSON.stringify(current)})}`]) {
          expect(source).toContain(current);
          expect(() => inspect(file, source.replace(current, changed))).toThrow();
        }
      }
    });
  }
  const feedback = "src/components/FeedbackDialog.tsx";
  const error = "src/components/ErrorBoundary.tsx";
  it.each([
    [feedback, 'from: "feedback"', 'from: "changed"'],
    [feedback, 'kind,\n      title,', 'kind: "feature",\n      title,'],
    [feedback, 'submitFeedback(draft)', 'submitFeedback({ ...draft, title: "changed" })'],
    [feedback, 'onClick={onClose}', 'onClick={() => onClose()}'],
    [feedback, 'id: "service"', 'id: "evento"'],
    [feedback, 'disabled={busy}', 'disabled={!busy}'],
    [feedback, 'app: { version:', 'app: { extra: true, version:'],
    [feedback, 'return "";', 'return " ";'],
    [error, 'location.reload()', 'location.assign("/")'],
    [error, 'reportRenderCrash(error, info.componentStack)', 'reportRenderCrash(error, "changed")'],
    [error, 'ProDeck render crash', 'Error de ProDeck'],
    [error, 'page="crash screen"', 'page="pantalla de error"'],
    [error, 'ProDeck stopped drawing: ', 'ProDeck dejó de mostrarse: '],
    [error, 'What I was doing when it happened:', 'Qué estaba haciendo:'],
    [error, 'component stack:', 'pila de componentes:'],
    [error, '<pre>{this.details()}</pre>', '<pre> {this.details()}</pre>'],
    [error, '<pre>{this.details()}</pre>', '<pre>\u00a0{this.details()}</pre>'],
  ])("rejects unreviewed mutation %s %s", (file, before, after) => {
    const key = file as keyof typeof copy;
    expect(sources[key]).toContain(before);
    expect(() => inspect(key, sources[key].replace(before, after))).toThrow();
  });
});
