# Living Arena — Increment 1: Breathing Count + Length Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the arena stop reading as a metronome — replace the fixed "3 rooms, all 5-letter" seed loop with a drifting room count, jittered one-at-a-time spawns, weighted word lengths, per-room lifetimes, and length-scaled bot fallibility — without touching the Room's single-bot model.

**Architecture:** All randomness stays in the DO wrapper (`arena.ts`) + `room.ts`; `arena-core.ts` and `noob.ts` stay pure functions taking injected `roll`s (same discipline as `noobGuess(view, profile, roll)`), so every decision is unit-tested under plain Vitest. Seats stay `1/2` this increment (multi-bot is Increment 2). The seeded `/seed` contract already carries `wordLength`, so variable lengths flow through unchanged.

**Tech Stack:** TypeScript, Cloudflare Durable Objects, Vitest. Base: `feat/living-arena` off `origin/main`. ARENA migration already at **v6** — no migration in this increment.

**Spec:** `docs/superpowers/specs/2026-06-04-living-arena-v2-design.md`

---

### Task 1: Length-scaled bot fallibility (`noob.ts`)

**Files:**
- Modify: `src/noob.ts`
- Test: `test/noob.test.ts`

- [ ] **Step 1: Write the failing test** — first extend the EXISTING top import in `test/noob.test.ts` (do NOT add a second `import` of `noobGuess`/`NOOB` — re-declaring them is a syntax error):

```ts
import { noobGuess, NOOB, mistakeRateFor } from "../src/noob.ts";
```

Then append a new describe block:

```ts
describe("mistakeRateFor", () => {
  it("equals the base NOOB rate at length 5 and below", () => {
    expect(mistakeRateFor(4)).toBeCloseTo(NOOB.mistakeRate);
    expect(mistakeRateFor(5)).toBeCloseTo(NOOB.mistakeRate);
  });

  it("rises monotonically with length above 5", () => {
    expect(mistakeRateFor(6)).toBeGreaterThan(mistakeRateFor(5));
    expect(mistakeRateFor(7)).toBeGreaterThan(mistakeRateFor(6));
    expect(mistakeRateFor(9)).toBeGreaterThan(mistakeRateFor(7));
  });

  it("never reaches certainty (stays a valid probability)", () => {
    for (const len of [5, 6, 7, 8, 9, 10, 11, 12]) {
      const r = mistakeRateFor(len);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/noob.test.ts -t mistakeRateFor`
