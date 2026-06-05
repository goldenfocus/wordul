# Lobby Redesign (Neon Floor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implement in this worktree (`.claude/worktrees/lobby-redesign`); ship via `/push`.

**Goal:** Rebuild the multiplayer room **lobby** (pre-start waiting room) into the calm, two-zone "Neon Floor" design Yan approved: header-hoisted controls, a single-row board with a tap/drag **tries badge that doubles as the word-length control**, a "Your table" seat strip, a compact scrollable floor of other tables, and a Global/Table tabbed chat (Table wired now, Global "coming soon").

**Architecture:** Almost entirely client-side. The lobby is a *phase* (`snap.phase === "lobby"`) of the existing room screen, not a new route. We gate the existing `renderBoards`/control-visibility logic on that phase, restructure `#tpl-room`'s lobby region, port the approved prototype's CSS as **var-driven** rules (survives all 7 themes incl. light Tin-Bot), and reuse the existing `set_length` / `chat` WS messages — no new server protocol in P1. One small **additive** server field (`capacity`) is needed for the "Your table" seat count (Task 6); a pure-client fallback is documented if we want zero server touch.

**Tech Stack:** Vanilla JS (`public/app.js`, 4298 lines — no framework), HTML `<template>` (`public/index.html`), CSS custom properties (`public/style.css`), Cloudflare Workers + Durable Objects (`src/room.ts`). Tests: vitest (`environment: "node"`; opt into jsdom per-file with `// @vitest-environment jsdom`).

**Visual source of truth:** the approved prototype — https://wordul.com/designs/lobby-neon-floor-v2 (also `/tmp/lobby-neon-floor-v2.html` this session). CSS/markup tasks **port from it**; don't reinvent the look.

---

## Decisions locked (from the design ritual)

- **D-A Chat:** Global + Table **tabs**; Table wired to the existing per-room `chat` WS message now. Global tab ships as a "coming soon" placeholder; the global Arena-DO channel is a **fast follow-up (P2)**, not in this plan.
- **D-B Tries badge:** the `×6` badge **is** the length control — tap reveals `−`/`+`, press-drag ↕ adjusts; board width + `×N` (=`min(len+1,8)`) update live. No separate letter picker.
- **D-C Settings affordance:** icon-only **native share + gear** in the header; edition/mode live behind the gear (existing Settings modal). No gear-in-a-pill.
- **D-D Single-row collapse:** lobby-only. Opponents have no board pre-start, so nothing else is affected.

## Existing code map (verified — reference while implementing)

| Concern | Function / location | Notes |
|---|---|---|
| Render entry | `render()` `app.js:2257` | runs per snapshot; phase = `snap.phase` |
| Lobby control visibility | `app.js:2306-2334` | shows/hides `#lobbyControls`, `#startBtn`, `#modeControl`, `lobbySetup` |
| Board renderer | `renderBoards(snap, me)` `app.js:2657-2780`; row loop `2728-2775` | `rows = snap.maxGuesses`, `cols = snap.wordLength`; CSS vars `--cols`/`--rows` |
| Length control | `syncLengthSelect` `app.js:2553-2573` → `send({type:"set_length",wordLength})` | currently a `<select>` mounted only inside Settings modal |
| Mode picker | `syncModePicker` `app.js:2488-2538` → `set_mode` | |
| Gear | `syncLobbySetup` `app.js:2577-2585` → `showSettings()` → `openSettings` (settings.js) | |
| Lobby rail | `mountLobbyRailIfNeeded` `app.js:1292-1305`, `teardownLobbyRail` `1287-1291`, called `2340-2341` | uses `mountArenaList` from `arena-panel.js` |
| Arena row render | `arena-panel.js:76-89` | builds avatar · host · `${wordLength} letters` · seats; `host` is validated `[a-z0-9_-]` (safe) |
| Chat | `wireChat` `1393-1444`; `renderChat` `2414-2446`; `renderChatRow` `2448-2462`; badge `updateChatBadge` `2471-2486` | msg shape `{kind:"user"|"system", from, text}`; send `{type:"chat",text}` |
| Header | `renderRoomHeader` `1132-1141`; `renderHeaderIdentity` `1158-1172`; `renderGoldHud` (gold.js) | `#roomHeader`/`#avatarBtn` are in the persistent topbar, NOT in `#tpl-room` |
| Avatar hub items | `openHub` `settings.js:181-245` | already has ↗ Share/invite, ✎ Rename, 🏆 Scoreboard |
| Seats/players | `snap.players[]` `{username,connected,status,isBot,...}`; capacity in `state` server-side | snapshot does **not** currently expose `capacity` to client (Task 6) |
| Tries math (server) | `guessesFor(length)=Math.min(length+1,8)` `src/room.ts:85` | mirror as client `triesFor` |
| iOS guard | `test/ios-input-zoom.test.ts` (debt list EMPTY); chat input already 16px (`style.css:1125`) | viewport clean repo-wide — **no restore needed**, just keep green |

