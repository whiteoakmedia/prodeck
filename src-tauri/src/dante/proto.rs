//! Dante's control protocol ("ARC"), the READ queries only.
//!
//! Layout per the public-domain NetAudio project (netaudio-core protocol.rs,
//! parser.rs, commands/): a request is `protocol id (0x27FF) · total length ·
//! message id · opcode · body`, big-endian; a reply adds a result code at 8,
//! and every string is a NUL-terminated UTF-8 at an ABSOLUTE u16 offset from
//! the start of the datagram.
//!
//! `send` refuses anything outside `READ_OPCODES`. The mutating opcodes —
//! 0x1001 rename (one bit from 0x1002!), 0x2013/0x3001 channel renames,
//! 0x3010/0x3014 subscribe/unsubscribe, 0x1101, 0x1f01, flows — and the
//! 0xFFFF "settings" and 0x1200 CMC families are never built here.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::Duration;
use tokio::net::UdpSocket;

pub const ARC_SERVICE: &str = "_netaudio-arc._udp.local.";
const PROTOCOL: u16 = 0x27FF;
const ACCEPT_PROTOCOLS: [u16; 3] = [0x27FF, 0x2729, 0x2809];

pub const OP_CHANNEL_COUNT: u16 = 0x1000;
pub const OP_DEVICE_NAME: u16 = 0x1002;
pub const OP_DEVICE_INFO: u16 = 0x1003;
pub const OP_TX_CHANNELS: u16 = 0x2000;
pub const OP_TX_NAMES: u16 = 0x2010;
pub const OP_RX_CHANNELS: u16 = 0x3000;
/// The only opcodes this program can send.
pub const READ_OPCODES: [u16; 6] = [OP_CHANNEL_COUNT, OP_DEVICE_NAME, OP_DEVICE_INFO, OP_TX_CHANNELS, OP_TX_NAMES, OP_RX_CHANNELS];

const RESULT_OK: u16 = 0x0001;
const RESULT_MORE: u16 = 0x8112;
const RX_PER_PAGE: u16 = 16;
const TX_PER_PAGE: u16 = 32;

static MSG_ID: AtomicU16 = AtomicU16::new(1);

pub fn build(opcode: u16, body: &[u8]) -> Result<Vec<u8>, String> {
    if !READ_OPCODES.contains(&opcode) {
        return Err(format!("opcode 0x{opcode:04x} is not a read query — refused"));
    }
    let mut id = MSG_ID.fetch_add(1, Ordering::Relaxed);
    if id == 0 {
        id = MSG_ID.fetch_add(1, Ordering::Relaxed);
    }
    let len = (8 + body.len()) as u16;
    let mut p = Vec::with_capacity(len as usize);
    p.extend_from_slice(&PROTOCOL.to_be_bytes());
    p.extend_from_slice(&len.to_be_bytes());
    p.extend_from_slice(&id.to_be_bytes());
    p.extend_from_slice(&opcode.to_be_bytes());
    p.extend_from_slice(body);
    Ok(p)
}

/// `00 00 00 01 SS SS EE EE` — a page starting at `start` (1-based).
fn page_body(start: u16, end: u16) -> [u8; 8] {
    let mut b = [0u8; 8];
    b[3] = 0x01;
    b[4..6].copy_from_slice(&start.to_be_bytes());
    b[6..8].copy_from_slice(&end.to_be_bytes());
    b
}

fn u16_at(p: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*p.get(o)?, *p.get(o + 1)?]))
}

/// The NUL-terminated string at absolute offset `ptr` (0 = none).
fn string_at(p: &[u8], ptr: u16, min: usize) -> Option<String> {
    let o = ptr as usize;
    if ptr == 0 || o < min || o >= p.len() {
        return None;
    }
    let end = p[o..].iter().position(|&b| b == 0).map(|i| o + i).unwrap_or(p.len());
    Some(String::from_utf8_lossy(&p[o..end]).to_string())
}

