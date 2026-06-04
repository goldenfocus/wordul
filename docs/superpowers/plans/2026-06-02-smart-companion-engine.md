# Smart Companion Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the companion's dumb round-robin line picker with a severity-scored, tier-bucketed, frequency-budgeted engine so big wins/mistakes/green-bursts land loud, routine chatter goes rare, and the loss reveal is spoken half by Yan's cloned voice and half by a robotic browser voice.

**Architecture:** A new pure module `public/companion.js` holds all scoring/selection logic (no DOM, no storage — fully unit-testable). `edition.js`'s `companionReact` delegates tier resolution to it. `yang.js` carries the tier-bucketed line banks + a `react` config object (the future contract for the web studio). `app.js` passes real magnitude data (green count, guesses used, sloppy flag) into events and scales the spectacle. `voice.js` gains a split-voice player for templated lines. `render.mjs` learns to walk nested banks and render templated segments.

**Tech Stack:** Vanilla ES modules (browser), Vitest (tests import `public/*.js` via `/`-aliases in `vitest.config.ts`), golden-voice CLI for clip rendering.

**⚠️ Concurrency:** Another colony session is actively editing `public/app.js`. Execute this plan in a **fresh git worktree off latest `origin/main`** (`superpowers:using-git-worktrees`). Re-grep the `showCompanion(...)`/`celebrateGreens(...)` call sites before editing `app.js` — line numbers in this plan are indicative, symbol names are authoritative.

---

## File Structure

- **Create** `public/companion.js` — pure scoring + selection: `scoreWin`, `scoreGreens`, `scoreMistake`, `shouldSpeak`, `resolveTier`, `splitTemplate`. One responsibility: decide *which tier* and *which line* and *whether to speak*. No side effects.
- **Create** `test/companion.test.js` — unit tests for every function above.
- **Modify** `public/editions/yang.js` — add `companion.react` config; re-bucket `win` and `rush`→`greens`/`wrong` line banks; author new tier lines.
- **Modify** `public/edition.js` — `companionReact` delegates to `companion.js`.
- **Modify** `public/voice.js` — add `speakRobotic(word)` + `speakTemplated(editionId, rawLine, ctx)`.
- **Modify** `public/app.js` — feed real magnitude into events; scale confetti/chime/toast; route templated loss line through `speakTemplated`.
- **Modify** `scripts/voice/render.mjs` — recurse nested banks; render `{answer}`-split segments instead of skipping templated lines.
- **Modify** `vitest.config.ts` — add `/companion.js` alias.

---

## Task 1: The pure engine — `public/companion.js`

**Files:**
- Create: `public/companion.js`
- Create: `test/companion.test.js`
- Modify: `vitest.config.ts` (add alias)

- [ ] **Step 1: Add the vitest alias so tests can import `/companion.js`**

In `vitest.config.ts`, inside the `resolve.alias` array, add (next to the `/voice.js` line):

```js
      { find: /^\/companion\.js$/, replacement: new URL("./public/companion.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing test file**

Create `test/companion.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  scoreWin, scoreGreens, scoreMistake, shouldSpeak, resolveTier, splitTemplate,
} from "/companion.js";

// Mirrors yang.js's react config; kept local so the engine is tested against a
// known shape, not whatever the edition currently ships.
const cfg = {
  voiceBudget: { routine: 0.33 },
  win: { genius: { maxGuesses: 2 }, clutch: { minGuesses: 6 } },
  greens: { thresholds: [2, 3, 4, 5] },
  mistake: { sloppy: { repeatedKnownGray: true } },
};

describe("scoreWin", () => {
  it("1-2 guesses is genius", () => {
    expect(scoreWin(1, cfg)).toBe("genius");
    expect(scoreWin(2, cfg)).toBe("genius");
  });
  it("3-5 guesses is solid", () => {
    expect(scoreWin(3, cfg)).toBe("solid");
    expect(scoreWin(5, cfg)).toBe("solid");
  });
  it("6th-guess win is clutch", () => {
    expect(scoreWin(6, cfg)).toBe("clutch");
  });
});

