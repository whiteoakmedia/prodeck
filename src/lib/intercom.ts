// Intercom: hold-to-talk party lines between crew phones and tablets.
//
// Audio goes phone to phone over the church Wi-Fi (WebRTC), never through the
// booth: the booth (src-tauri/src/intercom.rs) only keeps the roster and
// passes the connection set-up messages along. Every phone on comms connects
// to every other one (a mesh, fine for a crew of a dozen) and sends its mic
// only while the Talk button is held. What you HEAR is decided here: someone
// talking on a line you listen to is switched on, everyone else stays off.
// That is done on the incoming track, never by muting the audio element:
// Safari can refuse to unmute an element without a tap, which is silence.
//
// Like listen.ts this is a module-level singleton, so comms keeps running
// while the phone moves between tabs or into tally mode.
//
// Limits worth knowing before debugging "I can't hear anyone":
//  * Browsers only give a web page the microphone over HTTPS. On the plain
//    LAN address there is no mic, so joining says so instead of failing.
//  * Phones must be able to reach each other. A guest network that isolates
//    clients blocks this even though each phone reaches the booth fine.
//  * iOS stops a web app's audio when the screen locks. Comms is for people
//    at a post with the app open, not a radio in a pocket.

import { IS_DEMO } from "./demo";
import { isBoothScreen } from "./resi";
import {
  CREW_SESSION_KEY,
  IS_WEB,
  intercomJoin,
  intercomLeave,
  intercomSignal,
  intercomTalk,
  on,
  type IntercomMember,
  type IntercomRoster,
} from "./tauri";

const HEARTBEAT_MS = 15_000;
/** A connection that isn't up by now is redialled. */
const DIAL_TIMEOUT_MS = 12_000;
const LISTEN_KEY = "prodeck.commsListen";
const TALK_KEY = "prodeck.commsTalk";
const OPEN_KEY = "prodeck.commsOpenMic";
export const DEFAULT_LISTEN = ["All"];

export type CommsState = "off" | "joining" | "on";

export interface CommsSnapshot {
  state: CommsState;
  err: string;
  me: string;
  roster: IntercomRoster;
  listen: string[];
  /** The line the Talk button talks on. */
  talkOn: string;
  /**
   * Open mic: talking without holding the button, until it's turned off. The
   * big button becomes Mute. Remembered, but every join starts muted: a mic
   * that opened by itself when the app came back could put a private word on
   * the line in the middle of the sermon.
   */
  openMic: boolean;
  talking: boolean;
  /** People connected to this phone right now (audio path up). */
  linked: string[];
  /** Each connection's state by device id, for the comms screen. */
  links: Record<string, string>;
  /**
   * Devices a call to has already timed out at least once. Almost always one
   * phone on cellular (or a guest network): the booth still connects them, so
   * comms looks joined, but the two phones can't reach each other.
   */
  unreachable: string[];
}

// ---------------------------------------------------------------- pure rules

/**
 * Which side starts a connection. Exactly one of any two phones must make the
 * offer, or both do and the calls collide; the smaller id always offers.
 */
export function shouldOffer(me: string, them: string): boolean {
  return me < them;
}

/** Who this phone should hear: people talking on a line it listens to. */
export function audibleIds(members: IntercomMember[], me: string, listen: string[]): string[] {
  return members.filter((m) => m.id !== me && !!m.talk && listen.includes(m.talk)).map((m) => m.id);
}

/** Connections to open (those this phone offers) and to close (people gone). */
export function reconcile(members: IntercomMember[], me: string, open: string[]) {
  const others = members.map((m) => m.id).filter((id) => id !== me);
  return {
    offer: others.filter((id) => !open.includes(id) && shouldOffer(me, id)),
    close: open.filter((id) => !others.includes(id)),
  };
}

/** Who is talking right now, for the screen ("Sam on Cameras"). */
export function talkers(members: IntercomMember[], me: string): { name: string; line: string; me: boolean }[] {
  return members
    .filter((m) => !!m.talk)
    .map((m) => ({ name: m.id === me ? "You" : m.name.split(/\s+/)[0] || m.name, line: m.talk as string, me: m.id === me }));
}

