# Room Sandbox Rung 01 — Config Foundation + Always-Speak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the companion never silent — every valid in-game guess speaks exactly one line on EVERY theme, chosen by a pure priority resolver — and lay the `roomConfig` foundation (`pickGuessEvent` + `mergeConfig`) the rest of the Room Sandbox ladder builds on.

**Architecture:** A new pure, unit-tested module `public/roomConfig.js` holds `pickGuessEvent` (the never-silent priority resolver) and `mergeConfig` (the override merge contract). `edition.js`'s `companionReact` resolves its config through `mergeConfig` over an (empty, this rung) room override — the seam rung 2 fills. `app.js`'s guess-reaction branch calls `pickGuessEvent` instead of the Yang-only gate. A new `progress` line bank gives tier-2 (one green or any yellow) something to say. No server, no snapshot field, no new message — Tier-C, ships today.

**Tech Stack:** Vanilla ES modules (browser), Vitest (tests import `public/*.js` via `/`-aliases in `vitest.config.ts`).

**⚠️ Concurrency:** Other colony sessions edit `public/app.js`. Execute in a **fresh git worktree off latest `origin/main`**. Re-grep the guess-reaction call site before editing `app.js` — symbol names are authoritative, line numbers indicative.

**Specs:** `docs/superpowers/specs/2026-06-02-room-sandbox-01-config-foundation-and-always-speak-design.md` (this rung) + `...-00-architecture-design.md` (the canonical schema — `pickGuessEvent`/`mergeConfig`/`CONFIG_CAPS`/`VoiceConfig` shapes).

---

## File Structure

- **Create** `public/roomConfig.js` — pure config foundation: `pickGuessEvent`, `mergeConfig`, `CONFIG_CAPS`. No DOM, no storage, no imports from `app.js`. One responsibility: decide *which event* a guess fires + how config layers merge.
- **Create** `test/roomConfig.test.ts` — Vitest suites for both functions.
- **Modify** `vitest.config.ts` — add `/roomConfig.js` alias.
- **Modify** `public/editions/yang.js` — add the `progress` line bank.
- **Modify** `public/edition.js` — `companionReact` resolves config via `mergeConfig` over an empty room override (the rung-2 seam).
- **Modify** `public/app.js` — replace the Yang-only guess-reaction gate with `pickGuessEvent`.

---

## Task 1: The pure foundation — `public/roomConfig.js`

