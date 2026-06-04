# Legendary Word Wiki — Bonus Angles & Next-Level Enhancements

*Companion to `SPEC-legendary-multilingual-word-wiki.md`. Read that first. This document does **not** restate the spec — it hunts the missed angles, the low-hanging fruit, the 10x variants, the adjacent wins, and the edge cases the spec doesn't cover. Highest-leverage first.*

The spec is genuinely strong on content model, the page-language≠puzzle-language invariant, the verification gauntlet, routing, and SEO. The gaps are almost all in the layer **above** static pages: turning a one-shot artifact into a habit loop, a feedback flywheel, and a defensible AI-citation brand — plus a handful of edge cases that should change the spec before any generation run fires.

A grounding fact the spec under-uses: **this game already has the infrastructure for half of these.** `public/i18n.js` + `public/locales/en.js` is a live UI-translation engine. `public/voice.js` already does cloned-voice clips + `speechSynthesis` TTS fallback per edition (with `voice/<edition>/manifest.json`). There is an editions/theming system with a gold wallet (`public/edition.js`, `public/editions/*`), room modes (`src/modes.ts`, with `"longgame"|"challenge"` already hinted), and per-word stats Durable Objects (`src/wordstats-do.ts`). The wiki should *plug into* these, not stand beside them.

---

## THE SINGLE BIGGEST UNLOCK

**The solve-stats → content-priority flywheel, run as a daily cron, is the one feature that changes the project's economics — and the spec already has every input wired but never closes the loop.**

The spec treats generation as a batch you run once (Phase 0→5) and `solveRate` as a passive display stat that *might someday* reconcile `difficulty`. Invert it. The `WordStats` Durable Objects already record, per English answer word, real human `answered`/`solveRate`/`avgGuesses`. Make a scheduled worker emit a **ranked work queue**: words people actually hit (high `answered`) and words they *struggle* with (low `solveRate`, high `avgGuesses`) get the richest, first, and most-frequently-refreshed treatment; long-tail words people never see can wait or ship factual-only. This means:

- You don't generate 27,780 cards into the void hoping for traffic — you generate **toward demand you can already measure**, so the expensive Opus budget lands where humans and crawlers actually are.
- "Hard words" (low solve rate) are *exactly* the words a frustrated player searches for after losing — so the richest mnemonic + etymology + hint content meets peak intent. The end-of-game "Look it up" link (`app.js:2186`, already pointed at `/word/<w>`) is the highest-intent funnel you will ever have, and it's already built.
- It turns the wiki from a static asset into a **living system**: the game feeds the wiki which feeds the game. That's the moat — a competitor can scrape your pages but cannot scrape your demand signal.

Everything else on this list is leverage. This is the lever that decides whether the other 27,780 pages were worth generating.

---

## TIER 1 — Highest leverage (do these; they compound)

1. **Close the solve-stats → priority loop (above).** A `scripts/queue-priority.mjs` that reads the `WordStats` DOs (or a nightly KV rollup) and emits `intel/_priority.json` (words ranked by `answered × strugglescore`). The generation orchestrator consumes it as its `todo` ordering instead of alphabetical. Cheap to build, changes where every dollar of Opus budget lands.

2. **Audio is nearly free here — wire it, don't build it.** `public/voice.js` already wraps `speechSynthesis` with graceful fallback. A word page gains a "▶ pronounce" button next to the `ipa` line that calls `speechSynthesis.speak(new SpeechSynthesisUtterance(word))` with `utterance.lang = documentElement.lang` — zero new infra, works in 12 languages out of the box (browsers ship native TTS voices per locale). The **poem read aloud** is the same call on `poem.lines.join("\n")`. Ship the button in Phase 1 (English), localize the `lang` attribute in Phase 2. This is the cheapest "delight" multiplier in the whole project and the spec mentions audio nowhere. *(Pre-rendered Opus-TTS MP3s in R2 are the Phase-6 upgrade for quality; native TTS is the day-1 win.)*

