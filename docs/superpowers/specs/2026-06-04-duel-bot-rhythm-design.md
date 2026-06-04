# Duel Bot Typing Rhythm — Design Spec

**Date:** 2026-06-04
**Status:** Approved design, pending spec review → plan
**Branch:** `duel-bot-rhythm`

---

## 1. Problem

The live-typing feature (in the `wotd-quit-skull` worktree, **not yet on `main`**) broadcasts a
count-only ghost-fill: every keystroke a human makes sends `{ type: "typing", len }` — how many
cells are filled in their current row — relayed to opponents so they watch the row fill in real
time. It deliberately never sends the actual letters (preserves the hidden-word rule) and carries
no timestamps.

The bot (`clanker`) commits **whole words atomically**. Its turn is one durable-object alarm:
`alarm()` → `noobGuess`/`computeNextGuess` picks a word → `applyGuess` writes it → broadcast
(`src/room.ts:776–795`). The word appears in one shot.

**The collision:** the day live-typing merges, a human's row streams `1→2→3→4→5` while the bot's
row just *appears, complete, instantly*. No classifier needed — **the absence of the typing pulse
is the tell.** Every duel silently outs the bot. This directly undoes the disguise we just invested
in by removing the "🤖 clanker powered on" announcement so bots join like people.

**The fix:** give the bot a believable typing *hand* — emitted as the same count-only pulses a
human sends — driven by per-persona data, structured so a future **bot-studio** can author typing
personalities (keyboard layout, vibe, playstyle) without touching the engine.

---

## 2. Goals

- The bot emits human-like keystroke pulses **before** committing its word, paced per-persona.
- Two presets, mapped to the two "brains" that already exist in the code:
  - `NOOB_HAND` — the fallible Arena persona (`noobGuess`, seeded rooms): slow, sloppy, hesitant.
  - `SHARP_HAND` — the sharp `/robots` bot (`computeNextGuess`): fast, clean, confident.
- **Disguise-correct by construction:** the bot uses the *exact* human `typing` wire format. No new
  message type. Nothing new crosses the snapshot disguise chokepoint (`src/room.ts:~1355`).
- **Hibernation-safe:** the typing pulses are cosmetic and ephemeral; the word commit is durable.
- **Data-driven & extensible:** a single pure `planKeystrokes` function is the only thing that reads
  the rhythm data. Every future "brain function" (azerty/asian layout, extrovert/cheater/guesser
  vibe) is a smarter `planKeystrokes` reading more profile fields — the emitter, wire format, and DO
  loop never change. Bot-studio later = a UI that writes `RhythmProfile` data.

---

## 3. Non-goals (deferred — the pipe is laid for them)

These are explicitly **out of scope for v1**. The architecture leaves a clean seam for each.

- **The vibe / layout planners themselves** (azerty/asian/qwerty fat-fingering, extrovert, cheater,
  guesser). v1 ships the *seam* and two presets, not the zoo.
- **bot-studio UI** — the editor for `RhythmProfile` data.
- **Approach B (precomputed-reel / client playback)** and the **replay / ghost-race** primitive it
  would unlock.
- **Surfacing the actual typed letters.** The channel stays count-only; most "layout flavor" can
  only express as correction *rhythm* until letters are ever exposed.
- **Player-facing trust mechanic** — "Call the bot" wager, post-game reveal card, Turing-test mode.

---

## 4. Data model

A flat `RhythmProfile` — six knobs. It extends the persona `profile` that already ships
(`this.state.seed = { personaId, profile }`, `src/room.ts:191`).

```ts
interface RhythmProfile {
  firstKeyMs: number;     // reaction delay after GO, before the first key of the first row
  readPauseMs: number;    // "reading / thinking" beat before each subsequent row
  keyMeanMs: number;      // average gap between consecutive keystrokes
  keyJitter: number;      // 0..1 — how irregular the per-key gaps are
  backspaceRate: number;  // 0..1 — chance a row includes a single/double backspace fumble
  clearRate: number;      // 0..1 — chance a row includes an esc full-clear-and-restart
}
```