---

## File structure

- **Create** `public/lobby-view.js` — pure, unit-testable lobby helpers: `triesFor`, `seatModel`, `compactRowProps`. Keeps logic out of the 4298-line `app.js` and testable in isolation.
- **Create** `test/lobby-view.test.js` — unit tests for the above (jsdom not required; pure functions).
- **Modify** `public/index.html` (`#tpl-room`, lines 148-241) — restructure the lobby region: remove the title card + tabs from the lobby state, add the two-zone container, tries-badge markup, "Your table" strip, chat tabs.
- **Modify** `public/app.js` — gate `renderBoards` to one row in lobby; wire the tries-badge length control; render "Your table"; hoist title/share/gear visibility into header for lobby; chat tabs; hide `#roomTabs` in lobby.
- **Modify** `public/arena-panel.js` — compact row renderer (add `×T` tries via `triesFor`, scroll container, table count).
- **Modify** `public/style.css` — port the prototype's lobby CSS as var-driven rules (two-zone grid, tries badge, your-table seats, compact floor rows, chat tabs).
- **Modify** `src/room.ts` (`snapshotFor` ~1767) + `src/types.ts` (`RoomSnapshot`) — **additive** `capacity` field for "Your table" (Task 6; fallback documented).
- **Modify** `test/arena-panel.test.js` — extend for the compact `×T` row props.

Each task ends green (`npm test` + `npm run typecheck`) and is committed.

---

### Task 1: Pure lobby helpers (`triesFor`, `seatModel`, `compactRowProps`)

**Files:**
- Create: `public/lobby-view.js`
- Test: `test/lobby-view.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/lobby-view.test.js
import { describe, it, expect } from "vitest";
import { triesFor, seatModel, compactRowProps } from "../public/lobby-view.js";

describe("triesFor (mirrors server guessesFor)", () => {
  it("is length+1, plateauing at 8", () => {
    expect(triesFor(4)).toBe(5);
    expect(triesFor(5)).toBe(6);
    expect(triesFor(7)).toBe(8);
    expect(triesFor(8)).toBe(8);   // plateau
    expect(triesFor(11)).toBe(8);  // plateau holds
  });
});

describe("seatModel (Your table)", () => {
  it("marks seat 0 as you, fills joined players, pads empties to capacity", () => {
    const m = seatModel({ players: [{ username: "papa" }, { username: "kai", isBot: false }], capacity: 3 }, "papa");
    expect(m.taken).toBe(2);
    expect(m.capacity).toBe(3);
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken", "empty"]);
  });
  it("falls back to players.length capacity when capacity missing, min 2", () => {
    const m = seatModel({ players: [{ username: "papa" }] }, "papa");
    expect(m.capacity).toBeGreaterThanOrEqual(2);
    expect(m.taken).toBe(1);
  });
});

describe("compactRowProps (floor row)", () => {
  it("derives ×T tries from wordLength", () => {
    const p = compactRowProps({ routePath: "/@a/x", personaIcon: "🦊", host: "maya", wordLength: 8, seats: "4/5", edition: "jackpot" });
    expect(p.tries).toBe(8);
    expect(p.host).toBe("maya");
    expect(p.seats).toBe("4/5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lobby-view.test.js`
