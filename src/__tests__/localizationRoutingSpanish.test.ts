import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "// Routing —",
    "import { spanishBuiltinRule, spanishDefaultSteps } from \"./routingSpanish\";\n\n// Routing —"
  ],
  [
    "export function walk(map: RoutingMap, targetId: string, live: LiveView): WalkResult | null {",
    "export function walk(map: RoutingMap, targetId: string, live: LiveView, language: \"en\" | \"es\" = \"en\"): WalkResult | null {\n  const tr = (en: string, es: string) => language === \"es\" ? es : en;"
  ],
  [
    "`${n.label} is marked dead on the map — it looks normal and goes nowhere.`",
    "tr(`${n.label} is marked dead on the map — it looks normal and goes nowhere.`, `${n.label} figura fuera de servicio en el mapa: parece normal, pero no conecta.`)"
  ],
  [
    "`Move the cable off ${n.label} to a live socket and tell the booth.`",
    "tr(`Move the cable off ${n.label} to a live socket and tell the booth.`, `Pasá el cable de ${n.label} a un conector funcional y avisá a Control.`)"
  ],
  [
    "` (“${name}” on the desk)`",
    "tr(` (“${name}” on the desk)`, ` (“${name}” en la consola)`)"
  ],
  [
    "`ProDeck's last record says channel ${num} is muted${who}, but the desk hasn't confirmed that since it reconnected — look at the mute button on ${num} first.`",
    "tr(`ProDeck's last record says channel ${num} is muted${who}, but the desk hasn't confirmed that since it reconnected — look at the mute button on ${num} first.`, `El último registro de ProDeck indica que el canal ${num} está muteado${who}, pero la consola no lo confirmó desde que se reconectó. Revisá primero el botón de mute del canal ${num}.`)"
  ],
  [
    "`Channel ${num} is muted on the desk${who}.`",
    "tr(`Channel ${num} is muted on the desk${who}.`, `El canal ${num} está muteado en la consola${who}.`)"
  ],
  [
    "`Unmute channel ${num}.`",
    "tr(`Unmute channel ${num}.`, `Desmuteá el canal ${num}.`)"
  ],
  [
    "`Channel ${num} is open but its fader is all the way down${who}.`",
    "tr(`Channel ${num} is open but its fader is all the way down${who}.`, `El canal ${num} está abierto, pero su fader está completamente abajo${who}.`)"
  ],
  [
    "`Bring channel ${num}'s fader up.`",
    "tr(`Bring channel ${num}'s fader up.`, `Subí el fader del canal ${num}.`)"
  ],
  [
    "`, fader at ${fmtDb(fader)}`",
    "tr(`, fader at ${fmtDb(fader)}`, `, fader en ${fmtDb(fader)}`)"
  ],
  [
    "\" (as last seen — the desk hasn't confirmed it since reconnecting)\"",
    "tr(\" (as last seen — the desk hasn't confirmed it since reconnecting)\", \" (último estado registrado: la consola no lo confirmó desde que se reconectó)\")"
  ],
  [
    "`Channel ${num} is open${f}${who}${asSeen}.`",
    "tr(`Channel ${num} is open${f}${who}${asSeen}.`, `El canal ${num} está abierto${f}${who}${asSeen}.`)"
  ],
  [
    "`Its twin, ${tn}, is muted — normal if it is the duplicate.`",
    "tr(`Its twin, ${tn}, is muted — normal if it is the duplicate.`, `Su canal gemelo, ${tn}, está muteado; es normal si se trata del duplicado.`)"
  ],
  [
    "`Its twin, ${tn}, is open too — they share one socket and one gain.`",
    "tr(`Its twin, ${tn}, is open too — they share one socket and one gain.`, `Su canal gemelo, ${tn}, también está abierto; comparten un conector y una ganancia.`)"
  ],
  [
    "\"ProDeck can't see the desk right now, so mute and fader are yours to check.\"",
    "tr(\"ProDeck can't see the desk right now, so mute and fader are yours to check.\", \"ProDeck no puede ver la consola ahora. Revisá el mute y el fader.\")"
  ],
  [
    "`Signal is reaching the booth on input ${n.bind.capture}.`",
    "tr(`Signal is reaching the booth on input ${n.bind.capture}.`, `Llega señal a Control por la entrada ${n.bind.capture}.`)"
  ],
  [
    "`Nothing is reaching the booth on input ${n.bind.capture} — the fault is upstream of it.`",
    "tr(`Nothing is reaching the booth on input ${n.bind.capture} — the fault is upstream of it.`, `No llega señal a Control por la entrada ${n.bind.capture}. El problema está antes de esa entrada.`)"
  ],
  [
    "`Desk connected · ${n.label}${e?.at ? ` in ${e.at}` : \"\"} patched.`",
    "tr(`Desk connected · ${n.label}${e?.at ? ` in ${e.at}` : \"\"} patched.`, `Consola conectada · ${n.label}${e?.at ? ` entrada ${e.at}` : \"\"} conectado.`)"
  ],
  [
    "`${node(map, e.from)?.label ?? e.from} → ${n.label} is live.`",
    "tr(`${node(map, e.from)?.label ?? e.from} → ${n.label} is live.`, `${node(map, e.from)?.label ?? e.from} → ${n.label} está activo.`)"
  ],
  [
    "`${node(map, e.from)?.label ?? e.from} → ${n.label} is down as far as ProDeck can see.`",
    "tr(`${node(map, e.from)?.label ?? e.from} → ${n.label} is down as far as ProDeck can see.`, `Según lo que puede verificar ProDeck, ${node(map, e.from)?.label ?? e.from} → ${n.label} no está funcionando.`)"
  ],
  [
    "`On the desk: are channels ${nums} unmuted, faders up, and still sending to this output?`",
    "tr(`On the desk: are channels ${nums} unmuted, faders up, and still sending to this output?`, `En la consola: ¿los canales ${nums} están desmuteados, con los faders arriba y enviando a esta salida?`)"
  ],
  [
    "twins.map((t) => t.ref?.index ?? t.label).join(\" and \")",
    "twins.map((t) => t.ref?.index ?? t.label).join(tr(\" and \", \" y \"))"
  ],
  [
    "`Gain is set once for this socket and shared by channels ${target.ref?.index} and ${tn} — check it on the input, not the channel.`",
    "tr(`Gain is set once for this socket and shared by channels ${target.ref?.index} and ${tn} — check it on the input, not the channel.`, `La ganancia se configura una vez para este conector y la comparten los canales ${target.ref?.index} y ${tn}. Revisala en la entrada, no en el canal.`)"
  ],
  [
    "\"Only one side missing? Odd socket is left, even is right — it is that side's cable.\"",
    "tr(\"Only one side missing? Odd socket is left, even is right — it is that side's cable.\", \"¿Falta un solo lado? El conector impar es el izquierdo y el par es el derecho. Revisá el cable de ese lado.\")"
  ],
  [
    "target.kind === \"channel\" ? `channel ${target.ref?.index ?? \"\"}`.trim() : target.kind",
    "target.kind === \"channel\" ? tr(`channel ${target.ref?.index ?? \"\"}`, `canal ${target.ref?.index ?? \"\"}`).trim() : target.kind"
  ],
  [
    "target.label || liveName || `Channel ${target.ref?.index ?? \"\"}`",
    "target.label || liveName || tr(`Channel ${target.ref?.index ?? \"\"}`, `Canal ${target.ref?.index ?? \"\"}`)"
  ],
  [
    "  const ruleText = (when: Rule[\"when\"]) =>\n    (map.rules.find((r) => r.when === when) ?? builtinRules().find((r) => r.when === when))?.text;",
    "  const ruleText = (when: Rule[\"when\"]) => {\n    const originals = builtinRules();\n    const rule = map.rules.find((r) => r.when === when) ?? originals.find((r) => r.when === when);\n    return rule && (language === \"es\" ? spanishBuiltinRule(rule, originals) : rule.text);\n  };"
  ],
  [
    "    const own = stepsFor(map, n);",
    "    const own = language === \"es\" && !n.steps?.length ? spanishDefaultSteps(n) : stepsFor(map, n);"
  ]
];
it("preserves routing logic outside reviewed bilingual diagnostic slots", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/routingSpanishBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/lib/routing.ts", "utf8")).toBe(expected);
});
