# Duel Bot Typing Rhythm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the duel bot a human-like typing "hand" — it emits the same count-only `typing` ghost-fill pulses a person sends before committing its word — so the live-typing feature can't trivially out the bot, with a data-driven seam for a future bot-studio.

**Architecture:** A new pure `src/rhythm.ts` (`RhythmProfile` + two presets + `planKeystrokes`) feeds the existing per-bot heartbeat. The bot's turn becomes two phases over the one DO alarm: **decide** (pick word, stash `pendingWord`, schedule the commit via `nextGuessAt`, fire cosmetic `setTimeout` pulses) and **commit** (apply the stashed word). `pendingWord` is a bot-only `PlayerState` field stripped outbound by `projectPlayerForClient` — durable, so the commit survives DO hibernation even when the cosmetic pulses don't.

**Tech Stack:** TypeScript, Cloudflare Workers Durable Objects (Hibernatable WebSockets), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-duel-bot-rhythm-design.md`

---

## File Structure

- **Create** `src/rhythm.ts` — `RhythmProfile`, `SHARP_HAND`/`NOOB_HAND`, `KeyStep`, `timelineMs`, `planKeystrokes`. Pure, no runtime imports. The only reader of rhythm data.
- **Create** `test/rhythm.test.ts` — pure unit tests for `planKeystrokes`/`timelineMs` + preset sanity.
- **Modify** `src/types.ts` — add bot-only `pendingWord?: string` to `PlayerState`.
- **Modify** `src/bots.ts` — strip `pendingWord` in `projectPlayerForClient` (next to `isBot`/`nextGuessAt`).
- **Modify** `src/room.ts` — `emitBotTyping` + `scheduleBotTyping`; two-phase due-bot loop in `alarm()`; profile selection by `seeded`; clear `pendingWord` in the `runStart` reset; import from `./rhythm.ts`.
- **Modify** `test/bots.test.ts` — assert `pendingWord` is stripped.
- **Modify** `test/room-duel.test.ts` — decide/commit, disguise, schedule, and broadcast integration cases.

---

## Task 1: `src/rhythm.ts` — the rhythm data + the `planKeystrokes` seam

**Files:**
- Create: `src/rhythm.ts`
- Test: `test/rhythm.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/rhythm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planKeystrokes, timelineMs, SHARP_HAND, NOOB_HAND, type RhythmProfile } from "../src/rhythm.ts";

// deterministic PRNG (mulberry32) so timelines are reproducible across runs
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("planKeystrokes", () => {
  it("is deterministic for a given seed", () => {
    expect(planKeystrokes("CRANE", NOOB_HAND, rngFrom(1))).toEqual(planKeystrokes("CRANE", NOOB_HAND, rngFrom(1)));
  });

  it("builds up to the full word, first beat is positive, time is non-decreasing", () => {
    const steps = planKeystrokes("CRANE", SHARP_HAND, rngFrom(2));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].atMs).toBeGreaterThan(0);
    expect(steps[steps.length - 1].len).toBe(5);
    for (let i = 1; i < steps.length; i++) expect(steps[i].atMs).toBeGreaterThanOrEqual(steps[i - 1].atMs);
  });

  it("never types beyond the word and never below zero", () => {
    for (const s of planKeystrokes("HELLO", NOOB_HAND, rngFrom(3))) {
      expect(s.len).toBeGreaterThanOrEqual(0);
      expect(s.len).toBeLessThanOrEqual(5);
    }
  });

  it("with backspaceRate=1 produces at least one len dip", () => {
    const profile: RhythmProfile = { ...SHARP_HAND, backspaceRate: 1, clearRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(4));
    expect(steps.some((s, i) => i > 0 && s.len < steps[i - 1].len)).toBe(true);
  });

  it("with backspaceRate=0 and clearRate=0 is strictly monotonic to full length", () => {
    const profile: RhythmProfile = { ...SHARP_HAND, backspaceRate: 0, clearRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(5));
    for (let i = 1; i < steps.length; i++) expect(steps[i].len).toBe(steps[i - 1].len + 1);
    expect(steps.length).toBe(5);
  });

  it("with clearRate=1 drops to zero after progress, then rebuilds to full", () => {
    const profile: RhythmProfile = { ...NOOB_HAND, clearRate: 1, backspaceRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(6));
    expect(steps.findIndex((s, i) => i > 0 && s.len === 0)).toBeGreaterThan(0);
    expect(steps[steps.length - 1].len).toBe(5);
  });
});

