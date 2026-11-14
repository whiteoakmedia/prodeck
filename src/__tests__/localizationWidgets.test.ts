import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import copy from "./fixtures/localization/widgetsCopy.json";
import hashes from "./fixtures/localization/widgetsStructure.json";

// Bounded registration owned by this slice. No baseline regeneration mode.
const files = ["src/widgets/registry.tsx", "src/widgets/previews.tsx", "src/pages/Dashboard.tsx"] as const;
const read = (file: string) => readFileSync(file, "utf8");
const printer = ts.createPrinter({ removeComments: true });
const compact = (text: string) => {
  const source = ts.createSourceFile("slot.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return printer.printFile(source).trim();
};

function reviewedJsxText(text: string): string {
  // React drops ASCII indentation at multiline JSX text boundaries. Do not
  // trim single-line edges: spaces next to inline elements are rendered.
  // Keep tabs within content and all non-ASCII whitespace conservatively;
  // internal multiline reflow is not an approved copy normalization either.
  return text
    .replace(/^[ \t]*(?:\r\n|\r|\n)[ \t\r\n]*/, "")
    .replace(/[ \t]*(?:\r\n|\r|\n)[ \t\r\n]*$/, "");
}

function projection(file: typeof files[number], text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const seen = new Set<string>();
  function slot(key: string, value: string, allowed: string[]) {
    if (!allowed.includes(value)) throw new Error(`Unreviewed copy: ${key}: ${value}`);
    if (seen.has(key)) throw new Error(`Duplicate slot: ${key}`);
    seen.add(key);
    return ["copy", key];
  }
  function variable(node: ts.Node, name: string): boolean {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isVariableDeclaration(p) && p.name.getText(source) === name) return true;
    }
    return false;
  }
  function visit(node: ts.Node): unknown {
    if (ts.isImportDeclaration(node)) {
      const allowed = file === files[0]
        ? 'import { glossary } from "../lib/uiText";'
        : file === files[2] ? 'import { WIDGET_GROUP_LABELS } from "../lib/widgetText";' : "";
      if (allowed && compact(node.getText(source)) === compact(allowed)) {
        slot("import", allowed, [allowed]);
        return undefined;
      }
    }
    if (file === files[0] && ts.isPropertyAssignment(node) && node.name.getText(source) === "label" && variable(node, "WIDGETS")) {
      const object = node.parent as ts.ObjectLiteralExpression;
      const type = object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(source) === "type") as ts.PropertyAssignment;
      const id = (type.initializer as ts.StringLiteral).text;
      const values = copy.labels[id as keyof typeof copy.labels];
      if (!values) throw new Error(`Unknown widget: ${id}`);
      const value = ts.isStringLiteral(node.initializer) ? node.initializer.text : node.initializer.getText(source);
      return slot(`label:${id}`, value, values);
    }
    if (file === files[1] && ts.isPropertyAssignment(node) && variable(node, "WIDGET_BLURBS")) {
      const id = ts.isStringLiteral(node.name) ? node.name.text : node.name.getText(source);
      const values = copy.blurbs[id as keyof typeof copy.blurbs];
      if (!values || !ts.isStringLiteral(node.initializer)) throw new Error(`Invalid blurb: ${id}`);
      return slot(`blurb:${id}`, node.initializer.text, values);
    }
    if (file === files[1] && ts.isStringLiteral(node) && ts.isCallExpression(node.parent) &&
      node.parent.expression.getText(source) === "T" && node.parent.arguments[2] === node && variable(node, "ART")) {
      const translated = copy.previewText[node.text as keyof typeof copy.previewText];
      if (translated || Object.values(copy.previewText).includes(node.text)) return ["preview", translated ?? node.text];
    }
    if (file === files[2] && (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isJsxElement(node) || ts.isParenthesizedExpression(node))) {
      const raw = node.getText(source);
      const value = ts.isJsxText(node) ? reviewedJsxText(node.text) : compact(raw);
      const index = copy.dashboard.findIndex(([old, next]) =>
        ts.isJsxText(node) ? value === old || value === next
          : value === compact(old) || value === compact(next));
      if (index >= 0) {
        // Exact fixture spaces are significant. The unchanged hash pins each
        // copy marker to its reviewed AST position, not just its text value.
        const pair = copy.dashboard[index];
        return slot(`dashboard:${index}`, value,
          ts.isJsxText(node) ? pair : pair.map(compact));
      }
    }
    const children = node.getChildren(source);
    return children.length ? [node.kind, ...children.map(visit).filter((n) => n !== undefined)] : [node.kind, node.getText(source)];
  }
  const result = visit(source);
  const expected = file === files[0] ? Object.keys(copy.labels).length : file === files[1] ? Object.keys(copy.blurbs).length : copy.dashboard.length;
  expect([...seen].filter((s) => s !== "import").length, file).toBe(expected);
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}

