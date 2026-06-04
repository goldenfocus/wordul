# Living Arena — Increment 2: Multi-Bot Seats + N-Player Race — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Arena Room from one hard-coded bot per room to a varied field of distinct bots (`2/3`, `4/5`, `1/3`…) where tapping a room fills it to capacity and starts a winnable N-player race (you vs `capacity−1` bots).

**Architecture:** Keep the repo's split — pure decision logic in `*-core.ts` / `bots.ts` / `noob.ts` (unit-tested under Vitest), the `Room`/`Arena` Durable Objects as thin shells that call them. The load-bearing change is the **per-bot heartbeat**: one DO alarm drives N bots, each carrying its own `nextGuessAt`, always re-armed to the soonest. The Arena coordinator picks the room's full bot roster up front (for cross-room persona uniqueness) and ships it in the `/seed` body; the Room seeds `botCount` bots into the lobby and fills the rest on the human's join.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (`wrangler`), Vitest. Product decision **(A) — join = full N-player race** is confirmed (Yan, 2026-06-04).

**Source spec:** `docs/superpowers/specs/2026-06-04-living-arena-02-multibot-seats-design.md` (read its §"Current single-bot assumptions" for the exact anchor points). Increment 1 is already live (`prod-339`).

**Decisions locked beyond the spec sketch (read before starting):**
- **`SeedRec` gains three fields:** `capacity`, `botCount`, **and `personaIds: string[]`** (the room's full bot roster). `personaIds` is required for the cross-room "no duplicate persona across two open rooms" guarantee — `openIds` in `arena.ts` is built from it, not from the single face `personaId`.
- **`SeedBody` carries the full roster:** `personas` is `capacity−1` distinct personas (every bot the room could ever hold), plus `capacity` and `botCount`. The Room injects `botCount` at seed and fills from the same list on join — so the Room never picks personas itself (no cross-room knowledge needed there).
- **`state.seed` shape:** `{ profile: "noob"; personaIds: string[]; capacity: number }` (was `{ personaId; profile }`). In-room a bot is just its `username` (= persona id); name/avatar are lobby-row only, so storing ids is enough to fill on join.
- **`mistakeRateFor(length, opponents = 1)`** — `opponents` defaults to `1`, making it byte-identical to today for single-bot rooms (no churn to existing call sites' behavior, existing tests stay green).
- **Ship-as-a-unit:** Tasks 6 (Room `/seed` contract) and 7 (Arena POST) change the server-internal `/seed` contract on both ends. They are a pair — the branch must contain both before `dev/ship.sh`. CI deploys the whole merged branch atomically, so intermediate commits are never deployed alone. Every commit still keeps `npm test` + `npm run typecheck` green.

**Critical task ordering:** the per-bot heartbeat (Tasks 4–5) MUST land before any `capacity > 2` room can be minted (Task 7). A multi-bot room driven by the old single-bot alarm would have frozen, never-guessing bots and would never finish.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/bots.ts` | modify | add `pickPersonas(seedCount, n, openIds)`; `pickPersona` becomes the n=1 case |
| `src/arena-core.ts` | modify | add `CAPACITY_WEIGHTS`, `rollSpawn`; add `capacity`/`botCount`/`personaIds` to `SeedRec`; `hydrateSeedRec` legacy backfill |
| `src/noob.ts` | modify | `mistakeRateFor(length, opponents)` — field-size fallibility bump |
| `src/room-core.ts` | modify | per-bot heartbeat pure helpers: `botDelay`, `dueBots`, `nextBotAlarmAt` + pacing constants |
| `src/types.ts` | modify | `PlayerState.nextGuessAt?`; `SeedMarker` → `{ profile; personaIds; capacity }` |
| `src/room.ts` | modify | `SeedBody` plural contract; `ensureBots`; per-bot heartbeat wiring in `alarm`/`runStart`; fill-then-start on join; per-persona H2H |
| `src/arena.ts` | modify | `rollSpawn` + `pickPersonas` + `personaIds` openIds + new `/seed` POST body + `hydrateSeedRec` on load |
| `test/bots.test.ts` | modify | `pickPersonas` cases + multi-bot disguise |
| `test/arena-core.test.ts` | modify | `rollSpawn` bounds, new-field round-trip, `hydrateSeedRec` |
| `test/noob.test.ts` | modify | `mistakeRateFor(length, opponents)` monotonic + bounded |
| `test/room-core.test.ts` | modify | `botDelay`/`dueBots`/`nextBotAlarmAt` |

---

## Task 1: `pickPersonas` (multi-persona picker) + multi-bot disguise

**Files:**
- Modify: `src/bots.ts`
- Test: `test/bots.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/bots.test.ts` (after the existing `describe("pickPersona", …)` block):

```ts
import { PERSONAS, pickPersona, pickPersonas, projectPlayerForClient } from "../src/bots.ts";

describe("pickPersonas", () => {
  it("returns n distinct personas", () => {
    const picked = pickPersonas(0, 3, new Set());
    expect(picked.length).toBe(3);
    expect(new Set(picked.map((p) => p.id)).size).toBe(3);
  });

  it("skips open persona ids", () => {
    const open = new Set([PERSONAS[0].id, PERSONAS[1].id]);
    const picked = pickPersonas(0, 3, open);
    for (const p of picked) expect(open.has(p.id)).toBe(false);
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });

  it("degrades to fewer when the roster is exhausted (never duplicates)", () => {
    const picked = pickPersonas(0, PERSONAS.length + 5, new Set());
    expect(picked.length).toBe(PERSONAS.length);
    expect(new Set(picked.map((p) => p.id)).size).toBe(PERSONAS.length);
  });

  it("returns [] when n <= 0 or all personas are open", () => {
    expect(pickPersonas(0, 0, new Set())).toEqual([]);
    expect(pickPersonas(0, 3, new Set(PERSONAS.map((p) => p.id)))).toEqual([]);
  });

  it("pickPersona is the n=1 case", () => {
    const open = new Set<string>();
    expect(pickPersonas(2, 1, open)[0]?.id).toBe(pickPersona(2, open)?.id);
  });
});

describe("multi-bot disguise", () => {
  it("strips isBot from every bot in an N-bot room", () => {
    const bots: PlayerState[] = PERSONAS.slice(0, 4).map((p) => ({
      username: p.id, connected: true, guesses: [], status: "playing",
      isBot: true, scienceOptOut: true, points: 0, pointsSpent: 0,
    }));
    for (const b of bots) {
      const out = projectPlayerForClient(b);
      expect("isBot" in out).toBe(false);
      expect(JSON.stringify(out)).not.toContain("isBot");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/bots.test.ts`
Expected: FAIL — `pickPersonas is not a function`.

- [ ] **Step 3: Implement `pickPersonas`**

In `src/bots.ts`, add after `pickPersona` (around line 41):

```ts
/**
 * Deterministic multi-pick: walk the roster from `seedCount`, skipping any persona already
 * open (across all live rooms), and return up to `n` DISTINCT personas. Returns fewer when
 * the roster is exhausted (graceful — the caller shrinks the room), [] when n <= 0 or every
 * persona is open. `pickPersona` is the n=1 case.
 */
export function pickPersonas(
  seedCount: number,
  n: number,
  openPersonaIds: ReadonlySet<string>,
): BotPersona[] {
  if (n <= 0) return [];
  const out: BotPersona[] = [];
  const taken = new Set<string>(openPersonaIds);
  const len = PERSONAS.length;
  for (let i = 0; i < len && out.length < n; i++) {
    const p = PERSONAS[(seedCount + i) % len];
    if (taken.has(p.id)) continue;
    taken.add(p.id);
    out.push(p);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/bots.test.ts`
Expected: PASS (all `pickPersonas` + `multi-bot disguise` cases, plus the existing `pickPersona` suite).

- [ ] **Step 5: Commit**

```bash
git add src/bots.ts test/bots.test.ts
git commit -m "feat(arena): pickPersonas multi-persona picker + multi-bot disguise test"
```

---

## Task 2: `rollSpawn` + `SeedRec` capacity/botCount/personaIds + legacy backfill

**Files:**
- Modify: `src/arena-core.ts`
- Test: `test/arena-core.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/arena-core.test.ts`, extend the `rec()` factory to include the three new fields (so existing tests keep compiling), and add new `describe` blocks. First update the import line at the top to add the new symbols:

```ts
import {
  emptyArenaState,
  apply,
  prune,
  openGames,
  liveCount,
  seedPaths,
  rollSpawn,
  hydrateSeedRec,
  CAPACITY_WEIGHTS,
  STALE_MS,
  MAX_OPEN_MS,
  type SeedRec,
  type ArenaState,
} from "../src/arena-core.ts";
```

Update the `rec()` factory (add the three fields before `...over`):

```ts
function rec(over: Partial<SeedRec> = {}): SeedRec {
  return {
    path: "arena/maya-0",
    routePath: "/@arena/maya-0",
    name: "Maya's room",
    host: "maya",
    personaId: "maya",
    personaIcon: "🦊",
    edition: "default",
    wordLength: 5,
    seats: "1/2",
    capacity: 2,
    botCount: 1,
    personaIds: ["maya"],
    mintedAt: 0,
    lifetimeMs: 0,
    status: "minted",
    ...over,
  };
}
```

Add new test blocks at the end of the file:

```ts
describe("rollSpawn", () => {
  it("capacity is always one of the weighted table values", () => {
    const allowed = new Set(CAPACITY_WEIGHTS.map(([c]) => c));
    for (let i = 0; i < 1000; i++) {
      const { capacity } = rollSpawn(i / 1000, 0.5);
      expect(allowed.has(capacity)).toBe(true);
    }
  });

  it("botCount is always in [1, capacity-1]", () => {
    for (let rc = 0; rc < 1; rc += 0.05) {
      for (let rb = 0; rb < 1; rb += 0.05) {
        const { capacity, botCount } = rollSpawn(rc, rb);
        expect(botCount).toBeGreaterThanOrEqual(1);
        expect(botCount).toBeLessThanOrEqual(capacity - 1);
      }
    }
  });

  it("is pure — same rolls, same result", () => {
    expect(rollSpawn(0.3, 0.7)).toEqual(rollSpawn(0.3, 0.7));
  });

  it("favors small rooms (capacity 2-3 dominate)", () => {
    let small = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const { capacity } = rollSpawn((i * 0.6180339887) % 1, 0.5);
      if (capacity <= 3) small++;
    }
    expect(small / N).toBeGreaterThan(0.6);
  });
});

describe("SeedRec new fields round-trip", () => {
  it("apply(mint) preserves capacity/botCount/personaIds", () => {
    const r = rec({ capacity: 5, botCount: 4, seats: "4/5", personaIds: ["maya", "theo", "nova", "remy"] });
    const s = apply(emptyArenaState(), { type: "mint", rec: r });
    expect(s.seeded[r.path].capacity).toBe(5);
    expect(s.seeded[r.path].botCount).toBe(4);
    expect(s.seeded[r.path].personaIds).toEqual(["maya", "theo", "nova", "remy"]);
  });

  it("openGames still omits internal fields (no capacity/botCount/personaIds leak)", () => {
    const r = rec({ capacity: 3, botCount: 2, seats: "2/3", personaIds: ["maya", "theo"], status: "registered" });
    const [g] = openGames(apply(emptyArenaState(), { type: "mint", rec: r }));
    expect(g.seats).toBe("2/3");
    expect("capacity" in g).toBe(false);
    expect("botCount" in g).toBe(false);
    expect("personaIds" in g).toBe(false);
    expect("mintedAt" in g).toBe(false);
  });
});

describe("hydrateSeedRec (legacy backfill)", () => {
  it("defaults a pre-Inc2 rec to capacity 2 / botCount 1 / face-only roster", () => {
    // Simulate a persisted v1/Inc1 rec missing the new fields.
    const legacy = { ...rec(), seats: "1/2" } as SeedRec;
    delete (legacy as Partial<SeedRec>).capacity;
    delete (legacy as Partial<SeedRec>).botCount;
    delete (legacy as Partial<SeedRec>).personaIds;
    const h = hydrateSeedRec(legacy);
    expect(h.capacity).toBe(2);
    expect(h.botCount).toBe(1);
    expect(h.personaIds).toEqual(["maya"]);
    expect(h.seats).toBe("1/2");
  });

  it("leaves a complete rec untouched", () => {
    const r = rec({ capacity: 4, botCount: 3, seats: "3/4", personaIds: ["maya", "theo", "nova"] });
    expect(hydrateSeedRec(r)).toEqual(r);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/arena-core.test.ts`
Expected: FAIL — `rollSpawn is not a function` / `hydrateSeedRec is not a function` / `CAPACITY_WEIGHTS` undefined.

- [ ] **Step 3: Add the fields and helpers to `arena-core.ts`**

In `src/arena-core.ts`, add the three fields to `SeedRec` (after `seats`, around line 16):

```ts
  seats: string; // "1/2", "2/3", "4/5" … = `${botCount}/${capacity}`
  capacity: number; // total seats 2–5 (Inc.2)
  botCount: number; // bots present at mint, 1…capacity−1 (Inc.2)
  personaIds: string[]; // the room's full bot roster (capacity−1 ids) — drives cross-room dedup
```

Add the weighted capacity table next to `LENGTH_WEIGHTS` (around line 51):

```ts
// Inc.2 seat variety: mostly small rooms, occasional lively big ones. Same weighted-pick
// shape as LENGTH_WEIGHTS. capacity 2 = the classic 1v1; 5 = the rare battle-royale.
export const CAPACITY_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [2, 6], [3, 4], [4, 2], [5, 1],
];
```

Add `rollSpawn` after `rollLifetime` (around line 78):

```ts
// Weighted capacity + a uniform botCount in [1, capacity-1]. Two injected rolls in [0,1)
// (same purity contract as rollWordLength/rollLifetime — arena.ts is the only Math.random layer).
export function rollSpawn(rCap: number, rBots: number): { capacity: number; botCount: number } {
  const total = CAPACITY_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let t = Math.max(0, Math.min(0.999999, rCap)) * total;
  let capacity = CAPACITY_WEIGHTS[CAPACITY_WEIGHTS.length - 1][0];
  for (const [cap, w] of CAPACITY_WEIGHTS) {
    if (t < w) { capacity = cap; break; }
    t -= w;
  }
  const span = capacity - 1; // ≥ 1
  const botCount = 1 + Math.floor(Math.max(0, Math.min(0.999999, rBots)) * span);
  return { capacity, botCount };
}
```

Add `hydrateSeedRec` after `seedPaths` (end of file):

```ts
// Backfill a persisted pre-Inc2 SeedRec (no capacity/botCount/personaIds) to the legacy
// 1/2 single-bot shape so old rooms render + typecheck until they churn out. Idempotent.
export function hydrateSeedRec(rec: SeedRec): SeedRec {
  const capacity = typeof rec.capacity === "number" ? rec.capacity : 2;
  const botCount = typeof rec.botCount === "number" ? rec.botCount : 1;
  const personaIds = Array.isArray(rec.personaIds) && rec.personaIds.length > 0
    ? rec.personaIds
    : [rec.personaId];
  const seats = rec.seats || `${botCount}/${capacity}`;
  return { ...rec, capacity, botCount, personaIds, seats };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/arena-core.test.ts`
Expected: PASS (new blocks + the full existing arena-core suite, which now compiles against the extended `rec()` factory).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Note: `arena.ts` still mints `1/2` and does not yet set the new fields — that's Task 7. The `SeedRec` literal in `arena.ts` will now fail typecheck because the new fields are required. **If typecheck fails here**, add `capacity: 2, botCount: 1, personaIds: [persona.id]` to the existing `arena.ts` mint literal as a temporary 1/2 default — Task 7 replaces it with `rollSpawn`.)

- [ ] **Step 6: Commit**

```bash
git add src/arena-core.ts test/arena-core.test.ts src/arena.ts
git commit -m "feat(arena): rollSpawn + SeedRec capacity/botCount/personaIds + legacy hydrate"
```

---

## Task 3: `mistakeRateFor(length, opponents)` — field-size beatability

**Files:**
- Modify: `src/noob.ts`
- Test: `test/noob.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/noob.test.ts` (the import already includes `mistakeRateFor`):

```ts
describe("mistakeRateFor(length, opponents)", () => {
  it("defaults to the single-opponent rate when opponents is omitted", () => {
    expect(mistakeRateFor(5)).toBe(mistakeRateFor(5, 1));
  });

  it("is non-decreasing in length", () => {
    for (let len = 4; len < 12; len++) {
      expect(mistakeRateFor(len + 1, 1)).toBeGreaterThanOrEqual(mistakeRateFor(len, 1));
    }
  });

  it("is non-decreasing in opponents (more bots → each fumbles a bit more)", () => {
    for (let opp = 1; opp < 6; opp++) {
      expect(mistakeRateFor(6, opp + 1)).toBeGreaterThanOrEqual(mistakeRateFor(6, opp));
    }
  });

  it("stays strictly below 1 even at the extremes", () => {
    expect(mistakeRateFor(12, 8)).toBeLessThan(1);
    expect(mistakeRateFor(12, 8)).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/noob.test.ts`
Expected: FAIL — `mistakeRateFor(6, 2)` arity error or wrong value (current fn ignores a 2nd arg and the cap is 0.7, so the monotonic-in-opponents case fails).

- [ ] **Step 3: Implement the field-size bump**

Replace `mistakeRateFor` in `src/noob.ts` (lines 17-20):

```ts
// Longer words AND bigger fields are harder, so a fixed rate would make either unwinnable.
// Scale fallibility UP with length (+0.06/letter over 5) and with field size (+0.05 per extra
// opponent over 1), capped strictly below certainty. Still 100% blind — this only changes how
// often noobGuess takes the believable-slip branch, never what it can see. `opponents` = the
// number of OTHER players the bot races (players.length − 1); defaults to 1 (single-bot parity).
export function mistakeRateFor(length: number, opponents = 1): number {
  const lengthRate = NOOB.mistakeRate + 0.06 * Math.max(0, length - 5);
  const fieldBump = 0.05 * Math.max(0, opponents - 1);
  return Math.min(0.85, lengthRate + fieldBump);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/noob.test.ts`
Expected: PASS (new block + all existing noob tests — the `opponents` default keeps single-bot behavior identical).

- [ ] **Step 5: Commit**

```bash
git add src/noob.ts test/noob.test.ts
git commit -m "feat(arena): mistakeRateFor scales with field size so N-bot races stay winnable"
```

---

## Task 4: Per-bot heartbeat pure helpers (`room-core.ts`)

**Files:**
- Modify: `src/room-core.ts`
- Modify: `src/types.ts` (add `PlayerState.nextGuessAt?`)
- Test: `test/room-core.test.ts`

- [ ] **Step 1: Add `nextGuessAt` to `PlayerState`**

In `src/types.ts`, add to `PlayerState` (after `goldAwarded`, around line 50):

```ts
  nextGuessAt?: number;    // bot-only: epoch ms this bot is next due to guess (per-bot heartbeat, Inc.2)
```

- [ ] **Step 2: Write the failing tests**

Add to `test/room-core.test.ts`. First add the imports at the top of the file (merge into the existing `from "../src/room-core.ts"` import):

```ts
import { botDelay, dueBots, nextBotAlarmAt } from "../src/room-core.ts";
import type { PlayerState } from "../src/types.ts";
```

Add a helper + test blocks:

```ts
function bot(over: Partial<PlayerState> = {}): PlayerState {
  return { username: "maya", connected: true, guesses: [], status: "playing", isBot: true, scienceOptOut: true, points: 0, pointsSpent: 0, ...over };
}

describe("botDelay", () => {
  it("seeded opener is 10–20s; subsequent is 7–17s", () => {
    for (const roll of [0, 0.5, 0.999]) {
      const open = botDelay(true, true, roll);
      expect(open).toBeGreaterThanOrEqual(10_000);
      expect(open).toBeLessThanOrEqual(20_000);
      const next = botDelay(false, true, roll);
      expect(next).toBeGreaterThanOrEqual(7_000);
      expect(next).toBeLessThanOrEqual(17_000);
    }
  });

  it("robot (/robots) opener is 6–12s; subsequent is 4–10s", () => {
    for (const roll of [0, 0.5, 0.999]) {
      const open = botDelay(true, false, roll);
      expect(open).toBeGreaterThanOrEqual(6_000);
      expect(open).toBeLessThanOrEqual(12_000);
      const next = botDelay(false, false, roll);
      expect(next).toBeGreaterThanOrEqual(4_000);
      expect(next).toBeLessThanOrEqual(10_000);
    }
  });
});

describe("dueBots", () => {
  it("returns only playing bots whose nextGuessAt has passed", () => {
    const players = [
      bot({ username: "a", nextGuessAt: 100 }),               // due
      bot({ username: "b", nextGuessAt: 5000 }),              // not yet
      bot({ username: "c", nextGuessAt: 50, status: "won" }), // done
      bot({ username: "h", isBot: false, nextGuessAt: 0 }),   // human
      bot({ username: "d", nextGuessAt: undefined }),         // unset → due (>= now via ?? 0)
    ];
    const due = dueBots(players, 1000).map((p) => p.username);
    expect(due).toEqual(["a", "d"]);
  });
});

describe("nextBotAlarmAt", () => {
  it("is the soonest nextGuessAt across still-playing bots", () => {
    const players = [
      bot({ username: "a", nextGuessAt: 9000 }),
      bot({ username: "b", nextGuessAt: 3000 }),
      bot({ username: "c", nextGuessAt: 1000, status: "lost" }), // excluded
    ];
    expect(nextBotAlarmAt(players)).toBe(3000);
  });

  it("is null when no bot is still playing", () => {
    expect(nextBotAlarmAt([bot({ status: "won" }), bot({ isBot: false })])).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/room-core.test.ts`
Expected: FAIL — `botDelay is not a function`.

- [ ] **Step 4: Implement the helpers in `room-core.ts`**

Add at the end of `src/room-core.ts`:

```ts
// --- Living Arena (v2 inc.2): per-bot heartbeat ------------------------------
// One DO alarm drives N bots. Each bot carries nextGuessAt; the alarm advances every
// DUE bot, then re-arms to the SOONEST still-playing nextGuessAt (min-heap on one timer).
// Pacing matches the pre-Inc2 single-bot cadence exactly: seeded (Arena personas) read
// slow + beatable; /robots (clanker) keeps the snappier original beat.
export const BOT_OPEN_MIN_MS = 10_000;   // seeded opener low end
export const BOT_OPEN_SPREAD_MS = 10_000; // → 10–20s opener
export const BOT_NEXT_MIN_MS = 7_000;    // seeded subsequent low end
export const BOT_NEXT_SPREAD_MS = 10_000; // → 7–17s
export const ROBOT_OPEN_MIN_MS = 6_000;  // /robots opener low end
export const ROBOT_OPEN_SPREAD_MS = 6_000; // → 6–12s
export const ROBOT_NEXT_MIN_MS = 4_000;  // /robots subsequent low end
export const ROBOT_NEXT_SPREAD_MS = 6_000; // → 4–10s

// Delay (ms) until a bot's next guess. roll in [0,1): tests pass fixed values; the DO passes
// Math.random() per bot so the field doesn't move in lockstep (lockstep is a disguise tell).
export function botDelay(opening: boolean, seeded: boolean, roll: number): number {
  const r = Math.max(0, Math.min(1, roll));
  const [min, spread] = seeded
    ? (opening ? [BOT_OPEN_MIN_MS, BOT_OPEN_SPREAD_MS] : [BOT_NEXT_MIN_MS, BOT_NEXT_SPREAD_MS])
    : (opening ? [ROBOT_OPEN_MIN_MS, ROBOT_OPEN_SPREAD_MS] : [ROBOT_NEXT_MIN_MS, ROBOT_NEXT_SPREAD_MS]);
  return min + Math.floor(r * spread);
}

// Bots whose turn has come: a playing bot whose nextGuessAt (default 0 = immediately due)
// is at or before now. Pure selector — the DO maps each to an applyGuess.
export function dueBots(players: PlayerState[], now: number): PlayerState[] {
  return players.filter((p) => p.isBot && p.status === "playing" && (p.nextGuessAt ?? 0) <= now);
}

// Soonest nextGuessAt across still-playing bots — what the DO arms setAlarm() to. null when
// no bot is still playing (the alarm isn't re-armed; the finish flow ends the game).
export function nextBotAlarmAt(players: PlayerState[]): number | null {
  const times = players
    .filter((p) => p.isBot && p.status === "playing")
    .map((p) => p.nextGuessAt ?? 0);
  return times.length ? Math.min(...times) : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/room-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/room-core.ts src/types.ts test/room-core.test.ts
git commit -m "feat(arena): per-bot heartbeat pure helpers (botDelay/dueBots/nextBotAlarmAt)"
```

---

## Task 5: Wire the heartbeat into `room.ts` (single-bot no-op — invisible safety)

This converts the DO's single-bot `scheduleBotTick` + `alarm()` playing branch to drive **all** due bots. With still only one bot per room (arena.ts unchanged till Task 7), behavior is identical — verify `/robots` and seeded 1/2 rooms still play the same. **This MUST land before Task 7.** No unit harness for the DO — the gate is `npm test` + `npm run typecheck` green + a local smoke.

**Files:**
- Modify: `src/room.ts`

- [ ] **Step 1: Add the heartbeat imports**

In `src/room.ts`, extend the `room-core.ts` import (lines 15-24) to add the three helpers:

```ts
import {
  outpacedLosers,
  rematchReduce,
  nextAlarmAt,
  botAccepts,
  botDelay,
  dueBots,
  nextBotAlarmAt,
  REMATCH_TIMEOUT_MS,
  BOT_REMATCH_MIN_MS,
  BOT_REMATCH_MAX_MS,
  type RematchEffect,
} from "./room-core.ts";
```

- [ ] **Step 2: Replace `scheduleBotTick()` with a per-bot arm helper**

In `src/room.ts`, replace the whole `scheduleBotTick()` method (lines 783-796) with:

```ts
  // Arm every playing bot's first guess on round start, then set the single DO alarm to the
  // soonest. Seeded (Arena) bots read slow/beatable; /robots keeps the snappier beat.
  private armBotHeartbeat(opening: boolean): void {
    const seeded = !!this.state.seed;
    const now = Date.now();
    let any = false;
    for (const p of this.state.players) {
      if (p.isBot && p.status === "playing") {
        p.nextGuessAt = now + botDelay(opening, seeded, Math.random());
        any = true;
      }
    }
    if (!any) return;
    const at = nextBotAlarmAt(this.state.players);
    if (at != null) void this.ctx.storage.setAlarm(at);
  }
```

- [ ] **Step 3: Point `runStart` at the new arm**

In `runStart` (line 642), replace:

```ts
    if (this.state.players.some((p) => p.isBot && p.status === "playing")) this.scheduleBotTick();
```

with:

```ts
    this.armBotHeartbeat(true);
```

Also in `runStart`, change the `this.ensureBot();` call (line 600) to `this.ensureBots();` (the new method lands in Task 6; for this commit add a thin alias so the file compiles — see Step 6).

- [ ] **Step 4: Rewrite the `alarm()` playing branch to drive all due bots**

In `alarm()` (lines 807-821), replace from `if (this.state.phase !== "playing" || !this.state.word) return;` through the end of the method with:

```ts
    if (this.state.phase !== "playing" || !this.state.word) return;
    // Per-bot heartbeat: advance every DUE bot in this fire, then re-arm to the soonest.
    // One broadcast after the batch (not per bot). The solver/noob see ONLY a BotView
    // (length + own masks) — never this.state.word; the cheat wall is unchanged.
    const now = Date.now();
    const seeded = !!this.state.seed;
    const opponents = this.state.players.length - 1;
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
    if (acted) await this.persistAndBroadcast();
    if (this.state.phase === "playing") {
      const at = nextBotAlarmAt(this.state.players);
      if (at != null) void this.ctx.storage.setAlarm(at);
    }
```

- [ ] **Step 5: Update the rematch `start` re-arm comment (no code change needed)**

The rematch `start` effect calls `runStart` (line 1361), which now calls `armBotHeartbeat(true)` — so a rematch correctly re-arms all bots. No change required; verify the line still reads `await this.runStart(starter);`.

- [ ] **Step 6: Add a temporary `ensureBots` alias so the file compiles**

For THIS commit only, the multi-bot `ensureBots` lands in Task 6. Keep the file compiling by renaming the existing `ensureBot` to `ensureBots` and updating its two call sites — but preserve its current single-bot body for now. Concretely:
- Rename `private ensureBot(persona?: …)` (line 757) to `private ensureBots(persona?: { id: string; name: string; avatar: string }): void` (Task 6 rewrites the body + signature).
- Update the two remaining `this.ensureBot(...)` call sites: `handleSeed` (line 197) `this.ensureBot(b.persona);` → leave the argument for now (`this.ensureBots(b.persona);`); `onHello` (line 420) `this.ensureBot();` → `this.ensureBots();`.

(This is a mechanical rename to keep Task 5 self-contained and green; Task 6 replaces the body and signature properly.)

- [ ] **Step 7: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS — no test exercises the DO alarm, so the suite stays green; typecheck confirms the rename + heartbeat wiring compiles.

- [ ] **Step 8: Smoke test single-bot parity locally**

Run: `npm run dev` (in a second terminal). Then:
- Open `http://localhost:8787/@robots` — confirm clanker still joins, the game starts, and clanker guesses on roughly the old cadence and can be beaten.
- Open the Arena tab (`/arena`) or `GET http://localhost:8787/api/arena/open`; join a seeded `1/2` room — confirm the persona still races and finishes.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add src/room.ts
git commit -m "refactor(arena): drive bots via per-bot heartbeat (single-bot no-op)"
```

---

## Task 6: Multi-bot Room — plural `/seed` contract, `ensureBots`, fill-then-start, per-persona H2H

This makes the Room genuinely multi-bot: seed `botCount` distinct persona bots, fill to `capacity` on the human's join, start the N-player race, and record H2H per persona. **Pairs with Task 7 — both must be in the branch before ship.**

**Files:**
- Modify: `src/room.ts`
- Modify: `src/types.ts` (`SeedMarker` shape)

- [ ] **Step 1: Update `SeedMarker` in `types.ts`**

Replace `SeedMarker` (line 61):

```ts
// Server-only marker stamped on a seeded (bot-hosted) room. NEVER reaches a client:
// snapshotFor shadows it with `seed: undefined` on the outbound projection.
export type SeedMarker = { profile: "noob"; personaIds: string[]; capacity: number };
```

- [ ] **Step 2: Update the `SeedBody` contract in `room.ts`**

Replace `SeedBody` (lines 49-55):

```ts
// ARENA → ROOM POST /seed body (canonical contract, Inc.2 plural). `personas` is the room's
// FULL roster (capacity−1 distinct personas); `botCount` of them are injected at seed, the
// rest fill in when a human joins. Personas are picked by ARENA (cross-room dedup) — the Room
// never picks its own.
type SeedBody = {
  path: string;
  personas: { id: string; name: string; avatar: string }[];
  capacity: number;
  botCount: number;
  profile: "noob";
  edition: string;
  wordLength: number;
};
```

- [ ] **Step 3: Rewrite `handleSeed` for the plural body**

Replace the body of `handleSeed` (lines 178-200) from the JSON parse through the return:

```ts
  private async handleSeed(req: Request): Promise<Response> {
    const b = (await req.json().catch(() => null)) as SeedBody | null;
    if (!b?.path || !Array.isArray(b.personas) || b.personas.length === 0 || b.profile !== "noob") {
      return new Response("bad request", { status: 400 });
    }
    if (this.state.seed) return Response.json({ ok: true }); // already seeded
    if (this.state.path === "") {
      this.state.path = b.path;
      const [owner, slug] = b.path.split("/");
      this.state.owner = owner ?? "";
      this.state.slug = slug ?? "";
      this.state.name = `${b.personas[0].name}'s room`;
    }
    const capacity = Math.max(2, Math.min(MAX_PLAYERS, b.capacity || b.personas.length + 1));
    const botCount = Math.max(1, Math.min(b.botCount || 1, b.personas.length, capacity - 1));
    this.state.seed = { profile: b.profile, personaIds: b.personas.map((p) => p.id), capacity };
    this.state.edition = sanitizeEdition(b.edition);
    if (isSupportedSize(b.wordLength)) {
      this.state.wordLength = b.wordLength;
      this.state.maxGuesses = guessesFor(b.wordLength);
    }
    this.ensureBots(botCount); // inject the botCount bots that wait in the lobby
    await this.persistAndBroadcast();
    return Response.json({ ok: true });
  }
```

- [ ] **Step 4: Rewrite `ensureBots` as the multi-bot injector**

Replace the entire method that Task 5 renamed to `ensureBots` (the old `ensureBot` body, lines 757-781) with:

```ts
  // Seeded Arena room: inject DISTINCT persona bots (username = persona id) until the room has
  // `target` players total (capped at MAX_PLAYERS), pulling ids from the seeded roster in order
  // and skipping any already present. /robots (not seeded) keeps its single labeled clanker.
  // `target` defaults to the current player count → a no-arg call is a safe no-op for seeded
  // rooms (used by the generic onHello/runStart hooks).
  private ensureBots(target?: number): void {
    if (this.state.isDaily) return; // no worduler in the daily room
    if (!this.isRobotRoom() && !this.state.seed) return;
    if (this.state.seed) {
      const want = Math.min(target ?? this.state.players.length, MAX_PLAYERS);
      for (const id of this.state.seed.personaIds) {
        if (this.state.players.length >= want) break;
        if (this.state.players.some((p) => p.username === id)) continue;
        this.state.players.push({
          username: id,
          connected: true,
          guesses: [],
          status: "playing",
          isBot: true,
          scienceOptOut: true,
          revealHints: 0,
          vowelHints: 0,
          points: 0,
          pointsSpent: 0,
        });
      }
      return;
    }
    // /robots: exactly one labeled clanker (unchanged).
    if (this.state.players.some((p) => p.isBot)) return;
    if (this.state.players.length >= MAX_PLAYERS) return;
    this.state.players.push({
      username: BOT_NAME,
      connected: true,
      guesses: [],
      status: "playing",
      isBot: true,
      scienceOptOut: true,
      revealHints: 0,
      vowelHints: 0,
      points: 0,
      pointsSpent: 0,
    });
    this.pushSystem(`🤖 ${BOT_NAME} powered on — knows the basics, holds no grudges.`);
  }
```

Then fix the `handleSeed` call from Task 5's temporary `this.ensureBots(b.persona);` — Step 3 above already replaced it with `this.ensureBots(botCount);`, so confirm no stray `b.persona` reference remains.

- [ ] **Step 5: Fill-then-start on the human's join (`onHello`)**

In `onHello`, replace the seeded auto-start block (lines 420-431):

```ts
    this.ensureBots();
    // Seeded Arena room: the instant a human is connected, FILL the remaining seats with bots
    // (to capacity) and start the N-player race — no host "start" click, instant GO!.
    if (
      this.state.seed &&
      this.state.phase === "lobby" &&
      this.state.players.some((p) => !p.isBot && p.connected)
    ) {
      this.ensureBots(this.state.seed.capacity);
      await this.runStart("arena");
    }
```

(The `this.ensureBots();` no-arg call before the block stays — it spawns clanker for a `/robots` join and is a no-op for a seeded room whose bots already exist.)

- [ ] **Step 6: Update the persona-username guard in `onHello`**

Replace the single-persona guard (lines 324-327):

```ts
    // Seeded room: a human must not claim ANY persona's username (each === a persona id), else
    // the `existing` lookup would treat them as a bot reconnecting. Reject before that lookup.
    if (this.state.seed && this.state.seed.personaIds.includes(username)) {
      this.send(ws, { type: "error", message: "room full" });
      return;
    }
```

- [ ] **Step 7: Per-persona H2H in `finishGame`**

Replace the seeded-H2H block (lines 1086-1092):

```ts
    // Seeded room: record each human's head-to-head against EVERY persona they raced (each
    // bot's username === its persona id). Reads internal players (un-stripped); the !isBot
    // guard keeps personas out of any USER DO. Win = the human is the room winner.
    if (this.state.seed) {
      const personaIds = this.state.players.filter((p) => p.isBot).map((p) => p.username);
      for (const p of this.state.players) {
        if (p.isBot) continue;
        const result = this.state.winner === p.username ? "w" : "l";
        for (const personaId of personaIds) this.writeH2H(p.username, personaId, result);
      }
    }
```

- [ ] **Step 8: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS. (`SeedMarker` shape change is now consistent across `handleSeed`, `onHello`, `finishGame`, `snapshotFor`. No DO unit tests to break; `bots.test.ts` multi-bot disguise from Task 1 covers the projection.)

- [ ] **Step 9: Commit**

```bash
git add src/room.ts src/types.ts
git commit -m "feat(arena): multi-bot Room — plural seed, ensureBots fill-to-capacity, per-persona H2H"
```

---

## Task 7: Arena mints varied multi-bot rooms

Flip the coordinator from "always 1/2" to `rollSpawn` + `pickPersonas`, track personas cross-room via `personaIds`, POST the plural `/seed` body, and hydrate legacy recs on load. After this, multi-bot rooms actually mint. **Pairs with Task 6.**

**Files:**
- Modify: `src/arena.ts`

- [ ] **Step 1: Update imports**

In `src/arena.ts`, extend the `arena-core.ts` import (lines 3-18) to add `rollSpawn` and `hydrateSeedRec`, and swap `pickPersona` → `pickPersonas` from `bots.ts` (line 19):

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
  rollSpawn,
  hydrateSeedRec,
  TARGET_OPEN,
  MAX_SEEDED,
  type ArenaState,
  type SeedRec,
  type OpenGame,
} from "./arena-core.ts";
import { pickPersonas } from "./bots.ts";
```

- [ ] **Step 2: Hydrate legacy recs on load**

Replace `load()` (lines 25-27):

```ts
  private async load(): Promise<ArenaState> {
    const s = (await this.ctx.storage.get<ArenaState>("state")) ?? emptyArenaState();
    // Backfill pre-Inc2 recs (no capacity/botCount/personaIds) so they typecheck + render.
    const seeded: Record<string, SeedRec> = {};
    for (const [path, r] of Object.entries(s.seeded)) seeded[path] = hydrateSeedRec(r);
    return { ...s, seeded };
  }
```

- [ ] **Step 3: Replace the single-bot mint with `rollSpawn` + `pickPersonas`**

In `alarm()`, replace the mint block (lines 82-126, from `const openIds = …` through the second `await this.save(s);`):

```ts
        // Cross-room dedup: every persona currently in use across all live rooms (full
        // rosters, not just the face). pickPersonas skips these so two open rooms never
        // share a persona.
        const openIds = new Set(
          Object.values(s.seeded)
            .filter((r) => r.status !== "closed")
            .flatMap((r) => r.personaIds ?? [r.personaId]),
        );
        const { capacity, botCount } = rollSpawn(Math.random(), Math.random());
        const roster = pickPersonas(s.seedCount, capacity - 1, openIds);
        if (roster.length > 0) {
          // Graceful degrade when the roster is thin: a 4/5 with only 2 free personas
          // becomes a 2/3 — still valid (botCount ≤ capacity−1 ≤ roster.length).
          const realCapacity = Math.min(capacity, roster.length + 1);
          const realBotCount = Math.min(botCount, roster.length, realCapacity - 1);
          const face = roster[0];
          const wordLength = rollWordLength(Math.random());
          const lifetimeMs = rollLifetime(Math.random());
          const { path, routePath } = seedPaths(face.id, s.seedCount);
          const rec: SeedRec = {
            path,
            routePath,
            name: `${face.name}'s room`,
            host: face.name,
            personaId: face.id,
            personaIcon: face.avatar,
            edition: face.edition,
            wordLength,
            seats: `${realBotCount}/${realCapacity}`,
            capacity: realCapacity,
            botCount: realBotCount,
            personaIds: roster.map((p) => p.id),
            mintedAt: Date.now(),
            lifetimeMs,
            status: "minted",
          };
          s = apply(s, { type: "mint", rec });
          await this.save(s);
          // Seed the ROOM DO with the FULL roster + capacity/botCount (byte-identical key).
          let ok = false;
          try {
            const room = this.env.ROOM.get(this.env.ROOM.idFromName(path));
            const res = await room.fetch(new Request("https://do/seed", {
              method: "POST",
              body: JSON.stringify({
                path,
                personas: roster.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
                capacity: realCapacity,
                botCount: realBotCount,
                profile: "noob",
                edition: face.edition,
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
```

(Note the brace structure: the old code had `const persona = pickPersona(...); if (persona) { … }`. The new code uses `if (roster.length > 0) { … }` wrapping the mint+seed — make sure the outer `if (liveCount(s) < target && …) {` block still closes correctly after it.)

- [ ] **Step 4: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS (whole suite — all pure modules covered; arena.ts is a thin DO shell).

- [ ] **Step 5: Smoke test the multi-bot flow locally**

Run: `npm run dev`. Then:
- Hit `GET http://localhost:8787/api/arena/open` a few times over ~30–60s. Confirm `seats` now VARIES (`2/3`, `1/3`, `4/5`, …) and word lengths vary. (The endpoint path is whatever the worker exposes for open games — confirm via `src/worker.ts` route if `/api/arena/open` 404s.)
- Join a `2/3` room → confirm it fills to `3/3` and you race **two** distinct personas; the game finishes and you can win.
- Join a `4/5` long-word room → hard but winnable; all four bots guess at human-ish, non-lockstep cadence and the game reaches a finish.
- Verify disguise: inspect the WebSocket `snapshot` payload (browser devtools → WS frames) → **no** player object contains `isBot`, and no `seed`/`personaIds` field leaks.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/arena.ts
git commit -m "feat(arena): mint varied multi-bot rooms (rollSpawn + pickPersonas + plural seed)"
```

---

## Task 8: Tune beatability + final verification

**Files:**
- Modify (as needed): `src/arena-core.ts` (`CAPACITY_WEIGHTS`), `src/noob.ts` (`mistakeRateFor` bumps)

- [ ] **Step 1: Play-test the field sizes**

With `npm run dev` running, join several rooms across the size range. Judge:
- A `2/3` 5-letter room should feel like a fair race.
- A `4/5` 8-letter room should be **hard but winnable**, not hopeless.

- [ ] **Step 2: Tune if needed (only if play-testing shows a problem)**

- Too many big/brutal rooms → shift `CAPACITY_WEIGHTS` further toward 2–3 (e.g. `[[2,7],[3,4],[4,2],[5,1]]`).
- Big rooms unwinnable → raise the field bump in `mistakeRateFor` (e.g. `0.06 * Math.max(0, opponents - 1)`), keeping the `Math.min(0.85, …)` cap.

If you change either, re-run its unit test (`npx vitest run test/arena-core.test.ts` / `test/noob.test.ts`) to confirm bounds still hold, then commit:

```bash
git add src/arena-core.ts src/noob.ts
git commit -m "tune(arena): capacity weights + field-size fallibility for winnable N-bot races"
```

- [ ] **Step 3: Final full verification**

Run: `npm run typecheck && npm test`
Expected: PASS (entire suite).

- [ ] **Step 4: Ship**

```bash
bash dev/ship.sh
```

This tests → rebases on `origin/main` → backup-tags current prod → fast-forwards main → CI deploys `origin/main`. If git rejects the main push, another tab shipped first — just re-run `bash dev/ship.sh` (it re-integrates). **Never `wrangler deploy` by hand.**

---

## Self-Review (done while writing — recorded for the implementer)

**Spec coverage:**
- `SeedRec` capacity/botCount + derived seats → Task 2 ✓ (plus `personaIds` for cross-room dedup — beyond spec, justified in the header).
- Pure `rollSpawn` weighted toward small rooms → Task 2 ✓.
- `pickPersonas(seedCount, n, openIds)` distinct, degrades gracefully → Task 1 ✓.
- Room seeds k bots; fills to capacity on join; auto-starts N-player race → Task 6 ✓.
- Per-bot heartbeat (one alarm, soonest `nextGuessAt`) → Tasks 4–5 ✓.
- `mistakeRateFor(length, opponents)` monotonic + bounded → Task 3 ✓.
- Disguise holds for N bots (`projectPlayerForClient`, multi-bot test) → Task 1 ✓.
- `PlayerState.nextGuessAt` → Task 4 ✓; `SeedBody`/`state.seed` plural → Task 6 ✓.
- `arena.ts` rollSpawn + pickPersonas + plural POST → Task 7 ✓.
- Legacy `SeedRec` defaults (capacity 2/botCount 1) → Task 2 `hydrateSeedRec` + Task 7 load ✓.
- Build order (heartbeat before capacity>2 mint) → Tasks 4–5 precede Task 7 ✓.
- No new DO / no migration → confirmed; only shape evolution with self-healing defaults ✓.

**Deviations from the spec sketch (all noted in the header):**
1. `SeedRec.personaIds` added (cross-room persona uniqueness — spec required the guarantee but its sketch only tracked the face `personaId`).
2. `SeedBody` carries `botCount` alongside `capacity` + the full `personas[]` roster (the Room needs both the initial count and the fill reserve without picking personas itself).
3. `mistakeRateFor`'s `opponents` defaults to 1 (keeps single-bot parity + existing tests green with no edits).
4. H2H is written per-persona the human raced (spec said "keys per-persona"; made concrete).

**Type consistency:** `ensureBots(target?)`, `armBotHeartbeat(opening)`, `botDelay(opening, seeded, roll)`, `dueBots(players, now)`, `nextBotAlarmAt(players)`, `pickPersonas(seedCount, n, openIds)`, `rollSpawn(rCap, rBots)`, `hydrateSeedRec(rec)`, `mistakeRateFor(length, opponents?)`, `SeedMarker = { profile; personaIds; capacity }` — names used identically across all tasks. ✓

**Placeholder scan:** every code step shows complete code; no TBD/TODO. ✓
```