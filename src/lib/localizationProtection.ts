import ts from "typescript";

// Test-only structural protection. These are the ONLY registered source files.
// Baselines are reviewed source projections under __tests__/fixtures/localization.
export const localizationManifest = [
  "src/lib/dialogs.tsx",
  "src/components/wizard/WizardShell.tsx",
] as const;

const printer = ts.createPrinter({ removeComments: true });
function printed(node: ts.Node): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).trim();
}
function children(node: ts.Node): ts.Node[] {
  // Outside reviewed slots, preserve ALL JSX text conservatively, including
  // indentation. getText() can skip leading trivia, so compare JsxText.text
  // below instead. Ordinary code indentation and comments remain irrelevant.
  return node.getChildren().filter((child) =>
    !(child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode));
}
function leafText(node: ts.Node): string {
  return ts.isJsxText(node) ? node.text : node.getText();
}
function same(left: ts.Node, right: ts.Node): boolean {
  if (left.kind !== right.kind) return false;
  const a = children(left);
  const b = children(right);
  if (a.length !== b.length) return false;
  return a.length ? a.every((child, i) => same(child, b[i])) : leafText(left) === leafText(right);
}
function meaningfulChildren(node: ts.JsxElement): ts.JsxChild[] {
  // React drops ASCII space/tab-only lines in multiline JSX text. A single
  // line of spaces/tabs renders, as do non-ASCII spaces even across newlines.
  return node.children.filter((child) => !(ts.isJsxText(child) &&
    /^[ \t\r\n]*$/.test(child.text) && /[\r\n]/.test(child.text)));
}
function catalogChild(node: ts.JsxElement, expression: string): boolean {
  const content = meaningfulChildren(node);
  return content.length === 1 && ts.isJsxExpression(content[0]) &&
    !!content[0].expression && printed(content[0].expression) === expression;
}

/** Fail closed outside the exact reviewed slots. No baseline generation mode.
 * Comments and ordinary code indentation are ignored. JSX whitespace is kept
 * conservatively outside reviewed slots; only non-rendered multiline ASCII
 * indentation is ignored when recognizing a reviewed catalog child. JSX text
 * outside the reviewed slots, operators, identifiers, literals, imports and
 * every other AST node remain protected, including the unchanged LevelBar.
 */
export function preservesProtectedStructure(file: string, baseline: string, candidate: string): boolean {
  if (!localizationManifest.some((entry) => entry === file)) return false;
  const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const original = parse(baseline);
  const changed = parse(candidate);
  // TypeScript exposes parser diagnostics on SourceFile at runtime.
  const errors = (source: ts.SourceFile) =>
    (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length;
  if (errors(original) || errors(changed)) return false;
  const importPath = file === localizationManifest[0] ? "./uiText" : "../../lib/uiText";
  const approvedImport = `import { uiText } from "${importPath}";`;
  const statements = (source: ts.SourceFile) => source.statements.filter((node) =>
    !(ts.isImportDeclaration(node) && printed(node) === approvedImport));

  const compare = (a: ts.Node, b: ts.Node): boolean => {
    // Only the two original default OK literals may become this fixed lookup.
    if (file === localizationManifest[0] && ts.isStringLiteral(a) && a.text === "OK") {
      return ts.isStringLiteral(b) || printed(b) === "uiText.ok";
    }
    if (ts.isJsxElement(a) && ts.isJsxElement(b)) {
      const content = meaningfulChildren(a);
      const copy = content.length === 1 && ts.isJsxText(content[0]) ? content[0].text.trim() : "";
      const key = file === localizationManifest[0]
        ? (copy === "Cancel" ? "cancel" : undefined)
        : (copy === "Close" ? "close" : copy === "Back" ? "back" : undefined);
      const eyebrow = file === localizationManifest[1] &&
        printed(a.openingElement) === '<div className="wz-eyebrow">';
      if (key || eyebrow) {
        if (!same(a.openingElement, b.openingElement) || !same(a.closingElement, b.closingElement)) return false;
        if (catalogChild(b, key ? `uiText.${key}` : "uiText.step(at + 1, steps.length)")) return true;
        const next = meaningfulChildren(b);
        // Plain JSX text can change, but the original step expressions cannot.
        return content.length === next.length && content.every((child, i) =>
          ts.isJsxText(child) ? ts.isJsxText(next[i]) : same(child, next[i]));
      }
    }
    if (a.kind !== b.kind) return false;
    const ac = children(a);
    const bc = children(b);
    if (ac.length !== bc.length) return false;
    return ac.length ? ac.every((child, i) => compare(child, bc[i])) : leafText(a) === leafText(b);
  };
  const a = statements(original);
  const b = statements(changed);
  // Permit one reviewed catalog import, never duplicate imports or added bindings.
  const catalogImports = changed.statements.filter((node) => ts.isImportDeclaration(node) && printed(node) === approvedImport);
  return catalogImports.length <= 1 && a.length === b.length && a.every((node, i) => compare(node, b[i]));
}
