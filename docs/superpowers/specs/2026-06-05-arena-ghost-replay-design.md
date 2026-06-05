# Arena Ghost Replay — "The race never closes"

**Date:** 2026-06-05
**Status:** approved direction, pending spec review
**Problem:** Sharing an arena room link is a guaranteed dead-end. Seeded arena rooms hold
exactly 1 human + N bots and auto-start the instant that human connects, so by the time a
friend clicks the shared link the seat is taken and they hit a red "room full" toast on an
empty board (`room.ts:427`). The OG card even promises "join and race on the same word" —
a promise the link cannot keep. Secondary problem: arena races start with zero ceremony —
no 3-2-1-GO, so it's unclear when the race begins.

**Core move:** compose with the existing challenge system (`/c/<id>` — isolated solo race
on a pinned word, unlimited visitors, standing record) instead of building a new mode. Then
make the late race *feel* live with ghost replays of the original field.

---

## Versions

| Version | Scope |
|---|---|
| **v1** | Challenge mint + handoff + share rewiring + arena 3-2-1 + ghost replay (tape record/playback) |
| **vX** | Voice commentary — mic on during race, voice track replays in sync |
| **vY** | Video replays — camera PiP during race, video replays in sync |

v1 ships first as one unit. vX/vY reuse v1's consent/upload/playback skeleton.

---

## v1.1 — Arena room mints a challenge at race start

- In `runStart`, when `state.seed` is set (seeded arena room) and the word is chosen, mint
  a challenge server→server to the `CHALLENGE` DO (the word never touches a client) and
  store the id in new room state field `shareChallengeId`.
- The existing `challengeId` field keeps its meaning untouched (it makes a room *play* a
  pinned word; `shareChallengeId` is the room *publishing* its own word). `playedMode()`
  and `isDuelRoom()` are unaffected.
- Challenge owner = the human racer's username (known at mint time — the human's hello is
  what triggers the start).
- Each rematch round picks a new word → mints a fresh challenge → overwrites
  `shareChallengeId`.
- When the human finishes, post their result as an attempt to `shareChallengeId` —
  mirroring the existing attempt-posting block at `room.ts:991`.
- Mint failure (DO hiccup): log, leave `shareChallengeId` null, everything degrades to
  today's behavior.

## v1.2 — "Room full" becomes a handoff

- The two seeded-room rejection paths in `onHello` (`room.ts:398`, `room.ts:427`) stop
  sending `error: "room full"` when `shareChallengeId` exists. Instead they send a new
  server message:
  `{ type: "arena_handoff", challengeId, host: "<human username>", hostDone: boolean }`.
- Client: on `arena_handoff`, route into the existing challenge flow (`showChallenge`)
  with a warm interstitial instead of a red toast:
  - host finished: *"@paul already raced this word — your turn."*
  - host mid-race: *"@paul is racing this word right now — race it too."*
- If `shareChallengeId` is null (mint failed / race never started with no human present —
  in which case the visitor just takes the seat normally), fall back to the current
  "room full" error. No new dead ends, one removed.

## v1.3 — Share buttons in seeded arena rooms share `/c/<id>`

- Post-game share surfaces (share card, invite/copy-link) in a seeded arena room use
  `${origin}/c/${shareChallengeId}` instead of the room URL when the id exists.
- Raw browser-URL copies (what actually happened in the field report) are covered by the
  v1.2 handoff — any arena room URL now delivers a playable race.
- OG meta for `/c/<id>` already exists ("Beat @paul's Wordul challenge").

## v1.4 — 3-2-1-GO for arena races

- The seeded auto-start block (`room.ts:517`) stops calling `runStart` directly and enters
  the existing countdown phase: stamp `goAt`, set `phase: "countdown"`, arm the DO alarm;
  the alarm flips the round live through `runStart` (the same machinery duel rooms use —
  the alarm handler and the restore guard at `room.ts:160` already exist; verify neither
  assumes duel-only invariants).
- The client 3-2-1 overlay (`app.js:3158`) keys off the phase transition + `goAt`, not off
  duel-ness — it fires for arena automatically.
- Bots must not type during countdown: the bot heartbeat is armed in `runStart`, which only
  runs when the countdown elapses, so this holds by construction.
- The late joiner's challenge race gets a tap-armed 3-2-1 too — but **only when ghost
  tapes exist** for that challenge. A plain challenge (no tapes) keeps today's instant
  board (`autoStart`, "no lobby ceremony"). The tap doubles as the audio-unlock gesture
  for vX/vY.

## v1.5 — Ghost tape: record

- During a seeded arena race the room DO appends every relayed race event to an in-memory
  tape per player: `{ t: msSinceGo, username, ev }` where `ev` is one of:
  - `typing` — row length pulse (captures every keystroke and backspace; length-only by
    existing design, `room.ts:891`)
  - `guess` — accepted guess as **color mask only** (no letters), mirroring what a live
    opponent sees
  - `finish` — status (`won`/`lost`) + guess count + elapsed
