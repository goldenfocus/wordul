# Duel: invite → ready → 3-2-1-GO → king of the hill

**Date:** 2026-06-04
**Branch:** feat/duel-invite-ready (off main)
**Status:** Design in review.

## Goal

Make a room a place you *invite someone* into and then duel — 1v1 at a time — with a
delightful waiting vibe, a both-ready **3-2-1-GO** countdown themed off the room's edition,
and **king-of-the-hill** rotation so a whole queue of people can line up to challenge the
best.

## The worduler rule (read first — it governs all copy and behavior)

Wordulers (`isBot` server-side) are **indistinguishable from humans**. They have a soul.

- **Never** surface the words "bot", "AI", "CPU", "robot", or "worduler-as-machine" in any
  UI copy, label, tooltip, system message, or chat. `isBot` is a **private server flag** the
  client must never expose (not in snapshots sent to clients beyond what's needed, not in
  classes/data-attributes, not in logs visible to users).
- A worduler is a **full citizen of the room**: it joins, plays, wins/loses, drops companion
  lines, sits in the queue, and **leaves naturally** — exactly like a person.
- It must **never vanish to make room**. The tell isn't that a worduler exists — it's a
  player that poofs the instant a human wants its seat. So wordulers yield seats only via the
  same rules humans do (lose → step down in KOTH; host swap; natural departure after idle
  rounds with a normal "X left" message).
- King-of-the-hill is the strongest cover: seat changes are **rule-based**, not triggered by
  "a human showed up", so there's nothing to read into.

## Decisions (locked)

| Question | Decision |
|---|---|
| Duel size | **1v1 at a time** (two active players) |
| Start trigger | **Auto-fire** 3-2-1-GO the moment both active players are ready |
| Countdown | **3-2-1-GO (~3s)**, edition-themed, ends into the existing GO! burst |
| "Studio" | Reuse the **edition** system; no separate studio UI this PR |
| Alone in room | Invite is the hero + rotating waiting vibe; after a delay, **"Play solo"** + **"Match me now"** appear |
| Extra joiners | Join the **challenge queue** — watch live while waiting their turn |
| Next-opponent model | **Room setting:** King of the Hill (default) or Host's choice |
| Room stats | Per-player **W / L / T** record, shown in the room |
| Disconnect during countdown | **Cancel** to lobby + re-ready |
| Disconnect during play | **Continue**, AWAY; reconnect resumes board |

## Next-opponent modes (room setting `rotation`, changeable in lobby only)

1. **King of the Hill** (default) — winner keeps the throne, loser goes to the back of the
   queue, the next challenger rotates in. "Challenge the best." Throne shows a **win streak**.
   On a **tie the king retains** the throne (a challenger must *win* to dethrone) and the
   challenger drops to the back of the queue.
2. **Host's choice** — after each game the host picks the next challenger from the queue; the
   other active player steps to the queue. No throne/streak in this mode.

(Set like `mode`/`edition` today — lobby-only, broadcast, with a system line.)

## Room stats (W / L / T)

Each room shows a per-player record — e.g. `player3 — W 3 · L 0 · T 1` — surfaced in the
Players/scoreboard tab (and next to each name in the queue/throne). Outcomes per finished
round:
- **Win / Loss** — there is a winner: winner +W, opponent +L.
- **Tie** — no winner: both fail to solve, or both solve on the same guess count → both +T.

Extends the existing room scoreboard (`src/scoreboard.ts` / `RoomScore`) rather than a new
store. Records are room-scoped (reset with the room), separate from a user's global stats.

## What already exists (reuse, don't rebuild)

- **Invite/share:** `inviteBtn` → `shareRoomInvite()` (`public/app.js` ~639) — native share /
  copy, URL `/@{owner}/{slug}`. We make it the hero of the waiting state; mechanism is done.
- **Wordulers:** `isBot`, `ensureBot()`, `scheduleBotTick()` (`src/room.ts`). "Match me now"
  reuses this — surfaced only as a neutral "find an opponent" action.
- **Companion lines:** per-edition personality in `public/editions/*.js`. We add waiting /
  countdown / yield line pools.