3. **Word-of-the-day RSS/JSON feed per language — the AI-citation and retention substrate.** `wordOfTheDay(date)` already exists and is locale-invariant. Add `/feed.xml` (+ `/{lang}/feed.xml`) and `/feed.json` emitting the day's word with its def, one fact, the poem, and the localized URL. RSS is read by Feedly *and* by AI agents building daily digests; JSON Feed is trivially parseable by ChatGPT/Perplexity plugins. This is the lowest-effort path to becoming the *source* an AI quotes for "today's word." Pairs with a "Word of the Day" archive page (`/word-of-the-day`) that's a permanent crawl hub.

4. **The AI-citation moat needs a `dateModified` + canonical-fact-block contract, not just `llms.txt`.** The spec's `llms.txt` is necessary but not sufficient. To actually be the *quoted* source: (a) every fact and the etymology must sit in a single, self-contained, copy-pasteable sentence with the number/source inline (the spec's `factsMeta` already enforces this — surface it as a visible "cite this" block); (b) add `dateModified` to JSON-LD `WebPage` so freshness ranks you; (c) add a per-page `<link rel="canonical-fact" ...>`-style machine block or a tiny `/word/<slug>.json` endpoint serving the verified structured data so an agent can fetch facts without parsing HTML. Being *machine-fetchable* is what converts "indexed" into "cited."

5. **Spaced-repetition vocab loop, riding the existing gold economy.** A `/learn` mode (the spec only hints "learn mode"): a player builds a deck of words they lost on (auto-captured from game results), and the wiki serves a daily SM-2-style review using the **mnemonic + one sense + the poem** as the recall scaffold. Reward correct reviews with gold (the wallet exists in `edition.js`). This is the single strongest *retention* mechanic available — it gives a reason to return that isn't "play another round," and it makes the expensive mnemonics load-bearing instead of decorative.

6. **Quiz generated from the verified facts — auto-built, zero marginal content cost.** Each `factsMeta` entry is already a structured `{claim, number, person, year}`. That's a fill-in-the-blank or multiple-choice question for free (the number becomes the answer, sibling words' numbers become distractors). A `/word/<slug>` "Test yourself" `<details>` and a daily mixed quiz both fall out of data you're already generating + verifying. Learning loop + dwell time + a shareable score, at ~zero extra generation.

---

## TIER 2 — Strong adjacent wins

7. **Shareable, localized poem/quote cards (a second OG variant) — the virality engine.** The OG pipeline already renders 1200×630 PNGs per word per locale. Add a *second* card template per word: a beautiful typeset **poem card** (and a **quote card**) with a "share" button on the page that deep-links to `og/<lang>/<slug>-poem.png`. The original poem is the most genuinely shareable artifact you own (a fact is forgettable; an original haiku about LIGHT in Japanese is screenshot-worthy). "Share your favorite sense / pun" buttons turn passive readers into distributors. This is the highest ceiling on free traffic and the spec only mentions OG cards as SEO, never as a share-loop.

8. **Word constellations — browsable etymology/anagram families as a feature, not just internal links.** The spec builds the anagram/ladder/shared-start graph purely for SEO crosslinks. Expose it as a *destination*: `/constellation/<root>` pages grouping words by shared PIE/Latin/Greek root (the `etymology` data already carries this), and an interactive (or static SVG) "word map." This is uniquely citable GEO content ("words derived from Latin *aqua*"), genuinely delightful, and creates exactly the kind of unique structured artifact AI overviews love. The **threaded poem** variant (one poem that weaves an etymology family together) is a stunning hero piece for a constellation page.

9. **Community UGC layer — user poems/jokes with voting + a per-word "best pun" leaderboard.** Durable Objects already do per-word atomic read-modify-write (`wordstats-do.ts` is the exact pattern). A `WordUGC` DO per word stores submitted puns/poems + upvotes. This is a content flywheel that *scales past* what even 1000 Opus agents can author, and a per-word "Hall of Fame" gives the humanistic buyer ("who else does this?") social proof the spec's copy currently lacks entirely. **Critical guardrail the spec must inherit:** UGC needs the same adversarial safety gate (slur/abuse filter) *plus* a human-in-the-loop publish queue, or it becomes a spam/abuse vector across 12 cultures simultaneously.

