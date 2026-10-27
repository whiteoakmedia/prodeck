// A fake Blackmagic ATEM for testing clients without hardware.
// Speaks the UDP transport (hello, session ids, acks, resends, pings) and the handful of commands
// ProDeck uses: _ver _pin _top InPr PrgI PrvI TrPs InCm, and accepts CPgI CPvI DCut DAut.
//   node scripts/fake-atem.cjs [--port 9910] [--drop 0.0] [--quiet]
// Writes one JSON line per notable event to stdout ({ev: ...}) so a test can assert on it.
const dgram = require('dgram');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', 9910));
const DROP = Number(opt('--drop', 0)); // fraction of OUR outgoing data packets to "lose" (first send only)
const QUIET = args.includes('--quiet');
const log = (o) => { if (!QUIET || o.ev !== 'raw') process.stdout.write(JSON.stringify(o) + '\n'); };

const F = { AckRequest: 1, NewSessionId: 2, IsRetransmit: 4, RetransmitRequest: 8, AckReply: 16 };
const MAXID = 1 << 15;

const INPUTS = [
  [0, 'Black', 'BLK', 1, 0x1f],
  [1, 'Camera 1 Wide', 'CAM1', 0, 0x1f],
  [2, 'Camera 2 Pulpit', 'CAM2', 0, 0x1f],
  [3, 'Camera 3 Stage', 'CAM3', 0, 0x1f],
  [4, 'ProPresenter', 'PRO', 0, 0x1f],
  [1000, 'Color Bars', 'BARS', 2, 0x1f],
  [3010, 'Media Player 1', 'MP1', 4, 0x1f],
  [3011, 'Media Player 1 Key', 'MP1K', 5, 0x00], // keys aren't on the M/E bus
  [10010, 'Program', 'PGM', 128, 0x00], // outputs aren't either
];
const state = { program: 1, preview: 2, inTransition: false };

const sock = dgram.createSocket('udp4');
let client = null; // { addr, port, session, nextId, lastRecv, inflight: Map<id,{buf,sent}> }

function cmd(name, data) {
  const b = Buffer.alloc(8 + data.length);
  b.writeUInt16BE(8 + data.length, 0);
  b.write(name, 4, 4, 'ascii');
  data.copy(b, 8);
  return b;
}
const str = (s, n) => { const b = Buffer.alloc(n); b.write(s, 0, n - 1, 'utf8'); return b; };
function inPr([id, long, short, internal, meAvail]) {
  const d = Buffer.alloc(36);
  d.writeUInt16BE(id, 0);
  str(long, 20).copy(d, 2);
  str(short, 4).copy(d, 22);
  d.writeUInt8(1, 26);
  d.writeUInt16BE(internal === 0 ? 1 : 0, 28);
  d.writeUInt16BE(internal === 0 ? 1 : 0, 30);
  d.writeUInt8(internal, 32);
  d.writeUInt8(0x1f, 34);
  d.writeUInt8(meAvail, 35);
  return cmd('InPr', d);
}
const u16pair = (me, v) => { const d = Buffer.alloc(4); d.writeUInt8(me, 0); d.writeUInt16BE(v, 2); return d; };
const prgI = () => cmd('PrgI', u16pair(0, state.program));
const prvI = () => cmd('PrvI', u16pair(0, state.preview));
function trPs() {
  const d = Buffer.alloc(8); d.writeUInt8(0, 0); d.writeUInt8(state.inTransition ? 1 : 0, 1); d.writeUInt8(state.inTransition ? 25 : 0, 2); d.writeUInt16BE(0, 4);
  return cmd('TrPs', d);
}
function header(flags, len, session, ackId = 0, packetId = 0) {
  const b = Buffer.alloc(12);
  b.writeUInt16BE((flags << 11) | len, 0);
  b.writeUInt16BE(session, 2);
  b.writeUInt16BE(ackId, 4);
  b.writeUInt16BE(packetId, 10);
  return b;
}
function sendRaw(buf) { if (client) sock.send(buf, client.port, client.addr); }
function sendData(cmds) {
  if (!client) return;
  const payload = Buffer.concat(cmds);
  const id = client.nextId; client.nextId = (client.nextId + 1) % MAXID;
  const buf = Buffer.concat([header(F.AckRequest, 12 + payload.length, client.session, 0, id), payload]);
  client.inflight.set(id, { buf, sent: Date.now(), tries: 0 });
  if (DROP > 0 && Math.random() < DROP && payload.length > 0) { log({ ev: 'dropped', id }); return; }
  sendRaw(buf);
}

