# Game Modes Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a per-room `mode` concept (data model, control flow, UI) with exactly one mode (`race`) wired up, so future game modes only need to add an `if`.

**Architecture:** A new `src/modes.ts` registry is the single source of truth for modes. `RoomMode` rides the exact rails the existing `wordLength` setting already uses: defaulted in DO init, backfilled on restore, owner-gated default at `hello`, shared-control change in lobby via a new `set_mode` message, broadcast in every snapshot. The UI is a stacked mode-row picker (not pills) shown in the lobby; available modes are selectable, future modes render as visible "coming soon" rows.

**Tech Stack:** TypeScript Cloudflare Worker + Durable Objects; vanilla single-file SPA (`public/app.js`); vitest for pure-module tests. Spec: `docs/superpowers/specs/2026-06-01-game-modes-foundation-design.md`.

**Testing note:** The Room Durable Object class is not unit-tested directly (no miniflare harness in `test/`); pure modules are. So `src/modes.ts` gets TDD; `room.ts` / `app.js` / markup changes are verified by `npm run build`/typecheck + the manual checks in the final task.

---

### Task 1: Mode registry (`src/modes.ts`)

**Files:**
- Create: `src/modes.ts`
- Test: `test/modes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/modes.test.ts
import { describe, it, expect } from "vitest";
import { MODES, DEFAULT_MODE, isAvailableMode } from "../src/modes.ts";

describe("modes registry", () => {
  it("has race as the default and only available mode for now", () => {
    expect(DEFAULT_MODE).toBe("race");
    expect(MODES.race.available).toBe(true);
  });

  it("ships the roadmap as unavailable modes with blurbs", () => {
    expect(MODES.longgame.available).toBe(false);
    expect(MODES.challenge.available).toBe(false);
    for (const m of Object.values(MODES)) {
      expect(typeof m.label).toBe("string");
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it("isAvailableMode only accepts available, known modes", () => {
    expect(isAvailableMode("race")).toBe(true);
    expect(isAvailableMode("longgame")).toBe(false);
    expect(isAvailableMode("nope")).toBe(false);
    expect(isAvailableMode(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modes.test.ts`
Expected: FAIL — cannot resolve `../src/modes.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modes.ts
// Single source of truth for room game modes. Only `available: true` modes can be
// chosen; the rest exist deliberately as the visible roadmap in the mode picker.
// Labels/blurbs here are English fallbacks — the rendered UI strings come from i18n.

export type RoomMode = "race"; // future: "longgame" | "challenge" | ...

export const DEFAULT_MODE: RoomMode = "race";

type ModeDef = { id: string; label: string; blurb: string; available: boolean };

export const MODES: Record<string, ModeDef> = {
  race:      { id: "race",      label: "Live Race",      blurb: "Everyone sprints the same word at once.",         available: true  },
  longgame:  { id: "longgame",  label: "Long Game",      blurb: "Turn-based. 3-day clock. Play a row, then wait.",  available: false },
  challenge: { id: "challenge", label: "Open Challenge", blurb: "One word, always open. Beat the standing record.", available: false },
};

export function isAvailableMode(id: unknown): id is RoomMode {
  return typeof id === "string" && MODES[id]?.available === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modes.ts test/modes.test.ts
git commit -m "feat(modes): mode registry — race available, longgame/challenge as roadmap"
```

---

### Task 2: Types — thread `mode` through the protocol

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the `RoomMode` import**

At the top of `src/types.ts`, alongside the other `import type` lines (after line 4):

```ts
import type { RoomMode } from "./modes.ts";
```

- [ ] **Step 2: Add `mode` to `RoomSnapshot`**

In the `RoomSnapshot` type, add the field right after `wordLength` / `maxGuesses` (around line 54):

```ts
  mode: RoomMode;          // room game format; "race" today, more later
```

- [ ] **Step 3: Add `mode?` to the `hello` message**

In `ClientMessage`, change the `hello` variant to carry an optional mode (mirrors `wordLength?`):

```ts
  | { type: "hello"; username: string; wordLength?: number; mode?: RoomMode }
```

- [ ] **Step 4: Add the `set_mode` message**

In `ClientMessage`, add a new variant next to `set_length`:

```ts
  | { type: "set_mode"; mode: RoomMode }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/room.ts` (missing `mode` in the initial state object and unhandled `set_mode` case). Those are fixed in Task 3. No errors in `types.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add RoomMode to snapshot, hello, and set_mode message"
```