10. **Daily "word in current events" poem — the crazy-but-cheap variant.** A single scheduled Opus agent each day writes ONE new poem that threads the day's word into a (verifiable, neutral) current-events hook, posted to the word-of-the-day page + feed + social cards. One agent/day ≈ trivial cost, but it's the thing that makes the site feel *alive* and gives press/social a reason to link. Keep it strictly apolitical and run it through the same creative+safety judge.

11. **Game integration: "learn mode" + themed editions feed FROM the wiki.** The editions system (`public/editions/`) is a theming layer; the wiki's `tags[]` are a ready-made theming taxonomy. A "Nature words" or "Science words" edition is just a tag filter over the answer pool. And in-game **hints** can pull from the verified `mnemonic`/`senses` (a paid gold hint reveals the mnemonic). The content you generate for SEO becomes in-game value — the spec keeps these worlds separate; merging them doubles the ROI on every card.

12. **Per-language newsletter / daily email.** Once the feed (#3) exists, a daily email is a thin layer (a worker cron + an email API + a `subscribers` KV/DO keyed by `{email, lang}`). "Your word today, in Español" is a durable retention + re-engagement channel and an owned audience independent of Google. Lower priority than the feed (email = compliance + deliverability overhead) but high lifetime value.

---

## TIER 3 — Polish, accessibility, brand, monetization

13. **Accessibility & dyslexia-friendly mode (cheap, on-brand, SEO-neutral-to-positive).** A `prefers-reduced-motion`-aware toggle for OpenDyslexic font + increased letter spacing + a "syllable view" that visually chunks the word (you already store `syllables`). RTL/CJK delight is in the spec's *typography* but not its *interaction*: add `lang`-aware quotation marks (「」 for ja, «» for ru/fr, „" for de) and locale-correct number formatting in prose, not just stats. These are small diffs with outsized "this site respects me" payoff for the humanistic buyer.

14. **Monetization that doesn't cheapen the artifact.** The print-poster idea is the best fit: **printable word-art posters** (the poem card at print DPI) as a paid download or print-on-demand — it monetizes the most beautiful asset without ads on the learning surface. A **public corpus API** (the `/word/<slug>.json` from #4, rate-limited, with a paid tier for bulk) monetizes the AI-citation moat directly. Avoid display ads on word pages — they nuke Core Web Vitals and the "citation-worthy authority" positioning simultaneously.

15. **Human-in-the-loop curation of the best art.** The verification pipeline is pass/fail; add one more signal: a lightweight `featured: true` flag a human (or an aggregate of UGC upvotes) sets on the best poem/joke per word. Featured artifacts get the share-card treatment and front-page rotation. The spec's flywheel is all machine; one human taste-gate on the *best* output is what separates "comprehensive" from "legendary."

16. **"Word of the day" + per-word social presence.** Auto-post the daily word's poem card to social via a scheduled worker. Re-uses the share-card (#7) and the daily-poem (#10). The spontaneous buyer ("why now?") is currently unaddressed by the spec — a daily ritual is the answer.

17. **A localized `/methodology` page that's genuinely citable.** The spec mentions this for GEO; push it further — publish the *aggregate verification stats* ("X facts verified, Y quotes dropped as unverifiable, Z creative fields honestly omitted"). Transparency-as-content is a uniquely AI-quotable, trust-building artifact, and the `rejects.json` sidecar already holds the raw numbers.

---

## EDGE CASES THE SPEC MISSES (some should change the spec before any run)

- **Slurs/offensive in ONE language but innocent in English — the spec's exclusion model is wrong here.** `WORD_EXCLUSIONS` is a single global list gating *all 12 locales identically* (spec edge-case section + `isWordPage`). But a 5-letter English answer word can be a vulgar slur or taboo term in another language while being perfectly fine in English. A global exclusion either over-censors English (drops a fine English page because it's rude in Hindi) or ships an offensive page in that one locale. **Change the spec:** exclusions must be **per-locale** — `EXCLUDED_EN` (the global profanity pass, removes the page everywhere) plus `EXCLUDED[lang]` (this word gets no page *in this locale only*; English + other locales unaffected; its hreflang cluster simply omits that lang). This cascades into `isWordPage`, `availableLangs`, and the sitemap — it must be decided before Phase 2.

