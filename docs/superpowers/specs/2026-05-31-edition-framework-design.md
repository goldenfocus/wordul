# Edition Framework + Premium Default — Design Spec (v1)

**Date:** 2026-05-31
**Status:** approved, pre-implementation
**Scope:** Layer 0 (Edition Framework) + Layer 1 (premium Default edition). Layers 2–4 (vibe packs, AI companions, word packs) are designed-for but out of scope here.

## Summary

Make Wordul themeable from day one. An **edition** is a declarative theme pack —
look, fonts, motion, sound/voice, and a companion personality — applied over the
existing live multiplayer engine (`public/app.js`). Players pick an edition; the
choice persists; a single shared gold wallet spans all editions. This spec builds
the framework and proves it by shipping a premium, Apple-grade **Default** edition
that becomes the new face of Wordul. It also establishes **Wordul** as the single
brand name across the product.

## Goals

- One declarative object per edition is the ONLY thing an edition author writes.
- Editions reskin the real engine, so each inherits multiplayer + profiles free.
- A shared gold wallet (earn on win, spend on power-ups), built to sync to the
  existing User Durable Object later.
- A companion seam that ships canned per-edition lines now and swaps to a live LLM
  later at one call site.
- A premium Default edition replacing the current NYT-clone look.
- One brand name everywhere: **Wordul**.

## Non-Goals (YAGNI — later layers)

- Live LLM companion banter / interactive chat-back (Layer 3).
- Word packs / topical lists / stealth coaching (Layer 4).
- Vibe packs (Jackpot / Saturday Morning / Midnight Gold) (Layer 2).
- Daily edition rotation, per-edition wallets, server-synced gold.

## Naming Convention (product-wide law)

- Brand / display name: **Wordul** (capital W).
- Lowercase contexts (domain, handles, storage keys, ids, filenames): `wordul`.
- BANNED legacy names: `Wordle Race`, `Wurdul`, `WURDUL`, bare `wordle` in
  user-facing copy.
- New code in this spec uses `Wordul` from the start. Storage keys use the
  `wordul.` prefix (e.g. `wordul.edition`, `wordul.gold`).
- The existing 23 `Wordle Race` occurrences (in `public/llms.txt`,
  `public/llms-full.txt`, `public/index.html`, `public/app.js`, `src/worker.ts`)
  and the `WURDUL` logos in the three published prototypes are renamed as a
  **coordinated pass** (see Coordination) — never a silent mid-flight find-replace
  under the other agent.

## Architecture

### Unit 1 — Edition pack (data)

`public/editions/<id>.js` — one declarative object, the only thing an edition
author writes. Shape:

```js
export const edition = {
  id: "default",
  name: "Wordul",
  palette: {            // → CSS custom properties
    bg, fg, muted, border, tileEmpty, tilePendingBorder,
    keyBg, green, yellow, gray, accent, bgCard, error,
  },
  fonts: { display: "<css font-family>", body: "<css font-family>",
           link: "<google fonts href or ''>" },
  motion: { revealStaggerMs: 220, flipHalfMs: 275 },
  sound: { voice: { rate: 1, pitch: 1, on: true } },
  companion: {
    name: "Wordul",
    lines: { invalid: [...], wrong: [...], win: [...], loss: [...], idle: [...] },
  },
};
```

`public/editions/index.js` — registry: imports each pack, exports
`EDITIONS` (ordered array) + `getEdition(id)` with a safe fallback to `default`.

### Unit 2 — Edition runtime

`public/edition.js` — the framework. Pure functions + thin DOM glue, no engine
internals. Responsibilities:

- `applyEdition(id)`:
  - set `document.documentElement.dataset.edition = id`
  - inject the edition's font `<link>` once (idempotent by id)
  - expose motion vars as CSS custom properties
    (`--reveal-stagger-ms`, `--flip-half-ms`) and as `window.WordulMotion`
    `{ revealStaggerMs, flipHalfMs }` for app.js to read
  - persist `localStorage["wordul.edition"] = id`
- `getActiveEditionId()` — read localStorage, fallback `default`.
- `renderEditionPicker(rootEl, onPick)` — list editions, current selected;
  calls `applyEdition` + `onPick` on change (live, no reload).
- Wallet:
  - `getGold()` / `setGold(n)` over `localStorage["wordul.gold"]` (start 50).
  - `earnGold(guessCount)` — payout = `max(10, 70 - guessCount*10)`; returns delta.
  - `spendGold(cost)` — returns false if insufficient (caller disables UI).
- Companion:
  - `companionReact(event)` where event ∈
    `{invalid, wrong, win, loss, idle}` → returns
    `{ text, speak: boolean }` by picking a line from the active edition
    (index varies by call count so lines rotate, deterministic — no Math.random
    at module load). Speaks via `speechSynthesis` when `sound.voice.on` and not
    muted (`localStorage["wordul.muted"]`).

CSS variable application: `applyEdition` writes palette values to
`document.documentElement.style` (`--bg`, `--green`, …), overriding `:root`
defaults from `style.css`. `style.css` keeps its `:root` as the Default values so
there is never an unstyled flash.