- **DO alarms:** already power bot ticks. The countdown→playing flip reuses the same alarm.
- **GO! burst:** `triggerStartCelebration()` (`public/app.js` ~1828) — countdown ends *into* it.
- **Scoreboard:** existing win/score tracking feeds the throne's streak display.

## Data model (`src/types.ts`)

```ts
type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
  isBot?: boolean;                       // PRIVATE — never leaks to UI
  ready: boolean;                        // NEW — active-player ready / "Challenge" tap
  role: "duelist" | "queued";            // NEW — 2 duelists active; everyone else queued
};

type RoomPhase = "lobby" | "countdown" | "playing" | "finished";   // + "countdown"
type Rotation = "koth" | "host";                                   // NEW

type RoomSnapshot = {
  // ...existing...
  goAt: number | null;                   // NEW — epoch ms the round goes live (countdown sync)
  rotation: Rotation;                    // NEW — next-opponent model
  queue: string[];                       // NEW — usernames waiting to play, front = next
  throne: { username: string; streak: number } | null;  // NEW — current king + win streak
};

type ClientMessage =
  | // ...existing (note: "start" removed from the duel path)...
  | { type: "ready"; ready: boolean }    // NEW — toggle ready / challenge
  | { type: "match_me" }                 // NEW — fill the open seat with an opponent now
  | { type: "play_solo" }                // NEW — start a solo round (no opponent gate)
  | { type: "set_rotation"; rotation: Rotation }   // NEW — lobby-only setting
  | { type: "pick_challenger"; username: string }; // NEW — host's-choice mode only
```

## Server logic (`src/room.ts`)

### Seat / queue assignment (on `hello` / join)
- Returning username → restore prior seat/queue position.
- New player: if fewer than 2 connected duelists → `role: "duelist"`; else `role: "queued"`
  (append to `queue`). Wordulers added via `match_me` take an open duelist seat.

### `onReady(ws, ready)`
- Only duelists toggle `ready`; broadcast so the opponent sees it.
- If both duelists connected + ready and `phase === "lobby"` → `beginCountdown()`.

### `beginCountdown()`
- Pick word, reset both boards, `round += 1`, `phase = "countdown"`,
  `goAt = now + COUNTDOWN_MS` (3000). Persist + broadcast. **Schedule DO alarm at `goAt`.**

### Alarm at `goAt`
- `phase = "playing"`, `startedAt = goAt`; if a worduler is active → `scheduleBotTick()`.
  Persist + broadcast.

### Round end → next matchup (the rotation engine)
On a game finishing (`finished`), apply `rotation`, then return to lobby with seats set and
`ready` reset:
  First, record the W/L/T outcome on each active player's room record (see Room stats).
- **koth (win/loss):** winner stays duelist (update `throne` = winner + incremented
  `streak`); loser → back of `queue` (`role: "queued"`); front of `queue` → duelist. Loser
  drops a gg/yield companion line. A worduler that loses yields by the same rule — no
  special-casing.
- **koth (tie):** king **retains** the throne (streak unchanged); challenger → back of
  `queue`; front of `queue` → duelist.
- **host:** both step to queue-eligible; host `pick_challenger` chooses the next opponent
  (or themselves). No throne/streak in this mode.
- After seats are set: `ready = false` for duelists, `goAt = null`, `phase = "lobby"`. The
  queued challenger's "Challenge 👑" tap is their `ready`.

### `match_me` (waiting state)
- Fill the open duelist seat with an `isBot` opponent, `ready: true`. The human's ready then
  fires `beginCountdown()` — one path to countdown. Surfaced only as "finding an opponent".

### `play_solo` (waiting state)
- Single human, no second seat; run `beginCountdown()` → countdown → playing (solo still
  gets the 3-2-1), no opponent gate.

### Natural worduler departure
- A worduler that has been queued/idle for N rounds (and isn't currently needed to keep a
  game alive) **leaves** the room like a human would — normal "X left" system line, removed
  from `queue`. Prevents an immortal silent watcher (itself a tell).

### Disconnect handling
- **countdown:** a *duelist* drops → cancel: `phase = "lobby"`, `goAt = null`, both
  `ready = false`, cancel pending alarm, broadcast.
