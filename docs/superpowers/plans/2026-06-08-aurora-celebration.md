# Aurora Lexicon Celebration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gold-forward win celebration with a word-first "Aurora Lexicon" sequence that teaches the solved word (big word + gloss + a gold-bolded example), then demotes gold to a quiet tail — across all game modes.

**Architecture:** Two changes. (1) Widen the slim client corpus projection so the already-written `gloss`/`example`/`ipa`/`pos` ship to the game. (2) Rewrite the beat order in `public/settle.js`'s `supernova()` renderer: a new DOM "hero" Act 1 (word + meaning, holds) runs first, the existing economy/coin beats become a demoted Act 2, and the duplicate word reveal is removed. `app.js` passes the intel into the renderer; `settle.js` stays decoupled (imports nothing new).

**Tech Stack:** Vanilla ES modules, HTML5 Canvas 2D, Vitest, Cloudflare Workers static assets. Fonts: Fraunces (already loaded). Gold `#f0c14b`, cream `#f4f2ec`, muted `#8a8a8f`.

**Spec:** `docs/superpowers/specs/2026-06-08-aurora-celebration-design.md`

---

## File Structure

- `scripts/lib/intel-merge.mjs` — MODIFY `slimCard()` to emit `gloss`/`example`/`ipa`/`pos`; add a run-as-main CLI to re-serialize the corpus.
- `test/intel-merge.test.js` — ADD a case asserting the wider slim shape.
- `public/data/word-intel.js` — REGENERATED artifact (wider per-word shape).
- `data/word-intel-rich.js` — REGENERATED artifact (byte-identical content, re-sorted/serialized).
- `public/locales/en.js` — ADD `settle.theWordIs` / `settle.theWordWas`.
- `public/settle.js` — ADD Act 1 hero DOM + `lexiconReveal()` + `buildExample()`; reorder beats; demote payout; remove Beat 5 `wordReveal`; update reduced-motion fallback.
- `public/app.js` — pass `outcome`/`gloss`/`example`/`ipa`/`pos`/`def` into `renderSettlement` at both call sites.

---

## Task 1: Widen the slim corpus projection

**Files:**
- Modify: `scripts/lib/intel-merge.mjs` (`slimCard`, `HEADER_SLIM`, add main CLI)
- Test: `test/intel-merge.test.js`
- Regenerate: `public/data/word-intel.js`, `data/word-intel-rich.js`

- [ ] **Step 1: Write the failing test**

Add this case inside the `describe("intel-merge", ...)` block in `test/intel-merge.test.js`, after the existing `writeSlim` test:

```js
  it("writeSlim includes gloss/example/ipa/pos when the card has senses", async () => {
    const rich = card("FOCAL", {
      ipa: "/ˈfoʊ.kəl/", pos: "adjective",
      senses: [{ pos: "adjective", gloss: "the center of attention", example: "All eyes found the focal point." }],
    });
    writeSlim(slim, { FOCAL: rich });
    const mod = await import(pathToFileURL(slim).href);
    expect(mod.WORD_INTEL.FOCAL).toEqual({
      def: "FOCAL def",
      gloss: "the center of attention",
      example: "All eyes found the focal point.",
      ipa: "/ˈfoʊ.kəl/",
      pos: "adjective",
      fact: "FOCAL fact",
      quote: "FOCAL quote",
      author: "Someone",
    });
    expect(mod.WORD_INTEL.FOCAL.senses).toBeUndefined(); // rich-only field stays out of the slim file
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/intel-merge.test.js -t "includes gloss"`
Expected: FAIL — received object lacks `gloss`/`example`/`ipa`/`pos`.

- [ ] **Step 3: Implement the wider `slimCard`**

In `scripts/lib/intel-merge.mjs`, replace the `slimCard` function with:

```js
function slimCard(card) {
  const out = { def: card.def };
  const sense = Array.isArray(card.senses) ? card.senses[0] : null;
  if (sense?.gloss) out.gloss = sense.gloss;       // short definition for the celebration headword
  if (sense?.example) out.example = sense.example; // vivid sentence using the word
  if (card.ipa) out.ipa = card.ipa;                // headword line: /ˈfoʊ.kəl/
  if (card.pos) out.pos = card.pos;                // · adjective
  const fact = (Array.isArray(card.facts) && card.facts[0]) || card.fact;
  if (fact) out.fact = fact;
  if (card.quote) out.quote = card.quote;
  if (card.author) out.author = card.author;
  return out;
}
```

Also update `HEADER_SLIM` — change the second line to:

```js
  "// Per word: { def, gloss?, example?, ipa?, pos?, fact?, quote?, author? }. Rich page corpus: data/word-intel-rich.js.\n" +
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/intel-merge.test.js`
Expected: PASS (all cases, including the existing `writeSlim` OCEAN case — it has no `senses`/`ipa`/`pos`, so the new fields stay absent).

- [ ] **Step 5: Add a run-as-main CLI to re-serialize the live corpus**

`mergeStagingToCorpus` has no CLI entrypoint. Append to the END of `scripts/lib/intel-merge.mjs` (after all exports):

```js
// CLI: `node scripts/lib/intel-merge.mjs` re-serializes the committed corpus with the current
// slim/rich projections (empty staging = no content change, just a wider slim shape). Idempotent.
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = new URL("../../", import.meta.url).pathname;
  const richPath = ROOT + "data/word-intel-rich.js";
  const slimPath = ROOT + "public/data/word-intel.js";
  const stagingDir = ROOT + ".intel-staging-empty"; // does not exist → readVerifiedCards returns {}
  const res = await mergeStagingToCorpus({ stagingDir, richPath, slimPath });
  console.log(`reslim: ${res.keys.length} words → ${slimPath}`);
}
```

Confirm the existing imports at the top of the file already include `existsSync`/`readFileSync` (they do, used by `readVerifiedCards`). `fileURLToPath` is imported locally here to avoid touching the header.

- [ ] **Step 6: Regenerate the corpus**

Run: `node scripts/lib/intel-merge.mjs`
Expected: prints `reslim: 2315 words → .../public/data/word-intel.js`.

- [ ] **Step 7: Verify the slim file now carries the meaning fields**

Run:
```bash
node -e "import('./public/data/word-intel.js').then(m=>console.log(JSON.stringify(m.WORD_INTEL.ABACK)))"
```
Expected: an object that now includes `gloss`, `example`, `ipa`, `pos` (plus `def`). For ABACK, `gloss` ≈ "Startled or disconcerted, almost always in the idiom 'taken aback'." and `example` ≈ "She was taken aback by how bluntly he answered."

- [ ] **Step 8: Confirm the full suite is green**

Run: `npm test`
Expected: PASS (the merge idempotence test still holds; rich file content unchanged).

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/intel-merge.mjs test/intel-merge.test.js public/data/word-intel.js data/word-intel-rich.js
git commit -m "feat(intel): ship gloss/example/ipa/pos to the slim client corpus"
```

---

## Task 2: Add the two i18n keys

**Files:**
- Modify: `public/locales/en.js`

- [ ] **Step 1: Add the keys**

In `public/locales/en.js`, inside the `// Settlement screen (settle.js)` block (right after the `"settle.skip"` line), add:

```js
  "settle.theWordIs": "the word is",
  "settle.theWordWas": "the word was",
```

- [ ] **Step 2: Verify the build still parses locales**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add public/locales/en.js
git commit -m "feat(i18n): word-reveal kicker strings for the lexicon celebration"
```

---

## Task 3: Aurora Act 1 — the word + meaning hero

**Files:**
- Modify: `public/settle.js` (add hero DOM + helpers; this task only ADDS, Task 4 reorders)

- [ ] **Step 1: Read `opts` for the meaning fields**

In `supernova()`, after the `answerWord` declaration (~line 120), add:

```js
  const metaText = [opts.ipa, opts.pos].filter(Boolean).join(" · ");
  const glossText = (typeof opts.gloss === "string" && opts.gloss.trim())
    || (typeof opts.def === "string" && opts.def.trim())
    || "";
  const exampleText = typeof opts.example === "string" ? opts.example.trim() : "";
  const isLoss = receipt.payout <= 0;
