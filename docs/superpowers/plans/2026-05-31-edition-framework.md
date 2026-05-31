# Edition Framework + Premium Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Wordul themeable — editions are declarative theme packs (look/fonts/motion/voice/companion) over the live multiplayer engine, with an edition picker and a shared gold wallet, proven by shipping a premium Apple-grade Default edition; and establish "Wordul" as the one brand name.

**Architecture:** New self-contained files (`public/edition.js`, `public/editions/*.js`) hold the framework + packs and land immediately (no collision). Surgical hooks into `app.js`/`style.css`/`index.html`, plus the `Wordle Race`→`Wordul` rename, are PHASE B — gated on the other agent's in-flight work landing (coordination). Tests use vitest + jsdom.

**Tech Stack:** Vanilla ES modules (browser), vitest + jsdom for tests, Cloudflare Worker (deploy), localStorage for state.

---

## Phases

- **Phase A (Tasks 1–5):** NEW files only — build + test now. Zero collision with the other agent.
- **Phase B (Tasks 6–10):** SHARED-file patches + rename + deploy. Start ONLY after the other agent's current `app.js`/`style.css`/`index.html`/`worker.ts` work is merged to main (or an explicit `.claude/COLONY.md` handoff). Each Phase B task re-checks coordination.

## File Structure

- `public/editions/default.js` — Default edition pack (data). CREATE.
- `public/editions/index.js` — registry: `EDITIONS`, `getEdition(id)`. CREATE.
- `public/edition.js` — runtime: apply, picker, wallet, companion. CREATE.
- `test/edition.test.js` — vitest unit/integration tests. CREATE.
- `public/index.html` — pre-paint bootstrap (Phase B). MODIFY.
- `public/app.js` — 5 engine hooks (Phase B). MODIFY.
- `public/style.css` — companion toast + gold HUD + power-up styles (Phase B). MODIFY.
- Rename targets (Phase B): `public/app.js`, `public/index.html`, `public/llms.txt`, `public/llms-full.txt`, `src/worker.ts`.

---

## Task 1: Default edition pack + registry

**Files:**
- Create: `public/editions/default.js`
- Create: `public/editions/index.js`

- [ ] **Step 1: Write the Default pack**

`public/editions/default.js`:
```js
// Default edition — premium, Apple-grade: warm near-black, one quiet gold accent,
// refined Fraunces (display) + Instrument Sans (body), restrained motion.
// Its palette mirrors style.css :root so the default never flashes an override.
export const edition = {
  id: "default",
  name: "Wordul",
  palette: {
    bg: "#0e0e10", fg: "#f4f2ec", muted: "#8a8a8f", border: "#2a2a2e",
    tileEmpty: "#0e0e10", tilePendingBorder: "#46464c", keyBg: "#2a2a2e",
    green: "#5b8c6e", yellow: "#c8a96a", gray: "#3a3a3e",
    accent: "#c8a96a", bgCard: "#17171a", error: "#e0796b",
  },
  fonts: {
    display: "'Fraunces', Georgia, serif",
    body: "'Instrument Sans', system-ui, sans-serif",
    link: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Instrument+Sans:wght@400;500;600&display=swap",
  },
  motion: { revealStaggerMs: 200, flipHalfMs: 280 },
  sound: { voice: { rate: 1.0, pitch: 1.0, on: true } },
  companion: {
    name: "Wordul",
    lines: {
      invalid: ["That's not a word. Take your time.", "Five real letters, please.", "Not quite a word yet."],
      wrong:   ["Closer than it feels.", "Noted. Adjust and continue.", "A reasonable theory. Keep going."],
      win:     ["Elegant. Well played.", "Solved, with taste.", "That's the standard. Again?"],
      loss:    ["It happens to the best. The word was {answer}.", "Even masters miss. It was {answer}."],
      idle:    ["The board is waiting.", "Whenever you're ready."],
    },
  },
};
```

- [ ] **Step 2: Write the registry**

