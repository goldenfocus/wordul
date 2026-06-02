# Smart Companion Engine (Subsystem A)

**Date:** 2026-06-02
**Status:** Approved — ready for implementation plan
**Part of:** the 4-part voice arc (A: smart engine · B: voice-line studio UI · C: remote-trigger local render · D: online voice cloning via Golden Voice). This spec covers **A only**. A defines the magnitude/line-bank schema that B will later edit through a web UI.

## Problem

The companion (Yang's cloned voice) picks lines by dumb round-robin (`companionReact` in `edition.js:56`: `reactCounters[event]++ % bank.length`). Consequences:

1. **The "two" bug.** `celebrateGreens(count)` (`app.js`) fires the `rush` event whenever `count >= 2` new greens land in one guess, but every `rush` line is hardcoded *"Two greens in one swing"* — so 3, 4, or 5 greens still say "two." It miscounts because the copy is frozen, not because it tracks a streak.
2. **No sense of magnitude.** A 2-guess genius win and a scraped-by 6-guess win pull from the same flat `win` bank and sound identical. Big mistakes sound like routine ones.
3. **Wins feel silent.** Routine and big moments get equal voice airtime, so nothing stands out; the player can't feel a big moment land.

## Goal

Replace round-robin with a **severity-scored, tier-bucketed, frequency-budgeted** selection engine. Big moments (genius/clutch wins, 3+ green bursts, sloppy mistakes) get louder treatment; routine chatter (wrong/invalid) gets rarer voice so the big stuff lands by contrast. All thresholds live in **data** so Subsystem B becomes a UI over this config, not a rewrite.

## Design

### 1. Config object — the contract with B

New `companion.react` block, defaults baked into `yang.js`, per-room overridable later:

```js
react: {
  voiceBudget: { routine: 0.33 },     // routine events speak ~1 in 3; big moments + win/loss always speak
  tiers: {
    win:     { genius: { maxGuesses: 2 }, clutch: { minGuesses: 6 } },  // neither matched → "solid"
    greens:  { thresholds: [2, 3, 4, 5] },                              // line bucket = actual count
    mistake: { sloppy: { repeatedKnownGray: true } },                   // else → "wrong"
  },
}
```

### 2. Tier-bucketed line banks

`companion.lines` gains nested tiers where magnitude matters; flat elsewhere:

```js
lines: {
  invalid: [ ... ],                                  // flat
  wrong:   [ ... ],                                  // flat (routine baseline)
  mistake: { sloppy: [ ... ] },                      // big
  win:     { genius: [...], clutch: [...], solid: [...] },
  greens:  { "2": [...], "3": [...], "4": [...], "5": [...] },
  loss:    [ ... ],                                  // flat
  idle:    [ ... ],                                  // flat
}
```

- **Reuse existing line strings** wherever possible so existing pre-rendered clips (keyed by `lineKey(text)`) stay valid. The current `rush` bank seeds `greens["2"]`; new tier lines fall back to `speechSynthesis` until rendered.
- Today's flat `win` bank seeds `win.solid`; write fresh `genius`/`clutch` lines.

### 3. Severity scoring — new `public/companion.js` (pure, testable)

Stateless functions, no DOM, no imports from app.js:

```js
scoreWin(guessesUsed, cfg)      → "genius" | "clutch" | "solid"
scoreGreens(newGreenCount, cfg) → "2" | "3" | "4" | "5"   (clamped to configured thresholds)
scoreMistake(ctx, cfg)          → "sloppy" | "wrong"      (sloppy when the guess reused a known dead letter)
shouldSpeak(event, tier, cfg, rng) → boolean              (big & win/loss always true; routine gated by voiceBudget.routine)
```

`scoreMistake` reads from the guess context: a guess is **sloppy** if it contains any letter already known gray that round. Source signal already exists — `game.deadLetterReuse` (`app.js:399`) tracks reused dead letters per game; the engine just needs the boolean "did this guess reuse a known-dead letter."

### 4. Selection — `companionReact(event, ctx)` rewrite

1. Resolve the line bank for `event`. If nested (object of tiers), score `ctx` → tier → that tier's array; if flat, use as-is.
2. Round-robin **within the chosen tier** (per-tier counter keyed `event:tier`) so no immediate repeats.
3. Substitute `{answer}` as today.
4. Return `{ text, raw, speak }` where `speak = shouldSpeak(...) && voice.on && !muted`.

### 5. Loudness expression (in `app.js`)

| Tier | Voice | Visual / audio |
|------|-------|----------------|
| Routine (`wrong`, `invalid`) | gated ~1 in 3 | toast always shows; existing chime |
| Big greens (3/4/5) | always | confetti count scales with greens; richer ascending chime; longer toast |
| Big greens (2) | always | current confetti(28) + chime |
| `win` genius / clutch | always | larger confetti burst + triumphant chime + longer toast |
| `win` solid, `loss` | always | current treatment |
| `mistake` sloppy | always | distinct "called-out" toast styling (longer duration); muted thud chime |

`celebrateGreens` passes the **real** `count` into the `greens` event so the line matches the number. A win reaction passes `guessesUsed`; a wrong-guess reaction passes the sloppy boolean.

### 6. Files touched

- `public/companion.js` — **new.** Pure scoring + selection + `shouldSpeak`. The unit-tested core.
- `public/edition.js` — `companionReact` delegates tier resolution to `companion.js`; keeps `{answer}` substitution + mute check.
- `public/editions/yang.js` — add `react` config; re-bucket `win`/`rush`→`greens`/`mistake` line banks; author `genius`/`clutch`/`3-5 greens`/`sloppy` lines.
- `public/app.js` — `celebrateGreens(count)` passes real count to a `greens` event (replaces `rush`); win path passes `guessesUsed`; wrong path passes sloppy boolean; scale confetti/chime/toast per tier.
- `scripts/voice/render.mjs` — flatten **nested** line banks (recurse objects, not just `Object.values().flat()`) so all tier lines render.
- `test/companion.test.ts` — **new.** TDD target.

### 7. Testing (TDD on `companion.js`)

- `scoreWin`: 1→genius, 2→genius, 3→solid, 5→solid, 6→clutch (boundary at maxGuesses/minGuesses).
- `scoreGreens`: 2→"2", 3→"3", 5→"5", 6→"5" (clamp).
- `scoreMistake`: reused dead letter → sloppy; clean wrong guess → wrong.
- `shouldSpeak`: win/loss/big always true; routine respects budget with a seeded rng (deterministic).
- Selection: round-robins within a tier without immediate repeat; nested vs flat banks both resolve.

No audio clips required for any test.

## Non-goals (deferred)

- The web UI to edit this config (Subsystem B).
- Triggering local voice render from the site (C) and browser voice cloning (D).
- Per-room *storage/override* of the config — A bakes defaults into `yang.js`; B introduces persistence. A only needs the config to be a plain data object that an override could later merge into.

## Default decisions (locked unless changed)

- Routine voice frequency = **0.33** (~1 in 3). Big moments + win/loss always speak.
- `genius` = solved in ≤2 guesses; `clutch` = solved on the final (6th) guess; everything else = `solid`.
- Green tiers = 2/3/4/5; a 2-green burst is still "big" (always speaks) but keeps current spectacle.
