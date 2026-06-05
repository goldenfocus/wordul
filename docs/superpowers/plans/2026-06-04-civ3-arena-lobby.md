# Civ-3 Arena Lobby — Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dead "empty waiting grid" a host stares at into a living, Civilization-3-style lobby — your own game (a live board you can re-theme and tune while you wait), the other open games filling up around you in real time (so you can bail on your stuck 1/6 to grab a hot 4/5), and an opponent that materializes on its own if nobody shows.

**Architecture:** The lobby is **the room's `lobby` phase, re-skinned** — not a new surface. While `phase === "lobby"` in `/@owner/slug`, the client renders the Atrium layout (hero board + satellite tunes) PLUS a live "other open games" rail polled from the existing `/api/arena/open`. Settings edits reuse the existing shared-control WS messages (`set_edition`, `set_length`, `rename`). A new room-DO **bot-join alarm** seeds a fallible bot opponent after a random 3–69 s when a public host is still alone; the host still presses **Start**. Global lobby chat is explicitly **deferred** to a later phase.

**Tech Stack:** Cloudflare Workers + Durable Objects (`Room`, `Arena`), vanilla ES-module client (`public/app.js` + helpers), vitest. No framework, no build step for client JS.

**Visual spine:** `host-lobby-atrium` (published prototype: https://wordul.com/designs/host-lobby-atrium) — board is the hero, re-themes live, rooms orbit it, cinematic opponent reveal.

---

## Decisions (locked with Yan, 2026-06-04)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Visual spine | **Atrium** (board-centric) |
| D2 | Global lobby chat | **Deferred** — not in v1; its own phase/spec later |
| D3 | Bot-join behavior | Bot **joins** seat 2 after 3–69 s; **host presses Start** (bot does not auto-start). Bot may chat later; "bot can press Start" is a future toggle. |
| D4 | Bot difficulty in a human room | Plays the **noob** profile (fallible), like seeded rooms — not the sharp `/robots` solver. |
| D5 | Surface | The room's **`lobby` phase** is the lobby. `/arena` (shipped) remains the pre-host browser/entry. |

---

## What already exists (do NOT rebuild)

- **`/arena` route + abandon-close** — shipped (`fix(arena)…`, commit `203236a`). `/arena` is a real refresh-survivable route; abandoned public rooms auto-delist after a 45 s grace.
- **Open-games index** — `Arena` DO; `GET /api/arena/open` → `OpenGame[]` (`{routePath,name,host,personaIcon,edition,wordLength,seats}`). Client poller `mountArenaList()` in `public/arena-panel.js` (8 s poll).
- **Public room publish/close** — `room.ts#publishArena()` lists a human room; `closeArena()` delists; `runStart`/`finishGame` close on start/finish.
- **Shared live controls** — WS messages `set_length`, `set_edition`, `set_mode`, `rename` already mutate a lobby room for everyone; client gear wires `set_length`. Theme picker exists (`editions/index.js`, `applyEdition`).
- **Bot machinery** — `PERSONAS` + `pickPersonas()` (`src/bots.ts`); `ensureBots()` adds bot `PlayerState`s; per-bot heartbeat (`armBotHeartbeat`, `alarm()` noob/sharp branch driven by `state.seed`); `noobGuess()` (`src/noob.ts`).
- **The room alarm** is a single multiplexed storage alarm (countdown / rematch / bot-heartbeat / **abandon**) — add the bot-join timer as one more `lobby`-phase branch, exactly like the abandon branch added in `203236a`.

---

## File Structure

| File | Responsibility | Phase |
|------|----------------|-------|
| `src/room-core.ts` | Pure helpers: `botJoinDelay(roll)` (3–69 s), `shouldArmBotJoin(state)` gate. Tested. | 2 |
| `src/room.ts` | Wire bot-join alarm (arm on publish/hello, fire in `alarm()`), tag joined bot `noob`, make heartbeat read the tag, re-publish live seats on membership change. | 2,3 |
| `src/types.ts` | `PlayerState.noob?: boolean`; `RoomSnapshot.botJoinAt?: number\|null` (internal, stripped). | 2 |
| `src/arena-core.ts` | `bumpSeats()` pure helper for the seeded-room live-fill ticker. Tested. | 3 |
| `src/arena.ts` | Seed-loop alarm bumps registered rooms' `seats` toward capacity over time. | 3 |
| `public/lobby.js` (new) | The Atrium lobby view: hero board + satellite tunes + live open-games rail + defect-to-join. Pure-ish render helpers exported for test. | 1 |
| `public/app.js` | In `showRoom`, when `phase==="lobby"`, mount `lobby.js` instead of the bare waiting board; teardown on phase change. | 1 |
| `public/style.css` | Atrium lobby styles (lifted/adapted from the prototype; var-driven so all 7 themes + light Tin-Bot survive). | 1 |
| `test/room-core.test.ts` | `botJoinDelay`, `shouldArmBotJoin`. | 2 |
| `test/arena-core.test.ts` | `bumpSeats`. | 3 |
| `test/lobby.test.js` | Lobby render helpers (seat-fill formatting, FOMO threshold, defect target pick). | 1 |

---

## Phasing (each phase ships working, testable software)

- **Phase 1 — The waiting room becomes the Atrium lobby.** Client-heavy. Delivers the core "see + tune your game while watching others fill up, and defect" experience. No server changes beyond what exists. **This is the MVP.**
- **Phase 2 — Surprise bot-join.** Server: bot opponent materializes after 3–69 s; host presses Start; bot plays noob. Atrium reveal animation.
- **Phase 3 — Live seat-fill (FOMO).** Seeded rooms tick toward capacity; human rooms publish real seats; rail highlights near-full rooms.
- **Phase 4 — Global lobby chat.** Deferred; **own spec** (`docs/superpowers/plans/<later>-lobby-chat.md`). Out of scope here.

> **Scope note (per writing-plans):** Phases 2–4 are independent subsystems. Phase 1 below is fully bite-sized. Phases 2–3 are task-outlined here and should each be expanded into their own plan at execution time (or executed directly from the outlines if small). Phase 4 gets a fresh spec.

---

## PHASE 1 — The Atrium lobby (MVP)

**Outcome:** Hosting (or opening a waiting public room) shows: a hero word-board that re-themes live, satellite controls (theme presets, word length, rename) that edit the room for everyone via existing WS messages, and a live rail of OTHER open games with seat counts you can tap to defect into. Replaces the empty grid in `screenshot` the bug report.

### Task 1.1: Lobby render module skeleton + pure helpers

**Files:**
- Create: `public/lobby.js`
- Test: `test/lobby.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/lobby.test.js
import { describe, it, expect } from "vitest";
import { seatLabel, isHot, pickDefectTarget } from "../public/lobby.js";

describe("seatLabel", () => {
  it("formats taken/capacity", () => {
    expect(seatLabel({ seats: "4/5" })).toBe("4/5");
  });
  it("falls back to 1/2 when seats missing", () => {
    expect(seatLabel({})).toBe("1/2");
  });
});

describe("isHot (FOMO highlight)", () => {
  it("true when one seat from full", () => {
    expect(isHot({ seats: "4/5" })).toBe(true);
  });
  it("false with room to spare", () => {
    expect(isHot({ seats: "1/6" })).toBe(false);
  });
  it("false when full (it'll be gone, not joinable)", () => {
    expect(isHot({ seats: "5/5" })).toBe(false);
  });
});

describe("pickDefectTarget", () => {
  it("returns the first open game that isn't my current room", () => {
    const games = [
      { routePath: "/@me/mine", seats: "1/6" },
      { routePath: "/@bot/hot", seats: "4/5" },
    ];
    expect(pickDefectTarget(games, "/@me/mine")).toBe("/@bot/hot");
  });
  it("returns null when nothing else is open", () => {
    expect(pickDefectTarget([{ routePath: "/@me/mine" }], "/@me/mine")).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lobby.test.js`
Expected: FAIL — `Cannot find module '../public/lobby.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// public/lobby.js — the Atrium waiting-room lobby. Pure helpers + a mount() the
// orchestrator (app.js) drives during a room's `lobby` phase. No imports from app.js.

// "taken/capacity" string for a row; defaults to a 1v1 when a rec omits seats.
export function seatLabel(game) {
  return (game && game.seats) || "1/2";
}

// FOMO: exactly one seat left → worth defecting for. Full rooms are about to vanish,
// so they are NOT hot (you can't join them).
export function isHot(game) {
  const [t, c] = seatLabel(game).split("/").map((n) => parseInt(n, 10));
  return Number.isFinite(t) && Number.isFinite(c) && c - t === 1 && t < c;
}

// Defection target: first open game that isn't the room I'm currently sitting in.
export function pickDefectTarget(games, currentRoutePath) {
  if (!Array.isArray(games)) return null;
  const g = games.find((x) => x && x.routePath && x.routePath !== currentRoutePath);
  return g ? g.routePath : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lobby.test.js`
Expected: PASS (8 assertions)

- [ ] **Step 5: Commit**

```bash
git add public/lobby.js test/lobby.test.js
git commit -m "feat(lobby): pure helpers for seat labels, FOMO, defect target"
```

### Task 1.2: `mountLobby()` — hero board + satellite tunes + live rail

**Files:**
- Modify: `public/lobby.js` (add `mountLobby`)
- Reference: `public/arena-panel.js#mountArenaList` (poller pattern to mirror), `public/app.js#renderBoard`/`render` (board markup to reuse), `public/editions/index.js` (theme list)

- [ ] **Step 1: Write the failing test** (DOM-level, jsdom)

```js
// append to test/lobby.test.js
import { mountLobby } from "../public/lobby.js";

describe("mountLobby", () => {
  it("renders a hero board, the theme presets, and an empty rail, then stops cleanly", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const el = document.getElementById("host");
    const stop = mountLobby(el, {
      room: { wordLength: 5, edition: "default", name: "Sparkly Skunk", routePath: "/@me/mine" },
      editions: [{ id: "default", name: "Wordul" }, { id: "yang", name: "Yang's Table" }],
      fetchOpen: () => Promise.resolve([]),     // injected so the test never hits network
      onSetEdition: () => {}, onSetLength: () => {}, onRename: () => {}, onDefect: () => {},
    });
    expect(el.querySelector(".lobby-board")).toBeTruthy();
    expect(el.querySelectorAll(".lobby-theme").length).toBe(2);
    expect(typeof stop).toBe("function");
    stop(); // must not throw
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lobby.test.js`
Expected: FAIL — `mountLobby is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// add to public/lobby.js
const OPEN_POLL_MS = 8000;

// Mount the Atrium lobby into `el`. `deps` is injected (no app.js import) so this is
// testable and the orchestrator owns the WS/navigation side effects:
//   room        {wordLength, edition, name, routePath}
//   editions    [{id,name}] for the theme presets
//   fetchOpen   () => Promise<OpenGame[]>  (app passes () => fetch('/api/arena/open').then(r=>r.json()))
//   onSetEdition(id) onSetLength(n) onRename(name) onDefect(routePath)
// Returns stop() the caller MUST invoke on phase change / teardown (clears the poll).
export function mountLobby(el, deps) {
  const { room, editions = [], fetchOpen, onSetEdition, onSetLength, onRename, onDefect } = deps;
  let stopped = false, timer = null;

  const cols = room.wordLength;
  const board = `<div class="lobby-board" style="--cols:${cols}">` +
    Array.from({ length: 6 * cols }, () => `<div class="lobby-tile"></div>`).join("") + `</div>`;

  const themes = editions.map((e) =>
    `<button class="lobby-theme${e.id === room.edition ? " is-active" : ""}" data-ed="${e.id}" type="button">${e.name}</button>`
  ).join("");

  el.innerHTML =
    `<section class="lobby">
      <div class="lobby-stage">${board}
        <div class="lobby-tunes">
          <div class="lobby-themes">${themes}</div>
        </div>
      </div>
      <aside class="lobby-rail"><h3 class="lobby-rail-title">Other tables</h3>
        <div class="lobby-open"></div></aside>
    </section>`;

  el.querySelectorAll(".lobby-theme").forEach((b) =>
    b.addEventListener("click", () => onSetEdition && onSetEdition(b.dataset.ed)));

  const railEl = el.querySelector(".lobby-open");
  const draw = (games) => {
    if (stopped) return;
    const others = (games || []).filter((g) => g.routePath !== room.routePath);
    if (others.length === 0) { railEl.innerHTML = `<div class="lobby-empty muted">You're first. Others will trickle in…</div>`; return; }
    railEl.innerHTML = "";
    for (const g of others) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "lobby-open-row" + (isHot(g) ? " is-hot" : "");
      // SECURITY: host/name are user-controlled (rooms are renamable) — build with
      // textContent, never innerHTML interpolation, or it's an XSS sink. (All three
      // prototype agents hit this exact trap; don't reintroduce it.)
      const who = document.createElement("span");
      who.className = "lobby-open-host";
      who.textContent = `${g.personaIcon || "👤"} ${g.host || g.name || ""}`;
      const seats = document.createElement("span");
      seats.className = "lobby-open-seats";
      seats.textContent = seatLabel(g);
      row.append(who, seats);
      row.addEventListener("click", () => onDefect && onDefect(g.routePath));
      railEl.appendChild(row);
    }
  };

  const tick = () => { if (!stopped && fetchOpen) fetchOpen().then(draw).catch(() => {}); };
  tick();
  timer = setInterval(tick, OPEN_POLL_MS);

  return function stop() { stopped = true; if (timer) clearInterval(timer); };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lobby.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/lobby.js test/lobby.test.js
