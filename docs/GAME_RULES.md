# Wordul — Game Rules (canonical)

> **This is the single source of truth for how Wordul plays.** The public `/how-to-play`
> page is written *from* this file. When a rule changes in the code, update this file in
> the same change, then reconcile `public/how-to-play.html` + `public/llms.txt`.
>
> Numbers below are pulled from `public/gold.js` (`GOLD`, `BANKRUPTCY_THRESHOLD`,
> `comboMultiplier`) and `public/powerups.js` (`POWERUPS`). If you touch those, touch this.

Last reconciled: 2026-06-01.

---

## 1. The basics

- Guess the hidden word. You have **6 tries**.
- Word length is **variable — 4 to 12 letters** (set per room).
- After each guess, every tile is colored:
  - 🟩 **Green** — right letter, right spot.
  - 🟨 **Yellow** — right letter, wrong spot.
  - ⬛ **Gray** — that letter isn't in the word (*or* there are no more of it — duplicates count exactly).
- A guess must be a real word in the dictionary, or it bounces back — **a bounce costs you no guess.**

## 2. It's a race

Everyone in a room solves the **same secret word at the same time**, live.

- You see opponents' rows fill in real time (their colors, never their letters).
- **First to solve wins the round** — but the race doesn't end there: everyone else keeps
  playing to finish and bank their own gold.
- Each room keeps a running **scoreboard** across rounds; every player has a public
  profile with lifetime stats.

## 3. Gold — the universal score

Gold is how everyone is scored. You earn it for progress and lose it for sloppiness.

**Earn**
| Action | Gold |
|--------|------|
| Each newly-revealed 🟩 green | **+100** |
| Each newly-revealed 🟨 yellow | **+50** |
| Solving the word | **+500** |
| Speed bonus | **+300 × guesses left** (solve fast, earn more) |

**Combo multiplier** — uncovering several new letters in *one* guess multiplies that
guess's earnings: 2 discoveries → ×1.5, 3 → ×2, 4 → ×2.5, 5 → ×3.

**Lose**
| Action | Gold |
|--------|------|
| Submitting a non-word | **−50** (still doesn't burn a guess) |
| Reusing a known-dead letter in an accepted guess | **−50 per letter**, capped **−200** per guess |

Repeating the *same* dead letter escalates: 1st reuse = base, 2nd = ×2, 3rd = ×3…

**Gold can go negative.** In normal play that's just a low score. In **Hard Mode** only,
sinking past **−300** triggers **bankruptcy** — the game ends in an explosion. Hard Mode
finally has teeth.

## 4. Power-ups (✨)

The ✨ icon appears once you can afford something. Spending gold is a real trade-off.

| Power-up | Icon | Cost | Does |
|----------|------|------|------|
| Reveal a letter | 🎰 | **4000** | Uncovers one unknown letter. A splurge. |
| Count the vowels | 🔍 | **200** | Tells you how many vowels are in the word. A cheap nudge. |

💀 **Give up** — surfaces when you're stuck. Tapping it forfeits with the same explosion
as bankruptcy, in **any** mode.

## 5. Editions (skins)

Reskin the whole game. Current editions: **Wordul** (default), **Editorial**,
**Yang's Table** (with a cloned-voice companion who reacts as you play), **Tactile**,
**Arcade**, and **Jackpot** (a payout vibe). Editions are cosmetic — the rules above
hold across all of them.

## 6. Modes

- **Live Race** — *available.* Everyone sprints the same word at once (the rules above).
- **Long Game** — *roadmap.* Turn-based, a 3-day clock; play a row, then wait.
- **Open Challenge** — *roadmap.* One word, always open; beat the standing record.

## 7. Identity

No password, no signup. Pick a username and you're recognized anywhere just by typing it
again. You get a public profile at `/@you` with lifetime stats and past games.

---

## Tuning notes (for maintainers)

- All economy constants live in `public/gold.js` and are explicitly "tunable" — expect
  the numbers above to drift. **Update this file when they do.**
- The hidden-word scoring rule (green/yellow/gray, duplicate-letter handling) is the pure
  `scoreGuess()` in `src/color.ts`. The `/how-to-play` demos use a JS port in
  `public/howto.js`, kept honest by `test/howto-score.test.ts` (compares against the real
  scorer). If you change scoring, that test must still pass.