Expected: FAIL — `Failed to resolve import "../public/lobby-view.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// public/lobby-view.js — pure lobby helpers (no DOM, no imports). Unit-tested in
// test/lobby-view.test.js. triesFor MUST stay in lockstep with server guessesFor
// (src/room.ts:85): Math.min(length + 1, 8).
export function triesFor(length) {
  return Math.min(length + 1, 8);
}

// Build the "Your table" seat model from a snapshot. Seat 0 is always "you";
// remaining joined players are "taken"; pad with "empty" up to capacity.
// capacity falls back to max(2, players.length) when the server didn't send one.
export function seatModel(snap, me) {
  const players = Array.isArray(snap && snap.players) ? snap.players : [];
  const capacity = Math.max(2, Number(snap && snap.capacity) || players.length || 2);
  const others = players.filter((p) => p && p.username !== me);
  const seats = [];
  seats.push({ kind: "you", username: me, icon: null });
  for (const p of others) seats.push({ kind: "taken", username: p.username, isBot: !!p.isBot });
  while (seats.length < capacity) seats.push({ kind: "empty" });
  return { seats: seats.slice(0, Math.max(capacity, seats.length)), taken: players.length, capacity };
}

// Map a server OpenGame to a compact floor-row's props, adding ×T tries.
export function compactRowProps(game) {
  return {
    routePath: game.routePath,
    avatar: game.personaIcon,
    host: game.host,
    wordLength: game.wordLength,
    tries: triesFor(game.wordLength),
    seats: game.seats || "1/2",
    edition: game.edition,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lobby-view.test.js`
Expected: PASS (all 3 describes green).

- [ ] **Step 5: Commit**

```bash
git add public/lobby-view.js test/lobby-view.test.js
git commit -m "feat(lobby): pure helpers — triesFor, seatModel, compactRowProps"
```

---

### Task 2: Compact floor rows in `arena-panel.js` (×T tries + count)

The lobby rail already polls `/api/arena/open`. Make each row compact per the prototype (avatar · host · `N letters · ×T` · seats), keep the hot glow, and expose a count.

**Files:**
- Modify: `public/arena-panel.js:76-91` (the `draw` row loop)
- Modify: `test/arena-panel.test.js`

- [ ] **Step 1: Write the failing test** (extend the existing file)

```js
// append to test/arena-panel.test.js
import { compactRowProps } from "../public/lobby-view.js";
describe("compact floor row", () => {
  it("row props carry ×T tries derived from wordLength", () => {
    const p = compactRowProps({ routePath: "/@m/x", personaIcon: "🦊", host: "maya", wordLength: 6, seats: "2/4", edition: "default" });
    expect(p.tries).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/arena-panel.test.js`
Expected: FAIL if `lobby-view.js` import path is wrong; otherwise confirm the assert is green only after Step 3 wiring. (Task 1 must be done first.)

- [ ] **Step 3: Implement compact row** — replace the row `innerHTML` block in `arena-panel.js` `draw()` (lines 82-86) so it renders the `×T` micro-indicator. Import `triesFor` at top of `arena-panel.js` (`import { triesFor } from "/lobby-view.js";`). New row body (keep `host` via the existing validated-username path; still safe to interpolate):

```js
const tries = triesFor(p.wordLength);
row.innerHTML =
  `<span class="arena-row-avatar" aria-hidden="true">${p.avatar}</span>` +
  `<span class="arena-row-body"><span class="arena-row-host">${p.host}</span>` +
  `<span class="arena-row-meta muted">${p.wordLength} letters · <span class="arena-row-tries">×${tries}</span></span></span>` +
  `<span class="arena-row-seats">${p.seats}</span>`;
```

Add a count line above the list in `draw()` when `state === "list"`: prepend `mountEl` with `<div class="arena-count muted">${visible.length} open</div>` before appending `list`, and ensure the list container has the scroll class (CSS in Task 5 caps its height).

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/arena-panel.test.js test/lobby-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/arena-panel.js test/arena-panel.test.js
git commit -m "feat(lobby): compact floor rows with ×T tries + open count"
```

---

### Task 3: Restructure `#tpl-room` lobby markup (two-zone + badge + your-table + chat tabs)

