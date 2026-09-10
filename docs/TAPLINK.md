# TapLink — NFC discs that follow the service

**What it is.** NFC discs in your lobby all open one link. That link's
destination changes with the service: giving while the giving slide is up,
sermon notes during the message, your connect card the rest of the time. Taps
are counted, so you can see what people actually reached for.

**What you need.** A free Cloudflare account, a computer with Node.js to deploy
from (once), and NFC discs (NTAG213 or better). Nothing on the booth computer
beyond ProDeck.

## How it fits together

```
  ProPresenter ──slide notes "tap:give"──▶ ProDeck ──▶ your edge (Cloudflare)
                                                            ▲
                                        disc tap  ─────────┘  302 → the right link
```

- **ProDeck** watches the live slide. When its notes contain `tap:<keyword>`,
  ProDeck tells the edge that keyword is live.
- **The edge** is a small web service you deploy to Cloudflare. It holds the
  keyword → URL table, the current state, and the tap counts.
- **The discs** are written once with `https://<your-edge>/now` and never
  again. All the intelligence is on the edge.

## Setting it up

**Settings → TapLink** in ProDeck walks you through these with copyable
commands.

1. **Deploy your edge** — see [taplink-edge/README.md](../taplink-edge/README.md).
   You end up with an Edge URL and an API token.
2. **Connect ProDeck** — paste both into Settings → TapLink, **Save & test
   connection**.
3. **Set your links** — Keywords & links on the same card. Start with `give`,
   `connect`, `prayer` and a default. Every URL is yours.
4. **Write the discs** — one URL, every disc: your Edge URL + `/now`.
5. **Tag your slides** — put `tap:give` in the notes of the giving slide, and so
   on. Arm **Follow slides** on the TapLink card.

## What each setting does

| Setting | Meaning |
|---|---|
| **Follow slides** | Arms the watcher. Off = ProDeck stops retargeting the discs, but the links stay editable and the discs keep working at whatever they last pointed to. |
| **Edge URL** | Your worker's address, e.g. `https://taplink-edge.you.workers.dev` or `https://go.yourchurch.org`. |
| **API token** | The `TAPLINK_TOKEN` secret you created at deploy. Only ProDeck and you know it. |
| **Keywords & links** | Keyword → URL, an optional per-keyword timer, and the default. Stored on the edge. |
| **ttl_minutes** | How long a keyword stays live with no new slide before falling back to the default. `give` defaults to 15; everything else to 180. |

## Overriding by hand

The **TapLink** widget has a button per keyword: press one to pin the discs
there regardless of the slides, **Resume** to hand control back. The edge's own
page at `<Edge URL>/admin/<ADMIN_KEY>` has the same buttons and works when the
booth computer is off — save it to the booth phone's home screen.

## Things worth knowing

- Renaming or removing a keyword doesn't change any ProPresenter slide. A slide
  still tagged with the old word stops switching until you re-tag it.
- Tap counts are anonymous: a count and a time, nothing about the phone.
- The token is what lets ProDeck retarget every disc in your building. Treat it
  like a password. Rotate it with `npx wrangler secret put TAPLINK_TOKEN` and
  paste the new value into ProDeck.
