# Lobby host model + compact challenge lobby — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the lobby's phantom-rows gap, make the challenge (solo-vs-ghosts) lobby truthful (locked 5×6, ghost seat strip), and add a host concept (`hostId` + succession) that gates the in-lobby 5×6 popover in multiplayer rooms — with a guest fallback in Settings → Room.

**Architecture:** Server is source of truth: a new `hostId` lives on the persisted `RoomSnapshot` in the Room Durable Object (`src/room.ts`) and rides the existing `snapshotFor` spread to clients. All client gating is render-from-snapshot in `public/app.js`. Pure view models stay in `public/lobby-view.js`. Server stays permissive for `set_length`/`set_rows` in multiplayer rooms (guest path works) but rejects them in challenge rooms (word is pinned).

**Tech Stack:** Cloudflare Workers Durable Objects (TypeScript), vanilla JS client, vitest (plain Node — Room DO tested via direct `new Room()` with mocked ctx/env, harness pattern in `test/room-duel.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-06-lobby-host-ready-design.md`

**Worktree:** `/Users/zang/wordul/.claude/worktrees/lobby-host` (branch `lobby-host`). All paths below are relative to it. Run commands from the worktree root.

---

### Task 1: Server — `hostId` field, assignment + succession

**Files:**
- Modify: `src/types.ts` (RoomSnapshot, ~line 83 next to `owner`)
- Modify: `src/room.ts` (ctor ~131, restore ~143, onHello ~552, webSocketClose ~324, new helper near `--- handlers ---` ~377)
- Test: `test/room-host.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `test/room-host.test.ts`. Copy the harness verbatim from the top of `test/room-duel.test.ts` (the `vi.mock("cloudflare:workers", ...)`, `mockWs()`, `makeRoom()`, `join()` pieces — including its `AnyRoom` cast and the stubbed `env`). Then:

```ts
describe("host model", () => {
  it("first human to hello becomes host, silently", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    expect(room.state.hostId).toBe("alice");
    // initial assignment is not announced
    expect(room.state.chat.some((c) => /is now the host/.test(c.text ?? c.message ?? ""))).toBe(false);
  });

  it("host passes to the next connected human in join order on disconnect", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara");
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe("bob");
    expect(room.state.chat.some((m) => /bob is now the host/.test(m.text ?? m.message ?? ""))).toBe(true);
  });

  it("clears when the room empties; next joiner becomes host", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe(null);
    const b = mockWs();
    await join(room, b, "bob");
    expect(room.state.hostId).toBe("bob");
  });

  it("no reclaim: a returning ex-host stays guest", async () => {
    const { room } = makeRoom();
    const [a, b] = [mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe("bob");
    const a2 = mockWs();
    await join(room, a2, "alice"); // reconnect path (existing roster entry)
    expect(room.state.hostId).toBe("bob");
  });

  it("snapshot carries hostId to clients", async () => {
    const { room } = makeRoom();
    await join(room, mockWs(), "alice");
    expect((room as never as { snapshotFor: (v: string | null) => { hostId?: string | null } }).snapshotFor("alice").hostId).toBe("alice");
  });
});
```

Note on the chat assertions: check the actual shape of `pushSystem` entries in `src/room.ts` (grep `pushSystem`) and use the real property (`text` vs `message`) instead of the `??` fallback if it's unambiguous.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/room-host.test.ts`
Expected: FAIL — `room.state.hostId` is `undefined`.

- [ ] **Step 3: Implement**

`src/types.ts` — in `RoomSnapshot`, directly under `owner: string;`:

```ts
  hostId?: string | null; // settings authority: first connected human; succession on disconnect, no reclaim
```

`src/room.ts`:

1. Constructor initial state (after `owner: "",` ~line 104): add `hostId: null,`
2. Restore backfill (in the `if (restored)` block, alongside the other backfills ~line 143): `if (restored.hostId === undefined) restored.hostId = null;`
3. New private method (put it just above the `// --- handlers ---` comment ~line 377):

```ts
  // --- Host: settings authority in multiplayer lobbies --------------------------
  // First connected human holds the host seat; when they disconnect it passes to the
  // next connected human in join order. No reclaim — a returning ex-host is a guest.
  // Bots never host; daily rooms have no host. Announce changes, not the first seat.
  private assignHost(): void {
    if (this.state.isDaily) return;
    const cur = this.state.players.find((p) => p.username === this.state.hostId);
    if (cur && cur.connected && !cur.isBot) return; // host still seated
    const prev = this.state.hostId ?? null;
    const next = this.state.players.find((p) => p.connected && !p.isBot) ?? null;
    this.state.hostId = next ? next.username : null;
    if (this.state.hostId && prev && this.state.hostId !== prev) {
      this.pushSystem(`${this.state.hostId} is now the host`);
    }
  }
```

