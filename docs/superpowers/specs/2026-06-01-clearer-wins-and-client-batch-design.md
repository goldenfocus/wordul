# Clearer Wins + Client Batch (design)

Date: 2026-06-01
Status: **approved** (Yan blessed the design, said "kick off the workflow").
Branch: `clearer-wins-batch`. Tier C (frontend) — ships to wordul.com after local verify.
Companions: `2026-05-31-gold-economy-leaderboards-design.md`,
`2026-06-01-immersive-ui-and-settings-design.md`.

## Scope (locked)

Everything here is **client / Tier-C**. The full on-deck client list **plus** the
new *clearer wins* feature. **Server phases stay gated on Yan's go** (per-room /
global leaderboards, the cross-device replay viewer, Claude meaning-hints,
learn-the-word). Do not touch the DO, migrations, `RoomSnapshot`, `records.ts`,
or `user.ts` in this batch.

## Locked decisions (from this session)

| Fork | Decision |
|------|----------|
| Workflow scope | Client list + clearer-wins now; server phases gated |
| Clearer-wins order | **Yellow → green → combo finale** (small→big, climactic) |
| Hacker-log home | **Transient terminal that types during payout, collapses to a 1-line ticker** |
| Replay persistence | **Capture client-side now** (structured, replay-ready); server persistence + viewer gated |
| Payout pacing | ~**0.45s** per beat, tunable; `reducedMotion` / a "fast payouts" setting → instant |
| Refactor | Yes — **split `app.js` along the seams this work touches** |

---

## A. Refactor — split `app.js` along the work's seams

`app.js` (~2195 lines) keeps the orchestrator role (websocket, snapshot→render
loop, game state, guess submit, `handleGameOver`). Native ESM, no bundler
(`"type":"module"` + `<script type="module" src="/app.js">`), so extraction is
`export` + `import` — zero build risk. Five cohesive modules peel off, **each one
a chunk being edited for a feature anyway** (not speculative):

| New module | Owns | Feature that drives it |
|---|---|---|
| `public/gold.js` | economy constants, combo, **payout sequence**, HUD, coin-rain, `animateCount`, penalties | round numbers, loss penalties, clearer-wins |
| `public/hacklog.js` | hacker terminal — typing, collapse-to-ticker, scrollback, replay capture *(new)* | clearer-wins log |
| `public/powerups.js` | reveal/vowel + ✨ magic icon + 💀 give-up/bankruptcy | hide-unaffordable, bankruptcy |
| `public/keyboard.js` | on-screen keys, layout, auto-detect, equal widths | equal-width keys, auto-detect |
| `public/settings.js` | settings panel + avatar-hub consolidation | settings reorg, immersive UI |

Rules: gold **storage** stays in `edition.js` (`getGold/addGold/spendGold`);
`gold.js` imports it. Extract **incrementally**, run `npm test` (65 tests) +
`npm run typecheck` after each extraction, behaviour must be **identical** before
any feature lands on top. Pure functions (payout planner, penalty calc,
discovery-ordering) get unit tests.

---

## B. Clearer wins — the new heart

### Mechanic
Today `app.js` (accepted-guess path, ~876–904) waits for all tiles to flip
(`flipDoneMs`), then fires **one lump** `awardGold(earned)` — a single coin
burst + one 650ms tween. That collapse is why wins are unreadable ("too fast").

Replace the lump with a **staged sequence**. **The total gold is identical** —
e.g. base 50+100+100 = 250, ×1.5 combo = 375 either way. Only the *presentation*
is sequenced. Clearer-wins introduces **no economy change** (round numbers /
penalties are separate items below).

- New pure fn in `celebrate.js` beside its siblings:
  `orderedDiscoveriesInLast(guesses)` → `[{index, kind:'yellow'|'green', letter,
  value}]`, **yellows first, then greens**, positional within each group.
  Duplicate-letter safe (same discipline as `newGreensInLast`). Unit-tested.
