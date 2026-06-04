# Word Wiki Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static, indexable page for every Wordul answer word at `/word/<word>` — definition, fact, quote, etymology, related-word links, an OG card, and JSON-LD — and point the end-of-game reveal at it.

**Architecture:** A build-time generator (`scripts/gen-word-pages.mjs`) reads the existing `public/data/word-intel.js` corpus + a pure word-graph module and renders one fully-formed `public/word/<slug>.html` per answer word (committed). OG card PNGs are rendered locally and uploaded to an R2 bucket (`wordul-og`), served by the worker at `/word/og/<slug>.png` — mirroring the existing `/designs/*` → `DESIGNS` pattern. The worker serves the pages, a `/words` index, a deterministic `/word/today`, and adds every word URL to `/sitemap.xml`.

**Tech Stack:** Cloudflare Workers + Durable Objects + R2, TypeScript (worker), plain ESM Node scripts (`.mjs`) for build, `@resvg/resvg-js` for SVG→PNG, `@aws-sdk/client-s3` for R2 upload, vitest (node env) for tests.

**Companion plan:** `2026-06-04-word-wiki-stats.md` (live per-word stats) layers on top. This plan ships pages whose stats panel shows a static "be the first to solve it" state until that plan lands.

**Spec:** `docs/superpowers/specs/2026-06-01-word-wiki-design.md`

---

## File Structure

**Build-time (Node ESM, under `scripts/`):**
- `scripts/lib/word-graph.mjs` — pure: anagrams / ±1-letter ladder / shared-start neighbors. (NEW)
- `scripts/lib/word-page.mjs` — pure: render one word's full HTML string from intel + graph. (NEW)
- `scripts/lib/og-card.mjs` — pure: build an SVG card string for a word. (NEW)
- `scripts/lib/words.mjs` — pure: parse answer words + exclusions from source, slug helpers. (NEW)
- `scripts/gen-word-pages.mjs` — orchestrator: write `public/word/*.html` + `public/words.html`, render OG PNGs to `dist/og/`. (NEW)
- `scripts/upload-og.mjs` — upload `dist/og/*.png` to the `wordul-og` R2 bucket via S3 API. (NEW)

**Worker (TypeScript, under `src/`):**
- `src/word-exclusions.ts` — single source of truth for words that get no public page. (NEW)
- `src/words.ts` — pure: answer-word Set + `isWordPage(word)` + `slugFor` / `wordFromSlug` + `wordOfTheDay(date)`. (NEW)
- `src/types.ts` — add `OG: R2Bucket` to `Env`. (MODIFY)
- `src/worker.ts` — routes for `/word/*`, `/word/og/*`, `/words`, `/word/today`; extend `sitemap()`. (MODIFY)

**Client / assets (under `public/`):**
- `public/word-page.js` — tiny script the generated pages load; hydrates the stats panel (placeholder in this plan). (NEW)
- `public/word-page.css` — styles for word pages. (NEW)
- `public/app.js:2185` — flip the end-card "look it up" link to `/word/<word>`. (MODIFY)
- `public/llms.txt`, `public/llms-full.txt` — advertise the wiki. (MODIFY)

**Config:**
- `wrangler.jsonc` — add `OG` R2 binding. (MODIFY)
- `package.json` — add `@resvg/resvg-js`, `@aws-sdk/client-s3` devDeps + build scripts. (MODIFY)

**Tests (under `test/`):**
- `test/word-graph.test.js`, `test/word-page.test.js`, `test/words.test.ts`. (NEW)

---

## Phase 0 — Foundations

### Task 1: Answer-word + slug helpers (pure, worker side)

**Files:**
- Create: `src/words.ts`
- Create: `src/word-exclusions.ts`
- Test: `test/words.test.ts`

- [ ] **Step 1: Create the exclusions source**

```ts
// src/word-exclusions.ts — answer words that should NOT get a public, indexed wiki
// page. They still play in-game; their page route returns a friendly 404. Keep this
// list small and lowercase. Single source of truth (worker + build generator both read it).
export const WORD_EXCLUSIONS: string[] = [
  // e.g. "bitch", "boobs" — fill from a profanity pass before first publish.
];
```

- [ ] **Step 2: Write the failing test**

```ts
// test/words.test.ts
import { describe, it, expect } from "vitest";
import { isWordPage, slugFor, wordFromSlug, wordOfTheDay, ANSWER_WORDS } from "../src/words.ts";

describe("word helpers", () => {
  it("has the full 5-letter answer set", () => {
    expect(ANSWER_WORDS.size).toBe(2315);
    expect(ANSWER_WORDS.has("OCEAN")).toBe(true);
  });
  it("isWordPage is true for an answer word, false for non-answers", () => {
    expect(isWordPage("ocean")).toBe(true);
    expect(isWordPage("OCEAN")).toBe(true);
    expect(isWordPage("zzzzz")).toBe(false);
  });
  it("slug round-trips lowercase", () => {
    expect(slugFor("OCEAN")).toBe("ocean");
    expect(wordFromSlug("ocean")).toBe("OCEAN");
  });
  it("wordOfTheDay is deterministic for a date and is an answer word", () => {
    const w = wordOfTheDay(new Date("2026-06-04T00:00:00Z"));
    expect(ANSWER_WORDS.has(w)).toBe(true);
    expect(wordOfTheDay(new Date("2026-06-04T23:59:00Z"))).toBe(w);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npm test -- words` → Expected: FAIL ("Cannot find module ../src/words.ts").