---

### Task 3: Room DO — default, backfill, apply, handle

**Files:**
- Modify: `src/room.ts`

- [ ] **Step 1: Import the mode helpers**

Add to the imports from `./modes.ts` (create the import line near the other `./` imports at the top of `src/room.ts`):

```ts
import { DEFAULT_MODE, isAvailableMode } from "./modes.ts";
import type { RoomMode } from "./modes.ts";
```

- [ ] **Step 2: Default `mode` in the initial state**

In the constructor's `this.state = { ... }` object (around line 51, after `wordLength` / `maxGuesses`), add:

```ts
      mode: DEFAULT_MODE,
```

- [ ] **Step 3: Backfill `mode` on restore**

In the restore block, next to the existing `wordLength` backfill (around line 63–64), add:

```ts
        if (!restored.mode) restored.mode = DEFAULT_MODE;
```

- [ ] **Step 4: Apply owner's `mode` at hello (mirror wordLength default)**

Change the `onHello` signature (line 173) to accept `mode`:

```ts
  private async onHello(ws: WebSocket, usernameRaw: string, wordLength?: number, mode?: RoomMode): Promise<void> {
```

And update the dispatch in `handle` (line 146):

```ts
      case "hello":
        return this.onHello(ws, msg.username, msg.wordLength, msg.mode);
```

Inside `onHello`, in the new-player branch right after the `wordLength` default block (after line 207, still inside the `if (... === this.state.owner ...)` sibling logic), add a parallel owner+round-0 default for mode:

```ts
      if (
        username === this.state.owner &&
        isAvailableMode(mode) &&
        this.state.phase === "lobby" &&
        this.state.round === 0
      ) {
        this.state.mode = mode;
      }
```

- [ ] **Step 5: Add the `set_mode` handler + dispatch (mirror set_length, shared-control)**

Add the dispatch case in `handle` next to `set_length` (after line 156):

```ts
      case "set_mode":
        return this.onSetMode(ws, msg.mode);
```

Add the handler next to `onSetLength` (after line 287). Shared-control + lobby-only, matching `onSetLength`:

```ts
  private async onSetMode(ws: WebSocket, mode: RoomMode): Promise<void> {
    if (this.state.phase !== "lobby") {
      this.send(ws, { type: "error", message: "can't change mode mid-game" });
      return;
    }
    if (!isAvailableMode(mode)) {
      this.send(ws, { type: "error", message: "mode not available" });
      return;
    }
    if (mode === this.state.mode) return;
    this.state.mode = mode;
    const who = this.userFor(ws) ?? "someone";
    this.pushSystem(`${who} set mode to ${mode}`);
    await this.persistAndBroadcast();
  }
```

- [ ] **Step 6: Typecheck + run full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all existing tests + `modes.test.ts` PASS. (`mode` is now in every broadcast snapshot automatically, since `persistAndBroadcast` serializes `this.state`.)

- [ ] **Step 7: Commit**

```bash
git add src/room.ts
git commit -m "feat(room): default/backfill mode, apply at hello, handle set_mode"
```

---

### Task 4: i18n keys (`public/locales/en.js`)

**Files:**
- Modify: `public/locales/en.js`

- [ ] **Step 1: Add the mode strings**

Before the closing `};` of the `en` object in `public/locales/en.js`, add:

```js
  // Mode picker (lobby)
  "mode.heading": "Choose a mode",
  "mode.comingSoon": "soon",
  "mode.race.label": "Live Race",
  "mode.race.blurb": "Everyone sprints the same word at once.",
  "mode.longgame.label": "Long Game",
  "mode.longgame.blurb": "Turn-based. 3-day clock. Play a row, then wait.",
  "mode.challenge.label": "Open Challenge",
  "mode.challenge.blurb": "One word, always open. Beat the standing record.",
```

- [ ] **Step 2: Verify i18n completeness**

Run: `npm run check-i18n` (if present) — otherwise confirm `en.js` is the only locale (`ls public/locales/`) so no other files need the keys.
Expected: PASS / single locale confirmed.

- [ ] **Step 3: Commit**

```bash
git add public/locales/en.js
git commit -m "feat(i18n): mode picker strings (heading, labels, blurbs, soon)"
```

---

### Task 5: Lobby markup — mode picker container + chip

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add the mode picker container inside lobby controls**

