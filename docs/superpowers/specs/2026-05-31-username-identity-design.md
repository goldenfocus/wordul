# Wordle Race — Layer 1: Username Identity & Profiles

**Date:** 2026-05-31
**Status:** Design approved, pending spec review
**Scope:** First of several layers. This layer adds persistent, server-side player identity and profile/stats pages. Gameplay-mode work (live/turn-based, timers, hints) is explicitly deferred.

---

## Context — where we are today

Wordle Race is a Cloudflare Worker + Durable Object app:

- `src/worker.ts` routes `/ws?code=<room>` to a `Room` Durable Object keyed by `idFromName(code)`; everything else is a static asset.
- `Room` (`src/room.ts`) holds all live game state, broadcasts snapshots over WebSocket, and persists to `ctx.storage`.
- Identity is ephemeral: a random `playerId` and a chosen `nickname`, both in `localStorage`. First connection to a room becomes host (`hostId = playerId`).
- Stats live only in `localStorage` — device-bound, lost on clear, invisible across devices.
- Rooms are disposable; nothing accumulates across games.

## Goal

Give every player a **persistent, server-side identity** — a username — that:

1. Works from **any device, anywhere**, by typing the username (no password).
2. Owns a **public profile page** at `/@username` showing lifetime stats and a history of every game played.
3. **Owns persistent, named rooms** at `/@username/<room>` that live across sessions — the room is the table, and it remembers.
4. Lets players **resume** a game across devices (same username = same player).

This is the foundation the later gameplay layers build on.

**The vision it serves:** a room is a persistent table for a group — like a board game on the shelf that you come back to next weekend. It keeps the running score, the chat, and the history so nobody has to remember who won. Identity + persistent rooms are the substrate; everything later (an in-room economy/"gold", socials, friends, premium) grows from "the room remembers." For now: just Yan and his kids.

## Non-goals (captured for later layers)

- Ready-up / 3-2-1 countdown synchronized start.
- Drop-in / rolling "open" mode (join mid-game), move timer.
- Hint / give-up / cancel / restart actions.
- GoldenVoice voice lines (cave / simple / advanced / hardcore tones).
- Registration, email/phone account recovery, friend invites.
- Per-room admin gating (control stays shared — "everyone who joins can drive").
- **In-room economy** — "gold" earned per win, "most gold wins" season standings, and whatever players choose to do with it (incl. their own monetization).
- **Socials** — friends, cross-room leaderboards, profiles you follow. *(Share/invite itself is in-scope this layer — see Discoverability.)*
- **Premium** — paid tiers once any of the above proves fun.

These remain future work. The substrate this layer builds — persistent identity + persistent owned rooms that remember — is what every one of them grows from. The framing we agreed on: *live and turn-based are the same game; one just adds a timer so a game can't stall forever.*

---

## Identity model

- **Username is the identity, stored server-side.** Typing `yan` on any device makes you `yan`. No password. This is a deliberate trust model — there is no money or private data at stake in a word-game leaderboard. If it ever gets popular, we add email/phone recovery as a *later* layer; the username key stays the same.
- **The cookie is a cache, not the identity.** First visit with no cookie → prompt for username → cache it. Returning on a known device → silent. "Switch user" clears the cache and re-prompts. The cookie can never be the source of truth, because device-bound storage cannot deliver "log in from anywhere."
- **Username rules:** lowercase; 3–20 chars; `a–z 0–9 - _`; normalized the same way room codes already are (`normalizeCode`-style: lowercase, strip disallowed, collapse/trim separators, clip length). One global `yan` — usernames are inherently unique because the username *is* the key.
- **No anonymous play in this layer.** You pick a username before you create or join. (Quick-anonymous can be a later convenience.)

---

## URL surfaces

