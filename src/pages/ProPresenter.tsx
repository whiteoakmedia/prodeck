import { useCallback, useEffect, useState } from "react";
import { useProDeck } from "../store";
import { ConnectCard } from "../components/ConnectCard";
import { Icon } from "../components/Icon";
import { PlaylistControl } from "../components/PlaylistControl";
import {
  ppGet,
  ppNext,
  ppPrevious,
  ppTriggerLook,
  ppTriggerMacro,
  ppTimerOp,
  ppTriggerMessage,
  ppAction,
  ppSetStageMessage,
  ppClearStageMessage,
  type Json,
} from "../lib/tauri";
import { currentTimers } from "../lib/status";
import { usePco } from "../pcoStore";
import { SongKeyLeader } from "../components/SongKeyLeader";

interface Item {
  uuid: string;
  name: string;
}

function toItems(json: Json | Json[]): Item[] {
  let arr: any = json;
  if (!Array.isArray(arr)) {
    if (arr && typeof arr === "object") {
      arr = Object.values(arr).find(Array.isArray) ?? [];
    } else arr = [];
  }
  return arr.map((x: any, i: number) => ({
    uuid: x?.id?.uuid ?? x?.uuid ?? String(i),
    name: x?.id?.name ?? x?.name ?? `Item ${i + 1}`,
  }));
}


