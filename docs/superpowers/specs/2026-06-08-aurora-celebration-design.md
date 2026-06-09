# Aurora Lexicon — win celebration that teaches the word

**Date:** 2026-06-08
**Status:** approved design → implementation
**Scope:** Workstream #1 only (the celebration UI + shipping existing meaning content to the
client). Workstreams #2 (all-length content backfill) and #3 (auto-pipeline for future words)
are separate specs — see "Follow-on work" at the end.

---

## Problem

The win celebration is gold-forward and dated: a coin **spiral/orbit** swirls, points convert to
gold (`2,375 pts → ◆ 264`), and a big `◆ 177 · TO YOUR WALLET · NET +177` reveal dominates,
captioned with a hardcoded flavour word ("supernova"). The solved word itself is a fleeting
letter-reveal with **no meaning attached**.

Result: players win without learning. A real user solved `GOALIE` in 5 and, when asked, didn't
know what it meant. The game took their dopamine and taught them nothing. The celebration should
make the **word and its meaning** the hero, and demote gold to a quiet reward chaser.

The winning direction (chosen from 3 live prototypes) is **Aurora Lexicon**:
<https://wordul.com/designs/celebrate-aurora-lexicon> — word as typographic hero, dictionary
headword energy, gloss + a vivid example sentence, gold reduced to a thin tail.

## Goals

- The solved word is the visual hero, held long enough to read and absorb (~2.6s).
- Directly beneath it: a **micro-gloss** (2–6 words) + a **vivid example sentence** with the word
  bolded in gold — three exposures (see it → define it → use it) in one beat.
- Gold payout still happens but is **demoted**: a thin tail ticker, not a center-stage spiral.
- Works for **every mode** (daily, race, duel, arena, challenge) — one renderer.
- Shows the lesson on **wins and losses** (losing and learning the word is the consolation).
- Ships with **real content for the classic 5-letter game today**; degrades gracefully at other
  lengths until their content lands (#2).

## Non-goals (this spec)

- Generating intel/wiki for non-5-letter words (~168k words) — that's #2.
- The auto-pipeline so future words self-populate — that's #3.
- Changing the gold economy math (`receipt` is unchanged).

---

## Key discovery

The gloss + example content **already exists** for all 2,315 five-letter answer words. The rich
corpus `data/word-intel-rich.js` carries `senses: [{ pos, gloss, example }]` per word. The only
reason the game can't show it is that the slim client corpus `public/data/word-intel.js` (the file
`public/app.js` imports) **drops `senses`** during serialization. So the 5-letter game needs
*no new content* — only a wider slim projection.

---

## Design

### Part A — ship the meaning data to the client

**File:** `scripts/lib/intel-merge.mjs` → `slimCard(card)`

Extend the slim projection to emit the fields Aurora needs, pulled from the first sense:

```js
function slimCard(card) {
  const out = { def: card.def };
  const fact = (Array.isArray(card.facts) && card.facts[0]) || card.fact;
  if (fact) out.fact = fact;
  const sense = Array.isArray(card.senses) ? card.senses[0] : null;
  if (sense?.gloss)   out.gloss   = sense.gloss;     // 2–6 word micro-definition
  if (sense?.example) out.example = sense.example;   // vivid sentence using the word
  if (card.ipa)       out.ipa     = card.ipa;        // headword line: /ˈfoʊ.kəl/
  if (card.pos)       out.pos     = card.pos;        // · adjective
  if (card.quote)     out.quote   = card.quote;
  if (card.author)    out.author  = card.author;
  return out;
}
```

Update `HEADER_SLIM` to document the new per-word shape:
`{ def, gloss?, example?, ipa?, pos?, fact?, quote?, author? }`.

**Regenerate the committed slim + rich files.** `mergeStagingToCorpus()` writes both files but has
no CLI entrypoint (only `test/intel-merge.test.js` calls it). Add a thin CLI to
`scripts/lib/intel-merge.mjs` (run-as-main guard) that re-serializes the existing rich corpus with
an empty staging dir — a deterministic, idempotent pass that simply rewrites both files with the
wider slim shape:

```
node scripts/lib/intel-merge.mjs            # reslim from data/word-intel-rich.js → both files
```

The slim file grows by ~2 short strings/word (gloss+example) plus ipa/pos; acceptable for the
payoff. `wordIntel(word)` now returns `{ def, gloss?, example?, ipa?, pos?, ... }`.

### Part B — the Aurora celebration (rewrite `supernova()` beats)

**File:** `public/settle.js` — the registered `supernova` renderer. Keep the cosmic canvas backdrop
(stars + soft nebula) and the existing coin/payout machinery; **reorder and re-weight the beats** so
the word/meaning leads and gold trails.

New beat order inside `supernova(receipt, opts)`:

1. **Act 1 — The Word (hero, holds ~2.6s).** Whenever `opts.word` is known (win OR loss):
   - Kicker (tracked caps, muted): `settle.theWordIs` = "the word is" on a win,
     `settle.theWordWas` = "the word was" on a loss.
   - The word — reuse the existing `wordReveal(word)` letter cascade (Fraunces 900, `#f0c14b`).
   - Headword line (muted italic): `ipa · pos` when present (e.g. `/ˈfoʊ.kəl/ · adjective`).
   - A hairline gold rule draws across.
   - **Gloss** (Fraunces 600, cream): `intel.gloss`.
   - **Example** (italic, muted) with the answer word bolded gold: `intel.example`, see bolding
     rule below.
   - Hold. (Tap-to-continue still available via the existing skip affordance.)

   `opts` gains `gloss`, `example`, `ipa`, `pos`, `outcome` (`"won"|"lost"`). `settle.js` stays
   decoupled — `app.js` passes these in (it already calls `wordIntel`); `settle.js` imports nothing
   new.

2. **Act 2 — The reward (demoted tail).** The existing economy beats run here, visually compressed
   and pinned low (a thin bottom ticker, smaller type, faster), ending on the existing
   `◆ +N · to your wallet · net +N` line. Specifically:
   - Keep Beats "mint / multiplier / spends / bonus" (they carry real economy info for daily/race),
     but render them as the demoted tail rather than the centerpiece, and **remove the second
     `wordReveal` at Beat 5** (the word is already the hero in Act 1).
   - The coin spawn/orbit is reduced to a brief baseline streak into the tally, not the
     center-stage spiral.
   - `settle.caption.supernova` fallback caption is retained **only** for the no-word edge case.

**Example bolding rule.** `intel.example` is a plain sentence containing the answer word. At render
time, bold the first case-insensitive whole-word occurrence of `opts.word` in gold; if no match
(inflected form, etc.), render the sentence unstyled. Build via safe DOM (textContent + a `<b>`
node), matching the file's existing `caption()`/`wordReveal()` no-`innerHTML` rule.

**Fallback chain for the meaning block:** `gloss` → else trimmed `def` → else omit the meaning
lines entirely (word still shown). `example` shows only when present. So a length-6 win today
(no intel) shows word + gold tail and nothing breaks; it auto-upgrades when #2 lands.

**Reduced motion:** respect the existing `opts.reducedMotion` — no letter cascade or coin motion;
reveal word + meaning statically, then show the tally.

### Part C — wiring (`public/app.js`)

`maybeRunSettlement` (~L2776) and `cashOutDaily` (~L2819) already pass `word` into
`renderSettlement`. Extend both call sites to also pass the intel:

```js
const intel = wordIntel(word) || {};
renderSettlement(me.receipt, {
  ...existing,
  word,
  outcome: me.status,            // "won" | "lost"
  gloss: intel.gloss, example: intel.example, ipa: intel.ipa, pos: intel.pos,
});
```

No other call sites change; the one renderer covers all modes.

### Part D — i18n

New locale keys, added to **every** locale file (gauntlet `check-i18n` enforces parity):
`settle.theWordIs` = "the word is", `settle.theWordWas` = "the word was". Reuse existing
`settle.toWallet`, `settle.net`. No hardcoded user-facing strings.

---

## Testing

- **`test/intel-merge.test.js`** — update slim-shape expectations to include `gloss`/`example`/
  `ipa`/`pos`; assert byte-idempotent re-serialization still holds (TDD: write the failing
  assertion first, then change `slimCard`).
- **New unit test** for the meaning-block fallback chain: gloss present → gloss; gloss absent +
  def present → trimmed def; both absent → no meaning lines. And example-bolding: word present in
  sentence → bolded span; word absent → plain sentence, no crash.
- **Manual (prod-after-ship):** solve the daily; confirm Act 1 word + gloss + bolded example holds,
  then the demoted gold tail. Verify a loss shows "the word was" + meaning. Spot-check a non-5
  length (word + gold, no meaning, no error).
- **Gauntlet:** `safe-build`, `check-i18n`, `check-pill-buttons`, `check-input-zoom` (no inputs
  here, but keep green), `code-reviewer`, `silent-failure-hunter`. The iOS input-zoom guard is
  untouched.

## Risks

- **Slim file size** grows (~2 strings + ipa/pos × 2,315). Small; gzip-friendly. Acceptable.
- **Beat reorder** is the real surgery — Act 2 must stay readable and not feel like an afterthought.
  Mitigate by keeping the economy beats intact, just demoted; tune timing on prod.
- **Example bolding** on inflected forms silently shows an unstyled sentence — acceptable
  degradation, logged as a known limitation, not a failure.

---

## Follow-on work (separate specs — NOT this session)

- **#2 — All-length content backfill.** Generate `gloss`/`example`/`def`/wiki for lengths 4, 6–12
  (~168k answer words) via `gen-word-intel.mjs --length N` + `gen-word-pages.mjs --length N`. A
  large, real-cost LLM batch (Anthropic API). Needs its own cost/time estimate and a go/no-go.
- **#3 — Auto-pipeline.** Implement the planned
  `docs/superpowers/plans/2026-06-04-auto-wiki-sync.md` orchestrator (coverage gaps → generate
  verified cards → merge → render pages → deploy) so every future word self-populates intel +
  wiki. Builds on Parts A/C above (the slim projection is already correct once this ships).