function dump() {
  const ver = Buffer.alloc(4); ver.writeUInt32BE(0x0002001e, 0); // protocol 2.30
  const pin = Buffer.alloc(44); str('ATEM Television Studio HD8', 40).copy(pin, 0); pin.writeUInt8(18, 40);
  const top = Buffer.alloc(24); top.writeUInt8(1, 0); top.writeUInt8(INPUTS.length, 1);
  sendData([cmd('_ver', ver), cmd('_pin', pin), cmd('_top', top)]);
  sendData(INPUTS.map(inPr));
  sendData([prgI(), prvI(), trPs()]);
  sendData([cmd('InCm', Buffer.alloc(4))]);
}

sock.on('message', (msg, r) => {
  if (msg.length < 12) return;
  const flags = msg.readUInt8(0) >> 3;
  const len = msg.readUInt16BE(0) & 0x07ff;
  if (len !== msg.length) { log({ ev: 'bad_length', len, got: msg.length }); return; }
  const session = msg.readUInt16BE(2);
  const remoteId = msg.readUInt16BE(10);

  if (flags & F.NewSessionId) {
    // Hello. Reply with our own NewSessionId packet on the client's session id.
    client = { addr: r.address, port: r.port, session, nextId: 1, lastRecv: 0, inflight: new Map(), established: false, newSession: 0x8000 | (Math.floor(Math.random() * 0x7fff)) };
    const reply = header(F.NewSessionId, 20, session, 0, 0);
    sendRaw(Buffer.concat([reply, Buffer.from([0x02, 0, 0, 0x01, 0, 0, 0, 0])]));
    log({ ev: 'hello', from: `${r.address}:${r.port}` });
    return;
  }
  if (!client) return;
  if (flags & F.AckReply) {
    const ackId = msg.readUInt16BE(4);
    if (!client.established) {
      // First ack: the session is up. Real switchers switch to a new session id here.
      client.established = true;
      client.session = client.newSession;
      log({ ev: 'established', session: client.session });
      dump();
      return;
    }
    for (const id of [...client.inflight.keys()]) {
      const d = (ackId - id + MAXID) % MAXID;
      if (d < MAXID / 2) client.inflight.delete(id);
    }
  }
  if (flags & F.AckRequest) {
    if (session !== client.session) log({ ev: 'wrong_session', got: session, want: client.session });
    sendRaw(header(F.AckReply, 12, client.session, remoteId, 0));
    if (remoteId === client.lastRecv) return; // a resend we've already applied
    client.lastRecv = remoteId;
    let p = msg.subarray(12);
    const changes = [];
    while (p.length >= 8) {
      const l = p.readUInt16BE(0);
      if (l < 8 || l > p.length) { log({ ev: 'bad_command_length', l }); break; }
      const name = p.toString('ascii', 4, 8);
      const d = p.subarray(8, l);
      log({ ev: 'cmd', name, hex: d.toString('hex') });
      if (name === 'CPgI') { state.program = d.readUInt16BE(2); changes.push(prgI()); }
      else if (name === 'CPvI') { state.preview = d.readUInt16BE(2); changes.push(prvI()); }
      else if (name === 'DCut') { [state.program, state.preview] = [state.preview, state.program]; changes.push(prgI(), prvI()); }
      else if (name === 'DAut') {
        state.inTransition = true; changes.push(trPs());
        setTimeout(() => { [state.program, state.preview] = [state.preview, state.program]; state.inTransition = false; sendData([prgI(), prvI(), trPs()]); log({ ev: 'state', ...state }); }, 400);
      }
      p = p.subarray(l);
    }
    if (changes.length) { sendData(changes); log({ ev: 'state', ...state }); }
  }
});

// Resend unacked data packets, and ping like a real switcher (empty AckRequest packets).
setInterval(() => {
  if (!client || !client.established) return;
  const now = Date.now();
  for (const [id, f] of client.inflight) {
    if (now - f.sent > 200) { f.sent = now; f.tries++; const b = Buffer.from(f.buf); b.writeUInt8(b.readUInt8(0) | (F.IsRetransmit << 3), 0); sendRaw(b); }
  }
}, 50);
setInterval(() => { if (client && client.established) sendData([]); }, 500);

// Let a test drive changes from the "panel" side: lines on stdin like {"program":3}
process.stdin.on('data', (b) => {
  for (const line of b.toString().split('\n').filter(Boolean)) {
    try { const o = JSON.parse(line); if (o.program) state.program = o.program; if (o.preview) state.preview = o.preview; sendData([prgI(), prvI()]); log({ ev: 'state', ...state }); } catch {}
  }
});

sock.bind(PORT, '127.0.0.1', () => log({ ev: 'listening', port: PORT }));
