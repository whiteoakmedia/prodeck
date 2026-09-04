import { useEffect, useState } from "react";
import { useAlerts } from "../alertsStore";
import { loadRouting, saveRouting, IS_WEB, type Json } from "../lib/tauri";
import { askConfirm } from "../lib/dialogs";

// Routing — the system's signal map, written for the volunteer who has to
// answer "why is there no sound" alone. Each chain is a list of hops
// (from → transport → to); a hop can watch one of ProDeck's live subsystems
// so the chain shows exactly where things are healthy vs. unknown, and each
// hop carries its own "if this is the problem" steps for THIS building —
// Dante, not generic "check the cable".
//
// The map is data (routing.json), edited here on the booth; web clients get
// it read-only. ProDeck can only truly see its own inputs (Dante capture, PP,
// NDI stage feed, its web gateway) — everything else renders as a plain hop
// with steps, which is still the point: the knowledge lives on the screen,
// not in Zach's head.

interface Hop {
  from: string;
  to: string;
  transport: string; // "Dante", "NDI", "HDMI", "Wi-Fi", "analog"…
  watch?: "audio" | "pp" | "stage" | "desk" | null; // live light from ProDeck, if any
  steps: string[]; // what to try when this hop is the suspect
}
interface Chain {
  id: string;
  name: string;
  hops: Hop[];
}

// First-run seed: Cornerstone's actual system as of Aug 2026. Everything is
// editable in place — this is a starting map, not a hardcoded truth.
const SEED: Chain[] = [
  {
    id: "audio",
    name: "House audio",
    hops: [
      {
        from: "Stage mics & instruments",
        to: "Stage box",
        transport: "XLR / analog",
        steps: [
          "Is the mic/DI plugged in and the channel unmuted on stage?",
          "Try a different XLR cable or stage box port.",
        ],
      },
      {
        from: "Stage box",
        to: "eMotion LV1 mixer",
        transport: "Dante",
        steps: [
          "Open Dante Controller — is the stage box online and subscribed to the LV1?",
          "Check the network switch: link lights on, PoE if the box needs it.",
        ],
      },
      {
        from: "eMotion LV1 mixer",
        to: "House speakers",
        transport: "Dante",
        steps: [
          "Is the master fader up and unmuted in LV1?",
          "Did the LV1 session load its scene? Recall the Sunday scene.",
        ],
      },
      {
        from: "eMotion LV1 mixer",
        to: "Booth Mac (ProDeck)",
        transport: "Dante",
        watch: "audio",
        steps: [
          "This is the feed ProDeck listens to for SPL and phone Listen.",
          "Open Dante Controller — confirm the route from the LV1 to this Mac's Dante channels.",
          "In ProDeck: Settings → Audio, confirm the input device and overflow channels.",
        ],
      },
    ],
  },
  {
    id: "video",
    name: "Lyrics & screens",
    hops: [
      {
        from: "ProPresenter",
        to: "ProDeck (this app)",
        transport: "Network API",
        watch: "pp",
        steps: [
          "Is ProPresenter open on the presentation Mac?",
          "ProDeck reconnects on its own; if the light stays red, open the ProPresenter page and press Find.",
        ],
      },
      {
        from: "ProPresenter",
        to: "Stage confidence screen",
        transport: "NDI",
        watch: "stage",
        steps: [
          "Check ProPresenter's NDI output is enabled (Preferences → Displays).",
          "Check the network switch — NDI rides the same network as Dante.",
        ],
      },
      {
        from: "ProPresenter",
        to: "Projector / main screen",
        transport: "HDMI",
        steps: [
          "Is the projector on and set to the right input?",
          "Reseat the HDMI at the presentation Mac end first — it's the one that gets bumped.",
        ],
      },
    ],
  },
  {
    id: "crew",
    name: "Crew phones",
    hops: [
      {
        from: "ProDeck booth Mac",
        to: "Phones & tablets",
        transport: "Wi-Fi / your public URL",
        steps: [
          "ProDeck must be running on the booth Mac — the phones talk to it, not to a cloud.",
          "On the phone: venue Wi-Fi, or your public URL from anywhere.",
          "Still stuck? Quit and reopen ProDeck on the booth Mac.",
        ],
      },
    ],
  },
];

const uid = () => Math.random().toString(36).slice(2, 9);