In `#tpl-room`, inside `<div id="lobbyControls" ...>`, add a mode picker block right before `<div id="lengthControl" ...>` (line 138). It is JS-populated:

```html
        <div id="modeControl" class="mode-control" hidden>
          <span class="label" id="modeHeading">Choose a mode</span>
          <ul id="modeList" class="mode-list" role="radiogroup" aria-label="Game mode"></ul>
        </div>
```

- [ ] **Step 2: Add the read-only mode chip near the room name**

In the `.room-info` block, add a chip after `#roomName` (after line 128, before `#renameBtn`):

```html
        <span id="modeChip" class="mode-chip" hidden></span>
```

- [ ] **Step 3: Verify markup loads**

Run: `npm run build` (or your dev server) and load a room — no console errors, lobby still renders.
Expected: container present (empty until Task 6 wires it), no regressions.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(room): mode picker container + read-only mode chip markup"
```

---

### Task 6: Picker behavior (`public/app.js`)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Import the registry**

Near the top imports of `public/app.js`, add:

```js
import { MODES, isAvailableMode } from "./modes.js";
```

Note: `public/` is served as static assets; `src/modes.ts` is TypeScript for the Worker. Create a tiny browser twin `public/modes.js` exporting the SAME `MODES` object and an `isAvailableMode` (copy the object + function bodies from `src/modes.ts`, drop the TS types). Keep them in sync; both are tiny. Commit `public/modes.js` in this task.

- [ ] **Step 2: Send the owner's preferred mode at hello**

In the `hello` send (around line 886–889), the message currently sends `wordLength`. Add `mode`:

```js
    send({
      type: "hello",
      username,
      wordLength: getPreferredLength(),
      mode: "race",
    });