- **Proper-noun and brand collisions.** Some 5-letter answer words are proper nouns / trademarks / place names (and the repo already scrubbed the literal "Wordle" trademark per commit `8873bb`). A factual "definition" of a brand name is a different (and legally touchier) artifact than a common-noun def. Flag a `kind: "proper"|"brand"` on the identity layer; for these, suppress the "real attributed quote about the word" (a quote *about* a brand is rarely what you want) and lean on etymology/usage instead.

- **Words with no good pun / no second sense / no real quote — the spec handles `null` but not the *cluster* effect.** A word like a dull function word may legitimately null out poem AND joke AND quote AND second-sense. The spec's per-field omit is correct, but a page that's *only* a def + one fact reads as thin/duplicate-risk at scale. **Add:** a minimum-richness floor — if a page falls below N populated rich fields, either (a) don't generate a localized variant at all (English-only is fine, fewer-but-richer beats thin-everywhere), or (b) guarantee the **etymology + 2 senses + 1 fact** factual floor before a page is allowed into the sitemap. Thin pages at 27,780× scale are the duplicate-content risk the spec's own R2 warns about.

- **Translation of culture-bound facts.** The spec translates `facts[]` faithfully — but some facts are culture-relative ("X is the most common baby name" / imperial-vs-metric / a US-centric reference). The Fact judge checks *truth*, not *cultural portability*. Add a `culturallyPortable: bool` to `factsMeta`: a non-portable fact is either localized-with-context or dropped for locales where it's meaningless. Otherwise you ship technically-true-but-confusing facts in 11 languages.

- **Quote translation availability will be a long tail, not an edge case.** The spec's "published translation, else original+gloss, else omit" is right, but at 2,315 words × 11 languages the *omit* branch will dominate for less-famous quotes — meaning most non-English pages may have **no quote at all**. That's acceptable (empty beats wrong) but it means the quote section can't be a layout anchor; the page design must look complete without it, and the FAQ's Q5 ("what can WORD teach us?") leaning on the *lesson* (re-originated, always present) is the right load-bearing choice — make that explicit.

- **Very long verification queues / a systematically failing language.** The spec logs rejects per-field but has no *circuit breaker*. If Korean puns fail at 60%, the loop burns Opus budget retrying. **Add:** a per-(lang,field) reject-rate monitor that, past a threshold, stops retrying and ships `null` (honest omit) for that field across the language — with a human alert. "This language can't sustain the creative layer at quality" is a decision, not a bug to grind on.

- **Stats privacy / low-N display.** A word played by 1–2 humans shows a `solveRate` that's noise (and near-deanonymizing in a small room). The spec shows stats once `!neverPlayed`; add a **minimum-N gate** (e.g. ≥5 games) before showing solveRate, falling back to "Be among the first to solve it."

- **OG share-card text-injection / RTL bidi in the *poem* card.** The spec handles `<bdi>` for the English headword in RTL page bodies, but the new poem/quote share cards (#7) render *localized creative text* — the same bidi and font-fallback hazards apply to multi-line poems in resvg, which is harder than a single tagline. Decide the poem-card font bundle alongside the tagline-card decision (Open Q6), not after.

---

## What I'd cut or de-prioritize

- **Full 12-language creative parity up front.** The spec's own Open Q2 leans tiered; commit to it. Ship **factual parity for 12, creative for the top ~5 by demand (#1's queue), backfill the rest from UGC (#9) where the machine nulls out.** The creative re-origination + native-fluency-judge path is the most expensive, highest-reject work; gate it on measured demand.
- **Email before feed.** Build RSS/JSON Feed (#3) first; it's the substrate email reads from and carries zero compliance burden.

---

*Net: the spec builds a magnificent static artifact. These angles turn it into a living, habit-forming, self-prioritizing, machine-citable system — mostly by wiring it into infrastructure (voice, i18n, editions, gold, per-word DOs) that already exists in the repo. The biggest unlock is the solve-stats priority loop; the cheapest delight is native-TTS audio; the highest-ceiling virality is the localized poem share-card; and the most important spec correction is per-locale (not global) word exclusions.*
