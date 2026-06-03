# Race-end Boom → Rematch Handshake — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorm) → ready for implementation plan
**Scope:** The end-of-race moment in live multiplayer rooms (Arena + Friends). Turns the current
"keep grinding a decided race" limbo into an instant boom, and turns the instant-reset rematch
button into a propose/accept handshake — with bots that decide like people.

---

## The one moment this must nail

> Your opponent solves it. Your board **explodes immediately** — no grinding a lost race. The
> screen settles to two choices: **Rematch** or **Home**. You tap Rematch; a beat later
> *"pax wants to run it back"* turns into **GO!** — or *"pax isn't up for another — nice game!"*
> and you're gently back Home.

Everything below serves that beat.

---

## Why (the bet)

Two problems with today's race-end, both visible in the reported screenshot (opponent shows
**WON**, you're still typing into row 3):

1. **Decided-race limbo.** `maybeFinish()` only ends a room once *every* player is done, so when
   the opponent solves, the loser keeps typing a race that's already lost — for consolation gold.
   It reads as a bug, not a feature. A race should end when someone wins it.
2. **Rematch has no social texture.** `onRematch()` resets to lobby the instant either side clicks
   — there's no "do you both want this?" handshake, and a bot opponent can't express the very human
   "nah, gotta run" that makes rematch feel like playing a person.

This change makes the race *end like a race* and makes rematch *feel like a conversation*.

---

## Goals

- **Instant boom:** first solve ends the race for everyone; the loser's existing explosion fires
  the moment the opponent wins.
- **A two-choice end screen:** Rematch + Home, symmetric for both winner and loser.
- **A rematch handshake:** propose → the other side accepts or declines; only on accept does a new
  round start.
- **Human-feeling bots:** a bot opponent decides after a realistic 3–9s pause, and *mostly* says
  yes (~80%), occasionally bows out with a human line.
- **No dead-ends:** a declined / ignored / abandoned proposal lands the proposer gently Home.

## Non-goals (explicitly out of scope)

- **Gold stakes / wagering.** Gold earned in a run is banked; rematch is free. (Floated and
  deliberately cut — prove the loop is fun first.)
- **Auto-rematchmaking to a *new* opponent.** The end screen offers Rematch (same opponent) or
  Home only. Finding someone new = Home → Arena, as today.
- **Bots *proposing* rematches.** Bots are reactive: they accept or decline, never initiate.
- **Daily.** Daily is async per-player scoring with no live winner-race; it is untouched.
- **New explosion art.** The existing `triggerLoseSequence` is reused as-is.

---

## Part 1 — First solve ends the race (the boom trigger)

