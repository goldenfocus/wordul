# Duel Bot Typing Rhythm — Design Spec

**Date:** 2026-06-04
**Status:** Approved design, grounded against current `origin/main` (`6023c73`)
**Branch:** `duel-bot-rhythm`

---

## 1. Problem

The live-typing feature is **already on `origin/main`**: every keystroke a human makes sends
`{ type: "typing", len }` — how many cells are filled in their current row — relayed to opponents so
they watch the row fill in real time (`onTyping`, `src/room.ts:840`; `sendTyping`,
`public/app.js:2683`). It deliberately never sends the actual letters (preserves the hidden-word
rule) and carries no timestamps. It is **ephemeral**: no storage write, no snapshot.

The bot (`clanker`/personas) commits **whole words atomically**. Its turn is a per-bot heartbeat:
each bot has `nextGuessAt`; one DO alarm processes every due bot — `noobGuess`/`computeNextGuess`
picks a word, `applyGuess` writes it, one broadcast (`src/room.ts:974–1029`,
`src/room-core.ts:123–146`). The word appears in one shot.

**The collision:** a human's row streams `1→2→3→4→5` as a visible ghost-fill, while the bot's row
just *appears, complete, instantly*. No classifier needed — **the absence of the typing pulse is the
tell.** Every duel silently outs the bot, undoing the disguise we invested in by removing the
"🤖 clanker powered on" announcement so bots join like people.

**The fix:** give the bot a believable typing *hand* — emitted as the same count-only pulses a human
sends — driven by per-persona data, structured so a future **bot-studio** can author typing
personalities (keyboard layout, vibe, playstyle) without touching the engine.

---

## 2. Goals

- The bot emits human-like keystroke pulses **before** committing its word, paced per-persona.
- Two presets, mapped to the two "brains" that already exist:
  - `NOOB_HAND` — the fallible Arena persona (seeded rooms, `noobGuess`): slow, sloppy, hesitant.
  - `SHARP_HAND` — the sharp `/robots` bot (`computeNextGuess`): fast, clean, confident.
- **Disguise-correct by construction:** the bot reuses the *exact* human `typing` wire format. No new
  message type. Nothing new crosses the snapshot disguise chokepoint.
- **Cheat-safe:** the bot's decided-but-uncommitted word never reaches a client.
- **Hibernation-safe:** the typing pulses are cosmetic and ephemeral; the word commit is durable.
- **Data-driven & extensible:** a single pure `planKeystrokes` function is the only thing that reads
  the rhythm data. Every future "brain function" (azerty/asian layout, extrovert/cheater/guesser
  vibe) is a smarter `planKeystrokes` reading more profile fields — the emitter, wire format, and DO
  loop never change. Bot-studio later = a UI that writes `RhythmProfile` data.

---

## 3. Non-goals (deferred — the pipe is laid for them)

Explicitly **out of scope for v1**; the architecture leaves a clean seam for each.

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

A flat `RhythmProfile` — six knobs — lives in a new `src/rhythm.ts`.

```ts
interface RhythmProfile {
  firstKeyMs: number;     // reaction delay after GO, before the first key of the row
  readPauseMs: number;    // "reading / thinking" beat before each row's first key
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

**Where each preset lives (verified against current `main`):**
- The seed marker is `{ profile: "noob"; personaIds; capacity }` (`src/types.ts:67`) — there is no
  per-persona profile object today. So v1 selects the hand by the **same `seeded` flag the bot loop
  already computes** (`const seeded = !!this.state.seed`, `src/room.ts:1010`): `NOOB_HAND` when
  seeded (Arena), `SHARP_HAND` otherwise (`/robots`).
- Seeded rooms can seat **multiple** bots (`ensureBots(capacity)`); they all read the same hand in v1.
- **Future bot-studio hook:** a per-persona `RhythmProfile` on the `SeedMarker`/persona record; the
  selection becomes `persona.rhythm ?? (seeded ? NOOB_HAND : SHARP_HAND)`. Engine unchanged.

---

## 5. The seam — `planKeystrokes`

One pure, deterministic function is the *only* code that reads a `RhythmProfile`. Everything future
plugs in here.

```ts
type KeyStep = { atMs: number; len: number };   // len = filled-cell count at time atMs (relative)