- Bots emit the same pulses (`room.ts:915`), so the tape captures the **entire field** —
  the late joiner races the inviter AND the bots, as it happened.
- Zero extra storage writes during the race (typing stays relay-only, preserving the
  deliberate design at `room.ts:917`). The tape persists **once**, at race end, posted to
  the Challenge DO (`POST /tape`, new endpoint) alongside the attempt.
- DO eviction mid-race loses the in-memory tape → challenge still works, replay degrades
  to no ghosts. Acceptable; a live race holds open WebSockets and a bot pump, so eviction
  is rare.
- Size: ~10 keystrokes × 6 guesses × ≤8 players ≈ hundreds of tiny events. Well under DO
  storage limits as one JSON value; cap tape at 5,000 events as a backstop.

## v1.6 — Ghost tape: replay

- The challenge client fetches tapes via `GET /api/challenge/<id>/ghosts` (wordless —
  masks only, same trust model as `/meta`).
- The joiner taps **GO** (arming their 3-2-1); at t=0 a local scheduler fires each tape
  event at its recorded offset, feeding the **same opponent-rendering path as a live
  race** — opponent boards, fill animations, and the drama-audio cue layer all react as if
  the field were live.
- The inviter's ghost is visually distinguished from bot ghosts (crown/glow on their
  board header).
- At the joiner's finish: head-to-head verdict line (*"You beat @paul by 12 seconds 🏆"*),
  and their attempt posts to the challenge record exactly as today.
- v1 replays **the original race only**. Adding each challenger's tape to the field
  (replay chains) is a natural v2 — out of scope here.

---

## vX — Voice commentary

- **Consent:** `🎤 Commentary` toggle on the pre-race screen. Off by default, never
  auto-on, browser mic permission prompt, visible `● REC` chip during the whole recording.
- **Capture:** `MediaRecorder`, mono, opus/webm (iOS Safari → AAC/mp4 fallback). Starts at
  GO, stops at the player's finish, hard cap 3 minutes.
- **Store:** on finish, upload blob to `POST /api/challenge/<id>/voice` → new R2 bucket
  `wordul-voice`, key `<challengeId>/<username>`, ~2MB size cap, content-type whitelist,
  30-day lifecycle TTL. Voice expiring degrades the replay to silent ghosts; the race
  itself lives on in the Challenge DO.
- **Playback:** the joiner's tap-to-GO is the autoplay-unlock gesture; one
  `audio.play()` at t=0 keeps the voice track in lockstep with the tape (single shared
  clock, no per-event alignment). The chiptune drama layer ducks ~6dB while a voice track
  is present.
- **Privacy:** audible to anyone holding the link — same trust model as the link itself.
  No delete UI in vX (TTL covers it); explicit delete is future work.

## vY — Video replays

- Same skeleton as vX with `getUserMedia({ video: true, audio: true })`:
  consent toggle (`🎥`), REC chip, record GO→finish, upload to R2
  (`wordul-voice` bucket, `<challengeId>/<username>.video`, 240p, ~10MB cap, 30-day TTL),
  tap-unlocked playback at t=0.
- **Render:** small PiP bubble anchored to the inviter's ghost board. Muted-start is NOT
  needed (tap gesture unlocks sound), but the bubble gets a tap-to-mute.
- vY ships only after vX proves the upload/playback path.

---

## Testing (vitest, red-first per house TDD)

1. Seeded room `runStart` mints a challenge: `shareChallengeId` set, Challenge DO holds
   the room's word; mint failure leaves it null without breaking the start.
2. 2nd human hello on a started seeded room → `arena_handoff` with the id + correct
   `hostDone`; with null id → legacy "room full" error.
3. Human finish posts an attempt to `shareChallengeId`.
4. Seeded hello → `phase: "countdown"` with `goAt`; alarm fires → `playing`; bots emit no
   typing before `goAt`; restore mid-countdown falls back to lobby (existing guard).
5. Tape: events accumulate in order with monotonic `t`; masks only (no letters anywhere in
   the tape); race end posts tape to Challenge DO; cap enforced.
6. `GET /ghosts` returns tapes without the word; 404 before any tape exists.
7. Client replay scheduler (pure module, unit-tested like `countdown.js`): given a tape
   and a t=0, fires events at correct offsets, ignores events past a player's finish.
8. iOS input-zoom guard stays green after any UI change (`test/ios-input-zoom.test.ts`).

## Open items / risks

- Verify the countdown alarm handler (`room.ts:1088`) and `enterCountdown` carry no
  duel-only assumptions before reuse.
- Challenge DO `/attempt` cap is 500; tapes are one-shot single values — no interaction.
- `wrangler.jsonc` gains the `wordul-voice` R2 binding in vX (bucket created via
  `wrangler r2 bucket create`); v1 needs no infra change.
- Word-leak audit: tape events and `/ghosts` must never include guess letters — only
  masks, lengths, timestamps, usernames.
