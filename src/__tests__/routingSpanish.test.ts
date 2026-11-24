import { describe, expect, it } from "vitest";
import { applyRow, chId, emptyMap, parsePatchList, walk, type LiveView } from "../lib/routing";

function setup() {
  const map = emptyMap();
  const row = parsePatchList("39\tVoz 東京\tI/O Port 1\t43\tULXD4Q-5-8 07").rows[0];
  applyRow(map, row);
  return map;
}
const live: LiveView = { now: 1000, desk: { connected: true, names: { "input:39": "Ana 東京" }, mutes: { "input:39": true }, faders: {} } };

describe("diagnósticos de ruteo en español", () => {
  it("traduce la indicación de mute sin alterar identificadores ni el modo por defecto", () => {
    const map = setup();
    const es = walk(map, chId("39"), live, "es")!;
    const en = walk(map, chId("39"), live)!;
    expect(es.checks[0]).toMatchObject({ state: "bad", text: "El canal 39 está muteado en la consola (“Ana 東京” en la consola).", fix: "Desmuteá el canal 39.", nodeId: chId("39") });
    expect(en.checks[0].fix).toBe("Unmute channel 39.");
    expect(es.path).toEqual(en.path);
    expect(es.title).toBe("Voz 東京");
  });
  it("conserva estados y precauciones al revisar fader y mute recordado", () => {
    const map = setup();
    const down: LiveView = { now: 1000, desk: { connected: true, names: {}, mutes: { "input:39": false }, faders: { "input:39": -80 } } };
    expect(walk(map, chId("39"), down, "es")!.checks[0]).toMatchObject({ state: "bad", text: "El canal 39 está abierto, pero su fader está completamente abajo.", fix: "Subí el fader del canal 39." });
    const remembered: LiveView = { now: 1000, desk: { connected: true, names: {}, mutes: { "input:39": true }, faders: {}, confirmed: {} } };
    const check = walk(map, chId("39"), remembered, "es")!.checks[0];
    expect(check.state).toBe("unknown");
    expect(check.text).toContain("la consola no lo confirmó desde que se reconectó");
  });
  it("mantiene los pasos escritos por el usuario sin traducción ni pérdida", () => {
    const map = setup();
    const channel = map.nodes.find(n => n.id === chId("39"))!;
    channel.steps = ["  Paso personal 東京  "];
    const before = structuredClone(map);
    const es = walk(map, channel.id, { now: 1000 }, "es")!;
    expect(map).toEqual(before);
    expect(es.steps.some(s => s.text === "  Paso personal 東京  ")).toBe(true);
  });
});

describe("pasos y reglas predeterminados", () => {
  it("traduce solo los pasos de ProDeck y mantiene el contenido propio", () => {
    const map = setup();
    const channel = map.nodes.find(n => n.id === chId("39"))!;
    const before = structuredClone(map);
    const es = walk(map, channel.id, { now: 1000 }, "es")!;
    expect(map).toEqual(before);
    expect(es.steps.some(s => s.text.includes("¿el canal 39 está desmuteado"))).toBe(true);
    expect(es.steps.some(s => s.text.includes("¿El transmisor está encendido?"))).toBe(true);
    channel.steps = ["Indicaciones originales 東京"];
    const custom = walk(map, channel.id, { now: 1000 }, "es")!;
    expect(custom.steps.some(s => s.text === "Indicaciones originales 東京")).toBe(true);
  });
  it("traduce una regla original sin cambiar una regla editada", () => {
    const map = emptyMap();
    const rows = parsePatchList("39\tVoz\tI/O Port 1\t43\tULXD4Q-5-8 07\n53\tCopia\tI/O Port 1\t43\tULXD4Q-5-8 07").rows;
    rows.forEach(row => applyRow(map, row));
    const result = walk(map, chId("39"), { now: 1000 }, "es")!;
    expect(result.steps.find(s => s.rule)?.rule).toContain("La ganancia y los 48 V");
    map.rules.find(r => r.when === "shared-socket")!.text = "Regla personal 東京";
    expect(walk(map, chId("39"), { now: 1000 }, "es")!.steps.find(s => s.rule)?.rule).toBe("Regla personal 東京");
  });
});