export function ProPresenterPage() {
  const { connected, status } = useProDeck();
  const pco = usePco();
  const [looks, setLooks] = useState<Item[]>([]);
  const [macros, setMacros] = useState<Item[]>([]);
  const [props, setProps] = useState<Item[]>([]);
  const [messages, setMessages] = useState<Item[]>([]);
  const [timers, setTimers] = useState<Item[]>([]);
  // ProPresenter's /v1/look/current returns a fresh per-activation uuid that does
  // NOT match the stored uuid in /v1/looks, so we can't highlight the live look by
  // uuid. Track it by name + index instead and resolve to the stored uuid (which
  // the dropdown options use) at render time.
  const [liveLook, setLiveLook] = useState<{ name: string; index: number } | null>(null);
  const [stageMsg, setStageMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [playlistId, setPlaylistId] = useState<string | null>(
    () => localStorage.getItem("prodeck.ppPlaylist"),
  );

  const refresh = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [lk, mc, pr, ms, tm] = await Promise.all([
        ppGet("looks").catch(() => []),
        ppGet("macros").catch(() => []),
        ppGet("props").catch(() => []),
        ppGet("messages").catch(() => []),
        ppGet("timers").catch(() => []),
      ]);
      setLooks(toItems(lk));
      setMacros(toItems(mc));
      setProps(toItems(pr));
      setMessages(toItems(ms));
      setTimers(toItems(tm));
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Track which Look is live, polling so the highlight follows changes made in
  // ProPresenter or elsewhere.
  useEffect(() => {
    if (!connected) {
      setLiveLook(null);
      return;
    }
    const read = () =>
      ppGet("look/current")
        .then((j: any) => {
          const id = j?.id;
          setLiveLook(
            id && (id.name || typeof id.index === "number")
              ? { name: id.name ?? "", index: typeof id.index === "number" ? id.index : -1 }
              : null,
          );
        })
        .catch(() => {});
    read();
    const iv = setInterval(read, 4000);
    return () => clearInterval(iv);
  }, [connected]);

  const liveTimers = currentTimers(status);
  const timerState = (uuid: string) =>
    liveTimers.find((t) => t.id === uuid)?.state ?? "";

  // The song to expose for a quick key/leader change right in the transport:
  // the live item if it's a song, otherwise the next upcoming song so the key
  // can be set before it goes live.
  const liveIdx = pco.items.findIndex((i) => i.id === pco.liveItemId);
  const liveItem = liveIdx >= 0 ? pco.items[liveIdx] : null;
  const upcomingSong =
    liveIdx >= 0
      ? pco.items.slice(liveIdx + 1).find((i) => i.type === "song") ?? null
      : pco.items.find((i) => i.type === "song") ?? null;
  const transportSong = liveItem?.type === "song" ? liveItem : upcomingSong;
  const transportLive = !!transportSong && transportSong.id === pco.liveItemId;

  // Resolve the live look to the stored uuid the dropdown options use: match on
  // index (PP's id.index == position in /v1/looks), validated by name; fall back
  // to a name lookup if the index slips. Empty string => nothing matched.
  const activeLook = (() => {
    if (!liveLook) return "";
    const byIdx = liveLook.index >= 0 ? looks[liveLook.index] : undefined;
    if (byIdx && (!liveLook.name || byIdx.name === liveLook.name)) return byIdx.uuid;
    return looks.find((l) => l.name === liveLook.name)?.uuid ?? byIdx?.uuid ?? "";
  })();

  if (!connected) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>ProPresenter</h1>
        </header>
        <div className="center-card">
          <ConnectCard />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>ProPresenter</h1>
        <button className="btn ghost small" onClick={refresh} disabled={loading}>
          <Icon name="search" size={14} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      <section className="card">
        <div className="card-head">
          <h3>Transport</h3>
        </div>
        <div className="transport big-transport">
          <button className="btn icon" onClick={() => ppPrevious()}>
            <Icon name="prev" /> Previous
          </button>
          <button className="btn primary icon" onClick={() => ppNext()}>
            Next <Icon name="next" />
          </button>
          {transportSong && (
            <div className="transport-song">
              <span className={`ts-tag ${transportLive ? "live" : ""}`}>
                {transportLive ? "NOW" : "NEXT SONG"}
              </span>
              <span className="ts-title" title={transportSong.title}>
                {transportSong.title}
              </span>
              <SongKeyLeader item={transportSong} />
            </div>
          )}
          {looks.length > 0 && (
            <label className="transport-look">
              <span>Look</span>
              <select
                className="input"
                value={activeLook}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  ppTriggerLook(id);
                  const i = looks.findIndex((l) => l.uuid === id);
                  // optimistic; the poll confirms (and re-resolves the live uuid)
                  setLiveLook(i >= 0 ? { name: looks[i].name, index: i } : null);
                }}
              >
                {!activeLook && <option value="">Select a look…</option>}
                {looks.map((l) => (
                  <option key={l.uuid} value={l.uuid}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Playlists</h3>
          <span className="count">click a slide to go live</span>
        </div>
        <div className="pp-playlist">
          <PlaylistControl
            page
            slideSize={240}
            selectedId={playlistId}
            onSelect={(id) => {
              setPlaylistId(id);
              if (id) localStorage.setItem("prodeck.ppPlaylist", id);
              else localStorage.removeItem("prodeck.ppPlaylist");
            }}
          />
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h3>Macros</h3>
            <span className="count">{macros.length}</span>
          </div>
          <TriggerList
            items={macros}
            empty="No macros"
            action={(id) => ppTriggerMacro(id)}
            actionLabel="Run"
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Props</h3>
            <span className="count">{props.length}</span>
          </div>
          <TriggerList
            items={props}
            empty="No props"
            action={(id) => ppAction(`prop/${id}/trigger`)}
            actionLabel="Show"
            secondary={{ label: "Clear", action: (id) => ppAction(`prop/${id}/clear`) }}
          />
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h3>Messages</h3>
            <span className="count">{messages.length}</span>
          </div>
          <TriggerList
            items={messages}
            empty="No messages"
            action={(id) => ppTriggerMessage(id)}
            actionLabel="Show"
            secondary={{
              label: "Clear",
              action: (id) => ppAction(`message/${id}/clear`),
            }}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Timers</h3>
            <span className="count">{timers.length}</span>
          </div>
          {timers.length === 0 ? (
            <p className="muted">No timers configured.</p>
          ) : (
            <div className="timer-control-list">
              {timers.map((t) => (
                <div key={t.uuid} className="timer-control">
                  <span className="timer-name">{t.name}</span>
                  <span className={`chip subtle ${timerState(t.uuid)}`}>
                    {timerState(t.uuid) || "—"}
                  </span>
                  <div className="timer-btns">
                    <button className="btn small" onClick={() => ppTimerOp(t.uuid, "start")}>
                      Start
                    </button>
                    <button
                      className="btn small ghost"
                      onClick={() => ppTimerOp(t.uuid, "stop")}
                    >
                      Stop
                    </button>
                    <button
                      className="btn small ghost"
                      onClick={() => ppTimerOp(t.uuid, "reset")}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Stage Message</h3>
        </div>
        <div className="field-row">
          <input
            className="input"
            value={stageMsg}
            onChange={(e) => setStageMsg(e.target.value)}
            placeholder="Type a message for the stage display…"
          />
          <button
            className="btn primary"
            onClick={() => stageMsg && ppSetStageMessage(stageMsg)}
          >
            Send
          </button>
          <button className="btn ghost" onClick={() => ppClearStageMessage()}>
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}

function TriggerList({
  items,
  empty,
  action,
  actionLabel,
  secondary,
  activeId,
}: {
  items: Item[];
  empty: string;
  action: (id: string) => void;
  actionLabel: string;
  secondary?: { label: string; action: (id: string) => void };
  activeId?: string; // highlight the currently-live item (e.g. the active Look)
}) {
  if (items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="trigger-list">
      {items.map((it) => {
        const live = !!activeId && it.uuid === activeId;
        return (
          <div key={it.uuid} className={`trigger-row ${live ? "active" : ""}`}>
            <span className="trigger-name">
              {live && <span className="trigger-live-dot" />}
              {it.name}
            </span>
            <div className="trigger-btns">
              {secondary && (
                <button className="btn small ghost" onClick={() => secondary.action(it.uuid)}>
                  {secondary.label}
                </button>
              )}
              <button
                className={`btn small ${live ? "primary" : ""}`}
                onClick={() => action(it.uuid)}
              >
                {live ? "Live" : actionLabel}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