Expected: FAIL — `mistakeRateFor is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation** — add to `src/noob.ts` (after the `NOOB` const):

```ts
// Longer words are genuinely harder, so a single fixed mistakeRate would make a long-word
// room unwinnable for a human. Scale fallibility UP with length: base rate at ≤5 letters,
// +0.06 per extra letter, capped below certainty. Still 100% blind — this only changes how
// often noobGuess takes the believable-slip branch, never what it can see.
export function mistakeRateFor(length: number): number {
  const over = Math.max(0, length - 5);
  return Math.min(0.7, NOOB.mistakeRate + 0.06 * over);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/noob.test.ts`
Expected: PASS (all noob tests, including the blindness src-guard).

- [ ] **Step 5: Commit**

```bash
git add src/noob.ts test/noob.test.ts
git commit -m "feat(noob): mistakeRateFor — scale bot fallibility by word length"
```

---

### Task 2: Pure arena variety helpers (`arena-core.ts`)

**Files:**
- Modify: `src/arena-core.ts`
- Test: `test/arena-core.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/arena-core.test.ts`:

```ts
import {
  driftTarget,
  rollWordLength,
  rollLifetime,
  ARENA_MIN_OPEN,
  ARENA_MAX_OPEN,
  LIFETIME_MIN_MS,
  LIFETIME_MAX_MS,
  LENGTH_WEIGHTS,
} from "../src/arena-core.ts";

describe("driftTarget", () => {
  it("steps down on a low roll, up on a high roll, holds in the middle", () => {
    expect(driftTarget(3, 0.0)).toBe(2);
    expect(driftTarget(3, 0.5)).toBe(3);
    expect(driftTarget(3, 0.99)).toBe(4);
  });

  it("clamps to [MIN, MAX]", () => {
    expect(driftTarget(ARENA_MIN_OPEN, 0.0)).toBe(ARENA_MIN_OPEN);
    expect(driftTarget(ARENA_MAX_OPEN, 0.99)).toBe(ARENA_MAX_OPEN);
  });

  it("recovers a sane value from a non-finite current", () => {
    expect(driftTarget(NaN, 0.5)).toBeGreaterThanOrEqual(ARENA_MIN_OPEN);
    expect(driftTarget(NaN, 0.5)).toBeLessThanOrEqual(ARENA_MAX_OPEN);
  });
});

describe("rollWordLength", () => {
  it("only ever returns a length present in the weight table", () => {
    const valid = new Set(LENGTH_WEIGHTS.map(([len]) => len));
    for (const roll of [0, 0.1, 0.33, 0.5, 0.75, 0.9, 0.999]) {
      expect(valid.has(rollWordLength(roll))).toBe(true);
    }
  });

  it("returns the first length at roll 0 and the last at roll ~1", () => {
    expect(rollWordLength(0)).toBe(LENGTH_WEIGHTS[0][0]);
    expect(rollWordLength(0.999999)).toBe(LENGTH_WEIGHTS[LENGTH_WEIGHTS.length - 1][0]);
  });
});

describe("rollLifetime", () => {
  it("maps roll 0..1 across [MIN, MAX]", () => {
    expect(rollLifetime(0)).toBe(LIFETIME_MIN_MS);
    expect(rollLifetime(1)).toBe(LIFETIME_MAX_MS);
    const mid = rollLifetime(0.5);
    expect(mid).toBeGreaterThan(LIFETIME_MIN_MS);
    expect(mid).toBeLessThan(LIFETIME_MAX_MS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/arena-core.test.ts -t driftTarget`
Expected: FAIL — `driftTarget is not a function`.

- [ ] **Step 3: Write minimal implementation** — add to `src/arena-core.ts` (near the other `export const`s, after `MAX_SEEDED`):

```ts
// --- Living Arena (v2 inc.1): liveliness knobs. desiredOpen drifts within this band; each
// seeded room gets a jittered lifetime and a weighted word length. All chosen by PURE
// helpers taking an injected roll so arena.ts (Math.random) stays the only impure layer.
export const ARENA_MIN_OPEN = 1;
export const ARENA_MAX_OPEN = 6;
export const LIFETIME_MIN_MS = 45_000;
export const LIFETIME_MAX_MS = 180_000;
// Friendly lengths common, long ones rare — atmosphere without a wall of brutal rooms.
export const LENGTH_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [4, 3], [5, 5], [6, 3], [7, 2], [8, 1], [9, 1],
];

// Random-walk the desired open-room count one step within [MIN, MAX]. roll in [0,1):
// low third → -1, high third → +1, middle → hold. A slow tide, never a sawtooth.
export function driftTarget(current: number, roll: number): number {
  const base = Number.isFinite(current) ? current : ARENA_MIN_OPEN;
  let next = base;
  if (roll < 1 / 3) next = base - 1;
  else if (roll >= 2 / 3) next = base + 1;
  return Math.max(ARENA_MIN_OPEN, Math.min(ARENA_MAX_OPEN, next));
}

// Weighted pick of a seeded room's word length. roll in [0,1).
export function rollWordLength(roll: number): number {
  const total = LENGTH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let t = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const [len, w] of LENGTH_WEIGHTS) {
    if (t < w) return len;
    t -= w;
  }
  return LENGTH_WEIGHTS[LENGTH_WEIGHTS.length - 1][0];
}

// A seeded room's jittered expiry budget (ms from mint). roll in [0,1).
export function rollLifetime(roll: number): number {
  const r = Math.max(0, Math.min(1, roll));
  return Math.round(LIFETIME_MIN_MS + r * (LIFETIME_MAX_MS - LIFETIME_MIN_MS));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/arena-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/arena-core.ts test/arena-core.test.ts
git commit -m "feat(arena-core): driftTarget + rollWordLength + rollLifetime pure helpers"
```

---

### Task 3: Per-room lifetime in `SeedRec` + `prune` (`arena-core.ts`)

**Files:**
- Modify: `src/arena-core.ts`
- Test: `test/arena-core.test.ts`

- [ ] **Step 1: Add `lifetimeMs` to `SeedRec`** (structural prerequisite — must land before the test helper references it) — edit the type in `src/arena-core.ts`:

```ts
  seats: string; // "1/2" (multi-bot seat variety is Increment 2)
  mintedAt: number; // epoch ms at mint
  lifetimeMs: number; // jittered expiry budget from mint; 0 ⇒ fall back to MAX_OPEN_MS
  status: SeedStatus;
```

- [ ] **Step 2: Update the test `rec()` helper** so it satisfies the new required field — edit the helper near the top of `test/arena-core.test.ts` to add `lifetimeMs: 0,` (0 → falsy → fallback path, preserving every existing prune test's semantics):

```ts
    mintedAt: 0,
    lifetimeMs: 0,
    status: "minted",
    ...over,
```

- [ ] **Step 3: Write the failing test** — append to `test/arena-core.test.ts`:

```ts
describe("prune honors per-rec lifetimeMs", () => {
  it("drops a registered rec past its own lifetimeMs", () => {
    let s = withRec(emptyArenaState(), rec({ status: "minted", mintedAt: 0, lifetimeMs: 50_000 }));
    s = apply(s, { type: "register", path: "arena/maya-0" });
    // 60s elapsed > 50s budget → pruned, even though far under the 4h MAX_OPEN_MS.
    expect(prune(s, 60_000).seeded["arena/maya-0"]).toBeUndefined();
  });

  it("keeps a registered rec inside its lifetimeMs", () => {
    let s = withRec(emptyArenaState(), rec({ status: "minted", mintedAt: 0, lifetimeMs: 120_000 }));
    s = apply(s, { type: "register", path: "arena/maya-0" });
    expect(prune(s, 60_000).seeded["arena/maya-0"]).toBeDefined();
  });

  it("falls back to MAX_OPEN_MS when lifetimeMs is missing/zero (legacy recs)", () => {
    let s = withRec(emptyArenaState(), rec({ status: "minted", mintedAt: 0, lifetimeMs: 0 }));
    s = apply(s, { type: "register", path: "arena/maya-0" });
    expect(prune(s, 60_000).seeded["arena/maya-0"]).toBeDefined(); // 60s < 4h
    expect(prune(s, MAX_OPEN_MS + 1).seeded["arena/maya-0"]).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/arena-core.test.ts -t "per-rec lifetimeMs"`
Expected: FAIL — registered rec is NOT pruned at 60s (current `prune` only checks `MAX_OPEN_MS`).

- [ ] **Step 5: Teach `prune` the per-rec budget** — replace the registered-prune line in `src/arena-core.ts`:

```ts
    if (r.status === "minted" && nowMs - r.mintedAt > STALE_MS) continue;
    if (r.status === "registered") {
      const budget = r.lifetimeMs && r.lifetimeMs > 0 ? r.lifetimeMs : MAX_OPEN_MS;
      if (nowMs - r.mintedAt > budget) continue;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/arena-core.test.ts`
Expected: PASS (new lifetime tests + all existing prune/reducer tests).

- [ ] **Step 7: Commit**

```bash
git add src/arena-core.ts test/arena-core.test.ts
git commit -m "feat(arena-core): per-room lifetimeMs on SeedRec, honored in prune (legacy fallback)"
```

---

### Task 4: Wire variety into the seed loop (`arena.ts` DO)

**Files:**
- Modify: `src/arena.ts`

> No new unit test: `arena.ts` is the impure DO wrapper (Math.random/Date.now/alarm), excluded from Vitest by design — the logic it calls is already covered in Tasks 2–3. Verify by typecheck + the manual smoke at the end.

- [ ] **Step 1: Extend the imports** — in `src/arena.ts`, replace the `arena-core.ts` import block to add the new helpers (keep `TARGET_OPEN` as the legacy default seed for `desiredOpen`):

```ts
import {
  emptyArenaState,
  apply,
  prune,
  openGames,
  liveCount,
  seedPaths,
  driftTarget,
  rollWordLength,
  rollLifetime,
  TARGET_OPEN,
  MAX_SEEDED,
  type ArenaState,
  type SeedRec,
  type OpenGame,
} from "./arena-core.ts";
```

- [ ] **Step 2: Carry `desiredOpen` on the state** — add the optional field where `ArenaState` is consumed. In `src/arena-core.ts`, extend the type:

```ts
export type ArenaState = { seeded: Record<string, SeedRec>; seedCount: number; desiredOpen?: number };
```

- [ ] **Step 3: Replace the `alarm()` body** — swap the fixed-target batch loop for a drifting target that mints **one room per tick** with a rolled length + lifetime, then reschedules on a jittered delay (short while below target → rooms trickle in over seconds; long when satisfied). Replace the whole `async alarm()` method in `src/arena.ts`:

```ts
  async alarm(): Promise<void> {
    let s = emptyArenaState();
    try {
      s = prune(await this.load(), Date.now());
      // Drift the desired open-room count one step (a slow tide, not the old constant 3).
      s = { ...s, desiredOpen: driftTarget(s.desiredOpen ?? TARGET_OPEN, Math.random()) };
      await this.save(s);
      // Mint AT MOST ONE room per tick so rooms appear one-at-a-time over seconds instead
      // of snapping in as a batch. The jittered reschedule below paces the trickle.
      const target = s.desiredOpen ?? TARGET_OPEN;
      if (liveCount(s) < target && Object.keys(s.seeded).length < MAX_SEEDED) {
        const openIds = new Set(
          Object.values(s.seeded).filter((r) => r.status !== "closed").map((r) => r.personaId),
        );
        const persona = pickPersona(s.seedCount, openIds);
        if (persona) {
          const wordLength = rollWordLength(Math.random());
          const lifetimeMs = rollLifetime(Math.random());
          const { path, routePath } = seedPaths(persona.id, s.seedCount);
          const rec: SeedRec = {
            path,
            routePath,
            name: `${persona.name}'s room`,
            host: persona.name,
            personaId: persona.id,
            personaIcon: persona.avatar,
            edition: persona.edition,
            wordLength,
            seats: "1/2",
            mintedAt: Date.now(),
            lifetimeMs,
            status: "minted",
          };
          s = apply(s, { type: "mint", rec });
          await this.save(s);
          let ok = false;
          try {
            const room = this.env.ROOM.get(this.env.ROOM.idFromName(path));
            const res = await room.fetch(new Request("https://do/seed", {
              method: "POST",
              body: JSON.stringify({
                path,
                persona: { id: persona.id, name: persona.name, avatar: persona.avatar },
                profile: "noob",
                edition: persona.edition,
                wordLength,
              }),
              headers: { "content-type": "application/json" },
            }));
            ok = res.ok;
          } catch (e) {
            console.error("arena seed room failed", path, (e as Error).message);
          }
          s = apply(s, ok ? { type: "register", path } : { type: "close", path });
          await this.save(s);
        }
      }
    } catch (e) {
      console.error("arena alarm", (e as Error).message);
    } finally {
      // Below target → short jittered gap (3–12s) so the next room trickles in soon.
      // At/over target → long idle drift (30–90s). Produces the "land alone, wait, a room
      // appears" cadence instead of an instant full set.
      const target = s.desiredOpen ?? TARGET_OPEN;
      const below = liveCount(s) < target && Object.keys(s.seeded).length < MAX_SEEDED;
      const delay = below
        ? 3_000 + Math.floor(Math.random() * 9_000)
        : 30_000 + Math.floor(Math.random() * 60_000);
      void this.ctx.storage.setAlarm(Date.now() + delay);
    }
  }
```

- [ ] **Step 4: Verify the build typechecks**

Run: `npm run typecheck`
Expected: PASS (no type errors; `desiredOpen` optional, `SeedRec.lifetimeMs` set at the one mint site).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — all existing arena/bots/noob/room tests green.

- [ ] **Step 6: Commit**

```bash
git add src/arena.ts src/arena-core.ts
git commit -m "feat(arena): breathing seed loop — drifting count, one-per-tick trickle, rolled length+lifetime"
```

---

### Task 5: Length-scaled noob in the Room alarm (`room.ts`)

**Files:**
- Modify: `src/room.ts`

> Behavioral wiring inside the DO alarm; covered by the `mistakeRateFor` unit test (Task 1) + existing room tests. Verify via typecheck + suite.

- [ ] **Step 1: Import `mistakeRateFor`** — edit the noob import in `src/room.ts` (currently `import { noobGuess, NOOB } from "./noob.ts";`):

```ts
import { noobGuess, NOOB, mistakeRateFor } from "./noob.ts";
```

- [ ] **Step 2: Use it in the alarm** — in the `async alarm()` method of `src/room.ts`, replace the seeded-guess line:

```ts
    const view = { wordLength: this.state.wordLength, ownGuesses: bot.guesses };
    const word = this.state.seed
      ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength) }, Math.random())
      : computeNextGuess(view);
```

> Keep `NOOB` imported — it remains the documented base the scaling builds on and is referenced in tests; removing it is out of scope.

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/room.ts
git commit -m "feat(room): seeded bot uses length-scaled mistakeRate so long-word rooms stay winnable"
```

---

### Task 6: Manual smoke (local dev)

**Files:** none (verification only).

- [ ] **Step 1: Start the dev worker**

Run: `npm run dev` (background) — note the local URL (typically `http://localhost:8787`).

- [ ] **Step 2: Poll the open index repeatedly and confirm variety**

Run (several times over ~60s):
```bash
for i in 1 2 3 4 5 6; do curl -s http://localhost:8787/api/arena/open | jq -c 'map({host, wordLength, seats})'; sleep 8; done
```
Expected: the **count** of rooms changes between polls (not pinned at 3); `wordLength` values vary across 4–9 (not all 5); rooms appear one at a time rather than three at once; `seats` is `"1/2"` (unchanged this increment).

- [ ] **Step 3: Confirm a long-word seeded room is joinable + the bot is fallible** — open a room whose `wordLength` is ≥7 (navigate to its `routePath`), play it, and confirm the opponent makes visible mistakes (wastes guesses) rather than solving near-instantly.

- [ ] **Step 4: Stop the dev worker.** No commit.

---

## Done when

- Arena room count drifts (not constant 3); rooms trickle in over seconds and expire/vanish on their own.
- Seeded rooms show a spread of word lengths (4–9), weighted toward friendly lengths.
- A human can still beat the bot in a long-word room (length-scaled fallibility).
- `npm run typecheck && npm test` green; no `isBot`/disguise regression (existing bots disguise test still passes).
- Seats remain `1/2` (multi-bot seat variety = Increment 2).

## Deploy (HOLD for Yan)

Do NOT push/deploy automatically (CLAUDE.md: Zang owns the deploy button; COLONY.md governs prod). When authorized: `git fetch origin main && git rebase origin/main` → `npm run typecheck && npm test` → `git push origin HEAD:main` → `npm run deploy` from the freshly-rebased tree → log the lane in `.claude/COLONY.md`.
