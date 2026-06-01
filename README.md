# Wordul

**Race your friends on the same word.** No password, no signup — pick a username, share a link, go. First across the line wins. Loser gets an explosion. 💥

Live: **[wordul.com](https://wordul.com)**

```
   W O R D U L
   🟩🟩🟨⬛🟩
   same word · live race · friendly trash talk
```

## The vibe

It's Wordle, but everyone in the room is sweating the *same* secret word at the *same* time. You see the race heat up in real time, talk smack in the live chat, and rake in gold for every green you uncover. Solve fast and the coins literally rain from the sky. Choke, and you'll hear about it.

Built for couches, group chats, and the kind of friendship that survives losing a five-letter word by one guess.

## What's in the box

- **Same word, live race** — everyone in a room gets the identical puzzle, scored as it happens.
- **Passwordless identity** — pick a username, get a public profile at `/@you`. Type it again anywhere and you're you. No accounts, no email, no nonsense.
- **Share-a-link rooms** — `/@you/friday-night`. Send it, they're in.
- **Live chat + presence** — banter alongside the board, see who's still typing.
- **Gold economy** — earn on every green, yellow, and clutch solve; combo multipliers stack; spend it on power-ups. Go bankrupt in hard mode and the game ends in flames.
- **Power-ups** — reveal a letter, count the vowels, or hit the 💀 and rage-quit. Your call.
- **Editions** — reskin the whole game: `Wordul` (default), `Editorial`, `Yang's Table`, `Tactile`, `Arcade`, and a `Jackpot` mode that pays out.
- **Yang voice companion** — a cloned-voice color man who reacts to your run, prebaked to MP3 so it's instant at the edge.
- **Variable word length** — anywhere from 4 to 12 letters.
- **The works** — streaks, lifetime stats, color-blind mode, reduced-motion, i18n, on-screen keyboard with per-key hints.
- **A losing explosion** when you don't make it. You'll know.

## Tech stack

All edge, no origin server, no client build step.

- **Cloudflare Workers** — the whole app: serves static assets, routes WebSockets, renders meta.
- **Durable Objects** — two of them:
  - `ROOM` — one instance per room, the authoritative game state and WebSocket fan-out. Rooms are content-addressed via `idFromName("owner/slug")`, so a link *always* resolves to the same room.
  - `USER` — one per username, owns the public profile and lifetime stats.
- **Static front end** — `public/` is plain HTML/CSS/ES modules served straight off the Worker. No bundler, no framework, no build.
- **WebSockets** — clients connect to `/ws?room=<owner>/<slug>` for live moves, chat, and presence, with automatic reconnect.

## Routes

| Path | What |
|------|------|
| `/@<username>` | Public profile + lifetime stats |
| `/@<username>/<room>` | A game room |
| `/ws?room=<owner>/<slug>` | Room WebSocket |
| `/api/user/<username>` | Profile data as JSON |
| `/sitemap.xml` | Auto-generated from live rooms + profiles |

## Project layout

```
src/                Worker + Durable Objects (TypeScript)
  worker.ts           entry: routing, WS upgrade, meta, sitemap
  room.ts             ROOM DO — game state, fan-out
  user.ts             USER DO — profiles, lifetime stats
  modes.ts            room game modes (Race live; Long Game + Challenge on the roadmap)
  color/identity/…    scoring, usernames, records, scoreboard, stats

public/             Static front end (no build step)
  app.js              client entry
  editions/           skinnable game editions
  gold.js powerups.js the economy + power-up layer
  voice*.js voice/     the Yang voice companion
  i18n.js locales/     internationalization
  llms.txt            AI-discoverability

test/               vitest — 177 tests across backend + frontend
docs/               specs + plans (the paper trail)
```

## Local development

```bash
npm install
npm run dev        # wrangler dev — Worker + static assets + a local Durable Object
```

Wrangler boots local DOs, so rooms work end to end on `localhost`.

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

## Deploy

```bash
npm run deploy     # wrangler deploy
```

Ships the Worker, static assets, and the Durable Object migration to Cloudflare. Production lives at **[wordul.com](https://wordul.com)** (the legacy alias `wordle.goldenfoc.us` still resolves but canonicalizes to wordul.com).

## Notes

Configuration lives in `wrangler.jsonc`. Secrets go through `wrangler secret put` — never commit `.dev.vars` or `.env*` (both gitignored). Older `/r/<code>` room links auto-redirect home; rooms are owner-nested now.
