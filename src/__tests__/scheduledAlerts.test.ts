import { describe, expect, it } from "vitest";
import { fireSlots, migrate, resolveRecipients, slotToFire } from "../scheduleStore";

const at = (hhmm: string, day = "2026-11-15") => Date.parse(`${day}T${hhmm}:00`);
const times = [
  { id: "t9", ts: at("09:00") },
  { id: "t11", ts: at("11:00") },
];

describe("scheduled alerts: 5 minutes before each service", () => {
  const alert = { kind: "relative" as const, beforeMin: 5, at: "09:45" };

  it("has a slot for every service time on today's plan", () => {
    const slots = fireSlots(alert, "plan1", times, "t9", at("06:00"));
    expect(slots).toEqual([
      { key: "plan1::t9", due: at("08:55") },
      { key: "plan1::t11", due: at("10:55") },
    ]);
  });

  it("fires the second service even when the first service time is the selected one", () => {
    const slots = fireSlots(alert, "plan1", times, "t9", at("10:56"));
    expect(slotToFire(slots, ["plan1::t9"], at("10:56"))).toEqual({ key: "plan1::t11", due: at("10:55") });
  });

  it("fires each service once, and not before it's due", () => {
    const slots = fireSlots(alert, "plan1", times, "t9", at("08:50"));
    expect(slotToFire(slots, [], at("08:50"))).toBeNull();
    expect(slotToFire(slots, [], at("08:56"))?.key).toBe("plan1::t9");
    expect(slotToFire(slots, ["plan1::t9"], at("08:57"))).toBeNull();
  });

  it("doesn't replay a page that was missed by more than 10 minutes", () => {
    const slots = fireSlots(alert, "plan1", times, "t9", at("09:30"));
    expect(slotToFire(slots, [], at("09:30"))).toBeNull();
  });

  it("ignores service times on other days, like last week's", () => {
    const old = [{ id: "old", ts: at("09:00", "2026-11-08") }, ...times];
    expect(fireSlots(alert, "plan1", old, "t9", at("06:00")).map((s) => s.key)).toEqual(["plan1::t9", "plan1::t11"]);
  });

  it("keeps a clock alert to once a day for the selected service", () => {
    expect(fireSlots({ kind: "clock", beforeMin: 0, at: "07:30" }, "plan1", times, "t9", at("06:00"))).toEqual([
      { key: "plan1::t9", due: at("07:30") },
    ]);
  });
});

describe("scheduled alerts: who a team alert reaches", () => {
  const team = [
    { name: "Zach Green", team: "AVL Team", status: "C" },
    { name: "Sam Lee", team: "AVL Team", status: "U" },
    { name: "Off Week", team: "AVL Team", status: "D" },
    { name: "Singer", team: "Worship", status: "C" },
  ];
  const crew = [
    { id: "z", name: "Zach Green", approved: true, pco_name: "" },
    { id: "s", name: "Sam", approved: true, pco_name: "Sam Lee" },
    { id: "o", name: "Off Week", approved: true, pco_name: "" },
    { id: "w", name: "Singer", approved: true, pco_name: "" },
  ];

  it("pages the team members on this week's plan, not those who declined or other teams", () => {
    expect(resolveRecipients({ team: "AVL Team", recipients: [] }, team, crew)).toEqual({ ids: ["z", "s"], problem: null });
  });

  it("keeps old team alerts paging only checked in people, and new ones everyone on the plan", () => {
    expect(migrate({ id: "a", team: "AVL Team" } as never).hereOnly).toBe(true);
    expect(migrate({ id: "a", team: "AVL Team", hereOnly: false } as never).hereOnly).toBe(false);
    expect(migrate({ id: "a", team: "" } as never).hereOnly).toBe(false);
  });
});