/// Check a reply's envelope against what we sent; its result code.
pub fn check_reply(req: &[u8], rep: &[u8]) -> Result<u16, String> {
    if rep.len() < 10 {
        return Err("short reply".into());
    }
    let proto = u16_at(rep, 0).unwrap();
    if !ACCEPT_PROTOCOLS.contains(&proto) {
        return Err(format!("unexpected protocol 0x{proto:04x}"));
    }
    if u16_at(rep, 2).unwrap() as usize != rep.len() {
        return Err("reply length mismatch".into());
    }
    if rep[4..6] != req[4..6] || rep[6..8] != req[6..8] {
        return Err("reply for a different request".into());
    }
    Ok(u16_at(rep, 8).unwrap())
}

async fn send(sock: &UdpSocket, to: SocketAddr, opcode: u16, body: &[u8]) -> Result<(Vec<u8>, u16), String> {
    let req = build(opcode, body)?;
    let mut buf = vec![0u8; 4096];
    for _ in 0..3 {
        sock.send_to(&req, to).await.map_err(|e| e.to_string())?;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(1000);
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                break;
            }
            match tokio::time::timeout(left, sock.recv_from(&mut buf)).await {
                Ok(Ok((n, from))) if from.ip() == to.ip() => {
                    let rep = buf[..n].to_vec();
                    match check_reply(&req, &rep) {
                        Ok(code) => return Ok((rep, code)),
                        Err(_) => continue, // a stale reply to an earlier try
                    }
                }
                Ok(Ok(_)) => continue,
                Ok(Err(e)) => return Err(e.to_string()),
                Err(_) => break,
            }
        }
    }
    Err("no reply".into())
}

#[derive(Debug, Clone)]
pub struct Rx {
    pub ch: u16,
    pub name: String,
    pub tx_channel: Option<String>,
    pub tx_device: Option<String>,
    pub rx_status: u16,
    pub sub_status: u16,
}
impl Rx {
    pub fn ok(&self) -> bool {
        matches!(self.sub_status, 0x0004 | 0x0009 | 0x000a | 0x000e) || (self.sub_status == 0x0001 && self.rx_status == 0x0101)
    }
    pub fn status_text(&self) -> String {
        let s = match self.sub_status {
            0x0000 => "No subscription",
            0x0001 if self.rx_status == 0x0101 => "Connected",
            0x0001 => "Unresolved",
            0x0002 => "Resolved",
            0x0003 => "Can't resolve",
            0x0004 => "Connected (self)",
            0x0005 => "Channel not on the network",
            0x0007 => "Idle",
            0x0008 => "Connecting",
            0x0009 | 0x000a | 0x000e => "Connected",
            0x000f => "No connection",
            0x0010 => "Wrong channel format",
            0x0011 => "Wrong bundle format",
            0x0012 | 0x0013 => "Receiver failed",
            0x0014 | 0x0015 => "Transmitter failed",
            0x0016 | 0x0017 => "QoS failure",
            0x0018 => "Transmitter rejected address",
            0x001a => "Latency too low",
            0x001b => "Different clock domain",
            0x001c => "Unsupported",
            0x001d => "Receive link down",
            0x001e => "Transmit link down",
            0x0020 => "Invalid channel",
            0x0023 => "Transmitter not ready",
            0x0024 => "Receiver not ready",
            0x0025 => "Transmitter out of flows",
            0x00ff => "System failure",
            _ => return format!("Status 0x{:04x}", self.sub_status),
        };
        s.to_string()
    }
}

#[derive(Debug, Clone)]
pub struct Tx {
    pub ch: u16,
    pub name: String,
}

#[derive(Debug, Default)]
pub struct Device {
    pub name: Option<String>,
    pub model: Option<String>,
    pub tx_count: u16,
    pub rx_count: u16,
    pub rx: Vec<Rx>,
    pub tx: Vec<Tx>,
    pub error: Option<String>,
}

pub fn parse_name(rep: &[u8]) -> Option<String> {
    string_at(rep, 10, 10)
}

pub fn parse_counts(rep: &[u8]) -> Option<(u16, u16)> {
    Some((u16_at(rep, 12)?, u16_at(rep, 14)?))
}

