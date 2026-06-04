# Legendary Multilingual Word Wiki — Design Spec

## Status

**brainstorm → spec.** This is the single source of truth after context is cleared. Five exploratory inputs (foundation audit, content model, multilingual architecture, generation architecture, SEO) are reconciled here into one implementation-ready document. Where the inputs disagreed (the exact 12-language set, the storage shape, the OG-key scheme) this spec **picks one** and records the alternative under *Open questions*. A fresh session with zero prior context can implement this end-to-end against the exact file paths cited.

## Summary

Transform every Wordul answer-word page (`/word/<slug>`, already shipping as static HTML) into a legendary, multilingual learning-and-art artifact: per English answer word, the richest defensible content — multiple disambiguated senses, etymology, surprising verified facts, an *original* poem, layered puns/jokes, a teaching/lesson, a real attributed quote, and mnemonics — authored in **12 languages**, where the factual layer is **translated** from a verified English source and the creative layer is **re-originated natively** per language (a German pun is German wordplay, not a calqued English one). All content is produced by **teams of Claude Opus 4.8 agents** under Workflow orchestration (cap: 10 concurrent agents, 1000 agents/run, on a 12-core host) and passes **adversarial verification** — independent refute-by-default judges — so nothing fabricated (fact, quote, or mistranslation) ever reaches a public page. The system **extends** the existing pipeline (intel data module → page generator → static assets → Cloudflare worker → sitemap/OG/llms.txt); it does not rebuild any of it. The English page at `/word/<slug>` never moves and becomes the `x-default` of each 12-language cluster.

## Vision & goals

- **Per word, the most intelligent + most humanly-pleasant artifact imaginable.** "All cognitive intelligence mixed with the most pleasant, humanly-readable pieces of literature and art." Multiple senses, origin story, true surprising facts, original poetry, layered jokes, a lesson, a real quote, mnemonics — all of it.
- **12 languages, page-language ≠ puzzle-language.** The answer words are English five-letter words; the game is English. A language is the language the *page about the word* is written in. `/ar/word/ocean` is an Arabic-language page **about the English word OCEAN** — the headword, the letter tiles, the anagram graph, the OG-image letters, the slug, and the stats-DO key all stay English in every locale. This is the single most important invariant; it cascades through routing, the graph, the OG card, and storage.
- **Translate facts, re-originate art.** Facts have one ground truth and survive translation; poems/puns/mnemonics do not — translating them produces exactly the AI-slop the vision forbids, so they are written from scratch natively.
- **Nothing fabricated ever ships.** Adversarial verification gates every factual field. Empty beats wrong: any droppable field that fails verification is blanked, and the renderer already omits empty sections.
- **Discoverability across all six engine types** (SEO/AEO/AIO/GEO/LEO/VEO) in all 12 languages: self-canonical per locale, reciprocal hreflang clusters + `x-default`, sitemap index, localized JSON-LD with `CreativeWork`(poem) + `Quotation`(quote) nodes, localized OG cards + alt text, per-language `llms.txt`. 12 *independently authored* artifact sets per word = ~27,780 genuinely non-duplicative pages — a discovery moat competitors cannot cheaply copy.
- **Extend, never rebuild.** Every existing file keeps its contract; new behavior is additive and guarded.

## Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Canonical 12-language set:** `en` (source/x-default), `es`, `fr`, `de`, `pt`, `ja`, `ko`, `zh-Hans`, `hi`, `ar`, `ru`, `id`. | Maximizes speaker reach + definition/word-game search demand **and** exercises every script family: Latin (`es/fr/de/pt/id`), CJK-Han (`zh-Hans`), CJK-mixed (`ja`), Hangul (`ko`), Devanagari (`hi`), Arabic-RTL (`ar`), Cyrillic (`ru`). Forces the typography pipeline through RTL + CJK + Devanagari + Cyrillic, not just Latin-with-accents. Resolves the three conflicting input lists. (Italian/Dutch/Polish/Swedish/Turkish were candidates; dropped to keep script diversity over Latin redundancy — see Open questions.) |
| D2 | **English is the source of record and the only verify-once layer.** All 11 other languages translate the *verified* English factual layer; English never re-translated. | Amortizes verification: verify a fact once in English, then only translation-fidelity is checked per language. A fabricated fact cannot enter via a back door later. |
| D3 | **Factual layer translated; creative layer re-originated natively.** Translate: `def`, `senses[].gloss`/`example`, `etymology`, `facts[]`, quote *rendering*. Re-originate: `poem`, `jokes[]`, `mnemonic`, `lesson`. | A pun/poem/mnemonic loses its music, double-meaning, or letter-trick in translation. Re-origination is the entire point of "legendary." |
| D4 | **Storage = one ES module per language: `public/data/word-intel.js` (en, unchanged path) + `public/data/intel/<lang>.js` (the other 11).** Each holds `INTEL[WORD]` for that language, plus a thin `intel/en.js` that re-exports `../word-intel.js` for uniform loading. | The game (`app.js`) keeps importing only the small English file; build sharding maps 1:1 to language work units (no write-contention across agent teams); git diffs stay per-language; resume-safe merge-never-overwrite is preserved per file. (Chosen over Input 2's single nested `i18n` megafile and Input 4's `word-intel.<lang>.js` flat siblings — same intent, this is the agreed path.) |
| D5 | **Schema = `schemaVersion: 2`, strict superset of today's `{def,fact,etymology,pos,syllables,quote,author}`.** Legacy top-level fields preserved with identical names/types/semantics; the English file's legacy fields are an alias view auto-derived from the rich content (`fact = facts[0]`). | `wordIntel(word)`, `renderWordPage()`, and `app.js`'s `renderWordCard` keep working with **zero** changes. New fields are additive + optional. |
| D6 | **URL = path-prefix, English un-prefixed.** `/word/<slug>` stays English (canonical, no migration); `/{lang}/word/<slug>` for the other 11. Slug is the English word in every locale. | Subdomains fragment domain authority; `?lang=` query params are ignored/canonicalized-away by Google and invisible to AI crawlers. Path-prefix concentrates all 27,780 pages under one authority signal and rides the existing assets-first static-file model. |
| D7 | **Self-referential canonical per locale + full reciprocal hreflang cluster + `x-default`→English.** Cluster lists only languages whose `intel/<lang>.js` actually contains this word; the build knows `availableLangs[word]` (all 12 maps in memory) and emits the *identical* cluster in `<head>` and in the sitemap. | Pointing locale canonicals at English would deindex them. Reciprocity is structural (one shared array), never hand-maintained. hreflang must never point at a 404. |
| D8 | **Whole-page English fallback is the ONLY cross-language fallback.** If `/{lang}/word/<slug>.html` is missing, the worker **302-redirects to the English canonical**. There is **no cross-language fallback for creative fields** — never show the English joke on the French page; a `null` creative field renders nothing. | A borrowed joke is worse than no joke and poisons the `lang`/`hreflang` contract. A locale 404 wastes crawl budget. The English page's hreflang simply won't list that locale until the file lands. |
| D9 | **Adversarial verification = independent refute-by-default judges, separate Opus 4.8 instances with no shared context.** Four specialist judges per card: Quote, Fact, Translation (Phase 2), Creative. Two passes on factual claims (survive only one ⇒ dropped). `verified` flags gate rendering. | True independence, not self-grading. The merge step writes only verified fields. Quote is the highest-risk field: drop if unsure, never machine-translate a quote as the author's words. |
| D10 | **OG-card key scheme: `og/<lang>/<slug>.png` in the `wordul-og` R2 bucket; English keeps `og/<slug>.png`.** Path segment carries the locale; slug stays English. | Self-describing keys; the existing `/word/og/<key>.png` worker route passes the key straight to R2, so the only change is the `og:image` URL the page emits and the route's key-parsing. (Chosen over Input 3's `ocean.es.png` dotted suffix.) |
| D11 | **Sitemap index + per-language child sitemaps**, replacing the single flat `urlset`. Each child stays ≤ ~2,317 URLs; word sitemaps embed `xhtml:link` hreflang clusters. `robots.txt` unchanged (already points at `/sitemap.xml`, now the index). | A single 27,780-URL sitemap is unmaintainable and blocks per-locale indexation reporting in Search Console. |
| D12 | **Static tree committed under `public/` (≈330 MB at ~27.8k × ~12 KB).** Acceptable for Cloudflare static assets. Fallback if the repo gets heavy: serve localized HTML from R2 (like `/designs/*` already does), keeping only English in `public/`. | Assets-first routing is the whole trick — files just exist and win before the worker. R2 offload is a known escape hatch, not day-1 work. |
| D13 | **No client-side intel loading for the page body, any language.** Rich content is baked into static HTML at build time. The only client fetch on a word page stays the live-stats panel. | Crawlers/AI get complete content with no JS. Keeps the game bundle from importing 12× rich intel. |
| D14 | **Conservative locale detection: never auto-redirect, never redirect crawlers.** On a bare-`/word/<slug>` first browser visit (no `lang` cookie, not a bot), the worker may inject a one-time dismissible suggestion *banner* (a link, not a redirect) via `HTMLRewriter`. Choice is sticky via `lang` cookie + `localStorage`. | Auto-redirect on `Accept-Language` bounces Googlebot into the wrong locale and traps users. Keeps every canonical URL stable for crawlers. |

## Open questions to confirm