/**
 * What the Talk button says. `short` is the chip and tally button, where
 * "Talk" (hold) or Mute / Unmute (open mic) has to fit.
 */
export function talkLabel(o: { openMic: boolean; talking: boolean; line: string; short?: string }): string {
  if (o.openMic) {
    if (o.short) return o.talking ? "Mute" : "Unmute";
    return o.talking ? `Live on ${o.line}. Tap to mute` : `Muted. Tap to talk on ${o.line}`;
  }
  if (o.short) return o.short;
  return o.talking ? `Talking on ${o.line}` : `Hold to talk on ${o.line}`;
}

/** Why comms can't start on this device, or "" if it can. */
export function cannotJoin(env: { isWeb: boolean; boothScreen: boolean; secure: boolean; hasMic: boolean; signedIn: boolean }): string {
  if (!env.isWeb || env.boothScreen) return "Comms runs on phones and tablets, never on the booth computer.";
  if (!env.signedIn) return "Sign in first: comms uses your crew name.";
  if (!env.secure || !env.hasMic)
    return "Comms needs the microphone, and phones only allow that on the secure (https) address. Open ProDeck from that address to use comms.";
  return "";
}

// ---------------------------------------------------------------- engine

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** Their voice. Enabled only while they talk on a line this phone hears. */
  track: MediaStreamTrack | null;
  /** ICE candidates that arrived before the other side's description. */
  pending: RTCIceCandidateInit[];
  created: number;
}

type Signal = { from: string; to: string; data: SignalData };
/**
 * Set-up messages that arrive while joining. The phone already on comms dials
 * the moment the booth announces a newcomer, which can be before the
 * newcomer's own join has come back with its id. Dropping that offer left the
 * pair with no call and nothing to retry it.
 */
let early: Signal[] = [];

let snap: CommsSnapshot = {
  state: "off",
  err: "",
  me: "",
  roster: { channels: [], members: [] },
  listen: readList(LISTEN_KEY, DEFAULT_LISTEN),
  talkOn: readStr(TALK_KEY, "All"),
  openMic: readStr(OPEN_KEY, "") === "1",
  talking: false,
  linked: [],
  links: {},
  unreachable: [],
};
const subs = new Set<() => void>();
const peers = new Map<string, Peer>();
let mic: MediaStream | null = null;
let beat: ReturnType<typeof setInterval> | null = null;
let dials: ReturnType<typeof setInterval> | null = null;
let unsubs: (() => void)[] = [];

function set(p: Partial<CommsSnapshot>) {
  snap = { ...snap, ...p };
  subs.forEach((f) => f());
}

export function commsSnapshot(): CommsSnapshot {
  return snap;
}

