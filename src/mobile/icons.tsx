// Crew app glyphs. The spec's rule (design/mobile/README.md, Assets): every
// glyph is geometry in currentColor, no icon files. Drawn on a 24 grid with a
// 1.8 stroke so they sit with the nav icons (CrewNav.tsx).

import type { ReactNode } from "react";

function Svg({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconComms = () => (
  <Svg>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3" y="13" width="4" height="7" rx="1.6" />
    <rect x="17" y="13" width="4" height="7" rx="1.6" />
    <path d="M19 20c0 1.2-1.6 2-4 2h-2" />
  </Svg>
);

export const IconTally = () => (
  <Svg>
    <rect x="3" y="7" width="13" height="10" rx="2.4" />
    <path d="M16 11l5-3v8l-5-3" />
    <circle cx="7.2" cy="10.6" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconNoSound = () => (
  <Svg>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Svg>
);

export const IconBell = () => (
  <Svg>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const IconChime = () => (
  <Svg>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    <path d="M16 9a4.5 4.5 0 0 1 0 6M18.6 6.6a8 8 0 0 1 0 10.8" />
  </Svg>
);

export const IconPeople = () => (
  <Svg>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9.5" r="2.5" />
    <path d="M16 14.2a4.6 4.6 0 0 1 5 4.8" />
  </Svg>
);

export const IconSwitch = () => (
  <Svg>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </Svg>
);

export const IconScreen = () => (
  <Svg>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </Svg>
);

export const IconLock = () => (
  <Svg>
    <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);

export const IconSignOut = () => (
  <Svg>
    <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
    <path d="M11 12h9.5M17.5 8.5L21 12l-3.5 3.5" />
  </Svg>
);

export const IconTrash = () => (
  <Svg>
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13" />
  </Svg>
);

export const IconMusic = () => (
  <Svg>
    <path d="M9 17.5V5.5l11-2v12" />
    <circle cx="6.5" cy="17.5" r="2.5" />
    <circle cx="17.5" cy="15.5" r="2.5" />
  </Svg>
);

export const IconChevron = () => (
  <Svg size={18}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const IconChecklist = () => (
  <Svg>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M8.5 12.2l2.4 2.4 4.6-5" />
  </Svg>
);

export const IconChat = () => (
  <Svg>
    <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5V17.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
  </Svg>
);

export const IconGuide = () => (
  <Svg>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
  </Svg>
);

export const IconTap = () => (
  <Svg>
    <path d="M8.5 8.5a5 5 0 0 1 7 7M6 6a8.5 8.5 0 0 1 12 12" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);