/// One page of receive channels (body: max, count, then 20-byte records).
pub fn parse_rx_page(rep: &[u8], start: u16) -> Result<Vec<Rx>, String> {
    let count = *rep.get(11).ok_or("short page")? as usize;
    let min = 12 + 20 * count;
    let mut out = vec![];
    for i in 0..count {
        let r = 12 + 20 * i;
        let ch = u16_at(rep, r).ok_or("short record")?;
        if ch != start + i as u16 {
            return Err(format!("unexpected channel {ch} in the page from {start}"));
        }
        let name = string_at(rep, u16_at(rep, r + 10).unwrap_or(0), min).unwrap_or_default();
        let sub_status = u16_at(rep, r + 14).unwrap_or(0);
        let (mut tx_channel, mut tx_device) = (None, None);
        if sub_status != 0 {
            tx_device = string_at(rep, u16_at(rep, r + 8).unwrap_or(0), min);
            let p = u16_at(rep, r + 6).unwrap_or(0);
            tx_channel = if p != 0 { string_at(rep, p, min) } else { Some(name.clone()) };
        }
        out.push(Rx { ch, name, tx_channel, tx_device, rx_status: u16_at(rep, r + 12).unwrap_or(0), sub_status });
    }
    Ok(out)
}

/// One page of transmit channels (8-byte records: channel · … · name pointer).
pub fn parse_tx_page(rep: &[u8]) -> Vec<Tx> {
    let mut out = vec![];
    let count = rep.get(11).copied().unwrap_or(0) as usize;
    let alt = rep.get(10) == Some(&0) && count == 0;
    let n = if alt { 64 } else { count };
    let min = 12 + 8 * count;
    for i in 0..n {
        let r = 12 + 8 * i;
        let Some(ch) = u16_at(rep, r) else { break };
        if ch == 0 {
            break;
        }
        if let Some(name) = string_at(rep, u16_at(rep, r + 6).unwrap_or(0), if alt { 12 } else { min }) {
            out.push(Tx { ch, name });
        }
    }
    out
}

/// Renamed transmit channels only (6-byte records: … · channel · name pointer).
pub fn parse_tx_names(rep: &[u8]) -> Vec<Tx> {
    let mut count = rep.get(11).copied().unwrap_or(0) as usize;
    if rep.get(10) == Some(&0) && count == 0 {
        // Alternate form: the records run up to the first name.
        let first = u16_at(rep, 16).unwrap_or(0) as usize;
        count = first.saturating_sub(12) / 6;
    }
    let min = 12 + 6 * count;
    (0..count)
        .filter_map(|i| {
            let r = 12 + 6 * i;
            let ch = u16_at(rep, r + 2)?;
            let name = string_at(rep, u16_at(rep, r + 4)?, min.min(rep.len()))?;
            (ch != 0).then_some(Tx { ch, name })
        })
        .collect()
}

