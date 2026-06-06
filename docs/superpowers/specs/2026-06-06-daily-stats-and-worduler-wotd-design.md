# Daily stats truth + wordulers play the WOTD — design

**Date:** 2026-06-06 · **Status:** approved direction, spec under review

## Why

The `/daily/<date>/stats` page mixes two unrelated pipelines and the numbers disagree
(screenshot, Jun 6: "2 PLAYED" over a 4-player roster and a distribution summing to 5):

- Tiles + guess distribution come from `/api/science/daily/<date>` — the Science DO is
  **day-sharded, not mode-sharded** (`science-object.ts`), so casual rooms and challenges
  pollute "Today's Wordul" numbers. Worse, `played = totals.roundsStarted` counts **rounds,
  not people** — the shared daily room emits `round_started` exactly once per day
  (`room.ts` seed path), so 4 or 400 daily players still contribute 1.
- The Players roster comes from the `daily/<date>` Room DO leaderboard — daily-only,
  per-player, correct.

Product intent (Yan): the game should feel alive and popular while we test/discover/learn.
**Wordulers (bots) are beta testers, proof of concept, and tutorials at once** — they must
exercise the real join/guess/finish/leaderboard/replay paths daily, and their recorded
games double as how-to-play material. For now they look exactly like human players;
identifiers / a scientific split come later, so the data layer must carry the bot flag
even though no UI shows it.

## Slice 1 — stats page derives everything from the roster

Single source of truth: the daily Room DO's player state, which already holds per-player
`points` (score, server-authoritative — gold is *derived* from it via `goldFromPoints`).

- `leaderboard-core.ts`: add `score` to `RankablePlayer` / `LeaderEntry` (mapped from
  `player.points`). Room DO includes it in the roster payload.
- `public/daily-stats.js` (`computeDailyStatsView` is replaced by a roster-driven
  view-model): Played = roster length, Solved = wins/finished, Avg guesses among solves,
  Avg score = mean `score`, guess distribution from roster `guesses` of winners,
  "Failed today" = non-won rows. Tiles, bars, and the player list can never disagree again.
- The Science feed keeps powering `/feed` (the Lab) unchanged. It was never wrong — it was
  wrong *for this page*.
- Old dated stats pages heal automatically (roster data already exists per date).

## Slice 2 — wordulers play the word of the day

### Schedule: "their hour"

Each of the 7 personas (`bots.ts` PERSONAS) plays the daily once, at a deterministic
pseudo-random time per date: `hash(personaId + ":" + date) → hour (0–23) + minute`.
Stable per (bot, date), varies day to day — reads as a routine without building the
bot-studio. Pure function in `bots.ts` (or sibling), unit-tested, no `Math.random`
(hibernation/replay-safe).

### Trigger: hourly cron → room tick

- `wrangler.jsonc`: add an hourly cron trigger. Worker's `scheduled` handler POSTs
  `/bots/tick` to the `daily/<activeDate>` Room DO.
- The tick seeds the room if nobody has visited yet (cold-start: bots play at 3am even on
  a day no human has opened), then joins every persona whose scheduled time has passed and
  hasn't played, and lets the **existing alarm-driven bot heartbeat** (`nextGuessAt`,
  state on `this.state` — hibernation rule) play them at human pace via the solver.
  A pure DO alarm chain was rejected: the DO doesn't exist until first contact, so
  early-hour bots would silently slip — the schedule would lie.
- Real per-guess timestamps → honest `durationMs`, working ghost replay, and every human
  code path exercised daily. Bot-path failures log loudly (`console.error`) — they are the
  beta-test signal.

### Ranking & economy

- On finish, compute gold with the **same formula** as humans and set `player.goldAwarded`
  — but **no ledger write**. "Bots never mint" stays true; zero economy impact; the number
  exists only for ranking/display parity.
- `rankedEntries` drops its `!isBot` filter — bots rank inline by the same
  gold → guesses → name sort.
- `isBot` stays server-side and is stripped from every public payload
  (`projectPlayerForClient` cover rule holds; the roster payload must not leak it either).
  The future "+b" / scientific section is a UI flip, not a data migration.
- Science aggregates keep excluding bots for now (YAGNI) — the room state carries the
  split whenever we want it.

### Out of scope (later slices)

- Persona-differentiated solver skill (blurbs already hint at it: Maya misses the obvious,
  Remy speedruns) — daily board as a recurring cast.
- Weekday/weekend routine shaping, breaks, "do they work/study".
- Visible bot identifiers / separate scientific section on the board.
- Bot events in the Science feed.

## Testing

- Schedule hash: stable per (bot, date), spread across hours, all 7 distinct-enough.
- `leaderboard-core`: bots rank inline; `score` exposed; no `isBot` on output rows.
- Roster-driven stats view-model: tiles/distribution/failed from fixture rosters
  (win/loss/resign mixes).
- Tick idempotence: re-poking the same hour doesn't double-join a persona.
- Gauntlet as usual (incl. `check-input-zoom` guard — no input changes expected).

## Risks

- 7 bots vs few humans can dominate early boards — accepted for the "popular game" feel;
  revisit when identifiers land.
- Cron + CI: trigger config rides `wrangler.jsonc` through the normal CI deploy; verify
  the schedule appears on the worker after ship.
