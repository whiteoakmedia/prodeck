// Bottom navigation per design/mobile/README.md — five tabs, geometric icons
// drawn in currentColor. Badges: Chat only (unread count, capped 9+);
// Checklist shows an amber dot for overdue, never a count. Pages never badge —
// they take the whole screen.

import type { ReactElement } from "react";

export type CrewTab = "home" | "chat" | "checklist" | "dashboards" | "more";

const ICONS: Record<CrewTab, ReactElement> = {
  // The ProDeck mark silhouette: three tiles.
  home: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
      <rect x="3" y="3" width="6.5" height="16" rx="2.4" />
      <rect x="12.5" y="3" width="6.5" height="8.5" rx="2.4" />
      <rect x="12.5" y="14.5" width="6.5" height="4.5" rx="2" />
    </svg>
  ),
  chat: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
      <path d="M4 3.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H9.6L5.2 20a.8.8 0 0 1-1.3-.6v-2.9H4A2.5 2.5 0 0 1 1.5 14V6A2.5 2.5 0 0 1 4 3.5Z" />
    </svg>
  ),
  checklist: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2.5" y="2.5" width="17" height="17" rx="5" />
      <path d="M7.5 11.3l2.6 2.7 4.9-5.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  dashboards: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
      <rect x="2.5" y="2.5" width="7.6" height="7.6" rx="2.2" />
      <rect x="11.9" y="2.5" width="7.6" height="7.6" rx="2.2" />
      <rect x="2.5" y="11.9" width="7.6" height="7.6" rx="2.2" />
      <rect x="11.9" y="11.9" width="7.6" height="7.6" rx="2.2" />
    </svg>
  ),
  more: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor">
      <circle cx="4.5" cy="11" r="2.1" />
      <circle cx="11" cy="11" r="2.1" />
      <circle cx="17.5" cy="11" r="2.1" />
    </svg>
  ),
};

const LABELS: Record<CrewTab, string> = {
  home: "Home",
  chat: "Chat",
  checklist: "Checklist",
  dashboards: "Dashboards",
  more: "More",
};

export function CrewNav({
  active,
  unread,
  overdue,
  onSelect,
}: {
  active: CrewTab;
  unread: number;
  overdue: boolean;
  onSelect: (t: CrewTab) => void;
}) {
  return (
    <nav className="crew-nav">
      {(Object.keys(LABELS) as CrewTab[]).map((t) => (
        <button
          key={t}
          className={`crew-nav-item ${active === t ? "active" : ""}`}
          onClick={() => onSelect(t)}
        >
          <span className="crew-nav-icon">
            {ICONS[t]}
            {t === "chat" && unread > 0 && (
              <span className="crew-nav-badge">{unread > 9 ? "9+" : unread}</span>
            )}
            {t === "checklist" && overdue && <span className="crew-nav-dot" />}
          </span>
          <span className="crew-nav-label">{LABELS[t]}</span>
        </button>
      ))}
    </nav>
  );
}