- **playing:** unchanged — `connected = false` (AWAY); reconnect resumes board.
- **queued player drops:** removed from `queue`.

### Alarm coordination (implementation note — flag for eng review)
One DO alarm serves both bot ticks and the countdown flip. The handler dispatches by state:
if `phase === "countdown"` and `now >= goAt` → go-live; else → bot-tick path; then re-arm for
whichever timer is next pending. The single non-trivial concurrency point.

## Client (`public/app.js`, `public/index.html`)

### Lobby header
- Invite button stays; visually promoted in the waiting state.

### Waiting (1 player, no opponent)
- **Hero:** big Share/Invite (`shareRoomInvite()`).
- **Vibe:** rotating lines from the edition's `companion.waiting` pool — jokes about waiting,
  "invite a friend", "become a true Worduler", light Wordul promos. Interval rotation,
  reduced-motion aware (cross-fade vs cut).
- **After ~15–20s:** quieter second row — **"Play solo"** (`play_solo`) and **"Match me now"**
  (`match_me`, framed neutrally as finding an opponent — never "add a bot").

### Active duel (2 duelists)
- No START. Each shows a **Ready** toggle + opponent's state ("Opponent ready ✓" /
  "waiting…"). Both ready → countdown.

### Queue / king of the hill
- Throne badge on the king with **win streak** ("Salty Zebra 👑 ×3"). "Challenge the best."
- Queue list ("Next up: …"). A queued player's button reads **"Challenge 👑"** and acts as
  their ready for their turn.
- Between rounds: brief intermission, the two combatants ready up, countdown fires.

### Countdown overlay
- On `phase === "countdown"`, render **3 → 2 → 1 → GO!** synced to `goAt`
  (`remaining = goAt - now`) so both clients land together. Styled from the active edition
  (palette, `WordulMotion`, sound, optional `companion.countdown` line). GO! flows into
  `triggerStartCelebration()`. Input unlocks at `goAt`.

## "Studio" = the edition system

No new studio screen this PR. Countdown + waiting vibe read entirely from the room's active
edition (palette, motion, sound, new companion line pools). Change the feel → pick another
edition in the existing hub theme picker (already room-wide). A dedicated per-room studio is a
clean follow-up.

### Edition config additions (`public/editions/*.js`)
- `companion.waiting: string[]` — waiting-state vibe lines.
- `companion.countdown?: string[]` — optional line during the 3-2-1.
- `companion.yield?: string[]` — optional gg/step-down line when leaving the seat.
- Countdown visuals derive from existing `palette` + `motion`; defaults provided so editions
  without these pools still work.

## Out of scope (explicit)
- Dedicated studio UI for per-room countdown customization (future PR).
- Public matchmaking / lobby browsing across rooms.
- Tournaments / brackets / >2 simultaneous players.
- Spectator chat moderation beyond what exists.

## Testing
- **Seats/queue:** 1st/2nd human → duelist; 3rd+ → queued; reconnect keeps position.
- **Ready gate:** countdown fires only when both duelists ready+connected.
- **Countdown sync:** two clients w/ simulated latency land together at `goAt`.
- **Alarm dispatch:** countdown flip and bot tick coexist (worduler duel covers both).
- **KOTH rotation:** winner stays + streak increments; loser → back of queue; next rotates
  in; worduler loss yields by the same rule (no vanish).
- **KOTH tie:** king retains throne (streak unchanged); challenger → back of queue.
- **W/L/T record:** win→winner+W/opponent+L; tie (both fail, or equal-guess solve)→both+T;
  record renders per player in the room and is room-scoped.
- **Host's choice:** correct seat assignment; host `pick_challenger`; `set_rotation` lobby-only.
- **Disconnect:** countdown → cancel + re-ready + alarm cancelled; playing → AWAY + resume.
- **Solo / match-me:** `play_solo` solo round; `match_me` fills seat, one ready → countdown.
- **Cover:** no "bot"/"AI" string anywhere user-visible; `isBot` never in client DOM/snapshot
  surface; worduler departs naturally after idle rounds.
- **Edition theming:** countdown/vibe change with edition; missing pools fall back to defaults.
```