**Files:**
- Create: `public/roomConfig.js`
- Create: `test/roomConfig.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the vitest alias**

In `vitest.config.ts`, inside `resolve.alias`, add (next to the `/companion.js` line):
```js
      { find: /^\/roomConfig\.js$/, replacement: new URL("./public/roomConfig.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing test file**

Create `test/roomConfig.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pickGuessEvent, mergeConfig, CONFIG_CAPS } from "/roomConfig.js";

describe("pickGuessEvent — never-silent priority resolver", () => {
  it("greens>=2 fires greens with the real count", () => {
    expect(pickGuessEvent(2, 0, false)).toEqual({ event: "greens", ctx: { count: 2 } });
    expect(pickGuessEvent(5, 1, false)).toEqual({ event: "greens", ctx: { count: 5 } });
  });
  it("one green OR any yellow (and <2 greens) fires progress", () => {
    expect(pickGuessEvent(1, 0, false)).toEqual({ event: "progress", ctx: {} });
    expect(pickGuessEvent(0, 1, false)).toEqual({ event: "progress", ctx: {} });
    expect(pickGuessEvent(1, 3, false)).toEqual({ event: "progress", ctx: {} });
  });
  it("a clean nothing-found guess fires wrong, carrying the sloppy flag", () => {
    expect(pickGuessEvent(0, 0, true)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: true } });
    expect(pickGuessEvent(0, 0, false)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: false } });
  });
  it("priority override lets scolding win over a green burst", () => {
    const voice = { priority: ["wrong", "greens", "progress"] };
    expect(pickGuessEvent(3, 0, false, voice)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: false } });
  });
  it("a disabled event is skipped as a priority slot", () => {
    const voice = { events: { progress: false } };
    expect(pickGuessEvent(0, 1, false, voice)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: false } });
  });
  it("never silent: even with every guess event muted, wrong is the terminal fallback", () => {
    const voice = { events: { greens: false, progress: false, wrong: false } };
    expect(pickGuessEvent(5, 5, true, voice)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: true } });
  });
});

// A representative voice override config used as the merge base in several tests.
const yangVoice = {
  voice: {
    talkativeness: 0.33,
    events: { greens: true },
    priority: ["greens", "progress", "wrong"],
    react: {
      voiceBudget: { routine: 0.33, progress: 1 },
      win: { genius: { maxGuesses: 2 }, clutch: { minGuesses: 6 } },
      greens: { thresholds: [2, 3, 4, 5] },
      mistake: { sloppy: { repeatedKnownGray: true } },
    },
    lines: { wrong: { normal: ["a", "b"], sloppy: ["s"] }, progress: ["p1"] },
  },
};

describe("mergeConfig — the override merge contract", () => {
  it("default-preserving: merging with an empty override returns the base unchanged", () => {
    expect(mergeConfig(yangVoice, {})).toEqual(yangVoice);
  });
  it("sections fall through independently", () => {
    const out = mergeConfig({ voice: { talkativeness: 1 } }, { palette: {} });
    expect(out.voice).toEqual({ talkativeness: 1 });
    expect(out.palette).toEqual({});
  });
  it("voice keys shallow-replace; absent keys fall through", () => {
    const out = mergeConfig({ voice: { talkativeness: 0.33, events: { greens: true } } },
                            { voice: { talkativeness: 1 } });
    expect(out.voice.talkativeness).toBe(1);
    expect(out.voice.events).toEqual({ greens: true });
  });
  it("react deep-merges by sub-key (override one tier, keep the rest)", () => {
    const out = mergeConfig(yangVoice, { voice: { react: { win: { genius: { maxGuesses: 1 } } } } });
    expect(out.voice.react.win.genius.maxGuesses).toBe(1);
    expect(out.voice.react.greens.thresholds).toEqual([2, 3, 4, 5]);
    expect(out.voice.react.voiceBudget.routine).toBe(0.33);
  });
  it("voiceBudget deep-merges (override progress, keep routine)", () => {
    const out = mergeConfig(yangVoice, { voice: { react: { voiceBudget: { progress: 0.5 } } } });
    expect(out.voice.react.voiceBudget).toEqual({ routine: 0.33, progress: 0.5 });
  });
  it("events shallow-merge key-by-key; priority replaces wholesale", () => {
    const out = mergeConfig({ voice: { events: { greens: true, wrong: true }, priority: ["greens"] } },
                            { voice: { events: { progress: false }, priority: ["wrong"] } });
    expect(out.voice.events).toEqual({ greens: true, wrong: true, progress: false });
    expect(out.voice.priority).toEqual(["wrong"]);
  });
  it("line banks APPEND by default", () => {
    const out = mergeConfig({ voice: { lines: { wrong: { normal: ["A"] } } } },
                            { voice: { lines: { wrong: { normal: ["B"] } } } });
    expect(out.voice.lines.wrong.normal).toEqual(["A", "B"]);
  });
  it("a {replace} wrapper discards the base bank", () => {
    const out = mergeConfig({ voice: { lines: { wrong: { normal: ["A"] } } } },
                            { voice: { lines: { wrong: { normal: { replace: ["B"] } } } } });
    expect(out.voice.lines.wrong.normal).toEqual(["B"]);
  });
  it("a flat bank appends too", () => {
    const out = mergeConfig({ voice: { lines: { progress: ["A"] } } },
                            { voice: { lines: { progress: ["B", "C"] } } });
    expect(out.voice.lines.progress).toEqual(["A", "B", "C"]);
  });
  it("a merged bank is truncated to CONFIG_CAPS.bankMax", () => {
    const base = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const over = Array.from({ length: 10 }, (_, i) => `b${i}`);
    const out = mergeConfig({ voice: { lines: { progress: base } } },
                            { voice: { lines: { progress: over } } });
    expect(out.voice.lines.progress.length).toBe(CONFIG_CAPS.bankMax);
    expect(out.voice.lines.progress[0]).toBe("a0");
  });
  it("preset provenance: the last non-empty layer wins", () => {
    expect(mergeConfig({ preset: "quiet" }, { preset: "gremlin" }).preset).toBe("gremlin");
  });
});
```

- [ ] **Step 3: Run the tests — verify they FAIL**

Run: `cd /Users/vibeyang/wordle/.worktrees/<wt> && npx vitest run test/roomConfig.test.ts`
Expected: FAIL — cannot resolve `/roomConfig.js`.

- [ ] **Step 4: Implement `public/roomConfig.js`**

Create `public/roomConfig.js`:
```js
// The Room Sandbox config foundation. PURE — no DOM, no localStorage, no imports
// from app.js. Two functions ship this rung: pickGuessEvent (the never-silent
// guess-reaction resolver) and mergeConfig (the override merge contract). Both are
// the canonical implementations from the Room Sandbox architecture spec (rung 00);
// everything else in that schema (presets, diff, sanitize) is deferred to the rung
// that consumes it. roomConfig is an OVERRIDE delta: {} means "pure edition default".

// Limit constants from the Keystone. Rung 1 reads only bankMax (capping merged banks).
export const CONFIG_CAPS = { historyMax: 50, bankMax: 24, lineMax: 140 };

// ── pickGuessEvent ───────────────────────────────────────────────────────────
// Resolve a valid guess to exactly ONE companion event, by priority. Never silent:
// even if every guess event is toggled off, the terminal `wrong` fallback fires.
//   greens   — newGreens >= 2            → ctx.count = real green count (kills the "two" bug)
//   progress — one green OR any yellow    → modest positive
//   wrong    — anything else / fallback   → carries the sloppy-reuse flag
// `voice` is the merged voice override (optional). Rung 1 always passes {}; the param
// exists now so rung 2 wires the real override with no signature change.
export function pickGuessEvent(ng, ny, reusedDeadLetter, voice = {}) {
  const priority = voice.priority ?? ["greens", "progress", "wrong"];
  for (const event of priority) {
    if (voice.events?.[event] === false) continue;          // disabled as a priority slot
    if (event === "greens" && ng >= 2) return { event: "greens", ctx: { count: ng } };
    if (event === "progress" && (ng === 1 || ny >= 1)) return { event: "progress", ctx: {} };
    if (event === "wrong") return { event: "wrong", ctx: { reusedDeadLetter } };
  }
  return { event: "wrong", ctx: { reusedDeadLetter } };      // terminal fallback — always speaks
}

// ── mergeConfig ──────────────────────────────────────────────────────────────
// Merge override layers left→right (later wins) into a resolved RoomConfig.
// Locked rules (Keystone §Merge semantics):
//  1. sections fall through independently;
//  2. voice keys shallow-replace, EXCEPT voice.react deep-merges by sub-key
//     (voiceBudget/win/greens/mistake), and voice.events shallow-merges key-by-key;
//  3. voice.priority replaces wholesale;
//  4. line banks APPEND unless wrapped { replace: [...] };
//  5. other sections (palette/…/preset) replace wholesale (stubs this rung).
// Guarantee: mergeConfig(base, {}) deep-equals base.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const cap = (arr) => arr.slice(0, CONFIG_CAPS.bankMax);
const NESTED_LINE_EVENTS = new Set(["wrong", "win", "greens"]);

// Deep-merge react by sub-key: each direct sub-key (voiceBudget/win/greens/mistake)
// shallow-merges one more level so retuning one tier keeps the others.
function mergeReact(base = {}, over = {}) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? { ...base[k], ...over[k] } : over[k];
  }
  return out;
}

// One leaf bank: base is string[]|undefined; over is string[]|{replace}|undefined.
function mergeBank(base, over) {
  if (over == null) return base;
  if (isObj(over) && Array.isArray(over.replace)) return cap(over.replace.slice());
  const b = Array.isArray(base) ? base : [];
  const o = Array.isArray(over) ? over : [];
  return cap(b.concat(o));
}

function mergeLineBanks(base = {}, over = {}) {
  const out = { ...base };
  for (const ev of Object.keys(over)) {
    if (NESTED_LINE_EVENTS.has(ev)) {
      const bsub = base[ev] || {}, osub = over[ev] || {};
      const merged = { ...bsub };
      for (const tier of Object.keys(osub)) merged[tier] = mergeBank(bsub[tier], osub[tier]);
      out[ev] = merged;
    } else {
      out[ev] = mergeBank(base[ev], over[ev]);
    }
  }
  return out;
}

function mergeVoice(base = {}, over = {}) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (k === "react") out.react = mergeReact(base.react, over.react);
    else if (k === "lines") out.lines = mergeLineBanks(base.lines, over.lines);
    else if (k === "events") out.events = { ...(base.events || {}), ...over.events };
    else out[k] = over[k]; // talkativeness, priority (wholesale), voiceEdition, preset
  }
  return out;
}

export function mergeConfig(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const section of Object.keys(layer)) {
      if (section === "voice") out.voice = mergeVoice(out.voice, layer.voice);
      else out[section] = layer[section]; // sections fall through / replace (stubs this rung)
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests — verify they PASS**

Run: `npx vitest run test/roomConfig.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add public/roomConfig.js test/roomConfig.test.ts vitest.config.ts
git commit -m "feat(sandbox): roomConfig foundation — pickGuessEvent + mergeConfig"
```

---

## Task 2: The `progress` line bank — `public/editions/yang.js`

**Files:**
- Modify: `public/editions/yang.js`

- [ ] **Step 1: Add the `progress` bank**

Read `public/editions/yang.js`. Find `companion.lines` (it has `invalid`, `wrong`, `win`, `loss`, `idle`, `greens`). Add a flat `progress` array as a sibling of `idle` (placement is cosmetic; keep it inside `lines`):
```js
      progress: [
        "Ooh, something stuck. We're getting warmer.",
        "There it is, a thread to pull. Keep tugging.",
        "Progress, my favorite person. The word's nervous now.",
        "A little color on the board. I like where this goes.",
        "Yes, that one's talking. Follow it.",
        "Warmer. The puzzle just blinked first.",
        "Now we're cooking. Don't lose the scent.",
        "A clue lands. Quietly thrilling, isn't it?",
        "That's a real lead. Work it, detective.",
        "Mmm, movement. The grid is starting to crack.",
      ],
```
These are TTS-clean (≤80 chars, only `[A-Za-z0-9 ,.'?-]` + em dash, no `{answer}`), so the existing `yang-edition.test.js` "TTS-clean" recursive check passes. `progress` is a flat bank: `resolveTier` returns `null` for it (its `default` case), and it is not a routine event, so `shouldSpeak` returns `true` — no change needed to `companion.js`.

- [ ] **Step 2: Verify the file parses and the bank is present**

Run: `node -e "import('./public/editions/yang.js').then(m => console.log(m.edition.companion.lines.progress.length))"`
Expected: prints `10`.

- [ ] **Step 3: Run the existing edition tests (no regressions)**

Run: `npx vitest run test/yang-edition.test.js test/edition.test.js`
Expected: PASS (the recursive TTS-clean + non-empty-bank checks now also cover `progress`).

- [ ] **Step 4: Commit**

```bash
git add public/editions/yang.js
git commit -m "feat(sandbox): add Yang's progress line bank (tier-2 voice)"
```

---

## Task 3: Resolve config through the merge seam — `public/edition.js`

**Files:**
- Modify: `public/edition.js` (`companionReact` + a stub)
- Modify: `test/companion.test.js` (regression guard for the merge seam)

- [ ] **Step 1: Add a regression test that progress speaks and defaults are preserved**

Append to `test/companion.test.js` (it already has `// @vitest-environment jsdom` at line 1 and imports `companionReact` from `/edition.js`):
```js
describe("companionReact through the mergeConfig seam (rung 1)", () => {
  it("returns a spoken progress line (flat bank, not routine)", () => {
    const r = companionReact("progress", {});
    expect(r.tier).toBeNull();
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.speak).toBe(true);
  });
  it("still resolves the existing tiered banks (genius win) unchanged", () => {
    const r = companionReact("win", { guessesUsed: 2 });
    expect(r.tier).toBe("genius");
    expect(r.text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it — verify the progress test FAILS**

Run: `npx vitest run test/companion.test.js -t "mergeConfig seam"`
Expected: FAIL — `companionReact("progress")` currently finds no `progress` handling path returns text only if the bank exists; it will fail until the merge wiring + Task 2 bank are both in. (Task 2 added the bank; this task wires the merge.) If it already passes because the bank exists and the current code reads `ed.companion.lines.progress` directly, proceed — Step 3 still installs the seam rung 2 depends on, and the test must stay green.

- [ ] **Step 3: Wire `companionReact` through `mergeConfig`**

In `public/edition.js`, add the import near the existing `/companion.js` import:
```js
import { mergeConfig } from "/roomConfig.js";
```
Add a module-level stub (near the top, by `reactCounters`) — the single seam rung 2 fills:
```js
// Rung 1: no per-room override exists yet, so the room voice config is empty and
// companionReact resolves byte-for-byte to the edition default. Rung 2 returns
// `currentSnapshot?.roomConfig?.voice ?? {}` here — the ONE place persistence wires in.
function snapshotVoiceConfig() { return {}; }
```
Replace the start of `companionReact` — change these two lines:
```js
  const ed = getEdition(VOICE_EDITION);
  const react = ed.companion?.react;
  const banks = ed.companion?.lines?.[event];
```
to:
```js
  const ed = getEdition(VOICE_EDITION);
  // Resolve config through the merge contract: edition default <- room override (empty in rung 1).
  const merged = mergeConfig(
    { voice: { react: ed.companion?.react ?? {}, lines: ed.companion?.lines ?? {} } },
    { voice: snapshotVoiceConfig() },
  );
  const react = merged.voice?.react;
  const banks = merged.voice?.lines?.[event];
```
Leave the rest of `companionReact` (the `if (!banks)` guard, `resolveTier`, round-robin, `{answer}` substitution, `shouldSpeak`) exactly as-is. With an empty override, `react` deep-equals `ed.companion.react` and `banks` deep-equals `ed.companion.lines[event]` — the default-preserving guarantee in live code.

- [ ] **Step 4: Run the companion + edition tests — verify PASS**

Run: `npx vitest run test/companion.test.js test/edition.test.js test/yang-edition.test.js`
Expected: PASS (including the new "mergeConfig seam" block).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/companion.test.js
git commit -m "feat(sandbox): companionReact resolves config via mergeConfig seam"
```

---

## Task 4: Never-silent guess reaction — `public/app.js`

**Files:**
- Modify: `public/app.js`

⚠️ Re-grep first: `grep -n 'celebrateGreens(ng)\|discoveries === 0\|from "/edition.js"\|const ny\b' public/app.js`

- [ ] **Step 1: Import `pickGuessEvent`**

Find the import from `/edition.js` (it imports `companionReact`, `VOICE_EDITION`, etc.). Add a new import line beneath it:
```js
import { pickGuessEvent } from "/roomConfig.js";
```

- [ ] **Step 2: Replace the Yang-only guess-reaction gate**

Find this block (currently ~lines 1007-1012; `ng`, `ny`, `wasted.letters`, `flipDoneMs` are all in scope above it):
```js
        // Yang keeps its green party; other editions only get nudged on a dud guess.
        if (getActiveEditionId() === "yang" && ng >= 1) {
          setTimeout(() => celebrateGreens(ng), flipDoneMs);
        } else if (discoveries === 0) {
          showCompanion("wrong", { reusedDeadLetter: wasted.letters.length > 0 });
        }
```
Replace it with:
```js
        // Never silent: every accepted guess resolves to exactly ONE companion event,
        // on EVERY edition. Yang's green confetti stays Yang-only + cosmetic; voice is global.
        const { event: guessEvent, ctx: guessCtx } = pickGuessEvent(ng, ny, wasted.letters.length > 0);
        if (getActiveEditionId() === "yang" && guessEvent === "greens") {
          setTimeout(() => celebrateGreens(ng), flipDoneMs); // celebrateGreens internally showCompanion("greens",{count})
        } else {
          setTimeout(() => showCompanion(guessEvent, guessCtx), flipDoneMs);
        }
```
This removes the `discoveries === 0` gate (the silence bug). Confetti still only fires on Yang+greens; the voice now fires on every edition for every guess. No double-speak: on Yang greens, only `celebrateGreens` runs (it calls `showCompanion("greens",{count})`); otherwise `showCompanion` handles the one event directly.

- [ ] **Step 3: Confirm `discoveries` is still used elsewhere (don't leave it orphaned)**

Run: `grep -n 'discoveries' public/app.js`
Expected: `discoveries` still appears in the payout block above (e.g. `if (discoveries)` / `discoveries === 0` for the drain branch). If your removed branch was its ONLY remaining use, that's fine — leave the declaration; do not chase unrelated cleanup. If `getActiveEditionId` is now unused, leave it (still used by other call sites; verify with `grep -c getActiveEditionId public/app.js` > 1).

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(sandbox): never-silent guess reaction on every edition"
```

---

## Task 5: Verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 2: Manual smoke (the behavior this rung exists for)**

Run: `npm run dev`, open the local URL.
Expected:
- On a **non-Yang theme** (e.g. switch theme in settings), a guess that lands **only yellows** (no greens) now **speaks a line** (it was silent before).
- A guess that lands **one green** speaks a `progress` line.
- On **Yang**, greens still fire **confetti**, and a lone-yellow guess speaks a `progress` line.
- A clean nothing-found guess still speaks a `wrong` line; reusing a known-dead letter speaks the sloppy variant.
- No guess is silent.

- [ ] **Step 3: (Optional, local Mac) render the new `progress` lines in Yan's voice**

Only if golden-voice is set up (otherwise they fall back to browser TTS, fine to ship):
Run: `npm run voice:render` — renders the 10 new `progress` segments, updates `public/voice/yang/manifest.json`. Commit the new clips + manifest if generated.

---

## Self-Review Notes

- **Spec coverage:** `pickGuessEvent` + matrix → Task 1; `mergeConfig` + all 5 rules + default-preserving guarantee → Task 1; `CONFIG_CAPS` → Task 1; `progress` bank → Task 2; `companionReact` merge seam (`snapshotVoiceConfig` stub) → Task 3; app.js never-silent rewrite + confetti-stays-Yang → Task 4; manual smoke for the side-effect glue → Task 5.
- **Symbol consistency:** `pickGuessEvent(ng, ny, reusedDeadLetter, voice?)` defined Task 1, called Task 4 (3-arg) + tested Task 1. `mergeConfig(...layers)` defined Task 1, called Task 3. `CONFIG_CAPS.bankMax` defined + used in Task 1. `progress` event/bank consistent across Tasks 1/2/3/4.
- **Deferred (rung 2+):** `snapshotVoiceConfig()` returns `{}` now; rung 2 returns `snapshot.roomConfig?.voice`. `resolvePreset`/`diffConfig`/`PRESETS`/`sanitizeRoomConfig` not built (YAGNI). No server, snapshot field, or message this rung.
- **Voice layer untouched:** `VOICE_EDITION` stays `"yang"`; new `progress` lines fall back to `speechSynthesis` until rendered (Step 3 optional).