- `gold.js` `playPayoutSequence({discoveries, mult, ...})` walks the list on a
  **~0.45s beat** (const `PAYOUT_BEAT_MS`, tunable; `reducedMotion` or a "fast
  payouts" setting → instant award, no per-beat pauses). Per beat:
  - tile **glows** (gold ring pulse) · `+N` **floater** rises off that tile ·
    HUD **ticks up** by N (short tween) · **ascending chime** (arpeggio across
    the run) · **one log line types into the hacker terminal**.
  - **Finale beat** (≥2 discoveries): `✦ N× COMBO` — HUD jumps base→multiplied,
    the combo bonus lands last. Reuses existing `celebrateCombo` chime/feel.
- **Losses reuse the same machinery in reverse**: a wasted dead-letter drains
  gold with a red `> wasted  T  −50` line. Wins *and* losses become legible.

### The hacker-log (`hacklog.js`)
A terminal that fades in near the board during payout, types each line monospace
with a `>` prompt, then **collapses to a 1-line ticker** (`▸ +250 (CRANE)
[tap to expand]`). Pure during play (fits "make it pure"); expands on tap. Full
scrollback reachable via the avatar hub / end-screen. `reducedMotion` → no
typing (instant lines).

### Replay-ready capture (client now; server gated)
Each guess records a structured entry — `{guessIndex, events:[{kind, index,
letter, delta}], combo:{discoveries, mult, bonus}, balanceAfter}` — into game
state + `localStorage` keyed by game. **The end-screen shows the full log**
("your run, line by line"), so *"stays in the history for the replay"* is **real
now, client-side**. The cross-device, server-persisted viewer (P5.4) stays
Yan's-go — but the capture shape here is what it will persist, so no rework.

---

## C. On-deck client items (already approved — folded in)

All from the two companion specs; defaults below are **tunable**.

1. **Round numbers** — `GOLD`: green **100**, yellow **50**, solve **500**,
   speed **300 × guesses-left**, reveal **~4000**, vowel **~200**. Combos
   unchanged. Min increment ~100; displayed balance reads round.
2. **Loss penalties + escalation** (the "they don't lose enough" fix):
   - **Invalid / non-word submit → lose gold** (e.g. −50) + cheeky line. (Invalid
     guesses still don't burn a slot; the gold is the cost.)
   - **Reuse a known-dead letter in an accepted guess → lose gold per wasted
     letter** (e.g. −50 each, capped/guess). Derive known-dead/known-wrong from
     prior guesses (reuse/extract the hard-mode knowledge derivation;
     duplicate-letter safe so we never wrongly penalize).
   - **Repeat the SAME mistake → escalating penalty** — per-game `Map` of
     dead-letter → times reused; 2nd/3rd reuse costs progressively more.
   - All penalties flow through `gold.js` drain + a red `hacklog` line.
3. **✨ magic power-up (hide unaffordable)** — retire the two labeled
   reveal/vowel buttons **and** the EZ-mode toggle + `body.ez`. One subtle ✨
   icon, **hidden until** gold ≥ cheapest power-up; tap → popover of **currently
   affordable** power-ups, **icons only, no price** (you learn cost by watching
   the balance dip). Server messages `reveal_letter` / `vowel_count` unchanged —
   UI gateway only.
4. **💀 give-up / bankruptcy** — gold may go **negative**; past a threshold
   (rescaled to round numbers, e.g. **−300**, tunable) the game ends by
   **bankruptcy** → reuse `triggerLoseSequence` (red flash, tile-explode, shake).
   **Gated to Hard Mode** (Hard Mode finally has teeth). A 💀 affordance surfaces
   when **stuck** (idle via the existing idle timer / too many errors) → give-up
   = same explosion in **any** mode. Client finish reasons:
   `solved / lost / bankrupt / gave_up` (new client end-states; server records
   reason later, gated).
5. **Immersive UI** — in-game header = **avatar + username + gold (◆ N)** only.
   The **avatar is the hub** (settings, mute, stats, theme behind it — replaces
   scattered ⚙/📊/🔊). **Hide mid-play:** room name, ✎ edit/rename, Share ↗, and
   the scoreboard (still reachable via the hub / in lobby + finished states).
   Only ✨ and 💀 surface mid-play.
6. **Settings reorg** — collapsible **chevron sections** (calm on open); keyboard
   layout → "advanced", **auto-detect QWERTY/AZERTY** (browser/OS locale or first
   physical keystrokes). Less colour/noise.
7. **Equal-width keys** — CSS-grid keyboard (equal-fraction columns) or fixed key
   basis so **I** and **O** are pixel-identical (today: flex:1 + max-width
   sub-pixel drift).

---

## D. Build & ship

1. **Recon (parallel, read-only):** pin exact anchors + per-area edit-plans +
   risks. (Workflow phase A.)
2. **Implement (sequential backbone):** refactor extractions + features in
   dependency order; each step self-verifies (`npm test` + `npm run typecheck`,
   fix until green) before the next. (Phase B.)
3. **Adversarial review (parallel):** `code-reviewer`, `silent-failure-hunter`,
   a spec-completeness critic, a refactor-regression auditor (behaviour
   preserved? gold sum preserved? no double-award?). (Phase C.)
4. **Integrate & verify (main loop, Yan in the loop):** review the full diff, run
   the pre-push gauntlet, **Playwright browser-smoke** on `wrangler dev` (the
   payout sequence, the log, power-ups, immersive header, keyboard, settings),
   fix criticals, present a Post-Deploy Summary. **Ship on Yan's nod.**

## Open tuning (sensible defaults now, refine in play)
`PAYOUT_BEAT_MS`; exact gold values + penalty sizes + escalation curve;
bankruptcy threshold; idle/error counts that summon 💀; whether to keep a
"fast payouts" purist setting.

## Risks
- **Refactor regression** — extract incrementally, behaviour-identical, tests
  green after each. The regression auditor double-checks the gold sum is
  preserved and no payout is double-awarded.
- **Shared-file collisions** (`app.js` / `index.html` / `style.css`) — the
  implement backbone is **sequential**, not parallel, to avoid stomping.
- **Over-penalizing** — Hard-Mode-gated death + duplicate-letter-safe waste
  detection + gentle, tunable values keep it fair.
- **Pacing drag** — ~0.45s/beat slows the turn; `reducedMotion` / fast-payouts
  setting opts out; tune in play.
- **Immersive UI hides too much** — hidden chrome must stay reachable (avatar
  hub / lobby + finished states); don't orphan share/scoreboard.
