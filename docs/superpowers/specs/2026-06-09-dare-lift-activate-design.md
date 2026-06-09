# Dare — lift out & activate (daily finish + home recap)

**Date:** 2026-06-09
**Branch:** `dare-lift`
**Status:** Design approved (visual ritual), spec for review
**Design artifacts:** `~/.gstack/projects/goldenfocus-wordul/designs/dare-lift-20260609/` (`dare-final.html` = approved blend, `design-board.html` = the 3-up A/B/C exploration)

## Problem

Players finish the daily and don't notice they can share / challenge a friend.
Several have literally told Yan "you should add a share button" — but the button
already exists. It's the golden `◆ Dare ◆` pill (`#dailyShareBtn`), tucked as the
first child *inside* the glass card (`#dailyUnlock`), where it reads as a card
header and gets skimmed past. The share affordance isn't missing; it's invisible.

This is a discoverability + placement fix, not a new feature. No new economy:
the caption will **not** promise gold (nothing mints on share today, so we don't
write a check we can't cash).

## Goal

Make the existing Dare/share prompt impossible to miss, on both surfaces where a
finished daily lives:

1. **Daily finish screen** — lift the pill out of the card into the gap between
   the board and the card; keep it faded while the board replay is animating,
   then light it up the instant the last row lands.
2. **Home recap card** — the same activated pill follows the player home after
   completion, so the prompt isn't only on the finish screen.

## Approved visual direction ("blend A + B-glow")

Chosen from a 3-variant ritual (Seal Lifts / Struck Coin / Rising Dare).
Final = A's restraint with B's glow:

- **Placement:** pill floats in the board→card gap with generous breathing room
  (≈96px gap region, padding above and below). It sits clearly *above/outside*
  the glass card, on the dark page background — not as a card header.
- **Resting state (`armed`):** drained gold **outline**, no fill, ~70% opacity.
  This is how it looks while the board replay is still typing/flipping.
- **Activation (`lit`):** when the last board row lands, a 0.55s gold **fill
  sweep** (outline → full `--gold-grad`), settling into a calm, slightly
  stronger **glow breathe** (bloom ~22→36px). Borrowed from variant B's glow
  only — **no pulse-ring, no specular shine-sweep.**
- **Subline:** rises in just under the pill after the fill —
  **"Invite a friend to today's word"** (muted text, no gold promise).
- **Label unchanged:** still `◆ Dare ◆`. Same click behavior (spoiler-free share
  of this day's link + masked-board gift unfurl).

The home recap pill arrives **already lit** (steady glow, no breathe-from-armed
transition) — there is no board replay there to gate on.

## Components & where they live

| Concern | File | Change |
|---|---|---|
| Pill markup | `public/index.html` | Move `#dailyShareBtn` out of `#dailyUnlock` to a sibling immediately before the card (in the board→card gap). Add a subline element (`.daily-dare-sub`). |
| Pill styling + states | `public/style.css` | Restyle `.daily-dare` for the lifted/gap placement + spacing; add `.daily-dare.is-armed` (outline/faded) and `.daily-dare.is-lit` (fill + glow breathe) states; add `.daily-dare-sub`; reduced-motion fallback. |
| Replay completion hook | `public/board-replay.js` | Signal when the board replay finishes so the pill can light. `finishBoardReplay()` is the single completion point (fires on both natural end *and* tap-to-snap) — emit a `CustomEvent` (e.g. `daily-board-replay-done`) there. `autoPlayBoardOnce`/`playBoardReplay` should let the caller know whether a replay actually started (so the no-replay path can light immediately). |
| Arm/lit orchestration | `public/app.js` (`renderDailyUnlock` + the live-finish path) | Arm the pill (`is-armed`) when a replay will play, light it (`is-lit`) on the done event; light immediately when no replay runs. Wire the subline text via a locale key. |
| Home recap pill | `public/daily-card.js` | Render the activated `◆ Dare ◆` pill + subline under the mini board on the home recap card; same share action; arrives lit. |
| Copy | `public/locales/en.js` (+ siblings) | Add the subline key (e.g. `daily.dareSub` = "Invite a friend to today's word"). Note `t(key, fallback)` ignores arg 2 — the key must exist. |

## Activation logic (the one subtle part)

The pill's lit moment must align with whatever replay drives the *current* view.
There are three entry paths and the pill must end **lit** in all of them:

1. **Live finish** — `renderSettlement(...).then(() => replayMyDailyBoard(me))`.
   The board replays *after* the supernova. Pill starts `armed`, lights on the
   replay-done event.
2. **Cold render / return visit** — `autoPlayBoardOnce` plays the board once on
   load. Pill starts `armed`, lights on done.
3. **No replay** — `prefers-reduced-motion`, or replay already auto-played once
   this page load, or no grid/guesses. `playBoardReplay` no-ops; the pill must
   light **immediately** (no stuck-faded state). This is the critical edge case:
   never leave the pill armed if no replay will fire the done event.

Reduced motion: armed→lit is instant (no fill animation, no breathe) — pill is
just statically gold + soft glow.

## Open question for the plan (not blocking)

There is already a second share CTA — **"Challenge a friend"** inside
`.daily-bridge` lower in the card (`#dailyChallengeBtn` region). With the hero
Dare pill lifted out and lit, that lower CTA is likely redundant and risks two
competing share buttons. Recommendation: **demote or remove** the bridge
"Challenge a friend" CTA (keep the quiet Wiki · Recap · Past days · Home rail),
so there's one obvious share moment. Confirm during planning.

## Out of scope (YAGNI)

- No referral/earn-gold economy. No link attribution, no anti-abuse work.
- No change to the share payload, gift OG image, or `?g=` mechanics — the pill's
  click does exactly what it does today.
- No new label wording — stays `◆ Dare ◆`.

## Success criteria

- On the daily finish screen the Dare pill renders in the gap between board and
  card (not inside the card), with clear spacing.
- It is faded while the board replay animates and lights up (fill + glow) within
  a frame of the last row landing.
- In every entry path (live finish, cold revisit, reduced-motion, replay-already-
  played) the pill ends visibly lit — never stuck faded.
- The subline "Invite a friend to today's word" shows under the pill.
- The same lit pill + subline appears on the home recap card after completion.
- Click behavior is identical to today's Dare (spoiler-free day-link share).
- Reduced-motion users get a static lit pill with no animation.
- Existing tests stay green; new tests cover the arm→lit transitions and the
  no-replay-lights-immediately edge case.