```

- [ ] **Step 2: Add the hero DOM block**

In the canvas path, after `overlay.appendChild(payoutEl);` (~line 238) and before `document.body.appendChild(overlay);`, insert:

```js
    // Act 1 — Aurora Lexicon hero: the word + its meaning, the lesson of the round.
    const heroEl = document.createElement("div");
    heroEl.style.cssText = `
      position:absolute; left:0; right:0; top:50%; transform:translateY(-50%);
      z-index:8; text-align:center; padding:0 24px; pointer-events:none;
      transition:opacity .5s ease, transform .6s cubic-bezier(.4,0,.2,1);
    `;
    const heroKicker = document.createElement("div");
    heroKicker.style.cssText = `font-size:13px; letter-spacing:.34em; text-transform:uppercase;
      color:#8a8a8f; opacity:0; transform:translateY(8px); transition:.5s ease; margin-bottom:14px;`;
    const heroWord = document.createElement("div");
    heroWord.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:900; line-height:.92;
      font-size:clamp(56px,12vw,140px); color:#f0c14b; display:flex; justify-content:center; flex-wrap:wrap;
      text-shadow:0 0 60px rgba(240,193,75,.45),0 0 14px rgba(240,193,75,.6);`;
    const heroMeta = document.createElement("div");
    heroMeta.style.cssText = `font-family:'Fraunces',Georgia,serif; font-style:italic;
      font-size:clamp(15px,2.4vw,20px); color:#8a8a8f; margin-top:10px;
      opacity:0; transform:translateY(8px); transition:.5s ease .1s;`;
    const heroRule = document.createElement("div");
    heroRule.style.cssText = `height:1px; width:0; margin:26px auto 22px;
      background:linear-gradient(90deg,transparent,#a87a14,#f0c14b,#a87a14,transparent);
      transition:width .8s cubic-bezier(.2,.8,.2,1);`;
    const heroGloss = document.createElement("div");
    heroGloss.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:600;
      font-size:clamp(20px,4vw,32px); color:#f4f2ec; line-height:1.25; max-width:18em; margin:0 auto;
      opacity:0; transform:translateY(12px); transition:.6s ease;`;
    const heroExample = document.createElement("div");
    heroExample.style.cssText = `font-family:'Fraunces',Georgia,serif; font-style:italic;
      font-size:clamp(16px,2.8vw,21px); color:#8a8a8f; margin:18px auto 0; max-width:22em; line-height:1.5;
      opacity:0; transform:translateY(12px); transition:.6s ease .12s;`;
    heroEl.append(heroKicker, heroWord, heroMeta, heroRule, heroGloss, heroExample);
    overlay.appendChild(heroEl);
```

- [ ] **Step 3: Add the `buildExample` + `lexiconReveal` helpers**

After the `wordReveal` function (~line 489), add:

```js
    // Bold the answer word (gold) inside its example sentence — safe DOM, no innerHTML.
    function buildExample(el, word, sentence) {
      while (el.firstChild) el.removeChild(el.firstChild);
      const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
      const m = sentence.match(re);
      if (!m) { el.textContent = sentence; return; }
      el.appendChild(document.createTextNode(sentence.slice(0, m.index)));
      const b = document.createElement("b");
      b.style.cssText = "color:#f0c14b; font-weight:600;";
      b.textContent = m[0];
      el.appendChild(b);
      el.appendChild(document.createTextNode(sentence.slice(m.index + m[0].length)));
    }

    // Act 1: the word assembles letter-by-letter, then meaning fades in beneath. Calm, editorial.
    async function lexiconReveal() {
      heroKicker.textContent = isLoss
        ? tFn("settle.theWordWas", "the word was")
        : tFn("settle.theWordIs", "the word is");
      const stagger = 70, dur = 550;
      [...answerWord].forEach((ch, i) => {
        const s = document.createElement("span");
        s.textContent = ch;
        s.style.cssText = `display:inline-block; opacity:0; transform:translateY(38px) rotate(6deg);
          transition:opacity ${dur}ms ease ${120 + i * stagger}ms,
                      transform ${dur}ms cubic-bezier(.2,.9,.3,1.4) ${120 + i * stagger}ms;`;
        heroWord.appendChild(s);
      });
      shake = 7; ringBurst("#f0c14b", 3);
      playChime?.([[660, 0]]);
      requestAnimationFrame(() => heroWord.querySelectorAll("span").forEach((s) => {
        s.style.opacity = "1"; s.style.transform = "none";
      }));
      await Promise.race([sleep(120 + answerWord.length * stagger + 180), skipRace]);
      // kicker + headword meta
      heroKicker.style.opacity = "1"; heroKicker.style.transform = "none";
      if (metaText) { heroMeta.textContent = metaText; heroMeta.style.opacity = "1"; heroMeta.style.transform = "none"; }
      heroRule.style.width = "min(420px,70%)";
      // meaning
      if (glossText) {
        heroGloss.textContent = glossText;
        heroGloss.style.opacity = "1"; heroGloss.style.transform = "none";
      }
      if (exampleText) {
        buildExample(heroExample, answerWord, exampleText);
        heroExample.style.opacity = "1"; heroExample.style.transform = "none";
      }
      // hold the lesson
      await Promise.race([sleep(glossText ? 2300 : 1400), skipRace]);
    }
```

- [ ] **Step 4: Syntax check**

Run: `npm run typecheck`
Expected: PASS (no type errors; this is JS but typecheck parses it via the project config).

- [ ] **Step 5: Commit (WIP — wired in Task 4)**

```bash
git add public/settle.js
git commit -m "feat(settle): add Aurora Lexicon hero (word + meaning) Act 1 scaffolding"
```

---

## Task 4: Reorder beats — word first, gold demoted

**Files:**
- Modify: `public/settle.js` (the animation sequence IIFE, ~lines 540-716; the payout figure styles, ~lines 222-238)

- [ ] **Step 1: Run Act 1 first, then fade the hero before the economy beats**

In the `(async () => { ... })()` sequence (starts ~line 540), insert at the very top of the function body — immediately after `const c = orbitCenter();`:

```js
      // ── Act 1: the word + its meaning (the lesson). Shows on win AND loss. ──
      if (answerWord && !skipFired) {
        await lexiconReveal();
        // Lift + fade the hero, freeing center stage for the demoted gold tail.
        heroEl.style.opacity = "0";
        heroEl.style.transform = "translateY(-58%) scale(.96)";
        await Promise.race([sleep(420), skipRace]);
        heroEl.style.display = "none";
      }
```

- [ ] **Step 2: Remove the duplicate word reveal at Beat 5**

In Beat 5 (~lines 644-655), replace this block:

```js
      if (!skipFired) {
        if (isWin && answerWord) {
          // The actual word IS the supernova — randomized entrance every time.
          await wordReveal(answerWord);
        } else {
          await caption(
            isWin
              ? [{ text: tFn("settle.caption.supernova", "supernova"), color: "#f0c14b" }]
              : [{ text: `${tFn("settle.caption.tableKeepsIt", "the table keeps it")} — ` }, { text: bustLabel, color: "#e0796b" }],
          );
        }
      }
```

with (the word already led in Act 1; only the no-word / caption case remains):

```js
      if (!skipFired && !answerWord) {
        await caption(
          isWin
            ? [{ text: tFn("settle.caption.supernova", "supernova"), color: "#f0c14b" }]
            : [{ text: `${tFn("settle.caption.tableKeepsIt", "the table keeps it")} — ` }, { text: bustLabel, color: "#e0796b" }],
        );
      }
```

`wordReveal` is now unused by the live path but stays defined (still used if a future renderer wants it; leaving it avoids an unrelated deletion). If `npm run typecheck`/lint flags it as unused and fails the build, prefix with `// eslint-disable-next-line no-unused-vars` above its declaration.

- [ ] **Step 3: Demote the payout figure (smaller, lower)**

The word was the hero; the payout is now the chaser. In the `payN` style (~line 228) change the font-size and shadow, and move `payoutEl` lower. Replace the `payoutEl` style (~line 223-226) `top:40%` with `top:62%`, and replace the `payN` `font-size:clamp(64px,13vw,150px)` with `font-size:clamp(40px,8vw,84px)`. Concretely:

`payoutEl.style.cssText` → change `top:40%;` to `top:62%;`
`payN.style.cssText` → change `font-size:clamp(64px,13vw,150px);` to `font-size:clamp(40px,8vw,84px);`

- [ ] **Step 4: Soften the coin volume in Act 2**

The center-stage spiral becomes a quieter sweep. In Beat 1 (mint), reduce the visual cap: change `const mintCount = Math.min(receipt.minted, 60);` (~line 549) to `const mintCount = Math.min(receipt.minted, 28);`. (Captions still show the honest number; this only thins the particle field so gold reads as a tail, not the headline.)

- [ ] **Step 5: Update the reduced-motion static fallback to teach too**

In the `if (reducedMotion)` block (~lines 124-157), before the `for (const ln of lines)` loop, add a word + meaning header so the lesson survives reduced motion:

```js
      if (answerWord) {
        const wEl = document.createElement("div");
        wEl.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:900;
          font-size:clamp(40px,10vw,96px); color:#f0c14b; line-height:1; margin-bottom:6px;`;
        wEl.textContent = answerWord;
        inner.appendChild(wEl);
        if (glossText) {
          const gEl = document.createElement("div");
          gEl.style.cssText = `font-family:'Fraunces',Georgia,serif; font-weight:600;
            font-size:clamp(17px,3.5vw,24px); color:#f4f2ec; max-width:18em; margin:0 auto 18px;`;
          gEl.textContent = glossText;
          inner.appendChild(gEl);
        }
      }