`public/editions/index.js`:
```js
import { edition as defaultEdition } from "/editions/default.js";

export const EDITIONS = [defaultEdition];

export function getEdition(id) {
  return EDITIONS.find((e) => e.id === id) ?? defaultEdition;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/vibeyang/wordle
git add public/editions/default.js public/editions/index.js
git commit -m "feat: Default edition pack + registry"
```

---

## Task 2: Edition runtime — wallet

**Files:**
- Create: `public/edition.js` (start it here)
- Create: `test/edition.test.js`

- [ ] **Step 1: Write the failing test**

`test/edition.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getGold, setGold, earnGold, spendGold } from "../public/edition.js";

beforeEach(() => localStorage.clear());

describe("wallet", () => {
  it("defaults to 50 gold", () => {
    expect(getGold()).toBe(50);
  });
  it("earnGold pays more for fewer guesses, min 10", () => {
    setGold(0);
    expect(earnGold(1)).toBe(60); // 70 - 1*10
    expect(getGold()).toBe(60);
    setGold(0);
    expect(earnGold(6)).toBe(10); // max(10, 70-60)
  });
  it("spendGold refuses overspend and never goes negative", () => {
    setGold(15);
    expect(spendGold(20)).toBe(false);
    expect(getGold()).toBe(15);
    expect(spendGold(10)).toBe(true);
    expect(getGold()).toBe(5);
  });
  it("resets corrupt balance to 50", () => {
    localStorage.setItem("wordul.gold", "not-a-number");
    expect(getGold()).toBe(50);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd /Users/vibeyang/wordle && npx vitest run test/edition.test.js`