describe("scoreGreens", () => {
  it("buckets by the real count", () => {
    expect(scoreGreens(2, cfg)).toBe("2");
    expect(scoreGreens(3, cfg)).toBe("3");
    expect(scoreGreens(5, cfg)).toBe("5");
  });
  it("clamps above the top threshold", () => {
    expect(scoreGreens(6, cfg)).toBe("5");
  });
  it("clamps below the bottom threshold", () => {
    expect(scoreGreens(1, cfg)).toBe("2");
  });
});

describe("scoreMistake", () => {
  it("is sloppy when a known dead letter was reused", () => {
    expect(scoreMistake({ reusedDeadLetter: true }, cfg)).toBe("sloppy");
  });
  it("is normal for a clean wrong guess", () => {
    expect(scoreMistake({ reusedDeadLetter: false }, cfg)).toBe("normal");
    expect(scoreMistake({}, cfg)).toBe("normal");
  });
});

describe("shouldSpeak", () => {
  const never = () => 1, always = () => 0; // rng() >= p → silent; rng() < p → speak
  it("always speaks big moments + wins + losses", () => {
    expect(shouldSpeak("win", "genius", cfg, never)).toBe(true);
    expect(shouldSpeak("loss", null, cfg, never)).toBe(true);
    expect(shouldSpeak("greens", "4", cfg, never)).toBe(true);
    expect(shouldSpeak("wrong", "sloppy", cfg, never)).toBe(true);
  });
  it("gates a normal wrong guess + invalid by the routine budget", () => {
    expect(shouldSpeak("wrong", "normal", cfg, never)).toBe(false);
    expect(shouldSpeak("wrong", "normal", cfg, always)).toBe(true);
    expect(shouldSpeak("invalid", null, cfg, never)).toBe(false);
    expect(shouldSpeak("invalid", null, cfg, always)).toBe(true);
  });
});

describe("resolveTier", () => {
  it("maps each scored event to its tier", () => {
    expect(resolveTier("win", { guessesUsed: 2 }, cfg)).toBe("genius");
    expect(resolveTier("greens", { count: 3 }, cfg)).toBe("3");
    expect(resolveTier("wrong", { reusedDeadLetter: true }, cfg)).toBe("sloppy");
    expect(resolveTier("wrong", { reusedDeadLetter: false }, cfg)).toBe("normal");
  });
  it("returns null for flat banks", () => {
    expect(resolveTier("invalid", {}, cfg)).toBeNull();
    expect(resolveTier("idle", {}, cfg)).toBeNull();
    expect(resolveTier("loss", { answer: "CRANE" }, cfg)).toBeNull();
  });
});

