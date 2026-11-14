import { describe, expect, it } from "vitest";
import dialogs from "../lib/dialogs.tsx?raw";
import wizard from "../components/wizard/WizardShell.tsx?raw";
import dialogsBase from "./fixtures/localization/dialogs.tsx.txt?raw";
import wizardBase from "./fixtures/localization/WizardShell.tsx.txt?raw";
import { localizationManifest, preservesProtectedStructure } from "../lib/localizationProtection";
import { glossary, preservedTerms, uiText } from "../lib/uiText";
import localizationDocs from "../../LOCALIZATION.md?raw";

const cases = [
  ["src/lib/dialogs.tsx", dialogsBase, dialogs],
  ["src/components/wizard/WizardShell.tsx", wizardBase, wizard],
] as const;

describe("bounded localization protection", () => {
  it("registers exactly the files with reviewed baselines", () => {
    expect(localizationManifest).toEqual(cases.map(([file]) => file));
    expect(preservesProtectedStructure("src/unknown.tsx", dialogsBase, dialogs)).toBe(false);
  });
  for (const [file, baseline, current] of cases) {
    it(`accepts the reviewed migration and original structure: ${file}`, () => {
      expect(preservesProtectedStructure(file, baseline, current)).toBe(true);
      expect(preservesProtectedStructure(file, baseline, baseline)).toBe(true);
    });
    it(`rejects syntax errors, added routing, option values and action arguments: ${file}`, () => {
      for (const suffix of [
        "\nconst route = '/settings';",
        "\nconst choice = <option value='evento'>Evento</option>;",
        "\ninvoke('page_ack', { id: 'changed' });",
        "\nfunction broken( {",
      ]) expect(preservesProtectedStructure(file, baseline, current + suffix), suffix).toBe(false);
    });
  }
  it.each([
    [...cases[0], "{cur.title}"],
    [...cases[1], "{s.label}"],
  ] as const)("preserves caller-content JSX whitespace in %s", (file, baseline, current, expression) => {
    for (const whitespace of [" ", "\t", "\u00a0", "\n\u00a0\n"]) {
      expect(preservesProtectedStructure(file, baseline,
        current.replace(expression, `${whitespace}${expression}${whitespace}`)),
      JSON.stringify(whitespace)).toBe(false);
    }
  });
  it.each(cases)("accepts comments and ordinary code indentation in %s", (file, baseline, current) => {
    expect(preservesProtectedStructure(file, baseline,
      current.replace("export function", "// Reviewed comment\n  export function"))).toBe(true);
  });
  it("does not erase rendered whitespace when recognizing catalog children", () => {
    const changed = dialogs.replace(/\s*\{uiText.cancel\}\s*/, " {uiText.cancel} ");
    expect(preservesProtectedStructure(cases[0][0], dialogsBase, changed)).toBe(false);
  });
  it("allows literal visible-copy edits only at reviewed slots", () => {
    expect(preservesProtectedStructure(cases[0][0], dialogsBase, dialogsBase.replace("Cancel\n", "Cancelar ahora\n"))).toBe(true);
    expect(preservesProtectedStructure(cases[1][0], wizardBase, wizardBase.replace("Close\n", "Cerrar ahora\n"))).toBe(true);
  });
  it.each([
    ["routing", "const route = '/settings';", "'/settings'", "'/configuracion'"],
    ["option value", "const choice = <option value='service'>Evento</option>;", "value='service'", "value='evento'"],
    ["command name", "invoke('page_ack', { id: 'original' });", "'page_ack'", "'aviso_ack'"],
    ["action argument", "invoke('page_ack', { id: 'original' });", "'original'", "'traducido'"],
  ])("rejects a changed %s node, not merely additions", (_name, statement, before, after) => {
    const fixture = `${dialogsBase}\n${statement}`;
    expect(preservesProtectedStructure(cases[0][0], fixture, fixture)).toBe(true);
    expect(preservesProtectedStructure(cases[0][0], fixture, fixture.replace(before, after))).toBe(false);
  });
  it("rejects callback, dynamic value, default argument and contract changes", () => {
    for (const [before, after] of [
      ["cur.resolve(true)", "cur.resolve(false)"],
      ["cur.title", "'Translated title'"],
      ['kind: "text"', 'kind: "texto"'],
      ['initial = ""', 'initial = "traducido"'],
      ['cur.okLabel', 'uiText.ok'],
      ['cur.resolve(draft)', "cur.resolve('page_ack')"],
      ['q.slice(1)', 'q.slice(2)'],
      ['value={draft}', 'value="evento"'],
    ]) {
      expect(dialogs.includes(before), before).toBe(true);
      expect(preservesProtectedStructure(cases[0][0], dialogsBase, dialogs.replace(before, after)), after).toBe(false);
    }
    for (const [before, after] of [
      ['onGo(at - 1)', 'onGo(at + 1)'],
      ['{s.label}', '{"Traducido"}'],
      ['key={s.id}', 'key="evento"'],
      ['onClose()', "onGo('page_ack')"],
      ['uiText.step(at + 1, steps.length)', 'uiText.step(at, 99)'],
    ]) {
      expect(wizard.includes(before), before).toBe(true);
      expect(preservesProtectedStructure(cases[1][0], wizardBase, wizard.replace(before, after)), after).toBe(false);
    }
  });
  it("does not hide executable expressions inside approved copy slots or imports", () => {
    expect(preservesProtectedStructure(cases[0][0], dialogsBase, dialogsBase.replace("Cancel\n", "{execute('page_ack')}\n"))).toBe(false);
    expect(preservesProtectedStructure(cases[0][0], dialogsBase, dialogs.replace('import { uiText }', 'import { uiText, execute }'))).toBe(false);
    expect(preservesProtectedStructure(cases[1][0], wizardBase, wizard.replace("{uiText.close}", "{onClose()}"))).toBe(false);
  });
});