```

(Only `"race"` is selectable today, so this is the only valid value; future work reads a saved preference.)

- [ ] **Step 3: Add `syncModePicker(snap)` and the chip**

Add this function near `syncLengthSelect` (after line ~1446):

```js
function syncModePicker(snap) {
  const list = $("#modeList");
  const control = $("#modeControl");
  if (!list || !control) return;
  control.hidden = false;
  $("#modeHeading").textContent = t("mode.heading");

  // Build rows once.
  if (list.children.length === 0) {
    for (const id of Object.keys(MODES)) {
      const li = document.createElement("li");
      li.className = "mode-row";
      li.dataset.mode = id;
      li.setAttribute("role", "radio");

      const main = document.createElement("div");
      main.className = "mode-row-main";
      const label = document.createElement("span");
      label.className = "mode-row-label";
      label.textContent = t(`mode.${id}.label`);
      const blurb = document.createElement("span");
      blurb.className = "mode-row-blurb";
      blurb.textContent = t(`mode.${id}.blurb`);
      main.append(label, blurb);

      const tag = document.createElement("span");
      tag.className = "mode-row-tag";
      li.append(main, tag);

      const available = isAvailableMode(id);
      if (available) {
        li.tabIndex = 0;
        const choose = () => send({ type: "set_mode", mode: id });
        li.addEventListener("click", choose);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
        });
      } else {
        li.classList.add("locked");
        li.setAttribute("aria-disabled", "true");
        tag.textContent = `${t("mode.comingSoon")} 🔒`;
      }
      list.appendChild(li);
    }
  }

  // Reflect current selection from the snapshot (server is source of truth).
  for (const li of list.children) {
    const selected = li.dataset.mode === snap.mode;
    li.classList.toggle("selected", selected);
    li.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function syncModeChip(snap) {
  const chip = $("#modeChip");
  if (!chip) return;
  chip.textContent = t(`mode.${snap.mode}.label`);
  // Show the read-only chip whenever the interactive picker is hidden
  // (playing / finished) — late-joiners mid-play still see the mode.
  chip.hidden = snap.phase === "lobby";
}
```

- [ ] **Step 4: Call them from `render()`**

In `render()` where the lobby phase is handled (line 1268–1275), add `syncModePicker(snap)` next to `syncLengthSelect(snap)`; and hide the picker control when not in lobby. Also call `syncModeChip(snap)` unconditionally. Concretely, update the phase block:

```js
  if (snap.phase === "lobby") {
    lobby.hidden = false;
    endControls.hidden = true;
    syncLengthSelect(snap);
    syncModePicker(snap);
    startBtn.hidden = false;
    $("#lobbyHint").textContent = snap.players.length < 2
      ? `Waiting for friends · start solo anytime`
      : `${snap.players.length} players in`;
  } else if (snap.phase === "playing") {
    lobby.hidden = true;
    endControls.hidden = true;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  } else if (snap.phase === "finished") {
    lobby.hidden = true;
    endControls.hidden = false;
    rematchBtn.hidden = false;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  }
  syncModeChip(snap);
```

- [ ] **Step 5: Manual verification**

Run the app locally (`npm run dev` / wrangler dev) and verify:
- New room lobby: picker shows 3 rows; **Live Race** selected; **Long Game** + **Open Challenge** dimmed with "soon 🔒", not clickable.
- Clicking Live Race keeps it selected; a chat system line "set mode to race" only appears if you switched (it won't, since it's already selected — expected).
- Phase → playing: picker hidden, `#modeChip` shows "Live Race" near the room name.
- Reload an OLD room (created before this change): no errors, mode shows race.
Expected: all true.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/modes.js
git commit -m "feat(room): mode-row picker + read-only chip, send mode at hello"
```

---

### Task 7: Styles + final gauntlet

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add mode-row styles**

Append to `public/style.css` (match the existing dark/green theme; tune variable names to the file's conventions — use existing accent/border vars rather than hardcoding if present):

```css
/* Mode picker (lobby) */
.mode-control { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.mode-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.mode-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border: 1px solid var(--border, #2a2a2a); border-radius: 12px;
  background: var(--surface, #111); cursor: pointer; transition: border-color .15s, background .15s;
}
.mode-row:hover:not(.locked) { border-color: var(--accent, #7fb88a); }
.mode-row.selected {
  border-left: 4px solid var(--accent, #7fb88a);
  background: color-mix(in srgb, var(--accent, #7fb88a) 12%, transparent);
}
.mode-row-main { display: flex; flex-direction: column; gap: 2px; }
.mode-row-label { font-weight: 600; }
.mode-row-blurb { font-size: .85rem; opacity: .7; }
.mode-row-tag { font-size: .75rem; opacity: .6; white-space: nowrap; }
.mode-row.selected .mode-row-tag::before { content: "✓"; color: var(--accent, #7fb88a); }
.mode-row.locked { cursor: default; opacity: .5; }
/* Read-only mode chip near room name */
.mode-chip {
  font-size: .72rem; padding: 2px 8px; border-radius: 999px;
  background: var(--surface-2, #1c1c1c); color: var(--muted, #9a9a9a);
}
```

- [ ] **Step 2: Run the full pre-push gauntlet**

Run (via the `/push` skill's checks, or directly):
`safe-build`, `check-i18n`, `check-pill-buttons`, `check-input-zoom`, then `code-reviewer` + `silent-failure-hunter`.
Expected: all green. `check-pill-buttons` must pass — the picker uses `.mode-row` list items, not pills, by design.

- [ ] **Step 3: Final manual smoke**

Reload a fresh room + an existing room; confirm picker, selection, chip, and unchanged race gameplay end-to-end.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(room): mode-row picker styles (selected / locked) + mode chip"
```

---

## Self-Review

**Spec coverage:**
- §1 Data model (`RoomMode`, `mode` on snapshot, backfill) → Tasks 1, 2, 3 ✓
- §2 Registry `src/modes.ts` → Task 1 ✓
- §3 Control flow (`hello.mode`, `set_mode`, lobby-only, broadcast) → Tasks 2, 3 ✓ (reconciled: shared-control change + owner-only default, matching the codebase's `set_length` pattern — noted in plan header)
- §4 UI stacked rows + locked roadmap + read-only chip → Tasks 5, 6, 7 ✓
- §5 i18n keys → Task 4 ✓
- Verification list → Tasks 6.5, 7.2, 7.3 ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `RoomMode`, `MODES`, `DEFAULT_MODE`, `isAvailableMode`, `onSetMode`, `syncModePicker`, `syncModeChip`, `#modeControl`/`#modeList`/`#modeChip`/`#modeHeading` used consistently across tasks. `public/modes.js` mirrors `src/modes.ts`. ✓

**One known deviation from spec:** spec §3 said `set_mode` "owner-only"; plan makes it shared-control lobby-only to mirror the real `set_length` behavior (kindness model). Owner-gating remains on the `hello`-time default. Intentional and documented.
