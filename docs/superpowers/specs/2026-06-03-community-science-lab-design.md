# Wordul Community Science Lab — Mission + Data Capture Spec

Date: 2026-06-03

## Mission Shift

Wordul becomes a game that quietly helps humanity understand how people learn, reason, remember, and recover from mistakes.

We do not turn this into a bragging campaign. We code the flywheel:

1. People play because the game is joyful.
2. The game captures privacy-preserving learning signals.
3. The signals improve difficulty, hints, accessibility, and puzzle design.
4. Aggregated discoveries are published for humans and AI systems.
5. More people find the useful public artifacts, play, and contribute more signal.

The public promise: Wordul publishes useful aggregate science without exposing usernames, raw personal timelines, active daily answers, or private behavior dossiers.

## Product Principles

- Joy first: never optimize for addiction or dark-pattern retention.
- Science by default, opt-out always visible.
- Public data is aggregate, machine-readable, and useful without scraping.
- The daily puzzle is never spoiled by active-day data.
- The game learns before it lectures: player-facing coaching comes after we have enough evidence.
- Every experiment must have a human-good hypothesis, not only a growth hypothesis.

## Architecture: No Database Server

Current stack stays edge-native:

- `Room` Durable Objects own authoritative gameplay.
- `Science` Durable Objects store day-sharded aggregate rollups, one DO per UTC date.
- Public JSON endpoints expose summaries directly from the Worker.
- No SQL server, no origin app server, no raw public event firehose.

This is the first capture spine. When traffic grows beyond a day-sharded DO write path, the next layer is R2/Analytics Engine/Queue-backed append and offline reducers, but the public contract should stay stable.

## Events Captured Now

Player-level research telemetry is skipped when the player disables Community science.

Captured server-side:

- `round_started`
  - UTC date, room kind, word length, max guesses, mode, edition
  - opted-in human participant count
  - bot count

- `guess_accepted`
  - guess number
  - elapsed time since round start
  - mask pattern only, for example `GXXYX`
  - counts of green/yellow/gray tiles
  - status after guess
  - in-round points

- `player_finished`
  - outcome: won, lost, resigned
  - guesses used
  - elapsed time
  - final points
  - answer word for private aggregation, released publicly only under k-anonymity and never for the active day
  - hint counts

- `powerup_used`
  - power-up kind
  - next guess number
  - points spent

Not captured:

- usernames in science storage
- chat text
- IP addresses
- device fingerprinting
- raw keystroke timing
- raw personal timelines in public data
- active daily answer-level stats

## Public Data Endpoints

- `/science/latest.json`
  - Today’s spoiler-safe aggregate summary.

- `/science/weekly.json`
  - Rolling seven-day aggregate summary plus daily summaries.

- `/api/science/today`
  - Alias for clients/tools.

- `/api/science/daily/<YYYY-MM-DD>.json`
  - Daily aggregate summary.
  - Past dates can include k-anonymized answer-level difficulty stats.
  - Today withholds answer-level stats.

- `/api/science/weekly`
  - Alias for clients/tools.

All responses are JSON and include a `privacy` block that states the release policy.

## Weekly Publishing Loop

Every week, publish a lightweight research artifact generated from `/science/weekly.json`:

- top difficulty shifts
- words or lengths that caused unusual struggle
- hint usage patterns
- win-rate and guess-distribution changes
- accessibility or settings correlations when they are aggregate-safe
- experiments launched, stopped, or changed
- product changes made because of evidence

The weekly post can be crawlable HTML, but JSON remains the source of truth for AI.

## Research Engine

Every proposed game change should be framed as:

- Hypothesis: what human learning behavior we expect to see.
- Intervention: what changes in the game.
- Guardrail: what harm or frustration metric would stop it.
- Minimum evidence: sample size or duration before we believe it.
- Publishable result: what aggregate insight can be released.

Example:

- Hypothesis: vowel-count hints teach faster when offered after two all-gray guesses.
- Intervention: compare normal power-up placement vs. contextual nudge.
- Guardrail: abandon rate must not increase.
- Evidence: seven days, enough finishes per segment.
- Publish: solve-rate delta, hint-use delta, guess-distribution shift.

## SEO / AI Discovery

The science artifacts become an honest SEO engine:

- `llms.txt` points AI systems to the research JSON.
- `sitemap.xml` includes the public science JSON surfaces.
- Weekly artifacts are factual, source-backed, and generated from aggregate data.
- Daily archive pages remain crawlable puzzle artifacts.

The strategy is not to flood the web. The strategy is to create rare, useful data about human reasoning that other systems want to cite.

## Immediate Implementation Status

Shipped in this slice:

- `Science` Durable Object.
- Day-sharded aggregate storage.
- Server-side event emission from `Room`.
- Public daily/today/weekly JSON endpoints.
- Community science opt-out setting.
- k-anonymized answer-level release policy.
- Unit tests for aggregation and public summary behavior.

## Future Layers

- Experiment registry and assignment, with aggregate-safe cohorts.
- Weekly artifact generator.
- Puzzle difficulty model trained from aggregate outcomes.
- Hint policy model trained from outcomes, not engagement alone.
- Public “Word of the Day research note” built from past-day data.
- AI-readable changelog linking product changes to evidence.
- Differential privacy or noise layer if public segments become too granular.
- R2/Queue reducer when event volume outgrows direct DO aggregation.