function planKeystrokes(word: string, profile: RhythmProfile, rng: () => number): KeyStep[];
function timelineMs(steps: KeyStep[]): number;   // = last step's atMs (0 for empty)
```

**What `planKeystrokes` produces (v1):**
- An initial reaction delay (`firstKeyMs`/`readPauseMs`) before the first key — so `steps[0].atMs > 0`.
- Per-key gaps drawn around `keyMeanMs`, spread by `keyJitter` (never negative; occasionally long —
  humans aren't metronomes).
- **Corrections**, rolled per `backspaceRate`:
  - *single backspace* + retype → `len` dips by 1, then climbs back.
  - *double backspace* + retype → `len` dips by 2 with a fast inter-delete gap (the panic double-tap).
- **Full clear**, rolled per `clearRate`: `len → 0` (the esc move), a flustered restart beat
  (~`readPauseMs × 0.6`), then the row rebuilds from scratch.
- Ends with `len === word.length`. `atMs` is non-decreasing.

**Determinism:** given the same `rng` stream it returns the same timeline — unit-testable and
replay-stable. `rng` is passed in, never `Math.random()` internally (matches the seeded-room pattern).
The DO passes `Math.random`; tests pass a fixed generator.

**Future-proof:** smarter planners (layout-aware fumbles, vibe traits) are *new implementations of
this one signature*. The emitter and wire format are blind to which planner ran.

---

## 6. Architecture — Approach A, two phases over the existing per-bot heartbeat

The bot has **no socket** (it's a virtual player) and the room uses the **Hibernatable WebSockets
API** (`this.ctx.acceptWebSocket`, `src/room.ts:248`), so a `setTimeout` chain can be evicted
mid-burst. We make the keystrokes *cosmetic* and the commit *durable*.

The bot loop is **already** a per-bot min-heap on one alarm: each bot has `nextGuessAt`, the alarm
processes every DUE bot and re-arms to the soonest (`armBotHeartbeat`/`dueBots`/`nextBotAlarmAt`,
`src/room.ts:974–1029`, `src/room-core.ts:123–146`). We reuse it unchanged in shape: `nextGuessAt`
becomes the bot's "next action time," and a new bot-only `pendingWord` distinguishes the two actions.

### Per-bot flow (inside the existing `alarm()` due-bot loop)

```
for each DUE bot:
  if bot.pendingWord is UNSET → DECIDE:
    word  = seeded ? noobGuess(view,…) : computeNextGuess(view)
    if !word: bot.nextGuessAt = now + botDelay(false, seeded, rand); continue   // missed beat
    steps = planKeystrokes(word, seeded ? NOOB_HAND : SHARP_HAND, Math.random)
    bot.pendingWord = word                          // durable truth (stripped outbound)
    bot.nextGuessAt = now + max(1, timelineMs(steps))   // the COMMIT moment — durable, via the alarm
    scheduleBotTyping(bot.username, steps)          // ephemeral cosmetic pulses (setTimeout)

  if bot.pendingWord is SET → COMMIT:
    applyGuess(bot, bot.pendingWord)
    bot.pendingWord = undefined
    bot.nextGuessAt = now + botDelay(false, seeded, rand)   // think-time before the next row

