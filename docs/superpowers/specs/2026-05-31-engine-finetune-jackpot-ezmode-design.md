# Engine Fine-Tune: Type-to-Start, Green Celebrations, Jackpot Edition, EZ Mode — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) — ready for implementation planning
**Author:** Yan + Claude

## Summary

Four improvements to the Wordul main engine, grouped into three shippable phases:

1. **Phase 1 (frontend):** type-to-start · rotating fun start-screen phrases · Yang's scaled green-reveal celebrations.
2. **Phase 2 (frontend):** the **Jackpot edition** (neon casino look + real 3D keycap QWERTY keyboard, jackpot-only).
3. **Phase 3 (server + frontend):** **EZ mode** — a setting that surfaces gold-spend power-ups (Reveal a Letter, Vowel Count), which require new server messages because the client never sees the answer during play.

Each phase ships independently; build in order 1 → 2 → 3.

## Key constraint discovered

`src/room.ts:419-425` (`snapshotFor`) deliberately nulls `word` until `phase === "finished"`
("While playing, never leak the word"). Therefore **any feature that needs the answer mid-game
must go through the server** — this is why EZ-mode power-ups are Phase 3 (server) not cosmetic.

---

## Phase 1 — Frontend wins

### 1A · Type-to-start
`onPhysicalKey` (`public/app.js:1120`) currently ignores keys unless `phase==="playing"`. Extend it:
- **Home screen** (intro visible, no `game.snapshot`): a letter A-Z or Enter clicks `#startPlayingBtn`.
- **Lobby** (`game.snapshot.phase==="lobby"`): a letter A-Z or Enter sends `{type:"start"}` (same as `#startBtn`).
- Preserve existing guards: ignore when target is an `<input>`, when meta/ctrl/alt held, and when a
  modal (settings) is open. Backspace does nothing in these states.

### 1B · Rotating fun phrases
- A `START_PHRASES` bank (generated content). A small line under the start button(s), random per visit.
- ~1/3 of the bank nudges the type-to-start behavior ("psst… just start typing"), so copy teaches 1A.
- Placement: a `<p class="start-hint">` under `#startPlayingBtn` (home) and reuse for `#lobbyHint` flavor.
- Global (not edition-specific) for this phase.

### 1C · Yang's scaled green celebrations
- In `onServerMessage`'s accepted-guess block (`app.js:~755`, where `wrong` already fires), compute
  **new greens**: columns whose mask is `green` in the latest guess but were NOT green in any prior guess.
- **Yang edition only** (`getActiveEditionId()==="yang"`):
  - **0 new greens** → existing `wrong` companion line.
  - **1 new green** → quick tile spark + soft chime (no toast).
  - **2+ new greens** → confetti burst (reuse `triggerStartCelebration`'s confetti pattern) + a hyped
    Yang voice line from a new `rush` companion bank.
- Non-Yang editions keep current behavior (always `wrong`).
- New content: Yang `rush` bank (generated). Spark + chime are CSS/Web Audio; confetti reuses existing.

---

## Phase 2 — Jackpot edition

New `public/editions/jackpot.js`, registered in `index.js`. Edition object supplies palette + fonts +
companion banks; all decoration is **edition-scoped CSS** keyed on `html[data-edition="jackpot"]`
(`applyEdition` already sets `html.dataset.edition`).

- **Palette** (from the `/designs/jackpot` prototype): bg `#0a0511`, fg cream `#fff3b0`, accent gold
  `#ffd23f`, green `#22e06b`, yellow `#ffd84d`, plus magenta/cyan glow accents. `bgCard`, `border`,
  `keyBg`, `tileEmpty`, `tilePendingBorder` chosen to match.
- **Fonts:** display `'Bungee'`, body `'Chakra Petch'` (Google Fonts link in the edition).
- **Marquee border:** dashed neon frame via `html[data-edition="jackpot"] body::before` (jackpot-only).
- **Real 3D keycap QWERTY keyboard:** pure CSS restyle of existing `#keyboard .key` under the jackpot
  selector (beveled, raised keycaps). Markup unchanged. Jackpot-only.
- **Tile neon glow** under the jackpot selector.
- **Companion banks:** jackpot's own high-roller casino voice for invalid/wrong/win/loss/idle (generated;
  loss lines include `{answer}`). `sound.voice.on = true` (browser-voice fallback until clips rendered).

No new keyboard markup or layout — rows stay `QWERTYUIOP / ASDFGHJKL / ZXCVBNM` (already QWERTY).

---

## Phase 3 — EZ mode + gold-spend power-ups (server + frontend)

### Setting
- Add `ezMode: false` to `DEFAULT_SETTINGS` (`app.js:30`) + a toggle row in the Settings modal.
- `applySettings` toggles a `body.ez` class (drives power-up visibility via CSS).

### Power-up UI
- New `#powerups` container in `index.html`, mounted directly above `#keyboard`, hidden by default.
- Visible only when `body.ez` AND `phase==="playing"` AND it's the player's turn.
- Two buttons (styled after the prototype, shown in **any** edition): **Reveal a Letter (−20 gold)**,
  **Vowel Count (−10 gold)**. The gold HUD (`renderGoldHud`) shows whenever EZ is on.
- Gold is the existing client wallet (`edition.js` `getGold`/`spendGold`). Spend happens client-side on
  use; if balance is insufficient, the button is disabled with a hint.

### Server messages (`src/types.ts` + `src/room.ts`)
- `ClientMessage` gains `{type:"reveal_letter"}` and `{type:"vowel_count"}`.
- `ServerMessage` gains `{type:"revealed_letter"; index:number; letter:string}` and
  `{type:"vowel_count"; count:number}`.
- Handlers (only when `phase==="playing"` and the sender is a playing member):
  - **reveal_letter:** pick an index of the answer NOT already green in any of that player's guesses;
    return `{revealed_letter, index, letter}`. If all greened, return the lowest ungreened (or no-op).
  - **vowel_count:** return `{vowel_count, count}` = number of vowels (A,E,I,O,U) in the answer.
- Client applies: reveal → mark that board column as a persistent "revealed" hint + flag the keyboard
  key; vowel count → toast/badge. Both then `spendGold(cost)` and refresh the HUD.
- Anti-abuse note: these intentionally leak partial answer info — that is the point of an opt-in EZ mode.
  Hard mode and EZ mode are independent toggles (no enforced exclusivity in this phase).

---

## Testing

- **Phase 1:** unit-test the new-green detection helper (pure function: latest mask + prior masks →
  count of new greens). Manual `/run` smoke for type-to-start + celebration feel.
- **Phase 2:** `yang-edition`-style test asserting jackpot registers, has all 5 banks, loss has `{answer}`,
  lines are TTS-clean. Manual visual check (Playwright) of theme + keycaps + marquee.
- **Phase 3:** `room.ts` unit tests for `reveal_letter` (returns an ungreened index/letter, never a
  greened one) and `vowel_count` (correct count); both reject when not playing. Manual smoke of the
  power-up buttons + gold spend.

## Content (generated during implementation)
- `START_PHRASES` (~14, a third teaching type-to-start)
- Yang `rush` bank (~12 hyped 2+-green lines, TTS-clean)
- Jackpot companion banks (invalid/wrong/win/loss/idle, casino voice, loss includes `{answer}`)

## Out of scope (deferred)
- Cloned-voice clips for the new banks (render later via `render.mjs` once a profile exists).
- Server-tracked gold (gold stays client-side localStorage).
- Promoting the theme picker out of Settings (per product direction: later, with theme-of-the-day).
