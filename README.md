# Wordle Race

Race your friends on the same Wordle. No login. Pick a nickname, share a link, go.

Live: **[wordle.goldenfoc.us](https://wordle.goldenfoc.us)**

## What it is

A real-time, multiplayer take on Wordle. Spin up a room, share the link, and everyone
solves the same word at the same time — first across the line wins. Built for couches,
group chats, and friendly trash talk.

- **Same word, live race** — everyone in a room gets the identical puzzle.
- **Share-a-link rooms** — memorable codes like `sunny-otter`, no accounts.
- **On-screen keyboard** with per-key color hints.
- **Live chat** alongside the board.
- **Stats & settings** — streaks, color-blind mode, and more.
- **Variable word length** — anywhere from 4 to 12 letters.
- **A losing explosion** when you don't make it. You'll know.

## Tech stack

- **Cloudflare Workers** — edge runtime serving the app and routing WebSockets.
- **Durable Objects** — one DO instance per room holds the authoritative game state.
  Room codes are content-addressed via `idFromName`, so a link always resolves to the
  same room.
- **Static assets** — the front end (`public/`) is plain HTML/CSS/ES modules, served
  directly by the Worker. No build step for the client.
- **WebSockets** — clients connect to `/ws?code=<room>` for live moves, chat, and
  presence, with automatic reconnect.

## Project layout

```
public/        Static front end (index.html, app.js, style.css, codes.js)
src/           Worker entry + Durable Object (room logic, WebSocket fan-out)
```

## Local development

```bash
npm install
npm run dev        # wrangler dev — serves the Worker + static assets locally
```

Wrangler boots a local Durable Object so rooms work end to end on `localhost`.

## Deploy

```bash
npm run deploy     # wrangler deploy
```

Deploys the Worker, static assets, and Durable Object migration to Cloudflare. The
production app lives at [wordle.goldenfoc.us](https://wordle.goldenfoc.us).

## Notes

Configuration lives in `wrangler.toml` / `wrangler.jsonc`. Any secrets go through
`wrangler secret put` — never commit `.dev.vars` or `.env*` (both are gitignored).
