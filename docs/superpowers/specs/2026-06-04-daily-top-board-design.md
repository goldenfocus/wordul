# Post-play home — your result + "Today's Top"

> **Status:** design / blessed 2026-06-04
> **Branch:** `daily-top-board` (worktree off `origin/main`)

## Why

After you finish the Wordul of the Day, the home should *change*: it should celebrate
your own result (with the gold you won) and show the day's leaderboard — the top 3 by
gold, plus your own standing — with every name linking to its profile.

Today the post-play recap (`public/daily-card.js`) only says `Solved in N` + a countdown
+ Share/Stats. Everything the leaderboard needs is **already minted and stored** — it just
isn't read back or shown.

## What already exists (no new write path needed)

- **Gold is minted per daily solve** in `Room.scorePlayer` (`src/room.ts`):
  `gold = goldFromPoints(player.points) + DAILY_GOLD_BONUS`, written to the player's
  USER-DO ledger (`reason: "mint:daily"`). `player.goldAwarded` is stored on the player
  once the ledger write is confirmed. Gold already compounds discoveries, combos, the
  solve bonus, and the speed bonus (`speedPerGuessLeft × guessesLeft`) — so ranking by
  gold already bakes in speed + cleverness.
- **Every player of today's word lives in ONE daily ROOM DO** (`idFromName("daily/<date>")`).
  Daily has no `MAX_PLAYERS` cap and players are **never removed** on disconnect (only
  `connected = false`), so `state.players[]` is the authoritative per-day record of
  `{ username, guesses, status, goldAwarded }`.
- **Profiles** are public at `/@<username>` (route `PROFILE_RE` in `src/worker.ts`).
- The home post-play recap already derives `dailyResult = { won, guesses }` from the
  profile via `dailyResultFor(profile)` in `public/app.js`.

## Architectural decision: read the leaderboard live from the daily ROOM DO

The daily ROOM DO already holds every player's gold + guesses. We add a **read-only**
endpoint that sorts the top N and finds the caller's rank. No new storage, no second
write path to keep consistent with the gold mint.

Rejected alternative: a dedicated daily-leaderboard DO that each solve writes to. More
scalable at huge volume, but it duplicates state that already exists and adds a second
write path that must stay consistent with the mint. Not worth it yet (see Scaling).

---

## Increment 1 — leaderboard + your rank + gold in recap (core)

### Server

**`src/leaderboard-core.ts`** — new pure, dependency-free, unit-tested module.

```ts
export type LeaderEntry = { username: string; gold: number; guesses: number; won: boolean };
export type LeaderboardView = {
  top: LeaderEntry[];                       // top N by gold desc, then fewer guesses
  you: (LeaderEntry & { rank: number }) | null; // caller's row + 1-based rank, ONLY when outside top N
  total: number;                            // count of ranked (scored) players
};

// players: the daily Room's state.players; only "scored" players (goldAwarded != null,
// i.e. a confirmed mint) are ranked. Bots are excluded.
export function topDaily(players, username, n): LeaderboardView
```

- **Ranking:** gold desc, tie-break fewer guesses asc, final tie-break username asc (stable
  + deterministic for tests).
- **Eligibility:** a player is ranked iff `goldAwarded != null` and `!isBot`. (Mint
  confirmed ⇒ they finished and their gold is real.) Won *and* lost finishers are ranked
  by gold; in practice solvers dominate the podium because of the solve + speed bonus.
- **`you`:** populated only when the caller is found and their rank `> n`. If the caller is
  in the top N (or hasn't a scored row), `you` is `null` (the client highlights their medal
  row instead — see Client).
- `rank` is 1-based over the full ranked list.

**`Room` DO** (`src/room.ts`) gains a non-websocket branch in `fetch`:

```
GET /leaderboard?username=<u>&n=3  → Response.json(topDaily(this.state.players, u, n))
```

`n` defaults to 3, clamped to e.g. [1, 10].

**Worker route** (`src/worker.ts`), added before the SPA fallback:

```
GET /api/daily/<YYYY-MM-DD>/leaderboard?username=<u>
   → ROOM.idFromName("daily/<date>").fetch("https://do/leaderboard?username=...&n=3")
```

Username is normalized with the existing `normalizeUsername`. Date validated by regex.

### Client

**`public/daily-card.js`** — the **post-play recap** state (`result != null`) grows a
`TODAY'S TOP` section between the result line and the countdown:

```
Solved in 3  ·  +540 gold

TODAY'S TOP
─────────────────────────────
🥇 @wiggly-ocelot    1,240g · in 2
🥈 @fluffy-pangolin  1,090g · in 3
🥉 @clever-otter       980g · in 3
·····························
#12  you (@brave-lynx)  540g · in 4      ← pinned row, only when outside top 3
```

- Each medal row: `@name` is an `<a href="/@name">` (client-router navigates, no reload).
- If **you are** in the top 3, your medal row is highlighted (class `is-you`) and no
  pinned row is shown. If you are outside, the pinned row is shown and celebrated — never
  hidden ("we celebrate you anyways").
- Gold formatted with `toLocaleString()` and a trailing `g`. Guesses shown as `in N`.
- The section renders only in the post-play state, so it never spoilers a non-player.

**`public/app.js`**

- New callback `cbs.fetchLeaderboard = (username) =>
  fetch("/api/daily/<today>/leaderboard?username=" + …).then(...)` — best-effort, mirrors
  the existing `fetchPlayed`. On failure or empty board the section just hides; the recap
  still renders.
- The recap's `+N gold` comes from the leaderboard response's `you.gold` (when pinned) or
  the matching medal entry (when you're in the top 3) — **no extra request**.
- `dailyResultFor` stays the source of `{ won, guesses }`; gold + rank are merged in from
  the leaderboard fetch.

### Error handling / edge cases

- **Fetch fails / DO unreachable:** hide the `TODAY'S TOP` section; recap unaffected.
- **Empty board (you're the first finisher):** if `total <= 1` and only you, show a single
  celebratory row for yourself (no medals-of-others). Never a fake number.
- **You're rank 1–3:** highlight your medal row, no pinned row.
- **Ties:** fewer guesses wins, then username — deterministic.
- **Not played yet:** no recap, no leaderboard (unchanged behavior).

### Tests

`test/leaderboard-core.test.ts` (vitest), covering `topDaily`:
- sort by gold desc, tie-break fewer guesses, then username;
- you-in-top-N ⇒ `you === null`;
- you-outside-top-N ⇒ pinned with correct 1-based rank;
- bots and un-scored players excluded;
- empty / single-player boards;
- `total` counts only ranked players.

---

## Increment 2 — expandable "where gold was won / lost"

Needs **new data**: the profile `GameRecord` stores the guess *count*, not the per-guess
masks, so a gold breakdown cannot be recomputed later on the home. We compute it once at
scoring time (where the masks exist) and store a compact breakdown.

### Server

- **`src/economy.ts`** gains `pointsBreakdown(guesses, maxGuesses)` returning ordered line
  items: `{ label, points }[]` — discoveries (greens/yellows incl. combo), solve bonus,
  speed bonus (`speedPerGuessLeft × guessesLeft`), wasted-dead-letter penalties. `pointsEarned`
  refactors to **sum `pointsBreakdown`** so the breakdown can never drift from the total.
- The daily `GameRecord` (`src/records.ts`) gains an optional compact `goldBreakdown`
  field, populated in `Room.scorePlayer` (which has the masks + the `DAILY_GOLD_BONUS`).

### Client

- The recap line gets an expandable `<details>` ("where your gold came from") listing each
  `+`/`−` line. Surfaces on the profile for free wherever daily records render.

### Tests

- `pointsBreakdown` line items sum to `pointsEarned` for representative guess sequences
  (win in 1, win with combos, loss with penalties, etc.).

**Ship Increment 1 first** — it is the screenshot. Increment 2 is independent and additive.

---

## Scaling notes (not blocking)

- `topDaily` sorts `state.players` on each GET — O(n log n). Fine for now. If a single
  day's player count grows large enough to matter, precompute a maintained top-N (and the
  caller's rank via a cheaper structure) on mint instead of sorting on read.
- The daily ROOM DO already accumulates and broadcasts the full `state.players` array on
  every change — a pre-existing architecture characteristic, **out of scope** here. The new
  endpoint adds only a read + sort, no extra broadcast.

## Privacy

- Usernames shown are already public (profiles, the per-room scoreboard). The board renders
  only in the post-play recap, so it is never a spoiler surface. No new opt-out added; if a
  "hide me from leaderboards" toggle is wanted later it's a separate, additive change.

## Out of scope

- DUEL / ARENA leaderboards (this is the daily word only).
- All-time / weekly global leaderboards.
- Any change to the gold mint amounts or the points formula.

## Deploy / multi-agent

Built in the `daily-top-board` worktree off `origin/main`; shipped via `dev/ship.sh`
(tests → rebase → backup tag → merge → CI deploys `origin/main`). No hand-deploy.