| Route | Purpose | Change |
|-------|---------|--------|
| `/` | Home. First visit prompts username, then create/join. | Nickname prompt → username login |
| `/@<username>` | Public profile: lifetime stats, owned rooms, game history. | **New** |
| `/@<username>/<room>` | A game room owned by that user. | **Replaces `/r/<code>`** |
| `/api/user/<username>` | JSON read of a profile (feeds the profile page). | **New** |
| `/ws?room=<owner>/<slug>` | Room WebSocket. | Keyed by owner/slug; `hello` carries username |

The `@` sigil gives profiles and rooms a dedicated namespace — no collision with `/api`, `/ws`, static assets, or any future top-level route, and no reserved-word blocklist to maintain. **`/r/<code>` is retired** — every room now has an owner, so every room has a home under that owner.

**Room slug:** the owner names it (e.g. `friday-night`), or we auto-assign a tiny word-pair (reusing the existing generator) if they don't. Renameable anytime. Slugs only need to be unique *within* one user's namespace; collisions bump/append. Normalized like usernames.

---

## Data model — new `User` Durable Object

Keyed by `idFromName(username)`. One DO per person. Lazily created on first read or first game report (a never-seen username reads back as an empty profile, not a 404).

```ts
type UserProfile = {
  username: string;
  createdAt: number;
  stats: UserStats;
  games: GameRecord[];   // most-recent-first, capped (e.g. last 100)
};

type UserStats = {
  gamesPlayed: number;
  wins: number;
  // winRate is derived on read: wins / gamesPlayed
  currentStreak: number; // consecutive wins, reset to 0 on a loss
  bestStreak: number;
  guessDistribution: Record<number, number>; // winning-guess-count -> tally (1..8)
};

type GameRecord = {
  roomPath: string;        // "<owner>/<slug>" — links to /@owner/slug wherever the room lives
  finishedAt: number;
  wordLength: number;
  word: string;            // revealed at finish
  result: "won" | "lost";
  guesses: number;         // this player's guess count
  opponents: { username: string; result: "won" | "lost"; guesses: number }[];
};
```

The profile also tracks **owned rooms** — derivable from the user's own `roomPath` prefix, but stored as a small list `ownedRooms: { slug: string; name: string; lastPlayedAt: number }[]` so `/@yan` can render "Your rooms" without scanning.

The `User` DO exposes a tiny internal HTTP surface (called via stub `fetch`, not WebSocket):

- `GET /` → returns the `UserProfile` JSON (lazily initialized if empty).
- `POST /append` → body is one `GameRecord`; the DO appends it (capping the list) and folds it into `stats` (increment played, win/loss, streak math, distribution bump).

## `Room` Durable Object — changes

- **Keyed by `idFromName("<owner>/<slug>")`** — namespaces the room and encodes ownership in the address. The owner is the username in the path; no separate owner field to spoof.
- Add `name` (display name, renameable) and `ownerUsername` to the snapshot.
- **Per-room scoreboard** — a second scoreboard, distinct from per-user lifetime stats. Cumulative across every round played in this room:

```ts
type RoomScore = { username: string; wins: number; played: number };
// stored on the room: scoreboard: RoomScore[]
```

  On each round finish, bump the winner's `wins` and everyone's `played`. Shown in-room and in the room's own history. This is the "keep score across the night/weekend" feature — almost free, since the Room already persists across rounds. (Gold/economy is explicitly future.)

---

## Data flow

1. **Join.** Client `hello` carries `username` (replacing `nickname`). The Room keys players by **username** instead of `playerId`. Same username from a second device or tab maps to the *same* player → resume across devices. The WebSocket attachment stores `{ username }`.

2. **Ownership / host.** The room records the creator's username as its owner (for naming and future features). Control is **not** gated by it — anyone in the room can start / change length, per the agreed "everyone's admin" default.

3. **Finish reporting.** When a game finishes, the Room builds a personalized `GameRecord` for each participant (their own result + the others as `opponents`) and `POST`s it to that user's `User` DO via `env.USER.get(env.USER.idFromName(username))`. Stats roll up at write-time, so the profile page is a cheap single-DO read.