describe("splitTemplate", () => {
  it("splits a {answer} line into trimmed prefix + suffix", () => {
    expect(splitTemplate("The word was {answer}.")).toEqual({ prefix: "The word was", suffix: "." });
  });
  it("handles a missing token (whole line is the prefix)", () => {
    expect(splitTemplate("No token here")).toEqual({ prefix: "No token here", suffix: "" });
  });
  it("handles a trailing token (empty suffix)", () => {
    expect(splitTemplate("It was {answer}")).toEqual({ prefix: "It was", suffix: "" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/companion.test.js`
Expected: FAIL — cannot resolve module `/companion.js` (file does not exist yet).

- [ ] **Step 4: Implement `public/companion.js`**

Create `public/companion.js`:

```js
// Pure companion line scoring + selection. No DOM, no localStorage — every
// function is deterministic given its inputs, so the whole engine is unit-tested
// without a browser. edition.js wires this to the active edition's line banks;
// the web studio (subsystem B) will later edit the same `react` config shape.

// How big was the win? genius (fast), clutch (last-gasp), or solid (the rest).
export function scoreWin(guessesUsed, cfg = {}) {
  if (cfg.win?.genius && guessesUsed <= cfg.win.genius.maxGuesses) return "genius";
  if (cfg.win?.clutch && guessesUsed >= cfg.win.clutch.minGuesses) return "clutch";
  return "solid";
}

// Which green-burst bucket — the line always matches the real count (kills the
// hardcoded "two" bug). Clamped to the configured thresholds.
export function scoreGreens(count, cfg = {}) {
  const thresholds = cfg.greens?.thresholds ?? [2, 3, 4, 5];
  const lo = thresholds[0], hi = thresholds[thresholds.length - 1];
  return String(Math.max(lo, Math.min(hi, count)));
}

// A wrong guess is "sloppy" when it reused a letter already known dead this round
// (the same signal the gold economy penalizes); otherwise it's a "normal" miss.
export function scoreMistake(ctx = {}, cfg = {}) {
  if (cfg.mistake?.sloppy?.repeatedKnownGray && ctx.reusedDeadLetter) return "sloppy";
  return "normal";
}

// Should this reaction actually speak aloud? Big moments, wins, and losses always
// do. A normal wrong guess and an invalid word are the only "routine" events, and
// they speak only `voiceBudget.routine` of the time so voice stays a scarce, loud
// resource. rng is injectable for deterministic tests.
export function shouldSpeak(event, tier, cfg = {}, rng = Math.random) {
  const routine = event === "invalid" || (event === "wrong" && tier === "normal");
  if (!routine) return true;
  return rng() < (cfg.voiceBudget?.routine ?? 1);
}

// Resolve the tier key to read within an event's bank. Returns null for flat
// banks (invalid, idle, loss), where the caller uses the array directly.
export function resolveTier(event, ctx = {}, cfg = {}) {
  switch (event) {
    case "win": return scoreWin(ctx.guessesUsed ?? 99, cfg);
    case "greens": return scoreGreens(ctx.count ?? 2, cfg);
    case "wrong": return scoreMistake(ctx, cfg);
    default: return null;
  }
}

// Split a templated line on {answer} into a trimmed prefix + suffix, so the prefix
// can play in the cloned voice and the answer can be spoken by the robotic voice.
export function splitTemplate(line, token = "{answer}") {
  const idx = line.indexOf(token);
  if (idx === -1) return { prefix: line, suffix: "" };
  return { prefix: line.slice(0, idx).trim(), suffix: line.slice(idx + token.length).trim() };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/companion.test.js`
Expected: PASS — all describe blocks green.

- [ ] **Step 6: Commit**

```bash
git add public/companion.js test/companion.test.js vitest.config.ts
git commit -m "feat(companion): pure severity-scoring + selection engine"
```

---

## Task 2: Tier-bucketed line banks + react config — `public/editions/yang.js`

**Files:**
- Modify: `public/editions/yang.js`

- [ ] **Step 1: Add the `react` config to the `sound` block's sibling level**

In `yang.js`, the edition object currently has `sound: { voice: {...} }` then `companion: { name, lines }`. Add a `react` key *inside* `companion`, above `lines`:

```js
  companion: {
    name: "Yang",
    react: {
      voiceBudget: { routine: 0.33 },          // normal wrong + invalid speak ~1 in 3
      win: { genius: { maxGuesses: 2 }, clutch: { minGuesses: 6 } },
      greens: { thresholds: [2, 3, 4, 5] },
      mistake: { sloppy: { repeatedKnownGray: true } },
    },
    lines: {
      // ... existing + re-bucketed banks below
    },
  },
```

- [ ] **Step 2: Re-bucket `win` into genius/clutch/solid**

Replace the existing flat `win: [ ... ]` array with:

```js
      win: {
        genius: [
          "Two guesses. Are you cheating, or just terrifying?",
          "Solved it before the kettle boiled. Show-off.",
          "That was indecently fast. I'm a little scared.",
          "Genius detected. The grid never stood a chance.",
        ],
        clutch: [
          "Last guess. LAST guess. My heart can't take you.",
          "Down to the wire and you stuck the landing.",
          "On the final breath, you found it. Iconic.",
          "Sweaty, dramatic, perfect. Sixth-guess hero.",
        ],
        solid: [
          "Solved. I'm appropriately impressed.",
          "You won. Don't make it weird.",
          "Right answer. I had my doubts.",
          "Nailed it, you beautiful overthinker.",
          "And there it is. The specimen has triumphed.",
          "The puzzle bows to you now.",
          "Case closed. You cracked it like a pro.",
          "Clean. Effortless. A little smug, even.",
          "Look at you, suddenly a genius.",
        ],
      },
```

- [ ] **Step 3: Replace `rush` with a tier-bucketed `greens` bank**

Delete the entire `rush: [ ... ]` array and add `greens` (the old "two" lines seed the `"2"` bucket; 3/4/5 are new and scale with the count):

```js
      greens: {
        "2": [
          "Two greens in one swing, look at you go.",
          "Double green, baby. That was no accident.",
          "Two locked in. The board is shaking.",
          "Two in one. Absolutely filthy guess.",
          "Double the green, double the swagger.",
        ],
        "3": [
          "THREE greens at once. Who are you?",
          "Triple green. The board is begging for mercy.",
          "Three in one swing. That's just rude now.",
          "Hat trick. Greens everywhere. I'm dizzy.",
        ],
        "4": [
          "FOUR greens. This is basically a robbery.",
          "Four at once. Leave some word for the rest of us.",
          "Quadruple green. The puzzle has filed a complaint.",
          "Four greens in one guess. Absolutely unhinged.",
        ],
        "5": [
          "FIVE GREENS. You solved it in one breath.",
          "All five. In one swing. I need to sit down.",
          "A perfect line. The grid just surrendered.",
          "Five greens at once. That's not a guess, that's a flex.",
        ],
      },
```

- [ ] **Step 4: Re-bucket `wrong` into normal/sloppy**

Replace the flat `wrong: [ ... ]` array with (existing lines seed `normal`; `sloppy` is new and pointed):

```js
      wrong: {
        normal: [
          "Wrong, but confidently wrong.",
          "A valid word. Sadly, the wrong one.",
          "Swing and a miss, my favorite person.",
          "The board says no, the heart says aww.",
          "Not it, but you tried with your whole chest.",
          "You learn the word by what it is not.",
          "That door was locked too. Keep knocking.",
          "Nope, and yet I'm proud of the reasoning.",
          "Nope. Take your time, I've got all day.",
          "Wrong word, right instincts. Keep going.",
        ],
        sloppy: [
          "You reused a dead letter. We KNEW that one was out.",
          "That letter's already in the graveyard, love. Focus.",
          "Recycling greys now? The clues are right there.",
          "We ruled that letter out together. Pay attention.",
          "Sloppy. You had that information and spent it anyway.",
        ],
      },
```

- [ ] **Step 5: Verify the file still parses (no test yet — covered in Task 3)**

Run: `node -e "import('./public/editions/yang.js').then(m => console.log(Object.keys(m.edition.companion.lines)))"`
Expected: prints `[ 'invalid', 'wrong', 'win', 'loss', 'idle', 'greens' ]` (order may vary; `rush` must be gone).

- [ ] **Step 6: Commit**

```bash
git add public/editions/yang.js
git commit -m "feat(companion): tier-bucket Yang's banks + react config"
```

---

## Task 3: Delegate selection — `public/edition.js`

**Files:**
- Modify: `public/edition.js` (`companionReact`)
- Modify: `test/companion.test.js` (add selection integration test)

- [ ] **Step 1: Write a failing integration test for the rewired `companionReact`**

Append to `test/companion.test.js`:

```js
// @vitest-environment jsdom — companionReact reads localStorage for the mute flag.
import { companionReact } from "/edition.js";

describe("companionReact (tiered selection over Yang's banks)", () => {
  it("picks the genius tier for a 2-guess win", () => {
    const r = companionReact("win", { guessesUsed: 2 });
    expect(r.tier).toBe("genius");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.speak).toBe(true);
  });
  it("scales greens to the real count (no more hardcoded 'two')", () => {
    const r = companionReact("greens", { count: 4 });
    expect(r.tier).toBe("4");
    expect(r.text).toContain("FOUR");
  });
  it("always speaks a sloppy mistake but gates normal misses", () => {
    expect(companionReact("wrong", { reusedDeadLetter: true }).speak).toBe(true);
    // normal miss with rng forced silent
    expect(companionReact("wrong", { reusedDeadLetter: false, rng: () => 1 }).speak).toBe(false);
  });
  it("substitutes {answer} in the flat loss bank", () => {
    const r = companionReact("loss", { answer: "CRANE" });
    expect(r.tier).toBeNull();
    expect(r.text).toContain("CRANE");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/companion.test.js -t "tiered selection"`
Expected: FAIL — `r.tier` is undefined and `greens` resolves to the old flat path (or `companionReact` ignores tiers).

- [ ] **Step 3: Rewrite `companionReact` in `public/edition.js`**

Add the import at the top of `public/edition.js` (next to other `/`-imports):

```js
import { resolveTier, shouldSpeak } from "/companion.js";
```

Replace the entire existing `companionReact` function with:

```js
export function companionReact(event, ctx = {}) {
  const ed = getEdition(VOICE_EDITION);
  const react = ed.companion?.react;
  const banks = ed.companion?.lines?.[event];
  if (!banks) return { text: "", raw: "", tier: null, speak: false };

  // Flat bank → use the array; nested bank → resolve the tier and read its array.
  const tier = Array.isArray(banks) ? null : resolveTier(event, ctx, react);
  const bank = Array.isArray(banks) ? banks : (banks[tier] ?? []);
  if (bank.length === 0) return { text: "", raw: "", tier, speak: false };

  // Round-robin within the chosen tier so the same line never repeats back-to-back.
  const counterKey = tier ? `${event}:${tier}` : event;
  const i = (reactCounters[counterKey] = (reactCounters[counterKey] ?? -1) + 1) % bank.length;
  const raw = bank[i];

  let text = raw.replace("{answer}", ctx.answer ?? "that one");
  const muted = localStorage.getItem(LS.muted) === "1";
  const voiceOn = !!ed.sound?.voice?.on && !muted;
  return { text, raw, tier, speak: voiceOn && shouldSpeak(event, tier, react, ctx.rng) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/companion.test.js`
Expected: PASS — both the pure tests and the new selection block.

- [ ] **Step 5: Run the existing edition/yang tests to catch regressions**

Run: `npx vitest run test/edition.test.js test/yang-edition.test.js`
Expected: PASS. If a test asserts the old flat `win`/`rush` shape, update that assertion to the new tiered shape (the lines moved, the data didn't disappear).

- [ ] **Step 6: Commit**

```bash
git add public/edition.js test/companion.test.js
git commit -m "feat(companion): companionReact resolves tiers via the engine"
```

---

## Task 4: Split-voice playback — `public/voice.js`

**Files:**
- Modify: `public/voice.js`

No unit test (depends on `Audio` + `speechSynthesis` sequencing — verified manually in Task 7). `splitTemplate` logic is already covered in Task 1.

- [ ] **Step 1: Add a robotic-voice picker + `speakRobotic`**

In `public/voice.js`, after the `fallbackSpeak` function, add:

```js
// Pick the most mechanical voice the browser offers, so the answer reveal sounds
// deliberately uncanny against Yan's warm frame. Falls back to pitch/rate mangling.
function pickRoboticVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const wanted = ["Zarvox", "Trinoids", "Cellos", "Bad News", "Boing", "Albert"];
  for (const name of wanted) {
    const v = voices.find((x) => x.name && x.name.includes(name));
    if (v) return v;
  }
  return null;
}

function roboticUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = pickRoboticVoice();
  if (v) u.voice = v;
  else { u.pitch = 0.3; u.rate = 0.85; } // no robot voice available → mangle the default
  return u;
}

export function speakRobotic(word) {
  if (!word || !window.speechSynthesis) return;
  try { window.speechSynthesis.speak(roboticUtterance(word)); } catch { /* ignore */ }
}
```

- [ ] **Step 2: Add `speakTemplated` — Yan's frame, robot's word, in sequence**

After `speakRobotic`, add:

```js
// A templated line like "The word was {answer}." spoken in two voices: the static
// frame in Yan's cloned voice (pre-rendered clip, else fallback TTS), the answer in
// the robotic voice. Segments play strictly in order via the audio's `ended` event.
export async function speakTemplated(editionId, rawLine, ctx = {}) {
  if (!rawLine || isMuted()) return;
  const token = "{answer}";
  const idx = rawLine.indexOf(token);
  if (idx === -1) { // not actually templated — fall back to the normal path
    return speakLine(editionId, rawLine, rawLine);
  }
  const prefix = rawLine.slice(0, idx).trim();
  const suffix = rawLine.slice(idx + token.length).trim();
  const map = await loadManifest(editionId);
  if (isMuted()) return;

  // Play one cloned-voice segment, resolving when it finishes (clip end, or TTS end,
  // or immediately if empty / on error). Reuses module-level `current` for stop().
  const playSegment = (seg) => new Promise((resolve) => {
    if (!seg) return resolve();
    const file = map[lineKey(seg)];
    if (file) {
      stopSpeaking();
      try {
        const audio = new Audio(`/voice/${editionId}/${file}`);
        current = { audio };
        audio.addEventListener("ended", resolve, { once: true });
        audio.play().catch(resolve);
      } catch { resolve(); }
    } else {
      try {
        const u = new SpeechSynthesisUtterance(seg);
        u.addEventListener("end", resolve, { once: true });
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    }
  });

  const sayAnswer = () => new Promise((resolve) => {
    if (!ctx.answer || !window.speechSynthesis) return resolve();
    try {
      const u = roboticUtterance(ctx.answer);
      u.addEventListener("end", resolve, { once: true });
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  });

  await playSegment(prefix);
  if (isMuted()) return;
  await sayAnswer();
  if (isMuted()) return;
  await playSegment(suffix);
}
```

- [ ] **Step 3: Sanity-check the module parses**

Run: `node -e "import('./public/voice.js').then(m => console.log(typeof m.speakTemplated, typeof m.speakRobotic))"`
Expected: prints `function function`.

- [ ] **Step 4: Commit**

```bash
git add public/voice.js
git commit -m "feat(voice): split-voice templated playback (Yan + robot)"
```

---

## Task 5: Wire real magnitude into the game — `public/app.js`

**Files:**
- Modify: `public/app.js`

⚠️ Re-grep before editing: `grep -n 'showCompanion(\|celebrateGreens(\|const wasted' public/app.js`.

- [ ] **Step 1: Import `speakTemplated`**

Find the existing import from `/voice.js`:

```js
import { speakLine } from "/voice.js";
```

Replace with:

```js
import { speakLine, speakTemplated } from "/voice.js";
```

- [ ] **Step 2: Route templated lines through the split-voice player in `showCompanion`**

Find `showCompanion` (currently):

```js
function showCompanion(event, ctx) {
  const { text, raw, speak } = companionReact(event, ctx);
  if (!text) return;
  toast(text, { duration: 3200 });
  // Look up the clip by the RAW template; fall back to speaking the substituted text.
  if (speak) speakLine(VOICE_EDITION, raw, text);
}
```

Replace with:

```js
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak } = companionReact(event, ctx);
  if (!text) return;
  // Big moments linger; routine lines stay snappy.
  const big = tier && !(event === "wrong" && tier === "normal");
  toast(text, { duration: big ? 4200 : 3200 });
  if (!speak) return;
  // Templated lines (the loss reveal) split across Yan's voice + the robot.
  if (raw.includes("{answer}")) speakTemplated(VOICE_EDITION, raw, ctx);
  else speakLine(VOICE_EDITION, raw, text);
}
```

- [ ] **Step 3: Feed the real green count + scale the spectacle in `celebrateGreens`**

Find `celebrateGreens` (currently fires `showCompanion("rush")` and a fixed `spawnConfetti(28)`). Replace the whole function with:

```js
// Yang's scaled green celebration. 1 new green → spark + soft chime; 2+ → confetti
// + chime + a hyped voice line whose words match the real count. Respects reduced motion.
function celebrateGreens(count) {
  const reduced = getSettings().reducedMotion;
  const boards = $("#boards");
  if (count >= 2) {
    if (count >= 3) playChime([[523, 0], [659, 0.08], [784, 0.16], [1047, 0.26]]);
    else playChime([[523, 0], [659, 0.09], [784, 0.18]]);
    if (!reduced) spawnConfetti(count >= 3 ? 28 + (count - 2) * 18 : 28); // 3→46, 4→64, 5→82
    showCompanion("greens", { count });
  } else {
    playChime([[660, 0], [880, 0.08]]);
    if (boards && !reduced) {
      boards.classList.remove("green-spark");
      void boards.offsetWidth; // restart the animation
      boards.classList.add("green-spark");
      setTimeout(() => boards.classList.remove("green-spark"), 700);
    }
  }
}
```

- [ ] **Step 4: Pass the sloppy flag on a wrong guess**

Find the wrong-guess call `showCompanion("wrong");`. In the same scope, `wasted` is already computed earlier as `const wasted = wastedDeadLettersInLast(me.guesses);`. Change the call to:

```js
          showCompanion("wrong", { reusedDeadLetter: wasted.length > 0 });
```

(If `wasted` is not in scope at the call site after the colony's edits, compute it inline: `showCompanion("wrong", { reusedDeadLetter: wastedDeadLettersInLast(me.guesses).length > 0 });` — `wastedDeadLettersInLast` is already imported from `/celebrate.js`.)

- [ ] **Step 5: Pass guesses-used on a win**

Find `showCompanion("win");`. In that scope `me.guesses.length` is the guess count (also used nearby as `lastGuessCount`). Change to:

```js
    showCompanion("win", { guessesUsed: me.guesses.length });
```

- [ ] **Step 6: Manual smoke in the browser**

Run: `npm run dev`, open the local URL, join/start a game.
Expected:
- Land 3+ greens in one guess → the spoken line says "THREE/FOUR/FIVE", confetti scales up.
- Win in 2 → a "genius" line; win on the 6th guess → a "clutch" line.
- Lose → "The word was" in Yan's voice, then the answer in a robotic voice.
- A run of plain wrong guesses → mostly silent toasts (voice only ~1/3 of the time); reusing a known-grey letter → an always-spoken "sloppy" call-out.

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat(companion): feed real magnitude + split-voice loss into the game"
```

---

## Task 6: Render nested + templated banks — `scripts/voice/render.mjs`

**Files:**
- Modify: `scripts/voice/render.mjs`

- [ ] **Step 1: Replace the flat line collection with a recursive walk + segment split**

Find:

```js
const lines = [...new Set(Object.values(edition.companion.lines).flat())]
  .filter((l) => !l.includes("{"));
```

Replace with:

```js
// Walk the (now nested) line banks into a flat list of strings.
function collectLines(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) collectLines(n, out);
  else if (node && typeof node === "object") for (const n of Object.values(node)) collectLines(n, out);
  return out;
}

// Static lines render whole. Templated lines ("... {answer} ...") render their
// non-empty segments instead, so the cloned-voice frame is pre-recorded while the
// answer word is spoken live by the robotic browser voice at runtime.
const TOKEN = "{answer}";
const segments = new Set();
for (const line of new Set(collectLines(edition.companion.lines))) {
  const idx = line.indexOf(TOKEN);
  if (!line.includes("{")) { segments.add(line); continue; }
  if (idx === -1) continue; // an unknown token we can't pre-render — skip
  const pre = line.slice(0, idx).trim();
  const suf = line.slice(idx + TOKEN.length).trim();
  if (pre) segments.add(pre);
  if (suf) segments.add(suf);
}
const lines = [...segments];
```

The rest of the script (the render loop over `lines`, manifest write) is unchanged — it already keys each entry by `lineKey(text)`.

- [ ] **Step 2: Dry-run the line collection without invoking golden-voice**

Run: `node -e "import('./public/editions/yang.js').then(({edition})=>{const t='{answer}';const s=new Set();const c=(n,o=[])=>{if(typeof n==='string')o.push(n);else if(Array.isArray(n))n.forEach(x=>c(x,o));else if(n&&typeof n==='object')Object.values(n).forEach(x=>c(x,o));return o};for(const l of new Set(c(edition.companion.lines))){const i=l.indexOf(t);if(!l.includes('{')){s.add(l);continue}if(i<0)continue;const p=l.slice(0,i).trim(),f=l.slice(i+t.length).trim();if(p)s.add(p);if(f)s.add(f)}console.log([...s].filter(x=>x.startsWith('The word was')||x==='.'))})"`
Expected: prints an array containing `"The word was"` and `"."` (the split segments of a loss line) — proving templated lines now contribute renderable segments.

- [ ] **Step 3: Commit**

```bash
git add scripts/voice/render.mjs
git commit -m "feat(voice): render nested banks + templated line segments"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — no regressions in any `test/*.test.{js,ts}`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 3: (Optional, local Mac only) re-render Yang's voice for the new lines**

Only if golden-voice is installed and you want the new tier lines + the "The word was" frame in Yan's actual voice (otherwise they fall back to browser TTS, which is fine to ship):

Run: `npm run voice:render`
Expected: renders the new segments, updates `public/voice/yang/manifest.json`. Commit the new clips + manifest if generated.

- [ ] **Step 4: Final commit (if anything uncommitted)**

```bash
git status   # should be clean, or commit any rendered clips
```

---

## Self-Review Notes

- **Spec coverage:** config object → Task 2 Step 1; tier-bucketed banks → Task 2; scoring functions → Task 1; selection rewrite → Task 3; loudness (visual/audio scaling + rare routine voice) → Task 5 Steps 2-3 + `shouldSpeak`; split-voice loss reveal → Task 4 + Task 5 Step 2; render nested/templated → Task 6.
- **Symbol consistency:** `scoreWin/scoreGreens/scoreMistake/shouldSpeak/resolveTier/splitTemplate` defined in Task 1, consumed identically in Tasks 3. `speakTemplated/speakRobotic` defined in Task 4, imported in Task 5. `greens` event + `count` ctx, `win` + `guessesUsed`, `wrong` + `reusedDeadLetter` consistent across Tasks 1/3/5.
- **`mistake` config key:** `scoreMistake` reads `cfg.mistake.sloppy.repeatedKnownGray`; the config in Task 2 defines `mistake: { sloppy: { repeatedKnownGray: true } }`. The *bank* lives under `wrong.sloppy` (not `mistake`), resolved because `resolveTier("wrong", …)` calls `scoreMistake` → returns `"sloppy"`/`"normal"`, which indexes `wrong.{sloppy,normal}`. Intentional: one `wrong` event, two tiers.