- [ ] **Step 4: Implement `src/words.ts`**

```ts
// src/words.ts — pure helpers for the word wiki. No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";
import { WORD_EXCLUSIONS } from "./word-exclusions.ts";

/** Every 5-letter answer word, uppercase. The wiki has one page per answer word. */
export const ANSWER_WORDS: Set<string> = new Set(WORDS_BY_SIZE[5].answers);

const EXCLUDED = new Set(WORD_EXCLUSIONS.map((w) => w.toUpperCase()));

/** True when this word should have a public, indexed page. */
export function isWordPage(word: string): boolean {
  const w = String(word).toUpperCase();
  return ANSWER_WORDS.has(w) && !EXCLUDED.has(w);
}

export function slugFor(word: string): string {
  return String(word).toLowerCase();
}
export function wordFromSlug(slug: string): string {
  return String(slug).toUpperCase();
}

/** Deterministic "word of the day": days-since-epoch indexed into the answer list
 *  (sorted for stability). Independent of the multiplayer random-word picker — this is
 *  a purely editorial wiki feature. */
export function wordOfTheDay(date: Date): string {
  const sorted = [...ANSWER_WORDS].sort();
  const day = Math.floor(date.getTime() / 86_400_000);
  return sorted[((day % sorted.length) + sorted.length) % sorted.length];
}
```

- [ ] **Step 5: Run it, verify it passes**

Run: `npm test -- words` → Expected: PASS (4 tests). If the count assertion fails, update `2315` to the real `ANSWER_WORDS.size` it prints.

- [ ] **Step 6: Commit**

```bash
git add src/words.ts src/word-exclusions.ts test/words.test.ts
git commit -m "feat(wiki): answer-word + slug + word-of-day helpers"
```

### Task 2: Add the `OG` R2 binding to config + Env

**Files:**
- Modify: `src/types.ts` (the `Env` interface)
- Modify: `wrangler.jsonc` (`r2_buckets`)
- Modify: `package.json` (devDeps + scripts)

- [ ] **Step 1: Extend `Env` in `src/types.ts`**

In the `Env` interface, add `OG` after `DESIGNS`:

```ts
export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  DIRECTORY: KVNamespace;
  DESIGNS: R2Bucket;
  OG: R2Bucket;
}
```

- [ ] **Step 2: Add the bucket binding in `wrangler.jsonc`**

In the `r2_buckets` array, alongside the `DESIGNS` entry:

```jsonc
"r2_buckets": [
  { "binding": "DESIGNS", "bucket_name": "wordul-designs" },
  { "binding": "OG", "bucket_name": "wordul-og" }
],
```

- [ ] **Step 3: Create the R2 bucket (one-time, real Cloudflare)**

