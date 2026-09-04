import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Runtime mode: native Tauri (desktop) vs. plain browser (LAN web gateway).
// In the browser we route invoke() over HTTP POST /api/cmd and on() over a
// Server-Sent Events stream from the host app, so the rest of the frontend is
// unchanged.
// ---------------------------------------------------------------------------
export const IS_WEB =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

// Base URL for the host's MJPEG (NDI) servers. In the desktop app the feeds are
// on loopback; in a browser they live on the host this page was served from.
export const mjpegBase = (): string =>
  IS_WEB && typeof location !== "undefined"
    ? `http://${location.hostname}`
    : "http://127.0.0.1";

// Full URL for one MJPEG feed. The camera ports authenticate every non-loopback
// client with the web token (they bind the LAN), so browser viewers must sign
// the URL; the desktop app rides the loopback exemption.
export const mjpegUrl = (port: number): string =>
  IS_WEB
    ? `${mjpegBase()}:${port}/?token=${encodeURIComponent(getWebToken())}`
    : `${mjpegBase()}:${port}/`;

const TOKEN_KEY = "prodeck.webToken";
/** Personal invite token stashed by an ?invite= link until the claim screen
 *  consumes it. */
export const INVITE_KEY = "prodeck.inviteToken";

// Invite links sign the browser in without a typed password: ?join=<crew
// token> or ?invite=<personal token> become the gateway token, and the URL is
// scrubbed immediately so shares and history don't carry credentials. Runs at
// module init, before anything renders or connects.
if (IS_WEB && typeof localStorage !== "undefined") {
  try {
    const q = new URLSearchParams(window.location.search);
    const join = q.get("join");
    const invite = q.get("invite");
    if (join || invite) {
      localStorage.setItem(TOKEN_KEY, (invite ?? join)!);
      if (invite) localStorage.setItem(INVITE_KEY, invite);
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch {
    /* malformed URL — fall through to the normal login */
  }
}
export const getWebToken = (): string =>
  (typeof localStorage !== "undefined" && localStorage.getItem(TOKEN_KEY)) || "";
export function setWebToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
  reconnectSse();
}
export function clearWebToken() {
  localStorage.removeItem(TOKEN_KEY);
}

let gatewayOnline = true;
let downTimer: ReturnType<typeof setTimeout> | null = null;
const gatewayWatchers = new Set<(up: boolean) => void>();
// EventSource fires onerror on every ordinary reconnect, so reporting "down"
// immediately would blank the whole app to the offline screen on a one-second
// Wi-Fi blip. Coming back up is reported instantly; going down has to persist.
const DOWN_GRACE_MS = 6000;
function setGatewayOnline(up: boolean) {
  if (up) {
    if (downTimer) {
      clearTimeout(downTimer);
      downTimer = null;
    }
    if (!gatewayOnline) {
      gatewayOnline = true;
      gatewayWatchers.forEach((f) => f(true));
    }
    return;
  }
  if (!gatewayOnline || downTimer) return;
  downTimer = setTimeout(() => {
    downTimer = null;
    gatewayOnline = false;
    gatewayWatchers.forEach((f) => f(false));
  }, DOWN_GRACE_MS);
}
/** Subscribe to booth reachability from a browser client. Always true on desktop. */
export function onGatewayState(cb: (up: boolean) => void): () => void {
  if (!IS_WEB) return () => {};
  gatewayWatchers.add(cb);
  cb(gatewayOnline);
  return () => gatewayWatchers.delete(cb);
}

type WebHandler = (payload: unknown) => void;
const webHandlers = new Map<string, Set<WebHandler>>();
let sse: EventSource | null = null;

function reconnectSse() {
  if (!IS_WEB) return;
  try {
    sse?.close();
  } catch {
    /* ignore */
  }
  const t = getWebToken();
  if (!t) return;
  sse = new EventSource(`/api/events?token=${encodeURIComponent(t)}`);
  // Whether this browser can actually reach the booth. NOT the same as
  // ProDeck's `connected`, which is the booth's link to ProPresenter — a phone
  // must not be told "Command Center offline" just because Pro dropped.
  sse.onopen = () => setGatewayOnline(true);
  sse.onerror = () => setGatewayOnline(false);
  sse.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as { event: string; payload: unknown };
      const set = webHandlers.get(msg.event);
      if (set) set.forEach((h) => h(msg.payload));
    } catch {
      /* ignore malformed frame */
    }
  };
}
// Kiosk bootstrap (?kiosk=<dashboard name>&token=<access password>): the
// bookmark carries auth so an unattended screen (office Mac mini, no
// keyboard) never has to type the password. Token is stored before the SSE
// connects; the kiosk name is read by App to swap the shell for KioskPage.
const bootParams =
  typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
