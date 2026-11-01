import { WIDGETS } from "../widgets/registry";

// Widget lab (demo mode only: ?shots=1&lab=1). Every tile in the shapes a
// dashboard can give it: wide and short, tall and narrow, a phone in
// portrait, and its default size. Used to check that no tile clips, spills or
// overlaps whatever shape it's given (lab.ts measures it).

export const LAB_SHAPES = [
  { id: "wide", label: "Wide (12 × 3)", w: 1160, h: 238 },
  { id: "tall", label: "Tall (3 × 8)", w: 276, h: 644 },
  { id: "phone", label: "Phone portrait", w: 343, h: 420 },
  { id: "small", label: "Small (3 × 3)", w: 276, h: 238 },
] as const;

export function WidgetLab() {
  // &only=atem,checklist narrows it to those tiles, for a closer look.
  const only = new URLSearchParams(location.search).get("only")?.split(",") ?? null;
  return (
    <div className="lab">
      {WIDGETS.filter((d) => !only || only.includes(d.type)).map((def) => {
        const Comp = def.component;
        return (
          <section key={def.type} className="lab-row" data-lab-type={def.type}>
            <h2 className="lab-name">
              {def.label} <code>{def.type}</code>
            </h2>
            <div className="lab-shapes">
              {LAB_SHAPES.map((s) => (
                <div key={s.id} className="lab-shape">
                  <span className="lab-shape-name">{s.label}</span>
                  <div className="widget lab-frame" data-lab-shape={s.id} style={{ width: s.w, height: s.h }}>
                    <div className="widget-bar">
                      <span className="widget-title">{def.label}</span>
                    </div>
                    <div className="widget-body">
                      <Comp widget={{ id: `lab-${def.type}-${s.id}`, type: def.type, x: 0, y: 0, w: 3, h: 3, config: {} } as never} editing={false} update={() => {}} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
