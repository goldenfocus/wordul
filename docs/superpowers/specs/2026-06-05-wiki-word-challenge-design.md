# Wiki word challenge — canonical per-word leaderboard + dual replay

**Date:** 2026-06-05 · **Approved:** Yan ("go")

## Principle (locked in conversation)

**Nobody scores the same word twice.** A word's wiki page spoils its answer by design, so
the page is a *trophy room*, never a door into a scored attempt. Replays live as ghosts;
the leaderboard counts each player's FIRST scored run only.

## What ships

1. **Canonical per-word challenge.** Each answer word gets one well-known Challenge DO,
   reachable via a deterministic, *opaque* 5-char id (SHA-256 of `word:<WORD>` → base62;
   the word itself never appears in the URL — `/c/OCEAN` would be a spoiler).
   `GET /api/word/<word>/challenge` validates `isWordPage`, lazily mints
   (`owner:"wordul"` — a reserved name, `kind:"word"`, empty grid/score), returns
   `{ id, record, attempts }`.
2. **One-shot attempts.** Challenge DO `/attempt` keeps only the FIRST attempt per
   username; repeats return the standing record unchanged (`repeat: true`). Applies to
   all challenges — this is the integrity rule that makes "beat my 3/6" real.
3. **Dual replay via `?vs=<username>`.** `GET /api/challenge/<id>/ghosts?vs=<u>`:
   if the DO has no filed tape, the worker looks up `<u>`'s stored game for the
   challenge word (User DO games keep `word` + `solveGrid` privately), re-cuts the
   colors-only grid into a cadence-paced ghost tape, and returns it. Masks only —
   letters never leave the server. Best win is chosen (fewest guesses), else most
   recent run.
4. **Wiki CTA.** `word-page.js` appends "Challenge a friend →" to `.wp-cta`; tapping it
   shares `/c/<id>` (+`?vs=<my username>` when one is stored) link-first
   (consistent with the new share). The stats panel gains the record line when one exists.
5. **Client `/c/` view.** `showChallenge` passes `vs` through to the ghosts fetch; word
   challenges (`kind:"word"`) get their own naming/toast copy (no "@wordul is racing…").

## Out of scope (phase 2 notes)

- Auto-seeding the leaderboard from past daily runs (your June 3 daily *was* your
  attempt) — needs a backfill pass per word; the one-shot gate already prevents
  double-scoring going forward.
- Pre-play "you already played this word" detection on the /c/ page.
- Per-word leaderboard page (top N list) — meta exposes the record only for now.

## Anti-cheat honesty

Social-level integrity only (no money path). A determined cheater can rename or read
the wiki first; honest players get an honest game. The daily's anti-scrape rules are
untouched: ghosts/meta never carry letters, and `game-for-word` returns colors only.
