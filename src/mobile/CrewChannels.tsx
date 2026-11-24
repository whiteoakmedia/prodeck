import { useEffect, useState } from "react";
import { useChat } from "../chatStore";
import { identityRoles, type ChatMsg } from "../lib/tauri";

// S04 — chat channel list.
//
// Grouped TEAM / MY ROLES / OTHER ROLES, sorted so the conversations that are
// yours sit above the ones that merely exist. Channels come from the crew
// roster's roles, so the list grows with the team instead of being configured
// separately — a new Camera volunteer creates the Camera channel by existing.
//
// DIRECT is deliberately missing. Every browser's event stream authenticates
// with the gateway password rather than a crew identity, so the booth cannot
// address a message to one person — every phone receives every frame. A DM list
// here would look private while being a broadcast, which is worse than not
// having one. It needs an identity-aware event stream first.

export interface Channel {
  id: string; // "team" | "role:Camera"
  label: string;
  mine: boolean;
}

/** Channels from the distinct-roles list: team plus one per role. */
export function channelsFrom(roles: string[], myRole: string): Channel[] {
  const norm = (r: string) => r.trim().toLowerCase();
  return [
    { id: "team", label: "Equipo", mine: true },
    ...roles.map((r) => ({
      id: `role:${r}`,
      label: r,
      mine: norm(r) === norm(myRole),
    })),
  ];
}

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (
    p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]
  ).toUpperCase();
}

export function CrewChannels({
  myRole,
  onOpen,
  selected,
}: {
  myRole: string;
  onOpen: (c: Channel) => void;
  /** The open channel, marked when it shows beside the list (wide). */
  selected?: string;
}) {
  const chat = useChat();
  const [roles, setRoles] = useState<string[]>([]);

  // identity_roles is member-tier (strings only, no roster) — this used to be
  // identityList, which is admin-only, so members never saw role channels.
  useEffect(() => {
    identityRoles()
      .then(setRoles)
      .catch(() => {
        /* offline — team channel still works */
      });
  }, []);

  const channels = channelsFrom(roles, myRole);
  const lastIn = (id: string): ChatMsg | undefined =>
    [...chat.msgs].reverse().find((m) => (m.channel || "team") === id);

  const mine = channels.filter((c) => c.mine);
  const others = channels.filter((c) => !c.mine);

  // A plain function, not a component made inside render: that remounted
  // every row on each new message, which could swallow a tap mid-press.
  const row = (c: Channel) => {
    const last = lastIn(c.id);
    const n = chat.unreadBy[c.id] ?? 0;
    const on = selected === c.id;
    return (
      <button
        key={c.id}
        className={`crew-chan ${n > 0 ? "unread" : ""} ${on ? "on" : ""}`}
        aria-current={on || undefined}
        onClick={() => onOpen(c)}
      >
        <span className="crew-chan-avatar">{initials(c.label)}</span>
        <span className="crew-chan-mid">
          <span className="crew-chan-name">{c.label}</span>
          <span className="crew-chan-last">
            {last ? `${last.from}: ${last.text}` : "Todavía no hay mensajes"}
          </span>
        </span>
        <span className="crew-chan-end">
          {last && (
            <span className="mono-data crew-chan-time">{hhmm(last.ts)}</span>
          )}
          {n > 0 && <span className="crew-chan-badge">{n > 9 ? "9+" : n}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="crew-thread">
      <h1 className="crew-title">Chat</h1>
      <div className="crew-chan-list">
        <span className="mono crew-sheet-label">Equipo</span>
        {mine
          .filter((c) => c.id === "team")
          .map(row)}

        {mine.some((c) => c.id !== "team") && (
          <>
            <span className="mono crew-sheet-label">Mis roles</span>
            {mine
              .filter((c) => c.id !== "team")
              .map(row)}
          </>
        )}

        {others.length > 0 && (
          <>
            <span className="mono crew-sheet-label">Otros roles</span>
            {others.map(row)}
          </>
        )}

        {channels.length === 1 && (
          <p className="crew-hint muted">
            Los canales por rol aparecen cuando se asignan roles desde Control o cuando
            alguien elige su nombre del plan al ingresar.
          </p>
        )}

        <p className="crew-hint muted">
          Los canales no son privados: todos los dispositivos del equipo pueden leerlos.
        </p>
      </div>
    </div>
  );
}
