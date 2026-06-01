# Yang's Edition — Cloned-Voice Companion (Subsystem A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `yang` edition whose companion speaks cheeky/fun lines in Yang's cloned voice — pre-rendered clips played in-browser with a speechSynthesis fallback, plus idle taunts when the player goes quiet.

**Architecture:** Build-time, `scripts/voice/render.mjs` runs golden-voice (`gv export`) over the yang edition's line banks and writes `public/voice/yang/*.mp3` + a `manifest.json` keyed by a stable hash of each **template** line. At runtime, `public/voice.js#speakLine()` looks the line up in the manifest and plays the clip, falling back to `speechSynthesis` when a clip is missing (including dynamic `{answer}` lines). The companion (already firing for `win`) is completed to fire on `invalid/wrong/loss/idle`.

**Tech Stack:** Vanilla ES modules (browser), Cloudflare Workers static assets, Node ESM build script, golden-voice CLI (`gv`) + ffmpeg (local, offline), vitest (+ jsdom) for tests.

**Scope:** Subsystem A only. Live human voice chat (Subsystem B) and Yang-as-commentator are separate, later plans. Spec: `docs/superpowers/specs/2026-05-31-yang-edition-golden-voice-design.md`.

---

## File Structure

- Create `public/voice-key.js` — `lineKey(text)`: a tiny, dependency-free, deterministic string hash (FNV-1a → 8-hex). Imported by both the browser (`voice.js`) and the Node build script (`render.mjs`), so the same line always maps to the same clip filename.
- Create `public/voice.js` — runtime playback: manifest cache + `speakLine(editionId, rawLine, spokenText)` with clip-or-speechSynthesis fallback, mute-aware, plus `stopSpeaking()`.
- Create `public/editions/yang.js` — the `yang` edition (palette, fonts, motion, `sound.voice`, and the curated companion line banks).
- Modify `public/editions/index.js` — register `yang` in `EDITIONS`.
- Modify `public/edition.js` — `companionReact` returns `raw` (the pre-substitution template) and never leaks a `{answer}` token.
- Modify `public/app.js` — import `speakLine`; route companion speech through it; fire `invalid/wrong/loss`; add the self-guarding idle timer firing `idle`.
- Create `public/voice/yang/manifest.json` — committed, initially `{}` (populated by render.mjs).
- Create `scripts/voice/render.mjs` — local, offline clip renderer.
- Modify `package.json` — add `"voice:render"` script.
- Modify `vitest.config.ts` — add `/voice.js` and `/voice-key.js` path aliases.
- Tests: `test/voice-key.test.js`, `test/voice.test.js` (jsdom), `test/yang-edition.test.js`; extend `test/edition.test.js`.

---

## Task 1: Stable line-key hash (`lineKey`)

**Files:**
- Create: `public/voice-key.js`
- Test: `test/voice-key.test.js`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the vitest alias so tests can import `/voice-key.js`**

In `vitest.config.ts`, inside the `resolve.alias` array, add a third entry (keep the existing two):

```ts
  resolve: {
    alias: [
      { find: /^\/editions\//, replacement: new URL("./public/editions/", import.meta.url).pathname },
      { find: /^\/edition\.js$/, replacement: new URL("./public/edition.js", import.meta.url).pathname },
      { find: /^\/voice-key\.js$/, replacement: new URL("./public/voice-key.js", import.meta.url).pathname },
    ],
  },
```

- [ ] **Step 2: Write the failing test**

Create `test/voice-key.test.js`:

```js
import { describe, it, expect } from "vitest";
import { lineKey } from "/voice-key.js";

describe("lineKey", () => {
  it("is deterministic for the same input", () => {
    expect(lineKey("That's not a word. I checked.")).toBe(lineKey("That's not a word. I checked."));
  });
  it("returns 8 lowercase hex chars", () => {
    expect(lineKey("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("differs for different inputs", () => {
    expect(lineKey("hello there")).not.toBe(lineKey("hello thele"));
  });
  it("handles empty and unicode without throwing", () => {
    expect(lineKey("")).toMatch(/^[0-9a-f]{8}$/);
    expect(lineKey("café — déjà")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("treats the {answer} template as its own distinct key", () => {
    expect(lineKey("The word was {answer}.")).not.toBe(lineKey("The word was CRANE."));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/voice-key.test.js`