export function RoutingPage() {
  const { subsystems } = useAlerts();
  const [chains, setChains] = useState<Chain[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [openHop, setOpenHop] = useState<string | null>(null); // "chainId:idx"
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    loadRouting()
      .then((d) => {
        const arr = (d as unknown as { chains?: Chain[] })?.chains;
        setChains(Array.isArray(arr) && arr.length > 0 ? arr : SEED);
      })
      .catch(() => setChains(SEED));
  }, []);

  async function persist(next: Chain[]) {
    setChains(next);
    if (IS_WEB) return; // web is read-only; the booth owns routing.json
    try {
      await saveRouting({ chains: next } as unknown as Json);
      setSaveErr("");
    } catch (e) {
      setSaveErr(String(e));
    }
  }

  // A hop's live light, when it watches something ProDeck can actually see.
  // "stage" maps onto the NDI subsystem ("cam" key, labeled Stage).
  function lightFor(h: Hop): { state: string; detail: string } | null {
    if (!h.watch) return null;
    const key = h.watch === "stage" ? "cam" : h.watch;
    const s = subsystems.find((x) => x.key === key);
    return s ? { state: s.state, detail: s.detail } : null;
  }

  if (!chains) return <div className="page"><header className="page-head"><h1>Routing</h1></header></div>;

  return (
    <div className="page routing-page">
      <header className="page-head">
        <h1>Routing</h1>
        {!IS_WEB && (
          <button
            className={`btn small ${editing ? "primary" : "ghost"}`}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>
      <p className="muted small routing-intro">
        How signal moves through this building. A colored dot means ProDeck can
        see that link live; click any hop for what to try when it's the suspect.
      </p>
      {saveErr && <div className="banner">Couldn't save: {saveErr}</div>}

      {chains.map((c, ci) => (
        <section key={c.id} className="card">
          <div className="card-head">
            {editing ? (
              <input
                className="input"
                value={c.name}
                onChange={(e) =>
                  persist(chains.map((x, i) => (i === ci ? { ...x, name: e.target.value } : x)))
                }
              />
            ) : (
              <h3>{c.name}</h3>
            )}
            {editing && (
              <button
                className="btn small ghost"
                onClick={async () => {
                  if (await askConfirm(`Delete the "${c.name}" chain?`))
                    persist(chains.filter((_, i) => i !== ci));
                }}
              >
                Delete chain
              </button>
            )}
          </div>
          <div className="routing-chain">
            {c.hops.map((h, hi) => {
              const key = `${c.id}:${hi}`;
              const light = lightFor(h);
              const open = openHop === key;
              return (
                <div key={key} className="routing-hop-wrap">
                  <button
                    className={`routing-hop ${open ? "open" : ""}`}
                    onClick={() => setOpenHop(open ? null : key)}
                  >
                    <span className="rh-from">{h.from}</span>
                    <span className="rh-arrow">
                      <span className="rh-transport">{h.transport}</span>→
                    </span>
                    <span className="rh-to">{h.to}</span>
                    {light ? (
                      <span
                        className={`hl-dot ${light.state}`}
                        title={`ProDeck sees this live: ${light.detail}`}
                      />
                    ) : (
                      <span className="hl-dot unknown" title="ProDeck can't see this link — steps only" />
                    )}
                  </button>
                  {open && (
                    <div className="routing-steps">
                      {editing ? (
                        <>
                          <div className="field-row">
                            <input
                              className="input"
                              value={h.from}
                              placeholder="From"
                              onChange={(e) => {
                                const hops = c.hops.map((x, i) =>
                                  i === hi ? { ...x, from: e.target.value } : x,
                                );
                                persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                              }}
                            />
                            <input
                              className="input"
                              style={{ maxWidth: 110 }}
                              value={h.transport}
                              placeholder="Transport"
                              onChange={(e) => {
                                const hops = c.hops.map((x, i) =>
                                  i === hi ? { ...x, transport: e.target.value } : x,
                                );
                                persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                              }}
                            />
                            <input
                              className="input"
                              value={h.to}
                              placeholder="To"
                              onChange={(e) => {
                                const hops = c.hops.map((x, i) =>
                                  i === hi ? { ...x, to: e.target.value } : x,
                                );
                                persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                              }}
                            />
                            <select
                              className="input"
                              style={{ maxWidth: 160 }}
                              value={h.watch ?? ""}
                              title="Tie this hop to something ProDeck can see live"
                              onChange={(e) => {
                                const w = (e.target.value || null) as Hop["watch"];
                                const hops = c.hops.map((x, i) =>
                                  i === hi ? { ...x, watch: w } : x,
                                );
                                persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                              }}
                            >
                              <option value="">no live light</option>
                              <option value="audio">Audio input (Dante)</option>
                              <option value="pp">ProPresenter link</option>
                              <option value="stage">Stage feed (NDI)</option>
                              <option value="desk">Avantis desk link</option>
                            </select>
                          </div>
                          <textarea
                            className="input routing-steps-edit"
                            rows={Math.max(3, h.steps.length + 1)}
                            value={h.steps.join("\n")}
                            placeholder="One troubleshooting step per line"
                            onChange={(e) => {
                              const hops = c.hops.map((x, i) =>
                                i === hi ? { ...x, steps: e.target.value.split("\n") } : x,
                              );
                              persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                            }}
                          />
                          <button
                            className="btn small ghost"
                            onClick={() => {
                              const hops = c.hops.filter((_, i) => i !== hi);
                              persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                              setOpenHop(null);
                            }}
                          >
                            Remove hop
                          </button>
                        </>
                      ) : (
                        <ol>
                          {h.steps.filter((s) => s.trim()).map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {editing && (
              <button
                className="btn small ghost"
                onClick={() => {
                  const hops = [
                    ...c.hops,
                    { from: "New source", to: "New destination", transport: "Dante", steps: [""] },
                  ];
                  persist(chains.map((x, i) => (i === ci ? { ...x, hops } : x)));
                }}
              >
                + Add hop
              </button>
            )}
          </div>
        </section>
      ))}

      {editing && (
        <button
          className="btn"
          onClick={() =>
            persist([...chains, { id: uid(), name: "New chain", hops: [] }])
          }
        >
          + Add chain
        </button>
      )}
    </div>
  );
}
