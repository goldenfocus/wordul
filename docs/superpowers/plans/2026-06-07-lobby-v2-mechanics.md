# Lobby v2 Mechanics (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persisted per-room seat capacity (2–6, host-controlled) with a live-but-never-rotated spectator role, a seat strip that doubles as the capacity control, chat-first mobile lobby order with a collapsed tables pill, and the structural spacing/radius tokens.

**Architecture:** Server: `state.capacity` joins the persisted `RoomSnapshot` (state === snapshot in this codebase), `nextSeatRole` learns capacity and a third role `"spectator"`, and a host-gated `set_capacity` handler clamps + promotes. Client: `seatModel` (pure) learns spectators/watching, `renderMyTable` grows steppers + a watching chip, `arrangeLobbyLayout` flips to mobile-first DOM order, and the rail gets a pill header fed by a new `mountArenaList` `onCount` callback.

**Tech Stack:** Cloudflare Workers DO (`src/room.ts`), vanilla JS client (`public/`), vitest (node env, mocked `cloudflare:workers`).

**Spec:** `docs/superpowers/specs/2026-06-07-lobby-v2-design.md`

**Worktree:** `.claude/worktrees/lobby-v2` (branch `lobby-v2`, already created). Run all commands from that directory. Verify with `npm test` and `npm run typecheck`. **Do not deploy** — shipping is a separate decision (`dev/ship.sh`).

---

### Task 1: Server — persisted `state.capacity` (default 2, legacy backfill, snapshot)

**Files:**
- Create: `test/room-capacity.test.ts`
- Modify: `src/room.ts:119` (ctor), `src/room.ts:169` (restore backfill, after the role backfill block), `src/room.ts:2168` (snapshotFor)
- Modify: `src/types.ts:102` (comment only)

- [ ] **Step 1: Write the failing tests**

Create `test/room-capacity.test.ts`. The harness is copied from `test/room-host.test.ts` (same mock pattern):

```ts
// DO-LEVEL INTEGRATION TEST for Lobby v2 capacity + spectators: persisted state.capacity
// (default 2, legacy backfill), the spectator role past capacity, and host-gated
// set_capacity (clamps, promote-on-raise, no-evict). Mirrors room-host.test.ts's harness.

import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { Room } from "../src/room.ts";

const okFetch = () => Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response);

type AnyRoom = Room & {
  state: Record<string, unknown> & {
    players: Array<Record<string, unknown>>;
    queue: string[];
    capacity: number;
    phase: string;
    hostId: string | null;
  };
  snapshotFor: (viewer: string | null) => Record<string, unknown>;
};

function mockWs(): WebSocket {
  let attach: unknown = null;
  return {
    serializeAttachment: (v: unknown) => { attach = v; },
    deserializeAttachment: () => attach,
    send: () => {},
    close: () => {},
  } as unknown as WebSocket;
}

function makeRoom(slug = "table", stored?: Record<string, unknown>) {
  const sockets: WebSocket[] = [];
  const ctx = {
    storage: {
      get: async () => stored,
      put: async () => {},
      setAlarm: () => {},
      deleteAlarm: () => {},
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => sockets,
    acceptWebSocket: (ws: WebSocket) => sockets.push(ws),
    waitUntil: () => {},
  };
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: okFetch }) };
  const env = {
    DIRECTORY: { put: async () => {}, get: async () => null },
    USER: stub, WORDSTATS: stub, SCIENCE: stub, ARENA: stub, CHALLENGE: stub, DAILY: stub,
  };
  const room = new Room(ctx as never, env as never) as unknown as AnyRoom;
  if (!stored) {
    room.state.path = `alice/${slug}`;
    room.state.owner = "alice";
    room.state.slug = slug;
    room.state.name = slug;
  }
  return { room, sockets };
}

const join = async (room: AnyRoom, ws: WebSocket, username: string) =>
  room.webSocketMessage(ws, JSON.stringify({ type: "hello", username }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("persisted capacity", () => {
  it("a fresh duel room defaults to capacity 2, and the snapshot carries it", async () => {
    const { room } = makeRoom();
    await join(room, mockWs(), "alice");
    expect(room.state.capacity).toBe(2);
    expect(room.snapshotFor("alice").capacity).toBe(2);
  });

  it("a seeded room's snapshot still exposes seed.capacity", async () => {
    const { room } = makeRoom();
    room.state.seed = { profile: "noob", personaIds: ["pp"], capacity: 5 };
    expect(room.snapshotFor(null).capacity).toBe(5);
  });

  it("legacy restore (stored capacity = 8 placeholder) recomputes max(2, seated)", async () => {
    const player = (username: string, role: string) => ({
      username, role, connected: false, guesses: [], status: "playing",
      ready: false, points: 0, pointsSpent: 0,
    });
    const stored = {
      path: "alice/old", owner: "alice", slug: "old", name: "old",
      phase: "lobby", round: 0, word: null, winner: null,
      startedAt: null, goAt: null, finishedAt: null,
      capacity: 8, // the pre-v2 ctor placeholder, persisted because state === snapshot
      players: [player("alice", "duelist"), player("bob", "duelist"), player("cara", "queued")],
      queue: ["cara"],
    };
    const { room } = makeRoom("old", stored);
    await flush(); // ctor restore runs async behind blockConcurrencyWhile
    expect(room.state.capacity).toBe(3);
  });

  it("a legitimately-set capacity (≤6) survives restore untouched", async () => {
    const stored = {
      path: "alice/kept", owner: "alice", slug: "kept", name: "kept",
      phase: "lobby", round: 0, word: null, winner: null,
      startedAt: null, goAt: null, finishedAt: null,
      capacity: 4,
      players: [],
      queue: [],
    };
    const { room } = makeRoom("kept", stored);
    await flush();
    expect(room.state.capacity).toBe(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/room-capacity.test.ts`
Expected: FAIL — `room.state.capacity` is 8 (ctor placeholder) in the first and third tests.

- [ ] **Step 3: Implement**

In `src/room.ts:119`, change the ctor field:

```ts
      capacity: 2, // duel default — the host resizes via set_capacity (2–6); seeded rooms read seed.capacity instead (snapshotFor)
```

