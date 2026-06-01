# Gold Economy & Leaderboards (design)

Date: 2026-05-31
Status: approved direction (this session); server phases gated on Yan's go.

## Vision (locked)

Gold becomes the **universal score for every game** (not a mode — the core loop
for everyone). You start at **0**. Gold rains from the sky as you make progress
and bleeds out when you waste a move you should have known better than to make.
**Final gold = your score.** A room crowns two winners: **first to solve** and
**richest**. High scores are tracked **per-room and globally**. Every finished
game's guess-by-guess data is **captured now** so a chess.com-style **replay
viewer** can be built next.

Eventually gold may be worth real money — noted, **not built**.

## Locked decisions

| Fork | Decision |
|------|----------|
| Role of gold | **Core loop for everyone** — every game scored in gold |
| Economy | **Everything is gold** — earn on greens/yellows/solve/speed, lose on sloppy repeats |
| High scores | **Per-room + global together** |
| Replay | **Capture data now, build viewer next** |

## Decomposition (build phases)

Because making gold a *competitive, persisted* score crosses into Durable
Object / KV / snapshot-protocol territory (Sacred Stops in the repo rules), this
splits into one independent polish piece + four gold phases:

- **Phase 4a — Keyboard tune-up** *(independent, Tier-C, ships first)*. The only
  Phase-4 item with no gold coupling. See
  `2026-05-31-phase4-polish-personality-design.md` (now narrowed to the
  keyboard). Win celebration, phrases, and the dead-letter "jokes" all **fold
  into the gold loop below** (they now have stakes), so we don't build them twice.
- **P5.1 — Gold loop (client, Tier-C, solo-playable).**
- **P5.2 — Gold as competitive score (server, Sacred Stop).**
- **P5.3 — Global leaderboard (server, Sacred Stop).**
- **P5.4 — Replay capture (server, additive, low-risk).**

---

## P5.1 — Gold loop (client-first)

Solo-playable with gold still in `localStorage` (as today). No protocol change,
so it ships on its own. Files: `public/edition.js` (gold helpers + new economy
constants), `public/app.js` (earn/lose hooks, animations, HUD, magic power-up,
score), `public/celebrate.js` (extend with `newYellowsInLast`), `public/style.css`,
`public/editions/{default,yang,jackpot}.js` (cheeky banks), `public/index.html`
(magic power-up affordance; retire the two labeled power-up buttons + EZ row).

### Economy table ("everything is gold") — tunable constants

Start at **0**. Gold **can go negative** — see *Negative gold, bankruptcy & the
give-up explosion* below (Yan: "too many errors → you go −gold and explode").

| Event | Δ gold |
|-------|--------|
| New green discovered (vs prior guesses) | **+12** each |
| New yellow discovered | **+4** each |
| Solve | **+30** |
| Speed bonus on solve | **+10 × (maxGuesses − guessesUsed)** |
| Submit a guess containing a **known-dead** letter | **−8** per wasted letter (capped per guess) + cheeky line |
| Re-place a yellow in a slot already known wrong | **−8** + cheeky line |
| Power-up spend | reveal **−20**, vowel-count **−10** (existing costs; hidden from UI) |

"New" reuses the `celebrate.js` `newGreensInLast` pattern; add a
`newYellowsInLast` sibling. Waste detection reuses `deriveKnowledge(guesses)`
(factored from `checkHardMode`, defined in the Phase-4 spec §B1) — duplicate-
letter safe so we never wrongly penalize.

### Hooks
- **Earn:** in the accepted-guess path (`app.js` ~812-825, where
  `celebrateGreens` already fires), compute new greens/yellows → `earnGold` →
  `goldRain(amount)`. On solve (`handleGameOver` win branch 1513) add solve +
  speed bonus.
- **Lose:** on `submitGuess` (1315), derive knowledge from prior guesses; if the
  pending word reuses known-dead letters or known-wrong yellow slots, apply the
  penalty when the guess is accepted → `goldDrain(amount)` + a `gold_loss`
  companion line. (The free mid-type nudge still warns first; submitting anyway
  is what costs.)

### Sky-gold animation
- `goldRain(amount)`: gold coin/sparkle glyphs (◆ / 🪙, gold) fall from the top
  toward the balance HUD; the HUD counter **tweens** old→new. Reuse the
  `spawnConfetti` mechanism with coin glyphs + gold palette.
- `goldDrain(amount)`: coins fly out / HUD flashes and ticks **down**.
- Both gated by `reducedMotion` (then just tween the number, no particles).