Add the new lobby DOM. **Keep all existing IDs** the rest of `app.js` depends on (`#boards`, `#startBtn`, `#lobbySetup`, `#lobbyRail`/`#lobbyRailList`, `#chatLog`/`#chatForm`/`#chatInput`, `#roomTabs`); we *re-home* them, not delete them. New nodes are hidden by default and revealed only in lobby phase by `app.js` (Task 4+).

**Files:**
- Modify: `public/index.html:148-241`

- [ ] **Step 1: Add the two-zone lobby container** inside `#tabPlay`, wrapping `#boards` and `#lobbyRail`. Add, before `#boards`, the tries-badge + "Your table" markup, and convert `#lobbyRail` into the right column. Port structure from the prototype's `.zones` / `.game` / `.rz` / `.tries` / `.mytable` / `.chat .tabs`. Concretely add:

```html
<!-- lobby-only two-zone wrapper; .lobby-active toggled by app.js in lobby phase -->
<div id="lobbyGrid" class="lobby-grid" hidden>
  <div class="lobby-left">
    <div class="tries-badge" id="triesBadge" hidden>
      <button class="tb-pm tb-minus" id="tbMinus" tabindex="-1" aria-label="Fewer letters">−</button>
      <span class="tb-x" id="tbX">×6</span><small>tries</small>
      <span class="tb-lethint" id="tbLetters">5 letters</span>
      <button class="tb-pm tb-plus" id="tbPlus" tabindex="-1" aria-label="More letters">+</button>
    </div>
    <div class="mytable" id="myTable" hidden>
      <span class="mytable-lab">Your table</span>
      <div class="mytable-seats" id="myTableSeats"></div>
      <span class="mytable-cnt" id="myTableCount">1/2</span>
    </div>
  </div>
</div>
```

(`#boards` stays where it is — CSS in Task 5 places it into `.lobby-left` visually via the grid; or move `#boards` inside `.lobby-left` if cleaner. Decide during build; keep the ID.)

- [ ] **Step 2: Add chat tabs** to `#chatPanel` — insert a tablist above `#chatLog`:

```html
<div class="chat-tabs" id="chatTabs" hidden role="tablist">
  <button class="chat-tab is-active" id="chatTabGlobal" data-chan="global" role="tab" type="button">Global</button>
  <button class="chat-tab" id="chatTabTable" data-chan="table" role="tab" type="button">Table<span class="chat-tab-ping" id="chatTabPing" hidden></span></button>
</div>
```

- [ ] **Step 3: Verify the build serves the template** — `npm run dev`, open a room, confirm no console errors and existing game still renders (new nodes are `hidden`, so behavior is unchanged at this step).

Run: `npm run typecheck && npm test`
Expected: PASS (markup-only; no JS wired yet).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(lobby): two-zone lobby markup, tries badge, your-table, chat tabs (hidden)"
```

---

### Task 4: Single-row board + bloom-on-start (gate `renderBoards` on lobby phase)

**Files:**
- Modify: `public/app.js` `renderBoards` (2657-2780), row loop (2728-2775)

- [ ] **Step 1: Gate row count in lobby.** In `renderBoards`, when `snap.phase === "lobby"`, render the owner's board as a **single** row of `cols` width (instead of `rows = snap.maxGuesses`), and reveal `#triesBadge`. For non-owner players in lobby, skip the board (D-D: opponents have no board pre-start) — they appear only in "Your table". Concretely, before the `for (let r = 0; r < rows; r++)` loop:

```js
const isLobby = snap.phase === "lobby";
const rowsToDraw = isLobby ? 1 : rows;
```
then loop `for (let r = 0; r < rowsToDraw; r++)`. Keep the existing typing/cursor logic for row 0 so you can still type into the single row.