In `src/room.ts`, inside the restore block, AFTER the role-backfill `if (restored.players.some((p) => p.role === undefined)) {...}` block (currently ends at line 169) and BEFORE the `phase === "countdown"` check, add:

```ts
        // Capacity backfill: rooms persisted before Lobby v2 stored the ctor placeholder
        // (8 = MAX_PLAYERS). A *settable* capacity is always ≤ 6, so a stored value ≥
        // MAX_PLAYERS can only be legacy — recompute from the seated roster (never evicts).
        if (
          typeof restored.capacity !== "number" ||
          restored.capacity < 2 ||
          restored.capacity >= MAX_PLAYERS
        ) {
          restored.capacity = Math.max(2, restored.players.filter((p) => p.role !== "spectator").length);
        }
```

In `src/room.ts:2166-2168` (snapshotFor), replace the capacity line + comment:

```ts
      // Seat capacity for the lobby "Your table" strip: seeded rooms expose their configured
      // capacity; duel rooms expose the persisted, host-settable table size (default 2).
      capacity: this.state.seed?.capacity ?? this.state.capacity,
```

In `src/types.ts:102`, update the field comment:

```ts
  capacity: number;        // seats in this room (2–6, host-set via set_capacity; persisted). Seeded rooms override outbound with seed.capacity. Powers the lobby "Your table" strip.
```

Note: `"spectator"` isn't in the role union until Task 2 — the backfill filter compares against a string literal, which TS allows only once the union includes it. If `npm run typecheck` complains here, use `p.role !== ("spectator" as typeof p.role)` temporarily or land Task 2's union change together; the tests stay green either way.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/room-capacity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Guard against regressions, then commit**

Run: `npm test` and `npm run typecheck`
Expected: full suite green (existing `seatModel` tests pass — `snap.capacity` is still a number; lobby strips now get 2, not 8).

```bash
git add src/room.ts src/types.ts test/room-capacity.test.ts
git commit -m "feat(lobby): persisted room capacity — duel default 2, legacy backfill, snapshot passthrough"
```

---

### Task 2: Server — spectator role past capacity

**Files:**
- Modify: `src/rotation.ts:9-12` (nextSeatRole), `test/rotation.test.ts`
- Modify: `src/types.ts:57` (role union), `src/room.ts:505` and `src/room.ts:1272` (callers)
- Test: `test/room-capacity.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/rotation.test.ts` inside (or after) the `describe("nextSeatRole")` block:

```ts
  it("seats beyond capacity become spectators", () => {
    const two = [{ role: "duelist" as const }, { role: "duelist" as const }];
    expect(nextSeatRole(two, 2)).toBe("spectator");
    expect(nextSeatRole(two, 3)).toBe("queued");
    expect(nextSeatRole([...two, { role: "queued" as const }], 3)).toBe("spectator");
  });

  it("spectators don't hold seats — a watcher doesn't block the queue", () => {
    const players = [
      { role: "duelist" as const }, { role: "duelist" as const },
      { role: "spectator" as const },
    ];
    expect(nextSeatRole(players, 3)).toBe("queued");
  });
```

Append to `test/room-capacity.test.ts`:

```ts
describe("spectator role", () => {
  it("the joiner past capacity is a spectator and NEVER enters the rotation queue", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara"); // capacity 2, both seats taken
    const cara = room.state.players.find((p) => p.username === "cara")!;
    expect(cara.role).toBe("spectator");
    expect(room.state.queue).toEqual([]); // never-rotated invariant: not in the queue,
    // and applyKothRotation only seats from the queue — so cara can never rotate in.
  });

  it("a spectator's ready is inert", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara");
    await room.webSocketMessage(c, JSON.stringify({ type: "ready", ready: true }));
    const cara = room.state.players.find((p) => p.username === "cara")!;
    expect(cara.ready).toBe(false);
    expect(room.state.phase).toBe("lobby");
  });

  it("MAX_PLAYERS (8) still caps the room overall — joiner #9 is rejected", async () => {
    const { room } = makeRoom();
    const names = ["alice", "bob", "cara", "dan", "eve", "fay", "gus", "hal", "ivy"];
    for (const n of names) await join(room, mockWs(), n);
    expect(room.state.players.length).toBe(8);
    expect(room.state.players.some((p) => p.username === "ivy")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/rotation.test.ts test/room-capacity.test.ts`
Expected: FAIL — `nextSeatRole` takes one argument and returns `"queued"` for cara; queue contains `"cara"`.

- [ ] **Step 3: Implement**

Replace `src/rotation.ts:7-12` (`nextSeatRole` + its doc comment) with:

```ts
export type SeatRole = "duelist" | "queued" | "spectator";

/** Seat for a newly joining player: a duelist seat while fewer than two are taken
 *  (by role — a disconnected duelist still holds their seat); then the queue while the
 *  table has room (seated = duelists + queued < capacity); past capacity the joiner is a
 *  spectator — fully live (boards, chat) but never in the rotation. No capacity (legacy
 *  callers/tests) means an uncapped table: the old duelist/queued behavior. */
export function nextSeatRole(players: { role: SeatRole }[], capacity = Infinity): SeatRole {
  const duelists = players.filter((p) => p.role === "duelist").length;
  if (duelists < MAX_DUELISTS) return "duelist";
  const seated = players.filter((p) => p.role !== "spectator").length;
  return seated < capacity ? "queued" : "spectator";
}
```

In `src/types.ts:57`, widen the role union:

```ts
  role: "duelist" | "queued" | "spectator"; // duel seat: two duelists play; queued rotate in (KOTH); spectators (past capacity) watch + chat, never rotate
```

In `src/room.ts:505`, pass capacity and widen the annotation:

```ts
      const role: "duelist" | "queued" | "spectator" = this.isDuelRoom()
        ? nextSeatRole(this.state.players, this.state.capacity)
        : "duelist";
```

In `src/room.ts:1272` (ensureBots, /robots branch):

```ts
    const botRole: "duelist" | "queued" | "spectator" = this.isDuelRoom()
      ? nextSeatRole(this.state.players, this.state.capacity)
      : "duelist";
```