const bootToken = bootParams?.get("token");
if (IS_WEB && bootToken && typeof localStorage !== "undefined") {
  localStorage.setItem(TOKEN_KEY, bootToken);
}
export const KIOSK_DASH: string | null = IS_WEB ? bootParams?.get("kiosk") ?? null : null;

if (IS_WEB) reconnectSse();
// First touch unlocks WebAudio so chimes and page tones can play on iOS.
if (IS_WEB && typeof window !== "undefined") {
  import("./sound").then((s) => s.primeAudio()).catch(() => {});
}

// PWA: register the service worker (installability now, Web Push in P2).
// Browsers only allow this in secure contexts — today that means localhost;
// it lights up everywhere once the HTTPS tunnel hostname exists. No-op inert
// on plain LAN HTTP, by design.
// Android fires this once, early — stash it so the onboarding screen can offer
// a real Install button instead of a dead one.
if (IS_WEB && typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    (window as unknown as { __pdInstallPrompt?: Event }).__pdInstallPrompt = e;
  });
}

if (IS_WEB && "serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* SW is progressive enhancement — the app is fully functional without it */
  });
}

async function webInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/cmd", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args: args ?? {}, token: getWebToken() }),
  });
  if (res.status === 401) {
    clearWebToken();
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("prodeck-web-unauthorized"));
    throw new Error("unauthorized");
  }
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (j && j.error) throw new Error(j.error);
  return (j ? j.result : null) as T;
}

// Drop-in replacement for Tauri's invoke that switches on runtime mode.
export function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return IS_WEB ? webInvoke<T>(cmd, args) : tauriInvoke<T>(cmd, args as never);
}

