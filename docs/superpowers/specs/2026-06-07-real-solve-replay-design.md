# The Real Solve — full keystroke replay for the daily

**Date:** 2026-06-07 · **Status:** approved design · **Ships:** first (before swipe time-travel — tapes only exist from the day the recorder ships, so every day without it is replay data lost forever)

Companion spec: [2026-06-07-swipe-time-travel-design.md](2026-06-07-swipe-time-travel-design.md)

## Goal

Today's daily replays (`stamp-replay-core.js`) show guesses at a fixed synthetic cadence.
This feature adds the *real* replay: every letter typed, backspace, clear-line, rejected
word, power-up/penalty moment, the companion voice line that fired, and the true timer —
so watching someone's solve feels like watching them solve.

## Decisions (locked with Yan)

| Question | Decision |
|---|---|
| Whose tapes are watchable | Everyone's, gated by the existing **finisher token** (same gate as real letters today) |
| Timing | Real relative rhythm; gaps > 3s compress to a ~1.2s "💭 thinking… 47s" beat; timer chip always shows TRUE elapsed; 1x/2x/4x speed control |
| Voice | The tape records WHICH companion line fired per guess; replay re-speaks it via the existing voice engine, honoring the viewer's mute/world settings |
| Placement | Quick synthetic replay stays the default everywhere; the replay modal gains a "▶ watch the real solve" deep-dive mode when a tape exists |
| Capture architecture | Client tape recorder → single WS upload on scoring → Room DO storage (approach A; no gameplay hot-path changes, no live streaming) |

## Tape format

Compact event stream, ms offsets from round GO (same time basis as the existing `guessAts`):

```js
{ v: 1, events: [ [t, kind, ...data], ... ], truncated?: true }
// events are [t, kind, data?] (t first — keeps rows compact):
// "k" letter typed        [4520, "k", "S"]
// "b" backspace           [5100, "b"]
// "c" clear-line (hold)   [9300, "c"]
// "e" guess submitted     [12040, "e"]   // accepted unless an "r" follows before the
//                                        // next k/b/c/e; masks join from leaderboard grid
// "r" submit rejected     [8000, "r"]
// "p" power-up / penalty  [15200, "p", "vowels"]
// "v" companion line      [12300, "v", { raw, text, voice, revealVoice, answer? }]
```

- Cap: **5,000 events / 32KB serialized** (ghost-tape precedent, `src/ghost-core.ts`).
  Recorder stops gracefully at the cap and marks `truncated: true`.
- Letters of accepted guesses are NOT duplicated in `"s"` events — the replay joins them
  from the leaderboard payload (`words`), which is already token-gated.

## Components

### 1. `public/tape-recorder.js` (new, client)
- `tape.start(date)`, `tape.record(kind, ...data)`, `tape.snapshot()`, `tape.stop()`.
- Pure event buffer + cap logic; no DOM, no network (testable as a pure core).
- Throttled mirror to `localStorage["wr.tape:<date>"]` (e.g. every 10 events / 2s) for
  crash recovery; cleared after successful upload.

### 2. `app.js` hooks (existing seams, additive one-liners)
- Keyboard input handler → `"k"` · backspace → `"b"` · hold-to-clear (`keyboard.js`
  long-press path) → `"c"` · submit accepted/rejected → `"s"`/`"r"` ·
  dead-letter / power-up triggers → `"p"` · `showCompanion()` → `"v"` with the chosen line id.

### 3. Upload (client → Room DO)
- When the game is scored (win, loss, or resign), client sends one
  `{ type: "tape", date, events }` WS message.
- `src/room.ts` handler validates: sender is the player, player has reached a terminal
  status (status-based, not scored-based — scorePlayer broadcasts the terminal snapshot
  before the mint confirms `scored`), size ≤ cap, accepts **once** (first write wins).
  Stores `{ events, truncated }` under DO storage key `tape:<username>` — a separate key,
  never inside room state, so snapshots and persists stay light.
- If the WS is gone (tab crashed), the localStorage mirror is offered for upload on the
  next visit to that day's room (revisit flow already reconnects).

### 4. Serving
- `GET /api/daily/<date>/tape?u=<username>&t=<token>` (`src/worker.ts` → room fetch).
- Token check identical to the leaderboard's real-letters gate (`finisherSecret`).
  No/invalid token → 403. Missing tape → 404 (client falls back silently).

### 5. `public/tape-replay.js` (new, client playback)
- `buildTapeSchedule(tape, opts)` — **pure** scheduler (like `buildReplaySteps`): maps raw
  events to playback steps, compressing every gap > 3,000ms into a 1,200ms
  `{kind:"think", trueMs}` beat. Unit-testable with zero DOM.
- Renderer: board + current-row typing, "💭 thinking… 47s" overlay during think beats,
  timer chip counting TRUE elapsed, reject shake on `"r"`, power-up flourish on `"p"`,
  voice line on `"v"` via `speakLine`/`speakTemplated` (respects viewer mute + world voice).
- Controls: play/pause, speed 1x/2x/4x (scales step delays, think beats stay fixed),
  skip-to-next-guess.

### 6. Replay modal integration (`public/daily-lb.js`)
- `openReplayModal()` keeps the synthetic replay as the instant default.
- When `tape` fetch succeeds, a "▶ watch the real solve" affordance appears and switches
  the modal into tape mode. No tape → affordance absent (old games degrade invisibly).

## Error handling

- Tape missing / fetch fails → synthetic replay only (today's behavior).
- `truncated` tapes play what exists, then jump-cut to the final board with a small note.
- Oversized or duplicate uploads rejected server-side; client drops the local mirror.
- Recorder failure must never break gameplay: every `tape.record` call is wrapped so a
  recorder exception is swallowed (record-nothing beats break-the-game).

## Testing (vitest)

- `tape-recorder` core: event encoding, cap + truncation, mirror throttle logic.
- `buildTapeSchedule`: gap compression math, speed scaling, think-beat insertion,
  truncated-tape ending.
- `room.ts`: tape upload validation (wrong sender, double upload, oversize, unscored),
  token gate on the tape endpoint (valid/invalid/missing token).

## Out of scope (deliberate)

- Live spectating of in-progress solves (approach B — YAGNI for now).
- Retroactive tapes for games played before the recorder ships.
- Scrub bar / arbitrary seeking (v1 has skip-to-next-guess only).
- Arena/challenge rooms — daily rooms only in v1 (ghost tapes already cover Arena feel).
