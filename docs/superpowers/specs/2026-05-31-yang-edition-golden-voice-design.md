# Yang's Edition — golden-voice — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) — ready for implementation planning
**Author:** Yan + Claude

## Summary

Add a `yang` edition to Wordul built around **golden-voice** (the local, offline XTTS
voice-clone engine in `~/golden-cloud/blocks/golden-voice`). The edition gives the game a
cloned-voice companion that says cheeky/fun lines as you play, plus a **live human voice
chat** so friends racing the same Wordle can talk to each other.

This is **sub-project #1** of a larger arc. Explicitly deferred (not in this spec):
- **Yang-as-live-commentator** — the cloned voice joining the live conversation as host.
- **Bring-Your-Own-Voice rooms** — anyone clones their voice, shares a link, friends play with "them."
- **Songs / hundreds of pre-generated voice memos / admin tone parameters.**

The design keeps those future pieces slot-in-able but builds none of them now.

## Why this is feasible today

The companion system already exists. `companionReact(event, ctx)` in `public/edition.js`
fires on `invalid | wrong | win | loss | idle` and returns `{ text, speak }`. There is a
literal extension point at `public/app.js:561`:

```js
if (speak && window.speechSynthesis) {
  // VOICE: swap speechSynthesis for cloned-voice audio here later
  try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) {}
}
```

So "cloned voice" is mostly: a `yang` edition with rich line banks + real audio clips
replacing `speechSynthesis`.

## Architecture

Two **independent** subsystems under the `yang` edition. They share only the audio output
stage; build and ship separately.

```
Subsystem A: Cloned-voice companion        Subsystem B: Live human voice chat
─────────────────────────────────         ──────────────────────────────────
build-time (Mac, offline)                  runtime only (browser + Room DO)
gv export -> public/voice/yang/*.opus      getUserMedia -> RTCPeerConnection mesh
manifest.json (sha1(text) -> file)         signaling relayed via Room WebSocket
                       \                   /
                        runtime audio output (browser <audio>)
```

**Decision (live-chat transport):** WebRTC **mesh**, ICE = Google STUN + Cloudflare TURN.
Best for friend-sized rooms (≤~4). No media server, no per-minute cost, lowest latency.
Rejected: Cloudflare Realtime SFU (overkill), mesh-with-STUN-only (silent NAT failures).

---

## Subsystem A — Cloned-voice companion

### Build-time pipeline (runs on Yan's Mac, fully offline)

- New `scripts/voice/render.mjs`.
- Reads the `yang` edition's `companion.lines` (all events, all lines).
- For each line, computes `sha1(text)`; if `public/voice/yang/<sha1>.opus` is missing, runs
  `gv export <sha1> "<text>"` (golden-voice) and writes the clip there.
- Writes `public/voice/yang/manifest.json` = `{ "<sha1(text)>": "<sha1>.opus" }`.
- **Idempotent** — re-running only renders new/changed lines.
- Clips + manifest are **committed to git** (served as static assets via the existing
  `ASSETS` binding). No runtime infra, no API keys, free.
- Prerequisite: golden-voice installed and a `yang` voice profile recorded (`gv record me`)
  + daemon running (`bash tts-daemon.sh start`). Documented in the script header.

### Runtime playback (browser)

- New `public/voice.js`:
  - `speakLine(editionId, text)` → fetch (cached) the edition's manifest, look up
    `sha1(text)`; if found and not muted, play via a single reused `<audio>` element;
    else fall back to `speechSynthesis`. Missing manifest/clip → text-only path, **never
    silent**.
  - Returns a handle so the existing mute toggle and future live controls (pause/stop/2×)
    can hook in.
- `public/app.js:561` swaps the inline `speechSynthesis` call for `speakLine(...)`,
  preserving the existing mute (`wordul.muted`) check.

### The `yang` edition

- New `public/editions/yang.js`, registered in `public/editions/index.js`.
- Yang palette + fonts + `sound.voice.on = true`.
- **Big cheeky line banks** for `invalid | wrong | win | loss | idle` (warm, cheeky,
  joy-sparking; cringe forbidden — per the writing rules).
- **Idle taunts:** a timer in `app.js`, reset on any keypress/guess, fires
  `companionReact('idle')` after ~20s of silence, cycling a large random idle bank
  ("You still there?", "I've seen glaciers move faster.").

### A — errors / edge cases

- Missing clip or manifest → `speechSynthesis` fallback (never silent).
- Muted → no audio, text still shows.
- speechSynthesis unavailable → text-only.

---

## Subsystem B — Live human voice chat

### Signaling (reuses the existing Room WebSocket)

- Add 3 relayed message types to `src/room.ts`: `rtc-offer`, `rtc-answer`, `rtc-ice`,
  each `{ to: peerId, from: peerId, payload }`. The Room DO forwards to the target peer's
  socket. No new endpoint, no stored state. (Room DO already tracks sockets + presence.)

### Client (`public/voice-chat.js`)

- **Room setting "Voice chat"** in pre-game settings, **on by default** (host can disable).
- **On join (if voice on):** the mic permission prompt fires on the player's **first
  gesture** (entering the room / starting) — not on cold page load (browsers block that).
- **On grant:** player is in the channel **muted**; a prominent "🎙 tap to talk" toggles
  transmit (disable/enable local track). **Decision:** join-muted, tap-to-talk (not hot mic).
- **Peering:** for each other present peer, create an `RTCPeerConnection` (mesh), ICE =
  Google STUN + Cloudflare TURN; exchange offer/answer/ICE over the room socket. Remote
  tracks attach to hidden `<audio autoplay>` elements.
- **Presence-driven:** peer join/leave (existing presence events) spins up / tears down
  connections.
- **Indicator:** "🔊 {name} is talking" via WebRTC audio-level / speaking detection.
- **Controls:** mute toggle, leave (close peers + stop mic tracks).

### B — errors / edge cases

- **Mic denied → never a dead end:** stay in text mode; a persistent "🎙 Enable mic" button
  re-requests later (with a hint to unblock if the browser remembered the denial). Never
  silent-fail.
- TURN/connection fail for one peer → surface "couldn't connect to {name}", keep other
  peers working.
- **Mesh cap:** spin up connections only for ≤4 present peers; beyond that show "live chat
  is best with ≤4" and skip extras — `log`/comment the cap, do **not** silently drop.
- Companion (Subsystem A) keeps playing over live chat for now; **ducking under live voices
  is deferred** with the Yang-commentator feature.

---

## Testing

- **A (unit, vitest):** manifest lookup, `sha1` keying, fallback-when-missing, mute respected.
- **B (unit, vitest):** `src/room.ts` relay forwards `rtc-*` to the correct target socket
  and to no one else.
- **B (manual, `/run`):** two browsers, grant mic, confirm two-way audio + tap-to-talk +
  denial recovery.

## Phasing

Two specs/plans, sequenced:
1. **Ship Subsystem A first** — self-contained, no infra, zero deploy risk.
2. **Then Subsystem B** — WebRTC + signaling.

Designed so the deferred pieces (Yang commentator, BYO-voice rooms, songs) slot in later
without rework.