No other server change needed — the existing gates already exclude spectators: `onReady` (`room.ts:977`, `role !== "duelist"`), `onGuess` (`room.ts:1065`), and `applyRotation` (`room.ts:1047-1050`) only reassigns players found in the seated/queued result sets, so a spectator's role is untouched. Task 1's backfill filter (`p.role !== "spectator"`) now typechecks cleanly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/rotation.test.ts test/room-capacity.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `npm test && npm run typecheck`
Expected: green. (Watch `test/room-duel.test.ts` — its "queues the rest" test joins 3 players into a default room; with capacity 2 the third is now a **spectator**, not queued. If it fails, that test's expectation must be updated to the new contract: `carol.role === "spectator"`, `queue === []`. That is a deliberate behavior change from this spec, not a regression. Keep the rotation coverage by raising capacity first — after Task 3 lands `set_capacity` — or by setting `room.state.capacity = 3` directly in that test's setup.)

```bash
git add src/rotation.ts src/types.ts src/room.ts test/rotation.test.ts test/room-capacity.test.ts test/room-duel.test.ts
git commit -m "feat(lobby): spectator role — joiners past capacity watch live, never rotate"
```

---

### Task 3: Server — host-gated `set_capacity` (clamps, promote-on-raise, no-evict)

**Files:**
- Modify: `src/types.ts:151` (ClientMessage), `src/room.ts:10` (import), `src/room.ts:422-423` (dispatch), `src/room.ts:816` (new handler after onSetRows)
- Test: `test/room-capacity.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/room-capacity.test.ts`:

```ts
describe("set_capacity", () => {
  const setCap = (room: AnyRoom, ws: WebSocket, capacity: number) =>
    room.webSocketMessage(ws, JSON.stringify({ type: "set_capacity", capacity }));

  it("host-gated: a non-host sender is rejected, state unchanged", async () => {
    const { room } = makeRoom();
    const [a, b] = [mockWs(), mockWs()];
    await join(room, a, "alice"); // host
    await join(room, b, "bob");
    await setCap(room, b, 4);
    expect(room.state.capacity).toBe(2);
  });

  it("clamps to [2, 6]", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    await setCap(room, a, 99);
    expect(room.state.capacity).toBe(6);
    await setCap(room, a, 0);
    expect(room.state.capacity).toBe(2);
  });

  it("no evictions: lowering clamps to the seated count", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await setCap(room, a, 3);
    await join(room, c, "cara"); // seat 3 — queued
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("queued");
    await setCap(room, a, 2); // 3 seated → floor is 3
    expect(room.state.capacity).toBe(3);
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("queued");
  });

  it("raising promotes the longest-waiting spectators into the queue, join order", async () => {
    const { room } = makeRoom();
    const [a, b, c, d] = [mockWs(), mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara"); // spectator (capacity 2)
    await join(room, d, "dan");  // spectator
    await setCap(room, a, 3);    // one seat opens → cara only
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("queued");
    expect(room.state.players.find((p) => p.username === "dan")!.role).toBe("spectator");
    expect(room.state.queue).toEqual(["cara"]);
    await setCap(room, a, 4);    // next seat → dan
    expect(room.state.players.find((p) => p.username === "dan")!.role).toBe("queued");
    expect(room.state.queue).toEqual(["cara", "dan"]);
  });

  it("lobby-only: rejected mid-game", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.phase = "playing";
    await setCap(room, a, 4);
    expect(room.state.capacity).toBe(2);
  });

  it("ignored outside duel rooms (challenge)", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.challengeId = "abc12";
    await setCap(room, a, 4);
    expect(room.state.capacity).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/room-capacity.test.ts`
Expected: FAIL — unknown message type falls through the dispatch switch (no state change, but the promote/clamp assertions like `capacity === 6` fail).

- [ ] **Step 3: Implement**

In `src/types.ts`, add to `ClientMessage` after `{ type: "set_rows"; rows: number }` (line 151):

```ts
  | { type: "set_capacity"; capacity: number } // host-only (server-enforced): resize the duel table, clamped [max(2, seated), 6]
```

In `src/room.ts:10`, extend the import:

```ts
import { nextSeatRole, applyKothRotation, MAX_DUELISTS } from "./rotation.ts";
```

In `src/room.ts` dispatch switch, after the `set_rows` case (line 422-423):

```ts
      case "set_capacity":
        return this.onSetCapacity(ws, msg.capacity);
```

In `src/room.ts`, after `onSetRows` (line 815), add:

```ts
  // Seats are HOST authority — the first server-enforced setting gate (size/theme stay
  // shared control by design: they're cosmetic, capacity seats people). Lobby-only, duel
  // rooms only (seeded rooms keep seed.capacity; daily/challenge have no table). Clamped
  // to [max(2, seated), 6]: lowering never evicts (the floor is the seated count); raising
  // promotes the longest-waiting spectators into the rotation in join order (players[]
  // order IS join order — the roster only ever appends).
  private async onSetCapacity(ws: WebSocket, capacityRaw: number): Promise<void> {
    if (!this.isDuelRoom()) return;
    if (this.state.phase !== "lobby") {
      this.send(ws, { type: "error", message: "can't change seats mid-game" });
      return;
    }
    const who = this.userFor(ws);
    if (!who || who !== this.state.hostId) {
      this.send(ws, { type: "error", message: "only the host can change seats" });
      return;
    }
    if (typeof capacityRaw !== "number" || !Number.isFinite(capacityRaw)) {
      this.send(ws, { type: "error", message: "unsupported seat count" });
      return;
    }
    const seated = () => this.state.players.filter((p) => p.role !== "spectator").length;
    const next = Math.max(Math.max(2, seated()), Math.min(6, Math.round(capacityRaw)));
    if (next === this.state.capacity) return;
    this.state.capacity = next;
    // Promote-on-raise: each newly opened seat goes to the longest-waiting spectator.
    for (const p of this.state.players) {
      if (p.role !== "spectator") continue;
      if (seated() >= next) break;
      const duelists = this.state.players.filter((q) => q.role === "duelist").length;
      p.role = duelists < MAX_DUELISTS ? "duelist" : "queued";
      if (p.role === "queued") this.state.queue.push(p.username);
    }
    this.pushSystem(`${who} set the table to ${next} seats`);
    await this.persistAndBroadcast();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/room-capacity.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `npm test && npm run typecheck`

```bash
git add src/types.ts src/room.ts test/room-capacity.test.ts
git commit -m "feat(lobby): host-gated set_capacity — clamps [max(2,seated),6], promotes spectators on raise, never evicts"
```

---

### Task 4: Server — `publishArena` publishes real seats

**Files:**
- Modify: `src/room.ts:1816`
- Test: `test/room-capacity.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/room-capacity.test.ts`. This one needs a capturing ARENA stub, so it builds its room inline:

```ts
describe("publishArena seats label", () => {
  it("publishes seated/capacity instead of the hardcoded 1/2", async () => {
    const bodies: string[] = [];
    const sockets: WebSocket[] = [];
    const ctx = {
      storage: { get: async () => undefined, put: async () => {}, setAlarm: () => {}, deleteAlarm: () => {} },
      blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
      getWebSockets: () => sockets,
      acceptWebSocket: (ws: WebSocket) => sockets.push(ws),
      waitUntil: (p: Promise<unknown>) => { void p; },
    };
    const stub = { idFromName: (n: string) => n, get: () => ({ fetch: okFetch }) };
    const arena = {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (req: Request) => { bodies.push(await req.text()); return { ok: true } as Response; },
      }),
    };
    const env = {
      DIRECTORY: { put: async () => {}, get: async () => null },
      USER: stub, WORDSTATS: stub, SCIENCE: stub, ARENA: arena, CHALLENGE: stub, DAILY: stub,
    };
    const room = new Room(ctx as never, env as never) as unknown as AnyRoom;
    room.state.path = "alice/pub";
    room.state.owner = "alice";
    room.state.slug = "pub";
    room.state.name = "pub";
    await join(room, mockWs(), "alice");
    room.state.publicArena = true;
    room.state.capacity = 4;
    (room as unknown as { publishArena: () => void }).publishArena();
    await flush();
    expect(bodies.length).toBeGreaterThan(0);
    expect(JSON.parse(bodies[bodies.length - 1]).seats).toBe("1/4");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/room-capacity.test.ts`
Expected: FAIL — seats is `"1/2"`.

- [ ] **Step 3: Implement**

In `src/room.ts:1816`, replace `seats: "1/2",` with:

```ts
      // Real occupancy: seated (non-spectator) over the host-set capacity. This is what
      // makes the rail's isHot "last seat" glow honest for tables bigger than a 1v1.
      seats: `${this.state.players.filter((p) => p.role !== "spectator").length}/${this.state.capacity}`,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/room-capacity.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, then commit**

Run: `npm test && npm run typecheck`

```bash
git add src/room.ts test/room-capacity.test.ts
git commit -m "feat(arena): open-games feed publishes real seated/capacity"
```

---

### Task 5: Client — structural tokens (`--space-*`, `--r-*`) + lobby conversion

**Files:**
- Modify: `public/style.css:1-21` (:root), plus the lobby blocks listed below
- Test: `test/lobby-gating.test.js` (extend — source-string wiring guards)

- [ ] **Step 1: Write the failing test**

Append to `test/lobby-gating.test.js` (note: this file reads `app.js`; add a css read):

```js
const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

describe("lobby v2 structural tokens", () => {
  it("defines the 4pt spacing scale and radius family in :root", () => {
    const root = css.slice(0, css.indexOf("}"));
    for (const t of ["--space-1: 4px", "--space-2: 8px", "--space-3: 12px",
                     "--space-4: 16px", "--space-5: 24px", "--space-6: 32px",
                     "--r-sm: 6px", "--r-md: 8px", "--r-lg: 14px"]) {
      expect(root).toContain(t);
    }
  });
  it("lobby components consume the tokens", () => {
    expect(css).toContain("border-radius: var(--r-md)");
    expect(css).toContain("border-radius: var(--r-sm)");
    expect(css).toContain("gap: var(--space-2)");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/lobby-gating.test.js`
Expected: FAIL — no tokens in `:root`.

- [ ] **Step 3: Implement**

In `public/style.css`, inside `:root` (after `--font-body`, line 20), add:

```css
  /* Lobby v2 structural tokens (spec 2026-06-07): a 4pt spacing scale + ONE radius
     family. Components consume these so rhythm/rounding are decided once, not per card.
     Radius roles: cards (rail, chat, dimpop, seats) = --r-md; small controls (buttons,
     steppers) = --r-sm; large surfaces = --r-lg. */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --r-sm: 6px;
  --r-md: 8px;
  --r-lg: 14px;
```

Then convert the lobby components (line numbers as of this writing; match on selector if drifted). Each row is one property edit — nearest-token snapping is deliberate (it IS the harmonization):

| Where (selector) | Property | Old | New |
|---|---|---|---|
| `body.lobby .lobby-grid` (~3277) | `gap` | `14px` | `var(--space-4)` |
| `body.lobby .lobby-left` (~3284) | `gap` | `18px` | `var(--space-4)` |
| `body.lobby .lobby-right` (~3288) | `gap` | `14px` | `var(--space-4)` |
| `body.lobby .lobby-left .lobby-controls` (~3309) | `gap` | `10px` | `var(--space-2)` |
| `body.lobby .lobby-left .lobby-controls .btn.primary` (~3314) | `border-radius` | `5px` | `var(--r-sm)` |
| `body.lobby .lobby-left .lobby-pair` (~3334) | `gap` | `8px` | `var(--space-2)` |
| `.lobby-pair-btn` (~3341) | `gap` | `8px` | `var(--space-2)` |
| `.lobby-pair-btn` (~3344) | `border-radius` | `6px` | `var(--r-sm)` |
| `.dim` (~3372) | `border-radius` | `6px` | `var(--r-sm)` |
| `.dimpop` (~3393) | `border-radius` | `8px` | `var(--r-md)` |
| `.dimpop` (~3393) | `padding` | `10px` | `var(--space-2)` |
| `.step button` (~3409) | `border-radius` | `5px` | `var(--r-sm)` |
| `.mytable` (~3425) | `gap` | `12px` | `var(--space-3)` |
| `.mytable` (~3426) | `padding-top` | `16px` | `var(--space-4)` |
| `.mytable-seats` (~3431) | `gap` | `6px` | `var(--space-2)` |
| `.seat` (~3434) | `border-radius` | `8px` | `var(--r-md)` |
| `body.lobby .lobby-rail` (~3469) | `border-radius` | `6px` | `var(--r-md)` |
| `body.lobby .lobby-rail` (~3472) | `padding` | `14px 12px 12px` | `var(--space-3)` |
| `body.lobby .arena-row` (~3479) | `border-radius` | `5px` | `var(--r-sm)` |
| `.chat-panel` (~1162) | `border-radius` | `8px` | `var(--r-md)` |

(`.chat-panel` is used outside the lobby too — `--r-md` is 8px, so this one is a pure no-op conversion.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/lobby-gating.test.js`
Expected: PASS.

- [ ] **Step 5: Eyeball + commit**

Run: `npm test` (full).
Optionally `npm run dev` and eyeball a lobby at 390px and desktop — expect a slightly tighter, more even rhythm; no layout breakage (seat strip still fits: 6×44px seats + 5×8px gaps = 304px < 340px max-width).

```bash
git add public/style.css test/lobby-gating.test.js
git commit -m "feat(design): structural tokens — 4pt spacing scale + radius family, lobby converted"
```

---

### Task 6: Client — `seatModel` v2 (spectators, watching, spectator viewer) + `railPillLabel`

**Files:**
- Modify: `public/lobby-view.js:8-21`
- Test: `test/lobby-view.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/lobby-view.test.js`:

```js
describe("seatModel spectators (Lobby v2)", () => {
  const snap = {
    capacity: 2,
    players: [
      { username: "papa", role: "duelist", ready: true },
      { username: "kai", role: "duelist" },
      { username: "zoe", role: "spectator" },
      { username: "ana", role: "spectator" },
    ],
  };
  it("excludes spectators from seats and counts them as watching", () => {
    const m = seatModel(snap, "papa");
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken"]);
    expect(m.taken).toBe(2);
    expect(m.capacity).toBe(2);
    expect(m.watching).toBe(2);
    expect(m.iAmSpectator).toBe(false);
  });
  it("a spectator viewer gets no you-seat and knows it", () => {
    const m = seatModel(snap, "zoe");
    expect(m.seats.map((s) => s.kind)).toEqual(["taken", "taken"]);
    expect(m.iAmSpectator).toBe(true);
    expect(m.watching).toBe(2); // zoe counts herself among the watchers
  });
  it("legacy snapshots without roles still seat everyone", () => {
    const m = seatModel({ capacity: 3, players: [{ username: "papa" }, { username: "kai" }] }, "papa");
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken", "empty"]);
    expect(m.watching).toBe(0);
  });
});

describe("railPillLabel", () => {
  it("pluralizes the open-tables count", () => {
    expect(railPillLabel(0)).toBe("0 tables open");
    expect(railPillLabel(1)).toBe("1 table open");
    expect(railPillLabel(7)).toBe("7 tables open");
  });
});
```

And extend the import at the top of the file:

```js
import { triesFor, seatModel, compactRowProps, ghostSeatModel, railPillLabel } from "../public/lobby-view.js";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/lobby-view.test.js`
Expected: FAIL — `railPillLabel` not exported; spectator seats wrong.

- [ ] **Step 3: Implement**

Replace `seatModel` (and its doc comment) in `public/lobby-view.js:8-21` with:

```js
// Build the "Your table" seat model from a snapshot. Seats hold the rotation roster only
// (duelists + queued, capped at capacity); spectators are excluded and surface as a
// `watching` count instead. Seat 0 is "you" — unless YOU are the spectator (iAmSpectator),
// in which case there is no you-seat and the strip shows the table you're watching.
// capacity falls back to max(2, seated) when the server didn't send one.
export function seatModel(snap, me) {
  const players = Array.isArray(snap && snap.players) ? snap.players : [];
  const seated = players.filter((p) => p && p.role !== "spectator");
  const watching = players.length - seated.length;
  const mine = players.find((p) => p && p.username === me);
  const iAmSpectator = !!(mine && mine.role === "spectator");
  const capacity = Math.max(2, Number(snap && snap.capacity) || seated.length || 2);
  const others = seated.filter((p) => p.username !== me);
  const seats = [];
  if (!iAmSpectator) seats.push({ kind: "you", username: me, icon: null, ready: !!(mine && mine.ready) });
  for (const p of others) seats.push({ kind: "taken", username: p.username, isBot: !!p.isBot, ready: !!p.ready });
  while (seats.length < capacity) seats.push({ kind: "empty" });
  return {
    seats: seats.slice(0, Math.max(capacity, seats.length)),
    taken: seats.filter((s) => s.kind !== "empty").length,
    capacity,
    watching,
    iAmSpectator,
  };
}

// The mobile rail pill's label — the "▸" arrow is markup, this is just the words.
export function railPillLabel(n) {
  const c = Number(n) || 0;
  return `${c} table${c === 1 ? "" : "s"} open`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/lobby-view.test.js`
Expected: PASS — including the pre-existing seatModel tests (no `role` field ⇒ everyone seated, as before; `taken` for a seated viewer still equals the headcount).

- [ ] **Step 5: Commit**

```bash
git add public/lobby-view.js test/lobby-view.test.js
git commit -m "feat(lobby): seatModel v2 — spectators excluded from seats, watching count, spectator viewer; railPillLabel"
```

---

### Task 7: Client — seat-strip steppers, watching chip, spectator hint

**Files:**
- Modify: `public/index.html:239-243` (#myTable), `public/index.html:177` (#lobbyControls)
- Modify: `public/app.js` (renderMyTable ~2745, render lobby branch ~2849, new helpers near canEditLength ~3280)
- Modify: `public/style.css` (after the `.mytable-cnt` block, ~3455)
- Test: `test/lobby-gating.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/lobby-gating.test.js`:

```js
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

describe("lobby v2 seat strip wiring", () => {
  it("the seat strip carries capacity steppers, a watching chip, and the spectator hint", () => {
    for (const id of ["capMinus", "capPlus", "myTableWatch", "spectatorHint"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
  it("canEditCapacity is strictly host-gated (server enforces; no un-hosted fallback)", () => {
    const fn = app.slice(app.indexOf("function canEditCapacity"), app.indexOf("function canEditCapacity") + 400);
    expect(fn).toContain("snap.hostId === getUsername()");
    expect(fn).toContain("snap.isDuel");
  });
  it("stepCapacity clamps and sends set_capacity", () => {
    const fn = app.slice(app.indexOf("function stepCapacity"), app.indexOf("function stepCapacity") + 600);
    expect(fn).toContain('send({ type: "set_capacity"');
    expect(fn).toContain("MAX_CAPACITY");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/lobby-gating.test.js`
Expected: FAIL on all three.

- [ ] **Step 3: Implement — HTML**

Replace `public/index.html:239-243` (#myTable) with:

```html
          <div class="mytable" id="myTable" hidden aria-label="Your table">
            <span class="mytable-lab"></span>
            <div class="mytable-seats" id="myTableSeats"></div>
            <button type="button" class="cap-step" id="capMinus" aria-label="Fewer seats" hidden>−</button>
            <span class="mytable-cnt" id="myTableCount">1/2</span>
            <button type="button" class="cap-step" id="capPlus" aria-label="More seats" hidden>+</button>
            <span class="mytable-watch" id="myTableWatch" hidden></span>
          </div>
```

In `public/index.html:177`, after the `#startBtn` line, add:

```html
        <p id="spectatorHint" class="spectator-hint" hidden>watching — table full</p>
```

- [ ] **Step 4: Implement — app.js helpers**

After `canEditLength` (ends at `public/app.js:3280`), add:

```js
// Capacity is HOST authority — server-enforced (onSetCapacity), unlike the shared-control
// size settings — so there is no un-hosted fallback here: no host, no steppers. Mirrors
// the server clamp [max(2, seated), 6]; the snapshot repaints, we never desync optimistically.
const MIN_CAPACITY = 2;
const MAX_CAPACITY = 6;
function canEditCapacity(snap) {
  if (!snap || snap.phase !== "lobby" || game.isDaily || game.challengeId) return false;
  if (!snap.isDuel) return false;
  return !!snap.hostId && snap.hostId === getUsername();
}
function stepCapacity(d) {
  const snap = game.snapshot;
  if (!canEditCapacity(snap)) return;
  const seated = (snap.players || []).filter((p) => p && p.role !== "spectator").length;
  const lo = Math.max(MIN_CAPACITY, seated);
  const clamped = Math.max(lo, Math.min(MAX_CAPACITY, (Number(snap.capacity) || MIN_CAPACITY) + d));
  if (clamped === snap.capacity) return;
  send({ type: "set_capacity", capacity: clamped });
}
function wireCapSteppers() {
  for (const [id, d] of [["#capMinus", -1], ["#capPlus", 1]]) {
    const btn = $(id);
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = "1";
      btn.addEventListener("click", (e) => { e.stopPropagation(); stepCapacity(d); });
    }
  }
}

// Spectator's lobby view: the Ready button is hidden (role gate in applyDuelReadyButton);
// this quiet line fills the hole so "no button" reads as a state, not a bug.
function applySpectatorHint(snap, me) {
  const hint = $("#spectatorHint");
  if (!hint) return;
  hint.hidden = !(snap.phase === "lobby" && snap.isDuel && me && me.role === "spectator");
}
```

- [ ] **Step 5: Implement — renderMyTable + render**

In `renderMyTable` (`public/app.js:2745-2786`), after the `countEl` update block (ends ~2785), add before the closing brace:

```js
  // Capacity steppers — host-only, lobby-only, duel-only (the server enforces the same
  // gate; these just don't render for anyone else). Bounds mirror onSetCapacity's clamp.
  const capMinus = $("#capMinus");
  const capPlus = $("#capPlus");
  if (capMinus && capPlus) {
    const editable = canEditCapacity(snap);
    capMinus.hidden = capPlus.hidden = !editable;
    if (editable) {
      const lo = Math.max(MIN_CAPACITY, model.taken);
      capMinus.disabled = model.capacity <= lo;
      capPlus.disabled = model.capacity >= MAX_CAPACITY;
    }
    wireCapSteppers();
  }
  // Watchers are company, not seats — a quiet chip after the count.
  const watchEl = $("#myTableWatch");
  if (watchEl) {
    const n = model.watching || 0;
    watchEl.hidden = !n;
    watchEl.textContent = n ? `+${n} watching` : "";
  }
```

In `render()`'s lobby branch (`public/app.js:2844-2850`), after the `applyDuelReadyButton(startBtn, snap, me)` / `startBtn.hidden = false` pair, add:

```js
    applySpectatorHint(snap, me);
```

(Other phases hide `#lobby`/`#lobbyControls` wholesale, so the hint vanishes with its container.)

- [ ] **Step 6: Implement — CSS**

In `public/style.css`, after the `.mytable-cnt` block (~3455), add:

```css
/* Capacity steppers — the host resizes the table right where the count lives.
   Same control language as the dimpop .step buttons. */
.cap-step {
  width: 24px; height: 24px; flex: none; border-radius: var(--r-sm);
  border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--border));
  background: color-mix(in oklab, var(--bg-card) 60%, transparent);
  color: var(--accent); font-size: 14px; cursor: pointer;
  display: grid; place-items: center; transition: 0.12s;
}
.cap-step:hover:not(:disabled) { background: color-mix(in oklab, var(--accent) 16%, transparent); }
.cap-step:disabled { opacity: 0.3; cursor: default; }
.cap-step[hidden] { display: none; }
/* Watchers are company, not seats — a quiet chip after the count. */
.mytable-watch {
  font-family: var(--font-body); font-size: 11px; font-weight: 600;
  color: var(--muted); white-space: nowrap;
}
/* Spectator's stand-in for the hidden Ready button. */
.spectator-hint {
  margin: 0; font-family: var(--font-body); font-size: 13px; font-weight: 600;
  color: var(--muted); text-align: center;
}
```

- [ ] **Step 7: Run to verify it passes, full suite, commit**

Run: `npx vitest run test/lobby-gating.test.js` then `npm test`
Expected: PASS.

```bash
git add public/index.html public/app.js public/style.css test/lobby-gating.test.js
git commit -m "feat(lobby): seat strip is the capacity control — host steppers, +N watching chip, spectator hint"
```

---

### Task 8: Client — chat-first mobile order

**Files:**
- Modify: `public/app.js:3014-3042` (arrangeLobbyLayout)
- Modify: `public/style.css` (after the `@media (max-width: 880px)` lobby-grid rule, ~3291-3293)
- Test: `test/lobby-gating.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/lobby-gating.test.js`:

```js
describe("lobby v2 mobile order", () => {
  it("arrangeLobbyLayout appends chat BEFORE the rail (mobile-first DOM)", () => {
    const fn = app.slice(app.indexOf("function arrangeLobbyLayout"), app.indexOf("function arrangeLobbyLayout") + 1600);
    const chatAt = fn.indexOf("right.appendChild(chat)");
    const railAt = fn.indexOf("right.appendChild(rail)");
    expect(chatAt).toBeGreaterThan(-1);
    expect(railAt).toBeGreaterThan(-1);
    expect(chatAt).toBeLessThan(railAt);
  });
  it("desktop lifts the rail above chat via flex order", () => {
    expect(css).toMatch(/min-width: 881px[\s\S]{0,200}\.lobby-rail \{ order: -1; \}/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/lobby-gating.test.js`
Expected: FAIL on both.

- [ ] **Step 3: Implement**

In `arrangeLobbyLayout` (`public/app.js:3014-3042`), replace the lobby branch:

```js
  if (isLobby) {
    if (controls) left.appendChild(controls);   // Start under the board / badge / your-table
    // Mobile-first DOM order (≤880px single column): chat comes right after the left
    // zone, the tables rail (a collapsed pill on mobile, Task 9) last. Desktop (≥881px)
    // lifts the rail above chat via flex order — the two-zone look is unchanged.
    if (chat) right.appendChild(chat);          // chat first in the right zone
    if (rail) right.appendChild(rail);          // floor after it
  } else {
```

In `public/style.css`, right after the existing `@media (max-width: 880px) { body.lobby .lobby-grid { grid-template-columns: 1fr; } }` rule (~3291-3293), add:

```css
/* Desktop two-zone: rail above chat. The DOM order is mobile-first (chat before rail —
   the §3 order: … → CHAT → tables pill), so desktop restores rail-on-top with flex order. */
@media (min-width: 881px) {
  body.lobby .lobby-rail { order: -1; }
}
```

- [ ] **Step 4: Run to verify it passes, full suite, commit**

Run: `npx vitest run test/lobby-gating.test.js && npm test`
Expected: PASS.

```bash
git add public/app.js public/style.css test/lobby-gating.test.js
git commit -m "feat(lobby): chat-first mobile order — chat before rail in DOM, desktop keeps rail on top"
```

---

### Task 9: Client — collapsed "▸ N tables open" rail pill (mobile)

**Files:**
- Modify: `public/arena-panel.js:69-114` (onCount), `public/index.html:267-270` (pill header), `public/app.js:38` (import), `public/app.js:1549-1562` (mountLobbyRailIfNeeded + wireLobbyRailPill)
- Modify: `public/style.css` (after the Task 8 media rule)
- Test: `test/arena-panel.test.js`, `test/lobby-gating.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/arena-panel.test.js` (source-string check — `mountArenaList` is DOM-bound and these tests run in node):

```js
import { readFileSync } from "node:fs";

describe("rail pill count plumbing", () => {
  const src = readFileSync(new URL("../public/arena-panel.js", import.meta.url), "utf8");
  it("mountArenaList reports the visible count via onCount", () => {
    expect(src).toContain("onCount");
    expect(src).toContain("onCount(state === \"list\" ? visible.length : 0)");
  });
});
```

Append to `test/lobby-gating.test.js`:

```js
describe("lobby v2 rail pill", () => {
  it("the rail has a pill header and the lobby wires its toggle + live count", () => {
    expect(html).toContain('id="lobbyRailPill"');
    expect(html).toContain('id="lobbyRailPillCount"');
    expect(app).toContain("railPillLabel");
    expect(app).toContain("function wireLobbyRailPill");
  });
  it("mobile collapses the rail to the pill via CSS", () => {
    expect(css).toMatch(/\.lobby-rail:not\(\.expanded\)[\s\S]{0,120}\.lobby-rail-list \{ display: none; \}/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/arena-panel.test.js test/lobby-gating.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement — arena-panel.js**

In `mountArenaList` (`public/arena-panel.js:69`), accept the callback:

```js
export function mountArenaList(mountEl, { onJoin, excludePath, onCount } = {}) {
```

In `draw()`, right after `lastState = state;` (line 80), add:

```js
    // Live count for the lobby rail's mobile pill ("▸ N tables open"). Only meaningful
    // states report: loading/error keep the last good number instead of flashing 0.
    if (onCount && (state === "list" || state === "empty")) onCount(state === "list" ? visible.length : 0);
```

- [ ] **Step 4: Implement — HTML**

Replace `public/index.html:267-270` (#lobbyRail) with:

```html
      <aside id="lobbyRail" class="lobby-rail" hidden>
        <button type="button" id="lobbyRailPill" class="lobby-rail-pill" aria-expanded="false">
          <span class="lobby-rail-pill-arrow" aria-hidden="true">▸</span>
          <span id="lobbyRailPillCount">0 tables open</span>
        </button>
        <h3 class="lobby-rail-title">Tables</h3>
        <div id="lobbyRailList" class="lobby-rail-list"></div>
      </aside>
```

- [ ] **Step 5: Implement — app.js**

Extend the import at `public/app.js:38`:

```js
import { seatModel, ghostSeatModel, railPillLabel } from "/lobby-view.js";
```

Replace `mountLobbyRailIfNeeded` (`public/app.js:1549-1562`) with:

```js
function mountLobbyRailIfNeeded() {
  const el = $("#lobbyRail");
  const list = $("#lobbyRailList");
  if (!el || !list) return;
  el.hidden = false;
  wireLobbyRailPill(el);
  if (lobbyRailStop) return; // already polling — don't restart on every render()
  const mine = `/@${game.owner}/${game.slug}`;
  lobbyRailStop = mountArenaList(list, {
    excludePath: mine,
    // Defect: leave this room and jump into the tapped one. showRoom()→leaveRoom() closes
    // the current socket; the 45s abandon-grace then delists the table I bailed from.
    onJoin: (routePath) => { pendingArenaOrigin = true; navigate(routePath); },
    // Mobile pill header rides the same poll — "▸ N tables open" stays live while collapsed.
    onCount: (n) => {
      const c = $("#lobbyRailPillCount");
      if (c) c.textContent = railPillLabel(n);
    },
  });
}

// The mobile rail collapses to a "▸ N tables open" pill; tap toggles the list open.
// Collapsed-vs-expanded is pure CSS (≤880px scoped) — desktop never shows the pill, so
// the class is inert there. Wired once per mount (the room template rebuilds the node).
function wireLobbyRailPill(el) {
  const pill = $("#lobbyRailPill");
  if (!pill || pill.dataset.wired) return;
  pill.dataset.wired = "1";
  pill.addEventListener("click", () => {
    const expanded = el.classList.toggle("expanded");
    pill.setAttribute("aria-expanded", String(expanded));
  });
}
```

- [ ] **Step 6: Implement — CSS**

In `public/style.css`, after the Task 8 `@media (min-width: 881px)` rule, add:

```css
/* Mobile rail pill: ≤880px the rail collapses to "▸ N tables open"; tap expands the
   list in place (the poll never stops). Desktop never sees the pill. */
.lobby-rail-pill { display: none; }
@media (max-width: 880px) {
  body.lobby .lobby-rail-title { display: none; } /* the pill IS the header on mobile */
  body.lobby .lobby-rail {
    padding: 0; border: none; background: none;
    backdrop-filter: none; -webkit-backdrop-filter: none;
  }
  body.lobby .lobby-rail-pill {
    display: flex; align-items: center; gap: var(--space-2);
    width: 100%; padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklab, var(--fg) 7%, var(--border));
    border-radius: var(--r-md);
    background: color-mix(in oklab, var(--bg-card) 60%, transparent);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    color: var(--muted); font-family: var(--font-body);
    font-size: 12px; font-weight: 600; cursor: pointer;
  }
  body.lobby .lobby-rail-pill-arrow { transition: transform 0.16s ease; }
  body.lobby .lobby-rail.expanded .lobby-rail-pill-arrow { transform: rotate(90deg); }
  body.lobby .lobby-rail:not(.expanded) .lobby-rail-list { display: none; }
  /* Expanded: the card surface returns around pill + list. */
  body.lobby .lobby-rail.expanded {
    border: 1px solid color-mix(in oklab, var(--fg) 7%, var(--border));
    border-radius: var(--r-md);
    background: color-mix(in oklab, var(--bg-card) 60%, transparent);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    padding: var(--space-2);
  }
  body.lobby .lobby-rail.expanded .lobby-rail-pill {
    border: none; background: none; backdrop-filter: none; -webkit-backdrop-filter: none;
    padding: var(--space-1) var(--space-1) var(--space-2);
  }
}
```

- [ ] **Step 7: Run to verify, full suite, commit**

Run: `npx vitest run test/arena-panel.test.js test/lobby-gating.test.js && npm test`
Expected: PASS.

```bash
git add public/arena-panel.js public/index.html public/app.js public/style.css test/arena-panel.test.js test/lobby-gating.test.js
git commit -m "feat(lobby): mobile tables pill — collapsed '▸ N tables open' rail, tap to expand, live count"
```

---

### Task 10: Verify end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `npm test && npm run typecheck`
Expected: everything green.

- [ ] **Step 2: Manual QA (npm run dev, two browser windows)**

1. Create a room → lobby shows **1/2** (not 1/8); host sees − / + beside the count; − disabled at 2.
2. `+` to 4 → second window (guest) sees 4 slots; guest sees **no** steppers.
3. Join 5 humans into a capacity-2 room (or set capacity 2 with 3+ joined): 3rd+ joiners show as "+N watching", get the "watching — table full" hint, no Ready button, can chat, see boards mid-game.
4. Host raises capacity → earliest watcher pops into a seat (queue strip), chip count drops.
5. At ≤880px (device toolbar, 390px): order is Board → 5×6 → seats → READY → Setup·Invite → CHAT → "▸ N tables open" pill; pill expands/collapses; count updates within ~8s of another public room opening.
6. Desktop ≥881px: two-zone unchanged — rail above chat on the right.
7. Mid-game `set_capacity` rejected (steppers hidden anyway); challenge/daily rooms unaffected.

- [ ] **Step 3: Wrap up**

Use superpowers:finishing-a-development-branch. Ship is `bash dev/ship.sh` from the worktree — only on Yan's go.

---

## Self-review notes

- **Spec coverage**: §1 capacity+spectators+set_capacity → Tasks 1–3; §1 feed honesty → Task 4; §2 strip/steppers/chip/hint → Tasks 6–7; §3 mobile order+pill → Tasks 8–9; §4 tokens → Task 5 (ritual brief itself = Plan B).
- **Deliberate contract change**: 3rd joiner in a fresh duel room is now a *spectator* (was *queued*) until the host raises capacity — `test/room-duel.test.ts`'s seating test must be updated to the new contract (called out in Task 2 Step 5).
- **Type thread**: `SeatRole` is defined in `rotation.ts`; `types.ts` keeps its inline union (matches today's style — the two files already duplicate the union deliberately).