describe("approved es-419 catalog", () => {
  it("pins the full approved glossary without applying it to user values", () => {
    expect(glossary).toEqual({
      service: "Evento", program: "Evento", autoFollow: "Seguimiento automático", confidenceBanner: "Aviso al escenario",
      rundown: "Crono", runOrderNowNext: "Ahora y siguiente", runOfShowTiming: "Tiempos del Crono", showFlow: "Orden del evento",
      nowHeading: "Ahora", nowItemState: "En curso", next: "Siguiente",
      automixHold: "Pausar automatización", automixRelease: "Reanudar automatización",
      crew: "Equipo", booth: "Cabina", stage: "Escenario", page: "Aviso", paging: "Enviar aviso", routing: "Ruteo",
      setup: "Configuración inicial", soundDesk: "Consola de audio", console: "Consola de audio", commandCenter: "Centro de control",
      dashboard: "Panel", dashboardExpanded: "Panel de control", settings: "Configuración", team: "Equipo", devices: "Dispositivos", equipment: "Equipamiento",
    });
    expect(uiText.step(7, 12)).toBe("Paso 7 de 12");
  });
  it("preserves distinct app terms with the exact Automix spelling", () => {
    expect(preservedTerms).toEqual(["Props", "Clear", "Automix", "Home", "Checklist", "Tally"]);
  });
  it.each([
    ["Run Order (Now/Next)", "runOrderNowNext", "Ahora y siguiente"],
    ["Run-of-Show Timing", "runOfShowTiming", "Tiempos del Crono"],
    ["Show Flow", "showFlow", "Orden del evento"],
    ["Rundown", "rundown", "Crono"],
    ["Now, short heading", "nowHeading", "Ahora"],
    ["Now, item state", "nowItemState", "En curso"],
    ["Next", "next", "Siguiente"],
  ])("pins the source context and semantic key for %s", (source, key, translation) => {
    expect(glossary).toMatchObject({ [key]: translation });
    expect(localizationDocs).toContain(`| ${source} | \`${key}\` | ${translation} |`);
  });
});