function verify(file: typeof files[number], text: string) {
  expect(projection(file, text), file).toBe(hashes[file]);
}

describe("widget localization structural coverage", () => {
  for (const file of files) it(`protects all executable structure in ${file}`, () => verify(file, read(file)));
  it("freezes the complete display-only group module, including imports", () => {
    expect(compact(read("src/lib/widgetText.ts"))).toBe(compact(`
      import type { WidgetGroup } from "../widgets/registry";
      import { glossary } from "./uiText";
      export const WIDGET_GROUP_LABELS: Record<WidgetGroup, string> = {
        "Mission Control": glossary.commandCenter,
        ProPresenter: "ProPresenter",
        "Planning Center": "Planning Center",
        Audio: "Audio",
        Video: "Video",
        General: "General",
      };
    `));
  });
  const mutations = [
    [files[0], 'type: "run_order"', 'type: "run_order_changed"'],
    [files[0], 'group: "Mission Control", w: 4', 'group: "General", w: 4'],
    [files[0], 'w: 4, h: 4, component: RunOrderWidget', 'w: 9, h: 4, component: RunOrderWidget'],
    [files[0], 'component: RunOrderWidget', 'component: TimerWidget'],
    [files[0], 'widget.config.timerId', 'widget.config.changedTimerId'],
    [files[0], 'ppClearLayer("announcements")', 'ppClearLayer("props")'],
    [files[0], 'Not connected</div>', 'Conectado</div>'],
    [files[2], 'w.group === group', 'w.group !== group'],
    [files[2], 'addWidget(w.type)', 'addWidget(w.label)'],
    [files[2], 'config: {}', 'config: { changed: true }'],
    [files[2], 'onSelect={setActiveId}', 'onSelect={() => {}}'],
    [files[2], 'w.label.toLowerCase().includes(q)', 'true'],
    [files[1], 'viewBox="0 0 120 68"', 'viewBox="0 0 999 68"'],
    [files[0], 'import { crewJoinUrl }', 'import { somethingElse, crewJoinUrl }'],
  ] as const;
  for (const [file, from, to] of mutations) it(`rejects unsafe mutation ${from}`, () => {
    const original = read(file);
    expect(original).toContain(from);
    expect(() => verify(file, original.replace(from, to))).toThrow();
  });
  it("rejects rendered NBSP around reviewed copy", () => {
    const file = files[2], original = read(file);
    expect(original).toContain("Este panel está vacío");
    expect(() => verify(file, original.replace("Este panel está vacío", "\u00a0Este panel está vacío\u00a0"))).toThrow();
  });
  it("rejects rendered NBSP next to inline copy", () => {
    const file = files[2], original = read(file);
    expect(original).toContain("Activa <strong>");
    expect(() => verify(file, original.replace("Activa <strong>", "Activa\u00a0<strong>"))).toThrow();
  });
  for (const [from, to] of [
    ["Este panel está vacío", "\tEste panel está vacío\t"],
    ["Activa <strong>", "Activa\t<strong>"],
    ["</strong> y agrega", "</strong>\u00a0y agrega"],
    ["<strong>Editar</strong>", "<strong>\u00a0Editar\u00a0</strong>"],
  ]) it(`rejects visible whitespace mutation ${JSON.stringify(to)}`, () => {
    const file = files[2], original = read(file);
    expect(original).toContain(from);
    expect(() => verify(file, original.replace(from, to))).toThrow();
  });
  it("permits only nonrendered multiline ASCII indentation around reviewed copy", () => {
    const file = files[2], original = read(file);
    expect(original).toContain("<h2>Este panel está vacío</h2>");
    expect(original).toContain("\n            Activa <strong>");
    verify(file, original
      .replace("<h2>Este panel está vacío</h2>", "<h2>\n\t  Este panel está vacío\n\t</h2>")
      .replace("\n            Activa <strong>", "\n\t  Activa <strong>"));
  });
  it("rejects arbitrary expressions and unreviewed Spanish copy", () => {
    expect(() => verify(files[0], read(files[0]).replace(/label: (?:"Run Order \(Now\/Next\)"|glossary.runOrderNowNext)/, 'label: executeCommand()'))).toThrow();
    expect(() => verify(files[2], read(files[2]).replace(/(?:This dashboard is empty|Este panel está vacío)/, "Una copia no revisada"))).toThrow();
  });
});