Expected: FAIL — cannot resolve `/voice-key.js` (module doesn't exist yet).

- [ ] **Step 4: Write the implementation**

Create `public/voice-key.js`:

```js
// Stable, dependency-free hash of a companion line → clip filename stem.
// FNV-1a (32-bit). Identical output in the browser and in Node (render.mjs),
// so the same line always maps to the same pre-rendered clip.
export function lineKey(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/voice-key.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add public/voice-key.js test/voice-key.test.js vitest.config.ts
git commit -m "feat: stable lineKey hash for cloned-voice clip lookup"
```

---

## Task 2: The `yang` edition with curated line banks

**Files:**
- Create: `public/editions/yang.js`
- Modify: `public/editions/index.js`
- Test: `test/yang-edition.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/yang-edition.test.js`:

```js
import { describe, it, expect } from "vitest";
import { getEdition, EDITIONS } from "/editions/index.js";

describe("yang edition", () => {
  const ed = getEdition("yang");

  it("is registered and resolvable by id", () => {
    expect(ed.id).toBe("yang");
    expect(EDITIONS.some((e) => e.id === "yang")).toBe(true);
  });
  it("has voice on and a companion name", () => {
    expect(ed.sound.voice.on).toBe(true);
    expect(typeof ed.companion.name).toBe("string");
  });
  it("has non-empty banks for all five events", () => {
    for (const ev of ["invalid", "wrong", "win", "loss", "idle"]) {
      expect(Array.isArray(ed.companion.lines[ev])).toBe(true);
      expect(ed.companion.lines[ev].length).toBeGreaterThan(0);
    }
  });
  it("idle is the biggest bank (the star)", () => {
    expect(ed.companion.lines.idle.length).toBeGreaterThanOrEqual(20);
  });
  it("loss bank includes {answer} template lines", () => {
    expect(ed.companion.lines.loss.some((l) => l.includes("{answer}"))).toBe(true);
  });
  it("every line is TTS-clean: short, no emoji/symbols/quotes", () => {
    const all = Object.values(ed.companion.lines).flat();
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(80);
      // letters, spaces, basic sentence punctuation, and the {answer} token only
      expect(line.replace("{answer}", "")).toMatch(/^[A-Za-z0-9 ,.'?\-—]+$/);
    }
  });
  it("has a full palette and fonts", () => {
    for (const k of ["bg", "fg", "accent", "green", "yellow", "gray"]) {
      expect(typeof ed.palette[k]).toBe("string");
    }
    expect(typeof ed.fonts.display).toBe("string");
    expect(typeof ed.fonts.body).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/yang-edition.test.js`
Expected: FAIL — `getEdition("yang")` returns the default edition (id `"default"`), so the first assertion fails.

- [ ] **Step 3: Create the edition**

Create `public/editions/yang.js` (banks are the curated output — do not paraphrase):

```js
// Yang's edition — unapologetically gold. Rich black, vivid gold accent, warm
// cream, a characterful display face. Its companion speaks in Yang's cloned voice
// (see scripts/voice/render.mjs); lines are written to be spoken aloud.
export const edition = {
  id: "yang",
  name: "Yang's Table",
  palette: {
    bg: "#0b0a0c", fg: "#f7f1e3", muted: "#9a9388", border: "#2e2a22",
    tileEmpty: "#0b0a0c", tilePendingBorder: "#4a4334", keyBg: "#2a2620",
    green: "#6f9e7a", yellow: "#d9ad4f", gray: "#38332a",
    accent: "#f0c14b", bgCard: "#161310", error: "#e0796b",
  },
  fonts: {
    display: "'Bricolage Grotesque', Georgia, serif",
    body: "'Instrument Sans', system-ui, sans-serif",
    link: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600&display=swap",
  },
  motion: { revealStaggerMs: 170, flipHalfMs: 250 },
  sound: { voice: { rate: 1.0, pitch: 1.0, on: true } },
  companion: {
    name: "Yang",
    lines: {
      invalid: [
        "That's not a word. I checked.",
        "Bold of you to invent language here.",
        "Sweetheart, that's a keyboard sneeze, not a word.",
        "I love you, but a dictionary would not.",
        "And the judges are reviewing. Reviewing. Denied.",
        "Here we witness creativity unburdened by spelling.",
        "Five letters walked in. None of them confessed.",
        "I ran those letters. They've got no record.",
        "Almost a word, brain just hiccuped. Try again.",
        "What dark gibberish is this you conjure?",
        "That's not a word, but I admire the confidence.",
        "Cute letters. Not a word, though.",
      ],
      wrong: [
        "Wrong, but confidently wrong.",
        "A valid word. Sadly, the wrong one.",
        "He's still standing, the champ remains undefeated.",
        "Swing and a miss, my favorite person.",
        "The board says no, the heart says aww.",
        "Not it, but you tried with your whole chest.",
        "A reasonable theory, swiftly disproven by the evidence.",
        "The creature probes the grid, learning as it goes.",
        "Wrong, yet undeterred. Magnificent, really.",
        "You learn the word by what it is not.",
        "That door was locked too. Keep knocking.",
        "Wrong lead. The case stays open another round.",
        "Nope, and yet I'm proud of the reasoning.",
        "Onward, brave fool, the truth yet eludes us.",
        "Nope. Take your time, I've got all day.",
        "Wrong word, right instincts. Keep going.",
      ],
      win: [
        "Solved. I'm appropriately impressed.",
        "You won. Don't make it weird.",
        "Right answer. I had my doubts.",
        "Nailed it, you beautiful overthinker.",
        "And there it is. The specimen has triumphed.",
        "Remarkable. The creature found its word at last.",
        "You did not chase it. It came.",
        "The puzzle bows to you now.",
        "Case closed. You cracked it like a pro.",
        "You found your word. The city sleeps easy.",
        "That's my friend, cracking words like a pro.",
        "Sound the trumpets, the word is slain.",
        "Clean. Effortless. A little smug, even.",
        "Look at you, suddenly a genius.",
      ],
      loss: [
        "The word was {answer}. We'll cry together.",
        "Out of guesses, never out of charm.",
        "It was {answer}. I would've helped if I could.",
        "Nature is cruel. The answer, of course, was {answer}.",
        "A valiant effort, ultimately outmatched by five letters.",
        "Case went cold. The word was {answer}.",
        "The word slipped town before you caught it.",
        "The defense held, no points on the board today.",
        "Curtains, dear heart. The villain word escapes.",
        "It was {answer}. Happens to the best of us.",
        "Didn't land it. I'm not even mad.",
        "Out of guesses, never out of class. It was {answer}.",
      ],
      idle: [
        "Still there? No rush. None at all.",
        "The cursor's blinking. You're not.",
        "Silence. My favorite guess so far.",
        "Riveting stuff, this waiting.",
        "The crowd is waiting. Where did our champion go?",
        "Our contender has left the ring, ladies and gentlemen.",
        "The spotlight's on, the seat is empty.",
        "The mic is hot and the seat is cold.",
        "Somewhere, a word sits unsolved and lonely.",
        "Introducing nobody, because you walked away.",
        "Hello? I can hear the silence judging you.",
        "You wandered off mid-genius. Classic move.",
        "The letters miss you. So do I, slightly.",
        "Did the word scare you away, darling?",
        "Snack break, existential crisis, or both?",
        "I'll just sit here loving you quietly.",
        "Blinking cursor, lonely host, same energy.",
        "Come back, the vowels are getting restless.",
        "The specimen has wandered off. Patience is required.",
        "Observe the natural habitat, now mysteriously empty.",
        "No movement detected. Perhaps it is foraging for snacks.",
        "A long silence falls across the grid. How curious.",
        "The pause lengthens. Even nature grows a little impatient.",
        "Silence is also a move. A slow one.",
        "The empty box contemplates your absence.",
        "The puzzle meditates without you. Rude.",
        "Folks, we may have a weather delay in here.",
        "Has our champion stepped out for a hot dog?",
        "Timeout that nobody called. The silence stretches on.",
        "And we cut to commercial. The player is gone.",
        "You vanished. Even the suspects went home.",
        "Radio silence. I've seen this before. Never ends well.",
        "You walked out mid-investigation. Classic move.",
        "Silence. The kind that makes a detective nervous.",
        "I'll keep the seat warm till you're back.",
        "Coffee break? Smart. The answer isn't going anywhere.",
        "Speak, ghost, or art thou truly gone?",
        "I soliloquize alone, abandoned by my muse.",
        "Even Hamlet returned. Wilt thou not?",
        "Lovely silence. Slightly suspicious, but lovely.",
      ],
    },
  },
};
```

- [ ] **Step 4: Register the edition**

Replace the contents of `public/editions/index.js` with:

```js
import { edition as defaultEdition } from "/editions/default.js";
import { edition as yangEdition } from "/editions/yang.js";

export const EDITIONS = [defaultEdition, yangEdition];

export function getEdition(id) {
  return EDITIONS.find((e) => e.id === id) ?? defaultEdition;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/yang-edition.test.js`
Expected: PASS (7 tests). If the TTS-clean test fails, a curated line slipped a disallowed character — fix the line, not the regex.

- [ ] **Step 6: Commit**

```bash
git add public/editions/yang.js public/editions/index.js test/yang-edition.test.js
git commit -m "feat: yang edition with curated cloned-voice companion banks"
```

---

## Task 3: `companionReact` returns `raw` and never leaks `{answer}`

**Files:**
- Modify: `public/edition.js:37-46`
- Test: `test/edition.test.js`

- [ ] **Step 1: Add failing assertions to the existing companion test**

In `test/edition.test.js`, inside the `describe("editions + companion", ...)` block, add these tests:

```js
  it("returns the raw template alongside substituted text", () => {
    const r = companionReact("loss", { answer: "CRANE" });
    expect(typeof r.raw).toBe("string");
    expect(r.text).not.toContain("{answer}");
    // raw is the UNsubstituted template; text is raw with {answer} -> CRANE.
    expect(r.text).toBe(r.raw.replace("{answer}", "CRANE"));
  });
  it("never leaks a {answer} token even with no answer supplied", () => {
    // cycle the whole loss bank; none should surface a literal token
    for (let i = 0; i < 30; i++) {
      const r = companionReact("loss", {});
      expect(r.text).not.toContain("{answer}");
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/edition.test.js`
Expected: FAIL — `r.raw` is undefined, and with no answer the `{answer}` token survives in `text`.

- [ ] **Step 3: Update `companionReact`**

In `public/edition.js`, replace the body of `companionReact` (currently lines 37-46):

```js
export function companionReact(event, ctx = {}) {
  const ed = getEdition(activeId);
  const bank = ed.companion?.lines?.[event] ?? [];
  if (bank.length === 0) return { text: "", raw: "", speak: false };
  const i = (reactCounters[event] = (reactCounters[event] ?? -1) + 1) % bank.length;
  const raw = bank[i];
  let text = raw;
  if (ctx.answer) text = text.replace("{answer}", ctx.answer);
  // Safety net: never show or speak a naked token if no answer was supplied.
  text = text.replace("{answer}", "that one");
  const muted = localStorage.getItem(LS.muted) === "1";
  return { text, raw, speak: !!ed.sound?.voice?.on && !muted };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/edition.test.js`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat: companionReact returns raw template; never leaks {answer}"
```

---

## Task 4: Runtime playback (`voice.js`)

**Files:**
- Create: `public/voice.js`
- Test: `test/voice.test.js`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the vitest alias for `/voice.js`**

In `vitest.config.ts`, add to the `resolve.alias` array (alongside the others):

```ts
      { find: /^\/voice\.js$/, replacement: new URL("./public/voice.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing test**

Create `test/voice.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { speakLine, stopSpeaking } from "/voice.js";
import { lineKey } from "/voice-key.js";

const RAW = "You won. Don't make it weird.";

function mockAudio() {
  const plays = [];
  global.Audio = class {
    constructor(src) { this.src = src; plays.push(src); }
    play() { return Promise.resolve(); }
    pause() {}
  };
  return plays;
}
function mockSpeech() {
  const spoken = [];
  global.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  window.speechSynthesis = { speak: (u) => spoken.push(u.text), cancel() {} };
  return spoken;
}

beforeEach(() => {
  localStorage.clear();
  stopSpeaking();
});

describe("speakLine", () => {
  it("plays the pre-rendered clip when the manifest has the line", async () => {
    const plays = mockAudio();
    mockSpeech();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await speakLine("yang", RAW, RAW);
    expect(plays).toEqual([`/voice/yang/${file}`]);
  });

  it("falls back to speechSynthesis with the SPOKEN text when no clip exists", async () => {
    mockAudio();
    const spoken = mockSpeech();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await speakLine("yang", "The word was {answer}.", "The word was CRANE.");
    expect(spoken).toEqual(["The word was CRANE."]);
  });

  it("does nothing when muted", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    localStorage.setItem("wordul.muted", "1");
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: "x.mp3" }) });
    await speakLine("yang", RAW, RAW);
    expect(plays).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it("falls back to speech when the manifest fetch fails", async () => {
    mockAudio();
    const spoken = mockSpeech();
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await speakLine("yang", RAW, RAW);
    expect(spoken).toEqual([RAW]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/voice.test.js`
Expected: FAIL — cannot resolve `/voice.js`.

- [ ] **Step 4: Implement `voice.js`**

Create `public/voice.js`:

```js
// Cloned-voice playback with graceful fallback.
// speakLine(editionId, rawLine, spokenText):
//   - look up the RAW template line in the edition's manifest; if a clip exists,
//     play it (the cloned voice). Otherwise speak `spokenText` via the browser's
//     speechSynthesis (covers un-rendered and dynamic {answer} lines).
import { lineKey } from "/voice-key.js";

const MUTE_LS = "wordul.muted";
const manifests = {}; // editionId -> { key: filename }
let current = null;   // { audio } currently playing

function isMuted() { return localStorage.getItem(MUTE_LS) === "1"; }

async function loadManifest(editionId) {
  if (editionId in manifests) return manifests[editionId];
  try {
    const res = await fetch(`/voice/${editionId}/manifest.json`);
    manifests[editionId] = res.ok ? await res.json() : {};
  } catch {
    manifests[editionId] = {};
  }
  return manifests[editionId];
}

function playClip(url) {
  stopSpeaking();
  try {
    const audio = new Audio(url);
    current = { audio };
    // Autoplay can be blocked before a user gesture — that's fine, stay silent.
    audio.play().catch(() => {});
  } catch { /* ignore */ }
}

function fallbackSpeak(text) {
  if (!text || !window.speechSynthesis) return;
  try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* ignore */ }
}

export async function speakLine(editionId, rawLine, spokenText) {
  if (!rawLine || isMuted()) return;
  const map = await loadManifest(editionId);
  if (isMuted()) return; // re-check after the await
  const file = map[lineKey(rawLine)];
  if (file) playClip(`/voice/${editionId}/${file}`);
  else fallbackSpeak(spokenText ?? rawLine);
}

export function stopSpeaking() {
  try { current?.audio?.pause(); } catch { /* ignore */ }
  current = null;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/voice.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add public/voice.js test/voice.test.js vitest.config.ts
git commit -m "feat: voice.js cloned-clip playback with speechSynthesis fallback"
```

---

## Task 5: Wire companion speech + invalid/wrong/loss events in app.js

**Files:**
- Modify: `public/app.js` (import line 5; `showCompanion` ~557-565; `onServerMessage` 755 & 768; `handleGameOver` 1305-1309)

- [ ] **Step 1: Import `speakLine`**

In `public/app.js`, line 5 currently:

```js
import { applyEdition, getActiveEditionId, getGold, earnGold, companionReact } from "/edition.js";
```

Add a new import line directly after it:

```js
import { speakLine } from "/voice.js";
```

- [ ] **Step 2: Route companion speech through `speakLine`**

Replace `showCompanion` (currently ~557-565):

```js
// Surface the active edition's companion line for an event, reusing the toast.
function showCompanion(event, ctx) {
  const { text, raw, speak } = companionReact(event, ctx);
  if (!text) return;
  toast(text, { duration: 3200 });
  // Look up the clip by the RAW template; fall back to speaking the substituted text.
  if (speak) speakLine(getActiveEditionId(), raw, text);
}
```

- [ ] **Step 3: Fire `wrong` on an accepted, non-final guess**

In `onServerMessage`, the block at line 754-757 currently:

```js
    // Server accepted our guess → clear pending letters.
    if (me && prevMe && me.guesses.length > prevMe.guesses.length) {
      game.pending = "";
    }
```

Replace with:

```js
    // Server accepted our guess → clear pending letters.
    if (me && prevMe && me.guesses.length > prevMe.guesses.length) {
      game.pending = "";
      // A valid guess landed. If it didn't end the game, the companion reacts.
      if (me.status === "playing") { showCompanion("wrong"); resetIdle(); }
    }
```

(`resetIdle` is defined in Task 6; this references it forward — both land before any test/run of app.js.)

- [ ] **Step 4: Fire `invalid` on a rejected guess**

In `onServerMessage`, the `invalid_guess` branch at lines 768-773 currently:

```js
  } else if (msg.type === "invalid_guess") {
    // Letters are still in game.pending — we never cleared them. Shake the row and
    // toast prominently, but DON'T burn a guess slot.
    flashShake();
    const reason = msg.reason || "not a word";
    toast(`${reason} — doesn't count, try again`, { error: true, duration: 2500 });
  } else if (msg.type === "error") {
```

Add a `showCompanion("invalid")` after the toast:

```js
  } else if (msg.type === "invalid_guess") {
    // Letters are still in game.pending — we never cleared them. Shake the row and
    // toast prominently, but DON'T burn a guess slot.
    flashShake();
    const reason = msg.reason || "not a word";
    toast(`${reason} — doesn't count, try again`, { error: true, duration: 2500 });
    showCompanion("invalid");
  } else if (msg.type === "error") {
```

- [ ] **Step 5: Fire `loss` in `handleGameOver`**

In `handleGameOver`, the `else` branch at lines 1305-1309 currently:

```js
  } else {
    // Loss: let the player's last row flip first (if they made one), THEN explode.
    const lastFlipDoneAt = guessCount > 0 ? 1500 : 200;
    setTimeout(() => triggerLoseSequence(snap, me), lastFlipDoneAt);
  }
```

Replace with:

```js
  } else {
    // Loss: let the player's last row flip first (if they made one), THEN explode.
    showCompanion("loss", { answer: snap.word });
    const lastFlipDoneAt = guessCount > 0 ? 1500 : 200;
    setTimeout(() => triggerLoseSequence(snap, me), lastFlipDoneAt);
  }
```

- [ ] **Step 6: Typecheck (no app.js unit test; verified by run later)**

Run: `npm run typecheck`
Expected: PASS (no errors). `app.js` is plain JS so this checks `src/`; it must stay green.

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: wire companion speech + invalid/wrong/loss events"
```

---

## Task 6: Idle taunts — self-guarding timer

**Files:**
- Modify: `public/app.js` (idle helpers near `showCompanion`; reset hooks in `typeLetter`/`backspace`/`submitGuess`; arm on play start; clear on game over)

- [ ] **Step 1: Add the idle-timer helpers**

In `public/app.js`, immediately AFTER the `showCompanion` function (from Task 5), add:

```js
// --- Idle taunts: the companion checks in when you go quiet mid-game. ---
let idleTimer = null;
const IDLE_FIRST_MS = 22000;
const IDLE_REPEAT_MS = 34000;

function isMyTurn() {
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  return !!(game.snapshot && game.snapshot.phase === "playing" && me && me.status === "playing");
}
function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
function armIdle(delay = IDLE_FIRST_MS) {
  clearIdle();
  if (!isMyTurn()) return;
  idleTimer = setTimeout(() => {
    if (!isMyTurn()) { clearIdle(); return; } // re-check at fire time
    showCompanion("idle");
    armIdle(IDLE_REPEAT_MS);
  }, delay);
}
function resetIdle() { armIdle(IDLE_FIRST_MS); }
```

- [ ] **Step 2: Reset the timer on every player action**

In `typeLetter` (line ~1133), add `resetIdle();` as the last line before the closing brace:

```js
function typeLetter(l) {
  if (!game.snapshot || game.snapshot.phase !== "playing") return;
  if (game.pending.length >= game.snapshot.wordLength) return;
  game.pending += l.toUpperCase();
  render();
  resetIdle();
}
```

In `backspace` (line ~1139), add `resetIdle();` before the closing brace:

```js
function backspace() {
  if (game.pending.length === 0) return;
  game.pending = game.pending.slice(0, -1);
  render();
  resetIdle();
}
```

In `submitGuess` (line ~1144), add `resetIdle();` as the first statement so any submit attempt counts as activity:

```js
function submitGuess() {
  resetIdle();
  const len = game.snapshot?.wordLength ?? 5;
```

- [ ] **Step 3: Arm the timer when a game starts**

In `onServerMessage`, the start-celebration block at lines 749-751 currently:

```js
    if (prev && prev.phase !== "playing" && msg.room.phase === "playing") {
      triggerStartCelebration();
    }
```

Replace with:

```js
    if (prev && prev.phase !== "playing" && msg.room.phase === "playing") {
      triggerStartCelebration();
      resetIdle();
    }
```

- [ ] **Step 4: Clear the timer when the game ends**

In `handleGameOver` (line ~1288), add `clearIdle();` as the first statement after the `me` guard:

```js
function handleGameOver(snap) {
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  clearIdle();
  const won = me.status === "won";
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: idle taunts — companion checks in when the player goes quiet"
```

---

## Task 7: Build-time renderer (`render.mjs`) + initial manifest

**Files:**
- Create: `scripts/voice/render.mjs`
- Create: `public/voice/yang/manifest.json`
- Modify: `package.json` (scripts)

This is a local, offline tool run on Yan's Mac (golden-voice + ffmpeg installed). No unit test — verified by running it. It is idempotent: existing clips are skipped.

- [ ] **Step 1: Commit the initial empty manifest**

Create `public/voice/yang/manifest.json`:

```json
{}
```

(With an empty manifest, every line falls back to `speechSynthesis` until clips are rendered — the feature is fully functional before any audio exists.)

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
    "voice:render": "node scripts/voice/render.mjs"
```

- [ ] **Step 3: Write `render.mjs`**

Create `scripts/voice/render.mjs`:

```js
#!/usr/bin/env node
// Render Yang's companion lines to cloned-voice clips with golden-voice (gv).
//
// PREREQUISITES (local, macOS, offline):
//   1. golden-voice installed and a "yang" voice profile recorded (`gv record me`)
//   2. the resident engine running: `bash tts-daemon.sh start`
//   3. ffmpeg on PATH (golden-voice installs it)
//
// USAGE:  npm run voice:render
//
// gv's export output location/format is the one external unknown. This script
// assumes `gv export <key> "<text>"` writes <key>.<ext> into GV_EXPORT_DIR.
// VERIFY ON FIRST RUN: run `gv export probe "hello there"` once and confirm where
// the file lands; if it differs, set GV_EXPORT_DIR to that directory and re-run.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { lineKey } from "../../public/voice-key.js";
import { edition } from "../../public/editions/yang.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "../../public/voice/yang");
const MANIFEST = join(OUT_DIR, "manifest.json");
const GV_EXPORT_DIR = process.env.GV_EXPORT_DIR
  || join(homedir(), "golden-cloud/blocks/golden-voice/exports");

mkdirSync(OUT_DIR, { recursive: true });

// All companion lines, deduped. Skip lines with a {token}: their word is dynamic
// at runtime and can't be pre-rendered — they fall back to speechSynthesis.
const lines = [...new Set(Object.values(edition.companion.lines).flat())]
  .filter((l) => !l.includes("{"));

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

function findGvOutput(key) {
  // newest file in GV_EXPORT_DIR whose name starts with the key
  if (!existsSync(GV_EXPORT_DIR)) return null;
  const matches = readdirSync(GV_EXPORT_DIR)
    .filter((f) => f.startsWith(key + "."))
    .map((f) => ({ f, t: statSync(join(GV_EXPORT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return matches.length ? join(GV_EXPORT_DIR, matches[0].f) : null;
}

let made = 0, skipped = 0;
for (const text of lines) {
  const key = lineKey(text);
  const outMp3 = join(OUT_DIR, `${key}.mp3`);
  if (existsSync(outMp3)) { manifest[key] = `${key}.mp3`; skipped++; continue; }

  console.log(`▶ ${text}`);
  execFileSync("gv", ["export", key, text], { stdio: "inherit" });
  const raw = findGvOutput(key);
  if (!raw) {
    console.error(`✗ Could not find gv output for "${key}" in ${GV_EXPORT_DIR}.`);
    console.error(`  Run \`gv export probe "hi"\` to see where gv writes, then set GV_EXPORT_DIR.`);
    process.exit(1);
  }
  // Normalize to small mono mp3 (universal browser support, ~tiny for speech).
  execFileSync("ffmpeg", ["-y", "-i", raw, "-ac", "1", "-b:a", "32k", outMp3], { stdio: "inherit" });
  manifest[key] = `${key}.mp3`;
  made++;
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n✓ Rendered ${made}, skipped ${skipped}. Manifest: ${MANIFEST}`);
```

- [ ] **Step 4: Commit the script + empty manifest (clips rendered separately)**

```bash
git add scripts/voice/render.mjs public/voice/yang/manifest.json package.json
git commit -m "feat: render.mjs — render Yang companion lines to cloned-voice clips"
```

- [ ] **Step 5 (LOCAL, OPTIONAL — needs golden-voice set up): render the clips**

```bash
# one-time: record profile + start engine (see golden-voice README)
gv record me
bash tts-daemon.sh start
# render:
npm run voice:render
git add public/voice/yang
git commit -m "chore: render Yang cloned-voice companion clips"
```

If golden-voice isn't set up yet, skip this step — the edition ships and works via the speechSynthesis fallback; clips can be added any time later by re-running the script.

---

## Task 8: Verification & integration smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all suites including `voice-key`, `voice`, `yang-edition`, `edition`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke (local dev) via the run skill**

Run: `npm run dev`, open the app, then:
1. Append `?edition=yang` is not the mechanism — switch via the edition picker, OR set `localStorage.setItem("wordul.edition","yang")` in devtools and reload, then confirm the gold theme + Bricolage display font load.
2. Start a solo game. Type an invalid 5-letter non-word and Enter → expect a shake + a yang `invalid` toast, and (if unmuted) browser-voice fallback speaks it.
3. Make a valid wrong guess → expect a yang `wrong` toast.
4. Stop typing for ~22s → expect a yang `idle` toast; wait again → another, different idle line.
5. Lose a game → expect a yang `loss` toast that names the real word (no literal `{answer}`).
6. Win a game → expect a yang `win` toast.
7. Toggle mute → confirm no audio but toasts still show.

- [ ] **Step 4: Confirm graceful no-clip behavior**

With the empty manifest committed, devtools Network shows `manifest.json` → `{}` and audio uses `speechSynthesis` (or silence if the browser blocks autoplay before a gesture). No console errors, no naked `{answer}`.

- [ ] **Step 5: Final commit if anything was adjusted during smoke**

```bash
git add -A
git commit -m "chore: yang edition cloned-voice companion — verified"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** build-time pipeline (Task 7), runtime playback + fallback (Task 4), `yang` edition with banks + idle (Tasks 2, 6), all-events wiring (Task 5), `{answer}` handling (Tasks 3, 4, 7). ✔
- **Type/name consistency:** `lineKey` (Tasks 1,4,7), `speakLine(editionId, rawLine, spokenText)` (Tasks 4,5), `companionReact` returns `{text, raw, speak}` (Tasks 3,5), `resetIdle/armIdle/clearIdle/isMyTurn` (Task 6). ✔
- **Manifest keyed by RAW template; `{answer}` lines skipped at render and fall back at runtime.** ✔
- **Behavior change called out:** companion now fires on `invalid/wrong/loss/idle` for ALL editions (default included). Default's lines were already authored for these events; default speaks via browser voice. If undesired for default, set `default.js sound.voice.on=false` — out of scope here.