// Surface a failed ProPresenter control action to the operator. Control calls
// used to silently swallow errors (so a dead trigger looked like nothing
// happened); wrapping them here pops a transient toast and never rejects.
function ctrl(p: Promise<void>): Promise<void> {
  return p.catch((e) => {
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("prodeck-control-error", { detail: String(e) }),
      );
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProPresenterConfig {
  host: string;
  port: number;
}

export interface DiscoveredService {
  kind: "propresenter" | "stage" | "ndi" | "other";
  name: string;
  host: string;
  port: number;
  addresses: string[];
}

export interface NdiSource {
  name: string;
  url_address: string;
}

export interface Settings {
  pp_host: string;
  pp_port: number;
  pp_auto_connect: boolean;
  audio_input: string | null;
  whisper_bin: string | null;
  whisper_model: string | null;
  captions_enabled: boolean;
  osc_port: number;
  midi_port: string | null;
  relay_url: string;
  device_name: string;
  theme: string;
  pco_app_id: string | null;
  pco_secret: string | null;
  spl_calibration: number;
  web_enabled: boolean;
  web_port: number;
  web_password: string;
  web_member_password: string;
  web_invite_token: string;
  edge_admin_token: string;
  gemini_api_key: string | null;
  ga4_property_id: string;
  ga4_key_path: string;
  ga4_page_filter: string;
  avantis_watch_user: string;
  avantis_watch_armed: boolean;
  public_url: string;
  gemini_match_enabled: boolean;
  audio_measure_channels: number[];
  audio_overflow_channels: number[];
  keysend_enabled: boolean;
  keysend_osc_host: string;
  keysend_osc_port: number;
  keysend_midi_port: string | null;
  keysend_midi_channel: number;
  keysend_cc: number;
  tap_enabled: boolean;
  tap_edge_url: string;
  tap_token: string;
  avantis_enabled: boolean;
  avantis_host: string;
  avantis_midi_base: number;
  avantis_scene_labels: Record<string, string>;
  avantis_softkeys: AvantisSoftkey[];
  /** Lobby TVs auto-restore: booth watchdog re-triggers this playlist item
   *  whenever the announcements layer is empty. Empty playlist = off. */
  lobby_auto_playlist: string;
  lobby_auto_index: number;
  lobby_auto_name: string;
  /** Auto check-in geolocation fence: building coordinates + radius (m).
   *  Blank coordinates = geo path off; the wifi/IP path is always on. */
  church_lat: string;
  church_lng: string;
  checkin_radius_m: number;
  checkin_nudge: boolean;
}

// A desk softkey (custom MIDI note) mapped to a crew page.
export interface AvantisSoftkey {
  midi_channel: number; // 1-based
  note: number;
  body: string;
  recipients: string[]; // crew user ids; empty = everyone approved
}

// Avantis console mirror (read-only). Keys are "kind:index", e.g. "input:5".
export interface AvantisSnapshot {
  connected: boolean;
  scene: number | null;
  mutes: Record<string, boolean>;
  faders: Record<string, number>;
  names: Record<string, string>;
  colors: Record<string, number>;
}
export interface Ga4Snapshot {
  configured: boolean;
  viewers: number | null;
  updated: number | null;
  error: string | null;
  history: { at: number; viewers: number }[];
}
/** Live viewer count for the Church Online watch page, from GA4 realtime. */
export const ga4State = () => invoke<Ga4Snapshot>("ga4_state");
export const avantisState = () => invoke<AvantisSnapshot>("avantis_state");
// Desk control — admin tier only (member web clients are rejected server-side).
export const avantisSetMute = (id: string, muted: boolean) =>
  invoke<void>("avantis_set_mute", { id, muted });
export const avantisRecallScene = (scene: number) =>
  invoke<void>("avantis_recall_scene", { scene });
export const avantisSetFader = (id: string, value: number) =>
  invoke<void>("avantis_set_fader", { id, value });
export const avantisSetName = (id: string, name: string) =>
  invoke<void>("avantis_set_name", { id, name });

export interface TranscriptionConfig {
  configured: boolean;
  whisper_bin: string | null;
  whisper_model: string | null;
}

export interface RelayStatus {
  mode: "off" | "host" | "client";
  running: boolean;
  port: number;
  clients: number;
}

export type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// ProPresenter
// ---------------------------------------------------------------------------

export const ppConnect = (config: ProPresenterConfig) =>
  invoke<Json>("pp_connect", { config });
export const ppDisconnect = () => invoke<void>("pp_disconnect");
export const ppIsConnected = () => invoke<boolean>("pp_is_connected");
export const ppGet = (path: string) => invoke<Json>("pp_get", { path });
export const ppPut = (path: string, body?: unknown) =>
  invoke<void>("pp_put", { path, body });
// Messages carry token values, so triggering one is a PUT-with-body (unlike
// other triggers, which are GET). Routed through the control-failure toast.
export const ppTriggerMessage = (id: string) =>
  ctrl(invoke<void>("pp_put", { path: `message/${encodeURIComponent(id)}/trigger`, body: [] }));
// ProPresenter trigger/clear actions are GET (a PUT 404s). Use this for every
// "do it now" action (slide trigger, prop/clear, next/previous, …).
export const ppAction = (path: string) => ctrl(invoke<void>("pp_action", { path }));
// Trigger a slide the way an operator's click does — so the slide's attached
// ACTIONS fire too (audience Look, macros, clears). The bare
// presentation/{uuid}/{index}/trigger puts up the slide but, depending on how the
// action is attached, may not fire it; focusing the presentation first and then
// triggering the FOCUSED cue mirrors a UI click and reliably fires the actions
// (this is what ProDeck does). Falls back to a bare trigger if focus fails so a
// slide always at least goes live. `index` is in ProPresenter's cue space
// (current arrangement, else stored order) — the same addrIndex the grid computes.
const ppGetRaw = (path: string) => invoke<void>("pp_action", { path });
export const ppFocusTrigger = (uuid: string, index: number) => {
  const u = encodeURIComponent(uuid);
  return ctrl(
    ppGetRaw(`presentation/${u}/focus`).then(
      () => ppGetRaw(`presentation/focused/${index}/trigger`),
      // focus unsupported/failed → trigger by uuid directly (don't fire "focused",
      // which could be a different presentation).
      () => ppGetRaw(`presentation/${u}/${index}/trigger`),
    ),
  );
};
// Trigger a slide WITHIN A PLAYLIST the way an operator navigates it: keep
// ProPresenter focused on this playlist (so it doesn't jump to the library copy),
// make the item the active presentation when it isn't already (its destination +
// arrangement load and the slide's actions fire), then go to the cue. cueIndex is
// the DISPLAY position — the active item uses the playlist's arrangement.
// alreadyActive skips re-triggering the item, which would flash back to its first
// slide. This is how ProDeck stays in-playlist and on the right screen.
export const ppPlaylistTrigger = (
  playlistId: string,
  itemIndex: number,
  cueIndex: number,
  alreadyActive: boolean,
) => {
  const pl = encodeURIComponent(playlistId);
  let chain = ppGetRaw(`playlist/${pl}/focus`);
  if (!alreadyActive)
    chain = chain.then(() => ppGetRaw(`playlist/focused/${itemIndex}/trigger`));
  return ctrl(chain.then(() => ppGetRaw(`presentation/active/${cueIndex}/trigger`)));
};
export const ppDelete = (path: string) => invoke<void>("pp_delete", { path });
export const ppNext = () => ctrl(invoke<void>("pp_trigger_next"));
export const ppPrevious = () => ctrl(invoke<void>("pp_trigger_previous"));
export const ppClearLayer = (layer: string) =>
  ctrl(invoke<void>("pp_clear_layer", { layer }));
export const ppTriggerMacro = (id: string) =>
  ctrl(invoke<void>("pp_trigger_macro", { id }));
export const ppTriggerLook = (id: string) =>
  ctrl(invoke<void>("pp_trigger_look", { id }));
export const ppTimerOp = (id: string, op: "start" | "stop" | "reset") =>
  ctrl(invoke<void>("pp_timer_op", { id, op }));
export const ppSetStageMessage = (message: string) =>
  ctrl(invoke<void>("pp_set_stage_message", { message }));
export const ppClearStageMessage = () => ctrl(invoke<void>("pp_clear_stage_message"));
export const ppThumbnail = (uuid: string, index: number, quality = 400) =>
  invoke<string>("pp_thumbnail", { uuid, index, quality });
// Thumbnail for a slide of a PLAYLIST ITEM. cueIndex is the display position in
// the item's arrangement; the image always matches the slide we show, regardless
// of ProPresenter's current_arrangement state.
export const ppPlaylistThumbnail = (
  playlistId: string,
  itemIndex: number,
  cueIndex: number,
  quality = 400,
) => invoke<string>("pp_playlist_thumbnail", { playlistId, itemIndex, cueIndex, quality });

// Open a printable HTML document in the default browser (where print / save-as-PDF
// works reliably — the in-app WebView's window.print() does not on macOS).
export const openPrintHtml = (html: string) =>
  invoke<void>("open_print_html", { html });

// ---------------------------------------------------------------------------
// Discovery / NDI / Relay
// ---------------------------------------------------------------------------

export const discoverServices = (secs = 4) =>
  invoke<DiscoveredService[]>("discover_services", { secs });
export const ndiDiscover = () => invoke<NdiSource[]>("ndi_discover_sources");
export const ndiStart = (sourceName: string) =>
  invoke<number>("ndi_start_receiver", { sourceName });
export const ndiStop = (sourceName?: string) =>
  invoke<void>("ndi_stop_receiver", { sourceName: sourceName ?? null });

export const relayStartHost = (port: number) =>
  invoke<void>("relay_start_host", { port });
export const relayBroadcast = (payload: Json) =>
  invoke<void>("relay_broadcast", { payload });
export const relayConnectClient = (url: string) =>
  invoke<void>("relay_connect_client", { url });
export const relayStop = () => invoke<void>("relay_stop");
export const relayStatus = () => invoke<RelayStatus>("get_relay_status");

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getSettings = () => invoke<Settings>("get_settings");
export const updateSettings = (settings: Settings) =>
  invoke<void>("update_settings", { settings });

// ---------------------------------------------------------------------------
// Audio + Transcription
// ---------------------------------------------------------------------------

export const listAudioInputs = () => invoke<string[]>("list_audio_inputs");
export const defaultAudioInput = () =>
  invoke<string | null>("default_audio_input");
export const audioInputChannels = (device?: string | null) =>
  invoke<number>("audio_input_channels", { device: device ?? null });
export const startAudioCapture = (device?: string | null) =>
  invoke<void>("start_audio_capture", { device: device ?? null });
export const stopAudioCapture = () => invoke<void>("stop_audio_capture");
export const transcriptionStatus = () =>
  invoke<TranscriptionConfig>("transcription_status");
export const injectCaption = (text: string) =>
  invoke<void>("inject_caption", { text });
export const startTranscription = () => invoke<void>("start_transcription");
export const stopTranscription = () => invoke<void>("stop_transcription");

// ---------------------------------------------------------------------------
// Gemini smart matching (Auto-Follow)
// ---------------------------------------------------------------------------

export interface GeminiCandidate {
  song: string;
  section: string;
  text: string;
}
export interface GeminiMatch {
  choice: number; // index into the candidates array, or -1
  confidence: number; // 0..1
}
export const geminiPickSlide = (
  transcript: string,
  candidates: GeminiCandidate[],
) => invoke<GeminiMatch>("gemini_pick_slide", { transcript, candidates });
export const geminiTest = () => invoke<string>("gemini_test");

// ---------------------------------------------------------------------------
// MIDI + OSC
// ---------------------------------------------------------------------------

export const listMidiInputs = () => invoke<string[]>("list_midi_inputs");
export const connectMidi = (portName: string) =>
  invoke<void>("connect_midi", { portName });
export const disconnectMidi = () => invoke<void>("disconnect_midi");
export const startOsc = (port: number) => invoke<void>("start_osc", { port });
export const stopOsc = () => invoke<void>("stop_osc");

// MIDI output + OSC send — used to push the live song's key to a rig.
export const listMidiOutputs = () => invoke<string[]>("list_midi_outputs");
export const connectMidiOut = (portName: string) =>
  invoke<void>("connect_midi_out", { portName });
export const disconnectMidiOut = () => invoke<void>("disconnect_midi_out");
export const midiSendKey = (channel: number, value: number, ccNum: number) =>
  invoke<void>("midi_send_key", { channel, value, ccNum });
export const oscSendKey = (host: string, port: number, name: string, pc: number) =>
  invoke<void>("osc_send_key", { host, port, name, pc });

// ---------------------------------------------------------------------------
// Planning Center
// ---------------------------------------------------------------------------

export const pcoGet = (path: string) => invoke<Json>("pco_get", { path });
export const pcoTest = () => invoke<Json>("pco_test");
export const pcoStartSync = (serviceTypeId: string, planId: string) =>
  invoke<void>("pco_start_sync", { serviceTypeId, planId });
export const pcoStopSync = () => invoke<void>("pco_stop_sync");
export const pcoSetLiveInterval = (ms: number) =>
  invoke<void>("pco_set_live_interval", { ms });

// Web gateway (LAN browser access)
export const webStart = (port: number) => invoke<void>("web_start", { port });
export const webStop = () => invoke<void>("web_stop");
export const webStatus = () =>
  invoke<{ running: boolean; port: number }>("web_status");
export type PcoLiveAction =
  | "go_to_next_item"
  | "go_to_previous_item"
  | "toggle_control";
export const pcoLiveAction = (
  serviceTypeId: string,
  planId: string,
  action: PcoLiveAction,
) => invoke<Json | null>("pco_live_action", { serviceTypeId, planId, action });
// Who holds the PCO Live controller. `controllerId` is null when nobody has
// taken control — the state in which go_to_next_item silently does nothing.
export interface PcoController {
  controllerId: string | null;
  controllerName: string | null;
  meId: string | null;
}
export const pcoLiveController = (serviceTypeId: string, planId: string) =>
  invoke<PcoController>("pco_live_controller", { serviceTypeId, planId });
export const loadPcoData = () => invoke<Json | null>("load_pco_data");
export const savePcoData = (data: Json) => invoke<void>("save_pco_data", { data });
export const loadTracking = () => invoke<Json | null>("load_tracking");
export const saveTracking = (data: Json) => invoke<void>("save_tracking", { data });
export const loadChecklists = () => invoke<Json | null>("load_checklists");
export const saveChecklists = (data: Json) => invoke<void>("save_checklists", { data });
// Phones can't write the whole file (last-writer-wins would clobber the booth),
// but ticking one item is legitimate — the booth applies it and broadcasts.
export const checklistToggle = (listId: string, itemId: string) =>
  invoke<{ done: boolean }>("checklist_toggle", { listId, itemId });

// Saved service reports. Their own file, so nothing in the live tracking flow
// (Reset, a bucket switch, an unreadable tracking.json) can take them with it.
// Both reject rather than returning null when the file exists but is unusable.
export const loadReports = () => invoke<Json | null>("load_reports");
export const saveReports = (data: Json) => invoke<void>("save_reports", { data });
export const loadSchedules = () => invoke<Json | null>("load_schedules");
export const saveSchedules = (data: Json) => invoke<void>("save_schedules", { data });

// ---------------------------------------------------------------------------
// Team messaging (crew intercom; browsers are full participants)
// ---------------------------------------------------------------------------

export interface ChatMsg {
  id: number;
  from: string;
  text: string;
  target: "team" | "confidence" | "stage";
  /** "team" or "role:<Role Name>". Filing, not privacy — see chat.rs. */
  channel: string;
  ts: number;
}
// Desktop signs messages with its device name; web clients authenticate with a
// crew session token and the gateway derives the verified name server-side.
export const chatSend = (
  from: string,
  text: string,
  target: ChatMsg["target"],
  channel = "team",
) => invoke<ChatMsg>("chat_send", { from, text, target, channel });
export const chatSendAs = (
  session: string,
  text: string,
  target: ChatMsg["target"],
  channel = "team",
) => invoke<ChatMsg>("chat_send", { session, text, target, channel });

// ---------------------------------------------------------------------------
// Pages — the priority channel. Receipts are recorded booth-side from an ack
// that actually arrived, so a confirm that never landed never shows as read.
// ---------------------------------------------------------------------------
export interface PageRecipient {
  id: string;
  name: string;
}
export interface PageReceipt {
  user_id: string;
  name: string;
  read_ms: number;
}
export interface CrewPage {
  id: number;
  from: string;
  body: string;
  recipients: PageRecipient[];
  buzz: boolean;
  sent_ms: number;
  receipts: PageReceipt[];
}
// `recipients` empty = everyone; the booth resolves it to a concrete list.
// Same split as chat: the desktop signs with its device name, a browser sends
// its crew session and the gateway derives the verified name server-side.
export const pageSend = (
  from: string,
  body: string,
  recipients: string[],
  buzz: boolean,
) => invoke<CrewPage>("page_send", { from, body, recipients, buzz });
export const pageSendAs = (
  session: string,
  body: string,
  recipients: string[],
  buzz: boolean,
) => invoke<CrewPage>("page_send", { session, body, recipients, buzz });
export const pageAck = (session: string, pageId: number) =>
  invoke<PageReceipt>("page_ack", { session, pageId });
export const pageRebuzz = (pageId: number) =>
  invoke<{ buzzed: number }>("page_rebuzz", { pageId });
export const pageList = () => invoke<CrewPage[]>("page_list");

// Position files — reference material (diagrams, cheat sheets) attached to a
// PCO position. Read by anyone signed in; only the booth can add or remove.
export interface PosFile {
  id: string;
  position: string;
  name: string;
  mime: string;
  size: number;
  added_ms: number;
}
export const posfileList = () => invoke<PosFile[]>("posfile_list");
export const posfileAdd = (position: string, name: string, mime: string, data: string) =>
  invoke<PosFile>("posfile_add", { position, name, mime, data });
export const posfileRemove = (id: string) => invoke<void>("posfile_remove", { id });
/** Where a phone or the booth fetches the bytes. Token-gated on the gateway,
 *  so a browser needs its access token in the query string. */
export const posfileUrl = (id: string) =>
  IS_WEB ? `/api/file/${id}?token=${encodeURIComponent(getWebToken())}` : "";

// Web push registration. The booth binds a subscription to the crew user behind
// the session, so a phone can only ever register itself.
export const pushPublicKey = () => invoke<{ key: string }>("push_public_key");
export const pushSubscribe = (
  session: string,
  endpoint: string,
  p256dh: string,
  auth: string,
) => invoke<{ ok: boolean }>("push_subscribe", { session, endpoint, p256dh, auth });
export const pushUnsubscribe = (session: string) =>
  invoke<{ ok: boolean }>("push_unsubscribe", { session });

// Crew check-in. Idempotent booth-side: the first arrival time wins, and a new
// service clears last week's arrivals.
export const checkinSet = (session: string, serviceKey: string) =>
  invoke<{ at: number }>("checkin_set", { session, serviceKey });
// Auto check-in (web only — the gateway inspects the request's own network
// evidence, so there is no desktop equivalent). `geo` in the response says
// whether the booth has coordinates configured, i.e. whether asking the
// browser for location is worth the prompt.
export const checkinAuto = (session: string, serviceKey: string) =>
  invoke<{ checkedIn: boolean; at?: number; geo: boolean }>("checkin_auto", {
    session,
    serviceKey,
  });
export const checkinGeo = (session: string, serviceKey: string, lat: number, lng: number) =>
  invoke<{ checkedIn: boolean; at?: number; reason?: string }>("checkin_geo", {
    session,
    serviceKey,
    lat,
    lng,
  });
export const checkinList = (session: string) =>
  invoke<{
    at: Record<string, number>;
    serviceKey: string;
    mine: number | null;
    sessionValid: boolean;
  }>("checkin_list", { session });

// Crew identity (PIN accounts; register/login are open to both web tiers)
export interface CrewUser {
  id: string;
  name: string;
  approved: boolean;
  created_ms: number;
  last_seen_ms: number;
  /** Sunday role ("Camera 1"). Free text, admin-set; "" until assigned. */
  role: string;
  /** Healed Planning Center spelling; "" until linked. */
  pco_name?: string;
}
export const identitySetRole = (id: string, role: string) =>
  invoke<void>("identity_set_role", { id, role });
export const identityRegister = (name: string, pin: string, role = "", invite = "") =>
  invoke<{
    status: string;
    name: string;
    session?: string;
    id?: string;
    role?: string;
    web_token?: string;
  }>("identity_register", { name, pin, role, invite });

// Personal one-time onboarding invites (admin-tier manage; info is open so
// the claiming phone can greet by name).
export interface Invite {
  token: string;
  name: string;
  role: string;
  expires_ms: number;
  used: boolean;
  expired?: boolean;
}
export const inviteCreate = (name: string, role = "") =>
  invoke<Invite>("invite_create", { name, role });
export const inviteList = () => invoke<Invite[]>("invite_list");
export const inviteRevoke = (token: string) => invoke<void>("invite_revoke", { token });
export const inviteInfo = (token: string) =>
  invoke<{ name: string; role: string }>("invite_info", { token });

/** Resolve a PCO attachment (chord chart etc.) to its short-lived download
 *  URL. Works for members — worship phones open their own charts. */
export const pcoAttachmentOpen = async (id: string): Promise<string> => {
  const j = (await invoke<Json>("pco_attachment_open", { id })) as any;
  const url = j?.data?.attributes?.attachment_url ?? j?.attributes?.attachment_url;
  if (!url) throw new Error("Planning Center didn't return a link for this file");
  return String(url);
};

/** Public origin volunteers use from anywhere (your tunnel/domain).
 *  Comes from Settings → Browser Access → Public URL. Web clients default to
 *  their own origin — a phone already on the public domain needs no config —
 *  and the desktop app has no origin, so it stays empty until configured. */
export let PUBLIC_URL = IS_WEB && typeof location !== "undefined" ? location.origin : "";
export const setPublicUrl = (v: string) => {
  const t = (v ?? "").trim().replace(/\/+$/, "");
  if (t) PUBLIC_URL = t;
};

/** Reach the crew-edge worker: same-origin first (works on prodeck.live even
 *  with the booth off — the /edge/* route is a Worker on the zone, not the
 *  tunnel), falling back to the public origin for a PWA that was installed
 *  from the booth's LAN address, whose own origin dies with the booth. */
export const edgeFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(`/edge${path}`, init);
  } catch {
    return fetch(`${PUBLIC_URL}/edge${path}`, init);
  }
};
export const identityLogin = (name: string, pin: string) =>
  invoke<{ status: string; session?: string; name: string; id?: string; role?: string }>(
    "identity_login",
    { name, pin },
  );