- [ ] **Step 2: Bloom on start.** Where the phase transitions lobby→countdown/playing (the `render()` phase branch ~2306-2334, or a one-time transition guard), when leaving lobby, the board re-renders with full `rows` (the existing code already draws full rows for non-lobby). Add a CSS class `boards.classList.toggle("blooming", justLeftLobby)` for the staggered reveal (CSS in Task 5). Track `game.wasLobby` to fire the bloom exactly once.

- [ ] **Step 3: Manual verify** — `npm run dev`, create a room: lobby shows ONE row + `×6` badge; the floor/your-table visible; press Start (or have a 2nd player) → board expands to full rows with the bloom. Compare against the prototype's Start animation.

- [ ] **Step 4: Run gauntlet**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(lobby): single-row board in lobby, bloom to full board on start"
```

---

### Task 5: Tries badge = word-length control (tap/drag → set_length)

Wire `#triesBadge` to drive word length, replacing the Settings `<select>` as the primary length control (the select can remain in Settings as a fallback). Sends the existing `set_length` WS message — no server change.

**Files:**
- Modify: `public/app.js` (new `wireTriesBadge()`, called from `showRoom`/render lobby branch)
- Modify: `public/style.css` (badge styles — Step 3)

- [ ] **Step 1: Implement `wireTriesBadge(snap)`** — port the prototype's pointer logic. Clamp length to the server-supported range (read the same options `syncLengthSelect` uses, e.g. 4–11). On change: optimistic local re-render of the single row + `×N` (via `triesFor`) + `N letters` hint, and `send({ type: "set_length", wordLength: v })`. Tap (<6px move) toggles `.editing` (reveals `−`/`+`); drag ↕ adjusts (`Math.round(dy/24)` steps); `−`/`+` buttons step by 1. Disable when `snap.phase !== "lobby"` or when the viewer isn't the host (only host can set length — confirm host gating matches `syncLengthSelect`'s `disabled` rule). Update `#tbX`/`#tbLetters` from the snapshot in `render()` so remote changes reflect.

- [ ] **Step 2: Reveal the badge in lobby only.** In `render()`'s lobby branch, `triesBadge.hidden = false` (lobby) / `true` (otherwise), mirroring `#lobbyControls`.

- [ ] **Step 3: Port badge CSS** from the prototype (`.tries-badge`, `.tb-x`, `.tb-pm`, `.tb-lethint`, `.editing`, `.bump`) into `style.css` as **var-driven** rules (`--hot`/`--accent`/`--muted`/`--border`/`--card`/`--fg` — never hardcoded hex). `touch-action: none` on the badge so drag doesn't scroll the page on mobile.

- [ ] **Step 4: Manual verify** across themes — tap badge, drag ↕ on mobile (or devtools touch), confirm `×N` plateaus at 8 past 7 letters, board widens, and a 2nd browser tab in the same room sees the length change (set_length round-trips). Switch to **Tin-Bot (light)** theme — badge still legible.

- [ ] **Step 5: Run gauntlet & commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add public/app.js public/style.css
git commit -m "feat(lobby): tries badge doubles as word-length control (tap/drag → set_length)"
```

---

### Task 6: "Your table" seat strip (+ minimal server `capacity`)

**Files:**
- Modify: `public/app.js` (new `renderMyTable(snap, me)`, call from render lobby branch)
- Modify: `src/types.ts` (`RoomSnapshot` add `capacity: number`)
- Modify: `src/room.ts` `snapshotFor` (~1767) add `capacity: this.state.capacity ?? <derived>`
- Test: extend `test/lobby-view.test.js` (already covers `seatModel`) and add a server snapshot test if one exists for `snapshotFor`.

> **⚠ Server touch (the only one).** `seatModel` needs room capacity. The client snapshot doesn't currently expose it. Two options — **pick at review:**
> - **(a) Additive field (recommended):** add `capacity` to `RoomSnapshot` + `snapshotFor`. Tiny, read-only, no migration, no money path → Tier C. Confirm what `this.state.capacity` is for a normal (non-seeded) room; if undefined, derive `Math.max(2, players.length)` server-side or default to a sensible cap.
> - **(b) Pure-client fallback (zero server touch):** render seated avatars + a single "＋ invite" slot, no fixed `N/cap`. Ship P1 with no server change; add real capacity later.

- [ ] **Step 1 (option a): Add the field** — `src/types.ts`: add `capacity: number;` to `RoomSnapshot`. `src/room.ts` `snapshotFor`: add `capacity: this.state.capacity ?? Math.max(2, this.state.players.length)` to the returned object. Run `npm run typecheck`.

- [ ] **Step 2: Implement `renderMyTable(snap, me)`** in `app.js` using `seatModel(snap, me)` from `lobby-view.js`. Render `#myTableSeats`: seat 0 = your avatar (`.seat.you`), joined = `.seat.taken` with their avatar/initial, empties = `.seat.empty` `＋`. Set `#myTableCount` to `taken/capacity`. Add a `seatin` pop animation class on newly-added seats. Reveal `#myTable` in lobby only.

- [ ] **Step 3: Port "Your table" CSS** (`.mytable`, `.mytable-seats`, `.seat`, `.seat.you/.taken/.empty`, `seatin` keyframe) var-driven.

- [ ] **Step 4: Manual verify** — open a room in two tabs as two users; the 2nd user appears as a `.seat.taken` in the host's "Your table", count goes `1/cap → 2/cap` with the pop. Place the strip between the setup and the floor (matches "in between those").

- [ ] **Step 5: Run gauntlet & commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add public/app.js public/lobby-view.js src/types.ts src/room.ts public/style.css
git commit -m "feat(lobby): Your table seat strip (+ additive snapshot capacity)"
```

---

### Task 7: Header hoist + icon-only share/gear + avatar gold number; remove lobby tabs/title card

**Files:**
- Modify: `public/app.js` (`renderRoomHeader`/`renderHeaderIdentity`/`renderGoldHud` region 1132-1172; lobby control visibility 2306-2334; `#roomTabs` gating)
- Modify: `public/index.html` (`#tpl-room` lobby-bar; topbar header buttons)
- Modify: `public/style.css`

- [ ] **Step 1: Hoist title + share + gear into the header.** The topbar (`#roomHeader`/`#avatarBtn`) is persistent. Ensure in a room the header shows: room name (already via `renderHeaderIdentity`), an **icon-only invite** button (native share glyph) and an **icon-only gear** (reuse `#lobbySetup`'s `showSettings()` handler, restyled icon-only — or surface a header gear that calls the same). Port the prototype's SVGs. The avatar shows the **gold number under it** (port `renderGoldHud` to render the bare gold number, no ◆, beneath `#avatarBtn` — confirm gold.js output and restyle via CSS, no logic change to the wallet).

- [ ] **Step 2: Remove the lobby title card + Play/Games/Players tabs *in lobby phase*.** In `render()`'s lobby branch, set `roomTabs.hidden = true` when `snap.phase === "lobby"` (they re-appear post-start for Games/Players). The `.lobby-bar` title row collapses — keep `#roomName` reachable (it's hoisted to header) but hide the standalone card in lobby via a `body.lobby` / `#lobbyGrid` CSS state.

- [ ] **Step 3: Two-zone layout CSS.** Port `.lobby-grid` (`grid-template-columns:1.06fr .94fr`, one column < 880px), `.lobby-left`, `.lobby-right`/floor card, chat card — all var-driven. Verify nothing sits between board and keyboard on mobile (existing constraint, app.js comment at 177).

- [ ] **Step 4: Manual verify** — lobby reads as: header(title·share·gear · avatar+gold) → left(single-row board · badge · ready · your-table) → right(floor · chat). No title card, no Play/Games/Players in lobby. Post-start, tabs return.

- [ ] **Step 5: Run gauntlet & commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add public/app.js public/index.html public/style.css
git commit -m "feat(lobby): hoist title/share/gear to header, avatar gold number, drop lobby tabs+card"
```

---

### Task 8: Chat tabs (Global placeholder + Table wired + auto-pop)

**Files:**
- Modify: `public/app.js` (`wireChat` 1393-1444, `renderChat` 2414-2446)
- Modify: `public/style.css`

- [ ] **Step 1: Wire tab switching.** Add `game.chatChannel = "global" | "table"` (default `"global"`). `#chatTabGlobal`/`#chatTabTable` toggle it and re-render. Reveal `#chatTabs` in lobby (and wherever chat shows). The send form routes by channel: `table` → existing `send({type:"chat",text})`; `global` → disabled in P1 (placeholder).

- [ ] **Step 2: Global = "coming soon."** When channel is `global`, `#chatLog` shows a single muted placeholder ("Global lobby chat is coming soon — chatting with your table for now.") and the input is disabled or routes nowhere. Per the locked D-A decision, no Arena-DO work here.

- [ ] **Step 3: Auto-pop Table on new message.** In `renderChat`, when a new **table** message arrives (existing append path detects `chat.length > game.lastChatLen`) and `game.chatChannel !== "table"`, switch to the Table tab and show it; if the user is elsewhere, show the `#chatTabPing` warm dot (reuse existing `updateChatBadge` unread logic — the ping is the tab-level mirror of the badge).

- [ ] **Step 4: Port chat-tab CSS** (`.chat-tabs`, `.chat-tab`, `.is-active`, `.chat-tab-ping`) var-driven. **Confirm `#chatInput` stays ≥16px** (it is, `style.css:1125`) — no new sub-16px input.

- [ ] **Step 5: Manual verify** — default tab Global (placeholder). Send from a 2nd tab → host's chat auto-pops to Table showing the message; navigating to Global then back clears the ping.

- [ ] **Step 6: Run gauntlet & commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add public/app.js public/style.css
git commit -m "feat(lobby): chat Global/Table tabs — Table wired, Global placeholder, auto-pop"
```

---

### Task 9: Guardrails, full theme sweep, ship

**Files:** none new — verification + ship.

- [ ] **Step 1: iOS zoom guard.** `npx vitest run test/ios-input-zoom.test.ts` — Expected: PASS, debt list still empty (no new sub-16px field). Viewport untouched (already clean).

- [ ] **Step 2: 7-theme sweep.** Manually switch each edition (Wordul/Yang/Jackpot/Arcade/Editorial/Tactile/Tin-Bot) in a lobby; confirm the badge, your-table seats, floor rows, chat tabs are legible and var-driven (esp. **light Tin-Bot**). Fix any hardcoded hex that leaked from the prototype.

- [ ] **Step 3: XSS check.** Floor rows interpolate `host` (validated `[a-z0-9_-]` — safe). Confirm no room `name` or chat text is injected via `innerHTML` unescaped in the new code (chat uses the existing `renderChatRow` textContent path — keep it).

- [ ] **Step 4: Full gauntlet.**

Run: `npm run typecheck && npm test && npm run check-graph`
Expected: all PASS.

- [ ] **Step 5: Ship.**

```bash
bash dev/ship.sh   # or the /push skill: tests → rebase origin/main → merge → CI deploys
```
Then post the Post-Deploy Summary and run `/smoke-test`.

---

## Self-review (spec coverage)

| Spec §6 requirement | Task |
|---|---|
| Header-integrated title + quick-share + settings (no gear-pill) | 7 |
| Single-row grid + tries badge (`×6`), expands on start | 4, 5 |
| Two-zone layout (left game / right lobby), responsive to 1 col | 3, 7 |
| Compact other-tables rows (×T, scroll, count, hot glow) | 2, 5(css) |
| Chat panel (Global/Table tabs) | 3, 8 |
| Tap-to-defect + live seat fill (reuse prototype patterns) | 2 (rail onJoin already navigates), 6 |
| Tries badge = length control (D-B) | 5 |
| Your table / someone joins your room | 6 |
| iOS 16px floor / no maximum-scale | 9 (already clean — verify only) |
| Var-driven across 7 themes incl. Tin-Bot | 5,6,7,8 css + 9 sweep |

**Open question for review:** Task 6 server `capacity` — option (a) additive field (recommended) vs (b) pure-client fallback. **Out of scope (P2, separate spec):** the global lobby chat Arena-DO channel; the surprise bot-join (prior spec §Phase 2); stakes/buy-in filters (floor "filters · soon" is a placeholder only).