Expected: FAIL — cannot import `getGold` (module/exports don't exist yet).

- [ ] **Step 3: Implement the wallet in `public/edition.js`**

```js
// Wordul edition runtime: apply theme packs, picker, shared wallet, companion.
import { EDITIONS, getEdition } from "/editions/index.js";

const LS = { edition: "wordul.edition", gold: "wordul.gold", muted: "wordul.muted" };
const DEFAULT_GOLD = 50;

export function getGold() {
  const n = parseInt(localStorage.getItem(LS.gold) ?? "", 10);
  if (Number.isNaN(n)) { setGold(DEFAULT_GOLD); return DEFAULT_GOLD; }
  return n;
}
export function setGold(n) {
  const v = Math.max(0, Math.floor(n));
  localStorage.setItem(LS.gold, String(v));
  return v;
}
export function earnGold(guessCount) {
  const payout = Math.max(10, 70 - guessCount * 10);
  setGold(getGold() + payout);
  return payout;
}
export function spendGold(cost) {
  const g = getGold();
  if (g < cost) return false;
  setGold(g - cost);
  return true;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run test/edition.test.js`
Expected: PASS (4 wallet tests).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat: edition wallet (shared gold) + tests"
```

---

## Task 3: Edition runtime — getEdition fallback + companion

**Files:**
- Modify: `public/edition.js`
- Modify: `test/edition.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/edition.test.js`:
```js
import { resolveEdition, companionReact } from "../public/edition.js";

describe("editions + companion", () => {
  it("resolveEdition falls back to default for unknown id", () => {
    expect(resolveEdition("nope").id).toBe("default");
    expect(resolveEdition("default").id).toBe("default");
  });
  it("companionReact returns a line for each event type", () => {
    for (const ev of ["invalid", "wrong", "win", "loss", "idle"]) {
      const r = companionReact(ev, { answer: "CRANE" });
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
  it("companionReact substitutes {answer}", () => {
    const r = companionReact("loss", { answer: "CRANE" });
    expect(r.text).toContain("CRANE");
  });
  it("companion lines rotate on repeat calls", () => {
    const a = companionReact("wrong").text;
    const b = companionReact("wrong").text;
    // with >1 line, consecutive calls advance the index
    expect(a === b).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run test/edition.test.js`
Expected: FAIL — `resolveEdition`/`companionReact` not exported.

- [ ] **Step 3: Implement in `public/edition.js`**

Add after the wallet code:
```js
let activeId = "default";
const reactCounters = {};

export function resolveEdition(id) { return getEdition(id); }
export function getActiveEditionId() {
  return localStorage.getItem(LS.edition) ?? "default";
}

export function companionReact(event, ctx = {}) {
  const ed = getEdition(activeId);
  const bank = ed.companion?.lines?.[event] ?? [];
  if (bank.length === 0) return { text: "", speak: false };
  const i = (reactCounters[event] = (reactCounters[event] ?? -1) + 1) % bank.length;
  let text = bank[i];
  if (ctx.answer) text = text.replace("{answer}", ctx.answer);
  const muted = localStorage.getItem(LS.muted) === "1";
  return { text, speak: !!ed.sound?.voice?.on && !muted };
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run test/edition.test.js`
Expected: PASS (all wallet + edition/companion tests).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat: edition resolve + companion line dispatch + tests"
```

---

## Task 4: Edition runtime — apply + picker (DOM)

**Files:**
- Modify: `public/edition.js`
- Modify: `test/edition.test.js`

- [ ] **Step 1: Add failing test**

Append to `test/edition.test.js`:
```js
import { applyEdition } from "../public/edition.js";

describe("applyEdition", () => {
  it("sets data-edition, palette vars, motion globals, and persists", () => {
    applyEdition("default");
    const html = document.documentElement;
    expect(html.dataset.edition).toBe("default");
    expect(html.style.getPropertyValue("--bg").trim()).toBe("#0e0e10");
    expect(html.style.getPropertyValue("--green").trim()).toBe("#5b8c6e");
    expect(window.WordulMotion.revealStaggerMs).toBe(200);
    expect(localStorage.getItem("wordul.edition")).toBe("default");
  });
  it("unknown id falls back to default without throwing", () => {
    expect(() => applyEdition("ghost")).not.toThrow();
    expect(document.documentElement.dataset.edition).toBe("default");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run test/edition.test.js`
Expected: FAIL — `applyEdition` not exported.

- [ ] **Step 3: Implement in `public/edition.js`**

Add:
```js
const VAR_MAP = {
  bg: "--bg", fg: "--fg", muted: "--muted", border: "--border",
  tileEmpty: "--tile-empty", tilePendingBorder: "--tile-pending-border",
  keyBg: "--key-bg", green: "--green", yellow: "--yellow", gray: "--gray",
  accent: "--accent", bgCard: "--bg-card", error: "--error",
};

export function applyEdition(id) {
  const ed = getEdition(id);
  activeId = ed.id;
  const html = document.documentElement;
  html.dataset.edition = ed.id;
  for (const [k, cssVar] of Object.entries(VAR_MAP)) {
    if (ed.palette[k] != null) html.style.setProperty(cssVar, ed.palette[k]);
  }
  html.style.setProperty("--font-display", ed.fonts.display);
  html.style.setProperty("--font-body", ed.fonts.body);
  if (ed.fonts.link) injectFontLink(ed.id, ed.fonts.link);
  window.WordulMotion = { ...ed.motion };
  localStorage.setItem(LS.edition, ed.id);
  return ed;
}

function injectFontLink(id, href) {
  const elId = `wordul-font-${id}`;
  if (document.getElementById(elId)) return;
  const link = document.createElement("link");
  link.id = elId; link.rel = "stylesheet"; link.href = href;
  document.head.appendChild(link);
}

export function renderEditionPicker(rootEl, onPick) {
  rootEl.innerHTML = "";
  const current = getActiveEditionId();
  for (const ed of EDITIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edition-chip" + (ed.id === current ? " is-active" : "");
    btn.textContent = ed.name;
    btn.addEventListener("click", () => {
      applyEdition(ed.id);
      rootEl.querySelectorAll(".edition-chip").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      onPick?.(ed.id);
    });
    rootEl.appendChild(btn);
  }
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run test/edition.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat: applyEdition + edition picker + tests"
```

---

## Task 5: Phase A gate — full test + lint pass

**Files:** none (verification).

- [ ] **Step 1: Run the full suite**

Run: `cd /Users/vibeyang/wordle && npx vitest run`
Expected: all tests pass, including the existing suite (no regressions from new files).

- [ ] **Step 2: Confirm new files are self-contained**

Run: `grep -rn "Wordle Race\|Wurdul" public/edition.js public/editions/ || echo "clean: no legacy names"`
Expected: `clean: no legacy names`.

- [ ] **Step 3: Push Phase A to main**

Phase A is new files only — safe to land independently of the other agent.
```bash
git fetch origin main && git rebase origin/main
npx vitest run
git push origin HEAD:main
```
Expected: rebase clean (new files don't touch shared files), tests pass, push succeeds.

---

## ⚠️ PHASE B GATE — coordination required

Before ANY Task 6–10 step, confirm the other agent's in-flight work on
`public/app.js`, `public/style.css`, `public/index.html`, `src/worker.ts` is
**merged to main**, or that you hold an explicit `.claude/COLONY.md` handoff for
those files. If not, STOP and surface to Yan. Re-run `git fetch origin main &&
git rebase origin/main` at the start of Phase B.

---

## Task 6: Pre-paint edition bootstrap

**Files:**
- Modify: `public/index.html` (in `<head>`, before the stylesheet `<link>`)

- [ ] **Step 1: Confirm coordination (Phase B gate), then add bootstrap**

In `public/index.html`, immediately BEFORE `<link rel="stylesheet" href="/style.css" />`, insert:
```html
<script>
  // Set the edition before first paint to avoid a flash of the wrong theme.
  try {
    document.documentElement.dataset.edition =
      localStorage.getItem("wordul.edition") || "default";
  } catch (e) {}
</script>
```

- [ ] **Step 2: Verify dev server serves it**

Run: `cd /Users/vibeyang/wordle && npx wrangler deploy --dry-run 2>&1 | tail -3`
Expected: dry-run completes (HTML is a static asset; this confirms config still valid).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: pre-paint edition bootstrap"
```

---

## Task 7: Engine hooks in app.js — apply + motion

**Files:**
- Modify: `public/app.js` (top imports; load path ~app.js:127–136; reveal consts app.js:261–262)

- [ ] **Step 1: Import + apply on load**

Add to the import block at the top of `public/app.js`:
```js
import { applyEdition, getActiveEditionId } from "/edition.js";
```
Then, at the start of the app entry (right after the existing top-level setup, before first `parseRoute()`/route handling runs), add:
```js
applyEdition(getActiveEditionId());
```

- [ ] **Step 2: Make reveal timing edition-driven**

At `public/app.js:261-262`, replace:
```js
const REVEAL_STAGGER_MS = 220;
const REVEAL_FLIP_HALF_MS = 275; // matches the 0.55s tile-reveal keyframe halfway point
```
with:
```js
const REVEAL_STAGGER_MS = window.WordulMotion?.revealStaggerMs ?? 220;
const REVEAL_FLIP_HALF_MS = window.WordulMotion?.flipHalfMs ?? 275;
```

- [ ] **Step 3: Verify no regressions**

Run: `cd /Users/vibeyang/wordle && npx vitest run`
Expected: existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: apply edition on load + edition-driven reveal timing"
```

---

## Task 8: Engine hooks — gold HUD, power-ups, companion events

**Files:**
- Modify: `public/app.js`

This task wires the new UI. The exact insertion points depend on the current
header/render structure; follow the pattern below and place the HUD in the room
header render (`renderRoomHeader`, ~app.js:321) and fire companion events in the
guess-submit + win/loss paths (within `render`/submit handlers).

- [ ] **Step 1: Add a gold HUD render helper near the top-level helpers**

```js
import { getGold, earnGold, spendGold, companionReact } from "/edition.js";

function renderGoldHud() {
  let hud = document.getElementById("goldHud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "goldHud";
    hud.className = "gold-hud";
    const header = document.querySelector(".room-header") || document.body;
    header.appendChild(hud);
  }
  hud.textContent = `◆ ${getGold()}`;
}
```
(Merge this `import` with the Task 7 import from `/edition.js` into one line.)

- [ ] **Step 2: Add a companion toast helper**

```js
function showCompanion(event, ctx) {
  const { text, speak } = companionReact(event, ctx);
  if (!text) return;
  let el = document.getElementById("companionToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "companionToast";
    el.className = "companion-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("is-show");
  setTimeout(() => el.classList.remove("is-show"), 3200);
  if (speak && window.speechSynthesis) {
    // VOICE: swap speechSynthesis for cloned-voice audio here later
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  }
}
```

- [ ] **Step 3: Fire companion events + gold at the right moments**

- On an invalid word submission (where the engine currently shakes / shows the "not a word" path): call `showCompanion("invalid")`.
- On a submitted guess that is wrong (row complete, not the answer, game continues): call `showCompanion("wrong")`.
- On win (the existing win path): call `showCompanion("win")`, then `earnGold(guessCount)` and `renderGoldHud()`.
- On loss (out of rows): call `showCompanion("loss", { answer: ANSWER })` using the engine's answer variable.
- After `renderRoomHeader()` runs, call `renderGoldHud()`.

- [ ] **Step 4: Add power-up buttons (Reveal −20, Vowel hint −10)**

In the room playing UI, add two buttons and handlers:
```js
function wirePowerups(answer, applyRevealFn) {
  const reveal = document.getElementById("puReveal");
  const vowel = document.getElementById("puVowel");
  if (reveal) {
    reveal.disabled = getGold() < 20;
    reveal.onclick = () => {
      if (spendGold(20)) { applyRevealFn(answer); renderGoldHud(); showCompanion("idle"); }
    };
  }
  if (vowel) {
    vowel.disabled = getGold() < 10;
    vowel.onclick = () => {
      if (spendGold(10)) {
        const vowels = (answer.match(/[aeiou]/gi) || []).length;
        showCompanion("idle");
        showCompanionRaw?.(`Vowels: ${vowels}`);
        renderGoldHud();
      }
    };
  }
}
```
Add the buttons to the playing template/markup with ids `puReveal`, `puVowel`, and implement `applyRevealFn` to reveal one not-yet-correct letter in its position using the engine's existing tile-fill path. Where a raw companion message is needed, reuse `showCompanion` by adding a tiny `showCompanionRaw(text)` variant that displays arbitrary text (factor out the toast body of `showCompanion`).

- [ ] **Step 5: Verify**

Run: `npx vitest run`
Expected: existing tests pass. Manual: in `npx wrangler dev`, gold shows, power-ups spend, companion toasts fire.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat: gold HUD, power-ups, companion events wired into engine"
```

---

## Task 9: Styles — companion toast, gold HUD, power-ups, font vars

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Use the edition font vars on body + headings**

In `style.css`, ensure body uses `var(--font-body, ...)` and the wordmark/headings use `var(--font-display, ...)`. Add to `:root`:
```css
  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Instrument Sans', system-ui, sans-serif;
```
Update the existing `body { font-family: ... }` to `font-family: var(--font-body);` and the logo/wordmark selector to `font-family: var(--font-display);`.

- [ ] **Step 2: Add component styles (edition-neutral, themed via vars)**

```css
.gold-hud {
  font-weight: 600; color: var(--accent);
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px;
}
.companion-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 16px);
  max-width: min(90vw, 420px); padding: 12px 16px;
  background: var(--bg-card); color: var(--fg);
  border: 1px solid var(--border); border-radius: 12px;
  font-family: var(--font-body); opacity: 0; pointer-events: none;
  transition: opacity .25s ease, transform .25s ease; z-index: 50;
}
.companion-toast.is-show { opacity: 1; transform: translate(-50%, 0); }
.powerups { display: flex; gap: 8px; }
.powerups button {
  font: inherit; font-size: 16px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--bg-card); color: var(--fg);
  cursor: pointer;
}
.powerups button:disabled { opacity: .45; cursor: not-allowed; }
.edition-chip {
  font: inherit; font-size: 16px; padding: 6px 14px; border-radius: 999px;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  cursor: pointer;
}
.edition-chip.is-active { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 3: Update :root defaults to the Default edition palette**

Update `:root` color values in `style.css` to match `public/editions/default.js` palette (warm near-black, sage green, muted gold), so the baseline IS the Default edition and there is no override flash.

- [ ] **Step 4: Verify**

Run: `npx vitest run` (no CSS tests, but ensure nothing imports break) and `npx wrangler deploy --dry-run`.
Expected: dry-run OK. Manual: dev server shows the premium Default look.

- [ ] **Step 5: Commit**

```bash
git add public/style.css
git commit -m "feat: premium Default palette + edition component styles"
```

---

## Task 10: Brand rename + coordinated deploy

**Files:**
- Modify: `public/app.js`, `public/index.html`, `public/llms.txt`, `public/llms-full.txt`, `src/worker.ts`

- [ ] **Step 1: Rename all legacy names to Wordul**

Replace every user-facing `Wordle Race` with `Wordul`, and any `Wurdul`/`WURDUL` with `Wordul`. Targeted review per file (don't blindly replace inside URLs/handles — only display copy, titles, meta, JSON-LD names).

Run to find them:
```bash
cd /Users/vibeyang/wordle && grep -rn "Wordle Race\|Wurdul\|WURDUL" public/ src/
```
Edit each occurrence to `Wordul`. In `src/worker.ts` `injectMeta`, update the default title/description and the room/profile templates from "Wordle Race" to "Wordul".

- [ ] **Step 2: Verify the rename is complete**

Run: `grep -rn "Wordle Race\|Wurdul\|WURDUL" public/ src/ || echo "clean: only Wordul remains"`
Expected: `clean: only Wordul remains`.

- [ ] **Step 3: Typecheck + tests + dry-run**

Run:
```bash
npm run typecheck && npx vitest run && npx wrangler deploy --dry-run 2>&1 | tail -3
```
Expected: typecheck clean, tests pass, dry-run OK.

- [ ] **Step 4: Commit**

```bash
git add public/ src/worker.ts
git commit -m "chore: rename Wordle Race/Wurdul -> Wordul across the product"
```

- [ ] **Step 5: Coordinated deploy (SACRED)**

Confirm with Yan + the other agent before deploying the shared `wordle-race` Worker. Then:
```bash
git fetch origin main && git rebase origin/main
npm run typecheck && npx vitest run
git push origin HEAD:main
npx wrangler deploy 2>&1 | grep -E "Version ID|Deployed"
```

- [ ] **Step 6: Prod smoke**

```bash
echo "home: $(curl -s -o /dev/null -w '%{http_code}' https://wordul.com/)"
curl -s https://wordul.com/ | grep -o "Wordul" | head -1
curl -s https://wordul.com/ | grep -c "Wordle Race"   # expect 0
```
Expected: home 200, "Wordul" present, zero "Wordle Race". Manual: Default premium look renders, edition picker shows, gold earns on a win.

---

## Self-Review Notes

- **Spec coverage:** theme-pack object (Task 1) ✓; runtime apply/picker (Task 4) ✓; pre-paint bootstrap (Task 6) ✓; wallet shared + earn/spend (Task 2) ✓; companion seam + canned lines (Tasks 1,3,8) ✓; engine hooks ×5 (Tasks 7–8) ✓; Default premium edition + :root baseline (Tasks 1,9) ✓; CSS components (Task 9) ✓; naming convention + rename (Task 10) ✓; coordination phase gate (Phase B gate + Task 10 step 5) ✓; testing (Tasks 2–5) ✓; error handling: getEdition fallback (Tasks 1,4), corrupt gold reset (Task 2), no-negative-balance (Task 2), speechSynthesis-absent guard (Task 8) ✓.
- **Naming consistency:** exports `getGold/setGold/earnGold/spendGold/resolveEdition/getActiveEditionId/companionReact/applyEdition/renderEditionPicker`; storage keys `wordul.edition/wordul.gold/wordul.muted`; global `window.WordulMotion`; CSS vars per `VAR_MAP`. Consistent across tasks.
- **Phase split:** Phase A (Tasks 1–5, new files) lands independently; Phase B (Tasks 6–10, shared files + rename + deploy) gated on coordination — matches the spec's Sacred coordination stance.
- **Known soft spot:** Task 8 insertion points are pattern-described (not line-exact) because the shared `app.js` is changing under the other agent; the implementer must locate the current win/loss/invalid paths. This is intentional given the coordination constraint.