// Session → this device's own identity (id matches checklist-item owners).
// pcoName is the healed Planning Center spelling ("" until linked) — phones
// adopt it as their matching name so arrival/position lookups use PCO's own
// spelling even when the person typed a nickname at signup.
export const identityWhoami = (session: string) =>
  invoke<{ id: string; name: string; role: string; pcoName?: string }>("identity_whoami", {
    session,
  });
// Booth-only: link typed signup names to their PCO roster person (and adopt
// the scheduled position as the role when none is set).
export const identityHealPco = (team: { name: string; position: string }[]) =>
  invoke<{ linked: number; rolesFilled: number }>("identity_heal_pco", { team });
// Routing map (signal chains + troubleshooting) — readable by every tier,
// saved only from the booth.
export const loadRouting = () => invoke<Json>("load_routing");
export const saveRouting = (data: Json) => invoke<void>("save_routing", { data });

export const identityList = () => invoke<CrewUser[]>("identity_list");
/** Distinct roles in use (member-safe — no names/ids). Drives channel lists. */
export const identityRoles = () => invoke<string[]>("identity_roles");
export const identityApprove = (id: string, approved: boolean) =>
  invoke<void>("identity_approve", { id, approved });
export const identityRemove = (id: string) => invoke<void>("identity_remove", { id });
export const chatHistory = () => invoke<ChatMsg[]>("chat_history");
export const chatClearConfidence = () => invoke<void>("chat_clear_confidence");
// Access tier of this client's token. Desktop is always admin; web clients ask
// the gateway (member tokens get team-chat-only, no control surfaces).
export const webWhoami = () =>
  IS_WEB ? invoke<{ tier: "admin" | "member" }>("web_whoami") : Promise.resolve({ tier: "admin" as const });

