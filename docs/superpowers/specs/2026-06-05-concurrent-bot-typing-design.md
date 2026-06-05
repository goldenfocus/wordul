# Concurrent bot typing — the typing pump

**Date:** 2026-06-05 · **Status:** approved · **Surface:** `src/room.ts` only (Tier C)

## Problem

In multi-bot race rooms, bots type one-at-a-time: bot A plays out its full keystroke
timeline (3–15s of awaited real-time pauses), *then* bot B starts. Root cause: the
playing-phase branch of `alarm()` iterates due bots in a sequential `for` loop with
`await this.typeOutBot(...)` inside. A second serializer compounds it: a bot whose
`nextGuessAt` comes due while another is typing just waits for the handler to return
and the alarm to re-fire.

The await-inside-alarm shape itself is load-bearing (a dormant DO never runs timers —
see the comment at `typeOutBot`), so the fix must keep the handler alive, not detach work.

## Goal

Bots type **naturally overlapping**: each bot starts its row the moment its own
`nextGuessAt` is due, even while others are mid-word. No wire-format change — the
client already renders any number of simultaneous typing pulses.

## Design

Replace the sequential loop with a **pump** built from two new private methods on the
room DO:

### `runBotTurn(bot: PlayerState): Promise<void>`

The current loop body, extracted verbatim: decide word (noob/solver via BotView) →
`typeOutBot` (awaited real-time pulses) → re-check `phase === "playing" && bot.status
=== "playing"` → `applyGuess` → set `nextGuessAt = now + botDelay(...)` →
`persistAndBroadcast`. The no-word and round-ended-mid-type paths set `nextGuessAt`
and return without committing or broadcasting, exactly as today.

### `runBotPump(): Promise<void>`

Replaces room.ts:1103–1134 (the batch loop + re-arm):

```
inflight = Map<username, Promise<void>>
while phase === "playing":
  for b of dueBots(players, now) not already inflight:
    inflight.set(b.username, runBotTurn(b)
      .catch(e => { log; b.nextGuessAt = now + botDelay(...) })   // no tight retry loop
      .finally(() => inflight.delete(b.username)))
  if inflight.empty: break
  wakeAt = nextBotAlarmAt(players.filter(p => !inflight.has(p.username)))
  await Promise.race([...inflight.values(), wakeAt != null ? sleep(wakeAt - now) : never])
// exit: re-arm single alarm to nextBotAlarmAt(players) if still playing (unchanged)
```

**The subtle bug this dodges:** an in-flight bot's `nextGuessAt` is stale (past) until
its turn commits. Computing the wake time over *all* players would resolve the race
instantly → busy-spin. Hence the `!inflight.has(...)` filter. `dueBots` may re-return
in-flight bots each iteration; the `inflight.has` guard skips them.

## Invariants preserved

- **Cheat wall:** bots still see only a BotView (length + own masks), never `state.word`.
- **First-solve ends the race:** `typeOutBot` aborts mid-word when phase flips; each
  turn re-checks before `applyGuess`; outpaced bots drop their pending guess.
- **Winner race is safe:** `applyGuess` is synchronous up to its final await, so two
  concurrent finishes can't both claim `state.winner` (JS single-threading is the lock).
- **Self-healing:** the alarm remains the watchdog; after eviction `nextGuessAt ?? 0`
  makes bots immediately due on the next fire, as today.
- **Broadcast** moves from one-per-batch to one-per-commit (rows land live).

## Testing

- `npm test` + `npm run typecheck` stay green (pure helpers `dueBots`, `botDelay`,
  `nextBotAlarmAt`, `planKeystrokes` untouched).
- The pump is DO glue; verify by smoke on a seeded arena room post-deploy: two bots'
  ghost rows fill **at the same time**.

## Out of scope

Tuning `botDelay` pacing (7–17s think × 3–8s type-out already gives a 30–50% per-bot
typing duty cycle — collisions will be frequent with no tuning), bot personalities,
client changes.