# unchanged after the loop: one persistAndBroadcast() if acted, re-arm setAlarm(nextBotAlarmAt).
```

- **`pendingWord`** is a new **bot-only `PlayerState` field**, stripped outbound by
  `projectPlayerForClient` alongside `isBot`/`nextGuessAt` (`src/bots.ts:73`) — so the bot's decided
  word never reaches an opponent (cheat + disguise safe). It is durable (part of `this.state`), so the
  COMMIT survives hibernation even when the cosmetic pulses don't.
- **`emitBotTyping(username, len)`** broadcasts `{ type:"typing", username, len }` to every socket —
  identical to `onTyping`'s payload (the bot has no socket, so there's no self-echo to skip). Guarded
  on `phase === "playing"` + the bot still `status === "playing"`, like `onTyping`.
- **`scheduleBotTyping(username, steps)`** schedules `setTimeout(() => emitBotTyping(username,
  step.len), step.atMs)` per step. Because `commitAt === now + timelineMs(steps)`, all of a row's
  pulses fire before that row commits — no cross-row leftover timers.
- **Multiple bots** (seeded Arena, `capacity > 1`) just work: each carries its own
  `pendingWord`/`nextGuessAt`; the min-heap already interleaves them.
- **Hibernation:** the cosmetic `setTimeout` pulses are best-effort; if the isolate is evicted
  mid-burst they stop, but the durable `nextGuessAt` COMMIT still fires and the word pops at the right
  time = today's behavior. Graceful by construction.
- **Round reset:** `runStart` clears per-round player state (`src/room.ts:677–684`); add
  `p.pendingWord = undefined` there so a round that ends mid-type leaves no stale pending word.
- **Cost:** two alarm fires per row instead of one; no per-key storage writes; the alarm is free
  during play (rematch's alarm only runs in `finished`).

### Why not the alternatives

- **One alarm per keystroke** — a storage write per key, contends with the rematch alarm. Rejected.
- **Approach B (precomputed reel broadcast to clients)** — hibernation-proof and doubles as a replay
  format, but introduces a bot-only message type (a *new* disguise seam a sniffing client could read)
  and a second client render path. Deferred; the natural home for replay/ghost-races later.

---

## 7. Wire & disguise

No new message type. The bot reuses `ServerMessage` `{ type:"typing", username, len }` — byte
-identical to a human's pulses, through the same broadcast. The disguise chokepoint
`projectPlayerForClient` (`src/bots.ts:73`) gains `pendingWord` in its strip list next to
`isBot`/`nextGuessAt`; the snapshot projection (`src/room.ts:1637–1663`) routes all players through
it, so nothing new reaches the wire.

---

## 8. Testing

**Unit — `planKeystrokes` / `timelineMs` (pure, seeded rng) — `test/rhythm.test.ts`:**
- Determinism: same seed → identical timeline.
- Builds to completion: final step `len === word.length`; `atMs` non-decreasing; `steps[0].atMs > 0`.
- `backspaceRate = 1` → at least one `len` dip (single or double) appears; `= 0` → none.
- `clearRate = 1` → a `len === 0` step appears after progress, then rebuild; `= 0` → never drops to 0.
- Duration band per preset: `SHARP_HAND` total span < `NOOB_HAND` total span for the same word/seed.
- `timelineMs([])` === 0; `timelineMs(steps)` === last `atMs`.

**Unit — presets:** sharp is faster/cleaner than noob across every field (guards a future inversion).

**DO integration (mirror `test/room-duel.test.ts`):**
- DECIDE (timer-free): a due bot's first alarm sets `pendingWord` to a valid word and pushes
  `nextGuessAt` into the future — and does **not** yet append a guess (`bot.guesses.length === 0`).
- COMMIT (timer-free): with `pendingWord` set and `nextGuessAt` due, the next alarm appends exactly
  that word (`bot.guesses[0].word === pendingWord`) and clears `pendingWord`. (This same test, by
  never advancing the cosmetic timers, proves the **hibernation fallback**: commit happens without
  any pulse firing.)
- Disguise/cheat: `projectPlayerForClient(bot)` (and a built snapshot) carries no `pendingWord`,
  `isBot`, or `nextGuessAt`.
- Cosmetic (fake timers): driving DECIDE then advancing `timelineMs` emits ≥1 `typing` message whose
  `username` is the bot and whose `len` increases over time.

---

## 9. Sequencing & files

**Dependency (RESOLVED):** the `typing` feature **already merged to `origin/main`** (`6023c73`):
`onTyping` at `src/room.ts:840`, `sendTyping` at `public/app.js:2683`, the `typing` messages in
`src/types.ts:115,131`. This branch is cut from that commit, so the channel is already present — **no
gate.** The bot's pulses reuse the live `onTyping` relay.

**Files:**
- `src/rhythm.ts` *(new)* — `RhythmProfile`, `SHARP_HAND`/`NOOB_HAND`, `planKeystrokes`, `timelineMs`.
- `src/types.ts` — add `pendingWord?: string` to `PlayerState` (bot-only, like `nextGuessAt`).
- `src/bots.ts` — add `pendingWord` to `projectPlayerForClient`'s `Omit` + destructure-strip.
- `src/room.ts` — two-phase `alarm()` due-bot loop, `emitBotTyping`, `scheduleBotTyping`, profile
  selection by `seeded`, clear `pendingWord` in the `runStart` reset.
- `test/rhythm.test.ts` *(new)* — `planKeystrokes`/`timelineMs` units + preset sanity.
- `test/room-duel.test.ts` *(extend)* — DECIDE/COMMIT/disguise/cosmetic integration cases.

---

## 10. Locked decisions

- **Two presets only** for v1 — `NOOB_HAND`, `SHARP_HAND` — selected by the `seeded` flag.
- **Corrections in v1:** single backspace, double backspace, esc full-clear.
- **Approach A** (human-wire pulses) over the **existing per-bot heartbeat**; `pendingWord` on
  `PlayerState` (durable, stripped) + `nextGuessAt` reused as the two-phase clock.
- **Deferred:** vibe/layout planners, bot-studio UI, Approach B + replay, exposing letters, the
  player-facing trust mechanic. Each has a clean seam left open.