// ---------------------------------------------------------------------------
// TapLink (NFC destination sync). Watching and overriding work from the web
// gateway too; configuration (token, arm switch, mappings) stays booth-only.
// ---------------------------------------------------------------------------

// Push a state now, or null to revert to the edge's default.
export const tapOverride = (state: string | null) =>
  invoke<void>("tap_override", { state });
export interface TapEdgeState {
  state: string | null;
  source: "auto" | "override" | null;
  setAt: number | null;
  expiresAt: number | null;
  destination: string;
  lastHeartbeat: number | null;
  version: string;
}
export const tapEdgeState = () => invoke<TapEdgeState>("tap_edge_state");
export const tapTest = (edgeUrl: string, token: string) =>
  invoke<string>("tap_test", { edgeUrl, token });

// Mapping config (keyword → destination). A keyword's value is either a bare
// URL string or {url, ttl_minutes} when it overrides the global TTL.
export type TapKeywordValue = string | { url: string; ttl_minutes?: number };
export interface TapMappings {
  default: string;
  ttl_minutes: number;
  keywords: Record<string, TapKeywordValue>;
}
// Booth-only (not in the gateway whitelist): editing where the discs can point
// is configuration, like the token and the arm switch.
export const tapMappings = () => invoke<TapMappings>("tap_mappings");
export const tapSaveMappings = (config: TapMappings) =>
  invoke<{ ok: boolean; keywords: string[] }>("tap_save_mappings", { config });

