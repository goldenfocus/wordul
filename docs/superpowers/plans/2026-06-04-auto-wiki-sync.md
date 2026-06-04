# Auto Wiki Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the word wiki a self-healing pure function of the word set — an idempotent `wiki:sync` primitive plus a daily routine that fills only missing words through the same adversarial pipeline, so every game word always has a verified page with no manual run.

**Architecture:** A pure `coverage.mjs` (`targetWords`/`missingWords`) + a canonical `intel-merge.mjs` (verified staging ∪ committed corpus → slim game file + rich build file) drive `wiki-sync.mjs` (`--check` lists gaps, `--build` merges→renders→uploads, idempotent). A daily `/schedule` routine runs check → verified-generation (Workflow) for any gaps → build → commit → gauntlet deploy. `/push` gets a non-blocking gap warning.

**Tech Stack:** Node ESM (`.mjs`) build scripts, vitest (node env) for pure logic, the existing `wiki:pages`/`wiki:og` render+upload scripts, Cloudflare Workers deploy via the gauntlet.

**Spec:** `docs/superpowers/specs/2026-06-04-auto-wiki-sync-design.md`

**Prerequisite / ordering:** Execute **after the Phase-1 legendary-English wiki is live** (`data/word-intel-rich.js` populated, `public/word/*.html` generated). Tasks 1–2 are dependency-free and can land anytime; Tasks 3–5 want the committed corpus present to be meaningful. First real `--build` after Phase 1 will reformat `data/word-intel-rich.js` + `public/data/word-intel.js` into this plan's canonical serializer (a one-time normalizing diff — expected).

---

## File Structure

**Build-time (Node ESM, under `scripts/`):**
- `scripts/lib/coverage.mjs` — pure: `targetWords()` (answers − exclusions) + `missingWords(corpusKeys, target)`. (NEW)
- `scripts/lib/intel-merge.mjs` — canonical merge: read verified staging, overlay onto the committed corpus, write the slim game file + the rich build file (sorted, stable field order, idempotent bytes). (NEW)
- `scripts/wiki-sync.mjs` — orchestrator: `--check` (list gaps, exit 1 if any) / `--build` (merge → `wiki:pages` → `wiki:og` if creds). (NEW)

**Config:**
- `package.json` — add the `wiki:sync` script. (MODIFY)

**Skill / ops:**
- The `/push` skill (likely `.claude/skills/push/SKILL.md`) — add a non-blocking gap warning. (MODIFY)
- `docs/routines/wiki-sync-routine.md` — the daily routine's exact prompt + cadence, then register via `/schedule`. (NEW + ops)

**Tests (under `test/`):**
- `test/coverage.test.js`, `test/intel-merge.test.js`. (NEW)

---

## Task 1: `coverage.mjs` — target + missing words (pure)

**Files:**
- Create: `scripts/lib/coverage.mjs`
- Test: `test/coverage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/coverage.test.js
import { describe, it, expect } from "vitest";
import { targetWords, missingWords } from "../scripts/lib/coverage.mjs";

describe("coverage", () => {
  it("targetWords is the 5-letter answer set, uppercase, sans exclusions", () => {
    const t = targetWords();
    expect(Array.isArray(t)).toBe(true);
    expect(t.length).toBeGreaterThan(2000);
    expect(t).toContain("OCEAN");
    expect(t.every((w) => w === w.toUpperCase() && w.length === 5)).toBe(true);
  });
  it("missingWords returns target words absent from the corpus (array corpus)", () => {
    expect(missingWords(["OCEAN", "POWER"], ["OCEAN", "POWER", "DREAM"])).toEqual(["DREAM"]);
  });
  it("missingWords accepts a Set corpus and is empty when fully covered", () => {
    expect(missingWords(new Set(["OCEAN", "POWER", "DREAM"]), ["OCEAN", "POWER", "DREAM"])).toEqual([]);
  });
  it("missingWords compares case-insensitively", () => {
    expect(missingWords(["ocean"], ["OCEAN"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /Users/theoutsider/wordul-wiki && npm test -- coverage`