### Unit 3 — Pre-paint bootstrap

In `public/index.html` `<head>`, a tiny inline script (runs before stylesheet
paint) sets `document.documentElement.dataset.edition` from
`localStorage["wordul.edition"]` (fallback `default`) to avoid a flash of the
wrong theme.

### Unit 4 — Engine hooks (surgical patches to `app.js`)

Exactly these touch-points, each small and well-bounded:

1. On load (after parseRoute/mount): `import { applyEdition, getActiveEditionId }`
   and call `applyEdition(getActiveEditionId())`.
2. Reveal timing: replace the module consts `REVEAL_STAGGER_MS` /
   `REVEAL_FLIP_HALF_MS` (app.js:261–262) reads with
   `window.WordulMotion?.revealStaggerMs ?? 220` etc., so editions drive motion.
3. Companion events: at the 5 moments (invalid word, wrong guess submitted, win,
   loss, idle timeout) call `companionReact(event)` and surface the returned text
   in a companion toast element.
4. Gold HUD: render a gold counter in the room/home header from `getGold()`;
   count-up on change.
5. Power-ups: two buttons — Reveal a letter (−20), Vowel hint (−10) — calling
   `spendGold` then applying the effect to the current board; disabled when
   `getGold()` is insufficient.

All other engine behavior (rooms, chat, WebSocket, scoreboard, profiles) is
untouched.

### Unit 5 — CSS

`style.css`: no structural change required (palette already variable-driven). Add
a `--reveal-stagger-ms` / `--flip-half-ms` usage in the reveal keyframes if
feasible; otherwise motion is JS-driven via `window.WordulMotion`. Add a companion
toast + gold HUD + power-up button styles (edition-neutral, theme via variables).

### Unit 6 — Default edition pack (Layer 1)

`public/editions/default.js`: Apple-grade. Warm off-black background, a single
quiet accent (not NYT green), a refined display + body font pairing (distinctive,
not system/Inter/Roboto), subtle precise motion (slightly slower, eased), no shiny
buttons. Companion `name: "Wordul"`, dry-but-warm lines. This pack's palette
mirrors the values `style.css :root` will hold, so Default needs no override flash.

## Data Flow

```
index.html <head> inline script → data-edition set pre-paint
app.js load → applyEdition(getActiveEditionId())
            → palette vars on <html>, font link injected, WordulMotion set
gameplay event → companionReact(event) → toast (+ optional speech)
win → earnGold(guessCount) → HUD count-up
power-up click → spendGold(cost) → board effect | disabled if broke
picker change → applyEdition(newId) live → persisted
```

## Error Handling

- Unknown / missing edition id → `getEdition` falls back to `default` (never blank).
- Font link fails to load → CSS font-family fallback chain renders; no crash.
- `speechSynthesis` unavailable → companion still shows text, just no voice.
- Corrupt `wordul.gold` (NaN) → reset to default 50, log once.
- `spendGold` insufficient → returns false; caller disables the power-up; no
  negative balance ever written.

## Coordination (Sacred)

The other agent is actively editing `public/app.js`, `public/style.css`,
`public/index.html`, and `src/worker.ts`. Therefore:

- **We build Units 1–3, 6 (all NEW files) freely now** — `public/edition.js`,
  `public/editions/*.js`. No collision.
- **Units 4–5 + the rename pass (Naming Convention) patch shared files** — these
  land ONLY after the other agent's current work merges to main, OR via an explicit
  file-ownership handoff recorded in `.claude/COLONY.md`. Never refactor `app.js`
  / `style.css` / `index.html` / `worker.ts` underneath them mid-flight.
- The deploy is the single shared chokepoint (Worker `wordle-race`); coordinate the
  deploy as before (confirm with Yan; sequence with the other agent's deploys).

## Testing

- **edition.js (unit):** wallet math (`earnGold` payout table, `spendGold` refuses
  overspend, no negative balance), `getEdition` fallback to default, companion
  rotates lines and returns one per event type.
- **apply (integration):** `applyEdition(id)` sets `data-edition`, writes palette
  vars, persists id; switching re-applies without reload.
- **pre-paint:** with `wordul.edition` set, the inline bootstrap sets the attribute
  before first paint (no flash).
- **rename:** zero `Wordle Race` / `Wurdul` / `WURDUL` remain in `public/` + `src/`
  after the coordinated pass (`grep` returns nothing).
- **prod smoke (post coordinated deploy):** load wordul.com, default edition
  renders, picker switches editions, gold earns on a win and spends on a power-up.

## Reusability (the seam pays off later)

- **Layer 2 (vibes):** add `public/editions/jackpot.js` etc. — port the three
  prototypes' palettes/fonts/motion/lines into packs. No framework change.
- **Layer 3 (AI):** replace `companionReact`'s canned pick with a live LLM call at
  that one function; line banks become fallbacks. Voice swap point already marked.
- **Layer 4 (word packs):** add a `wordPack` field to the pack object + a second
  picker; the engine already centralizes word length/selection.