// Tap counts straight from the edge's log. Read-only, so this one works on web.
export interface TapStatRow {
  day: string; // YYYY-MM-DD, edge-side UTC
  state: string; // keyword, or "default" for taps outside a tagged moment
  taps: number;
}
export const tapStats = () => invoke<{ days: TapStatRow[] }>("tap_stats");

// Taps inside one service window. Day buckets can't answer this — two services
// share a UTC day, and an evening service can straddle UTC midnight.
export interface TapWindow {
  from: number;
  to: number;
  total: number;
  keywords: { state: string; taps: number }[];
}
export const tapStatsRange = (from: number, to: number) =>
  invoke<TapWindow>("tap_stats_range", { from, to });

// Link health. `status` is the HTTP code, or null when the request never got
// that far (then `error` says why). Booth-only.
export interface TapLinkCheck {
  url: string;
  status: number | null;
  error: string | null;
}
export const tapCheckLinks = (urls: string[]) =>
  invoke<TapLinkCheck[]>("tap_check_links", { urls });

// ---------------------------------------------------------------------------
// Event helper
// ---------------------------------------------------------------------------

export function on<T = unknown>(
  event: string,
  cb: (payload: T) => void,
): Promise<UnlistenFn> {
  if (IS_WEB) {
    let set = webHandlers.get(event);
    if (!set) {
      set = new Set();
      webHandlers.set(event, set);
    }
    const h = cb as WebHandler;
    set.add(h);
    return Promise.resolve((() => set!.delete(h)) as UnlistenFn);
  }
  return tauriListen<T>(event, (e) => cb(e.payload));
}
