# Duel: invite → ready → 3-2-1-GO

**Date:** 2026-06-04
**Branch context:** feat/word-wiki (current); this is a separate feature, branch off main.
**Status:** Design approved, pending spec review.

## Goal

Turn a room into a focused **1v1 duel**. The center of gravity is *inviting someone*: a
prominent share/invite while you wait, a delightful waiting vibe, then — once both players
are **ready** — an auto-firing **3-2-1-GO** countdown that themes itself off the room's
edition. No manual "START GAME" in a duel.

## Decisions (locked)

| Question | Decision |
|---|---|
| Ready scope | Strictly **1v1** — first 2 connected humans are duelists |
| Start trigger | **Auto-fire** the moment both duelists are ready (no host button) |
| Countdown style | Reuse the **edition** system (palette / motion / sound / companion); no separate studio UI |
| Countdown length | **3-2-1-GO (~3s)**, ~1s per number, then the existing GO! burst |
| Alone in room | Invite is the hero + rotating waiting vibe; after a delay, "Play solo anyway" + "Add a bot opponent" appear |
| 3rd joiner | **Spectator** — watches both boards live, can't play |
| Disconnect during countdown | **Cancel** back to lobby + re-ready |
| Disconnect during play | **Continue**, mark AWAY (today's behavior); reconnect resumes board |

## What already exists (reuse, don't rebuild)

- **Invite/share:** `inviteBtn` in the room header (`public/index.html`) → `shareRoomInvite()`
  (`public/app.js` ~639) already does native-share-on-mobile / copy-on-desktop. URL is
  `/@{owner}/{slug}`. We make it the *hero* of the waiting state; the mechanism is done.
- **Bots:** `PlayerState.isBot`, `ensureBot()`, `scheduleBotTick()` in `src/room.ts`.
  "Add a bot opponent" reuses this.
- **Companion lines:** per-edition personality text in `public/editions/*.js`. We add new
  line pools for the waiting/countdown moments.
- **DO alarms:** the room already schedules alarms for bot ticks. The countdown→playing
  flip reuses the same alarm mechanism (see Alarm coordination below).
- **GO! burst:** `triggerStartCelebration()` (`public/app.js` ~1828). The countdown ends
  *into* this existing burst rather than replacing it.

## Data model changes (`src/types.ts`)

```ts
type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
  isBot?: boolean;
  ready: boolean;                        // NEW — duelist ready state (spectators ignore)
  role: "duelist" | "spectator";         // NEW — seat assignment
};

type RoomPhase = "lobby" | "countdown" | "playing" | "finished";   // + "countdown"

type RoomSnapshot = {
  // ...existing...
  goAt: number | null;                   // NEW — epoch ms the round goes live (countdown sync)
};

type ClientMessage =
  | // ...existing...
  | { type: "ready"; ready: boolean }    // NEW — toggle duelist ready
  | { type: "add_bot" }                  // NEW — fill the second seat with a worduler
  | { type: "play_solo" };               // NEW — start a solo round (no opponent gate)
```

`start` (manual) is removed from the duel path. Solo uses `play_solo`; bot-fill uses `add_bot`.

## Server logic (`src/room.ts`)

### Seat assignment (on `hello` / join)
- On connect, if the player is a returning username, restore their existing seat.
- Otherwise: if fewer than 2 connected **duelists** exist → assign `role: "duelist"`,
  else `role: "spectator"`. Bots only ever occupy a duelist seat via `add_bot`.

### `onReady(ws, ready)`
- Only duelists toggle `ready`. Persist + broadcast so the opponent sees the state.
- If **both duelists are connected and ready** and `phase === "lobby"` → `beginCountdown()`.

### `beginCountdown()`
- Pick the word, reset both boards (`guesses=[]`, `status="playing"`), `round += 1`.
- `phase = "countdown"`, `goAt = Date.now() + COUNTDOWN_MS` (3000).
- Persist + broadcast. **Schedule a DO alarm at `goAt`.**

### Alarm fires at `goAt`
- `phase = "playing"`, `startedAt = goAt`.
- If a bot duelist is present → `scheduleBotTick()`.
- Persist + broadcast.

### `add_bot` (waiting state)
- Add an `isBot` duelist into the open seat, `ready: true`. The human's ready then triggers
  `beginCountdown()` as normal (one consistent path to countdown).

### `play_solo` (waiting state)
- Single human, no second seat required. Run the same `beginCountdown()` → countdown →
  playing path (solo player still gets the 3-2-1 for consistency), with no opponent gate.

### Round end → lobby
- On `rematch` / return to lobby: `ready = false` for all duelists, `goAt = null`.

### Disconnect handling
- **During `countdown`:** if a *duelist* disconnects → cancel: `phase = "lobby"`,
  `goAt = null`, both `ready = false`, cancel the pending alarm. Broadcast.
- **During `playing`:** unchanged — mark `connected = false` (AWAY); reconnect resumes.

### Alarm coordination (implementation note — flag for eng review)
The room shares one DO alarm across bot ticks and the countdown flip. The alarm handler
must dispatch by state: if `phase === "countdown"` and `now >= goAt`, do the go-live
transition; otherwise run the bot-tick path. Re-arm the alarm for whichever timer is next
pending. This is the one non-trivial concurrency point.

## Client (`public/app.js`, `public/index.html`)

### Lobby header
- Invite button stays in the header but is visually promoted in the waiting state.

### Waiting (1 duelist, no opponent)
- **Hero:** big Share/Invite (calls `shareRoomInvite()`).
- **Vibe:** rotating companion lines from the edition's new `companion.waiting` pool —
  jokes about waiting, "invite a friend", "become a true Worduler", light Wordul promos.
  Rotate on an interval; respect reduced-motion (cross-fade vs hard cut).
- **After ~15–20s:** a quieter second row appears: **"Play solo anyway"** (`play_solo`) and
  **"Add a bot opponent"** (`add_bot`).

### Duel lobby (2 duelists)
- No START button. Each duelist sees a **Ready** toggle and the opponent's state
  ("Opponent ready ✓" / "waiting for opponent…").
- When both ready → server drives countdown (below).

### Countdown overlay
- On `phase === "countdown"`, render **3 → 2 → 1 → GO!** synced to `goAt`
  (`remaining = goAt - now`), so both clients land together regardless of latency.
- Styled from the active edition: palette (colors), `WordulMotion` (timing/easing),
  sound (beep/voice via the edition's sound config), optional `companion.countdown` line.
- GO! flows into the existing `triggerStartCelebration()` burst. Input unlocks at `goAt`.

### Spectator
- Read-only badge; sees both boards live; no Ready/keyboard input.

## "Studio" = the edition system

No new studio screen this PR. The countdown and waiting vibe read **entirely** from the
room's active edition: palette, motion timings, sound, and two new companion line pools
(`waiting`, `countdown`). Changing the countdown feel = picking a different edition in the
existing hub theme picker (already room-wide). A dedicated per-room studio UI is a clean
follow-up PR, not blocked by anything here.

### Edition config additions (`public/editions/*.js`)
- `companion.waiting: string[]` — waiting-state vibe lines.
- `companion.countdown?: string[]` — optional line shown during/under the 3-2-1.
- Countdown visuals derive from existing `palette` + `motion`; no new required fields.
  (Defaults provided so editions that don't define `waiting` still work.)

## Out of scope (explicit)
- Dedicated "studio" UI for per-room countdown customization (future PR).
- Matchmaking / public lobby browsing.
- Spectator → duelist promotion when a seat frees mid-session (later; for now a freed seat
  is filled by the next *new* joiner, spectators stay spectators).
- Tournaments / >2 player competitive modes.

## Testing
- **Seat assignment:** 1st/2nd human → duelist; 3rd → spectator; reconnecting duelist
  keeps seat.
- **Ready gate:** countdown fires only when both duelists ready+connected; un-readying
  before both-ready does not fire.
- **Countdown sync:** two clients with simulated latency both land at `goAt`.
- **Alarm dispatch:** countdown flip and bot tick coexist (bot duel covers both).
- **Disconnect during countdown:** cancels to lobby + re-ready, alarm cancelled.
- **Disconnect during play:** continues, AWAY, reconnect resumes board.
- **Solo / add-bot:** `play_solo` runs a solo round; `add_bot` fills seat and one ready
  triggers countdown.
- **Edition theming:** countdown colors/sound/lines change with the room edition; missing
  `companion.waiting` falls back to defaults.
```