Expected: FAIL ("Cannot find module ../scripts/lib/coverage.mjs").

- [ ] **Step 3: Implement `scripts/lib/coverage.mjs`**

```js
// scripts/lib/coverage.mjs — pure: which answer words should have a wiki page, and which
// are missing from a given corpus. No I/O. The wiki is a pure function of this target set.
import { answerWords, exclusions } from "./words.mjs";

/** Words that SHOULD have a public wiki page: 5-letter answer words minus exclusions, UPPERCASE. */
export function targetWords() {
  const ex = new Set([...exclusions()].map((w) => String(w).toUpperCase()));
  return answerWords()
    .map((w) => String(w).toUpperCase())
    .filter((w) => w.length === 5 && !ex.has(w));
}

/** Target words not present in `corpusKeys`. Both sides compared UPPERCASE. `corpusKeys` may be a Set or array. */
export function missingWords(corpusKeys, target) {
  const have = new Set([...(corpusKeys ?? [])].map((w) => String(w).toUpperCase()));
  return [...target].map((w) => String(w).toUpperCase()).filter((w) => !have.has(w));
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd /Users/theoutsider/wordul-wiki && npm test -- coverage`
Expected: PASS (4 tests). If `targetWords().length` surprises you, print it — it should equal `answerWords()` count minus the exclusion count.

- [ ] **Step 5: Commit**

```bash
cd /Users/theoutsider/wordul-wiki
git add scripts/lib/coverage.mjs test/coverage.test.js
git commit -m "feat(wiki): coverage helpers — target + missing words"
```

---

## Task 2: `intel-merge.mjs` — canonical corpus serializer (pure-ish)

**Files:**
- Create: `scripts/lib/intel-merge.mjs`
- Test: `test/intel-merge.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/intel-merge.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readVerifiedCards, writeSlim, writeRich, mergeStagingToCorpus } from "../scripts/lib/intel-merge.mjs";

let dir, staging, rich, slim;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intel-"));
  staging = join(dir, "staging");
  mkdirSync(staging, { recursive: true });
  rich = join(dir, "rich.js");
  slim = join(dir, "slim.js");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const card = (w, extra = {}) => ({
  word: w, def: `${w} def`, facts: [`${w} fact`], quote: `${w} quote`, author: "Someone",
  poem: { form: "haiku", lines: ["a", "b", "c"] }, schemaVersion: 2, ...extra,
});

describe("intel-merge", () => {
  it("readVerifiedCards reads *.verified.json into an UPPERCASE map, skips junk", () => {
    writeFileSync(join(staging, "ocean.verified.json"), JSON.stringify(card("OCEAN")));
    writeFileSync(join(staging, "power.json"), JSON.stringify(card("POWER"))); // not .verified
    writeFileSync(join(staging, "bad.verified.json"), "{not json");
    const map = readVerifiedCards(staging);
    expect(Object.keys(map)).toEqual(["OCEAN"]);
  });

  it("writeSlim emits only {def,fact,quote,author} + the wordIntel() footer", async () => {
    writeSlim(slim, { OCEAN: card("OCEAN") });
    const src = readFileSync(slim, "utf8");
    expect(src).toContain("export const WORD_INTEL =");
    expect(src).toContain("export function wordIntel(");
    const mod = await import(pathToFileURL(slim).href);
    expect(mod.WORD_INTEL.OCEAN).toEqual({ def: "OCEAN def", fact: "OCEAN fact", quote: "OCEAN quote", author: "Someone" });
    expect(mod.WORD_INTEL.OCEAN.poem).toBeUndefined(); // rich field NOT in the slim game file
  });

  it("writeRich keeps the full rich card", async () => {
    writeRich(rich, { OCEAN: card("OCEAN") });
    const mod = await import(pathToFileURL(rich).href);
    expect(mod.WORD_INTEL.OCEAN.poem.form).toBe("haiku");
  });

  it("mergeStagingToCorpus overlays staging onto an existing corpus and is byte-idempotent", async () => {
    // seed an existing rich corpus with OCEAN
    writeRich(rich, { OCEAN: card("OCEAN", { def: "old ocean" }) });
    // stage a NEW word + an update to OCEAN
    writeFileSync(join(staging, "dream.verified.json"), JSON.stringify(card("DREAM")));
    writeFileSync(join(staging, "ocean.verified.json"), JSON.stringify(card("OCEAN", { def: "new ocean" })));
    const r1 = await mergeStagingToCorpus({ stagingDir: staging, richPath: rich, slimPath: slim });
    expect(r1.merged).toBe(2);
    expect(r1.keys.sort()).toEqual(["DREAM", "OCEAN"]);
    const richBytes1 = readFileSync(rich, "utf8");
    expect(richBytes1).toContain("new ocean"); // staging won
    // run again with the SAME staging → identical bytes (idempotent)
    const r2 = await mergeStagingToCorpus({ stagingDir: staging, richPath: rich, slimPath: slim });
    expect(readFileSync(rich, "utf8")).toBe(richBytes1);
    expect(r2.merged).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /Users/theoutsider/wordul-wiki && npm test -- intel-merge`