**Presets** (starting values — tuned during implementation):

| field           | `SHARP_HAND` | `NOOB_HAND` |
| --------------- | ------------ | ----------- |
| `firstKeyMs`    | ~300         | ~900        |
| `readPauseMs`   | ~400         | ~1500       |
| `keyMeanMs`     | ~120         | ~280        |
| `keyJitter`     | 0.15         | 0.50        |
| `backspaceRate` | 0.02         | 0.25        |
| `clearRate`     | 0.00         | 0.06        |

**Where each preset lives:**
- The seeded Arena persona already carries a `profile`; `NOOB_HAND` rhythm fields extend it.
- The sharp `/robots` bot is **not** seeded (`state.seed` is falsy), so it has no persona record.
  It reads a module-level default constant `SHARP_HAND`.

---

## 5. The seam — `planKeystrokes`

One pure, deterministic function is the *only* code that reads a `RhythmProfile`. Everything future
plugs in here.

```ts
type KeyStep = { atMs: number; len: number };   // len = filled-cell count at time atMs (relative)

function planKeystrokes(word: string, profile: RhythmProfile, rng: () => number): KeyStep[];
```

**What it produces (v1):**
- An initial reaction delay (`firstKeyMs`, or `readPauseMs` for non-first rows) before the first key.
- Per-key gaps drawn around `keyMeanMs`, spread by `keyJitter` (e.g. a log-normal-ish jitter so gaps
  are never negative and occasionally long — humans aren't metronomes).
- **Corrections**, rolled per `backspaceRate`:
  - *single backspace* + retype → `len` dips by 1, then climbs back.
  - *double backspace* + retype → `len` dips by 2 with a fast inter-delete gap (the panic double-tap).
- **Full clear**, rolled per `clearRate`: `len → 0` (the esc move), a flustered restart beat
  (~`readPauseMs × 0.6`), then the row rebuilds from scratch.
- Ends with `len === word.length`. Total span = `timelineMs` (the last `atMs`).

**Determinism:** given the same `rng` stream it returns the same timeline — so it's unit-testable and
replay-stable. (`rng` is passed in, never `Math.random()` internally, per the existing seeded-room
pattern.)

**Future-proof:** smarter planners (layout-aware fumbles, vibe traits) are *new implementations or
wrappers of this one signature*. The emitter and wire format are blind to which planner ran.

---

## 6. Architecture — Approach A, two durable stages

The bot has **no socket of its own** (it's a virtual player) and the room uses the **Hibernatable
WebSockets API** (`this.ctx.acceptWebSocket`, `src/room.ts:209`), so a `setTimeout` chain can be
evicted mid-burst. We make the keystrokes *cosmetic* and the commit *durable* by splitting the bot's
turn into two alarm stages.

### Per-row flow

```
DECIDE alarm  (the existing think delay)
  alarm() with no botPending:
    word     = noobGuess(view, …) | computeNextGuess(view)
    steps    = planKeystrokes(word, profile, rng)
    state.botPending = { word }                    // durable truth
    setAlarm(now + timelineMs(steps))              // the COMMIT alarm — durable
    startTypingChain(steps)                         // ephemeral cosmetic pulses

  ↓  (cosmetic) emitBotTyping(len) per step via short-lived timers

COMMIT alarm  (fires at now + timelineMs)
  alarm() with botPending set:
    applyGuess(botPending.word)
    state.botPending = null
    persistAndBroadcast()
    scheduleBotTick()   // next row, or finish
```

- **`emitBotTyping(len)`** broadcasts `{ type: "typing", username: bot.username, len }` to every
  socket — identical to `onTyping`'s payload, minus the self-echo guard (the bot has no socket to
  skip). Guarded on `phase === "playing"` and the bot's `status === "playing"`, exactly like
  `onTyping`.
- **`botPending`** is new durable state: `{ word: string } | null`. It distinguishes the two alarm
  stages and survives hibernation.
- **Hibernation behavior:** if the isolate is evicted mid-burst, the cosmetic pulses simply stop —
  but the COMMIT alarm still fires at the right time and pops the word. That is *exactly today's
  behavior* (atomic word, correctly paced). Graceful degrade, no special-casing.
- **Cost:** two alarms per row instead of one. No per-keystroke storage writes. The single DO alarm
  is free during `playing` (rematch's alarm only runs in `finished`), so no contention.

### Why not the alternatives

- **One alarm per keystroke** — a storage write per key, contends with the rematch alarm. Rejected.
- **Approach B (precomputed reel broadcast to clients)** — hibernation-proof and doubles as a replay
  format, but introduces a bot-only message type (a *new* disguise seam a sniffing client could read)
  and a second client render path. Deferred; it's the natural home for replay/ghost-races later.

---

## 7. Wire & disguise

No new message type. The bot reuses `ServerMessage` `{ type: "typing", username, len }` — byte
-identical to a human's pulses, through the same broadcast. The per-viewer snapshot disguise
chokepoint (`src/room.ts:~1355`, strips `isBot` + the server-only seed key) is **untouched**: the
typing channel never carried `isBot`, so there is nothing new to strip.

---

## 8. Testing

**Unit — `planKeystrokes` (pure, seeded rng):**
- Determinism: same seed → identical timeline.
- Builds to completion: final step `len === word.length`; `atMs` strictly non-decreasing.
- `backspaceRate = 1` → at least one `len` dip (single or double) appears; `= 0` → none.
- `clearRate = 1` → a `len === 0` step appears after progress, then rebuild; `= 0` → never drops to 0.
- Duration band per preset: `SHARP_HAND` total span < `NOOB_HAND` total span for the same word.

**Unit — presets:** sharp is faster/cleaner than noob across every field (sanity guard against a
future edit inverting them).

**DO integration (mirror `test/room-duel.test.ts`):**
- During a bot's turn, at least one `typing` broadcast is emitted *before* the bot's guess lands in
  the snapshot.
- The bot's word still commits via the COMMIT alarm even if the cosmetic chain never drains
  (simulate by not advancing the ephemeral timers) — assert `botPending` resolves and the guess
  applies at the scheduled time.
- A non-bot client's view of the bot's typing/guess carries **no `isBot` leak** (disguise intact).

---

## 9. Sequencing & files

**Dependency:** this work sits *on top of* the `typing` feature, which is only in the
`wotd-quit-skull` worktree today. Land order: merge `wotd-quit-skull` to `main` first (or rebase this
branch onto it). The implementation worktree must contain the `typing` types, the `onTyping` relay,
and the client ghost-fill render — otherwise there's no channel for the bot's pulses. **Flag for the
plan.**

**Files (expected):**
- `src/rhythm.ts` *(new)* — `RhythmProfile`, `SHARP_HAND` / `NOOB_HAND` presets, `planKeystrokes`.
- `src/room.ts` — two-stage `alarm()`, `emitBotTyping`, `botPending` handling, `scheduleBotTick`
  wiring; select the profile (seeded persona profile vs `SHARP_HAND` default).
- `src/types.ts` — `RhythmProfile` type; `botPending` on room state; persona `profile` extension.
- Persona/seed wiring — carry rhythm fields through `state.seed.profile`.
- `test/` — `planKeystrokes` unit tests + a DO integration test.

---

## 10. Locked decisions

- **Two presets only** for v1 — `NOOB_HAND`, `SHARP_HAND` — mapped to the two existing brains.
- **Corrections in v1:** single backspace, double backspace, esc full-clear.
- **Approach A** (human-wire pulses, two durable alarm stages).
- **Deferred:** vibe/layout planners, bot-studio UI, Approach B + replay, exposing letters, the
  player-facing trust mechanic. Each has a clean seam left open.