```
Room.finish()
  ├─ bump per-room scoreboard (winner.wins++, everyone.played++)
  └─ for each player p:
       record = { roomPath, word, wordLength, finishedAt,
                  result: p.result, guesses: p.guesses.length,
                  opponents: others.map(...) }
       USER.get(idFromName(p.username)).fetch("/append", { method:"POST", body: record })
```

`★ Both rooms and users are Durable Objects, so aggregation needs no database — the Room calls each User DO directly on finish.`

---

## Frontend changes (`public/app.js`, `index.html`, `style.css`)

- **Username login** replaces the nickname prompt: a single field on first visit, cached in cookie + `localStorage`; a "switch user" affordance clears it.
- **Profile page** rendered for `/@<username>`: fetch `GET /api/user/<username>`, render stats (games, wins, win-rate, current/best streak, guess-distribution bars) and **two lists** — *Your rooms* (owned, resumable, each linking to `/@you/<slug>`) and *Recent games* (history across all rooms, each linking to its `/@owner/<slug>`).
- **Room create/rename:** creating a room defaults to an auto word-pair slug under your namespace; an inline rename sets the display name. Shown in the room header.
- **Profile link** from home and from inside a room (your own `@handle`), plus the room's own scoreboard in the room view.
- **One-time stats import:** on first claim of a username, if device `localStorage` stats exist, fold them into the new server profile (guarded by a flag so it runs once). Veto-able; default ON so existing players don't lose history.

---

## Discoverability & Sharing (SEO / AEO / AIO / GEO)

Baked in now — URL structure + server-rendered meta + a global directory — so it's never retrofitted. **Everything is public and indexable.** Share + invite are core product surfaces.

**Per-route server-rendered meta (HTMLRewriter).** The Worker already fronts every request; rewrite `<head>` per route — no SSR framework:
- `/` — app name + tagline, default OG image, `WebApplication` + `FAQPage` JSON-LD.
- `/@user` — title like *"yan on Wordle Race — 42 wins, 7 streak"*, `ProfilePage`/`Person` JSON-LD with stats, canonical, OG.
- `/@user/<slug>` — title like *"Friday Night — a Wordle Race room by yan"*, canonical, OG.
- Each route: `<title>`, meta description, canonical, OG + Twitter card tags. Client also updates `document.title` per view.

**Global `DIRECTORY` (new KV binding).** Append `user:<username>` on first claim and `room:<owner>/<slug>` on creation. The keystone for "index everything" — DOs can't be enumerated, so without this a crawler/AI has no path to discover profiles or rooms. Also unlocks future public browse + global leaderboard.

**Crawler surfaces:**
- `sitemap.xml` — generated from the directory (home + every profile + every room).
- `robots.txt` — allow all, point to the sitemap.

**AI search (AIO / GEO / AEO):**
- `llms.txt` (concise) + `llms-full.txt` (fuller) — what Wordle Race is, how to play, the `/@user` and `/@user/<slug>` URL scheme, and the `/api/user/<name>` JSON endpoint so AI tools can cite stats.
- Profiles emit stats as JSON-LD (machine-readable, cite-worthy — "what's yan's win rate").
- Semantic HTML, direct-answer headings, an FAQ block (FAQPage schema) on home.

**Share / invite (core surface):**
- One-tap native share on room + profile with pre-filled copy; the OG card carries the room/profile identity so unfurls look great in iMessage/WhatsApp/Discord.
- Invite = share the `/@owner/<slug>` link; a new user landing there flows straight into pick-username → join.

**OG image:** a polished **static default** for v1. Dynamic per-room/profile cards (live scoreboard via `workers-og`/satori-wasm) are designed-for — later we swap the OG image URL to an `/og/...` route with zero markup change.

**Phased (not v1):** dynamic OG images; public browse / global leaderboard pages built on the directory.

## Wiring (`wrangler.jsonc` + `wrangler.v2.jsonc`)