Expected: FAIL ("Cannot find module ../scripts/lib/intel-merge.mjs").

- [ ] **Step 3: Implement `scripts/lib/intel-merge.mjs`**

```js
// scripts/lib/intel-merge.mjs — the ONE canonical way to serialize the word corpus.
// Reads verified staged cards, overlays them onto the committed rich corpus, and writes:
//   data/word-intel-rich.js   (build-only; full schema-v2 cards; read by gen-word-pages.mjs)
//   public/data/word-intel.js (slim; {def,fact,quote,author}; imported by the game at app.js)
// Sorted keys + stable field order => deterministic, byte-idempotent output.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const FIELD_ORDER = [
  "word", "pos", "syllables", "letters", "ipa", "difficulty", "tags", "schemaVersion",
  "def", "senses", "etymology", "factsMeta", "facts", "quoteRef", "quote", "author",
  "mnemonic", "poem", "jokes", "lesson", "verified", "generatedAt",
];

const HEADER_RICH =
  "// data/word-intel-rich.js — BUILD-ONLY rich word corpus (schema v2).\n" +
  "// Read only by scripts/gen-word-pages.mjs; NOT imported by the game client.\n" +
  "// Generated by the wiki pipeline (scripts/lib/intel-merge.mjs); do not hand-edit.\n";

const HEADER_SLIM =
  "// public/data/word-intel.js — SLIM corpus the game imports (public/app.js).\n" +
  "// Per word: { def, fact, quote, author }. The rich page corpus lives in data/word-intel-rich.js.\n" +
  "// Generated by scripts/lib/intel-merge.mjs; do not hand-edit.\n";

const WORDINTEL_FOOTER =
  'export function wordIntel(word) {\n' +
  '  return WORD_INTEL[String(word || "").toUpperCase()] || null;\n' +
  '}\n';

function orderCard(card) {
  const out = {};
  for (const k of FIELD_ORDER) if (card[k] !== undefined) out[k] = card[k];
  for (const k of Object.keys(card)) if (!(k in out)) out[k] = card[k];
  return out;
}

function slimCard(card) {
  const out = { def: card.def };
  const fact = (Array.isArray(card.facts) && card.facts[0]) || card.fact;
  if (fact) out.fact = fact;
  if (card.quote) out.quote = card.quote;
  if (card.author) out.author = card.author;
  return out;
}

function sortedMap(cards, shape) {
  const out = {};
  for (const k of Object.keys(cards).sort()) out[k] = shape(cards[k]);
  return out;
}

/** Read all *.verified.json in a staging dir into { WORD: card } (UPPERCASE keys). Skips non-verified + unparseable. */
export function readVerifiedCards(stagingDir) {
  const map = {};
  if (!existsSync(stagingDir)) return map;
  for (const f of readdirSync(stagingDir)) {
    if (!f.endsWith(".verified.json")) continue;
    const slug = f.slice(0, -".verified.json".length);
    try {
      const card = JSON.parse(readFileSync(`${stagingDir}/${f}`, "utf8"));
      if (card && card.def) map[slug.toUpperCase()] = card;
    } catch { /* skip unparseable */ }
  }
  return map;
}

export function writeRich(richPath, cards) {
  mkdirSync(dirname(richPath), { recursive: true });
  const map = sortedMap(cards, orderCard);
  writeFileSync(richPath, `${HEADER_RICH}export const WORD_INTEL = ${JSON.stringify(map, null, 2)};\n`);
  return Object.keys(map).length;
}

export function writeSlim(slimPath, cards) {
  mkdirSync(dirname(slimPath), { recursive: true });
  const map = sortedMap(cards, slimCard);
  writeFileSync(slimPath, `${HEADER_SLIM}export const WORD_INTEL = ${JSON.stringify(map, null, 2)};\n\n${WORDINTEL_FOOTER}`);
  return Object.keys(map).length;
}

/** Overlay verified staging onto the committed rich corpus, then write both files. Returns { merged, added, keys }. */
export async function mergeStagingToCorpus({ stagingDir, richPath, slimPath }) {
  const existing = existsSync(richPath) ? { ...(await import(pathToFileURL(richPath).href)).WORD_INTEL } : {};
  const staged = readVerifiedCards(stagingDir);
  const cards = { ...existing, ...staged }; // staged overlays existing
  writeRich(richPath, cards);
  writeSlim(slimPath, cards);
  return { merged: Object.keys(cards).length, added: Object.keys(staged).length, keys: Object.keys(cards) };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd /Users/theoutsider/wordul-wiki && npm test -- intel-merge`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/theoutsider/wordul-wiki