describe("timelineMs", () => {
  it("is 0 for an empty timeline and the last atMs otherwise", () => {
    expect(timelineMs([])).toBe(0);
    expect(timelineMs([{ atMs: 10, len: 1 }, { atMs: 42, len: 2 }])).toBe(42);
  });
});

describe("presets", () => {
  it("SHARP_HAND is faster and cleaner than NOOB_HAND across every knob", () => {
    expect(SHARP_HAND.firstKeyMs).toBeLessThan(NOOB_HAND.firstKeyMs);
    expect(SHARP_HAND.readPauseMs).toBeLessThan(NOOB_HAND.readPauseMs);
    expect(SHARP_HAND.keyMeanMs).toBeLessThan(NOOB_HAND.keyMeanMs);
    expect(SHARP_HAND.keyJitter).toBeLessThan(NOOB_HAND.keyJitter);
    expect(SHARP_HAND.backspaceRate).toBeLessThan(NOOB_HAND.backspaceRate);
    expect(SHARP_HAND.clearRate).toBeLessThanOrEqual(NOOB_HAND.clearRate);
  });

  it("SHARP_HAND types a word faster than NOOB_HAND on average", () => {
    let sharp = 0, noob = 0;
    for (let s = 0; s < 200; s++) {
      sharp += timelineMs(planKeystrokes("CRANE", SHARP_HAND, rngFrom(s)));
      noob += timelineMs(planKeystrokes("CRANE", NOOB_HAND, rngFrom(s)));
    }
    expect(sharp / 200).toBeLessThan(noob / 200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- rhythm`
Expected: FAIL — cannot resolve `../src/rhythm.ts`.

- [ ] **Step 3: Implement `src/rhythm.ts`**

Create `src/rhythm.ts`:

```ts
// Per-bot typing "hand": the rhythm data + the SINGLE pure planner that turns a decided word
// into a timed sequence of count-only ghost-fill pulses (the same {len} a human's keystrokes
// relay). This is the only code that reads a RhythmProfile. Future bot-studio vibes (keyboard
// layout, extrovert/cheater/guesser) are smarter planners of THIS signature — the emitter, the
// wire format, and the DO loop never change. No runtime imports: pure and unit-testable.

export interface RhythmProfile {
  firstKeyMs: number;     // reaction delay before the first key of a row (keeps atMs > 0)
  readPauseMs: number;    // a flustered restart beat (used after an esc full-clear)
  keyMeanMs: number;      // average gap between consecutive keystrokes
  keyJitter: number;      // 0..1 — how irregular the per-key gaps are
  backspaceRate: number;  // 0..1 — chance a row includes a single/double backspace fumble
  clearRate: number;      // 0..1 — chance a row includes an esc full-clear-and-restart
}

export const SHARP_HAND: RhythmProfile = {
  firstKeyMs: 300, readPauseMs: 400, keyMeanMs: 120, keyJitter: 0.15, backspaceRate: 0.02, clearRate: 0.0,
};

export const NOOB_HAND: RhythmProfile = {
  firstKeyMs: 900, readPauseMs: 1500, keyMeanMs: 280, keyJitter: 0.5, backspaceRate: 0.25, clearRate: 0.06,
};

export type KeyStep = { atMs: number; len: number }; // len = filled-cell count at time atMs (ms from decide)

// The row's full typing span: the last step's atMs (0 for an empty timeline).
export function timelineMs(steps: KeyStep[]): number {
  return steps.length ? steps[steps.length - 1].atMs : 0;
}

// One per-key gap around keyMeanMs, spread by jitter, floored at 20% of the mean so it stays positive.
function keyGap(profile: RhythmProfile, rng: () => number): number {
  const j = Math.max(0, Math.min(1, profile.keyJitter));
  const factor = 1 + (rng() * 2 - 1) * j;               // symmetric jitter in [1-j, 1+j]
  const floor = Math.round(profile.keyMeanMs * 0.2);
  return Math.max(floor, Math.round(profile.keyMeanMs * factor));
}

/**
 * Turn a decided word into a timed sequence of count-only ghost-fill pulses, including the
 * occasional human correction (single/double backspace, esc full-clear). Pure & deterministic
 * given `rng`. `len` is the filled-cell count at `atMs`; the final step is always the full word.
 */
export function planKeystrokes(word: string, profile: RhythmProfile, rng: () => number): KeyStep[] {
  const target = word.length;
  if (target <= 0) return [];
  const steps: KeyStep[] = [];
  let t = Math.max(1, profile.firstKeyMs);               // reaction before the first key (atMs > 0)
  let len = 0;

  // optional esc full-clear-and-restart once, before the real type-out
  if (rng() < profile.clearRate) {
    const partial = 1 + Math.floor(rng() * Math.max(1, target - 1)); // type 1..target-1 first
    for (let i = 0; i < partial; i++) { len += 1; steps.push({ atMs: t, len }); t += keyGap(profile, rng); }
    len = 0; steps.push({ atMs: t, len });               // esc → row cleared
    t += Math.round(profile.readPauseMs * 0.6);          // flustered restart beat
  }

  // optional one backspace fumble during the real type-out (single, or a fast double-tap)
  const willBackspace = rng() < profile.backspaceRate;
  const doubleBack = willBackspace && rng() < 0.4;
  const fumbleAt = willBackspace ? 1 + Math.floor(rng() * Math.max(1, target - 1)) : -1;
  let fumbled = false;

  while (len < target) {
    len += 1; steps.push({ atMs: t, len }); t += keyGap(profile, rng);
    if (!fumbled && len === fumbleAt) {
      fumbled = true;
      len -= 1; steps.push({ atMs: t, len }); t += Math.round(keyGap(profile, rng) * 0.5); // fast delete
      if (doubleBack && len > 0) { len -= 1; steps.push({ atMs: t, len }); t += Math.round(keyGap(profile, rng) * 0.5); }
    }
  }
  return steps;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- rhythm`
Expected: PASS (all `planKeystrokes`, `timelineMs`, and preset cases green).

- [ ] **Step 5: Commit**

```bash
git add src/rhythm.ts test/rhythm.test.ts
git commit -m "feat(duel): RhythmProfile + planKeystrokes — the bot typing-hand seam"
```

---

## Task 2: `pendingWord` field + strip it from the outbound projection

**Files:**
- Modify: `src/types.ts` (PlayerState, near line 56)
- Modify: `src/bots.ts:73-76` (projectPlayerForClient)
- Test: `test/bots.test.ts`

- [ ] **Step 1: Add the bot-only field to `PlayerState`**

In `src/types.ts`, the `PlayerState` type ends with `nextGuessAt?` at line 56. Add a sibling field right after it (before the closing `};` at line 57):

```ts
  pendingWord?: string;    // bot-only: word decided this turn, "typed out" then committed next alarm; stripped outbound like nextGuessAt
```

- [ ] **Step 2: Write the failing strip test**

In `test/bots.test.ts`, add this test inside the existing top-level `describe` (or append a new `describe` block at end of file):

```ts
import { projectPlayerForClient } from "../src/bots.ts";
import type { PlayerState } from "../src/types.ts";

describe("projectPlayerForClient — pendingWord disguise", () => {
  it("strips the bot's pending (decided-but-uncommitted) word", () => {
    const bot: PlayerState = {
      username: "maya", connected: true, guesses: [], status: "playing",
      isBot: true, ready: true, role: "duelist", points: 0, pointsSpent: 0,
      nextGuessAt: 123, pendingWord: "CRANE",
    };
    const out = projectPlayerForClient(bot) as Record<string, unknown>;
    expect("pendingWord" in out).toBe(false);
    expect("isBot" in out).toBe(false);
    expect("nextGuessAt" in out).toBe(false);
    expect(out.username).toBe("maya");
  });
});
```

(If `test/bots.test.ts` already imports `describe/it/expect` and `projectPlayerForClient`, do not duplicate those imports — only add the `describe` block.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- bots`
Expected: FAIL — `"pendingWord" in out` is `true` (it currently passes through `...rest`).

- [ ] **Step 4: Strip it in `projectPlayerForClient`**

In `src/bots.ts`, replace lines 73-76:

```ts
export function projectPlayerForClient(p: PlayerState): Omit<PlayerState, "isBot" | "nextGuessAt"> {
  const { isBot: _isBot, nextGuessAt: _nextGuessAt, ...rest } = p;
  return rest;
}
```

with:

```ts
export function projectPlayerForClient(p: PlayerState): Omit<PlayerState, "isBot" | "nextGuessAt" | "pendingWord"> {
  const { isBot: _isBot, nextGuessAt: _nextGuessAt, pendingWord: _pendingWord, ...rest } = p;
  return rest;
}
```

Also update the doc-comment above it (line 68-71) to mention the third stripped tell:

```ts
/**
 * The disguise. Strips the server-only bot tells — `isBot`, `nextGuessAt` (the per-bot heartbeat
 * schedule), AND `pendingWord` (the decided-but-uncommitted guess) — while letting every other
 * PlayerState field pass through automatically. Both snapshotFor branches route through this.
 */
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- bots`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/bots.ts test/bots.test.ts
git commit -m "feat(duel): pendingWord on PlayerState, stripped by the disguise (cheat-safe)"
```

---

## Task 3: `emitBotTyping` + `scheduleBotTyping` in the Room DO

**Files:**
- Modify: `src/room.ts` (import block near top; insert two methods after `onTyping`, which closes at line 857)
- Test: `test/room-duel.test.ts`

- [ ] **Step 1: Write the failing broadcast test**

In `test/room-duel.test.ts`, append inside the top-level `describe(...)` block (before its closing `});` at line 196):

```ts
  it("emitBotTyping broadcasts a count-only typing pulse to clients", async () => {
    const { room, sockets } = makeRoom("robots");
    const a = mockWs();
    await join(room, a, "alice");
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    room.state.goAt = Date.now() - 1;
    await room.alarm();
    const bot = room.state.players.find((p) => p.isBot)!;

    const got: Array<{ type: string; username?: string; len?: number }> = [];
    (sockets[0] as unknown as { send: (s: string) => void }).send = (s: string) => got.push(JSON.parse(s));

    (room as unknown as { emitBotTyping: (u: string, n: number) => void }).emitBotTyping(bot.username, 3);

    const pulse = got.find((m) => m.type === "typing");
    expect(pulse).toBeTruthy();
    expect(pulse!.username).toBe(bot.username);
    expect(pulse!.len).toBe(3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- room-duel`
Expected: FAIL — `room.emitBotTyping is not a function`.

- [ ] **Step 3: Add the import and the two methods**

In `src/room.ts`, add a rhythm import to the import block near the top (alongside the existing `./room-core.ts` / `./noob.ts` / `./solver.ts` imports):

```ts
import { planKeystrokes, timelineMs, NOOB_HAND, SHARP_HAND, type KeyStep } from "./rhythm.ts";
```

Then insert these two methods immediately AFTER `onTyping` (which closes with `}` at line 857) and BEFORE the `// Shared guess core` comment at line 859:

```ts
  // Bot counterpart to onTyping: broadcast a count-only ghost-fill pulse for a (socket-less) bot.
  // Same wire shape as a human's relay, sent to everyone (the bot has no socket to skip). Ephemeral
  // — no storage write, no snapshot. Guards mirror onTyping so it no-ops once the round is over.
  private emitBotTyping(username: string, len: number): void {
    if (this.state.phase !== "playing" || this.state.isDaily) return;
    const bot = this.state.players.find((p) => p.username === username);
    if (!bot || !bot.isBot || bot.status !== "playing") return;
    const n = Math.max(0, Math.min(this.state.wordLength, Math.floor(len)));
    const payload = JSON.stringify({ type: "typing", username, len: n } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* socket may be closing; ignore */ }
    }
  }

  // Animate a decided word as cosmetic ghost-fill pulses over the planned timeline. Best-effort:
  // these setTimeouts are ephemeral (a hibernating DO may drop them) — the durable nextGuessAt
  // COMMIT in alarm() still lands the word, so a dropped animation degrades to today's instant pop.
  private scheduleBotTyping(username: string, steps: KeyStep[]): void {
    for (const step of steps) {
      setTimeout(() => this.emitBotTyping(username, step.len), step.atMs);
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- room-duel`
Expected: PASS (the new pulse test green; existing duel cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/room.ts test/room-duel.test.ts
git commit -m "feat(duel): emitBotTyping + scheduleBotTyping (bot ghost-fill pulses)"
```

---

## Task 4: Two-phase due-bot loop in `alarm()` (decide → type → commit)

**Files:**
- Modify: `src/room.ts:1012-1023` (the due-bot loop inside `alarm()`)
- Test: `test/room-duel.test.ts`

- [ ] **Step 1: Write the failing decide/commit/disguise/schedule tests**

In `test/room-duel.test.ts`, append inside the top-level `describe(...)` block (before its closing `});`):

```ts
  // helper: drive a fresh /robots room to a live round with one worduler duelist
  async function liveRobotRoom() {
    const { room, sockets } = makeRoom("robots");
    const a = mockWs();
    await join(room, a, "alice");
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    room.state.goAt = Date.now() - 1;
    await room.alarm();
    const bot = room.state.players.find((p) => p.isBot)!;
    return { room, sockets, bot };
  }

  it("the worduler decides+types first (pendingWord set, no guess yet), then commits next beat", async () => {
    const { room, bot } = await liveRobotRoom();
    // keep this a pure durable-path test: don't fire the cosmetic timers
    vi.spyOn(room as unknown as { scheduleBotTyping: () => void }, "scheduleBotTyping").mockImplementation(() => {});

    bot.nextGuessAt = Date.now() - 1;          // force DECIDE due
    await room.alarm();
    expect(typeof bot.pendingWord).toBe("string");
    expect((bot.pendingWord as string).length).toBe(5);
    expect(bot.guesses.length).toBe(0);        // typed, but has NOT committed
    expect(bot.nextGuessAt!).toBeGreaterThan(Date.now()); // commit scheduled ahead

    const pending = bot.pendingWord as string;
    bot.nextGuessAt = Date.now() - 1;          // force COMMIT due
    await room.alarm();
    expect(bot.guesses.length).toBe(1);
    expect(bot.guesses[0].word).toBe(pending); // the exact decided word lands (proves it was stashed)
    expect(bot.pendingWord).toBeUndefined();
  });

  it("commits even if no cosmetic pulse ever fires (hibernation fallback)", async () => {
    const { room, bot } = await liveRobotRoom();
    vi.spyOn(room as unknown as { scheduleBotTyping: () => void }, "scheduleBotTyping").mockImplementation(() => {});
    bot.nextGuessAt = Date.now() - 1; await room.alarm(); // decide (no pulses scheduled at all)
    bot.nextGuessAt = Date.now() - 1; await room.alarm(); // commit
    expect(bot.guesses.length).toBe(1);
  });

  it("never leaks the worduler's pending word to clients", async () => {
    const { room, bot } = await liveRobotRoom();
    vi.spyOn(room as unknown as { scheduleBotTyping: () => void }, "scheduleBotTyping").mockImplementation(() => {});
    bot.nextGuessAt = Date.now() - 1; await room.alarm();
    expect(bot.pendingWord).toBeTruthy();

    const snap = (room as unknown as { snapshotFor: (v: string | null) => { players: Array<Record<string, unknown>> } }).snapshotFor("alice");
    const view = snap.players.find((p) => p.username === bot.username)!;
    expect("pendingWord" in view).toBe(false);
    expect("isBot" in view).toBe(false);
    expect("nextGuessAt" in view).toBe(false);
  });

  it("on decide, schedules a non-empty ghost-fill timeline for the worduler", async () => {
    const { room, bot } = await liveRobotRoom();
    const spy = vi.spyOn(room as unknown as { scheduleBotTyping: (u: string, s: unknown[]) => void }, "scheduleBotTyping").mockImplementation(() => {});
    bot.nextGuessAt = Date.now() - 1;
    await room.alarm();
    expect(spy).toHaveBeenCalledTimes(1);
    const [username, steps] = spy.mock.calls[0];
    expect(username).toBe(bot.username);
    expect((steps as unknown[]).length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- room-duel`
Expected: FAIL — the bot still commits in one alarm fire, so `bot.guesses.length` is `1` (not `0`) after the first decide alarm, and `pendingWord` is `undefined`.

- [ ] **Step 3: Rewrite the due-bot loop**

In `src/room.ts`, replace the loop body at lines 1012-1023:

```ts
    let acted = false;
    for (const b of dueBots(this.state.players, now)) {
      if (this.state.phase !== "playing") break;          // a first-solve mid-batch ended it
      if (b.status !== "playing") continue;               // outpaced→lost by an earlier bot this batch
      const view = { wordLength: this.state.wordLength, ownGuesses: b.guesses };
      const word = this.state.seed
        ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength, opponents) }, Math.random())
        : computeNextGuess(view);
      if (word) await this.applyGuess(b, word);
      b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random());
      acted = true;
    }
```

with:

```ts
    let acted = false;
    for (const b of dueBots(this.state.players, now)) {
      if (this.state.phase !== "playing") break;          // a first-solve mid-batch ended it
      if (b.status !== "playing") continue;               // outpaced→lost by an earlier bot this batch

      if (b.pendingWord) {
        // COMMIT: the bot "finished typing" the word it decided last fire — land it now.
        const word = b.pendingWord;
        b.pendingWord = undefined;
        await this.applyGuess(b, word);
        b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random()); // think before next row
        acted = true;
        continue;
      }

      // DECIDE: pick the word, then "type" it (cosmetic pulses) and commit on the next fire.
      const view = { wordLength: this.state.wordLength, ownGuesses: b.guesses };
      const word = this.state.seed
        ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength, opponents) }, Math.random())
        : computeNextGuess(view);
      if (!word) { b.nextGuessAt = Date.now() + botDelay(false, seeded, Math.random()); continue; }
      const steps = planKeystrokes(word, seeded ? NOOB_HAND : SHARP_HAND, Math.random);
      b.pendingWord = word;                               // durable truth (stripped outbound)
      b.nextGuessAt = Date.now() + Math.max(1, timelineMs(steps)); // commit when the typing span elapses
      this.scheduleBotTyping(b.username, steps);
      acted = true;
    }