export function onComms(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

const session = () => {
  try {
    return localStorage.getItem(CREW_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
};

export function joinBlocker(): string {
  if (IS_DEMO) return "";
  return cannotJoin({
    isWeb: IS_WEB,
    boothScreen: isBoothScreen(IS_WEB, typeof location === "undefined" ? "" : location.hostname),
    secure: typeof window !== "undefined" && window.isSecureContext,
    hasMic: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    signedIn: !!session(),
  });
}

export async function joinComms() {
  if (snap.state !== "off") return;
  const why = joinBlocker();
  if (why) return set({ err: why });
  set({ state: "joining", err: "" });
  if (!IS_DEMO) try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // Silent until Talk is held.
    mic.getAudioTracks().forEach((t) => (t.enabled = false));
  } catch {
    return set({ state: "off", err: "The microphone was blocked. Allow it for this site in the phone's settings, then try again." });
  }
  unsubs.push(await on<IntercomRoster>("intercom:roster", (r) => r && applyRoster(r)));
  early = [];
  unsubs.push(
    await on<Signal>("intercom:signal", (m) => {
      if (!m) return;
      if (snap.state === "joining") early.push(m);
      else if (m.to === snap.me) void onSignal(m.from, m.data);
    }),
  );
  try {
    const r = await intercomJoin(session(), snap.listen);
    set({ state: "on", me: r.me });
    applyRoster(r.roster);
    const held = early.filter((m) => m.to === r.me);
    early = [];
    for (const m of held) await onSignal(m.from, m.data);
  } catch (e) {
    await leaveComms();
    return set({ err: `Couldn't join comms: ${String((e as Error)?.message ?? e)}` });
  }
  beat = setInterval(heartbeat, HEARTBEAT_MS);
  dials = setInterval(checkDials, 3_000);
  document.addEventListener("visibilitychange", onVisible);
}

export async function leaveComms() {
  if (beat) clearInterval(beat);
  beat = null;
  if (dials) clearInterval(dials);
  dials = null;
  document.removeEventListener("visibilitychange", onVisible);
  unsubs.forEach((u) => u());
  unsubs = [];
  for (const id of [...peers.keys()]) closePeer(id);
  mic?.getTracks().forEach((t) => t.stop());
  mic = null;
  const was = snap.state;
  set({ state: "off", talking: false, linked: [], links: {}, unreachable: [], roster: { channels: [], members: [] } });
  if (was !== "off") await intercomLeave(session()).catch(() => {});
}

/** Hold-to-talk. The mic opens here, before the booth hears about it, so the first word isn't clipped. */
export function talk(on: boolean) {
  if (snap.state !== "on" || on === snap.talking) return;
  mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  set({ talking: on });
  intercomTalk(session(), on ? snap.talkOn : null).catch(() => {});
}

/** Open mic on or off. Turning it on starts muted; turning it off closes the mic. */
export function setOpenMic(on: boolean) {
  writeStr(OPEN_KEY, on ? "1" : "");
  set({ openMic: on });
  if (!on) talk(false);
}

/** Open mic's Mute button: the mic is either live on your line or closed. */
export function toggleMute() {
  talk(!snap.talking);
}

export function setTalkLine(line: string) {
  writeStr(TALK_KEY, line);
  set({ talkOn: line });
  // Switching lines mid-sentence moves the sentence.
  if (snap.talking) intercomTalk(session(), line).catch(() => {});
}

export function setListening(line: string, on: boolean) {
  const listen = on ? [...new Set([...snap.listen, line])] : snap.listen.filter((l) => l !== line);
  writeList(LISTEN_KEY, listen);
  set({ listen });
  applyAudible();
  if (snap.state === "on") intercomJoin(session(), listen).catch(() => {});
}

/**
 * Redial anything that never came up: a lost offer or answer otherwise leaves
 * a pair silent for good. Closing both ends is safe: the offering side dials
 * again from the roster, and a fresh offer replaces whatever the other side had.
 */
function checkDials() {
  if (snap.state !== "on") return;
  const now = Date.now();
  let closed = false;
  for (const [id, p] of peers) {
    if (p.pc.connectionState !== "connected" && now - p.created > DIAL_TIMEOUT_MS) {
      closePeer(id);
      closed = true;
      if (!snap.unreachable.includes(id)) set({ unreachable: [...snap.unreachable, id] });
    }
  }
  if (closed) applyRoster(snap.roster);
}

function heartbeat() {
  intercomJoin(session(), snap.listen)
    .then((r) => {
      applyRoster(r.roster);
      // An open mic outlives the booth's memory of it (a booth restart, a
      // phone that dropped off and rejoined). Say it again, or everyone else
      // switches this phone off while it is still talking.
      const mine = r.roster.members.find((m) => m.id === snap.me);
      const want = snap.talking ? snap.talkOn : null;
      if (mine && (mine.talk ?? null) !== want) intercomTalk(session(), want).catch(() => {});
    })
    .catch(() => {});
}

// iOS suspends a backgrounded page: on return, check in at once and redo any
// connection that died meanwhile.
function onVisible() {
  if (document.visibilityState !== "visible" || snap.state !== "on") return;
  for (const [id, p] of peers) {
    if (p.pc.connectionState === "failed" || p.pc.connectionState === "closed") closePeer(id);
  }
  heartbeat();
}

function applyRoster(r: IntercomRoster) {
  set({ roster: r });
  if (snap.state !== "on") return;
  // The demo has nobody to call: show everyone as connected.
  if (IS_DEMO) return set({ linked: r.members.map((m) => m.id).filter((id) => id !== snap.me) });
  const plan = reconcile(r.members, snap.me, [...peers.keys()]);
  plan.close.forEach(closePeer);
  plan.offer.forEach((id) => void offerTo(id));
  applyAudible();
}

function applyAudible() {
  const hear = audibleIds(snap.roster.members, snap.me, snap.listen);
  for (const [id, p] of peers) {
    if (p.track) p.track.enabled = hear.includes(id);
    if (p.audio.paused && p.audio.srcObject) p.audio.play().catch(() => {});
  }
}

type SignalData = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

function newPeer(id: string): Peer {
  // No STUN or TURN: comms is for phones on the church network, and host
  // candidates are all two phones on one network need.
  const pc = new RTCPeerConnection({ iceServers: [] });
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  // In the page, not floating: Safari is more willing to play a call's audio
  // from an element that is actually in the document.
  audio.style.display = "none";
  document.body.appendChild(audio);
  const peer: Peer = { pc, audio, track: null, pending: [], created: Date.now() };
  mic?.getAudioTracks().forEach((t) => pc.addTrack(t, mic!));
  pc.ontrack = (e) => {
    peer.track = e.track;
    e.track.enabled = false; // silent until they talk on a line we hear
    audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    audio.play().catch(() => {});
    applyAudible();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) intercomSignal(session(), id, { ice: e.candidate.toJSON() }).catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    const linked = new Set(snap.linked);
    if (st === "connected") linked.add(id);
    else linked.delete(id);
    set({
      linked: [...linked],
      links: { ...snap.links, [id]: st },
      unreachable: st === "connected" ? snap.unreachable.filter((x) => x !== id) : snap.unreachable,
    });
    // The offering side redials a connection that failed; the roster decides
    // whether the other person is still there to dial.
    if (st === "failed") {
      closePeer(id);
      if (shouldOffer(snap.me, id)) setTimeout(() => snap.state === "on" && applyRoster(snap.roster), 2_000);
    }
  };
  peers.set(id, peer);
  set({ links: { ...snap.links, [id]: "new" } });
  return peer;
}

function closePeer(id: string) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  p.pc.onconnectionstatechange = null;
  p.pc.close();
  p.audio.srcObject = null;
  p.audio.remove();
  const links = { ...snap.links };
  // A failure stays on screen until the redial replaces it.
  if (links[id] !== "failed") delete links[id];
  set({ linked: snap.linked.filter((x) => x !== id), links });
}