git add scripts/lib/intel-merge.mjs test/intel-merge.test.js
git commit -m "feat(wiki): canonical intel-merge serializer (slim + rich, idempotent)"
```

---

## Task 3: `wiki-sync.mjs` — check + build orchestrator

**Files:**
- Create: `scripts/wiki-sync.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Implement `scripts/wiki-sync.mjs`**

```js
#!/usr/bin/env node
// scripts/wiki-sync.mjs — keep the word wiki a pure function of the word set.
//   --check : list answer words with no rich-corpus entry. Exit 1 if any (so /push + CI can branch). No writes.
//   --build : merge verified staging into the corpus, render pages (+ OG if R2 creds). Idempotent.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { targetWords, missingWords } from "./lib/coverage.mjs";
import { mergeStagingToCorpus } from "./lib/intel-merge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RICH = join(ROOT, "data/word-intel-rich.js");
const SLIM = join(ROOT, "public/data/word-intel.js");
const STAGING = join(ROOT, ".intel-staging/en");

async function corpusKeys() {
  if (!existsSync(RICH)) return new Set();
  return new Set(Object.keys((await import(pathToFileURL(RICH).href)).WORD_INTEL || {}));
}

async function check() {
  const target = targetWords();
  const missing = missingWords(await corpusKeys(), target);
  console.log(JSON.stringify({ target: target.length, missing: missing.length, words: missing.slice(0, 50) }));
  if (missing.length) {
    console.error(`wiki:sync — ${missing.length} word(s) missing a rich card.`);
    process.exit(1);
  }
  console.log("wiki:sync — corpus complete.");
}

async function build() {
  const res = await mergeStagingToCorpus({ stagingDir: STAGING, richPath: RICH, slimPath: SLIM });
  console.log(`wiki:sync — merged ${res.merged} cards (${res.added} from staging)`);
  execFileSync("npm", ["run", "wiki:pages"], { cwd: ROOT, stdio: "inherit" });
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    execFileSync("npm", ["run", "wiki:og"], { cwd: ROOT, stdio: "inherit" });
  } else {
    console.log("wiki:sync — R2 creds absent; skipped OG upload (pages still built).");
  }
  const missing = missingWords(new Set(res.keys), targetWords());
  if (missing.length) console.error(`wiki:sync — still missing ${missing.length} word(s) after build: ${missing.slice(0, 20).join(", ")}`);
  else console.log("wiki:sync — build complete, corpus covers the full target set.");
}

const mode = process.argv[2];
if (mode === "--check") await check();
else if (mode === "--build") await build();
else { console.error("usage: node scripts/wiki-sync.mjs --check | --build"); process.exit(2); }
```

