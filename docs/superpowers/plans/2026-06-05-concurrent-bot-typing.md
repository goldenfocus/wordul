# Concurrent Bot Typing (Typing Pump) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multiple bots in a race room type their guesses concurrently (naturally overlapping) instead of one-at-a-time.

**Architecture:** The playing-phase branch of the room DO's `alarm()` (src/room.ts) is replaced by a pump: each due bot's turn (decide → type → commit) becomes a self-contained `runBotTurn` promise; `runBotPump` launches turns the moment each bot comes due and `Promise.race`s in-flight turns against the next due time, keeping the DO awake while anyone is typing. Spec: `docs/superpowers/specs/2026-06-05-concurrent-bot-typing-design.md`.

**Tech Stack:** Cloudflare Durable Objects (TypeScript), vitest.

**Testing note:** There is no DO test harness in this repo (the suite tests pure helpers; `dueBots`/`botDelay`/`nextBotAlarmAt`/`planKeystrokes` are already covered and untouched). This change adds no new pure logic — the wake computation reuses `nextBotAlarmAt` with a filter. So: no new test files; the gates are the full suite + typecheck + live smoke on a seeded arena room. Do NOT build a miniflare harness for this.

---

### Task 1: Replace the sequential bot loop with `runBotTurn` + `runBotPump`

**Files:**
- Modify: `src/room.ts:1097-1135` (the playing-phase branch of `alarm()`)

- [ ] **Step 1: Replace the playing-phase block of `alarm()`**

In `src/room.ts`, the current code at lines 1097–1135 (everything from `if (this.state.phase !== "playing" || !this.state.word) return;` through the end of `alarm()`) becomes:

```ts
    if (this.state.phase !== "playing" || !this.state.word) return;
    await this.runBotPump();
  }

  // The typing pump: run every due bot's turn CONCURRENTLY, launching each the moment its
  // nextGuessAt arrives — even while other bots are mid-word — so ghost-fills overlap like a
  // real room of humans (the old sequential loop made bot B wait out bot A's whole type-out).
  // alarm() awaits this, keeping the DO awake while any turn is in flight (a dormant DO never
  // runs setTimeout — the same constraint typeOutBot documents). Exits when nothing is in
  // flight and no bot is due, then re-arms the single DO alarm to the soonest nextGuessAt.
  private async runBotPump(): Promise<void> {
    const inflight = new Map<string, Promise<void>>();
    while (this.state.phase === "playing") {
      const now = Date.now();
      for (const b of dueBots(this.state.players, now)) {
        if (inflight.has(b.username)) continue; // nextGuessAt is stale until its turn commits
        const turn = this.runBotTurn(b)
          .catch((err) => {
            // Push the bot forward so a thrown turn can't become a tight relaunch loop.
            console.error("bot turn failed", b.username, err);
            b.nextGuessAt = Date.now() + botDelay(false, !!this.state.seed, Math.random());
          })
          .finally(() => { inflight.delete(b.username); });
        inflight.set(b.username, turn);
      }
      if (inflight.size === 0) break;
      // Wake when a turn finishes OR the next NOT-in-flight bot comes due. In-flight bots
      // keep a past nextGuessAt until they commit — including them would make this race
      // resolve instantly and busy-spin.
      const waits: Promise<unknown>[] = [...inflight.values()];
      const wakeAt = nextBotAlarmAt(this.state.players.filter((p) => !inflight.has(p.username)));
      if (wakeAt != null) waits.push(new Promise<void>((r) => setTimeout(r, Math.max(0, wakeAt - now))));
      await Promise.race(waits);
    }
    if (this.state.phase === "playing") {
      const at = nextBotAlarmAt(this.state.players);
      if (at != null) void this.ctx.storage.setAlarm(at);
    }
  }

  // One bot's full turn: decide → type out in real time → commit. Self-contained so the pump
  // can run many turns concurrently. The solver/noob see ONLY a BotView (length + own masks)
  // — never this.state.word; the cheat-isolation wall is unchanged. Seeded rooms play the
  // fallible noob (mistakeRate scaled by length AND field size); /robots stays sharp.
  // Winner safety: applyGuess is synchronous up to its final await, so two turns finishing
  // near-simultaneously can't both claim state.winner.
  private async runBotTurn(b: PlayerState): Promise<void> {
    const seeded = !!this.state.seed;
    const opponents = this.state.players.length - 1;
    const view = { wordLength: this.state.wordLength, ownGuesses: b.guesses };
    const word = this.state.seed
      ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength, opponents) }, Math.random())
      : computeNextGuess(view);
    if (!word) { b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random()); return; }
    await this.typeOutBot(b.username, planKeystrokes(word, seeded ? NOOB_HAND : SHARP_HAND, Math.random));
    if (this.state.phase !== "playing" || b.status !== "playing") {
      // the round ended (or this bot was outpaced) while it was typing — drop the guess, no commit
      b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random());
      return;
    }
    await this.applyGuess(b, word);
    b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random()); // think before next row
    await this.persistAndBroadcast();
  }
```

Notes for the implementer:
- The replaced block is the whole `for (const b of dueBots(...))` loop plus the `acted` flag, the trailing `if (acted) await this.persistAndBroadcast();`, and the final re-arm — the re-arm moves into `runBotPump`'s exit. Per-batch broadcast becomes per-commit broadcast (inside `runBotTurn`).
- Also update the stale comment block at lines 1098–1102 ("advance every DUE bot in this fire… One broadcast after the batch") — it is replaced by the new method comments above; don't leave a duplicate.
- All identifiers (`dueBots`, `nextBotAlarmAt`, `botDelay`, `noobGuess`, `mistakeRateFor`, `computeNextGuess`, `planKeystrokes`, `NOOB_HAND`, `SHARP_HAND`, `PlayerState`) are already imported/in scope in room.ts — no import changes.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean exit, no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all existing tests PASS (none touch the alarm loop; pure helpers are unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/room.ts
git commit -m "feat(bots): concurrent bot typing — pump launches each turn the moment it's due"
```

### Task 2: Ship + smoke

- [ ] **Step 1: Ship via the repo pipeline**

Run from the worktree: `bash dev/ship.sh`
Expected: tests → rebase on origin/main → backup tag → fast-forward main → CI deploys. If the main push is rejected, another tab shipped first — re-run `dev/ship.sh`.

- [ ] **Step 2: Wait for CI deploy**

Run: `gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')`
Expected: deploy workflow concludes success.

- [ ] **Step 3: Live smoke**

On wordul.com, join/start a seeded arena race with 2+ bots and watch the opponent mini-boards: two bots' ghost rows must fill **at the same time** at least once during the round (3–8s type-outs inside 7–17s think cycles collide frequently). Also confirm a human first-solve still ends the round and stops all mid-word typing.

- [ ] **Step 4: Post-Deploy Summary**

Post the standard summary (what changed + 3 test steps).
