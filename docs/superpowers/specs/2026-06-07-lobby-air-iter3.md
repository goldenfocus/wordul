# Lobby Air — iteration 3: top-chrome de-clutter, live join feedback, chat/status split

**Date:** 2026-06-07 · **Author:** Yan (voice notes) + Claude · **Status:** speced, ready to run
**Baseline:** Air skin live on prod (`d07184c`): sharp READY tile, tap-a-chair capacity
(`emptySeatActions`), chevron Chat/tables rows, 5×6 in Settings. This spec is the NEXT
iteration on top of that. Goal unchanged: **reduce the clutter** — and give noobs feedback
the removed `n/m` count used to provide.

No design ritual for this round — Yan: "you can probably nail it in one shot."

---

## 1. Live join feedback — the rail is the counter (noob clarity)

A noob tapping the dashed ＋ chair has no idea what happened (we removed the 1/2 count).
The answer: **the open-tables rail is expanded by default, and YOUR table is pinned as its
first row** — so tapping ＋/✕ visibly ticks "1/2 → 1/3" in the familiar list-row format.

- **Rail expanded by default** on mobile (`#lobbyRail` starts `.expanded`; the pill header
  still toggles). Desktop already shows the full panel.
- **"Your table" pinned row**: synthesize the first row from the LIVE room snapshot — do
  NOT rely on the `/api/arena/open` feed (it may exclude or lag your own room). Build props
  in `public/lobby-view.js` (new pure fn, e.g. `yourTableRowProps(snap, me)` → reuse the
  `compactRowProps` row shape: avatar = your initial/seat gradient, host = "Your table",
  dim = `cols×rows`, seats = `taken/capacity`). Re-render it on every snapshot so ＋/✕
  ticks immediately. Row is non-navigating (you're already here) — visually quiet, maybe
  a subtle "you" accent on the seats count.
- **Join sound**: when a NEW player takes a seat in YOUR lobby (taken-count grows in
  `renderMyTable`, lobby phase, not caused by your own join/capacity tap), play a soft
  chime — reuse `playChime` (public/app.js ~1481); MUST respect `wordul.muted`
  (mute-btn.js / `isMuted()`).
- **Remove the redundant "N open" line** inside the expanded rail — it repeats the pill
  header. `public/arena-panel.js:113` (`.arena-count`), CSS `.arena-count`
  (style.css ~3568). The desktop rail header ("Tables" title) keeps whatever count it
  already shows; just never two counts in one panel.

## 2. Top chrome — remove the mystery pill, Score 0, chat bubble

- **`#messageRow`** (public/index.html:267, `.message-row` style.css ~1581) renders as an
  empty bordered pill below the header — "looks completely useless." Hide when empty
  (`.message-row:empty { display: none; border: none; }` or equivalent). It's an aria-live
  toast row — confirm toasts still appear when populated.
- **"Score 0"** is `#roundScore` (`.round-score`, child of `#tabPlay`) leaking into duel
  lobbies — per its own comment (index.html ~204) it was meant to be daily-only and
  "hidden in race rooms." Never show it in the lobby phase, and never show a zero score.
  Relocation of the score display is DEFERRED — for now it simply doesn't render in lobby.
- **Topbar chat bubble 💬** `#chatTopBtn` (index.html:85): remove from the topbar (in-room
  chat affordance is the lobby chevron / in-game sheet trigger — check `updateChatBadge`
  in app.js for `topBadge` references and the `topBtn` wiring in `wireChat`; the mobile
  PLAY-phase sheet still needs an entry point — if `#chatTopBtn` is that entry point
  during play, scope the removal to the lobby phase and keep it during play).
- **Topbar share/link 🔗** `#roomLinkBtn` (index.html:74): remove — Invite (lobby pair)
  owns sharing now. Breadcrumbs (`#crumbs`) keep showing where you are.

## 3. Premium identity corner

- **Avatar frameless**: `.avatar-btn` (index.html:98) loses its square border/background
  frame — just the glyph "like a picture without a frame." Keep hit area ≥44px and the
  `@name` caption (`#avatarName`) beneath.
- **Gold stacks**: the ◆ glyph sits ON TOP of the amount (column: small ◆ above the
  number) — "suddenly premium." Apply to BOTH the home `#hubGold` (index.html:92) and the
  in-room `#goldHud` (built in `public/gold.js` `renderGoldHud`, prefix logic at
  gold.js:73-119 — the count-up writes `${prefix}${v}` textContent; restructure so the
  glyph is its own stacked element and the counter animates only the number). Tabular
  numerals; don't break `gold-bump` animations.

## 4. Chat ⇄ Status split (the IRC idea, now real)

System lines ("X joined", "set the table to N seats") must stop drowning the chat.

- **Status tab**: `#chatTabs` (index.html ~329) already hosts a hidden Global tab + the
  Table tab. Add a third **Status** tab: timestamped, muted system lines only
  (`renderChatRow` already styles `.chat-row.system`; route `kind === "system"` entries to
  the Status pane instead of the chat log). Chat pane = user messages only.
- **Attention rules** (pure logic lives in `public/chat-pill.js` — extend its tests):
  - Auto-expand the chat chevron ONLY on a real user message (already true via
    `chatHasUserText` — keep it true after the split).
  - **Blink**: if a real message arrives while the pill stays collapsed (the manual-close
    latch in chat-pill.js holds), pulse the "▸ Chat" row (subtle accent animation,
    reduced-motion safe) instead of force-opening.
  - Status lines NEVER blink, expand, badge, or ping anything.
- Status tab visibility: quiet — no unread counts on it, ever.

## 5. Constraints (unchanged from the Air ship)

- Air ethos: bare rows at rest, the ONE shared card surface only when something opens.
- Tokens only (`--space-*`, `--r-*`); 390px-first; desktop two-zone keeps working.
- Hub-files-thin: new logic in modules with tests (`lobby-view.js`, `chat-pill.js`, or a
  new `public/<feature>.js`) — app.js gets imports + wiring only (loc-ratchet enforces).
- Don't break: challenge rooms ("vs N ghosts" strip), daily rooms (roundScore IS their
  score UI during play), play-phase chat sheet, spectators (no controls, live chat).

## 6. QA checklist (browser, 390 + 1280)

1. Fresh duel: no empty pill under header, no "Score 0", no 💬/🔗 in topbar, frameless
   avatar, stacked ◆ gold.
2. Rail open by default with "Your table 1/2" on top; tap ＋ → row ticks 1/3 live; ✕ →
   back to 1/2; "N open" line gone.
3. Second player joins → soft chime (and none when muted), row ticks.
4. Chat: system lines land in Status tab only; a guest's real message auto-expands the
   chevron; close it manually, second message → blink, no force-open.
5. Daily room still shows its round score during play; challenge strip unchanged.
6. Gauntlet: check-graph, typecheck, full vitest; ship via /push (CI deploys —
   read step CONCLUSIONS, the "Skipped deploy" step shows skipped when healthy).

## Deferred (tracked in memory, not this iteration)

- Lobby footer: "cool stuff while waiting" for bored waiters.
- READY button look revisit (sharp tile shipped; Yan may want another pass).
- Score display relocation (where score lives outside the daily).
- Settings overhaul (now the only home of length × rows).