pub async fn read_all(addr: SocketAddr) -> Result<Device, String> {
    let bind: SocketAddr = if addr.is_ipv4() { "0.0.0.0:0".parse().unwrap() } else { "[::]:0".parse().unwrap() };
    let sock = UdpSocket::bind(bind).await.map_err(|e| e.to_string())?;
    let mut d = Device::default();
    let (rep, _) = send(&sock, addr, OP_DEVICE_NAME, &[0, 0]).await?;
    d.name = parse_name(&rep);
    let (rep, _) = send(&sock, addr, OP_CHANNEL_COUNT, &[0, 0]).await?;
    let (tx, rx) = parse_counts(&rep).ok_or("bad channel-count reply")?;
    d.tx_count = tx;
    d.rx_count = rx;
    let mut errs = vec![];
    // Receive channels, 16 a page.
    let mut start = 1u16;
    while start <= rx {
        match send(&sock, addr, OP_RX_CHANNELS, &page_body(start, 0)).await {
            Ok((rep, code)) if code == RESULT_OK || code == RESULT_MORE => match parse_rx_page(&rep, start) {
                Ok(page) => {
                    let short = page.len() < RX_PER_PAGE as usize;
                    d.rx.extend(page);
                    if short {
                        break;
                    }
                }
                Err(e) => {
                    errs.push(format!("receive channels: {e}"));
                    break;
                }
            },
            Ok((_, code)) => {
                errs.push(format!("receive channels: result 0x{code:04x}"));
                break;
            }
            Err(e) => {
                errs.push(format!("receive channels: {e}"));
                break;
            }
        }
        start += RX_PER_PAGE;
    }
    // Transmit channels: factory names by page, then the renamed ones on top.
    let mut start = 1u16;
    while start <= tx {
        match send(&sock, addr, OP_TX_CHANNELS, &page_body(start, 0)).await {
            Ok((rep, code)) if code == RESULT_OK || code == RESULT_MORE => {
                let page = parse_tx_page(&rep);
                let short = page.len() < TX_PER_PAGE as usize;
                d.tx.extend(page);
                if short {
                    break;
                }
            }
            _ => break,
        }
        start += TX_PER_PAGE;
    }
    if tx > 0 {
        if let Ok((rep, code)) = send(&sock, addr, OP_TX_NAMES, &page_body(1, tx)).await {
            if code == RESULT_OK || code == RESULT_MORE {
                for t in parse_tx_names(&rep) {
                    match d.tx.iter_mut().find(|x| x.ch == t.ch) {
                        Some(x) => x.name = t.name,
                        None => d.tx.push(t),
                    }
                }
            }
        }
    }
    d.tx.sort_by_key(|t| t.ch);
    if !errs.is_empty() {
        d.error = Some(errs.join("; "));
    }
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_only_read_queries() {
        let p = build(OP_RX_CHANNELS, &page_body(1, 0)).unwrap();
        assert_eq!(&p[0..4], &[0x27, 0xFF, 0x00, 0x10]);
        assert_eq!(&p[6..], &[0x30, 0x00, 0, 0, 0, 1, 0, 1, 0, 0]);
        for bad in [0x1001u16, 0x3010, 0x3014, 0x2013, 0x3001, 0x1101, 0x1f01] {
            assert!(build(bad, &[0, 0]).is_err(), "0x{bad:04x} must be refused");
        }
    }

    #[test]
    fn parses_a_device_name_reply() {
        let mut rep = vec![0x27, 0xFF, 0x00, 0x16, 0x9E, 0x7F, 0x10, 0x02, 0x00, 0x01];
        rep.extend(b"avio-aes3-1\0");
        assert_eq!(parse_name(&rep).as_deref(), Some("avio-aes3-1"));
        let req = [0x27, 0xFF, 0x00, 0x0a, 0x9E, 0x7F, 0x10, 0x02, 0, 0];
        assert_eq!(check_reply(&req, &rep), Ok(RESULT_OK));
    }

    #[test]
    fn parses_a_receive_page() {
        // Two records: rx 1 "01" ← "Kick" @ "FOH-Console", rx 2 "02" unsubscribed.
        let mut rep = vec![0x27, 0xFF, 0, 0, 0, 1, 0x30, 0x00, 0x00, 0x01, 2, 2];
        let strings_at = 12 + 40;
        let s1 = strings_at as u16; // "01"
        let s2 = s1 + 3; // "Kick"
        let s3 = s2 + 5; // "FOH-Console"
        let s4 = s3 + 12; // "02"
        let rec = |ch: u16, txc: u16, txd: u16, name: u16, rxs: u16, sub: u16| {
            let mut r = vec![];
            for v in [ch, 0, 0, txc, txd, name, rxs, sub, 0, 0] {
                r.extend(v.to_be_bytes());
            }
            r
        };
        rep.extend(rec(1, s2, s3, s1, 0x0101, 0x0001));
        rep.extend(rec(2, 0, 0, s4, 0, 0));
        rep.extend(b"01\0Kick\0FOH-Console\002\0");
        let n = rep.len() as u16;
        rep[2..4].copy_from_slice(&n.to_be_bytes());
        let page = parse_rx_page(&rep, 1).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].tx_device.as_deref(), Some("FOH-Console"));
        assert_eq!(page[0].tx_channel.as_deref(), Some("Kick"));
        assert!(page[0].ok());
        assert_eq!(page[0].status_text(), "Connected");
        assert_eq!(page[1].name, "02");
        assert!(page[1].tx_device.is_none());
        assert_eq!(page[1].status_text(), "No subscription");
    }
}