```

(`now`, `seeded`, and `opponents` remain defined just above the loop at lines 1009-1011 — leave them.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- room-duel`
Expected: PASS — decide sets `pendingWord` without guessing; commit lands the exact word; disguise hides it; schedule fires once.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts test/room-duel.test.ts
git commit -m "feat(duel): two-phase bot turn — decide+type, then commit the stashed word"
```

---

## Task 5: Clear `pendingWord` on round reset

**Files:**
- Modify: `src/room.ts:677-684` (the `runStart` per-player reset loop)
- Test: `test/room-duel.test.ts`

- [ ] **Step 1: Write the failing reset test**

In `test/room-duel.test.ts`, append inside the top-level `describe(...)` block:

```ts
  it("clears a stale pendingWord when a new round starts", async () => {
    const { room, bot } = await liveRobotRoom();
    bot.pendingWord = "STALE";                 // simulate a round that ended mid-type
    await (room as unknown as { runStart: (who: string) => Promise<boolean> }).runStart("alice");
    expect(bot.pendingWord).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- room-duel`
Expected: FAIL — `bot.pendingWord` is still `"STALE"` after `runStart`.

- [ ] **Step 3: Clear it in the reset loop**

In `src/room.ts`, the `runStart` reset loop at lines 677-684 currently reads:

```ts
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
      p.points = 0;
      p.pointsSpent = 0;
      p.revealHints = 0;
      p.vowelHints = 0;
    }
```

Add the `pendingWord` clear as the last line inside the loop:

```ts
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
      p.points = 0;
      p.pointsSpent = 0;
      p.revealHints = 0;
      p.vowelHints = 0;
      p.pendingWord = undefined;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- room-duel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts test/room-duel.test.ts
git commit -m "fix(duel): clear bot pendingWord on round reset"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all existing suites plus `rhythm`, `bots`, and the new `room-duel` cases green.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 3: Ship** (only on the owner's go — this is the deploy button)

Run: `bash dev/ship.sh`
This tests → rebases on `origin/main` → tags a prod backup → fast-forwards main → CI deploys `origin/main`.

---

## Self-Review

**Spec coverage:**
- §4 RhythmProfile + presets → Task 1. ✓
- §5 `planKeystrokes`/`timelineMs` seam → Task 1. ✓
- §6 two-phase over the per-bot heartbeat; `pendingWord` durable+stripped; `emitBotTyping`/`scheduleBotTyping`; profile-by-`seeded`; round-reset clear; hibernation fallback → Tasks 2-5. ✓
- §7 disguise (strip `pendingWord`) → Task 2 + Task 4 disguise test. ✓
- §8 tests (pure units, decide/commit, disguise, cosmetic, hibernation fallback) → Tasks 1, 3, 4, 5. ✓
- §3 non-goals (no new message type, count-only, no client letters, no bot-studio UI) → respected; nothing in the plan adds them. ✓

**Placeholder scan:** none — every code/edit step shows the full code or the exact before/after.

**Type consistency:** `RhythmProfile`, `KeyStep`, `planKeystrokes`, `timelineMs`, `SHARP_HAND`, `NOOB_HAND` are defined in Task 1 and used identically in Tasks 3-4. `pendingWord?: string` defined in Task 2, used in Tasks 2/4/5. `emitBotTyping(username, len)` / `scheduleBotTyping(username, steps)` signatures defined in Task 3 and called with matching args in Task 4. `nextGuessAt` reused as the two-phase clock throughout. Consistent.