- Add a `USER` Durable Object binding (`class_name: "User"`).
- Add a migration tag introducing `User` as a `new_sqlite_classes` entry (free plan requires SQLite-backed DO for new namespaces, matching how `Room` is set up in `wrangler.v2.jsonc`).
- Export `User` from `src/worker.ts` alongside `Room`.
- Add a `DIRECTORY` **KV** binding (global username/room registry for sitemap + future browse).
- New static assets in `public/`: `robots.txt`, `llms.txt`, `llms-full.txt`, default OG image.
- Worker routes: `/@<user>` and `/@<user>/<slug>` (HTMLRewriter meta + SPA), `/api/user/<name>`, `/sitemap.xml`.

---

## Error handling & edge cases

- **Username validation/normalization** at the boundary (client and `hello` handler), same defense-in-depth as today's nickname sanitizing. Reject < 3 chars after normalization.
- **Two devices, one username:** both sockets map to one player; guesses from either apply to the same board. Acceptable; last-write-wins on board state. Noted, not engineered around in this layer.
- **Finish-report failure:** the `POST /append` is best-effort and must not block the game from finishing. Wrap in try/catch, log to observability (do **not** silently swallow — emit a clear log line), optionally one retry. A dropped stat is tolerable; a stuck game is not.
- **Unknown profile:** `/@nobody` and `/api/user/nobody` return an empty-but-valid profile (gamesPlayed 0), not an error — friendlier and avoids leaking existence.
- **Import double-run:** guarded by a `localStorage` "imported" flag.
- **Privacy:** profiles are public by design (leaderboard vibe).

---

## Testing strategy (TDD where it pays off)

Write tests first for the pure/aggregation logic:

1. **Username normalization/validation** — valid, too-short, illegal chars, length clip, idempotence.
2. **`UserStats` aggregation** — a sequence of `GameRecord`s produces correct gamesPlayed, wins, win-rate, current vs best streak (incl. reset on loss), and guess-distribution tallies.
3. **History cap** — appends beyond the cap keep most-recent-first and drop the oldest.
4. **Room→User report shape** — finishing a game produces one correctly-personalized `GameRecord` per participant (own result + others as opponents).
5. **Per-room scoreboard** — across several rounds, the winner's `wins` and everyone's `played` tally correctly.
6. **Room slug** — normalization + within-namespace collision handling (bump/append).

Manual smoke after deploy: claim a username, play a game, see it on `/@username`; open `/@username` from a second device/incognito and confirm the same stats; resume a room from a second device.

---

## Locked decisions

- Username = server-side identity, no password, cookie is cache only.
- Profile URL = `/@username`. Profiles public. Import device stats on first claim.
- **Rooms nested under owner: `/@owner/<slug>`; `/r/<code>` retired.** Room slug is custom or auto word-pair, renameable.
- Room DO keyed by `idFromName("<owner>/<slug>")` — ownership encoded in the address.
- Players keyed by username (enables cross-device resume).
- **Two scoreboards:** per-user lifetime stats (profile) and per-room cumulative tally (room).
- New `User` Durable Object; rooms report results to it on finish.
- **Everything public + indexable.** Server-rendered per-route meta/OG via HTMLRewriter; global `DIRECTORY` KV powers `sitemap.xml`; `llms.txt`/JSON-LD for AI search; share/invite is a core surface. **Static default OG now**, dynamic cards phased.

## Build order

1. `User` DO + binding + migration + stats aggregation (TDD).
2. Worker routes (`/@user`, `/@user/<slug>`, `/api/user/`), retire `/r/`, room DO keyed by `owner/slug`.
3. `hello` carries username; players keyed by username; room `name`/`ownerUsername` + per-room scoreboard.
4. Room finish-reporting to `User` DO; `DIRECTORY` KV writes (username on claim, room on create).
5. Frontend: username login, room create/rename, profile page (two lists + stats), import, links, share/invite UX.
6. Discoverability: HTMLRewriter per-route meta/OG/canonical + JSON-LD, static default OG, `robots.txt` / `llms.txt` / `llms-full.txt`, `sitemap.xml` from the directory.
7. Smoke test, then ship (repo already exists — Wordle Race deploy guard satisfied).