Run: `npx wrangler r2 bucket create wordul-og`
Expected: "Created bucket wordul-og". (If it already exists, that's fine.)

- [ ] **Step 4: Add build deps + scripts to `package.json`**

Add to `devDependencies`: `"@resvg/resvg-js": "^2.6.2"` and `"@aws-sdk/client-s3": "^3.700.0"`.
Add to `scripts`:

```json
"wiki:pages": "node scripts/gen-word-pages.mjs",
"wiki:og": "node scripts/upload-og.mjs"
```

Run: `npm install`
Expected: lockfile updates, no errors.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck && git add src/types.ts wrangler.jsonc package.json package-lock.json
git commit -m "chore(wiki): add OG R2 binding + build deps"
```

---

## Phase 1 — Content corpus

### Task 3: Extend the intel schema (etymology, pos, syllables)

**Files:**
- Modify: `scripts/gen-word-intel.mjs`

- [ ] **Step 1: Widen the model output in `intelFor`**

Replace the `system` string in `intelFor` so it also asks for `etymology`, `pos`, and `syllables`, and update the JSON shape:

```js
    system:
      "You write tiny, accurate, delightful 'word intel' cards for a word game. " +
      "Return ONLY JSON: {\"def\":\"\",\"fact\":\"\",\"quote\":\"\",\"author\":\"\"," +
      "\"etymology\":\"\",\"pos\":\"\",\"syllables\":0}. " +
      "def: one crisp sentence. fact: one surprising, TRUE philosophical or scientific " +
      "fact connected to the word. quote: a short, REAL, correctly-attributed quote from " +
      "a great mind that resonates with the word — if you are not certain it is genuine, " +
      "set quote and author to empty strings. etymology: one short sentence on the word's " +
      "origin (empty string if unsure). pos: the primary part of speech (e.g. 'noun'). " +
      "syllables: integer syllable count. No markdown.",
```

- [ ] **Step 2: Persist the new fields in `writeIntel`**

In the `body` builder of `writeIntel`, after the `def`/`fact` lines and before the quote block, append the optional fields when present:

```js
    const lines = [`  ${k}: {`, `    def: "${esc(e.def)}",`, `    fact: "${esc(e.fact)}",`];
    if (e.etymology) lines.push(`    etymology: "${esc(e.etymology)}",`);
    if (e.pos) lines.push(`    pos: "${esc(e.pos)}",`);
    if (e.syllables) lines.push(`    syllables: ${Number(e.syllables) || 0},`);
    if (e.quote) { lines.push(`    quote: "${esc(e.quote)}",`); lines.push(`    author: "${esc(e.author)}",`); }
    lines.push("  },");
```

- [ ] **Step 3: Smoke-test on two words (no commit of data yet)**

Run: `node scripts/gen-word-intel.mjs OCEAN POWER` (needs `ANTHROPIC_API_KEY`; decrypt per the script header).
Expected: `public/data/word-intel.js` now has `etymology`/`pos`/`syllables` on those entries. Spot-check the file looks right and the module still parses: `node -e "import('./public/data/word-intel.js').then(m=>console.log(m.wordIntel('ocean')))"`.

- [ ] **Step 4: Commit the generator change**

```bash
git add scripts/gen-word-intel.mjs public/data/word-intel.js
git commit -m "feat(wiki): intel schema adds etymology, pos, syllables"
```

### Task 4: Fill the full corpus (operational)

**Files:**
- Modify: `public/data/word-intel.js` (generated)

- [ ] **Step 1: Generate everything still missing, in batches**

Run (with `ANTHROPIC_API_KEY` set): `node scripts/gen-word-intel.mjs --limit 300` repeatedly until no words remain. The script is merge-safe + resumable (skips covered words). Budget: ~2,309 words × one Opus call.

- [ ] **Step 2: Verify coverage**

Run: `node -e "import('./public/data/word-intel.js').then(m=>{let n=0;for(const w of Object.keys(m.WORD_INTEL))n++;console.log('intel entries:',n)})"`
Expected: ≈ 2,315 (every answer word covered; a few may legitimately lack a quote — that's fine).

- [ ] **Step 3: Spot-check quotes for fabrication**

Manually read ~15 random entries' `quote`/`author`. Any that look invented or misattributed: delete that entry's `quote`+`author` keys (the page renders fine without them).

- [ ] **Step 4: Commit the corpus**

```bash
git add public/data/word-intel.js
git commit -m "content(wiki): fill word-intel for all answer words"
```

---

## Phase 2 — Word graph (build-time, pure)

### Task 5: `word-graph.mjs` — related-word computation

**Files:**
- Create: `scripts/lib/word-graph.mjs`
- Test: `test/word-graph.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/word-graph.test.js
import { describe, it, expect } from "vitest";
import { buildWordGraph } from "../scripts/lib/word-graph.mjs";

const WORDS = ["OCEAN", "CANOE", "OCEAS", "OCEAR", "OCTAL", "OBEAN"];

describe("buildWordGraph", () => {
  const g = buildWordGraph(WORDS);
  it("finds anagrams (same letters, excluding self)", () => {
    expect(g.get("OCEAN").anagrams.sort()).toEqual(["CANOE"]);
  });
  it("finds ±1-letter ladder neighbors", () => {
    // OCEAS, OCEAR, OBEAN differ from OCEAN by exactly one letter; CANOE/OCTAL do not.
    expect(g.get("OCEAN").ladder.sort()).toEqual(["OBEAN", "OCEAR", "OCEAS"]);
  });
  it("finds shared-start words (same first 2 letters, excluding self)", () => {
    expect(g.get("OCEAN").sharedStart).toContain("OCEAS");
    expect(g.get("OCEAN").sharedStart).not.toContain("OCEAN");
    expect(g.get("OCEAN").sharedStart).not.toContain("CANOE");
  });
  it("caps each list", () => {
    for (const v of g.values()) {
      expect(v.anagrams.length).toBeLessThanOrEqual(12);
      expect(v.ladder.length).toBeLessThanOrEqual(12);
      expect(v.sharedStart.length).toBeLessThanOrEqual(12);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- word-graph` → Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `scripts/lib/word-graph.mjs`**

```js
// scripts/lib/word-graph.mjs — pure, build-time. Given the answer-word list, compute
// per-word related sets used to render internal links on each wiki page.
const CAP = 12;
const sortLetters = (w) => w.split("").sort().join("");

export function buildWordGraph(words) {
  const all = [...words];
  const set = new Set(all);
  // Anagram buckets keyed by sorted letters.
  const byLetters = new Map();
  for (const w of all) {
    const k = sortLetters(w);
    (byLetters.get(k) ?? byLetters.set(k, []).get(k)).push(w);
  }
  // Shared-start buckets keyed by first 2 letters.
  const byPrefix = new Map();
  for (const w of all) {
    const k = w.slice(0, 2);
    (byPrefix.get(k) ?? byPrefix.set(k, []).get(k)).push(w);
  }
  const graph = new Map();
  for (const w of all) {
    const anagrams = (byLetters.get(sortLetters(w)) ?? []).filter((x) => x !== w).slice(0, CAP);
    const ladder = [];
    for (let i = 0; i < w.length; i++) {
      for (let c = 65; c <= 90; c++) {
        const cand = w.slice(0, i) + String.fromCharCode(c) + w.slice(i + 1);
        if (cand !== w && set.has(cand)) ladder.push(cand);
      }
    }
    const sharedStart = (byPrefix.get(w.slice(0, 2)) ?? []).filter((x) => x !== w).slice(0, CAP);
    graph.set(w, { anagrams, ladder: ladder.slice(0, CAP), sharedStart });
  }
  return graph;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- word-graph` → Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/word-graph.mjs test/word-graph.test.js
git commit -m "feat(wiki): pure word-graph (anagrams, ladder, shared-start)"
```

---

## Phase 3 — Page + OG rendering (build-time, pure)

### Task 6: `words.mjs` — build-side word/exclusion/slug parsing

**Files:**
- Create: `scripts/lib/words.mjs`

- [ ] **Step 1: Implement (regex-parses the same TS sources the worker uses, so there is one source of truth)**

```js
// scripts/lib/words.mjs — build-side mirror of src/words.ts, reading the TS sources by
// regex (the same trick gen-word-intel.mjs already uses for the answer pools) so the
// generator and the worker never drift.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function answerWords() {
  const src = readFileSync(join(ROOT, "src/wordsbysize.ts"), "utf8");
  const out = new Set();
  for (const m of src.matchAll(/const A\d+\s*=\s*"([A-Z,]+)"/g))
    for (const w of m[1].split(",")) if (w.length === 5) out.add(w);
  return [...out];
}

export function exclusions() {
  const src = readFileSync(join(ROOT, "src/word-exclusions.ts"), "utf8");
  const block = src.slice(src.indexOf("["), src.indexOf("]") + 1);
  return new Set([...block.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1].toUpperCase()));
}

export const slugFor = (w) => w.toLowerCase();
```

- [ ] **Step 2: Sanity-check it parses (no test file; exercised by Task 9)**

Run: `node -e "import('./scripts/lib/words.mjs').then(m=>console.log(m.answerWords().length, [...m.exclusions()]))"`
Expected: `2315 []` (or your real exclusion count).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/words.mjs
git commit -m "feat(wiki): build-side word/exclusion parsing"
```

### Task 7: `word-page.mjs` — render one page's HTML

**Files:**
- Create: `scripts/lib/word-page.mjs`
- Test: `test/word-page.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/word-page.test.js
import { describe, it, expect } from "vitest";
import { renderWordPage } from "../scripts/lib/word-page.mjs";

const intel = {
  def: "A vast body of salt water.",
  fact: "Holds 97% of Earth's water.",
  quote: "We are tied to the ocean.",
  author: "John F. Kennedy",
  etymology: "From Greek Okeanos.",
  pos: "noun",
  syllables: 2,
};
const graph = { anagrams: ["CANOE"], ladder: ["OCEAS"], sharedStart: ["OCTAL"] };

describe("renderWordPage", () => {
  const html = renderWordPage("OCEAN", intel, graph, "https://wordul.com");
  it("is a full document with the word in title + h1", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("What does &quot;OCEAN&quot; mean?");
    expect(html).toMatch(/<h1[^>]*>OCEAN<\/h1>/);
  });
  it("includes definition, fact, quote, etymology", () => {
    expect(html).toContain("A vast body of salt water.");
    expect(html).toContain("Holds 97% of Earth's water.");
    expect(html).toContain("John F. Kennedy");
    expect(html).toContain("From Greek Okeanos.");
  });
  it("links related words to their pages", () => {
    expect(html).toContain('href="/word/canoe"');
    expect(html).toContain('href="/word/oceas"');
  });
  it("emits canonical, OG image, and JSON-LD", () => {
    expect(html).toContain('rel="canonical" href="https://wordul.com/word/ocean"');
    expect(html).toContain('content="https://wordul.com/word/og/ocean.png"');
    expect(html).toContain('"@type":"DefinedTerm"');
    expect(html).toContain('"@type":"FAQPage"');
  });
  it("omits the quote block entirely when no quote", () => {
    const noQuote = renderWordPage("CANOE", { def: "A boat.", fact: "Old." }, graph, "https://wordul.com");
    expect(noQuote).not.toContain("<blockquote");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- word-page` → Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `scripts/lib/word-page.mjs`**

```js
// scripts/lib/word-page.mjs — pure: render one answer word's full static wiki page.
// No I/O. Crawlers/AI get the complete content with no JS; word-page.js only hydrates
// the live-stats panel later.
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tiles = (word) =>
  `<div class="wp-tiles" aria-hidden="true">` +
  word.split("").map((c) => `<span class="wp-tile">${esc(c)}</span>`).join("") +
  `</div>`;

const links = (words) =>
  words.map((w) => `<a href="/word/${w.toLowerCase()}">${esc(w)}</a>`).join("");

export function renderWordPage(word, intel, graph, origin) {
  const W = word.toUpperCase();
  const slug = word.toLowerCase();
  const canonical = `${origin}/word/${slug}`;
  const ogImg = `${origin}/word/og/${slug}.png`;
  const i = intel || {};
  const g = graph || { anagrams: [], ladder: [], sharedStart: [] };
  const title = `What does "${W}" mean? — definition, facts & word game`;
  const desc = (i.def || `Definition, facts and word play for ${W}.`).slice(0, 155);

  const faq = [
    { q: `Is ${W} a valid word?`, a: `Yes — ${W} is one of the answer words in Wordul, the daily word game.` },
    { q: `How many letters is ${W}?`, a: `${W} has ${W.length} letters and ${i.syllables ? `${i.syllables} syllable${i.syllables === 1 ? "" : "s"}` : "is a common English word"}.` },
    { q: `What part of speech is ${W}?`, a: i.pos ? `${W} is a ${i.pos}.` : `${W} appears in everyday English.` },
  ];

  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "DefinedTerm", name: W, description: i.def || "", inDefinedTermSet: `${origin}/words` },
      { "@type": "WebPage", name: title, url: canonical, primaryImageOfPage: { "@type": "ImageObject", url: ogImg } },
      { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };

  const quoteBlock = i.quote
    ? `<blockquote class="wp-quote">“${esc(i.quote)}”${i.author ? `<cite>— ${esc(i.author)}</cite>` : ""}</blockquote>`
    : "";
  const etymBlock = i.etymology ? `<section class="wp-etym"><h2>Word origin</h2><p>${esc(i.etymology)}</p></section>` : "";
  const relBlock = (label, words) =>
    words && words.length ? `<div class="wp-rel"><h3>${esc(label)}</h3><p>${links(words)}</p></div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImg)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/word-page.css">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body class="wp">
<header class="wp-head"><a class="wp-home" href="/">Wordul</a> · <a href="/words">all words</a></header>
<main class="wp-main" data-word="${esc(W)}">
  <article>
    ${tiles(W)}
    <p class="wp-meta">${i.pos ? esc(i.pos) : ""}${i.syllables ? ` · ${i.syllables} syllable${i.syllables === 1 ? "" : "s"}` : ""}</p>
    <h1>${esc(W)}</h1>
    <section class="wp-def"><h2>What does &quot;${esc(W)}&quot; mean?</h2><p>${esc(i.def || "")}</p></section>
    ${i.fact ? `<section class="wp-fact"><h2>Did you know?</h2><p>${esc(i.fact)}</p></section>` : ""}
    ${quoteBlock}
    ${etymBlock}
    <section class="wp-faq"><h2>Quick facts</h2>${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>
    <section class="wp-related"><h2>Related words</h2>
      ${relBlock("Anagrams", g.anagrams)}
      ${relBlock("Change one letter", g.ladder)}
      ${relBlock("Same start", g.sharedStart)}
    </section>
    <section class="wp-stats" data-word="${esc(W)}"><h2>How players do</h2><p class="wp-stats-body">Be the first to solve it.</p></section>
    <p class="wp-cta"><a class="wp-play" href="/">Play today's Wordul →</a></p>
  </article>
</main>
<script src="/word-page.js" defer></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- word-page` → Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/word-page.mjs test/word-page.test.js
git commit -m "feat(wiki): pure word-page HTML renderer"
```

### Task 8: `og-card.mjs` — SVG card for a word

**Files:**
- Create: `scripts/lib/og-card.mjs`

- [ ] **Step 1: Implement (pure SVG string; rasterized in Task 9)**

```js
// scripts/lib/og-card.mjs — pure: a 1200×630 branded OG card SVG for one word.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ogCardSvg(word, def) {
  const W = word.toUpperCase();
  const tileW = 150, gap = 16, total = W.length * tileW + (W.length - 1) * gap;
  const startX = (1200 - total) / 2;
  const tiles = W.split("").map((c, idx) => {
    const x = startX + idx * (tileW + gap);
    return `<g><rect x="${x}" y="170" width="${tileW}" height="${tileW}" rx="12" fill="#6aaa64"/>` +
      `<text x="${x + tileW / 2}" y="170 + ${tileW / 2}" dy="${tileW / 2 + 28}" text-anchor="middle" ` +
      `font-family="Arial, sans-serif" font-size="84" font-weight="800" fill="#fff">${esc(c)}</text></g>`;
  }).join("");
  const tagline = esc((def || "").slice(0, 90));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#121213"/>
  ${tiles}
  <text x="600" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#d7dadc">${tagline}</text>
  <text x="600" y="560" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#6aaa64">wordul.com</text>
</svg>`;
}
```

Note: the `dy` expression above must be a real number — replace `170 + ${tileW/2}`/`dy` with a computed `y`. Use this corrected tile line:

```js
    return `<g><rect x="${x}" y="170" width="${tileW}" height="${tileW}" rx="12" fill="#6aaa64"/>` +
      `<text x="${x + tileW / 2}" y="${170 + tileW / 2 + 28}" text-anchor="middle" ` +
      `font-family="Arial, sans-serif" font-size="84" font-weight="800" fill="#fff">${esc(c)}</text></g>`;
```

- [ ] **Step 2: Sanity-check the SVG is well-formed**

Run: `node -e "import('./scripts/lib/og-card.mjs').then(m=>{const s=m.ogCardSvg('OCEAN','A vast body of salt water.');if(!s.includes('<svg')||s.includes('${'))throw new Error('bad svg');console.log('ok',s.length)})"`
Expected: `ok <number>` with no thrown error.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/og-card.mjs
git commit -m "feat(wiki): OG card SVG generator"
```

---

## Phase 4 — Generator + OG upload

### Task 9: `gen-word-pages.mjs` — write all pages + the index + OG PNGs

**Files:**
- Create: `scripts/gen-word-pages.mjs`
- Creates at runtime: `public/word/<slug>.html` (committed), `public/words.html` (committed), `dist/og/<slug>.png` (gitignored)
- Modify: `.gitignore` (add `dist/`)

- [ ] **Step 1: Add `dist/` to `.gitignore`**

Append a line `dist/` to `.gitignore`.

- [ ] **Step 2: Implement `scripts/gen-word-pages.mjs`**

```js
#!/usr/bin/env node
// scripts/gen-word-pages.mjs — build the word wiki.
//   public/word/<slug>.html   per answer word (committed; full content)
//   public/words.html         A–Z index (committed)
//   dist/og/<slug>.png        OG card per word (gitignored; uploaded by upload-og.mjs)
// Idempotent. Skips excluded words (no public page).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { answerWords, exclusions, slugFor } from "./lib/words.mjs";
import { buildWordGraph } from "./lib/word-graph.mjs";
import { renderWordPage } from "./lib/word-page.mjs";
import { ogCardSvg } from "./lib/og-card.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.WIKI_ORIGIN || "https://wordul.com";

const { WORD_INTEL } = await import(join(ROOT, "public/data/word-intel.js"));
const words = answerWords();
const excluded = exclusions();
const graph = buildWordGraph(words);

const wordDir = join(ROOT, "public/word");
const ogDir = join(ROOT, "dist/og");
mkdirSync(wordDir, { recursive: true });
rmSync(ogDir, { recursive: true, force: true });
mkdirSync(ogDir, { recursive: true });

let pages = 0;
const indexed = [];
for (const W of words) {
  if (excluded.has(W)) continue;
  const slug = slugFor(W);
  const intel = WORD_INTEL[W] || {};
  writeFileSync(join(wordDir, `${slug}.html`), renderWordPage(W, intel, graph.get(W), ORIGIN));
  const svg = ogCardSvg(W, intel.def || "");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  writeFileSync(join(ogDir, `${slug}.png`), png);
  indexed.push(W);
  pages++;
}

// A–Z index page.
const grouped = {};
for (const W of indexed.sort()) (grouped[W[0]] ??= []).push(W);
const indexBody = Object.keys(grouped).sort().map((letter) =>
  `<section><h2>${letter}</h2><p>${grouped[letter].map((W) => `<a href="/word/${slugFor(W)}">${W}</a>`).join(" ")}</p></section>`
).join("\n");
writeFileSync(join(ROOT, "public/words.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Every Wordul word — the word wiki</title>
<meta name="description" content="Browse every answer word in Wordul, with definitions, facts and word play.">
<link rel="canonical" href="${ORIGIN}/words"><link rel="stylesheet" href="/word-page.css"></head>
<body class="wp"><header class="wp-head"><a class="wp-home" href="/">Wordul</a></header>
<main class="wp-main"><h1>The Wordul word wiki</h1><p>${indexed.length} words.</p>${indexBody}</main></body></html>`);

console.log(`wrote ${pages} word pages + index + ${pages} OG cards`);
```

- [ ] **Step 3: Run the generator**

Run: `npm run wiki:pages`
Expected: `wrote 2315 word pages + index + 2315 OG cards` (minus exclusions). Confirm: `ls public/word | head` shows `ocean.html` etc., and `ls dist/og | wc -l` matches.

- [ ] **Step 4: Spot-check one page renders sensibly**

Run: `node -e "console.log(require('fs').readFileSync('public/word/ocean.html','utf8').slice(0,400))"`
Expected: the doctype + title with OCEAN.

- [ ] **Step 5: Commit the generated pages (HTML only — dist/ is ignored)**

```bash
git add scripts/gen-word-pages.mjs .gitignore public/word public/words.html
git commit -m "feat(wiki): generate per-word pages + A–Z index"
```

### Task 10: `upload-og.mjs` — push OG PNGs to R2

**Files:**
- Create: `scripts/upload-og.mjs`

- [ ] **Step 1: Implement (S3-compatible API against the R2 endpoint)**

```js
#!/usr/bin/env node
// scripts/upload-og.mjs — upload dist/og/*.png to the wordul-og R2 bucket via the
// S3-compatible API. Needs R2 creds (account-scoped, from the vault):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ogDir = join(ROOT, "dist/og");
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (decrypt from the vault).");
  process.exit(1);
}
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const files = readdirSync(ogDir).filter((f) => f.endsWith(".png"));
const CONCURRENCY = 16;
let done = 0;
async function worker(queue) {
  while (queue.length) {
    const f = queue.pop();
    await s3.send(new PutObjectCommand({
      Bucket: "wordul-og", Key: f, Body: readFileSync(join(ogDir, f)), ContentType: "image/png",
    }));
    if (++done % 200 === 0) console.log(`${done}/${files.length}`);
  }
}
const q = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(q)));
console.log(`uploaded ${done} OG cards to wordul-og`);
```

- [ ] **Step 2: Run the upload**

Run (with R2 creds exported): `npm run wiki:og`
Expected: `uploaded <N> OG cards to wordul-og`.

- [ ] **Step 3: Commit**

```bash
git add scripts/upload-og.mjs
git commit -m "feat(wiki): upload OG cards to R2"
```

---

## Phase 5 — Worker serving

### Task 11: Serve `/word/og/*` from R2

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Add the OG route**

In `fetch`, before the profile/room block (after the `/designs/` block), add:

```ts
    // OG cards for word pages live in the wordul-og R2 bucket (built + uploaded offline).
    if (url.pathname.startsWith("/word/og/")) {
      const key = url.pathname.slice("/word/og/".length);
      const obj = await env.OG.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat(wiki): serve OG cards from R2"
```

### Task 12: Serve `/word/<slug>`, `/word/today`, `/words` + canonicalize

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Import the helpers at the top of `src/worker.ts`**

```ts
import { isWordPage, slugFor, wordOfTheDay } from "./words.ts";
```

- [ ] **Step 2: Add routes after the `/word/og/` block**

```ts
    // Word wiki: /word/today → today's featured word; /word/<slug> → the static page.
    if (url.pathname === "/word/today") {
      const slug = slugFor(wordOfTheDay(new Date()));
      return Response.redirect(`${url.origin}/word/${slug}`, 302);
    }
    if (url.pathname.startsWith("/word/")) {
      const raw = url.pathname.slice("/word/".length).replace(/\/$/, "");
      const lower = raw.toLowerCase();
      if (raw !== lower) return Response.redirect(`${url.origin}/word/${lower}`, 301);
      if (isWordPage(lower)) {
        return env.ASSETS.fetch(new Request(`${url.origin}/word/${lower}.html`));
      }
      // Non-answer or excluded word: a friendly dead-endless 404.
      return new Response(
        `<!doctype html><meta charset=utf-8><title>No word page</title>` +
        `<p>No wiki page for that word. <a href="/words">Browse all words</a> or <a href="/">play Wordul</a>.</p>`,
        { status: 404, headers: { "content-type": "text/html" } },
      );
    }
    if (url.pathname === "/words") {
      return env.ASSETS.fetch(new Request(`${url.origin}/words.html`));
    }
```

- [ ] **Step 3: Manual verify via dev server**

Run: `npm run dev` then in another shell `curl -sI http://localhost:8787/word/OCEAN` (expect `301` → `/word/ocean`), `curl -s http://localhost:8787/word/ocean | grep -o "<title>[^<]*"` (expect the OCEAN title), `curl -sI http://localhost:8787/word/today` (expect `302`), `curl -sI http://localhost:8787/word/zzzzz` (expect `404`).

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat(wiki): serve word pages, today redirect, words index"
```

### Task 13: Add word pages to the sitemap

**Files:**
- Modify: `src/worker.ts` (the `sitemap()` function)

- [ ] **Step 1: Import the answer set (extend the existing import)**

Ensure `ANSWER_WORDS` is imported:

```ts
import { isWordPage, slugFor, wordOfTheDay, ANSWER_WORDS } from "./words.ts";
```

- [ ] **Step 2: Append word URLs in `sitemap()`**

After the `do/while` KV loop and before building `body`, add:

```ts
  urls.push(origin + "/words");
  for (const w of ANSWER_WORDS) {
    if (isWordPage(w)) urls.push(`${origin}/word/${slugFor(w)}`);
  }
```

- [ ] **Step 3: Verify**

Run: `npm run dev` then `curl -s http://localhost:8787/sitemap.xml | grep -c "/word/"`
Expected: ≈ 2,315.

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat(wiki): add word pages to sitemap"
```

---

## Phase 6 — Client + styles + SEO polish

### Task 14: Word-page styles + hydration stub

**Files:**
- Create: `public/word-page.css`
- Create: `public/word-page.js`

- [ ] **Step 1: Create `public/word-page.css`**

Minimal, on-brand (Wordle greens, dark bg). Keep it self-contained:

```css
/* public/word-page.css — standalone styles for the word wiki pages. */
:root { --bg:#121213; --fg:#d7dadc; --green:#6aaa64; --muted:#818384; }
.wp { margin:0; background:var(--bg); color:var(--fg); font-family:system-ui,Arial,sans-serif; line-height:1.5; }
.wp-head { padding:16px 20px; border-bottom:1px solid #2a2a2c; }
.wp-head a { color:var(--fg); text-decoration:none; }
.wp-main { max-width:720px; margin:0 auto; padding:24px 20px 64px; }
.wp-tiles { display:flex; gap:8px; justify-content:center; margin:8px 0 4px; }
.wp-tile { width:48px; height:48px; display:grid; place-items:center; background:var(--green); color:#fff; font-weight:800; font-size:28px; border-radius:6px; }
.wp-meta { text-align:center; color:var(--muted); margin:0 0 8px; }
.wp h1 { text-align:center; letter-spacing:4px; margin:4px 0 24px; }
.wp h2 { font-size:18px; margin:28px 0 6px; }
.wp-quote { border-left:3px solid var(--green); margin:20px 0; padding:4px 0 4px 16px; color:var(--fg); }
.wp-quote cite { display:block; color:var(--muted); margin-top:6px; font-style:normal; }
.wp-rel h3 { font-size:14px; color:var(--muted); margin:14px 0 4px; }
.wp-rel a, .wp-main section a { color:var(--green); text-decoration:none; margin-right:10px; }
.wp-faq details { border-top:1px solid #2a2a2c; padding:8px 0; }
.wp-faq summary { cursor:pointer; }
.wp-cta { text-align:center; margin-top:40px; }
.wp-play { display:inline-block; background:var(--green); color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; }
```

- [ ] **Step 2: Create `public/word-page.js` (hydration stub for this plan)**

```js
// public/word-page.js — hydrates the live stats panel on a word page. In this plan it
// is a no-op placeholder; the stats plan (2026-06-04-word-wiki-stats.md) fills it in.
// Kept as a file now so the generated pages already reference it and the stats plan is
// a pure swap with no regeneration needed.
(function () {
  const panel = document.querySelector(".wp-stats");
  if (!panel) return;
  // Stats hydration arrives with the word-wiki-stats plan.
})();
```

- [ ] **Step 3: Verify the page loads styled**

Run: `npm run dev`, open `http://localhost:8787/word/ocean` in a browser (or `/browse` tool). Expect tiles, definition, related-word links, the "Be the first to solve it." panel.

- [ ] **Step 4: Commit**

```bash
git add public/word-page.css public/word-page.js
git commit -m "feat(wiki): word-page styles + hydration stub"
```

### Task 15: Flip the end-card link inward

**Files:**
- Modify: `public/app.js` (around line 2185)

- [ ] **Step 1: Point "look it up" at the word page**

Replace the link's `href` assignment (currently `https://www.google.com/search?q=...`):

```js
  look.href = `/word/${w}`;
  look.removeAttribute("target");
  look.removeAttribute("rel");
```

Remove the now-unused `look.target`/`look.rel` lines that set them to `_blank`/`noopener` (the word page is same-origin, so it should open in place). Keep `look.textContent = t("endscreen.lookup");`.

- [ ] **Step 2: Verify behavior**

Run a game to the end (or `/browse` to the end screen). The "look it up" link should now navigate to `/word/<word>` on the same site, not Google.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(wiki): end-card reveal links to the word page, not Google"
```

### Task 16: Advertise the wiki in `llms.txt`

**Files:**
- Modify: `public/llms.txt`, `public/llms-full.txt`

- [ ] **Step 1: Add a wiki section**

Append to both files a short section, e.g.:

```
## Word wiki
Every Wordul answer word has a permanent page: https://wordul.com/word/<word> (e.g. /word/ocean).
Browse them all at https://wordul.com/words. Each page has a definition, a surprising fact, a
quote, word origin, related words, and live solve stats.
```

- [ ] **Step 2: Commit**

```bash
git add public/llms.txt public/llms-full.txt
git commit -m "docs(wiki): advertise the word wiki in llms.txt"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** URLs (T12), page anatomy (T7), link graph (T5), OG card build+host (T8/T9/T10/T11), static pre-render (T9), `/words` + `/word/today` (T9/T12), sitemap (T13), JSON-LD/OG/meta (T7), `llms.txt` (T16), end-card flip (T15), exclusion blocklist (T1/T6/T12), never-played state (baked into T7, hydrated by the stats plan), case canonicalization (T12). Live stats panel is intentionally deferred to the companion stats plan (panel exists with placeholder here).
- **Placeholder scan:** the `WORD_EXCLUSIONS` list ships empty by design (filled by a profanity pass in T1/T4 step 3); not a code placeholder. OG `dy` math bug is explicitly corrected in T8.
- **Type/name consistency:** `isWordPage`/`slugFor`/`wordFromSlug`/`wordOfTheDay`/`ANSWER_WORDS` used identically across `src/words.ts`, `src/worker.ts`; build-side `answerWords`/`exclusions`/`slugFor` consistent across `scripts/lib/words.mjs` and `gen-word-pages.mjs`; `renderWordPage`/`buildWordGraph`/`ogCardSvg` signatures match their call sites; the `.wp-stats` panel selector matches what the stats plan hydrates.

---

## Risks / notes for the executor

- **Corpus cost/time (T4):** ~2,309 Opus calls. Batch with `--limit`; resumable. Do this before generating pages (the generator reads whatever intel exists and degrades gracefully for any gaps).
- **`@resvg/resvg-js`** is a native module — ensure it installs on the build machine. If it can't, fall back to committing the `dist/og` SVGs and serving SVG (weaker social previews) as a stopgap.
- **R2 creds (T10)** are account-scoped; decrypt from the vault, never commit. The bucket must be public-readable via the worker route only (no public bucket URL needed — the worker proxies it).
- **2,315 committed HTML files (T9)** is intentional (diffable, deploys via `public/`). Regenerate + recommit whenever the template or corpus changes.