```

(`glossText`/`answerWord` are in scope — they're declared near the top of `supernova()`.)

- [ ] **Step 6: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/settle.js
git commit -m "feat(settle): word-first beat order — Aurora Act 1 leads, gold demoted to a tail"
```

---

## Task 5: Wire the intel into both call sites

**Files:**
- Modify: `public/app.js` (`maybeRunSettlement` ~L2776, `cashOutDaily` ~L2819)

- [ ] **Step 1: Pass intel + outcome in `maybeRunSettlement`**

Find the `renderSettlement(me.receipt, { ... word: ... })` call inside `maybeRunSettlement` (~L2791). Immediately BEFORE it, resolve the word + intel once, and add the new opts. The word expression already exists in the call — lift it into a local:

```js
    const answer = msg.room.word || (me.status === "won" ? me.guesses?.[me.guesses.length - 1]?.word : null);
    const intel = answer ? (wordIntel(answer) || {}) : {};
```

Then in the options object passed to `renderSettlement`, set `word: answer` and add:

```js
      outcome: me.status,
      gloss: intel.gloss, example: intel.example, ipa: intel.ipa, pos: intel.pos, def: intel.def,
```

(Keep all existing opts — `walletBefore`, `onWalletTick`, `playChime`, etc. — unchanged.)