async function offerTo(id: string) {
  const p = newPeer(id);
  try {
    const offer = await p.pc.createOffer({ offerToReceiveAudio: true });
    await p.pc.setLocalDescription(offer);
    await intercomSignal(session(), id, { sdp: p.pc.localDescription?.toJSON() });
  } catch {
    closePeer(id);
  }
}

async function onSignal(from: string, data: SignalData) {
  if (snap.state !== "on" || !data) return;
  try {
    if (data.sdp?.type === "offer") {
      // A fresh offer replaces whatever was there: the other phone redialled.
      closePeer(from);
      const p = newPeer(from);
      await p.pc.setRemoteDescription(data.sdp);
      await flushPending(p);
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      await intercomSignal(session(), from, { sdp: p.pc.localDescription?.toJSON() });
    } else if (data.sdp?.type === "answer") {
      const p = peers.get(from);
      if (!p || p.pc.signalingState !== "have-local-offer") return;
      await p.pc.setRemoteDescription(data.sdp);
      await flushPending(p);
    } else if (data.ice) {
      const p = peers.get(from);
      if (!p) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(() => {});
      else p.pending.push(data.ice);
    }
  } catch {
    closePeer(from);
  }
}

async function flushPending(p: Peer) {
  const list = p.pending.splice(0);
  for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
}

// ---------------------------------------------------------------- storage

function readList(k: string, d: string[]): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : d;
  } catch {
    return d;
  }
}
function writeList(k: string, v: string[]) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private window */
  }
}
function readStr(k: string, d: string): string {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
}
function writeStr(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window */
  }
}