**Rule:** in any live, non-daily room, the instant `state.winner` is set, the race is over for
**everyone**. Applies to **all live races — Arena *and* Friends** (decided: one coherent rule;
this changes today's Friends "everyone finishes for their own gold" behavior).

### Server (`src/room.ts`)

`applyGuess()` already sets `state.winner` on the first all-green solve (today ~line 644). Right
after a winner is established, end the race:

- Flip every still-`playing` player to `status: "lost"`.
- Then the existing `afterPlayerStatus → maybeFinish()` path finds the game over and runs
  `finishGame()` (reveal word, record, phase → `finished`) exactly as it does today when the last
  player finishes — no new finish path.

Cleanest seam: a small helper `endRaceOnWin()` called from `applyGuess()` once `state.winner` is
newly set, **or** adjust `isGameOver()` to return `true` when `state.winner !== null` for non-daily
rooms. Prefer the explicit flip in `applyGuess` so the still-playing players carry a real `lost`
status into the snapshot (the client reads per-player `status`, and `emitPlayerFinished` should
fire for them so science/records stay consistent). The implementation plan picks the exact seam;
the **behavioral contract** is: *winner set ⇒ all others `lost` ⇒ room `finished`, same tick.*

> ⚠️ The bot pacing alarm (`scheduleBotTick`) must not fire a guess into a now-finished room — the
> existing `alarm()` already guards `phase !== "playing"`, so a finished race is safe, but verify.

### Client (`public/app.js`)

No new explosion needed. When the room flips to `finished` with a winner who isn't me, the existing
`phaseEnded` branch (today ~line 1297) already calls `handleGameOver → triggerLoseSequence`. The
boom now fires *immediately* on the opponent's solve instead of after I exhaust my guesses.

**"Outpaced" copy (client-derived, no server field).** A player can now be `lost` two ways:
- *exhausted* — used all `maxGuesses`, or
- *outpaced* — `status === "lost"` while `guesses.length < maxGuesses` and a `winner` other than me exists.

Derive `outpaced` on the client and choose loss copy accordingly (e.g. *"pax beat you to it"* vs
the existing exhaustion line). This is presentation only; the server stores plain `lost`.

---

## Part 2 — The end screen (both players, symmetric)

After the boom (loser) or victory celebration (winner) settles, the existing stats modal
(`openStats`) shows exactly **two actions**: **Rematch** and **Home**. Gold earned this run is
already banked — no stakes, no ante.

- **Rematch** → sends `rematch_propose` (Part 3), then the button itself becomes the waiting state
  (Part 3 UI).
- **Home** → leaves the room (existing `leaveRoom`/navigate). Leaving while a proposal from the
  other side is pending counts as an implicit **decline**.

The screen is identical for winner and loser — either can propose.

---

## Part 3 — Rematch handshake protocol

Replace the instant `onRematch()` reset with a propose/accept exchange owned by the room.

### Room state (`src/room.ts` + `src/types.ts`)

Add a transient field (not persisted across rounds; cleared on start/cancel):

```ts
rematch: {
  proposer: string;      // username who proposed
  deadline: number;      // epoch ms; proposal auto-cancels after REMATCH_TIMEOUT_MS (15_000)
} | null
```

### Messages

| Direction | Type | Payload | Meaning |
|---|---|---|---|
| client→server | `rematch_propose` | — | "I want to run it back." |
| client→server | `rematch_accept` | — | "Yes, let's go." |
| client→server | `rematch_decline` | — | "No thanks." |
| server→clients | `rematch_proposed` | `{ proposer }` | Show the other side an Accept/Decline prompt. |
| server→clients | `rematch_accepted` | `{ by }` | Both in — about to start. |
| server→clients | `rematch_cancelled` | `{ reason: "declined" \| "timeout" \| "left" }` | Proposal is dead; proposer settles Home. |

Only valid while `phase === "finished"` and `!isDaily`.

### Server flow (`onRematch*` handlers)

1. **`rematch_propose`** (from human only):
   - If no `rematch` pending → set `rematch = { proposer: me, deadline: now + 15_000 }`, broadcast
     `rematch_proposed`. If the opponent is a **bot**, schedule its decision (Part 4). Set the 15s
     timeout (Part 4 alarm multiplexing).
   - If a `rematch` is **already pending from the *other* side** → treat my propose as an **accept**
     (mutual want) → go to start.
2. **`rematch_accept`** (must be a non-proposer): broadcast `rematch_accepted`, then **start a new
   round via the existing `runStart()`** (reuses round increment, word pick, GO!/`emitRoundStarted`,
   bot tick scheduling). Clear `rematch`.
3. **`rematch_decline`** / proposer-or-opponent disconnect / 15s timeout: clear `rematch`, broadcast
   `rematch_cancelled` with the matching reason.

> `runStart()` already does everything the old `onRematch()` did (reset guesses/status/points, pick
> word, `phase = "playing"`, schedule bot). The handshake's "accept" path simply calls it — we
> delete the bespoke reset in `onRematch` rather than duplicate it.

### Client flow (`public/app.js`)

- **Proposer:** tap Rematch → button morphs to **"Waiting for pax… ✕"** (the ✕ sends
  `rematch_decline` to cancel my own proposal). On `rematch_accepted` → modal closes, GO! plays
  (existing `emitRoundStarted` path). On `rematch_cancelled` → friendly line + fade Home (Part 5).
- **Recipient:** on `rematch_proposed`, the end screen shows **"pax wants to run it back —
  Accept / Decline"**. Accept → `rematch_accept`. Decline (or Home) → `rematch_decline`.

---

## Part 4 — Bot behavior

When the opponent is a bot (`player.isBot`) and a human proposes, the bot **decides like a person**.

### The single-alarm constraint

The DO has **one alarm**, already used by `scheduleBotTick()` to pace bot *guesses*. The bot's
delayed rematch decision must **share** that alarm — do **not** assume a second one exists.

Add a small pending-action discriminator to room state so `alarm()` knows what it's waking for:

```ts
pendingAlarm: "bot_guess" | "bot_rematch" | "rematch_timeout" | null
```

`alarm()` branches on `pendingAlarm`:
- `bot_guess` → existing guess path (only when `phase === "playing"`).
- `bot_rematch` → run the bot's decision (below).
- `rematch_timeout` → if a proposal is still pending, cancel it (`reason: "timeout"`).

> Note both a bot decision and a human-proposal timeout can be outstanding at once. Since there's
> one alarm, store **both** deadlines and set the alarm to the **earliest**; on wake, process every
> due action and reschedule for the next. The bot's 3–9s decision will essentially always fire
> before the 15s human-timeout, so in practice the bot path resolves first.

### The decision

On the `bot_rematch` wake (scheduled at `now + random(3_000..9_000)` ms when the human proposes):

- Roll: **~80% accept**, **~20% decline** (tunable constant `BOT_REMATCH_ACCEPT_P = 0.8`).
- **Accept** → same as a human `rematch_accept`: broadcast `rematch_accepted`, `runStart()`.
- **Decline** → broadcast `rematch_cancelled { reason: "declined" }`, push a human-flavored system
  line (*"gotta run — gg!"*), and the bot **leaves** the room (so the player isn't stuck staring at
  a bot who said no — they settle Home and can grab a fresh opponent from the Arena).

Bots **never** send `rematch_propose`.

> RNG: use the same seedable `Math.random()` style already used by `noobGuess`/`scheduleBotTick`
> so tests can force accept vs decline deterministically.

---

## Part 5 — The "no" path (proposer never dead-ends)

Any failure resolves the proposer gently:

- **Declined** (human Decline, or bot decline roll) → `rematch_cancelled { reason: "declined" }`.
- **Ignored** → 15s `deadline` elapses → `rematch_cancelled { reason: "timeout" }`.
- **Opponent left** (disconnect / Home) while my proposal pends → `rematch_cancelled { reason: "left" }`.

In every case the proposer's client shows one short friendly line keyed to the reason
(*"pax isn't up for another — nice game!"* / *"pax stepped away — nice game!"*) for ~2s, then the
screen settles to **Home**. No retry loop, no error tone.

---

## Protocol summary (net new wire surface)

**Client → server:** `rematch_propose`, `rematch_accept`, `rematch_decline`
*(the old fire-and-forget `rematch` message is removed)*

**Server → clients:** `rematch_proposed`, `rematch_accepted`, `rematch_cancelled`

**Room state additions:** `rematch: {proposer, deadline} | null`, `pendingAlarm` discriminator
(+ bot-decision / timeout deadlines as needed for alarm multiplexing).

**No new server field for "outpaced"** — derived on the client from `status`, `guesses.length`,
`maxGuesses`, and `winner`.

---

## Edge cases & rules

- **Mutual propose:** both tap Rematch ≈ simultaneously → the second propose is read as an accept →
  starts once. No double-start (guard on `phase`/`rematch` being consumed).
- **Proposer leaves after proposing:** clear `rematch`, nothing to cancel for the (absent) proposer;
  if the opponent already saw the prompt, send `rematch_cancelled { reason: "left" }`.
- **Both human, one declines:** standard `declined` path; the room stays `finished`, decliner can
  still hit Home or propose their own rematch.
- **Bot already left (declined a prior proposal):** a re-proposal finds no opponent → immediate
  `rematch_cancelled { reason: "left" }`.
- **Race finishes with nobody solving** (everyone exhausted, `winner === null`): unchanged — normal
  finish, both see the end screen, rematch handshake works the same.
- **>2 players (future Arena/Friends):** "first solve ends it" booms all non-winners. The handshake
  is defined for the 1v1 case; for N>2 the proposal is to the *room* and the **first** accept starts
  it (others are pulled into the new round via `runStart` resetting everyone). Keep v1 logic 1v1-
  correct; don't over-build N-way negotiation.

---

## Testing (`test/`, vitest — match existing room/arena-core suites)

Reducer-level, deterministic (seed the RNG):

1. **First-solve ends race:** two players mid-race; player A solves → B flips to `lost`, phase
   `finished`, word revealed, same tick. (Arena room **and** Friends room — assert the rule is not
   gated.)
2. **Outpaced derivation (client unit):** `status==="lost"`, `guesses<max`, `winner!==me` ⇒
   outpaced copy; full-exhaustion ⇒ exhaustion copy.
3. **Propose → accept → start:** `rematch_propose` then `rematch_accept` ⇒ `rematch_accepted`,
   `phase==="playing"`, round incremented, guesses reset.
4. **Propose → decline → cancelled** (`reason:"declined"`); room stays `finished`.
5. **Propose → timeout → cancelled** (`reason:"timeout"`) after 15s alarm.
6. **Mutual propose ⇒ single start** (no double `runStart`).
7. **Bot accept** (RNG forced < 0.8): after the scheduled wake, `rematch_accepted` + start.
8. **Bot decline** (RNG forced ≥ 0.8): `rematch_cancelled{declined}` + system line + bot removed
   from `players`.
9. **Alarm multiplexing:** a pending bot-guess alarm and a pending rematch decision don't clobber
   each other; earliest-deadline wins and both eventually process.
10. **Opponent-left while pending ⇒ cancelled{left}.**

---

## Build sequence (suggested slices for the plan)

1. **Slice 1 — First-solve ends the race** (server `applyGuess`/`isGameOver` + client outpaced
   copy). Independently shippable; fixes the reported limbo on its own.
2. **Slice 2 — Handshake protocol** (state, messages, `onRematch*` handlers, `runStart` reuse,
   removal of old `rematch` message) + client propose/accept/waiting UI.
3. **Slice 3 — Bot decision + alarm multiplexing** (pendingAlarm discriminator, 3–9s schedule,
   80/20 roll, decline-and-leave).
4. **Slice 4 — No-path polish** (reason-keyed friendly lines + fade-to-Home, timeout).

Slices 1 and (2+3) are the meat; 4 is copy/animation polish.

---

## Open questions

None blocking. Tunables to confirm during implementation: `REMATCH_TIMEOUT_MS = 15_000`,
bot decision window `3_000..9_000`, `BOT_REMATCH_ACCEPT_P = 0.8`. These belong alongside the
existing Arena tunables (see the `arena-tunables` memory).