1. **Exact 12-language set (D1).** The three inputs proposed three different sets. This spec locks `en/es/fr/de/pt/ja/ko/zh-Hans/hi/ar/ru/id` to maximize script diversity. Confirm, or swap toward higher-CPC Latin markets (`it/nl/pl/sv/tr`) at the cost of RTL/Devanagari/Cyrillic coverage. **This is baked into URLs, hreflang, sitemaps, and R2 keys — freeze before any generation run.**
2. **Content scope per language — full parity or tiered?** Does every language get the *full* creative suite (poem + jokes + mnemonic + lesson), or do non-priority locales ship factual-only (def/senses/etymology/facts/quote) first, with creative backfilled later? Re-origination + native-fluency verification is the most expensive and highest-reject path. Recommendation: ship factual parity for all 12 in Phase 5, then creative for `en/es/fr/de/pt/ja` first, backfill the rest.
3. **Accuracy tolerance.** `confidence < 0.9 ⇒ drop a fact` and "two verification passes; survive only one ⇒ drop" are the proposed bars. Confirm the threshold and the N (regeneration retries: facts N=2, creative N=3) before the gate is load-bearing. Also confirm the `difficulty` field is *never* presented in copy as a measured stat (it's an editorial guess, reconciled later against live `solveRate`).
4. **Cost ceiling.** End-to-end is ~150k–170k Opus 4.8 model calls (~27,780 generations + ~4× adversarial verification + ~15–25% regeneration loop overhead). The directive says token cost is **not** a constraint, but confirm there is no hard $ ceiling before kicking off all 12 runs, since Phase 2 is 11× Phase 1.
5. **Quote availability per language.** When a quote's original language ∈ our 12 (e.g. a Goethe line for `de`), show the original; otherwise English + faithful localized gloss; otherwise omit. Confirm we never machine-translate-and-attribute. Also confirm transliteration policy for author names in non-Latin scripts (`ja/ko/zh-Hans/hi/ar/ru`).
6. **CJK/Arabic/Devanagari OG fonts.** resvg ships no system fonts; we must bundle Noto subsets. Confirm bundling Noto Sans SC/JP/KR + Noto Naskh Arabic + Noto Sans Devanagari into `scripts/lib/fonts/` (a few MB, build-only) vs falling back to a tiles-only OG card (no tagline) for non-Latin locales. **Flagged blocker.**

## Current foundation (extend, don't rebuild)

Ground truth on branch **`wiki`** of `/Users/theoutsider/wordul-wiki` (verified: 6 seeded intel keys, 2315-word `A5` literal, no `langs.mjs` yet). Everything below already works; the spec extends it.

### Word-intel data model
- `/Users/theoutsider/wordul-wiki/public/data/word-intel.js` — committed ES module, **hand-seeded with 6 words** (`POWER`, `DREAM`, `LIGHT`, `OCEAN`, `TRUTH`, `MONEY`; each currently only `def/fact/quote/author`). Exports `WORD_INTEL = { WORD: {…} }` (uppercase keys) and `wordIntel(word)` (case-insensitive; returns entry or `null` → caller falls back to live dictionary).
- Per-word fields, written in order: `def`(req), `fact`(req), `etymology`, `pos`, `syllables`, `quote`+`author` (pair, dropped if unsure). The richer `etymology/pos/syllables` only land when the generator runs.

### Generator — `/Users/theoutsider/wordul-wiki/scripts/gen-word-intel.mjs`
- Reads answer pool by regexing `const A\d+ = "WORD,…"` out of `src/wordsbysize.ts`; reads covered words by regexing existing keys out of `word-intel.js`. **MERGES — never overwrites**; resume-safe; persists after each word.
- Cloud backend (default): Anthropic SDK, `ANTHROPIC_MODEL = "claude-opus-4-8"`, `max_tokens: 400`, `SYSTEM_API` demands 7-field JSON + real attributed quotes (empty if unsure). Needs `ANTHROPIC_API_KEY`.
- `--local` Ollama backend: `${OLLAMA_URL or http://localhost:11434}/api/chat`, `format:"json"`, `think:false`, `temperature:0.3`, default `qwen2.5:7b-instruct`. `SYSTEM_LOCAL` requests only `{def,fact,etymology,pos,syllables}`; `intelForLocal()` **hard-blanks `quote`/`author`** (a local model's quote is a public-page trust risk).
- Flags: `--limit N`, `--local`, `--model X`, or positional `WORD WORD2`. `writeIntel()` re-serializes the whole map sorted by key, preserving header + re-emitting the `wordIntel()` footer.

### Page generator + render — `npm run wiki:pages` → `/Users/theoutsider/wordul-wiki/scripts/gen-word-pages.mjs`
- Imports `WORD_INTEL`, builds the word graph, loops every answer word (skipping exclusions), writes `public/word/<slug>.html` (committed) + `dist/og/<slug>.png` (gitignored, 1200px via `@resvg/resvg-js`). Writes A–Z index `public/words.html`. `ORIGIN = process.env.WIKI_ORIGIN || "https://wordul.com"`.
- **Current state: `public/word/` is empty, `public/words.html` does not exist — pages not generated on this branch.**

Helper libs in `/Users/theoutsider/wordul-wiki/scripts/lib/`:
- `words.mjs` — build-side mirror of `src/words.ts`. `answerWords()` regexes 5-letter words from `A\d+`; `exclusions()` regexes `src/word-exclusions.ts`; `slugFor(w)=w.toLowerCase()`.
- `word-graph.mjs` — `buildWordGraph(words)` → `Map<word,{anagrams,ladder,sharedStart}>`. Anagrams by sorted letters; `ladder`=change-one-letter answer neighbors; `sharedStart`=same first-2. Each capped `CAP=12`.
- `word-page.mjs` — pure `renderWordPage(word, intel, graph, origin)`. Full static HTML: letter tiles, meta line (`pos · N syllables`), `<h1>`, def, fact, quote `<blockquote>`, etymology, a `wp-faq` `<details>` (3 Q&As), related-words (Anagrams / Change one letter / Same start), a `wp-stats` placeholder (`"Be the first to solve it."`), play CTA. Head: `<title>` `What does "WORD" mean? — definition, facts & word game`, meta description, `canonical`, OpenGraph (`og:type=article`) + `twitter:card=summary_large_image`, **JSON-LD `@graph`** with `DefinedTerm`, `WebPage` (+`primaryImageOfPage`), `FAQPage`. OG URL `${origin}/word/og/${slug}.png`. Loads `/word-page.css` + `/word-page.js` (defer). Hardcodes `<html lang="en">`.
- `og-card.mjs` — `ogCardSvg(word, def)` → 1200×630 SVG: `#121213` bg, `#6aaa64` tiles, def tagline (≤90 chars), `wordul.com` footer. Uses `Arial, sans-serif` (cannot render CJK).
- OG upload `npm run wiki:og` → `/Users/theoutsider/wordul-wiki/scripts/upload-og.mjs` pushes `dist/og/*.png` to `wordul-og` R2 via S3 API (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`), 16-way concurrency.
- Frontend: `/Users/theoutsider/wordul-wiki/public/word-page.css` (dark `.wp*`, 720px max), `/Users/theoutsider/wordul-wiki/public/word-page.js` (hydrates ONLY live stats: reads `.wp-stats[data-word]`, fetches `/api/word/<word>/stats`, replaces placeholder unless `neverPlayed`).

### Worker — `/Users/theoutsider/wordul-wiki/src/worker.ts`
**Wrangler serves matching static assets BEFORE the worker** — `/word/ocean` is served from `public/word/ocean.html` if it exists; the `/word/` branch runs only on asset MISS.

| Route | Behavior |
|---|---|
| `/word/og/<key>.png` | Fetch `<key>` from `env.OG` R2; 404 if absent; `cache-control: public, max-age=86400`. |
| `/today` | 302 → `/word/<slugFor(wordOfTheDay(new Date()))>`. Lives at top-level (NOT `/word/today`, which would be shadowed). |
| `/word/<raw>` | Strip trailing slash; if `raw!==lower` 301→lowercase; if `isWordPage(lower)` serve `${origin}/word/${lower}.html` via `env.ASSETS`; else friendly inline 404. |
| `/words` | Serve `/words.html` via `env.ASSETS`. |
| `/api/word/<w>/stats` | Uppercase `<w>`; 404 unless `isWordPage`; fetch `env.WORDSTATS.idFromName(WORD)` GET; JSON `cache-control: public, max-age=300`. |
| `/sitemap.xml` | `sitemap(env, origin)` — starts with `/`, lists `env.DIRECTORY` KV (paginated 1000) for `user:`/`room:` → `/@name`, then appends `/words` + one `/word/<slug>` per `ANSWER_WORDS` passing `isWordPage`. |

Other routes (context): `/ws`, `/api/user/<name>`, `/r` & `/r/*`→home, `/designs` + `/designs/*` (DESIGNS R2), `PROFILE_RE`/`ROOM_RE` SPA-shell `HTMLRewriter` injection. Fallthrough: `env.ASSETS.fetch(req)`.

### Per-word stats
- `/Users/theoutsider/wordul-wiki/src/wordstats.ts` — pure aggregation. `WordStatsState={answered,wins,guessSum,guessDistribution}` (sum/dist count WINS only); `WordStatsView={answered,solveRate,avgGuesses,guessDistribution,neverPlayed}`; `emptyWordStats()`, `applyWordGame()`, `deriveWordStats()`.
- `/Users/theoutsider/wordul-wiki/src/wordstats-do.ts` — `WordStats` Durable Object, **one DO per answer word** (`env.WORDSTATS.idFromName(WORD)`), storage key `"state"`. `GET`→`deriveWordStats`; `POST /bump` takes `{games:[{result,guesses}]}` as one atomic read-modify-write.
- Finish-hook fan-out: `/Users/theoutsider/wordul-wiki/src/room.ts` `finishGame()` (~529–584) filters bots (`!p.isBot`), maps humans → `{result,guesses}`, POSTs ONE batched `{games}` to `WORDSTATS.idFromName(word)` `/bump`. Best-effort, never blocks. **Bots never move public stats.**
- `WORDSTATS` binding in `/Users/theoutsider/wordul-wiki/src/types.ts` `Env` + `/Users/theoutsider/wordul-wiki/wrangler.jsonc` (`class_name:"WordStats"`, migration `v3: new_sqlite_classes:["WordStats"]`). R2: `DESIGNS`→`wordul-designs`, `OG`→`wordul-og`. KV: `DIRECTORY`. Worker `wordle-race`; `compatibility_date 2026-04-25`; `nodejs_compat`.

### Words + exclusions — `/Users/theoutsider/wordul-wiki/src/words.ts`
- `ANSWER_WORDS: Set<string>` = `WORDS_BY_SIZE[5].answers`, uppercase. **Confirmed 2315.**
- `isWordPage(word)` = `ANSWER_WORDS.has(W) && !EXCLUDED.has(W)`; `slugFor`=lowercase; `wordFromSlug`=uppercase; `wordOfTheDay(date)`=days-since-epoch indexed into `SORTED_ANSWERS` (editorial, independent of the multiplayer picker).
- `/Users/theoutsider/wordul-wiki/src/word-exclusions.ts` — `WORD_EXCLUSIONS: string[]`, **currently empty** (fill from a profanity pass before first publish). Single source of truth for worker + build generator.

### Other relevant pieces
- End-card in `/Users/theoutsider/wordul-wiki/public/app.js` (`renderWordCard`, ~2160–2236) imports `wordIntel` from `/data/word-intel.js` (line 15). The "Look it up ↗" anchor (`a.ewc-look`, i18n `endscreen.lookup`) is **flipped to the internal wiki** `look.href = /word/<w>`. Rich path: if `wordIntel(word)` exists, renders `def`+optional `fact`+optional `quote`/`author`, no network. Fallback: fetch `api.dictionaryapi.dev`.
- `/Users/theoutsider/wordul-wiki/public/llms.txt` + `llms-full.txt` — have a `## Word wiki` section. `/Users/theoutsider/wordul-wiki/public/robots.txt` — `Allow: /` + `Sitemap: https://wordul.com/sitemap.xml`.
- Scripts: `wiki:pages`, `wiki:og`, plus `dev`/`deploy`/`typecheck`/`test`. Intel generator has no npm alias — run `node scripts/gen-word-intel.mjs`.

**Gaps on this branch:** `public/word/*.html` + `public/words.html` not generated; `word-intel.js` has 6 words (no `etymology/pos/syllables`); `WORD_EXCLUSIONS` empty.

## Content model

### Design axioms
1. **Two field classes, two trust regimes.** Every field is **FACTUAL** (a claim about the world — must be true, verifiable, *translatable*) or **CREATIVE** (original art — invented by design, *re-originated* per language, never machine-translated). Factual fields are fact-checked; creative fields are checked for originality + quality, never for "truth."
2. **Empty beats wrong.** Every field except `def` is droppable. A missing field renders nothing. A fabricated field is brand-ending. On uncertainty: **OMIT.**
3. **Per-word identity is a `pack`; per-language content is a `loc`.** Language-invariant identity (`pos`, `syllables`, `letters`, `ipa`, `difficulty`, numeric fact skeletons, quote *identity*, `tags`) is written once. Language-bound content lives per language. In storage (D4) the pack root is replicated minimally into each per-language file and the rich `loc` lives in that file; English's legacy top-level fields are an alias view of its own `loc`.

### Top-level shape (conceptual — physically split per D4 into per-language files)

```
WORD_INTEL["OCEAN"] = {
  // identity (language-invariant; written once, mirrored into each lang file)
  pos, syllables, letters, ipa, difficulty,
  factsMeta[],          // SOURCED, language-invariant skeleton of each fact
  quoteRef,             // canonical identity of the quote (who/where/verified)
  tags[], schemaVersion, verified, generatedAt,
  _prov,                // build-time provenance per field (stripped from page payload)

  // localized content — physically one file per lang (D4)
  // word-intel.js holds en; intel/<lang>.js holds the other 11
  <LOC>                 // the per-language block (see below)
}
```

A `<LOC>` (per-language content block):

```
{
  def,            // FACTUAL — required, the only non-droppable field
  senses[],       // FACTUAL
  etymology,      // FACTUAL
  facts[],        // FACTUAL (localized prose over factsMeta, index-aligned)
  quote, author,  // FACTUAL (the quoteRef quote rendered in this language)
  mnemonic,       // CREATIVE — re-originated
  poem,           // CREATIVE — re-originated, ≤6 lines
  jokes[],        // CREATIVE — re-originated
  lesson          // CREATIVE (aphorism) — re-originated
}
```

### Field dictionary

Legend: **[F]** factual/translatable · **[C]** creative/re-originated · **[I]** identity (write once, language-invariant).

| Field | Class | Type | Definition & QUALITY BAR |
|---|---|---|---|
| `pos` | I | string | Primary part of speech (dominant sense). Secondary POS live inside `senses[]`. Omit if genuinely ambiguous. Unchanged from current. |
| `syllables` | I | int | English-syllable count of the headword (locale-invariant fact about the English word). Omit if 0/unknown. Unchanged. |
| `letters` | I | int | Always 5 for answer words; stored so renderer/JSON-LD need no `.length`. |
| `ipa` | I | string | IPA of the **English** headword, e.g. `/ˈoʊ.ʃən/`; GA or RP labeled; omit rather than guess. Powers a pronunciation line + future audio. |
| `difficulty` | I | int 1–5 | Editorial guess-difficulty (1 easy → 5 brutal). **Soft signal**, may later reconcile against live `solveRate`. **Never** presented in copy as a measured stat. |
| `factsMeta[]` | I | object[] | The **sourced skeleton** of each fact. Each: `{claim (terse EN assertion), kind ("science"|"history"|"culture"|"language"), number?, person?, year?, source (URL/canonical work), confidence (0–1)}`. Verified **once**; per-language `facts[]` are faithful retellings. Bar: 1–3 entries; each names a specific number, person, or dated discovery + a real source. **`confidence < 0.9 ⇒ drop the fact.`** |
| `quoteRef` | I | object | Canonical identity of the quote: `{author, work?, year?, source (URL/edition), verified (bool)}`. `verified:false ⇒ quote dropped from EVERY language.` |
| `tags[]` | I | string[] | 2–6 lowercase topical tags from a controlled vocabulary (`"water"`,`"nature"`,`"physics"`) for internal linking/related content. |
| `def` (LOC) | F | string | One crisp sentence, the single most common meaning. **Required.** ≤ ~140 chars, no circular defs, no example sentence (that lives in `senses[]`). |
| `senses[]` (LOC) | F | object[] | **Every real distinct meaning** — not just two. Each: `{pos, gloss, example (natural human sentence), register? ("formal"|"informal"|"archaic"|"technical"|"figurative")}`. Ordered common→rare; merge near-identical; cover lexicalized idiomatic/figurative senses. |
| `etymology` (LOC) | F | string | Origin in 1–2 sentences. Name the source language + root (Greek/Latin/Old English/PIE), trace the path; **empty if unsure** (a plausible folk etymology is fabrication). Localized = *translated* (origin facts are invariant). |
| `facts[]` (LOC) | F | string[] | 1–3 surprising TRUE facts as polished prose, each a faithful localization of one `factsMeta` entry (the number/person/year appears). Must land as surprising to a smart adult; never a restated definition. Index-aligned to `factsMeta`. |
| `quote`+`author` (LOC) | F | string pair | The `quoteRef` quote rendered in this language (published translation if one exists; else original-language quote + faithful gloss; else omit for that language). **Hard guardrail: REAL words, REAL person, correctly attributed.** Misattribution = fabrication. Absent everywhere if `quoteRef.verified` is false. |
| `mnemonic` (LOC) | C | string | A memory hook (acrostic, sound-alike, vivid image, letter-pattern). Spelling mnemonics exploiting English letter order **do not translate** → re-originated per language. "Just remember the word" is not a mnemonic. |
| `poem` (LOC) | C | object | ORIGINAL short poem. `{form ("haiku"|"tercet"|"couplet"|"clerihew"|"quatrain"|"free"), lines[]}`. **≤ 6 lines.** Honor the form (haiku 5-7-5 in the target language's prosody; couplet rhymes; clerihew AABB with line 1 ending on a name). A real image + a turn, not "ocean is big and blue." **Re-originated per language.** |
| `jokes[]` (LOC) | C | object[] | 1–3 layered puns/wordplay. Each: `{text, type ("pun"|"double-entendre"|"wordplay"|"riddle"), translatable (bool)}`. **Lands** = two simultaneously-valid readings, or a setup→turn with genuine surprise; groan-tier = a single homophone with no second meaning. `translatable:false` for sound/spelling-bound humor → re-originated, never translated. |
| `lesson` (LOC) | C | string | A one-line teaching/aphorism the word invites — original, not a quote. Earned by the word's meaning, aphoristic, ≤ ~120 chars. Re-originated per language so cadence survives. |
| `schemaVersion` | I | int | `2` (1 = legacy 7-field). |
| `verified` | I | object | `{facts: bool, quote: bool, translations: bool, passedAt}`. The generator **refuses to render legendary fields** (`facts[]`, `quote`, `senses[]`, creative) for any word/lang where the relevant flag is false; it falls back to legacy/`def`-only. |
| `generatedAt` | I | string | ISO timestamp of last generation (resume/staleness). |
| `_prov` | I | object | Per-field provenance: `mt` (machine-translated-then-verified) vs `orig` (native re-origination). Build-time metadata, **stripped from the shipped page payload**, kept in the data file for tooling ("regenerate just `ja` jokes"). |

### Fully-worked exemplar — `OCEAN`

```json
{
  "OCEAN": {
    "pos": "noun",
    "syllables": 2,
    "letters": 5,
    "ipa": "/ˈoʊ.ʃən/",
    "difficulty": 2,
    "tags": ["water", "nature", "geography", "earth-science"],
    "schemaVersion": 2,

    "factsMeta": [
      { "claim": "The ocean produces more than half of Earth's oxygen, mostly via marine phytoplankton.",
        "kind": "science", "number": ">50%", "person": null, "year": null,
        "source": "https://oceanservice.noaa.gov/facts/ocean-oxygen.html", "confidence": 0.97 },
      { "claim": "The deepest point, Challenger Deep in the Mariana Trench, is ~10,935 m down — deeper than Everest is tall.",
        "kind": "science", "number": "10935 m", "person": null, "year": null,
        "source": "https://www.gebco.net/news_and_media/gebco_2020_mariana_trench.html", "confidence": 0.96 },
      { "claim": "More humans have walked on the Moon (12) than have descended to the bottom of Challenger Deep (a single-digit handful).",
        "kind": "history", "number": "12 vs ~handful", "person": null, "year": null,
        "source": "https://www.noaa.gov/jetstream/ocean/exploration", "confidence": 0.9 }
    ],

    "quoteRef": {
      "author": "John F. Kennedy",
      "work": "Remarks at the America's Cup Dinner, Newport, Rhode Island",
      "year": 1962,
      "source": "https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches/newport-ri-19620914-americas-cup-crews",
      "verified": true
    },

    "def": "A vast continuous body of salt water covering most of Earth's surface.",
    "senses": [
      { "pos": "noun",
        "gloss": "The continuous mass of salt water that covers about 71% of Earth's surface.",
        "example": "Two thirds of the planet is ocean, yet most of it has never been seen by human eyes.",
        "register": null },
      { "pos": "noun",
        "gloss": "One of the named principal divisions of that mass (Pacific, Atlantic, Indian, Southern, Arctic).",
        "example": "She sailed across the Atlantic Ocean in a boat smaller than a bus.",
        "register": null },
      { "pos": "noun",
        "gloss": "A very great quantity or expanse of something.",
        "example": "After the layoffs he had oceans of time and no idea what to do with it.",
        "register": "figurative" },
      { "pos": "adjective",
        "gloss": "Of a shade of blue-green resembling the sea ('ocean blue').",
        "example": "The walls were painted a calm ocean blue.",
        "register": "informal" }
    ],
    "etymology": "From Greek 'Ōkeanós', the great river the ancient Greeks believed encircled the flat Earth, personified as the Titan Oceanus; into Latin 'oceanus', Old French 'occean', then English.",
    "facts": [
      "The ocean makes more than half the oxygen you breathe — most of it from microscopic drifting phytoplankton, not from trees.",
      "Its deepest point, Challenger Deep in the Mariana Trench, plunges about 10,935 metres — sink Mount Everest into it and the summit would still be a mile underwater.",
      "Twelve people have walked on the Moon; only a handful have ever reached the bottom of Challenger Deep — the seabed is, in a real sense, less explored than the lunar surface."
    ],
    "quote": "We are tied to the ocean. And when we go back to the sea, whether it is to sail or to watch it, we are going back from whence we came.",
    "author": "John F. Kennedy",
    "mnemonic": "Spelling: O-C-E-A-N → 'Only Crazy Explorers Adore Nightswimming.' Meaning hook: the C in the middle is the 'sea' the word is named for.",
    "poem": {
      "form": "haiku",
      "lines": ["Salt breathing slowly—", "the moon hauls the whole grey weight", "up the sand, and back."]
    },
    "jokes": [
      { "text": "Why is the ocean such a good listener? Because it's all ears — every wave it makes is just water trying to reach the shore and say 'sea you'.",
        "type": "pun", "translatable": false },
      { "text": "I tried to write a book about the ocean but it had no plot — just one long current event with a lot of depth and very shallow characters.",
        "type": "double-entendre", "translatable": false },
      { "text": "What did the sea say to the shore? Nothing — it just waved.",
        "type": "pun", "translatable": false }
    ],
    "lesson": "The ocean teaches scale: most of what holds you up is depth you will never see — judge nothing by its surface.",

    "verified": { "facts": true, "quote": true, "translations": true, "passedAt": "2026-06-04T00:00:00Z" },
    "generatedAt": "2026-06-04T00:00:00Z",
    "_prov": { "senses": "orig", "etymology": "orig", "facts": "orig", "poem": "orig", "jokes": "orig" }
  }
}
```

*(The block above is the English `word-intel.js` shape; for `intel/es.js`, the identity fields `pos/syllables/letters/ipa/difficulty/factsMeta/quoteRef/tags` are mirrored read-only and the LOC fields are the Spanish content. `_prov` for `es` would mark `senses/etymology/facts: "mt"`, `poem/jokes/mnemonic/lesson: "orig"`.)*

**Why each creative field clears the bar (the verifier's rubric):**
- **Poem** is a true haiku (5-7-5), with a concrete image (tides as the moon dragging water's weight) and a turn ("and back"), not a description of blueness.
- **Joke #1** stacks three readings: "all ears" idiom + the ocean literally being made of waves + "sea you"/"see you" homophone. `translatable:false` — English-sound-only.
- **Joke #2** double-meanings four words at once: *current*, *depth*, *shallow*, *plot*. Density separates "lands" from groan-tier.
- **Lesson** is earned by the word's literal nature (depth vs surface), not a platitude.

### Factual-vs-creative split (the 12-language rule)

| Field | Per-language treatment | Why |
|---|---|---|
| `def`, `senses[].gloss`, `senses[].example`, `etymology`, `facts[]` | **Translate** from the verified English/`factsMeta` source. | Facts; translating preserves them. |
| `quote`/`author` | **Published translation if it exists**, else original-language quote + faithful gloss, else omit for that language. **Never machine-translate a quote and present it as the author's words.** Author transliterated, never re-attributed. | A paraphrased translation is no longer what they said (and preserve-attribution). |
| `pos`, `syllables`, `ipa`, `letters`, `difficulty`, `factsMeta`, `quoteRef`, `tags` | **Write once**, mirrored into each lang file; describe the **English** answer word. | Language-invariant identity. |
| `poem`, `jokes[]` (esp. `translatable:false`), `mnemonic`, `lesson` | **Re-originate per language** by a native-fluency agent given the verified concept as grounding. May return `null`. | Meter, rhyme, puns, spelling tricks do not survive translation. The German poem may riff `Licht`/`leicht`; the Japanese entry may use a *kakekotoba* pivot-word. |

**Graceful creative fallback — omit, don't fake.** Per creative field, per language, the re-origination agent returns either (1) a native original, or (2) `null` + a one-word `reason` (`"no-pun"`, `"forced"`, `"culturally-inappropriate"`). A `null` creative field renders nothing (the renderer already short-circuits on falsy). **No cross-language fallback for creative content** (D8).

### Accuracy guardrails (non-negotiable)

1. **Factual fields may never be invented.** `senses`, `etymology`, `facts`/`factsMeta`, `quote`/`author`/`quoteRef`, `pos`, `syllables`, `ipa` are world-claims. An adversarial verifier (separate Opus 4.8 instance, sees only output, not the generator's reasoning) confirms each; a **second** verifier attacks it ("find the error or the fabrication"). Survive only one pass ⇒ dropped.
2. **Quotes are the highest-risk surface.** A quote ships only if `quoteRef.verified === true` (resolved to a primary/reputable source: wording, author, attribution). When unsure: **OMIT in every language.** Misattribution = fabrication, not a near-miss.
3. **`confidence < 0.9 ⇒ drop`** — never softened with weasel words.
4. **Creative fields are invented by design — not a guardrail violation.** Their guards: (a) **originality** (not a borrowed/known line — plagiarism = fail); (b) **quality bar** (poem with a real image + turn; joke with ≥2 readings); (c) **safety** (no slurs, no punching down, age-appropriate). Borrowed/plagiarized/groan-tier ⇒ regenerate, not fact-check.
5. **`verified` gates rendering.** The page generator and the end-card reader render legendary content only for the flags that passed. Verified facts + unverified quote ⇒ facts shown, no quote.

## Multilingual architecture

### The twelve languages

```js
// scripts/lib/langs.mjs  (NEW — single source of truth; mirrored read-only by the worker)
export const LANGS = [
  { code: "en",      name: "English",    native: "English",          dir: "ltr", source: true },
  { code: "es",      name: "Spanish",    native: "Español",          dir: "ltr" },
  { code: "fr",      name: "French",     native: "Français",         dir: "ltr" },
  { code: "de",      name: "German",     native: "Deutsch",          dir: "ltr" },
  { code: "pt",      name: "Portuguese", native: "Português",        dir: "ltr" },
  { code: "ru",      name: "Russian",    native: "Русский",          dir: "ltr" },
  { code: "id",      name: "Indonesian", native: "Bahasa Indonesia", dir: "ltr" },
  { code: "ja",      name: "Japanese",   native: "日本語",            dir: "ltr", cjk: true },
  { code: "ko",      name: "Korean",     native: "한국어",            dir: "ltr", cjk: true },
  { code: "zh-Hans", name: "Chinese",    native: "简体中文",          dir: "ltr", cjk: true },
  { code: "hi",      name: "Hindi",      native: "हिन्दी",            dir: "ltr" },
  { code: "ar",      name: "Arabic",     native: "العربية",          dir: "rtl" },
];
export const SOURCE_LANG = "en";
export const langByCode = Object.fromEntries(LANGS.map((l) => [l.code, l]));
```

Codes are **BCP-47**, used verbatim as the URL segment, `<html lang>`, and `hreflang`. `zh-Hans` is the only hyphenated one; everywhere a slug/filename/path segment is derived, the code is used as-is (lowercased only where the spec says so; `zh-Hans` keeps its case in the path segment and hreflang value). `en` never appears as a path prefix.

**Invariant (restate):** the answer words are English; the slug, letter tiles, anagram graph, OG-image letters, and stats-DO key stay English in every locale. Only the *page language* changes.

### Translate-vs-re-originate (already locked in D3; mechanism here)
- **FACTUAL layer — translated faithfully from the verified English source** (verification amortized: verify EN once, then check only translation fidelity per language).
- **CREATIVE layer — re-originated natively, never translated**, by a native-fluency agent handed the verified factual layer as grounding context.
- A per-field `_prov` tag records the mechanism (`mt` vs `orig`) for auditing and targeted regeneration.

### URL & routing — `/{lang}/word/{slug}`, English un-prefixed (D6)

```
/word/ocean            → en  (canonical, UNCHANGED — public/word/ocean.html)
/es/word/ocean         → es  (public/es/word/ocean.html)
/ar/word/ocean         → ar  (public/ar/word/ocean.html, dir=rtl)
/zh-Hans/word/ocean    → zh-Hans
/words   ·  /es/words  ·  /ja/words            (index pages)
```

The slug stays English everywhere → anagram/ladder graph, OG key, and stats DO key are identical across languages.

**Worker dispatch (assets-first is the whole trick).** `public/es/word/ocean.html` is served directly by wrangler with zero worker code once the file exists. The worker handles only misses, redirects, and index/sitemap routes. Extend `src/worker.ts`:

- `LANG_RE = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(\/.*)?$/` recognizes a leading language segment, **only when** the segment ∈ `langByCode` **and ≠ `en`** (so `/@user`, `/designs`, `/ws`, `/r` are never mistaken for a lang). Strip it to `rest` and dispatch through the existing `/word/`, `/words`, `/today` logic, prefixing built asset paths with `/${lang}`:
  - `/{lang}/word/<raw>` → `301 /{lang}/word/<lower>` if not lowercase; then `isWordPage(lower)` → `env.ASSETS.fetch(${origin}/{lang}/word/${lower}.html)`; else a **localized** friendly 404 (string table keyed by lang). **Whole-page English fallback (D8):** if the localized asset is a MISS (Spanish batch hasn't reached this word), `302 → /word/<lower>` (English canonical) rather than a wasteful locale 404. When the file later lands, assets-first wins and the redirect stops firing — no worker change, no cache purge.
  - `/{lang}/words` → `env.ASSETS.fetch(${origin}/{lang}/words.html)`.
  - `/{lang}/today` → `302 /{lang}/word/<slug>` (same `wordOfTheDay`).
  - `/{lang}/llms.txt` + `/{lang}/llms-full.txt` → served assets-first from `public/${lang}/llms.txt`.
- `/en/...` → `301` to the un-prefixed English URL (en never appears as a prefix).
- Unknown leading segment that looks like a lang but isn't one of the twelve → `404`.
- OG route `/word/og/<key>.png` is unchanged in mechanism; the key now may be `<lang>/<slug>.png` (D10) — the route just fetches whatever key the page's `og:image` points at from `env.OG`.

### `<html lang>` + `dir`, canonical, hreflang, switcher
- `renderWordPage` gains `lang` + `dir` (from `langByCode`): emits `<html lang="${lang}" dir="${dir}">`. Same for `words.html`.
- **Self-referential canonical per locale (D7):** `canonical = ${origin}${lang==="en"?"":"/"+lang}/word/${slug}`. Never point a locale canonical at English.
- **Full reciprocal hreflang cluster + `x-default`→English**, emitted from `availableLangs[word]` (the build holds all 12 maps), absolute URLs only, identical in `<head>` and sitemap:

```html
<link rel="canonical" href="https://wordul.com/es/word/ocean">
<link rel="alternate" hreflang="x-default" href="https://wordul.com/word/ocean">
<link rel="alternate" hreflang="en"        href="https://wordul.com/word/ocean">
<link rel="alternate" hreflang="es"        href="https://wordul.com/es/word/ocean">
<link rel="alternate" hreflang="ja"        href="https://wordul.com/ja/word/ocean">
<!-- …one per AVAILABLE language for this word… -->
```

- **Language switcher** `<nav class="wp-langs">` in the footer, server-rendered into every static page (crawlable, JS-free), listing the native names from `LANGS`, each linking to that language's URL for the **same word** (identical hrefs to the hreflang cluster), current language `aria-current="page"`, built from `availableLangs` (only shows existing locales), `dir`-aware.
- JSON-LD: add `"inLanguage": lang` to `WebPage`/`DefinedTerm` nodes.

### Detection / redirect (D14)
- Never auto-redirect an already-correct URL; never redirect crawlers.
- On a bare `/word/<slug>` first browser visit (no `lang` cookie, UA not a bot), the worker may inject a one-time dismissible suggestion **banner** ("Ver en Español?") via `HTMLRewriter` (the same mechanism as profile/room meta) — a link, **not** a redirect. Sticky via `lang` cookie + `localStorage`, written by the switcher. Bots and any request with the `lang` cookie skip the banner.

### RTL, CJK typography, locale formatting

**RTL (`ar`).**
- `<html dir="rtl">`. `word-page.css` uses **logical properties** throughout `.wp*` rules (`margin-inline-start`, `padding-inline`, `text-align: start`, `inset-inline-*`) so one stylesheet serves both directions — no `*-rtl.css`. A short `[dir="rtl"]` block flips only physical bits (breadcrumb separator, `::before` arrows: `→`↔`←` via content swap).
- **Letter tiles + headword stay LTR** (English word): `<div class="wp-tiles" dir="ltr">`. Same for slug, anagrams, any embedded English token (`<bdi>` around each English token so bidi doesn't scramble them).
- OG card for `ar`: tagline right-aligned, `direction="rtl"`; the English tiles row unchanged.

**CJK (`zh-Hans`, `ja`, `ko`).**
- No inter-word spaces → `lang`-conditional CSS: `word-break: normal; line-break: strict; overflow-wrap: anywhere;` and `:lang(zh-Hans), :lang(ja), :lang(ko) { line-height: 1.8; }`. A `cjk` flag on the `LANGS` entry drives a `class="wp wp-cjk"` body class (explicit CSS hook).
- **Font stack per script via `:lang()`** (no web-font download — system CJK fonts are excellent): `"PingFang SC","Noto Sans SC"` for `zh-Hans`; `"Hiragino Kaku Gothic ProN","Noto Sans JP"` for `ja`; `"Apple SD Gothic Neo","Noto Sans KR"` for `ko`; `"Noto Sans Devanagari"` fallback for `hi`; `"Noto Naskh Arabic"` for `ar`. Latin locales keep the current system stack.
- Embedded English tokens get `<bdi>`/`dir="ltr"` + a Latin font (no CJK glyph variants).
- **OG card (flagged blocker, D-Open-Q6):** resvg has no system fonts → bundle Noto Sans CJK + Noto Naskh Arabic + Noto Devanagari subsets in `scripts/lib/fonts/`, load via resvg `font.fontFiles` / `loadSystemFonts:false`. `ogCardSvg` gains a `lang` param to pick `font-family` + `direction`; tiles-only (no tagline) is the fallback if bundling is rejected.

**Locale-aware numbers & stats.**
- Static FAQ/meta numbers (`5 letters`, `2 syllables`) are build-generated: format with `Intl.NumberFormat(lang)`; pull surrounding sentences from a per-lang **UI string table** `scripts/lib/ui-strings/<lang>.js` (short fixed strings: `"letters"`, `"syllables"`, `"Did you know?"`, `"Word origin"`, `"Anagrams"`, `"Change one letter"`, `"Same start"`, `"How players do"`, the FAQ question templates, the play CTA, the stats placeholder). The table handles pluralization (no plural-`s` logic for languages without it).
- Dynamic stats in `word-page.js`: reads `document.documentElement.lang`, loads a tiny per-lang format pack + `Intl.NumberFormat(lang)` (percent via `{style:"percent"}`), renders e.g. `回数 12 · 正答率 45% · 平均 4.2 回` for `ja`. The numbers are language-invariant (same DO; stats are about the English word); only formatting + labels localize.

## Generation architecture (Opus teams)

### The hard numbers
| Constraint | Value | Consequence |
|---|---|---|
| Host cores | 12 | concurrency cap = `min(16, cores−2)` = **10 concurrent agents** |
| Per-run agent lifetime | **1000 agents / run** | one run cannot touch all 27,780 localizations |
| Source cards | 2,315 EN | Phase 1 |
| Localizations | 2,315 × 11 = 25,465 | Phase 2 (EN is the source, not re-translated) |
| Total rich cards | **27,780** | full corpus |

The 10-concurrent cap is a **throughput** limit (the scheduler queues — never blocks correctness). The **1000/run** cap is a **hard lifetime** limit forcing multiple runs. Lever: **batch size B = words per generator agent.** One agent generates a full card for B words, validates its own JSON against the schema, and `Write`s the results. Verifiers are separate agents. Per run: generators + judges + 1 merge agent ≤ 1000.

### Topology — two phases, gated

```
PHASE 1  EN SOURCE
  pipeline:
    parallel(generate EN card) → parallel(adversarial verify) → loop-until-quality → merge
                                                                                       │
                                                gate: 100% EN cards VERIFIED ──────────┘
                                                                                       ▼
PHASE 2  LOCALIZE  (only against verified EN; one fan-out per target language)
  for lang in [es, fr, de, pt, ru, id, ja, ko, zh-Hans, hi, ar]:
    pipeline:
      parallel(localize: translate factual + RE-ORIGINATE creative) → parallel(verify) → loop → merge
```

Phase 2 consumes Phase 1's verified output as its **input payload** — a translator is handed an already-true EN card so it never re-derives a fact or invents a quote. Workflow primitives: `pipeline` (generate→verify) wrapped in a `phase` gate, `parallel` fan-out inside each stage, `loop` (loop-until-quality) on the verify→regenerate edge. **Phase 1 must fully complete and be human-spot-checked before Phase 2 fans out** — translating an unverified fact 11× multiplies the error. English is the gate.

### Runs & chunking (inside 1000/run)
- **B = 25 words/generator agent** (Opus 4.8 comfortably produces 25 rich cards/localizations per session; beyond ~25–30 per-card attention degrades and reject rate climbs). **B_verify = 50** (verification is cheaper). Each generator gets a paired verifier in the same run.
- **Phase 1 (EN, 2,315):** ⌈2315/25⌉ = **93** generators + ~47 verifiers + 1 merge ≈ **141 agents → one run.** Drains in ~14 generator waves at concurrency 10.
- **Phase 2 (11 langs × 2,315):** per language ≈ 93 localizers + 47 verifiers + 1 merge ≈ **141 agents → one run per language → 11 runs.** Languages are independent; several can be in flight (separate runs; only the within-run 10-concurrent cap binds each).
- **Total: 12 runs, ~141 agents each, ~1,692 agents.** Optional packing: 2 langs/run (~282 agents, still <1000) → 7 runs. One-lang-per-run is cleaner for resumability and isolates a bad language run.

### Adversarial verification (refute-by-default)
Independent Opus 4.8 judge agents — a different model *instance* with a different system prompt and **no shared context** — see only the generator's output and assume the claim is wrong until proven right. Four narrow specialists run in `parallel` per card:

| Judge | Checks | Verdict logic |
|---|---|---|
| **(a) Quote** | Is `quote` real + correctly attributed to `author`? Independently recall the source. | **Default REFUTE.** Any doubt → `quote`/`author` **blanked** (mirrors existing "drop if unsure" + local hard-blank). |
| **(b) Fact** | Is each fact literally true? No "only/first/most/largest" superlatives unless certain. `confidence < 0.9 ⇒ drop`. | Default REFUTE → **regenerate** the fact (loop, N=2), else blank to a safe def-derived line. |
| **(c) Translation** (Phase 2) | Does localized factual text preserve EN meaning exactly (def/senses/etymology/facts/quote-translation)? Round-trip back-translation. | Default REFUTE on drift, mistranslation, or a quote rendered as if originally said in the target language → **regenerate** that field. |
| **(d) Creative "does it land?"** | Poem original (similarity check vs known corpora), joke genuinely funny + pun actually works in *this* language, mnemonic aids recall, lesson non-trivial, culturally safe + about the right concept. | Default REFUTE for groan-only/doggerel/borrowed → **regenerate** creative block (loop, N=3) **or return `null`** (honest omit). |

**Loop-until-quality:** the verify stage emits per-field verdicts; `loop` re-dispatches only the **failed fields** to a fresh generator agent (new seed, the judge's reason attached as a constraint). A field failing N times is **blanked, not shipped** — and because `renderWordPage()` already omits empty optional sections and `writeIntel()` only emits non-empty fields, a blanked field degrades to the existing minimal card. The merge step writes only fields carrying a VERIFIED stamp — **nothing fabricated reaches a public page.** A failed verification is logged with word + field + reason to `intel/<lang>.rejects.json` (a sidecar) so a human can spot systematic gaps ("Korean has no pun for 40% of words" is a signal, not a bug).

### Schema validation + payloads
Every agent returns the exact schema (D5), **schema-validated** by the Workflow `schema` primitive before acceptance (a malformed agent is auto-retried, never merged). Payloads stay tiny: Phase-1 agents receive **only a word list**; Phase-2 agents receive **only the verified EN card + target lang** — never the whole corpus.

### Resumability + persistence (filesystem reality)
**Workflow scripts have no filesystem access — agents do, via `Write`/`Bash`.** So:
1. **Staging dir** (gitignored): each agent writes one file per word per language — `/Users/theoutsider/wordul-wiki/.intel-staging/<lang>/<slug>.json`. One word = one file = atomic, idempotent unit.
2. **Verifier writes a sibling stamp** `…/<slug>.verified.json` only when all four judges pass (or a field is deliberately blanked). The merge step trusts **only** stamped files.
3. **Merge agent** (one per run) runs a Node script extending `writeIntel()`: globs the staging dir, takes only verified entries, emits `public/data/word-intel.js` (en, unchanged shape, drop-in) and `public/data/intel/<lang>.js` (one per language, same `WORD_INTEL` + `wordIntel()` export contract, sorted-by-key, header/footer preserved, `_prov` kept, `wordIntel()` footer only on `en`).
4. **Resume = skip.** On any re-run the orchestrator computes `todo = answerWords() − exclusions() − {slugs with a .verified.json on disk}` (the existing merge-never-overwrite pattern, lifted to per-file granularity). A crashed run loses at most the in-flight 25-word batch.

### Scale magnitude
~1,692 agents across 12 runs (or ~7 if 2 langs/run); **~150k–170k Opus 4.8 calls** end-to-end (27,780 generations + ~4× adversarial verification + ~15–25% regeneration overhead), dominated by *refuting*, which is the point. Token cost is explicitly **not** a constraint per the directive (confirm $ ceiling — Open Q4). Wall-clock is gated by the 10-concurrent cap, not corpus size: each 141-agent run drains in ~14+ waves; 12 runs sequenced (some parallel) finish in a bounded number of waves.

## Page rendering & worker changes

### `renderWordPage` (in `/Users/theoutsider/wordul-wiki/scripts/lib/word-page.mjs`)
New signature: `renderWordPage(word, intel, graph, origin, { lang, dir, availableLangs, strings })`.
- `<html lang="${lang}" dir="${dir}">`.
- **Self-canonical** per locale + full **hreflang cluster** + `x-default` (from `availableLangs[word]`, absolute URLs).
- **`links()` helper prefixed per locale** — anagram/ladder/same-start links point to `/${lang}/word/<neighbor>` (never cross into English). Section headings localized from `strings` (`relBlock(label,…)` already takes a `label`). Anchor text stays the word itself (language-neutral letters).
- **New guarded sections** (each omits on falsy/blanked): `senses[]` (a definitions list), `facts[]` (list, replacing single-fact when present), `poem` (form-aware rendering, RTL/CJK-safe), `jokes[]`, `lesson`, `mnemonic`, pronunciation line from `ipa`. Legacy single `fact`/`quote`/`etymology` still render exactly as today when rich fields are absent.
- **Localized FAQ — 5 Q&As** (questions in natural local interrogative form, generated by the locale team, NOT string-substituted English):
  1. *"What does WORD mean?"* → the crisp `def` (snippet target).
  2. *"Is WORD a valid Wordle word?"* (existing mechanical).
  3. *"How many letters / syllables?"* (existing mechanical, `Intl.NumberFormat`).
  4. *"Where does WORD come from?"* → localized `etymology` (high-volume "origin of word X" query class).
  5. *"What can WORD teach us?"* → the `lesson` (owns a long-tail reflective query with zero competition).
  Each: direct-answer `<h2>`/`<summary>` + ≤320-char answer. `FAQPage` `mainEntity` grows to match.
- **JSON-LD per page, single-language** (avoid mixed-language structured-data warnings): localize each node + `inLanguage`; give `DefinedTerm` a stable `@id` (`#term`); add a `CreativeWork` node for the original poem (`@id #poem`, `genre:"Poetry"`, `creator:{Organization Wordul}`, `isPartOf` the WebPage, `about` the `#term`); add a `Quotation` node for the verified quote (`creator` = attributed author, `isBasedOn` the source if known) — only when `quoteRef.verified`. **Rule: only emit structured data an engine would cite — definition, FAQ, poem, quote.** Jokes/mnemonic/lesson stay rich HTML prose. Etymology stays prose inside `DefinedTerm` (no fabricated Wiktionary links). Lesson also folds into the `FAQPage` (Q5) for AEO.
- **`<nav class="wp-langs">` switcher** (server-rendered, `dir`-aware, `aria-current`).
- `og:image` → `${origin}/word/og/${lang==="en"?"":lang+"/"}${slug}.png`; add `og:image:alt` + `twitter:image:alt` (localized, e.g. `"OCÉANO en tiles de Wordul — océano: gran masa de agua salada."`), `og:locale` (`es_ES`, `ja_JP`, …) + `og:locale:alternate` for the other 11; meta description = localized `def` (slice 155).

### `gen-word-pages.mjs` (`/Users/theoutsider/wordul-wiki/scripts/gen-word-pages.mjs`)
- Outer loop over `LANGS`. For each lang: import that intel file (`intel/<lang>.js`; `en` via `word-intel.js`) + the **shared English** word graph; write `public/${lang==="en"?"":lang+"/"}word/<slug>.html`; build `public/${lang}/words.html` (per-locale `<html lang>`/`canonical`/hreflang); write OG to `dist/og/${lang==="en"?"":lang+"/"}<slug>.png`; pass `lang`/`dir`/`availableLangs`/`strings` into `renderWordPage`. English output paths unchanged.

### `og-card.mjs` (`/Users/theoutsider/wordul-wiki/scripts/lib/og-card.mjs`)
- `ogCardSvg(word, def, { lang, dir })`. Localized `def` tagline; bundled CJK/Arabic/Devanagari fonts via resvg `font.fontFiles`/`loadSystemFonts:false`; `direction="rtl"` + right-align for `ar`. Tiles stay English. `upload-og.mjs` (16-way) uploads `dist/og/<lang>/<slug>.png` to `wordul-og` under key `og/<lang>/<slug>.png` (English keeps `og/<slug>.png`).

### `worker.ts` (`/Users/theoutsider/wordul-wiki/src/worker.ts`)
- `LANG_RE` dispatch (above), localized 404 string table, whole-page English fallback redirect (D8), the optional suggestion banner (D14), `/en/...`→301 unprefixed.
- OG route accepts `<lang>/<slug>.png` keys.
- **Sitemap index split** (see Discovery & SEO).

### `word-page.css` / `word-page.js`
- CSS: logical properties throughout `.wp*`; `[dir="rtl"]` physical-flip block; `:lang()` font stacks (CJK/Devanagari/Arabic); `wp-cjk` line-height; `.wp-langs` switcher styling.
- JS: per-lang stats format pack (reads `documentElement.lang`, `Intl.NumberFormat`, localized labels + placeholder).

## Discovery & SEO

### Duplicate-content defense (the core risk at 12×)
Failure mode: 12 near-identical pages per word trigger thin/duplicate suppression, or Google folds 11 locales into the English canonical. Three layers:
- **(a) Genuinely distinct content** — the poem is *original per language*, jokes/puns are *language-native* (regenerated), etymology traces the target-language word's origin. This is what makes 27,780 pages defensible. The verification team includes a **"translationese" reject gate**: any locale page whose poem/jokes/lesson reads as a literal English translation is bounced to regeneration.
- **(b) Self-referential canonical per locale** (D7) — never point a locale canonical at English.
- **(c) Reciprocal hreflang cluster + `x-default` on every page** (D7), absolute URLs, reciprocity structural (one shared `LANGS` array). A failed locale cell does NOT ship a partial cluster with a missing hreflang: the hreflang points only at *shipped* locales (from `availableLangs`), and hreflang never points at a 404. Whole-page English fallback (D8) covers the gap until the cell lands.

### Sitemap index + per-language sitemaps (D11)
New routes in `worker.ts` (replacing the single `/sitemap.xml` urlset):

| Route | Contents |
|---|---|
| `/sitemap.xml` | **Sitemap index** — links the children below. (robots.txt unchanged; crawlers follow the index.) |
| `/sitemap-core.xml` | `/`, `/words` (+ 12 localized index pages), `/@user` + `/@room` from `DIRECTORY` KV (today's dynamic part); shorter TTL since KV changes. |
| `/sitemap-words-en.xml` | English `/word/<slug>` lines, each with the full `xhtml:link` hreflang cluster. |
| `/sitemap-words-<lang>.xml` | localized `/<lang>/word/<slug>` lines (×11), filtered to words that exist in `intel/<lang>.js` (don't list a page that fell back to English), each with the hreflang cluster. |

Each ≤ ~2,317 URLs (well under 50K). Word sitemaps embed sitemap-level hreflang (`xmlns:xhtml`, `<xhtml:link rel="alternate" hreflang="…" href="…"/>` per available lang) — belt-and-suspenders with the in-`<head>` tags; the build emits the identical cluster in both (they must agree). Add `cache-control: public, max-age=3600` to the deterministic word sitemaps; lean on edge cache.

### JSON-LD per language
Covered in *Page rendering*: localized single-language `@graph` + `inLanguage`; stable `#term` `@id`; new `CreativeWork`(poem) + `Quotation`(quote) nodes; FAQ grows to 5; only cite-worthy artifacts get structured data.

### AEO — Q&A shaping per language
The localized 5-Q&A FAQ (above), with questions in real local interrogative form (`¿Qué significa…?`, `「海」の意味は？`) generated by the locale team — not translated English templates. Direct-answer headings, ≤320-char answers, snippet sweet spot.

### AIO / GEO — citation-worthy authority
- **`llms.txt` per language.** English root `/llms.txt` gains a **Languages** section (the localized URL pattern `/{lang}/word/<word>`, the 12 codes, the page-language≠puzzle-language invariant) so an AI summarizes the site correctly. Each non-English language gets `public/${lang}/llms.txt` (+ optional `llms-full.txt`) describing that locale's wiki tree, URL pattern, and its sitemap (`/sitemap-words-<lang>.xml`) — short, native-language, routed assets-first. `llms-full.txt` describes the page *shape* (def, multiple senses, etymology, true fact, original poem, lesson, quote, mnemonic, related words, live stats) so a crawler knows it's a dense, citable artifact.
- **Quotable structure:** each section leads with one self-contained quotable sentence; the original poem is inherently quotable and unique to us — a magnet for "poem about X" AI queries in all 12 languages.
- **Authority via verification, surfaced publicly:** a short footer line ("Facts and quotes adversarially verified") + a localized `/methodology` page describing the multi-agent verification — GEO gold (a unique, citable perspective on data reliability).
- **GEO moat:** 12 independently authored (not translated) artifact sets per word = ~27,780 genuinely non-duplicative structured verified pages — the durable advantage competitors can't cheaply copy.

### Internal link graph
- **Same-language related links** — anagram/ladder/same-start point to `/${lang}/word/<neighbor>`, keeping each locale a fully-navigable closed graph (crawl depth + within-locale PageRank).
- **Cross-language links = the hreflang cluster + the visible `<nav class="wp-langs">` switcher** — a real crawlable link from every page to its 11 siblings; a new locale page is linked from 11 siblings day one (never orphaned).
- **Index pages as hubs** — `/words` + `/<lang>/words` (A–Z), each linking its localized word pages and carrying its own hreflang cluster. Their `<html lang>` + `canonical` parameterized per locale in `gen-word-pages.mjs`.
- **Anchor-text localization** — heading labels localize from the UI string table; anchor text stays the word itself.

### VEO — localized OG cards + alt text
- One card per word per locale, localized `def` tagline, key `og/<lang>/<slug>.png` (D10); tiles stay English-alphabet. CJK/Arabic/Devanagari fonts bundled into resvg (Open Q6). `og:image:alt` + `twitter:image:alt` localized; `og:locale` + `og:locale:alternate` (the social-graph hreflang).

## Data model & storage

- **English source of truth, game-imported:** `/Users/theoutsider/wordul-wiki/public/data/word-intel.js` — stays at this exact path (the game imports it at `app.js:15`), upgraded to `schemaVersion: 2`, legacy top-level fields auto-derived from its own LOC (alias view). `wordIntel()` footer lives only here.
- **Eleven rich localized files:** `/Users/theoutsider/wordul-wiki/public/data/intel/<lang>.js` — same ES-module shape (uppercase keys, sorted, header + footer, merge-don't-overwrite serializer), each holding `INTEL[WORD]` for that language plus the mirrored identity fields. `_prov` kept in-file (stripped from page payload).
- **Uniform loader:** thin `/Users/theoutsider/wordul-wiki/public/data/intel/en.js` re-exports `../word-intel.js`, so `gen-word-pages.mjs` treats all 12 uniformly via a new `intelFor(lang, word)` loader. `wordIntel(word)` keeps its `en`-only signature for the game.
- **Runtime vs rich split (D13):** the game needs only `def/fact/quote/author` (English). The word page is static HTML — rich content baked at build, no client intel fetch for the page body in any language. Optional future nice-to-have: emit small per-lang `intel/<lang>.json` (def/fact/quote only) for the end-card to lazy-`fetch()` by the user's chosen game language — additive, not part of the page pipeline.
- **Staging tree (build-time, gitignored):** `/Users/theoutsider/wordul-wiki/.intel-staging/<lang>/<slug>.json` + `.verified.json` stamps + `intel/<lang>.rejects.json` sidecar.
- **Generator extension:** `gen-word-intel.mjs` gains `--lang <code>` (default `en`). For `en`: behaves as today + new rich fields. For non-`en`: loads the **verified** `en` entry as grounding, runs the translation + re-origination roles (separate agents), writes `intel/<lang>.js` with the same `writeIntel()` serializer (extended to emit arrays `senses`/`facts`/`jokes` and the new string fields, still sorted, merge-safe, persist-after-each-word).
- **Storage scale:** ~27.8k committed HTML (~330 MB at ~12 KB/page) under `public/` (D12); 27,780 OG PNGs in `wordul-og` R2; 12 intel ES modules; 12 sitemap children; 12 `llms.txt`. R2 HTML-offload is the escape hatch if the repo gets heavy.

## Edge cases

- **Word missing in a locale (cell not yet generated):** worker `302 → /word/<slug>` (English canonical, D8). English page's hreflang doesn't list that locale. When the file lands, assets-first wins and the redirect stops — no worker change, no purge.
- **Verified facts but unverified quote:** render facts, omit the quote everywhere (`quoteRef.verified=false` ⇒ dropped from all 12). No "maybe-real" quote ever.
- **A creative field that won't land in a language:** agent returns `null` + reason; renderer omits the block; degrades to the factual layer. No cross-language borrow.
- **English word with no real second sense:** `senses[]` has one entry; that's correct, not a gap.
- **Quote whose original language ∈ our 12:** show the original on that locale's page (a Goethe line on `/de/`), English + gloss elsewhere. Author transliterated (`ja/ko/zh-Hans/hi/ar/ru`), never re-attributed.
- **`/en/word/<slug>`:** `301 →` un-prefixed English (en never appears as a prefix).
- **Top-level paths that look like a lang** (`/@user`, `/designs`, `/ws`, `/r`): `LANG_RE` matches only when segment ∈ `langByCode && ≠ en`, so these are never mistaken for a locale.
- **Trailing slash / uppercase in `/{lang}/word/<RAW>`:** mirror the existing lowercase 301 within the locale prefix.
- **RTL page with embedded English tokens:** `<bdi>` + `dir="ltr"` per token so bidi reordering doesn't scramble the headword/anagrams.
- **CJK OG tagline with no bundled font:** fall back to a tiles-only card (no tagline) rather than dropped glyphs (Open Q6).
- **`difficulty` vs live `solveRate` disagree:** `difficulty` is editorial, never shown as a measured stat; the live-stats panel is the only "measured" surface.
- **Bots vs humans for the suggestion banner:** UA match + `lang` cookie both skip the banner; canonical URLs stay stable for crawlers.
- **`WORD_EXCLUSIONS` (profanity) applies across all 12 locales:** `isWordPage` gates every locale identically (single source of truth); an excluded word has no page in any language and is absent from every sitemap.
- **Bots never move public stats:** unchanged — `finishGame()` already filters `!p.isBot`; the multilingual layer doesn't touch the stats path.
- **`wordOfTheDay` is editorial and locale-invariant:** `/{lang}/today` redirects to the same word's localized page.

## Phased build sequence

Each phase is independently shippable and leaves the site in a working state.

**Phase 0 — Foundation completion (English only, no multilingual).** Fill `WORD_EXCLUSIONS` (profanity pass). Run the existing `gen-word-intel.mjs` (cloud) to populate all 2,315 English entries at the *current* 7-field schema. Run `wiki:pages` + `wiki:og` + deploy. *Ships: the existing single-language wiki, fully populated for the first time.* (Closes the foundation gaps: `public/word/*.html`, `public/words.html`, populated `word-intel.js`.)

**Phase 1 — Schema v2 + English legendary content.** Add `scripts/lib/langs.mjs`, `scripts/lib/ui-strings/en.js`. Extend the schema to `schemaVersion: 2` (identity + LOC fields, `_prov`, `verified`). Build the Phase-1 generation run (93 generators + verifiers + merge) with the four adversarial judges and per-file staging. Extend `renderWordPage` with the new guarded sections (senses/facts/poem/jokes/lesson/mnemonic/ipa), the 5-Q&A FAQ, the `CreativeWork`+`Quotation` JSON-LD nodes. Regenerate English pages + OG. *Ships: the full legendary card in English — the flagship before any translation.* English `<head>` already self-canonicals (no hreflang yet, single language). Human spot-check is the gate to Phase 2.

**Phase 2 — Routing + i18n plumbing (no localized content yet).** Add `LANG_RE` dispatch, `/{lang}/...` routes, whole-page English fallback, `/en/...`→301, sitemap-index split, OG `<lang>/<slug>.png` keys, logical-property CSS + `:lang()` font stacks, the `word-page.js` format pack, `og-card.mjs` `lang` param + bundled fonts. Parameterize `renderWordPage`/`gen-word-pages.mjs` with `lang`/`dir`/`availableLangs`/`strings`. With only `en` content present, `availableLangs` lists just `en`, so hreflang/switcher are inert but correct. *Ships: the multilingual chassis, still English-only content, zero regression.*

**Phase 3 — First localized language (`es`), end to end.** Add `ui-strings/es.js`. Run the `es` localization workflow (translate factual + re-originate creative + translation/native-fluency/creative judges) → `intel/es.js`. Generate `public/es/...` pages + OG + `es/llms.txt` + `sitemap-words-es.xml`. English pages now list `es` in hreflang/switcher for covered words. *Ships: the first fully-localized locale — proves the whole pipeline (translation, re-origination, RTL/CJK not yet, hreflang reciprocity, sitemap, OG, switcher) on one language.*

**Phase 4 — Script-diversity locales (`ar` RTL, `zh-Hans`/`ja`/`ko` CJK, `hi` Devanagari, `ru` Cyrillic).** Validate logical-property CSS in RTL, `<bdi>` English tokens, CJK line-break + leading, bundled OG fonts, per-script font stacks. One language per run. *Ships incrementally per language as each lands; each is independently deployable.*

**Phase 5 — Remaining Latin locales (`fr`, `de`, `pt`, `id`) + full corpus completion.** Run the remaining localization workflows. Add per-language `llms.txt`/`llms-full.txt`, the localized `/methodology` page, the public "adversarially verified" footer line. Confirm all 12 sitemap children + the index + reciprocal hreflang across the full set. *Ships: the complete 12-language legendary wiki.*

**Phase 6 — Polish + optional.** Optional `intel/<lang>.json` end-card lazy-load by game language; reconcile `difficulty` against accumulated `solveRate`; R2 HTML-offload if the committed tree is too heavy (D12); pronunciation audio off `ipa`.

## Risks / notes

- **R1 — Quote fabrication (highest blast radius).** The classic "Einstein said…" failure ships a brand-ending falsehood. Mitigation: `quoteRef.verified` gate + refute-by-default Quote judge + drop-if-unsure + never machine-translate-and-attribute. Quote is the field where "empty beats wrong" is most absolute.
- **R2 — Translationese collapsing into duplicate content.** If the creative layer leaks as literal translation, 12 pages become near-duplicates and SEO suppresses them. Mitigation: re-origination (not translation) + the translationese reject gate in verification.
- **R3 — CJK/Arabic/Devanagari OG fonts in resvg (flagged blocker, Open Q6).** resvg ships no system fonts; non-Latin taglines drop glyphs. Mitigation: bundle Noto subsets in `scripts/lib/fonts/`; fallback tiles-only card. Decide before Phase 4.
- **R4 — Committed static tree size (~330 MB, D12).** May strain the repo. Mitigation: R2 HTML-offload (like `/designs/*`), English-only in `public/`. Tractable, deferred to Phase 6 unless it bites earlier.
- **R5 — hreflang asymmetry / pointing at 404s.** Mitigation: `availableLangs` is the single source for both `<head>` and sitemap clusters; whole-page English fallback (D8) means a missing cell is a redirect, never a 404; reciprocity is structural.
- **R6 — Verification cost/throughput.** ~150k–170k Opus calls; the 10-concurrent cap bounds wall-clock per run. Mitigation: shard by language (independent runs), B=25 quality knob, resume-by-stamp so crashes cost ≤25 words. Confirm $ ceiling (Open Q4).
- **R7 — Cultural safety per locale.** A joke/poem that's fine in English may be offensive elsewhere. Mitigation: the native-fluency creative judge checks cultural safety + may return `null` ("culturally-inappropriate"); no cross-language borrow.
- **R8 — Schema drift breaking the game.** Mitigation: legacy top-level fields are a non-negotiable alias view; `wordIntel()` signature unchanged; `renderWordPage` degrades on every absent field. The game keeps importing only the small English file.
- **R9 — Phase ordering discipline.** Translating an unverified English fact 11× multiplies the error. Mitigation: Phase 1 (English) is a hard gate — fully verified + human-spot-checked before any Phase 2 fan-out.
- **Note — Tiered auto-merge:** content/copy/UI changes here are Tier C (auto-mergeable after the gauntlet); none touch money-path code. Migrations/CI/CLAUDE.md are out of scope for this feature.

---

*Relevant absolute paths (extend, don't rebuild):*
`/Users/theoutsider/wordul-wiki/public/data/word-intel.js` · new `/Users/theoutsider/wordul-wiki/public/data/intel/<lang>.js` + `intel/en.js` ·
`/Users/theoutsider/wordul-wiki/scripts/gen-word-intel.mjs` · `/Users/theoutsider/wordul-wiki/scripts/gen-word-pages.mjs` ·
`/Users/theoutsider/wordul-wiki/scripts/lib/word-page.mjs` · `/Users/theoutsider/wordul-wiki/scripts/lib/og-card.mjs` · `/Users/theoutsider/wordul-wiki/scripts/lib/words.mjs` · `/Users/theoutsider/wordul-wiki/scripts/lib/word-graph.mjs` ·
new `/Users/theoutsider/wordul-wiki/scripts/lib/langs.mjs` · new `/Users/theoutsider/wordul-wiki/scripts/lib/ui-strings/<lang>.js` · new `/Users/theoutsider/wordul-wiki/scripts/lib/fonts/` ·
`/Users/theoutsider/wordul-wiki/scripts/upload-og.mjs` ·
`/Users/theoutsider/wordul-wiki/src/worker.ts` · `/Users/theoutsider/wordul-wiki/src/words.ts` · `/Users/theoutsider/wordul-wiki/src/word-exclusions.ts` ·
`/Users/theoutsider/wordul-wiki/public/word-page.css` · `/Users/theoutsider/wordul-wiki/public/word-page.js` · `/Users/theoutsider/wordul-wiki/public/app.js` ·
`/Users/theoutsider/wordul-wiki/public/llms.txt` · `/Users/theoutsider/wordul-wiki/public/llms-full.txt` · `/Users/theoutsider/wordul-wiki/public/robots.txt` ·
staging `/Users/theoutsider/wordul-wiki/.intel-staging/<lang>/<slug>.json`