- [ ] **Step 2: Pass intel + outcome in `cashOutDaily`**

Find the `renderSettlement(me.receipt, { ... })` call in `cashOutDaily` (~L2845). Apply the identical pattern: lift the answer word into a local, resolve `intel`, and add the same five `gloss/example/ipa/pos/def` opts plus `outcome: me.status`. The daily-specific opts (`lines: dailyReceiptLines(...)`, `bonusCaption`) stay unchanged.

```js
    const answer = me.status === "won" ? me.guesses?.[me.guesses.length - 1]?.word : (game.dailyWord || null);
    const intel = answer ? (wordIntel(answer) || {}) : {};
```

and in the opts object: `word: answer`, plus `outcome: me.status, gloss: intel.gloss, example: intel.example, ipa: intel.ipa, pos: intel.pos, def: intel.def,`.

> Note: confirm at execution time how the daily answer word is reachable on a LOSS (so the lesson shows). If `game.dailyWord` isn't the right field, use whatever the daily reveal card (`renderDailyUnlock`) reads — it already renders the word on loss, so the value is available client-side. Match that source.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`wordIntel` is already imported at app.js:36.)

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(app): feed word intel (gloss/example/ipa/pos) into the celebration, all modes"
```

---

## Task 6: Live verification

**Files:** none (manual verification)

- [ ] **Step 1: Build**

Run: `npm run dev` (serves locally) — or rely on the prod smoke after ship.

- [ ] **Step 2: Verify Act 1 on a win**

Play a daily/practice game to a win. Expected, in order: kicker "the word is" → the word assembles in gold → `ipa · pos` line → gold rule draws → gloss (cream) → example with the **word bolded gold** → holds ~2.3s → hero lifts/fades → demoted gold payout settles low → wallet ticks.

- [ ] **Step 3: Verify Act 1 on a loss**

Lose a game. Expected: kicker reads "the word was", word + meaning still shown (the lesson is for exactly this player), then the bust tail.

- [ ] **Step 4: Verify graceful fallback at a non-5 length**

Play a 6-letter game to a win. Expected: word shows, no gloss/example lines (no intel yet), demoted gold tail — no errors in console.

- [ ] **Step 5: Verify reduced motion**

With OS "reduce motion" on (or `opts.reducedMotion`), the static fallback shows the word + gloss header above the receipt lines.

- [ ] **Step 6: Gauntlet before ship**

Run the `/push` pre-flight (`safe-build`, `check-pill-buttons`, `check-input-zoom`, `code-reviewer`, `silent-failure-hunter`) and `npm test`. All green → ship via `bash dev/ship.sh`.

---

## Self-Review

- **Spec coverage:** Part A → Task 1. Part B (Act 1 + demoted Act 2 + bolding + fallback + reduced motion) → Tasks 3, 4. Part C (wiring) → Task 5. Part D (i18n) → Task 2. Testing → Tasks 1, 6. ✓
- **Type/name consistency:** `glossText`, `exampleText`, `metaText`, `isLoss`, `answerWord` declared once in Task 3 Step 1, used in Tasks 3–4. `heroEl`/`heroWord`/`heroGloss`/`heroExample`/`heroKicker`/`heroMeta`/`heroRule` declared in Task 3 Step 2, used in Step 3 + Task 4. `buildExample`/`lexiconReveal` defined Task 3 Step 3, called Task 4 Step 1. opts keys `gloss/example/ipa/pos/def/outcome` produced in Task 5, consumed in Task 3 Step 1. ✓
- **Placeholder scan:** one intentional execution-time confirmation in Task 5 Step 2 (the daily loss-word source) — flagged, not a code placeholder. No TBD/TODO in code steps. ✓
- **Fallback chain:** `glossText = opts.gloss || opts.def || ""`; example only when present; whole block skipped when no `answerWord`. ✓