git commit -m "feat(lobby): mountLobby — hero board, theme presets, live open-games rail"
```

### Task 1.3: Atrium styles (var-driven, light-theme safe)

**Files:**
- Modify: `public/style.css` (append a `/* --- Atrium lobby --- */` block)
- Reference: the prototype's `<style>` (`/tmp/host-lobby-atrium.html` → re-fetch from R2 if gone: `https://wordul.com/designs/host-lobby-atrium`)

- [ ] **Step 1:** Lift the prototype's lobby CSS into `style.css`, renaming selectors to the `.lobby-*` classes used in Task 1.2. Drive EVERY color from existing CSS vars (`--bg --fg --accent --bgCard --border --muted --green --yellow`) so all 7 editions + the light Tin-Bot theme survive. `.lobby-board { grid-template-columns: repeat(var(--cols), 1fr); }`. Glow/grain/shadow layers from the prototype kept but var-based.

- [ ] **Step 2: Visual check** — `npm run dev`, open a room, eyeball at 5 themes incl. Tin-Bot (light). Confirm no hardcoded dark-only colors. (Run `check-input-zoom` if any input ≥16px rule touched — the rename field must be ≥16px.)

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style(lobby): Atrium lobby skin, var-driven across all 7 themes"
```

### Task 1.4: Wire the lobby into `showRoom` (phase-gated mount)

**Files:**
- Modify: `public/app.js` — import `mountLobby`; in the room render path, when `game.phase === "lobby"`, mount the lobby; tear it down (`stop()`) when leaving lobby (start/finish/leave). Pass real deps: `fetchOpen: () => fetch('/api/arena/open').then(r=>r.ok?r.json():[])`, `onSetEdition: (id)=>send({type:'set_edition',edition:id})`, `onSetLength: (n)=>send({type:'set_length',wordLength:n})`, `onRename: (name)=>send({type:'rename',name})`, `onDefect: (routePath)=>{ pendingArenaOrigin=true; navigate(routePath); }`.
- Reference: existing `render()` lobby branch (find where `phase==="lobby"` is handled today), `stopArenaPoll` pattern for a stored teardown handle.

- [ ] **Step 1:** Add a module-level `let lobbyStop = null;` and a `teardownLobby()` mirroring `stopArenaPoll()`.
- [ ] **Step 2:** In the snapshot/render handler, when `phase==="lobby"` and this is a race/public room (not daily), call `teardownLobby(); lobbyStop = mountLobby(boardMountEl, deps)` instead of drawing the empty grid. On any non-lobby phase or room-leave, `teardownLobby()`.
- [ ] **Step 3:** Manual verify with `npm run dev` + two browser tabs: host a public game in tab A → Atrium lobby shows; from tab B host another public game → it appears in tab A's rail within 8 s; clicking it in tab A navigates A into B's room (defect). Tune theme in A → board re-themes live.
- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(lobby): mount Atrium lobby during a room's lobby phase + defect-to-join"
```

