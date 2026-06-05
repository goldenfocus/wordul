# Lobby Redesign — calm, spacious, visually-pleasing waiting room

> **For agentic workers:** This is a SPEC + design brief, not a bite-sized TDD plan yet.
> START by running the **golden-design-ritual** skill on the visual questions in §6, publish
> 2–4 directions to `/designs/<slug>`, let Yan pick, THEN turn the winner into an
> implementation plan via **superpowers:writing-plans**. Implement in a git worktree
> (`bash dev/start.sh lobby-redesign`), ship via `/push`.

**Goal:** Redesign the multiplayer **room lobby** (the waiting room before a game starts)
into a calm, spacious, genuinely beautiful Civ-3-style lobby: your game on the left, the
other tables + chat on the right, the host configuring + chatting while watching tables fill
up — with way less visual noise than today.

**This supersedes the visual/layout parts of** `2026-06-04-civ3-arena-lobby.md` (the Atrium
direction + phasing). The *functional* lobby from that plan is already SHIPPED (see §2).

---

## 1. The problem (from Yan's screenshot review, 2026-06-05)

The current lobby (shipped Phase 1) stacks everything vertically and is noisy:
`Wordul. header` → a **card** with `Sturdy Walrus 🔗` + an **ugly gear-in-a-pill toggle** +
`READY` → **Play/Games/Players tabs** → `papa (you)` + a **full 5×6 grid** (all 6 empty rows
hog the screen and hide everything, worse for big words) → **OTHER TABLES FILLING UP** rail
at the very bottom. Too much chrome, the grid eats all the real estate, the gear-pill is
"ugly af," and the rail will get clogged when the arena is busy. No chat.

## 2. What's already SHIPPED (build on this — don't redo)

- `/arena` is a real refresh-survivable route; worker serves the SPA shell. (commit `203236a`)
- **Abandon-grace:** a public room with no humans delists from the open-games index after 45s
  (survives refresh/hibernation). (`203236a`)
- **Phase-1 lobby rail:** `public/arena-panel.js` exports `seatLabel`, `isHot` (FOMO: a table
  one seat from full at capacity ≥3), and `mountArenaList(el,{onJoin,excludePath})`. `app.js`
  mounts it into `#lobbyRail` during a room's `lobby` phase (`mountLobbyRailIfNeeded` /
  `teardownLobbyRail`), excludes your own room, tap-to-defect navigates (leaveRoom closes the
  old socket). (commit `2444ea5`)
- **Open-games API:** `GET /api/arena/open` → `OpenGame[]`
  (`{routePath,name,host,personaIcon,edition,wordLength,seats}`).
- Shared live controls already exist as WS messages: `set_length`, `set_edition`, `set_mode`,
  `rename`. Theme list: `public/editions/index.js`. Room chat exists per-room (`chat` WS msg).
- Visual DNA: display `Fraunces`, accent `#9d8bff`, dark `#0e0e10`/card `#17171a`; 7 themes
  (Wordul/Yang/Jackpot/Arcade/Editorial/Tactile/Tin-Bot). Atrium prototype Yan picked:
  `https://wordul.com/designs/host-lobby-atrium`.

## 3. The redesign — what changes

1. **Hoist room controls INTO the page header.** The room **title** (`Sturdy Walrus`), the
   **copy-link / quick-share**, and **settings** all live in the top header bar (next to/below
   `Wordul.` · `@papa` · 💎 · avatar). **Delete the separate title card row** entirely.
2. **Remove the `Play / Games / Players` tabs** from the lobby (this view is the lobby, not a
   tabbed room). Those views can still exist post-start / elsewhere — just not cluttering the
   waiting room.
3. **Collapse the grid to ONE row while waiting.** Before the game starts, don't render all 6
   empty rows — show a **single row** of the right width, plus a **subtle "×6" (tries) badge**
   meaning "6 guesses available." Frees enormous vertical space, and scales gracefully to big
   words (an 11-wide board no longer fills the screen with emptiness). On start, the board
   expands to its full N×rows form.
4. **Kill the gear-in-a-pill.** Replace with a **clean settings affordance + a pure
   quick-share/invite button**. The grid should read as a *pure grid* — no toggle pill stuck to
   it. (Design ritual — §6.)
5. **Two-zone layout, not a vertical stack:** your game (grid + tries badge + config) sits
   LEFT; the lobby (other tables + chat) sits RIGHT on wide screens, BELOW on mobile. The host
   configures the game (theme/length/mode) **right there** while watching tables fill and
   chatting.
6. **Add chat to the lobby.** The layout must include a chat panel (see §5 decision: room-chat
   first vs global lobby chat).
7. **Compact the "other tables" rows** so a busy arena doesn't clog. Each table is a tight
   row: persona icon · host · `N letters` · a tiny **`×T` tries** micro-indicator · seats
   (`1/3`) — **never a full grid preview** per table. Hot tables (§2 `isHot`) still glow.
   Consider a max-height scroll + count ("12 tables") rather than an endless list.

## 4. Target layout (wide screen)

