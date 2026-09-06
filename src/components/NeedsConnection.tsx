import { Icon } from "./Icon";
import { requestNavigate } from "../lib/navigate";
import { KIOSK_DASH } from "../lib/tauri";

// Widgets that teach instead of sitting empty. With nothing connected a new
// dashboard is a grid of dashes; this is the one consistent empty state every
// widget renders instead — what to connect, and a button that jumps to the
// fix. Two flavours:
//   • not configured  → hint + "Set up X" button (requestNavigate to the fix)
//   • configured but offline (`offline`) → hint only, no button — there is
//     nothing to set up, the thing just needs to come back.
export interface NeedsConnectionProps {
  /** Plain-English name of the dependency: "ProPresenter", "your console". */
  what: string;
  /** Sentence shown under the icon. Default: "Connect <what> to see this". */
  hint?: string;
  /** Where the fix lives — a page name the shell knows. */
  page: string;
  /** Settings card anchor (id="set-…") when `page` is "settings". */
  anchor?: string;
  /** Icon name from components/Icon. */
  icon?: string;
  /** Button label. Default "Set up <what>" (or "Open Settings" when the target
   *  is the settings page). `null` hides the button. */
  action?: string | null;
  /** Override the button's click — e.g. start monitoring instead of navigating. */
  onAction?: () => void;
  /** Configured but unreachable: default hint becomes "<what> is offline —
   *  reconnecting…" and the button is hidden unless `action` is given. */
  offline?: boolean;
}

export function NeedsConnection({
  what,
  hint,
  page,
  anchor,
  icon = "link",
  action,
  onAction,
  offline = false,
}: NeedsConnectionProps) {
  const text = hint ?? (offline ? `${what} is offline — reconnecting…` : `Connect ${what} to see this`);
  // Kiosks are unattended screens with no inputs — a button nobody can press
  // is just clutter. Offline states have nothing to set up.
  const label =
    action === null || KIOSK_DASH !== null || (offline && action === undefined)
      ? null
      : action ?? (page === "settings" && !anchor ? "Open Settings" : `Set up ${what}`);
  return (
    <div className={`widget-empty needs-conn ${offline ? "offline" : ""}`}>
      <div className="needs-conn-inner">
        <span className="needs-conn-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <p className="needs-conn-hint">{text}</p>
        {label && (
          <button
            className="btn small needs-conn-btn"
            // Dashboard tiles drag on mousedown in edit mode — keep the click.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => (onAction ? onAction() : requestNavigate(page, anchor))}
          >
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Presets */
// Each preset carries the right destination and plain-English copy; any prop
// can still be overridden (`<NeedsPro offline />`, `<NeedsPco hint="…" />`).
type Preset = Partial<NeedsConnectionProps>;

export function NeedsPro(p: Preset) {
  return (
    <NeedsConnection
      what="ProPresenter"
      hint="Connect ProPresenter to see live slides and timers"
      page="settings"
      anchor="set-pp"
      icon="slides"
      {...p}
    />
  );
}

// PCO credentials are entered on the Planning Center page, not in Settings.
export function NeedsPco(p: Preset) {
  return (
    <NeedsConnection
      what="Planning Center"
      hint="Connect Planning Center to see this week's plan and team"
      page="planning"
      icon="calendar"
      {...p}
    />
  );
}

export function NeedsDesk(p: Preset) {
  return (
    <NeedsConnection
      what="your console"
      hint="Connect your Allen & Heath console to see mutes and faders"
      page="settings"
      anchor="set-avantis"
      icon="mic"
      action="Set up the console"
      {...p}
    />
  );
}

export function NeedsAudio(p: Preset) {
  return (
    <NeedsConnection
      what="audio monitoring"
      hint="Start audio monitoring to see SPL and the RTA"
      page="settings"
      anchor="set-audio"
      icon="mic"
      action="Set up audio"
      {...p}
    />
  );
}

export function NeedsGa4(p: Preset) {
  return (
    <NeedsConnection
      what="Google Analytics"
      hint="Connect Google Analytics to see live viewers"
      page="settings"
      anchor="set-ga4"
      icon="report"
      {...p}
    />
  );
}

export function NeedsTap(p: Preset) {
  return (
    <NeedsConnection
      what="TapLink"
      hint="Turn on TapLink to see where the NFC discs point"
      page="settings"
      anchor="set-taplink"
      icon="link"
      {...p}
    />
  );
}

export function NeedsWeb(p: Preset) {
  return (
    <NeedsConnection
      what="browser access"
      hint="Turn on browser access so phones and screens can connect"
      page="settings"
      anchor="set-web"
      icon="link"
      action="Set up browser access"
      {...p}
    />
  );
}

// The NDI source is chosen on the widget itself (dashboard Edit mode), so
// there is no settings page to jump to — the hint says where to look.
export function NeedsNdi(p: Preset) {
  return (
    <NeedsConnection
      what="a stage camera"
      hint="Pick an NDI source to see the stage feed — Edit this dashboard to choose one"
      page="dashboard"
      icon="grid"
      action={null}
      {...p}
    />
  );
}