### Task 1.5: Module-graph + gauntlet green

- [ ] `npm run check-graph` (new `lobby.js` import must resolve), `npm run typecheck`, `npm test` — all green.
- [ ] Commit any fixes. Phase 1 done.

---

## PHASE 2 — Surprise bot-join (outline; expand to own plan at execution)

**Outcome:** A public host alone in the lobby gets an opponent without waiting forever: after a random **3–69 s**, a fallible (noob) bot persona takes seat 2. The room stays in `lobby`; the **host presses Start** (D3). Atrium plays the prototype's reveal.

**Server tasks (`src/room-core.ts`, `src/room.ts`, `src/types.ts`):**
1. **Pure (TDD in `test/room-core.test.ts`):**
   - `botJoinDelay(roll: number): number` → `BOT_JOIN_MIN_MS(3_000) + roll*(BOT_JOIN_MAX_MS(69_000)-3_000)`, roll clamped `[0,1)`. Tests: roll 0 → 3000, roll→1 → ~69000, mid → in-band.
   - `shouldArmBotJoin(state): boolean` → `publicArena && phase==="lobby" && players are all human && no bot present && < capacity`. Tests cover each false branch.
2. **`PlayerState.noob?: boolean`** (types.ts) — marks a bot to play the fallible profile in a non-seeded room.
3. **`RoomSnapshot.botJoinAt?: number|null`** (internal; strip in `snapshotFor` next to `abandonAt`).
4. **Arm:** in `onHello` (public lobby, just published) and after publish — if `shouldArmBotJoin`, set `state.botJoinAt = Date.now()+botJoinDelay(Math.random())` and `setAlarm`. (Coexists with abandon alarm — both are lobby-phase; the `alarm()` lobby branch handles whichever is due, re-arming the other.)
5. **Fire:** in `alarm()` lobby branch (next to abandon-close) — if `botJoinAt` due and still bot-less + human present: `pickPersonas(seedCount?, 1, openIds)` → push ONE bot `PlayerState` with `isBot:true, noob:true, role: isDuelRoom()?nextSeatRole():"duelist"`; clear `botJoinAt`; `pushSystem(\`${name} joined\`)`; re-publish seats (Phase 3); `persistAndBroadcast`. **Do NOT runStart** (D3).
6. **Heartbeat reads the tag:** change the `alarm()` playing branch `const seeded = !!this.state.seed` usage so per-bot noob-vs-sharp is `b.noob || !!this.state.seed` (a noob bot in a human room plays noob). Verify `mistakeRateFor` path unaffected for seeded rooms.
7. **Cancel:** a real human joining (`onHello`, second human) clears `botJoinAt` + `deleteAlarm` (don't spawn a bot once a person shows) — D3 "fallback opponent" spirit, and avoids a 3-seat surprise.

**Client tasks (`public/lobby.js`, `style.css`):**
8. On snapshot delta where a bot appears in `lobby`, play the Atrium reveal (opponent board/avatar materialize). Light the **Start** button (host only).
9. Bot in the rail/seat strip shows its persona icon + name.

**Risk:** the room alarm now multiplexes abandon + bot-join + (on start) heartbeat. Keep each `alarm()` branch phase-guarded and always re-arm the soonest pending deadline (mirror the existing `nextBotAlarmAt` re-arm discipline).

---

## PHASE 3 — Live seat-fill / FOMO (outline; expand to own plan)

**Outcome:** Rooms visibly fill: a room you're ignoring climbs 1/6 → 2/6 → 4/5, tempting a defect; near-full rooms glow (`isHot`, already built Task 1.1).

**Tasks:**
1. **Pure (`src/arena-core.ts`, TDD):** `bumpSeats(seatStr, roll): string` — occasionally increments `taken` toward `capacity` (never past, never on a full room). Weighted so fills feel organic, not instant.
2. **Seed loop (`src/arena.ts#alarm`):** each tick, with low probability, `bumpSeats` one registered room's `seats`; persist. (Seeded rooms are illusory fills — this is the "atmosphere" the Civ-3 vibe needs.) Respect existing prune/mint cadence.
3. **Human rooms publish real seats (`src/room.ts`):** `publishArena()` already re-asserts on `hello`; extend `closeArena`-adjacent membership changes (bot-join in Phase 2, human join/leave) to re-`publish` with the live `taken/capacity` from `state.players`. Add `capacity` to a public room (default 2; or the host's chosen seats) so the label isn't a static `1/2`.
4. **Client:** rail already renders `seatLabel` + `isHot` (Task 1.1/1.2). Add a tiny count-up transition when a row's number changes; sort hot rooms first.

---

## PHASE 4 — Global lobby chat (DEFERRED — own spec)

Out of scope here (D2). When taken up: a shared chat channel on the **`Arena` DO** (not per-room), broadcast to everyone viewing the lobby. New WS or poll surface, moderation/rate-limit, i18n. Write `docs/superpowers/plans/<date>-lobby-chat.md` from scratch.

---

## Self-Review

- **Spec coverage:** D1 Atrium → Task 1.2/1.3 + Phase 2.8. D2 chat deferred → Phase 4. D3 bot-join + host-start → Phase 2.5 (no runStart) + 2.8 (Start lights). D4 noob → Phase 2.6. D5 lobby-phase surface → Task 1.4. "Filling up / defect" → Task 1.1 `pickDefectTarget` + 1.4 onDefect + Phase 3. "Edit while waiting" → Task 1.2/1.4 (set_edition/length/rename). ✔
- **Placeholders:** Phase 1 fully bite-sized with real code. Phases 2–3 are explicit task outlines (per scope note) — expand to own plans before executing. No "TBD".
- **Type consistency:** `seatLabel/isHot/pickDefectTarget/mountLobby` names match across tasks and tests. `botJoinDelay/shouldArmBotJoin/PlayerState.noob/botJoinAt/bumpSeats` consistent Phase 2–3. ✔
- **Gauntlet:** every phase ends on `check-graph + typecheck + test` green; client inputs (rename) honor the 16px iOS rule.
