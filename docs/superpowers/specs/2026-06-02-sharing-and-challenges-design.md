# Sharing & Challenges — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Author:** Yan + Claude

## Goal

Make sharing Wordul a first-class, viral loop from day one. Two outcomes:

1. **Challenge links** — finishing a game mints a server-stored challenge. A friend who taps the link plays the **exact same word** as a solo board and races your **standing record**. Works any time (async), and every finish can spawn a new challenge → a viral chain.
2. **Frictionless share UX** — a polished, on-brand result card (no spoilers) and a desktop share flow that doesn't feel awkward (visible URL + explicit Copy + Share, not "click share, click copy, paste").

## Non-Goals

- Real authentication / account ownership of challenges (identity stays the existing username "kindness model").
- Global cross-challenge leaderboards (each challenge has its own standing record; a global board is future work).
- Changing the live multiplayer race flow (unchanged; challenges are a new solo-seeded path).

## Core Insight

A **challenge is a solo room pre-seeded with a pinned word** instead of a random one. This reuses the entire existing room engine: server-side color masking (the answer never reaches the client until the game ends), gold economy, companion, and replay capture. Only two genuinely new pieces are added: storage for the challenge + its standing record, and a seam to seed a room's word from a challenge id.

## Components

### 1. `Challenge` Durable Object (new — server)

- **Key:** short base62 id (~5 chars, e.g. `x7gk2`), generated on mint with a collision check.
- **Stored state** (KV-style `ctx.storage`, modeled on the `User` DO):
  - `id`, `word`, `wordLength`, `owner` (username), `ownerScore` (e.g. `3/6` or `X/6`), `ownerGrid` (array of color masks for the share card), `createdAt`.
  - `attempts[]` — append-only: `{ username, score, solved, guesses, at }`.
  - `record` — cached best attempt (fewest guesses among `solved`), recomputed on append.
- **Free-plan requirement:** new DO namespaces must be SQLite-backed → add a `wrangler.jsonc` migration tag with `"new_sqlite_classes": ["Challenge"]` and a `CHALLENGE` binding. (Past incident 10097: dry-run won't catch a missing sqlite class; only a real deploy does — verify post-deploy.)

### 2. Worker routes (`worker.ts`)

- `POST /api/challenge` — body `{ word, wordLength, owner, ownerScore, ownerGrid }` → mints a Challenge DO, returns `{ id }`.
- `GET /api/challenge/:id/meta` — returns `{ owner, ownerScore, record, wordLength }`. **Never returns `word`** (no spoiler; the seeded room holds the word server-side).
- `POST /api/challenge/:id/attempt` — body `{ username, score, solved, guesses }` → appends an attempt, returns the updated `record`. (Called by the room on finish, or by the client end-screen.)
- `GET /c/:id` — serves the SPA (client routes on the path).

### 3. Room seeding (`room.ts` — small change)

- The race-start word pick (`room.ts:377`, `pool.answers[random]`) becomes: **if the room was opened/started with a `challengeId`, fetch the pinned word from the Challenge DO; else random as today.**
- Everything downstream is unchanged — the word still never serializes to the client before finish.
- On finish, the room reports the player's attempt to the Challenge DO (`POST .../attempt`). (If routing the report through the room is awkward, the client end-screen can post the attempt instead — decide at plan time; either keeps the answer server-authoritative.)

### 4. `/c/:id` client route (`app.js`)

- Detect the `/c/:id` path on load → fetch `/api/challenge/:id/meta` → open a **solo board seeded with `challengeId`**.
- **Pre-game banner:** "@yan solved this in 3/6 — beat it." (or "@yan got stumped — can you solve it?").
- **End screen:** "You got 4/6. Standing record: @yan 3/6" + a **Share your own challenge** button (the chain).

## Share Card (`renderResultCanvas` — client restyle)

The current card is off-brand (`WORDLE ● RACE`, NYT green/gray) and **spoils the answer** — fatal for a replay share. Changes:

- **Rebrand:** `WORDUL` wordmark in the ultraviolet-chrome + gold palette; brand accent on chrome + CTA. Tiles keep green/yellow/gray (they are the score).
- **Add the player's name:** `@yan` — it's their gauntlet.
- **A Wordul phrase:** one rotating line that doubles as positioning, e.g. "Free. No ads. Just the word." / "Your move."
- **No spoiler:** show the **color grid only** (🟩🟨⬜ pattern) — **never** the answer letters or "The word: …". The pattern is the brag.
- **CTA:** "Beat my score →" + the short challenge URL (`wordul.com/c/x7gk2`).

## Desktop Share UX

- **Shared share row** (lobby invite + end-game modal): a visible **short URL field** + a **Copy** button (→ "✓ Copied") + a **Share** button (native sheet where `navigator.share` exists).
- **Mobile:** unchanged — one-tap native share of card + link.
- **Desktop result share:** show the **card preview inline** with explicit **Copy link** / **Save image** buttons, replacing today's silent image download.

## Build Order

- **Phase 1 — Challenge engine:** Challenge DO + wrangler migration/binding, worker routes, room word-seeding, `/c/:id` route, standing record on the end screen. This is the mechanic; ship + dogfood.
- **Phase 2 — Share surfaces:** card restyle (brand + name + phrase + no-spoiler + challenge link), desktop share UX.

## Testing

- **Unit (vitest):** base62 id gen + collision retry; record recomputation (best-of attempts, solved-only, ties broken by fewest guesses); challenge-meta serializer omits `word`.
- **Server:** room seeded with a `challengeId` uses the pinned word, not random; attempt append updates the record.
- **Manual / smoke:** finish a game → get a `/c/:id` link → open in a fresh session → same word, banner shows score-to-beat → finish → standing record updates; card image has no answer letters.

## Risks / Watch-items

- **Free-plan SQLite DO (10097):** verify the new namespace applied on the real deploy, not just dry-run.
- **Answer leakage:** the meta endpoint and the share card must never expose the word. Covered by a unit test on the serializer + a manual card check.
- **Shared Worker / colony:** build in a git worktree to avoid the shared-checkout hazard while other sessions may deploy.