### Balance HUD (redesigned, de-pilled)
- The existing `.gold-hud` becomes a prominent, **animated counter** shown during
  play. Small radius (~8px coin/chip — **not** the current `border-radius:999px`
  pill). `◆ <count>`.

### Self-revealing magic power-up (no price)
Replaces the two labeled buttons **and** the EZ-mode toggle (power-ups are core
now, available to everyone once afforded).
- A single subtle **magic icon** (✨ orb / wand) that is **hidden until** gold ≥
  the cheapest power-up. When affordable, it fades in near the board.
- Tapping opens a tiny popover of the power-ups you can **currently afford**,
  shown as icons only — **no price text**. Using one spends gold (the balance
  visibly dips — that's how you learn the cost).
- Server messages `reveal_letter` / `vowel_count` are unchanged; only the UI
  gateway changes.
- Retire the `EZ Mode` settings row (index.html 255-264) and the `ezMode`
  setting / `body.ez` class. *(Optional future: a "hide power-ups" purist toggle —
  not now; Yan chose core-for-everyone.)*

### Negative gold, bankruptcy & the give-up explosion

Errors don't just cost gold — pile up enough and it ends you. (Yan: "too many
errors you go −gold and explode", "maybe on hard mode", "same animation if you
give up; negative power-up appears kinda vibe when stuck too long / too many
errors".)

- **Gold can go negative.** A negative score is allowed — brutal and funny, and
  the on-ramp to bankruptcy.
- **Bankruptcy = explosion.** When gold falls below a threshold (e.g. **−30**,
  tunable), the game ends by **bankruptcy**, reusing the existing dramatic loss
  animation (`triggerLoseSequence`: red flash, tile-explode, shards, shake).
  **Gated to Hard Mode** (Yan's "maybe on hard mode" — Hard Mode finally gets
  real stakes). In normal mode gold may still dip negative but doesn't kill you.
- **Give up = same explosion.** A give-up action triggers the identical
  explosion in any mode.
- **Negative power-up (dark twin of the ✨ magic icon).** When you're *stuck* —
  long idle (reuse the `armIdle` timer) and/or too many errors — a 💀 "give up"
  affordance surfaces with a doom-y vibe, mirroring the magic icon. Tapping it =
  give up = explode. It only appears when you're struggling, so it reads as the
  game offering you the exit.
- **Finish reason.** Game-over carries a reason: `solved` / `lost` (out of
  guesses) / `bankrupt` / `gave_up`. All but `solved` share the explosion;
  `bankrupt` / `gave_up` are new client end-states (P5.1). The server (P5.2)
  records the reason for the scoreboard.

All client-side (the explosion already lives in `app.js`). Tunable: threshold,
hard-mode gating, the idle/error counts that summon the negative power-up.

### Gold = score (end screen)
- `openStats` shows **final gold as "Score"** prominently, alongside solved ✓ +
  guess count. Multiplayer adds the two crowns (P5.2).

### Cheeky lines
- Add `lines.gold_loss` (and optional `gold_gain` flair) per edition — this is
  where the "trying to game the system?" energy lives now, with real stakes.

---

## P5.2 — Gold as competitive score (server) — **Sacred Stop**

- **Server-authoritative gold.** The DO already scores guesses and handles
  power-up spends, so it can compute each player's gold deterministically from
  data it owns — no client trust, no cheating via `localStorage`. Client
  animates optimistically and **snaps to the snapshot value**.
- `src/types.ts`: add `gold: number` to the player state carried in
  `RoomSnapshot`.
- `src/room.ts`: compute/track per-player gold on each accepted guess, solve, and
  power-up spend; include in `snapshotFor`.
- `src/scoreboard.ts`: rank by gold; record **richest** at finish (alongside the
  existing first-to-solve winner).
- `finishGame`: include final gold + both crowns.
- **Blast radius:** changing `RoomSnapshot` ripples to every connected client and
  the DO's hibernation/serialized state. Treat as Tier-aware server work — Yan's
  go before touching.

## P5.3 — Global leaderboard (server) — **Sacred Stop**

- **Storage choice (to confirm):**
  - **A. KV top-N (recommended for v1):** maintain a top-100 JSON list under one
    `DIRECTORY` key (read-modify-write on finish). Zero migration, ships fast;
    eventual-consistency means a rare lost update on concurrent ties — acceptable
    for a leaderboard.
  - **B. Global `Leaderboard` DO:** a single instance (`idFromName("global")`)
    holding a sorted top-N. Atomic and clean, but a **new DO namespace = a
    migration** — and per the free-plan rule it must be `new_sqlite_classes`
    (see memory `cloudflare-free-plan-do-sqlite`). Bigger Sacred Stop.
- **Dimension (v1):** all-time global **top-100 by gold**. (Daily / per-word-
  length are easy follow-ons — tunable.)
- On finish, submit the player's final gold to the global store.
- **Home page leaderboard view** — global top + "your rank". Dovetails with the
  existing memory direction (a real home/landing page).

## P5.4 — Replay capture (server, additive — low risk)

Capture immediately so no game is lost; viewer is the next push.
- `src/types.ts`: `GuessRow` already `{word, mask}`; add optional `t?` (timestamp)
  and `g?` (gold delta) per guess.
- `src/records.ts`: `GameRecord` currently stores guess **count**; add
  `guessSequence: GuessRow[]`; `buildGameRecords` passes `p.guesses` through.
- `src/room.ts` `finishGame`: source the in-memory guess arrays.
- `src/user.ts` `/append`: additive, backward-compatible; profile `games[]`
  already returned.
- **Backward compat:** old records lack `guessSequence` → the (future) replay
  button stays hidden for them.
- **Viewer (deferred):** hydrate a synthetic snapshot and drive
  `renderBoards` / `scheduleReveal` frame-by-frame with chess.com-style
  ◀ ▶ / play controls.

---

## Playtest additions (live, 2026-05-31) — Yan found the loop addictive on first play

- **Combo multipliers** — multiple discoveries in ONE guess pay a bonus (2→1.5×,
  3→2×, 4→2.5×, 5→3×) with an ascending arpeggio + "✦ N× COMBO" toast.
  **SHIPPED** in the gold-flows build.
- **Speed bonus** — fewer guesses on solve = more gold. **SHIPPED.**
- **Expensive gold** — a letter reveal costs **1000** (a real splurge); vowel
  count **150**; you start at **0**. **SHIPPED.** This scarcity is what made Yan
  *want to buy more gold* — the craving is the product working.
- **Meaning-hint power-ups (the "logical to spend" engine)** — instead of only
  revealing letters, offer cheaper hints about the *meaning* of the word:
  situational / temporal / spiritual / definitional nudges. **Generated by Claude
  on the server** (the DO holds the answer; ask Claude for a clue, cache per
  word) — on-brand, infinitely scalable. Cheap frequent meaning-hints + the rare
  1000-gold letter splurge = a spend spectrum that always has something worth
  buying. NEEDS server + Claude API key (Golden Cloud). **Future (P5.2+).**
- **"Learn the word" after every game (the *becoming smarter* pillar)** — win or
  lose, teach the word memorably (etymology/meaning/mnemonic), with a "dig
  deeper" link that opens a web search (word + a related term for relevance),
  plus randomness. LLM-powered. **Future (P5.2+).**
- **Announcer flavor** — e.g. *"Our contender has left the ring, ladies and
  gentlemen."* for the give-up / bankruptcy moment (casino-announcer voice). Goes
  in the cheeky banks (P5.1b).
- **Mute button** — companion voice + chimes already honored `wordul.muted`; the
  topbar toggle is now wired. **SHIPPED.**

## Recommended sequencing

1. **Phase 4a — keyboard tune-up** (independent, pre-approved) → ship now.
2. **P5.1 — gold loop** (client, Tier-C) → ship; solo-playable.
3. **P5.2 + P5.4** (server) → gold-in-snapshot + per-room crowns + replay
   capture. *Yan's go.*
4. **P5.3** (server) → global leaderboard + home view. *Yan's go* (incl. KV-vs-DO
   choice).

## Open tuning (sensible defaults now, refine in play)
Exact gold values; leaderboard dimension (all-time vs daily vs per-length);
global storage A vs B; whether to keep a purist "no power-ups" toggle.

## Risks
- Client/server gold divergence → server authoritative; client reconciles to
  snapshot.
- Snapshot-shape change breaks hibernation/all clients → careful additive field +
  test.
- New DO (option B) → migration Sacred Stop + free-plan SQLite gotcha.
- Over-penalizing → bankruptcy threshold + hard-mode gating keep the death
  rare; duplicate-letter-safe waste detection avoids unfair hits; gentle values,
  tune in play.
- Negative gold UX → make the balance + the danger (approaching bankruptcy)
  legible so the explosion never feels random.
