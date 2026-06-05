# De-Wordle rename — `green/yellow/gray` → `hot/warm/cold` (+ `wasted`→`bad`)

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Scope:** Terminology rename only. No palette change, no behavior change.

## Problem

wordul's match vocabulary still uses Wordle's words — `green` / `yellow` / `gray` — in
code, CSS, and one player-visible spot (the hacker-log payout line, e.g. `> green R pos 2`).
It "feels copyrighted." Notably the palette is ALREADY distinct (`--green` paints
ultraviolet `#9d8bff`, so the name is also a lie), and the player-facing how-to-play
already teaches **Hot / Warm / Cold**. So this is a vocabulary rename to make code + UI
speak one original language — not a repaint.

## Goals

- Rename the three tile states `green/yellow/gray` → **`hot/warm/cold`** across code, CSS
  (classes + custom properties), HTML, and the visible log line.
- Rename the wasted-reuse penalty `wasted` → **`bad`**, with an escalating label
  (`bad` · `bad bad` · `bad bad bad` …) mirroring the penalty that already climbs by reuse
  count.
- Add a ratchet test that prevents the old vocabulary from creeping back.
- Zero behavior change: identical scoring, identical pixels, identical persisted data.

## Non-goals

- No palette/color change (the ultraviolet/gold/gray palette stays — it's already
  non-Wordle).
- No change to the `g/y/x` persisted solve-grid encoding (see Migration).
- No new how-to-play copy beyond reflecting the existing Hot/Warm/Cold (optional: a one-line
  mention of "bad" if it reads naturally; not required).

## The vocabulary (wordul lexicon)

| New | Was | Meaning |
|---|---|---|
| **hot** | green | right letter, right spot (renders ultraviolet) |
| **warm** | yellow | right letter, wrong spot |
| **cold** | gray | not in the word |
| **bad** | wasted | re-typed a letter already proven cold — escalates `bad`→`bad bad`→… |

`hot/warm/cold` are tile states (the `Color` mask). `bad` is a different axis: a *penalty
event* for reusing a known-cold letter, not a fourth mask value.

## Approach (decided)

**Approach A — full rename, no compatibility shim.** The Cloudflare worker was recently
renamed, so there are no legacy clients or stored masks in flight — the only live concern
(the wire `mask` values crossing WebSocket snapshots) is moot. Rename the values outright;
no dual-accept transition code.

## Migration

**None required.** `encodeSolveGrid`'s `CELL` map (`src/records.ts:23`) becomes
`{ hot: "g", warm: "y", cold: "x" }` — persisted solve grids keep their `g/y/x` letters, so
existing stored records decode unchanged. The in-memory/wire `mask` values change from
`"green"…` to `"hot"…`, which is safe under Approach A (fresh worker, no old clients).

## What changes

1. **`src/color.ts`** — `export type Color = "hot" | "warm" | "cold";` and `scoreGuess`
   returns the new values (`"hot"`, `"warm"`, default-fill `"cold"`). Update `greenedPositions`
   and the EZ-mode helpers' `=== "green"` checks → `=== "hot"`.
2. **Server consumers** — `src/economy.ts`, `src/room.ts`, `src/noob.ts`, `src/science.ts`,
   `src/solver.ts`: every `mask[i] === "green"|"yellow"|"gray"` and discovery
   `kind: "green"|"yellow"` → `hot/warm`. `src/records.ts` `CELL` map keys.
3. **Client** — `public/celebrate.js`, `public/app.js`, `public/gold.js`: `d.kind` values,
   `.classList.contains("green")` → `"hot"`, the discovery `kind` literals, and the visible
   hacker-log line `> ${d.kind} …` now reads `> hot R pos 2`.
4. **Penalty vocab** — the wasted-letter line (`app.js`, the `penaltyLines.push("wasted …")`
   site) becomes `bad` with an escalating prefix: offense `n` (= `deadLetterReuse` count + 1)
   renders `"bad"` repeated `n` times — `bad E −50`, `bad bad E −100`, `bad bad bad E −150`…
   The penalty math is unchanged; only the label escalates to match.
5. **CSS** — `public/style.css`: `--green/--yellow/--gray` → `--hot/--warm/--cold` and every
   `var(--green)` ref; `.tile.green/.yellow/.gray` → `.tile.hot/.warm/.cold`; `.green-spark`
   and any other `green`-named class/keyframe.
6. **HTML** — `public/index.html`, `public/how-to-play.html`: `data-flip="green"` →
   `data-flip="hot"`, etc. (how-to-play already labels them Hot/Warm/Cold — just the
   `data-flip` attribute values change).
7. **Tests** — rename literals in `test/*` that assert `"green"/"yellow"/"gray"` or the
   `wasted` label.

## Ratchet (regression guard)

New `test/dewordle-vocab.test.ts` (modeled on `test/ios-input-zoom.test.ts`): greps `src/`
and `public/` and FAILS if any of these reappear —
- `"green"` / `"yellow"` / `"gray"` as a `Color`/mask value or discovery `kind`,
- `.tile.green` / `.tile.yellow` / `.tile.gray` CSS selectors,
- `--green` / `--yellow` / `--gray` custom properties,
- `wasted` as the penalty log word.

(Allow-list any incidental, unrelated uses — e.g. the word "cold" in "cold deep-link" — so
the guard targets the rebranded tokens, not English.)

## Testing

- `npm test` — full suite green; renamed assertions pass; the new ratchet passes.
- `npm run typecheck` — the rename is mechanical, so any missed `Color` reference surfaces as
  a `tsc` error (the union no longer has `"green"`). This is the primary safety net.
- `npm run check-graph` — no import/asset graph change expected.
- Manual: load a daily, confirm tiles paint identically (hot=ultraviolet, warm=gold,
  cold=gray), the hacker-log reads `hot/warm`, and a repeated dead-letter reuse logs
  `bad` → `bad bad` → `bad bad bad`.

## Build order

1. `src/color.ts` — flip the `Color` union; let `tsc` light up every consumer.
2. Chase the type errors across `src/` (economy, room, noob, science, solver, records).
3. Client JS (`celebrate.js`, `app.js`, `gold.js`) incl. the visible log line + `bad`
   escalation.
4. CSS + HTML (`--vars`, `.tile.*`, `data-flip`).
5. Rename test literals; add the ratchet; full gauntlet.
