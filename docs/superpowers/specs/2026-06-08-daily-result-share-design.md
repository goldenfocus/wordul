# Daily result share — design

**Date:** 2026-06-08
**Status:** approved (Approach A)
**Tier:** C (client-only; no migration / money / RLS / CI / Sentry)

## Problem

Sharing a completed **Word of the Day** funnels the player into the **PvP ghost-challenge**
mechanic, which is wrong for a daily. Two surfaces do it:

1. **Wiki word page** (`public/word-page.js`) appends a "Challenge a friend →" CTA that mints
   `/c/<id>?vs=<me>` for *every* word, with no daily-awareness. For today's daily this opens a
   broken versus lobby.
2. **In-app end screen** (`public/app.js` `prepareShareCard`) mints a `/c/<id>` ghost challenge
   for *any* finished room — including the daily room (`showRoom("daily", date)`).

For the **live** daily, `snap.word` is stripped server-side (no-spoiler rule), so the mint fires
with `word:""` → a malformed challenge whose ghost falls back to the **seeded "Papa" record**
(`src/records.ts:22` calls out "yang/papa runs" as synthetic seed data). Result: a "vs 1 ghost"
lobby against a seed bot, and a **dead Start button**.

A finished daily is a **result to show off**, not a duel to set up.

## Goal

For the daily word, sharing produces a **full-screen result card** (your color grid + score) with
a clean **"Play today's Wordul →"** link to `/daily/<date>`. **Never** a `/c/<id>` ghost challenge.

## Core invariant

> The daily word never mints or links a `/c/<id>` ghost challenge. Its share link is always
> `${origin}/daily/<date>`.

This single rule kills the "Papa" ghost and the dead Start at the source.

## Components

### 1. New pure module — `public/daily-share-core.js` (tested)

Mirrors the codebase's pure-module pattern (`ghost-replay.js`, `share-card.js`, `daily-recover.js`).

- `decodeGridToMasks(grid)` — `["gyx",…]` color-letter rows → `[["hot","warm","cold"],…]` mask
  arrays (the shape `share-card.js` consumes). Mapping: `g→hot`, `y→warm`, `x→cold`, unknown→`cold`.
- `dailyAnswerOf(solve)` — the all-green row's word, lowercased, or `""` (no all-green row → a loss
  or malformed solve). This is the spoiler-safe "what daily word did *I* solve" signal.
- `dailyShareModel({ pageWord, raw })` — parse `raw` (the `wr.dailySolve:<date>` JSON). Return
  `null` unless it parses AND `dailyAnswerOf === pageWord.toLowerCase()` (i.e. this page IS the
  daily word *I* solved). On match return:
  `{ won, score: "${guesses}/${max}", masks, cols }` where `cols = grid[0].length` and
  `max = Math.min(cols + 1, 8)` (mirrors `guessesFor` in `src/room-core.ts`).

Pure, no DOM, no `Date`, no `localStorage` — the caller passes `raw` and `pageWord` in.

### 2. `public/app.js` — `prepareShareCard()` daily branch

Before the `/api/challenge` mint (`app.js:4252`), branch on `game.isDaily` (set at `app.js:930`):

- **Skip the mint entirely** (no ghost tape, no `challengeId`).
- `cardUrl = ${location.origin}/daily/${game.dailyDate}`.
- Card text becomes a daily brag: `Solved today's Wordul in ${score} — your turn?` (won) /
  `Today's Wordul got me. Your turn?` (loss).

The existing `buildShareCardModel`/`renderShareCard` still draws the grid+score card unchanged —
only its link changes. The "Beat my score →" button label stays (with the `/daily/<date>` URL it
reads as a play invite); not worth touching the shared, tested renderer.

### 3. `public/word-page.js` — daily-aware CTA (stays a plain script; dynamic `import()`)

In the CTA flow (currently always appends "Challenge a friend →" at line 61):

1. Cheap pre-check (no import): `today = new Date().toISOString().slice(0,10)`;
   `raw = localStorage.getItem("wr.dailySolve:" + today)`. If absent → existing generic behavior.
2. If present, lazily `await import("/daily-share-core.js")` and call
   `dailyShareModel({ pageWord: word, raw })`. If `null` (not my daily word) → existing generic
   behavior (this preserves the normal "Challenge a friend →" for archived words).
3. If a model: **do not append the broken challenge CTA.** Instead `await import("/share-card.js")`,
   render the result card canvas (`buildShareCardModel` from `masks`+`score`+username, then
   `renderShareCard(model, cols)`), and inject it into `.wp-cta` as the shown-off result. The
   page's existing `<a class="wp-play" href="/">Play today's Wordul →</a>` is the play link;
   point it at `/daily/<today>` for precision. Add a link-first "Share" action
   (`navigator.share({ text, url: ${origin}/daily/<today> })`, clipboard fallback).

Dynamic `import()` is legal in a classic script, so no `type="module"` conversion and no 2315-page
regen. The imports load only on a my-solved-daily page.

## Data flow

`wr.dailySolve:<date>` (written by `captureDailySolve`/`daily-recover.js` at solve time:
`{won, guesses, words[], grid[]}`) → `dailyShareModel` → `buildShareCardModel`/`renderShareCard`
→ canvas + `/daily/<date>` link. No server request, no spoiler surface (only the solver's own
browser holds the grid + answer).

## Error handling — fail open

Every new branch degrades to today's behavior:

- No `localStorage` / private mode / malformed JSON / not-yet-solved → generic CTA (wiki),
  unchanged card path minus the mint (app).
- Word mismatch (archived word, or I lost today) → `dailyShareModel` returns `null` → generic CTA.
- A daily with no `snap.word` simply never mints — that is the fix, not a failure.
- Dynamic `import()` rejection → caught; fall back to generic CTA.

## Testing

New `test/daily-share-core.test.js` (vitest, pure):

- A winning solve whose all-green word === `pageWord` → model with `score "G/MAX"`, `cols` =
  word length, `masks` length = guesses, **no `/c/`** anywhere.
- `decodeGridToMasks(["ggggg","yxxxx"])` → correct `hot/warm/cold` arrays.
- `max` denominator: 5-letter → `/6`, 7-letter → `/8`, 12-letter → `/8` (clamp).
- Word mismatch → `null`. Malformed / empty `raw` → `null`. Loss (no all-green row) → `null`.
- Guard the regression: assert `dailyShareModel` output (and the documented daily branch) never
  yields a `/c/` URL.

Existing `test/share-card.test.js` stays green (renderer untouched).

## Out of scope

- No change to the PvP/arena/room challenge flow (non-daily words keep "Challenge a friend →").
- No `share-card.js` renderer change (CTA label unchanged).
- No conversion of word pages to ES modules.