- [ ] **Step 2: Add the `wiki:sync` script to `package.json`**

In `scripts`, after `wiki:og`, add:

```json
"wiki:sync": "node scripts/wiki-sync.mjs"
```

- [ ] **Step 3: Smoke-test `--check` (corpus present → exit 0)**

Run (after Phase-1 corpus exists): `cd /Users/theoutsider/wordul-wiki && node scripts/wiki-sync.mjs --check; echo "exit=$?"`
Expected: prints `{"target":2315,"missing":0,...}` then `corpus complete.` and `exit=0`.

- [ ] **Step 4: Smoke-test `--check` detects a gap (negative test, no mutation)**

Run: temporarily test the logic without editing the corpus —
`cd /Users/theoutsider/wordul-wiki && node -e "import('./scripts/lib/coverage.mjs').then(async m=>{const c=new Set(Object.keys((await import('./data/word-intel-rich.js')).WORD_INTEL));c.delete('OCEAN');console.log(m.missingWords(c,m.targetWords()))})"`
Expected: `[ 'OCEAN' ]` — confirms a removed word is reported missing.

- [ ] **Step 5: Smoke-test `--build` idempotency**

Run: `cd /Users/theoutsider/wordul-wiki && git stash -u >/dev/null 2>&1; node scripts/wiki-sync.mjs --build && git status --short data/word-intel-rich.js public/data/word-intel.js`
Expected: after the FIRST post-Phase-1 build the two data files may reformat once (canonical serializer); running `--build` a SECOND time leaves them with **no diff**. (If the first run shows a diff, commit it as the normalization, then re-run to confirm clean.)

- [ ] **Step 6: Commit**

```bash
cd /Users/theoutsider/wordul-wiki
git add scripts/wiki-sync.mjs package.json
git commit -m "feat(wiki): wiki:sync — check + idempotent build"
```

---

## Task 4: `/push` non-blocking gap warning

**Files:**
- Modify: the push skill file (find it: `cd /Users/theoutsider/wordul-wiki && rg -l "Cloudflare prod" .claude/skills` — likely `.claude/skills/push/SKILL.md`)

- [ ] **Step 1: Locate the push skill**

Run: `cd /Users/theoutsider/wordul-wiki && rg -l -i "push.*cloudflare|cloudflare prod|wrangler deploy" .claude`
Expected: the file that defines `/push` (e.g. `.claude/skills/push/SKILL.md`).

- [ ] **Step 2: Add a pre-deploy step to that skill's instructions**

Insert, just before the GitHub push / deploy steps, a block instructing the operator/agent to keep pages fresh and warn (never block) on gaps:

```markdown
### Pre-deploy: wiki freshness (non-blocking)
Run from the repo root:
- `npm run wiki:pages` — regenerate committed word pages from the current corpus so they never drift.
- `node scripts/wiki-sync.mjs --check || echo "⚠️ wiki:sync — some answer words lack a verified card; the daily routine will fill them. Deploy proceeds."`

Commit any `public/word/*.html` / `public/words.html` changes the regen produced. Do NOT block the deploy on `--check`; it is a warning only (the daily routine owns generation).
```

- [ ] **Step 3: Commit**

```bash
cd /Users/theoutsider/wordul-wiki
git add .claude/skills
git commit -m "chore(wiki): /push warns on uncovered words + refreshes pages"
```

---

## Task 5: Daily self-healing routine

**Files:**
- Create: `docs/routines/wiki-sync-routine.md`
- Ops: register via `/schedule`

- [ ] **Step 1: Write the routine spec**

Create `docs/routines/wiki-sync-routine.md`:

```markdown
# Routine: wiki-sync (daily)

**Cadence:** daily, ~05:00 ET (low-traffic; before the day's word matters).
**Working dir:** `/Users/theoutsider/wordul-wiki` (branch `wiki`).
**Tier:** C (wiki content; auto-merge after the gauntlet — qa-gatekeeper → preview → preview-verifier → post-deploy-verifier).

**Prompt:**
> In /Users/theoutsider/wordul-wiki, run `node scripts/wiki-sync.mjs --check`.
> - If it exits 0 (corpus complete): stop — nothing to do.
> - If it reports missing words: launch the verified generate→verify Workflow over EXACTLY those words
>   (same adversarial pipeline as the Phase-1 legendary-English run — generators write
>   `.intel-staging/en/<slug>.json`, independent verifiers write `<slug>.verified.json`, refute-by-default).
>   Then run `node scripts/wiki-sync.mjs --build`, run `npm run typecheck && npm test` (must pass),
>   commit (`content(wiki): auto-fill <N> new word page(s)`), and deploy through the gauntlet.
> Never ship unverified content. If generation fails for a word, leave it missing (next run retries) and log it.
```

- [ ] **Step 2: Commit the routine spec**

```bash
cd /Users/theoutsider/wordul-wiki
git add docs/routines/wiki-sync-routine.md
git commit -m "docs(wiki): daily self-healing wiki-sync routine spec"
```

- [ ] **Step 3: Register the routine (ops, requires user)**

Invoke `/schedule` to create the recurring agent using the prompt + cadence from `docs/routines/wiki-sync-routine.md`. This is an operator action (creates a cron remote agent); confirm it appears in the schedule list. No code/test.

---

## Self-Review (completed during planning)

- **Spec coverage:** `coverage.mjs` (T1) ↔ spec "coverage.mjs"; `intel-merge.mjs` + shared serializer (T2) ↔ D4 + the "engine drift" risk (one merge impl); `wiki-sync.mjs` `--check`/`--build` (T3) ↔ spec Components 1–2; `package.json` (T3) ↔ Components 3; `/push` warning (T4) ↔ D6 + Component 5; daily routine (T5) ↔ D3/D5 + Component 4. Out-of-scope items (Approach B, non-5-letter pools, page pruning) are intentionally absent. ✓
- **Placeholder scan:** none — every code/test step carries full content; T4/T5 are inherently ops/doc tasks (no fabricated code).
- **Type/name consistency:** `targetWords()`/`missingWords(corpusKeys, target)` identical across `coverage.mjs`, its test, and `wiki-sync.mjs`; `readVerifiedCards`/`writeRich`/`writeSlim`/`mergeStagingToCorpus({stagingDir,richPath,slimPath})→{merged,added,keys}` identical across `intel-merge.mjs`, its test, and `wiki-sync.mjs`; the slim shape `{def,fact,quote,author}` + `wordIntel()` footer match the game's existing `public/data/word-intel.js` contract; `RICH`/`SLIM`/`STAGING` paths match the Phase-1 + spec layout (`data/word-intel-rich.js`, `public/data/word-intel.js`, `.intel-staging/en`).

---

## Risks / notes for the executor

- **Run after Phase 1.** `--check`/`--build` are only meaningful once `data/word-intel-rich.js` exists. T1–T2 (pure) can land anytime; do T3–T5 after the corpus is committed.
- **One-time reformat.** The first `--build` rewrites both data files through this canonical serializer; expect a normalizing diff, then byte-idempotent thereafter (T3 Step 5).
- **ESM import cache.** `wiki-sync` reads the corpus via dynamic `import()`. `--build` computes post-build "missing" from the in-memory `res.keys` (NOT a re-import) precisely to dodge the ESM module cache returning the pre-write corpus.
- **Routine independence.** Different words never contend; generation is bounded by the (usually ~0) missing count; the gauntlet + Tier-C gate the unattended deploy.
