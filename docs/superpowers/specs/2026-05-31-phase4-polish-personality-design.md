# Phase 4 — Polish & Personality (design)

Date: 2026-05-31
Status: **re-scoped** — only §A (keyboard) remains here as the independent
Tier-C ship. §B (jokes), §C (win celebration), §D (phrases), and §E (EZ buttons)
were **superseded by the gold economy**, where they gain real stakes — see
`2026-05-31-gold-economy-leaderboards-design.md`.
Tier: C — pure-frontend (`public/`), ships to prod after local verify.

## Goal

A tune-up batch that makes Wordul feel sharper and more alive: a keyboard that
matches everyone's muscle memory, a companion that gently ribs you, a real win
moment, and EZ-mode hint buttons that are visible and cute on every theme.

## Approved decisions (this session)

- **Sequence:** ship this polish batch now; multiplayer lobby is a *separate*
  spec next.
- **Keyboard:** the real "off" feeling is Enter + ⌫ both crammed at the right
  end. Fix to the NYT layout (Enter far-left, ⌫ far-right). Add an AZERTY toggle
  in Settings. Fade dead keys. Bump letter legibility.
- **Jokes:** playful & occasional (probability + cooldown — never nag).
- **Win:** big but tasteful (confetti + warm flash + chime + winning-row pop,
  reduced-motion gated).
- **EZ mode:** it already runs on all themes (global gold + setting). The real
  problems are (1) the hint buttons are dark-on-dark / invisible in Yang, and
  (2) they're ugly. Make them visible and *cute — no rounded-corner pills.*

## Out of scope (deferred)

- **Replay (v4)** and its tiny additive `guessSequence` capture
  (`src/records.ts` + `room.ts` + `user.ts`) — rides with the multiplayer/server
  spec so this batch stays pure-frontend.
- **Multiplayer browse / spectate / public-vs-private** — next spec.

---

## A. Keyboard tune-up

Files: `public/app.js` (`buildKeyboard` 1231-1268, `renderKeyboard` 1209-1227,
`DEFAULT_SETTINGS` 31-36, `applySettings` 48-52, settings wiring 1935-1959),
`public/index.html` (settings modal ~248-266), `public/style.css` (`.key`
775-792, jackpot keycaps 1115-1128).

**A1 — Enter/⌫ placement (the core fix).** Bottom row becomes
`[Enter] Z X C V B N M [⌫]` — Enter on the far left, Backspace on the far right
(NYT Wordle convention). Today both sit at the right end (app.js:1247-1257).

**A2 — Layouts + AZERTY toggle.**
- Add `KEYBOARD_LAYOUTS = { qwerty: ["QWERTYUIOP","ASDFGHJKL","ZXCVBNM"],
  azerty: ["AZERTYUIOP","QSDFGHJKLM","WXCVBN"] }` near `buildKeyboard`.
- `buildKeyboard()` reads `getSettings().keyboardLayout` (default `"qwerty"`),
  iterates rows, and on the last row prepends Enter / appends ⌫ (A1).