```
┌─ header ───────────────────────────────────────────────────────────┐
│ Wordul.        Sturdy Walrus  ⌁share  ⚙        @papa  ◆125  (P)      │
├──────────────────────────────┬──────────────────────────────────────┤
│  YOUR GAME (left)            │  LOBBY (right)                        │
│                              │  ┌ Other tables filling up ─────────┐ │
│   ┌──┬──┬──┬──┬──┐  ×6       │  │ 🐼 Pax    4 ltrs ×6        1/3   │ │
│   └──┴──┴──┴──┴──┘  tries    │  │ 🦊 Maya   8 ltrs ×6        4/5🔥 │ │
│                              │  └──────────────────────────────────┘ │
│   theme · length · mode      │  ┌ Chat ────────────────────────────┐ │
│   [ READY ]                  │  │ …messages…              [type…]   │ │
│                              │  └──────────────────────────────────┘ │
└──────────────────────────────┴──────────────────────────────────────┘
```
Mobile: header (title+share+gear) → single-row grid + ×6 → config → READY → other tables
(compact, scrollable) → chat. One clean column, far less than today.

## 5. Open decisions (resolve before/at the ritual)

- **D-A · Chat scope.** Lobby chat panel wired to (a) the **room's existing per-room chat**
  (cheap, ships now — you chat with whoever's at *your* table) OR (b) a **global lobby chat**
  (the "main lobby chatter" Civ-3 vibe; bigger — new shared channel on the `Arena` DO, was
  deferred in the prior spec). **Recommend (a) first**, (b) as a later phase.
- **D-B · Tries badge form.** `×6` vs `6 tries` vs a tiny stacked-rows glyph vs a number in the
  corner of the single row. Pick in the ritual.
- **D-C · Settings affordance.** Inline header controls vs a single clean "Setup" button that
  opens a sheet. Must not be the gear-pill. Ritual.
- **D-D · Does the single-row collapse apply only in lobby, or also to opponents' boards
  pre-start?** (Likely lobby-only; opponents have no board until playing.)

## 6. Design ritual scope (run FIRST)

Publish 2–4 playable directions to `/designs/<slug>` for the **redesigned lobby**, all on
wordul's DNA (Fraunces, `#9d8bff`, dark; must survive the light Tin-Bot theme via CSS vars).
Each must show, interactively:
- Header-integrated **title + quick-share + settings** (NO gear-pill).
- The **single-row grid + tries badge** (`×6`), and how it expands on a simulated start.
- The **two-zone layout** (grid left / lobby right; responsive to one column on mobile).
- **Compact other-tables** rows (anti-clog: scroll + count, hot glow) + a **chat panel**.
- Tap-to-defect + live seat fill (reuse the prototype patterns already built).
Anchor on the **Atrium** spine (board-centric) Yan already chose; this ritron refines it into
the calmer, header-integrated, single-row layout above. Goal: **super visually pleasing.**

## 7. Files likely touched (when implementing the winner)

- `public/index.html` — restructure `tpl-room` lobby region: remove the title card + tabs from
  the lobby state; add header slots for title/share/settings; two-zone container; chat panel;
  `#lobbyRail` becomes the right-column list.
- `public/app.js` — `render()` lobby branch: header-hoist, single-row board in lobby (gate the
  existing board renderer to 1 row + tries badge when `phase==="lobby"`), mount chat in lobby,
  keep `mountLobbyRailIfNeeded`. Board renderer: `renderBoards`/`render` around the lobby phase.
- `public/style.css` — new lobby layout (grid/flex two-zone, responsive), tries badge, compact
  table rows, chat panel, header room-controls. Remove `.lobby-rail` bottom styling in favor of
  the right-column placement. All var-driven.
- `public/arena-panel.js` — extend a row renderer for the **compact** form (add `×T` tries from
  `wordLength`-derived `guessesFor`, scrollable container, table count). Maybe a `triesFor`
  helper (mirror server `guessesFor`) — unit-test it.
- Chat: reuse existing room-chat render/ send (`renderChat`, `chat` WS msg) if D-A = (a).

## 8. Phasing

- **P0 — Design ritual** (§6) → Yan picks a winner.
- **P1 — Layout + header hoist + single-row/tries + compact tables + chat panel** (room-chat).
  Mostly client (`index.html`/`app.js`/`style.css` + `arena-panel.js`). Ship.
- **P2 — (optional) global lobby chat** if D-A→(b) chosen later (own spec; `Arena` DO channel).
- **P3 — Surprise bot-join** (still pending from prior spec §Phase 2: a noob bot joins seat 2
  after 3–69s; host presses Start). Independent; can come before/after P1.

## 9. Guardrails

- **iOS 16px floor:** every focusable input (chat box, rename, share) renders ≥16px on mobile.
  NOTE: a recent main change set `viewport … maximum-scale=1,user-scalable=no` — that violates
  CLAUDE.md's iOS scar-tissue (never kill pinch-zoom; 16px floor is the only fix). Flag/restore
  during this work if still present.
- **XSS:** other-tables rows render user-controlled `host`/room names — usernames are validated
  `[a-z0-9_-]{3,20}` (safe), but if room `name` is ever shown, escape it (textContent).
- Gauntlet: `check-graph` + `typecheck` + `test` green before ship; var-driven across all 7
  themes incl. light Tin-Bot.