4. Call site A — `onHello`: after the join/reconnect if/else completes, right before the `// Register this player in the directory` comment (~line 553), add: `this.assignHost();`
5. Call site B — `webSocketClose`: immediately after the `if (p && p.connected) { ... }` block that marks the player disconnected (~line 324), add: `this.assignHost();`

Both paths already end in `persistAndBroadcast()`, so no extra broadcast is needed. `hostId` reaches clients automatically via `snapshotFor`'s `...this.state` spread (it is not in the strip list at room.ts:2056-2067 — verify nothing strips it).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/room-host.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Verify no regressions, commit**

Run: `npm test`
Expected: full suite green (if a pre-existing failure appears, confirm it exists on `origin/main` before proceeding).

```bash
git add src/types.ts src/room.ts test/room-host.test.ts
git commit -m "feat(room): hostId — first connected human, join-order succession, no reclaim"
```

---

### Task 2: Server — reject `set_length`/`set_rows` in challenge rooms

**Files:**
- Modify: `src/room.ts` (`onSetLength` ~697, `onSetRows` ~718)
- Test: `test/room-host.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** (append to `test/room-host.test.ts`)

```ts
describe("challenge rooms pin the word — size is locked", () => {
  it("rejects set_length and set_rows when challengeId is set", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.challengeId = "abc12";
    const len = room.state.wordLength;
    const rows = room.state.maxGuesses;
    await room.webSocketMessage(a, JSON.stringify({ type: "set_length", wordLength: len === 5 ? 6 : 5 }));
    await room.webSocketMessage(a, JSON.stringify({ type: "set_rows", rows: rows === 6 ? 7 : 6 }));
    expect(room.state.wordLength).toBe(len);
    expect(room.state.maxGuesses).toBe(rows);
  });

  it("still accepts them in a normal room", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    await room.webSocketMessage(a, JSON.stringify({ type: "set_rows", rows: 7 }));
    expect(room.state.maxGuesses).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/room-host.test.ts`
Expected: first new test FAILS (length/rows changed).

- [ ] **Step 3: Implement**

In both `onSetLength` (after its `isDaily` guard, room.ts:698) and `onSetRows` (after its `isDaily` guard, room.ts:719), add:

```ts
    if (this.state.challengeId) {
      this.send(ws, { type: "error", message: "challenge word is pinned" });
      return;
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/room-host.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts test/room-host.test.ts
git commit -m "feat(room): challenge rooms reject set_length/set_rows — the word is pinned"
```

---

### Task 3: Client — collapse the lobby gap (1 row track)

**Files:**
- Modify: `public/app.js` (`renderBoards` ~3387-3404)

- [ ] **Step 1: Make the change**

In `renderBoards`, today (~3387-3392):

```js
  const cols = snap.wordLength;
  const rows = snap.maxGuesses;
  board.style.setProperty("--cols", String(cols));
  board.style.setProperty("--rows", String(rows));
  grid.style.setProperty("--rows", String(rows));
```

and later (~3401-3402):

```js
  const isLobby = snap.phase === "lobby";
  const rowsToDraw = isLobby ? 1 : rows;
```

Hoist the lobby decision above the property sets so the grid only reserves the tracks it draws:

```js
  const cols = snap.wordLength;
  const rows = snap.maxGuesses;
  // Lobby: a single teaser row — and only ONE grid track, so no phantom-rows gap.
  // The full grid re-renders on leaving lobby; the bloom stagger (style.css §7) is a
  // per-row opacity animation on that re-render, so it needs no pre-reserved tracks.
  const isLobby = snap.phase === "lobby";
  const rowsToDraw = isLobby ? 1 : rows;
  board.style.setProperty("--cols", String(cols));
  board.style.setProperty("--rows", String(rowsToDraw));
  grid.style.setProperty("--rows", String(rowsToDraw));
```

Then delete the now-duplicate `const isLobby` / `const rowsToDraw` declarations at ~3401-3402. Check the lines between the two sites for any other use of the full `rows` value (e.g. sizing math) — those should keep using `rows`, not `rowsToDraw`.

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, open a room lobby (`http://localhost:8787/@you/test`), confirm: single row, 5×6 control + seat strip + Setup·Invite sit directly under it, no gap. Start a game → bloom still staggers rows in. Then stop the dev server.

- [ ] **Step 3: Run suite, commit**

Run: `npm test`
Expected: green.

```bash
git add public/app.js
git commit -m "fix(lobby): grid reserves only the teaser row — phantom-rows gap collapsed"
```

---

### Task 4: Client — host-gated dim control, challenge lock

**Files:**
- Modify: `public/app.js` (`canEditLength` ~3167)
- Test: `test/lobby-gating.test.js` (create — source-wiring assertions, pattern from `test/room-core.test.ts:184-198`)

- [ ] **Step 1: Write the failing test**

```js
// test/lobby-gating.test.js — source-wiring guards: the client-side gates that have no
// jsdom harness. Pattern borrowed from room-core.test.ts's wiring assertions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

describe("lobby gating wiring", () => {
  it("canEditLength is host-gated and challenge-locked", () => {
    const fn = app.slice(app.indexOf("function canEditLength"), app.indexOf("function canEditLength") + 500);
    expect(fn).toContain("game.challengeId");
    expect(fn).toContain("snap.hostId");
  });
  it("lobby board reserves a single row track", () => {
    const rb = app.slice(app.indexOf("function renderBoards"), app.indexOf("function renderBoards") + 1200);
    expect(rb).toContain('setProperty("--rows", String(rowsToDraw))');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/lobby-gating.test.js`
Expected: first assertion FAILS (canEditLength has no hostId yet); second PASSES (Task 3 done).

- [ ] **Step 3: Implement**

Replace `canEditLength` (app.js ~3165-3169) — keep its explanatory comment style:

```js
// Length can only be changed while genuinely in a multiplayer lobby — and only by the
// host (snap.hostId: first connected human, succession on disconnect). Challenge rooms
// pin the word, so the dim control is read-only there (the server rejects the messages
// too). An un-hosted snapshot (older server) stays editable for everyone.
function canEditLength(snap) {
  if (!snap || snap.phase !== "lobby" || game.isDaily) return false;
  if (game.challengeId) return false;
  return !snap.hostId || snap.hostId === getUsername();
}
```

No other client change: `render()` (app.js:2802-2808) already paints `.locked` and disables the steppers from `canEditLength`, and `wireDim` (3211) already gates the popover open on it.

- [ ] **Step 4: Verify the `.locked` style exists**

Run: `grep -n "dimwrap.locked\|\.locked" public/style.css`
Expected: a rule dimming/locking the dim control. If none exists, add next to the `.dimwrap` rules (~style.css:3327):

```css
.dimwrap.locked #dim { pointer-events: none; opacity: 0.6; }
```

- [ ] **Step 5: Run to verify pass, commit**

Run: `npx vitest run test/lobby-gating.test.js && npm test`
Expected: PASS.

```bash
git add public/app.js public/style.css test/lobby-gating.test.js
git commit -m "feat(lobby): 5x6 dim control is host-only; read-only in challenge rooms"
```

---

### Task 5: Client — Settings → Room rows select (the guest path)

**Files:**
- Modify: `public/index.html` (Room section, ~line 386-391)
- Modify: `public/app.js` (`syncLengthSelect` ~3142, new `syncRowsSelect`, `showSettings` mount ~4828)

- [ ] **Step 1: Add the markup**

In `public/index.html`, inside `#roomSettingsSection`'s `.settings-section-body`, after the existing Word-length `.setting-row`:

```html
        <div class="setting-row">
          <div class="setting-text">
            <div class="setting-name">Rows</div>
            <div class="setting-desc">Guesses per game — set before the game starts</div>
          </div>
          <select id="rowsSelect" class="length-select" aria-label="Rows"></select>
        </div>
```

- [ ] **Step 2: Add `syncRowsSelect` and challenge-disable both selects**

In `public/app.js`, directly under `syncLengthSelect` (~3162), add:

```js
// Rows twin of syncLengthSelect — the guest-reachable path for set_rows (the in-lobby
// dim popover is host-only). Options mirror the server clamp [MIN_ROWS, MAX_ROWS].
function syncRowsSelect(snap) {
  const sel = $("#rowsSelect");
  if (!sel || !snap) return;
  if (sel.options.length === 0) {
    for (let n = MIN_ROWS; n <= MAX_ROWS; n++) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = `${n} rows`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      const n = parseInt(sel.value, 10);
      if (n >= MIN_ROWS && n <= MAX_ROWS) send({ type: "set_rows", rows: n });
    });
  }
  sel.disabled = snap.phase !== "lobby" || !!game.challengeId;
  if (parseInt(sel.value, 10) !== snap.maxGuesses) sel.value = String(snap.maxGuesses);
}
```

In `syncLengthSelect` (~3160), change the disabled line to also lock challenge rooms:

```js
  sel.disabled = snap.phase !== "lobby" || !!game.challengeId; // pinned word in challenges
```

- [ ] **Step 3: Mount it**

In `showSettings` (app.js ~4828), change:

```js
  mountRoomLength: snap ? () => syncLengthSelect(snap) : null,
```

to:

```js
  mountRoomLength: snap ? () => { syncLengthSelect(snap); syncRowsSelect(snap); } : null,
```

- [ ] **Step 4: Verify, commit**

Run: `npm test` (green), then `npm run dev` → in a room lobby open Settings → Room: both selects present; change Rows → board tries badge updates. Stop dev server.

```bash
git add public/index.html public/app.js
git commit -m "feat(settings): Rows select in Settings>Room — the guest path for set_rows"
```

---

### Task 6: Client — truthful challenge seat strip (you vs N ghosts)

**Files:**
- Modify: `public/lobby-view.js` (new `ghostSeatModel`)
- Modify: `public/app.js` (import ~36, seat-strip block ~2814-2822, `renderMyTable` ~2673-2704)
- Modify: `public/style.css` (`.seat.ghost`, near `.seat` rules ~3390)
- Test: `test/lobby-view.test.js` (extend)

- [ ] **Step 1: Write the failing tests** (append to `test/lobby-view.test.js`; it already imports from `../public/lobby-view.js` — extend that import with `ghostSeatModel`)

```js
describe("ghostSeatModel", () => {
  it("is you + one seat per tape player, full house", () => {
    const tape = { players: [{ username: "ada", host: true }, { username: "bo" }] };
    const m = ghostSeatModel(tape);
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "ghost", "ghost"]);
    expect(m.seats[1].username).toBe("ada");
    expect(m.taken).toBe(3);
    expect(m.capacity).toBe(3);
  });
  it("tolerates a missing tape", () => {
    const m = ghostSeatModel(null);
    expect(m.seats).toEqual([{ kind: "you" }]);
    expect(m.capacity).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/lobby-view.test.js`
Expected: FAIL — `ghostSeatModel` not exported.

- [ ] **Step 3: Implement the pure model**

Append to `public/lobby-view.js`:

```js
// Challenge rooms are solo-vs-ghosts (one DO per player): the seat strip shows the
// real ghost field, not the fictional 1/8 the default capacity would suggest.
export function ghostSeatModel(tape) {
  const ghosts = Array.isArray(tape && tape.players) ? tape.players : [];
  return {
    seats: [{ kind: "you" }, ...ghosts.map((g) => ({ kind: "ghost", username: g.username || "" }))],
    taken: 1 + ghosts.length,
    capacity: 1 + ghosts.length,
  };
}
```

Run: `npx vitest run test/lobby-view.test.js` → PASS.

- [ ] **Step 4: Wire the client**

`public/app.js`:

1. Import (line 36): `import { seatModel, ghostSeatModel } from "/lobby-view.js";`
2. Seat-strip block in `render()` (~2814-2822) — hide the strip in tape-less challenges (they auto-start past the lobby anyway):

```js
  const myTable = $("#myTable");
  if (myTable) {
    const inLobby = snap.phase === "lobby";
    const show = inLobby && (!game.challengeId || !!game.ghostTape);
    myTable.hidden = !show;
    if (show) renderMyTable(snap);
    else game.lastSeatCount = 0;
  }
```

3. `renderMyTable` (~2677): pick the model per room type:

```js
  const model = game.challengeId ? ghostSeatModel(game.ghostTape) : seatModel(snap, getUsername());
```

4. In its seat loop, add a `ghost` branch before the `empty` fallback:

```js
    } else if (s.kind === "ghost") {
      el.className = "seat ghost";
      el.textContent = s.username ? s.username[0].toUpperCase() : "◆";
    } else {
```

5. The count line (~2703):

```js
  if (countEl) {
    const nGhosts = model.taken - 1;
    countEl.textContent = game.challengeId
      ? `vs ${nGhosts} ghost${nGhosts === 1 ? "" : "s"}`
      : `${model.taken}/${model.capacity}`;
  }
```

`public/style.css`, next to `.seat.taken` (~3398):

```css
.seat.ghost {
  background: color-mix(in oklab, var(--accent) 8%, transparent);
  border-style: dashed;
  opacity: 0.7;
}
```

(Confirm `.seat` uses a border; if not, drop the `border-style` line.)

- [ ] **Step 5: Verify, commit**

Run: `npm test` (green). `npm run dev` → open a ghost challenge link (`/c/<id>` of a played challenge): strip shows you + dashed ghost seats, "vs N ghosts"; dim control locked. Stop dev server.

```bash
git add public/lobby-view.js public/app.js public/style.css test/lobby-view.test.js
git commit -m "feat(challenge): truthful lobby — ghost seat strip (vs N ghosts), no fake 1/8"
```

---

### Task 7: Client — ready marks on the multiplayer seat strip

**Files:**
- Modify: `public/lobby-view.js` (`seatModel`)
- Modify: `public/app.js` (`renderMyTable` seat loop)
- Modify: `public/style.css`
- Test: `test/lobby-view.test.js` (extend)

- [ ] **Step 1: Write the failing test** (append)

```js
describe("seatModel ready marks", () => {
  it("carries each player's ready flag onto you/taken seats", () => {
    const snap = {
      capacity: 3,
      players: [
        { username: "me", ready: true },
        { username: "bo", ready: false },
      ],
    };
    const m = seatModel(snap, "me");
    expect(m.seats[0]).toMatchObject({ kind: "you", ready: true });
    expect(m.seats[1]).toMatchObject({ kind: "taken", username: "bo", ready: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/lobby-view.test.js`
Expected: FAIL — seats have no `ready`.

- [ ] **Step 3: Implement**

`public/lobby-view.js` — in `seatModel`, thread `ready` through (lines 14-17 become):

```js
  const mine = players.find((p) => p && p.username === me);
  const others = players.filter((p) => p && p.username !== me);
  const seats = [];
  seats.push({ kind: "you", username: me, icon: null, ready: !!(mine && mine.ready) });
  for (const p of others) seats.push({ kind: "taken", username: p.username, isBot: !!p.isBot, ready: !!p.ready });
```

`public/app.js` — in `renderMyTable`'s loop, after each of the `you` and `taken` branches set `el.className`, mark readiness (duel rooms only — ready is meaningless elsewhere):

```js
      if (snap.isDuel && s.ready) el.classList.add("rdy");
```

(Add the line in both branches, after the existing classList/textContent code.)

`public/style.css`, next to `.seat.taken`:

```css
.seat.rdy { box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 70%, transparent); }
```

- [ ] **Step 4: Run to verify pass, commit**

Run: `npx vitest run test/lobby-view.test.js && npm test`
Expected: PASS.

```bash
git add public/lobby-view.js public/app.js public/style.css test/lobby-view.test.js
git commit -m "feat(lobby): seat strip shows duel ready marks"
```

---

### Task 8: Full verification

- [ ] **Step 1: Suite + types**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Manual end-to-end** (`npm run dev`, two browser profiles)

1. **Multiplayer room** `/@you/test`: window A (creator) sees editable 5×6; window B (guest) sees it locked but can change Rows via Settings → Room; ready marks appear as duelists ready up; close window A → B gets "… is now the host" in chat and the 5×6 unlocks for B; A rejoins → still guest.
2. **Challenge lobby** (ghost challenge `/c/<id>`): compact stack (no gap), locked 5×6, "vs N ghosts" strip, Start works.
3. **Daily + normal game**: unaffected; bloom animates on start.

- [ ] **Step 3: Done — hand back**

Do NOT ship. Report results; Yan triggers deploy via `dev/ship.sh` / `/push`.

---

## Self-review notes (already applied)

- Spec §A "seat strip truthful" → Task 6; §A "locked 5×6" → Tasks 2 (server) + 4 (client); §A/§B "compact" → Task 3; §B "hostId + succession" → Task 1; §B "guest path" → Task 5; §B "ready marks" → Task 7. No spec item unowned.
- `hostId` is optional in the type (`?`) so existing fixtures/tests that hand-build snapshots keep compiling; ctor + restore guarantee it's concretely `string | null` at runtime.
- The chat-line assertion in Task 1 flags that `pushSystem`'s entry shape must be checked — not a placeholder, an explicit instruction.
