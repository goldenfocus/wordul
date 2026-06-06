# Forfeit Voice Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a forfeit (give-up / bankruptcy), show AND speak one empowering line or tactical tip from a new `FORFEIT` pool — filling the voice silence the `5652d18` fix left behind.

**Architecture:** New `FORFEIT` string pool + `pickForfeit()` in `public/inspire.js` (the home of all loss copy). `triggerLoseSequence` in `public/app.js` picks from it when `game.finishReason` is `gave_up`/`bankrupt` and speaks the line via the existing plain-voice path (`speakLine`) at the moment the end screen opens. Non-forfeit losses are untouched.

**Tech Stack:** Vanilla JS modules (Cloudflare Workers static assets), vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-06-forfeit-voice-quotes-design.md`

---

### Task 1: FORFEIT pool + pickForfeit() (TDD)

**Files:**
- Test: `test/inspire.test.js` (new)
- Modify: `public/inspire.js` (append after `pickInspire`, ~line 369)

- [ ] **Step 1: Write the failing test**

```js
// test/inspire.test.js — the forfeit pool: lines written to be SPOKEN.
import { describe, it, expect } from "vitest";
import { FORFEIT, pickForfeit } from "/inspire.js";

describe("FORFEIT pool", () => {
  it("is a deep pool of non-empty lines", () => {
    expect(FORFEIT.length).toBeGreaterThanOrEqual(30);
    for (const line of FORFEIT) {
      expect(typeof line).toBe("string");
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("lines are written to be spoken — no templates, no '— Author' attributions", () => {
    for (const line of FORFEIT) {
      expect(line).not.toMatch(/\{.*\}/); // would hit speakTemplated's reveal machinery
      expect(line).not.toMatch(/—\s*[A-Z][a-z]+\s*$/); // attributions sound robotic aloud
    }
  });

  it("includes both flavors: empowerment and Tip:-prefixed tactics", () => {
    const tips = FORFEIT.filter((l) => l.startsWith("Tip:"));
    expect(tips.length).toBeGreaterThanOrEqual(10);
    expect(FORFEIT.length - tips.length).toBeGreaterThanOrEqual(10);
  });

  it("pickForfeit draws from the pool", () => {
    for (let i = 0; i < 50; i++) expect(FORFEIT).toContain(pickForfeit());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/inspire.test.js`
Expected: FAIL — `FORFEIT` / `pickForfeit` not exported.

- [ ] **Step 3: Implement the pool in `public/inspire.js`**

Append after `pickInspire()`:

```js
// — The forfeit pool: spoken out loud when a round ends by give-up or bankruptcy. —
// Unlike INSPIRE these are ORIGINAL lines with no attribution ("— Confucius" sounds
// robotic aloud) in two flavors: empowerment for the quit, and evergreen "Tip:" lines
// that send the player back sharper. Keep every line speakable in one breath.
export const FORFEIT = [
  // — Empowerment: quitting a round is a move, not a defeat —
  "Retreat is just strategy wearing a disguise.",
  "You quit the round, not the game. Big difference.",
  "Folding a bad hand is a winning move.",
  "A fresh board beats a sunk cost every time.",
  "Even grandmasters resign. It's called respect for your own time.",
  "The bravest word in any language is 'next'.",
  "You didn't lose. You scheduled a rematch.",
  "Strategic retreat: the move amateurs never learn.",
  "Some words don't deserve you. On to the next.",
  "Knowing when to stop is a superpower. You just used it.",
  "The board resets. Your streak of showing up doesn't.",
  "Live to guess another day.",
  "Quitting a round takes more guts than grinding a lost cause.",
  "That word will be back. And next time, you'll be ready.",
  "You folded the hand, not the spirit.",
  "Sometimes the smartest guess is no guess at all.",
  "Every legend has a round they walked away from.",
  "The house took this round. The next one's yours.",
  "Gold comes back. Tilt is the only real bankruptcy.",
  "Cash out, breathe, come back sharper.",
  "An empty pocket and a clear head beat a full pocket and a fog.",
  "Round over. Lesson banked. Interest compounds.",
  "The word keeps its secret today. Tomorrow it won't stand a chance.",

  // — Tips: evergreen tactics, each one usable on the very next round —
  "Tip: open with a vowel-heavy word. Three vowels in row one changes everything.",
  "Tip: hot letters are locked in. Warm letters demand a shuffle — move them around.",
  "Tip: never spend a guess on a cold letter. The board remembers — so should you.",
  "Tip: make your second guess test five brand-new letters. Cover the alphabet first.",
  "Tip: think in sounds. T-H, C-H, S-T — letters love to travel in pairs.",
  "Tip: an E hiding at the end of the word is the oldest trick in the book.",
  "Tip: stuck? Say your warm letters out loud in different spots. Your ears know words your eyes miss.",
  "Tip: save the rare letters for late. Let the easy letters speak first.",
  "Tip: double letters are sneaky. If nothing fits your confirmed letters, try a twin.",
  "Tip: S at the start, Y at the end. The bookends most players forget.",
  "Tip: can't see the word? It probably starts with a blend. B-R, C-L, S-P — run them.",
  "Tip: a warm letter banned from two spots can only live in three others. Count them down.",
  "Tip: guess to learn, not to win — until row four. Then go for the kill.",
  "Tip: vowels first, consonants close. A-E-I-O-U is your reconnaissance team.",
];

export function pickForfeit() {
  return FORFEIT[Math.floor(Math.random() * FORFEIT.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/inspire.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add test/inspire.test.js public/inspire.js
git commit -m "feat(inspire): FORFEIT pool — spoken empowerment + tips for give-up/bankrupt"
```

---

### Task 2: Wire the pool + voice into the forfeit path

**Files:**
- Modify: `public/app.js:32` (import), `public/app.js:3721-3783` (`triggerLoseSequence`)

- [ ] **Step 1: Extend the import**

`public/app.js:32`:
```js
import { pickInspire, pickForfeit } from "/inspire.js";
```

- [ ] **Step 2: Pick by finish reason + speak at end-screen open**

In `triggerLoseSequence` (app.js ~3721), replace:

```js
  // However the round ended, the player gets a lift, not a roast: one random line
  // from the great-minds pool.
  const inspire = pickInspire();
```

with:

```js
  // However the round ended, the player gets a lift, not a roast. A FORFEIT draws
  // from its own pool (empowerment + tips) and the line is SPOKEN — the word reveal
  // stays silent on a forfeit (no answer revealed yet, see announceGameEnd), so the
  // quote owns the audio moment. Other losses keep the silent great-minds quote:
  // their spoken slot belongs to the "the word was…" reveal.
  const forfeited = game.finishReason === "gave_up" || game.finishReason === "bankrupt";
  const inspire = forfeited ? pickForfeit() : pickInspire();
```

And in the `setTimeout(() => { ... openStats({ ... }) }, 1500)` at the end of the same
function (app.js ~3771), add the speak right before `openStats(...)`:

```js
    if (forfeited) speakLine(VOICE_EDITION, inspire, inspire); // voice + screen land together
    openStats({
```

(`speakLine` + `VOICE_EDITION` are already imported; mute + iOS-unlock are handled
inside the voice layer — forfeit always starts from a button tap.)

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green — especially `test/voice.test.js` ("stays SILENT when the answer is empty"), which must keep guarding the `5652d18` fix.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(forfeit): speak an empowering line or tip on give-up/bankrupt"
```

---

### Task 3: Verify like a player, then ship

- [ ] **Step 1: Local behavioral check (dev server + Playwright)**

Run `npm run dev`; in the browser: start a solo round, make one guess, give up.
Expected: explosion → end screen opens with a FORFEIT line (not an attributed
"— Author" quote) → the same line is spoken aloud. Repeat with sound muted →
line shows, nothing speaks. A normal loss (6 wrong guesses) still shows an
attributed inspire quote with the spoken word reveal.

- [ ] **Step 2: Ship**

```bash
bash dev/ship.sh
```
(tests → rebase on origin/main → backup tag → merge main → CI deploys)

- [ ] **Step 3: Post-deploy prod smoke + summary for Yan**

Per CLAUDE.md browser rules: name `verify-bot-forfeit-voice`, restore identity keys,
`browser_close` when done. Then post the Post-Deploy Summary with 3 player-test steps.