- Add `keyboardLayout: "qwerty"` to `DEFAULT_SETTINGS`. Add a segmented picker
  (QWERTY | AZERTY) to the settings modal with its own handler (the generic
  checkbox `wire()` doesn't fit a segmented control). On change:
  `saveSettings` → `buildKeyboard()` → `renderKeyboard(me)`.
- **No physical remap needed.** `onPhysicalKey` types by `e.key` (the character
  the OS produces) and `renderKeyboard` colors by guessed letter — the on-screen
  layout is purely *visual + click order*. Document this so no one "fixes" a
  non-bug.

**A3 — Faded dead keys.** In `renderKeyboard`, absent (`gray`) keys get a dimmed
treatment (opacity ~0.4). Green/yellow/untried keys stay full. This is what
"already-pressed keys faded out" means in practice — dead letters recede so the
live board pops. Works over the jackpot gradient keys (opacity, not color).

**A4 — Legibility.** `.key` font-size 13px → ~19px; `.key.wide` 11px → ~13px
(Enter label). Keep `min-height: 58px`. Verify jackpot 3D keycaps still read.

**Risk:** `buildKeyboard` attaches a delegated click listener on `#keyboard`;
`innerHTML = ""` clears children but not the listener — so repeated calls would
stack handlers. Confirm the single call site / guard the listener (like
`powerupsWired`) before allowing layout-switch rebuilds.

---

## B. Companion jokes & hints

Files: `public/app.js` (`typeLetter` 1302-1308, `showCompanion` 589-595,
`checkHardMode` 1336-1357 → extract shared knowledge),
`public/edition.js` (`companionReact` 37-49),
`public/editions/{default,yang,jackpot}.js`.

**B1 — `deriveKnowledge(guesses)` helper** (factor out of `checkHardMode`):
returns `{ absent: Set<letter>, greenPos: {pos:letter},
yellowWrongPos: Map<letter, Set<pos>> }`.
- `absent` = letters that appear `gray` and **never** appear green/yellow in any
  guess (duplicate-letter safe — avoids false jokes on words like SPEED).
- `yellowWrongPos` = for each yellow letter L at position i, record L→i (a slot
  we *know* is wrong for L).
- `greenPos` = locked position→letter.

**B2 — Mid-type hook in `typeLetter(l)`** (index = `game.pending.length` before
append): classify the just-typed letter —
- `absent.has(l)` → candidate **`dead_letter`**.
- `yellowWrongPos.get(l)?.has(index)` → candidate **`wrong_spot`**.
- Fire *occasionally*: ~35% probability AND a per-game cooldown (~6s; track
  `game.lastJokeAt`) so it never fires every keystroke.
- Repeat offenders: increment `game.deadRetypes`; at the 3rd/6th/… fire
  **`gaming_system`** ("😏 trying to game the system?"), and ~30% of those times
  fire a genuine **`hint`** instead (surface a known yellow letter or a locked
  position). Routed through `showCompanion(event, {letter, hint})`.
- Text toasts (+ TTS if the edition's voice is on). **No new voice clips needed
  to ship** — Yang clips can be rendered later; do not block on the audio
  pipeline.

**B3 — Edition line banks.** Add `lines.dead_letter`, `lines.wrong_spot`,
`lines.gaming_system`, `lines.hint` to each edition (Default minimal, Yang
warm-sassy, Jackpot casino). Extend `companionReact` to also substitute
`{letter}` / `{hint}` (keeping the `{answer}` safety net).

---

## C. Win celebration — big but tasteful

Files: `public/app.js` (`handleGameOver` win branch 1513-1521, `spawnConfetti`
1408-1422, `playChime` 1426-1443), `public/style.css` (new `.win-flash` /
`.win-pop` keyframes near loss CSS 478-543).

**C1 — `triggerWinCelebration(me)`** called at app.js:1516 (right after
`showCompanion("win")`, before the `setTimeout(openStats, 1700)`):
- Gated by `getSettings().reducedMotion` (skip visuals; a soft chime is ok).
- Gold/green confetti via `spawnConfetti(~52, victoryPalette)`.
- `.win-flash`: a warm gold/green radial flash (~700ms), z-index ~85 — the happy
  mirror of `lose-flash`.
- `playChime` ascending triumphant notes.
- `.win-pop`: the solved (last) row tiles scale-up bounce + settle.
- **Flicker guard:** apply tile classes to the existing DOM and ensure no
  destructive `renderBoards` runs before stats open (mirror the `game.exploding`
  pattern with a transient `game.celebrating` flag if needed). Cleanup timeouts
  remove flash/confetti nodes.
- Applies to all editions (request is general); kept tasteful.

**C2 — `spawnConfetti` palette.** Add an optional palette arg (or a victory
variant) so the existing mechanism is reused with gold/green pieces.

---

## D. More phrases / feel alive

Files: `public/app.js` (`START_PHRASES` 145-162 pattern; `handleGameOver` /
`openStats`).

**D1 — `WIN_FLAVOR_PHRASES`.** A rotating bank of celebratory one-liners; show
one as a quick toast on win (alongside the celebration), in addition to the
companion `win` line.

**D2 — Near-miss "so close" line.** Milestone-triggered (not timers): on a loss
whose last guess had ≥ `wordLength-1` greens, or a win on the final guess, toast
a tension/relief line. Fires once at game end — the idle/wrong companion system
already covers mid-game life.

Keep D tight — copy only, no new systems.

---

## E. EZ-mode hint buttons — fix + redesign

Files: `public/index.html` (`#powerups` 151-154), `public/style.css` (`.powerup`
795-806, `.gold-hud` 62-70), `public/app.js` (`renderPowerups` 953-988 — labels
only).

**Root cause of "invisible in Yang":** `.powerup` fills with
`var(--bg-card, var(--key-bg))` — a *surface* color (`#161310` in Yang) on the
page bg (`#0b0a0c`) with a near-black border (`#2e2a22`). Dark-on-dark. The
buttons are there (`renderPowerups` runs for all editions at app.js:920); they
just vanish.

**E1 — Visibility fix.** Re-anchor `.powerup` to `--accent` (defined vividly in
all three palettes: Yang `#f0c14b`, Default `#c8a96a`, Jackpot `#ffd23f`) — e.g.
accent border + an accent-tinted fill / accent text — so the chips read on every
background without per-edition CSS.

**E2 — Cute, not pill-shaped.** Redesign as little "hint chips/tokens": small
radius (~6-8px, **never** the 999px pill), a clear icon + label + the cost as a
little gold-coin badge, tactile hover/active. Replace the jackpot-specific `🎰`
with theme-agnostic cute icons (💡 *Reveal a letter*, 🔡 *Count the vowels*).
Also **de-pill the gold HUD** (`.gold-hud` `border-radius: 999px` → ~8px chip) to
honor the global no-pill rule. Must pass `check-pill-buttons`.

**E3 — No functional/server change.** Gold economy and the
`reveal_letter` / `vowel_count` messages are untouched — presentation only.

---

## Verification

- **Local:** `wrangler dev` (or serve `public/`); manual pass per area; existing
  vitest suites (`celebrate`, `edition`, `jackpot-edition`, `yang-edition`,
  `voice*`) stay green.
- **Gauntlet (pre-push):** `safe-build`, `check-pill-buttons` (critical for E),
  `check-input-zoom`, `code-reviewer`, `silent-failure-hunter`. `check-i18n` is
  effectively N/A — Wordul has no i18n framework; all copy is hardcoded English
  (START_PHRASES, companion banks), and the new phrases/jokes follow that same
  existing pattern (no framework added — YAGNI).
- **Reduced-motion** verified for C (and any new animation in A3/E2).
- Ship to prod after local verify per the ship-fast convention; post a
  Post-Deploy Summary.

## Risks (consolidated)

- Keyboard: listener stacking on rebuild; physical typing is layout-independent
  (don't add a remap).
- Jokes: nagging — gated by probability + cooldown; `absent` defined to be
  duplicate-letter safe.
- Win: board flicker — guard flag; reduced-motion gate.
- EZ: introducing a pill — keep radius small; verify contrast across all three
  palettes.
