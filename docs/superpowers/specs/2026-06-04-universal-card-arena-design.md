# Universal Card Arena — Design Spec (v1)

**Date:** 2026-06-04 · **Revised:** 2026-06-05 (review pass — see *Revision log*)
**Status:** brainstorm approved → **revised after a 12-agent code-grounded review**; ready for implementation plan(s) once the owner confirms the flagged v1 defaults. Server/Durable-Object phases are **Sacred Stops** gated on Yan's go (see Build Phases). **Code-grounded** against worktree `card-arena-spec` (`origin/main`); grounding commit is **`07362e1`** (the parent of the doc commit `63c3229`). Re-confirm line-level shapes at implementation time.
**First consumer:** Wordul (`wordul.com`)
**Visual direction (locked, live prototype):** `https://wordul.com/designs/bot-studio-forge-bay`
⚠️ **Prototype source is NOT version-controlled** — it is served from the `DESIGNS` **R2 bucket** (`worker.ts:332-357`), not `public/`. `public/word/forge.html` is the unrelated SEO page for the *word* FORGE. Plan A must first **export the prototype from R2** (or reconstruct it); there is no checked-in file to "lift."

---

## Revision log (2026-06-05 review pass)

A 12-agent review verified **24 of 32** code-grounding claims exactly against the worktree source and surfaced one architectural blocker plus a cluster of scope/fairness fixes. This revision incorporates them. The biggest changes:

1. **Plan C re-architected.** The original "bot plays today's `daily/<date>`" is **impossible** — `ensureBots()` early-returns `if (this.state.isDaily)` (`room.ts:1003`, "no worduler in the daily room") and the daily room is a human singleton. Ranked play now runs in **per-bot isolated `card-daily/<date>/<botId>` rooms** that read today's word but are *not* `isDaily`. Un-farmable and human-isolated by construction.
2. **Pillar 3 split** into **C1** (per-day bot board, **display-only efficiency, no minting** — off the money path) and **C2** (durable bot gold + persisted all-time store + ELO-shaped rating — the real Sacred Stop). The old **P0a is absorbed into C2**; the wedge no longer requires a money-path change.
3. **Fairness promoted** from north-star to v1: **ledger idempotency-by-ref**, **per-owner emission cap**, **per-owner ranked-entry cap** (Sybil fix), and an honest correction of the "efficiency resists maxing" claim.
4. **D2 corrected** — *timing already exists* (`firstGuessAt`/`finishedAt`/`durationMs`); the real gap is per-guess **words** + persisting timing into `GameRecord`. P0b shrinks accordingly.
5. **Cheap 10x wins folded in:** shareable card PNG (Plan A), side-by-side card-vs-card comparison view (Plan B), in-house `env.AI` as the first "external" brain (Plan B), public JSON benchmark + `llms.txt` (Plan C1), ELO-shaped `rating` field from day one (C2).
6. **Open questions → flagged v1 defaults** (see end). Owner overrides anytime.

---

## Summary

Today Wordul has **bots** (`src/bots.ts`) that are **disguised as humans** to solve arena
liquidity — persistent characters driven by a deliberately blind solver
(`src/solver.ts`), stripped of `isBot` on the wire (`projectPlayerForClient`). This spec
turns that inside-out into a product:

> **The Card is the universal player identity.** Every competitor — bot or human — is one
> **Card** with the same axes. Bots get their **own segregated scoreboard**. Users **forge**
> bots in a studio, **summon** them to play, and (later) configure / buy add-ons / race them
> for gold across a universal arena with leagues and a championat.

The grand vision (external LLMs via MCP, ELO, leagues, seasons, economy) is **captured here as
the north star** but **explicitly deferred**. v1 ships the wedge: **the Forge + summon-and-watch
+ a segregated bot board + the human card** — on top of the prerequisites discovered in
code-grounding. See **Dependencies** and **Build Phases**.

### The one magic moment v1 must nail

> Open the **Forge** → tune your bot's chevron dials and watch its **card reforge** + stats
> react → in a solo game tap the subtle **`+`** → your bot **drops in, plays openly, and talks
> in its own voice** → **see its specs side-by-side with your *own* measured human card** →
> one tap **shares the card** → and (ranked lane) it lands on the **Bot Board**, walled off
> from humans.

Everything below exists to produce that moment. If a piece doesn't serve it, it's north-star.
The side-by-side **comparison view** and the **shareable card** are now v1, not deferred — they
are the payoff and the growth loop, and both are nearly free over the existing card render.

---

## Decisions locked this session

| Fork | Decision |
|------|----------|
| Who plays | **Universal arena** — house bots, user bots, *and* (later) external LLMs; leagues noob→elite; championat. |
| Match format | **Spec all**; v1 leans on existing modes — bot runs a **ranked `card-daily` lane** and is summoned into solo (playground). |
| Config depth | **Small strategy stack** — Opener · Brain · Risk + identity. At least one axis is **continuous** (see Pillar 1). Add-ons slot in later. |
| Play loop | v1 = **summon into your solo game via a subtle `+`**, watch it play + chat, **compare to your card**. Background "fleet + supervisor" = **deferred**. |
| Scoreboard | **Per-day segregated bot board in v1** (C1, display-only efficiency). Durable/all-time + gold + ELO = **C2 Sacred Stop**. |
| Visual direction | **Forge · Bay** — collectible card hero + Pit-Lane chevron telemetry. **No presets** (forge-from-scratch). |
| Human card | **Measured + cosmetic + "forge a bot from my style" bridge** (specs derived from real play, not editable). |

---

## The spine — the Card

A **Card** is the single identity object for any competitor. Same shape, same axes, whether
the brain behind it is silicon or flesh. The difference is how the specs get filled:

| | Specs come from | Editable? |
|---|---|---|
| 🤖 **Bot card (configured)** | **configured** — the Forge's chevron dials | yes, in the Forge |
| 🤖 **Bot card (measured)** | **measured** — an opaque/external brain (north-star LLM) reuses the *human* measurement pipeline | no |
| 🧑 **Human card** | **measured** — derived from real play | no (your play *is* the tuning); cosmetics only |

> **Two fill paths, not one.** A configured bot's stats are `f(spec)`. But an **external LLM
> brain has no dials** — its card must be *measured from play*, exactly like a human card. So bot
> stats have the **same two fill paths** as the spine table shows; planning must **not** hardcode
> `stats = f(spec)` for all bots. This keeps the north-star external-LLM card from breaking the model.

Because all three are drawn from the **same axes**, any two cards are **directly comparable** —
that is what makes the "universal arena" literal rather than a slogan. v1 **ships that
comparison as a real screen** (Plan B), not a future viewer.

### Card model (shape — names to be finalized in planning)

```ts
type CardSpec = {
  opener: string;                 // first guess, e.g. "CRANE"
  brain: "cautious" | "balanced" | "sharp";
  risk:  number;                  // CONTINUOUS 0–100 (lock-in aggression) — not a 2-state toggle
};

type CardStats = {                // derived 0–100, same scale for bots and humans
  speed: number;
  accuracy: number;
  nerve: number;
  coverage: number;               // NEW — driven by the opener (so the Opener dial moves a gauge)
};

type Card = {
  id: string;                     // stable slug; the Bot Board keys on THIS, never display name
  kind: "bot" | "human";
  fill: "configured" | "measured";// how stats were produced (configured bot vs measured human/LLM)
  ownerHandle: string;            // the human account that owns this card (NEW field on PlayerState)
  identity: { name: string; face: string; frame?: string };  // frame = cosmetic
  spec: CardSpec;                 // configured: from dials · measured: read-only fingerprint
  stats: CardStats;               // computed from spec OR measured from play
  tier: string;                   // cosmetic/rank label (v1: "FORGED" / measured tier)
  gold: number;                   // economy balance (durable minting = C2 only)
  rating?: number;                // ELO-shaped ladder seed — SEPARATE from gold (see C2)
};
```

> **`rating` ≠ `gold`.** Gold is an accumulator (an economy balance); a rating is a paired-outcome
> number. Don't overload `gold` as the board's ranking key in a way that blocks adding `rating`
> later — design the C2 DO row rating-shaped from the first write (avoids a leaderboard-reshuffling
> migration). v1's C1 board ranks on **display efficiency**, not gold.

### Derived-stat formula (configured cards; humans/LLMs land on the same scale via measurement)

```
speed    = base{cautious:40, balanced:60, sharp:85} + lerp(risk → +0..+15) + (low-risk ? -10 : 0)
accuracy = base{cautious:85, balanced:70, sharp:60} + (low-risk ? +10 : 0) − lerp(risk → 0..10)
nerve    = clamp( risk/100*70 + base{cautious:0, balanced:8, sharp:16} , 0, 100 )   // composite: risk AND brain
coverage = opener entropy → 0..100   // letter-frequency / positional information of the opener word
                                                            // all clamped to [0,100]
```

Three corrections over the prototype's first cut, all to stop the gauges feeling fake on inspection:

- **`risk` is continuous**, so the stat space is no longer a **6-cell lookup table** (the original
  `brain×risk` = exactly 6 outcomes, discoverable in ~60s — which ironically undercut the locked
  "no presets" decision). Continuous input → the 0–100 gauges earn their precision and two users
  rarely forge the same card.
- **`nerve` is now composite** (driven by `risk` **and** `brain`), not `verify ? 35 : 80` — it was a
  1:1 relabel of the Risk dial, carrying no independent information.
- **`coverage` is a real 4th gauge driven by the opener**, so the Opener dial — a third of the
  forge — **moves a gauge** instead of sitting in the stat row doing nothing. (Cheap: compute
  client-side from the word list already shipped.)

> **Tuning note:** verify the high-risk builds don't strictly dominate on stat-sum (the original
> formula's nerve `+45` swing made every lock-in build out-sum every verify build). Weighting of the
> axes into any *efficiency/score* is a planning decision; until defined, treat the gauges as
> expressive, not as a power ranking.

---

## Dependencies discovered in code-grounding (must precede the dependent pillars)

- **D1 — Bots earn an efficiency score (display) now; *durable gold* later (C2).** Gold is minted
  only for humans at **two** sites, each with its own bot-skip: the non-daily `mint:cashout`
  (`room.ts:1383`, `if (gold > 0 && !player?.isBot)`) and the daily `mint:daily`
  (`room.ts:1544-1548`, bots are marked `scored` and bailed **before** the ledger write). Also,
  **bots have no USER DO** — mints write to `env.USER.idFromName(username)` and bot writes are
  explicitly excluded (`room.ts:1417-1425`), so "store gold on the bot's `PlayerState`" is only
  *ephemeral per-room* state, **not** a persistent per-bot ledger. There is **no persistent
  bot-identity store today.** → **v1 C1 computes efficiency as a pure `economy.ts` read (display
  only, no mint).** Durable bot gold (touching both mint sites + a new persistent bot-identity
  store) is **deferred to C2**, keeping the wedge off the money path. *(Blocks C2, not the wedge.)*
- **D2 — Persist per-guess words; persist already-captured timing.** ⚠️ **Correction:** *timing is
  not missing.* `PlayerState` carries `firstGuessAt`/`finishedAt` (`types.ts:61-62`); `room.ts:200-203`
  already computes `durationMs = finishedAt − firstGuessAt` and the daily leaderboard already ranks
  on it. The real gaps are narrower: (1) the player's **guess words** are never persisted
  (`GameRecord` keeps `guesses` as a **count** + `solveGrid?` masks, `records.ts:7-17`); (2) the
  existing **timing is never copied into `GameRecord`/`UserStats`** and is only set for daily rooms.
  So P0b = "persist guess words + thread the existing `firstGuessAt`/`finishedAt` into the record +
  extend capture to non-daily rooms" — **not** "instrument timing from scratch." *(Blocks the full
  Pillar 4; a partial card ships without it.)*

---

## v1 scope — four pillars

### Pillar 1 — The Forge (client; Tier-C; solo-playable, no protocol change)

The studio, **Bay layout, no presets** (per the locked prototype). Opens directly on a single
editable card defaulting to **CRANE / Balanced / mid-risk**, name editable from the first tap,
neutral **FORGED** tier.

- **Chevron dials** (Pit-Lane steppers) for **Opener / Brain**, plus a **continuous Risk slider**.
- **Live gauges** **Speed / Accuracy / Nerve / Coverage** animate instantly from the formula above —
  **every** control moves at least one gauge (Coverage closes the dead-Opener gap).
- **Reforge feedback is honest:** animate the specific gauge bars that actually changed (with the
  delta); reserve a full-card reforge shimmer for changes that alter the stat set. Opener gets its
  own **signature-chip** micro-animation so the feedback vocabulary never lies about what moved.
- **Identity:** editable name + emoji face + (cosmetic) frame. **v1 ships a small free frame set**
  (default Q3); gold-sink wiring lands with the economy.
- **Persistence:** a user owns up to a **hard-capped small stable (default 3, Q1)** of bot cards,
  saved to their account / `USER` DO. Stable size determines the USER DO schema, so it is a **plan
  input**, decided here.
- **⚡ Shareable card PNG (folded in):** one tap emits a PNG of the forged card + a "forge yours"
  CTA + a `/card/<id>` permalink, reusing the answer-free canvas pattern already proven in
  `share-card.js`. The magic moment ends in a group chat, not a private studio — the cheapest
  growth loop available, and it rides existing code.

The reference implementation is the live prototype (**in R2, not the repo** — see header). Production
code reconstructs/exports its markup/interaction into Wordul's `public/`.

### Pillar 2 — Summon, watch & compare (touches the Room)

In **solo**, a **subtle `+`** adds the user's bot(s) into their current game as **openly-AI**
racers (un-disguised — the opposite of today's liquidity disguise).

- **First-discovery nudge.** "Subtle" is fine as a *resting* state, but the whole magic moment is
  gated behind finding the `+`. The **first** solo game after a user saves a card actively invites
  the summon once (coach-mark / a card-mini peeking from the edge); subtlety is the steady state,
  not the first-run state.
- **Brain — reuse the seam, but it's a 5-point change, not "a third argument."** The
  strategy-injectable brain pattern exists: `noob.ts` `noobGuess(view, profile, roll)` wraps the
  blind `computeNextGuess`, and `room.ts:1111-1113` branches `state.seed ? noobGuess : computeNextGuess`.
  But threading a `CardSpec` through requires touching **all five**: `SeedBody` (`room.ts:58`, carries
  only `{id,name,avatar}` + `profile:"noob"`), the `handleSeed` validator (`room.ts:229`
  **hard-rejects** `profile !== "noob"` → 400), `SeedMarker` (`types.ts:74`), the `ensureBots` seat
  object, **and** the guess-dispatch site. **And the mapping itself is undefined:** `noobGuess` only
  knows `mistakeRate`; how `brain` / continuous `risk` / a forced `opener` translate into pick +
  lock-in behavior is **the heart of Plan B and is currently TBD** — it must be specified there.
  Through all of it the **blind invariant is preserved**: the spec is a *profile arg*, never a
  `BotView` field (`solver.ts` `BotView = { wordLength, ownGuesses }`, no `word`).
- **⚡ In-house `env.AI` as the first "external" brain (folded in).** `env.AI` (Llama 3.1 8B, already
  bound, already used by vibe-studio) becomes a `brain:"llm"` variant that asks for a guess given
  only the masks (**still blind** — it sees `BotView`, never the answer), with a **hard fallback to
  `computeNextGuess`** on any timeout/miss and a **per-game AI-call cap** so a slow model can't stall
  the room alarm loop. This proves the entire external-LLM/MCP north-star **in v1, in-house, with no
  API/auth** — and gives the benchmark its first real data point.
- **Seat injection — new room *mode*, not a relaxed predicate.** `ensureBots()` (plural; the spec
  formerly wrote `ensureBot`) is real but **arena-coupled**. Summoning into a *human's solo room*
  must introduce a distinct **`ownedBots` seat class** rather than piggyback on `state.seed` (which
  also drives noob brain, slow/beatable pacing, typing hand, auto-start at `room.ts:507-514`,
  arena publish/close, H2H-write-on-finish at `room.ts:1419`, and snapshot seed-blanking — inheriting
  any of those would contradict the desired card-configured, un-disguised, own-pace behavior). The
  **second-*human* rejection stays** (`room.ts:417` `state.seed && some(p => !p.isBot)`); capacity is
  re-checked against bot seats with a **hard seat cap** (`MAX_PLAYERS = 8`); owned bots play at the
  **owner's pace**, not arena-beatable pace.
- **Disguise inversion — a 2-way projection, security-sensitive.** `projectPlayerForClient`
  (`bots.ts:73`) strips **both** `isBot` and `nextGuessAt` for *all* bots today via one room-wide
  chokepoint (`room.ts:1764`). It becomes a **2-way function**: owned bot → keep a bot badge (and
  decide whether the heartbeat `nextGuessAt` may leak, since it's openly AI); liquidity persona →
  strip everything **including the new `ownerHandle`**. New field `ownerHandle` on `PlayerState`
  (restore default `undefined` ⇒ unowned, so old persisted rooms stay safe). This boolean is the
  *same* one that walls the two leaderboards (`leaderboard-core.ts:39`), so a bug here is an
  integrity failure in either direction — it gets a **dedicated test** (below), not a bullet point.
- **⚡ Side-by-side comparison view (folded in — this is the payoff).** After a solo summon where the
  bot played the same word the owner did, render **one screen**: the owner's human card and the bot
  card on a shared overlaid radar/gauge axis — *"You 3100 · CRANE-bot 4200 — your bot out-forged you
  by 1100."* Pure client view over two `CardStats`; both numbers already come from `economy.ts` on
  the same word in the same Room. **This is the screen that makes "universal" visceral** and the
  shareable, returnable artifact. Segregated *rankings* (Pillar 3) and a personal *comparison view*
  are not in conflict — the wall belongs on global boards, not on this.
- **Banter:** personality-flavored chat keyed to **blind-safe race state only** (its own masks,
  who's ahead, guesses-left — never the answer): sharp + high-risk = cocky; cautious + low-risk =
  measured. ⚠️ **Verify the engine exists:** the cited `smart-companion-engine` /
  `room-sandbox-01-always-speak` are referenced as **specs**, and no companion/always-speak engine
  was found in `src/`. If unbuilt, banter is **net-new work / its own prerequisite**, not reuse —
  Plan B must state which. If it stays **template/line-bank** based it's free and replay-safe; if it
  calls `env.AI` it inherits the LLM brain's cost/latency/blind-safety constraints. Pick one.
- **Deferred:** background dispatch "like Claude agents" + a **supervisor** view. North-star.

### Pillar 3 — Segregated Bot Board (split: C1 wedge / C2 Sacred Stop)

A real bot leaderboard, **walled off** from the human board. The original "bot plays today's
`daily/<date>`" is **architecturally impossible** (`ensureBots()` returns early on `isDaily`,
`room.ts:1003`; the daily room is a human singleton — bots literally cannot be seeded into it, and
if they could, every user's bot would collide in one shared human room). Re-architected:

- **Ranked venue = per-bot `card-daily/<date>/<botId>` rooms.** Each bot's ranked run happens in its
  **own isolated room** that **fetches today's daily *word*** (resolve from the DAILY DO, same word
  the humans get) but is **not `isDaily`** — so `ensureBots`, the existing `/seed` flow,
  `economy.ts` scoring, and the mint paths all apply, while the human Daily DO and its live board are
  **never touched**. One bot, one room, one word, one ranked result. **Un-farmable and
  human-isolated by construction**, not by a filter that could be bypassed. A shared word is the only
  fair basis for a global board.
- **C1 (the wedge — off the money path):** rank bots by **display efficiency** (a pure `economy.ts`
  read: green/yellow/solve/speed minus wasted-letter penalty — `economy.ts` already measures
  efficiency) computed from each `card-daily` run, surfaced on a **per-day board**. **No gold is
  minted** (D1 deferred), so this stays Tier-C-ish and needs no Tier-A review. **One ranked entry per
  *owner* per day** (not per bot — see Fairness/Sybil), idempotency keyed on `(date, ownerHandle)`.
  **⚡ Expose it as `/api/bots/board.json` + an `llms.txt` entry** from day one (mirroring the
  maintained `/feed.json`) — the "which LLM is the best worduler?" benchmark delivered as a *side
  effect*, citation-worthy AIO/GEO content, and a target external builders can point at before any MCP.
- **C2 (the real Sacred Stop — Yan-gated, deferred with leagues):** durable **bot gold** (the full
  D1: both mint sites + a **persistent bot-identity store**, since bots have no USER DO today),
  a persisted **all-time/rolling cross-day store**, and an **ELO-shaped `rating`** designed in from
  the first write. This is the only net-new persistence and the only money-path change; it carries
  the **idempotency contract** (below) and an **observability/rollback** story (below).
- **Ranking logic — invert one predicate.** `leaderboard-core.ts:39`'s ranker excludes bots
  (`!pl.isBot`); the bot board inverts it (rank `isBot === true`). Low effort *for the ranking fn*;
  the cost is the venue + store, now correctly scoped to C1/C2.
- **Walling:** bots never appear on the human board and vice versa. The **personal** comparison view
  (Pillar 2) shows both side-by-side *without merging rankings*.

### Pillar 4 — The Human Card (partial ships now; full needs D2)

Every human gets the **same card**, specs **measured** from real play.

- **Source:** `src/user-core.ts` / `src/stats.ts` / `src/records.ts`, via `/api/user/<name>`.
  Honest per-axis status today:

  | Spec axis | Derivable today? | Why |
  |---|---|---|
  | **Accuracy** (solve-rate) | ✅ **Yes** | `UserStats` wins / gamesPlayed. |
  | **Brain** (guesses-to-solve) | 🟡 **Partial** | `UserStats.guessDistribution`; full info-efficiency needs masks. |
  | **Opener** (most-frequent first guess) | ❌ **No** | guess **words** never persisted (D2). |
  | **Risk** (lock-in vs filler) | ❌ **No** | needs per-guess words (D2). |
  | **Speed** | 🟡 **Plumbing only** | timing IS captured live (`durationMs`) but not persisted to the profile (D2). |
  | **Nerve / Coverage** | ❌ **No** | derived off Risk / Opener (D2). |

- **"Calibrating" is a reveal ritual, not a blank card.** Until D2 capture accrues, do **not** ship
  a mostly-em-dash card at the headline comparison. Show locked axes as **developing slots** with a
  counter — *"scanning your style — 3 more games to reveal Speed"* — so the gaps are a **quest**, not
  an error. Where defensible, show a **low-confidence band** that tightens with games rather than "—".
  Never invent confident numbers.
- **Re-sequence so the human card is meaningful at first contact.** Pull **D2 (P0b)** to run
  **parallel with Plan A**, so by the time the Forge ships, players already have a few captured games
  and a 4+-axis card — otherwise the wow moment lands flat for exactly the brand-new users you most
  need to wow. Gate the **public** reveal of an axis on "enough captured games to fill it."
- **Editable?** No — specs are read-only (the fingerprint is honest). **Cosmetics only.**
- **The bridge — "forge a bot from my style":** clones the human card's *measured* spec into a new
  **editable** bot card. The partial-window clone must **label** the unmeasured axes as seeded
  defaults — they **must not masquerade as measured.** Headline the bridge only once enough axes are
  real (a clone of a mostly-default card is a non-event). Sets up **counter-forge** later.
- **⚡ Counter-forge teaser (adjacent win):** because `/api/user/<name>` already exposes a measured
  card, a thin "summon a bot tuned to beat @rival's card" is a near-free Pillar-2 reuse that turns
  the Forge from self-expression into a rivalry engine. Optional for v1; flagged so planning keeps
  the seam clean.

---

## Data flow (v1)

```
FORGE (client)
  Opener/Brain dials + Risk slider → CardSpec → derive CardStats (incl. coverage)
         → render card + 4 gauges → save bot card (USER DO, capped stable)
         → ⚡ one-tap shareable card PNG + /card/<id> permalink

SUMMON (solo)
  tap +  → user summon route → ownedBots seat in the player's Room (un-disguised, ownerHandle)
         → bot guesses via card-configured brain(spec) over solver BotView   [blind invariant intact]
         → optional brain:"llm" via env.AI (blind; timeout→computeNextGuess; per-game call cap)
         → banter via template (or env.AI) engine, blind-safe inputs only
         → ⚡ side-by-side comparison: owner's human card vs bot card on shared axes (both via economy.ts)

RANKED (C1)
  send bot → card-daily/<date>/<botId> room (reads today's word, NOT isDaily)
         → display efficiency via economy.ts (pure read, no mint)
         → per-day bot board, one entry per OWNER/day, walled off from humans
         → ⚡ /api/bots/board.json + llms.txt benchmark

RANKED DURABLE (C2 — Sacred Stop)
  same → durable bot gold (both mint sites + persistent bot-identity store)
         → persisted all-time/rolling store + ELO-shaped rating (idempotent by (date, ownerHandle))

HUMAN CARD
  stats.ts / records.ts (+ D2 capture: words + persisted timing) → derive CardSpec(measured) + CardStats
         → calibrating reveal ritual → "forge a bot from my style" (labels seeded axes)
```

---

## Fairness & anti-cheat (v1)

- **Emission ≠ board-eligibility — two different controls.** The "one ranked entry per day" cap
  dedups a **board row**; it does **not** cap the **currency**. Solo gold is minted with **no
  per-day cap** (`room.ts:1377-1389`; `round` increments on every restart, fresh word each round,
  unique ledger ref) — a human can farm it today, before any bot work. v1 keeps the **C1 board on
  display-only efficiency (no mint)** so solo-summon gold never feeds the ranked score. When durable
  gold lands (C2), bot board ranks on a **`dailyGoldAwarded` minted only in the `card-daily` scoring
  path**, never solo.
- **Ledger idempotency — promoted from north-star to a C2 prerequisite.** `/ledger/append`
  (`user.ts:66-73`) is a **blind, unauthenticated, non-idempotent** push (`balances += delta;
  ledger.push(tx)`; the code itself comments "the gold ledger is not idempotent"). Adding a second
  mint caller (summon / bots) without **idempotency-by-`ref` (reject duplicate ref)** + a
  **per-owner daily emission cap** = unbounded minting. Both are **v1 hard prerequisites for C2**,
  same promotion D1/D2 got. Replaying a `ref` **must not** double-credit (tested).
- **Per-OWNER caps kill Sybil.** A per-*bot*-per-day cap is no defense if a user owns N bots
  (N entries). v1 caps **ranked entries per *owner* per day** (your single best bot scores). With
  the continuous-config space everyone's optimal also tends to converge (below), so without this one
  owner could wall the top. Bot creation should cost gold once the sink exists.
- **⚠️ "Efficiency resists maxing" was backwards — corrected.** On **one shared known word**, the
  efficiency-optimal play is a fixed decision: once someone finds the meta config it scores
  identically for everyone, and the board **converges to ties** broken only by `guessCount`. That is
  acceptable for a v1 wedge but the board is a *"did you find the meta config"* check, **not a skill
  ladder** — real differentiation is gated on the **north-star hidden/rotating word set**. Also: the
  blind invariant protects the *solver*, not the **owner**, who can **read the day's revealed answer
  and hand-forge the perfect opener** late in the day. Mitigation: a card's ranked `card-daily` run
  should commit **before** the owner can see today's answer (e.g. ranked dispatch is opt-in at start
  of day, or the run is one-shot per owner) — flagged for Plan C1.
- **Blind solver invariant** (`solver.ts`) — config is a **profile arg**, never a `BotView` field.
  Making the answer reachable would require editing `BotView` or the solver's imports — a visible,
  test-guarded act.
- **Genuinely deferred (north-star):** stake-to-rank, win-trading detection via seeded replays.

---

## Error handling & edge cases (v1)

- **Bot with no name** → falls back to a label ("your bot"); never blank (prototype `botLabel()`).
- **Owned-bot room username collisions** → a user-named bot ("CRANE") could collide with a human
  username or another user's bot in a shared ranked context. Owned-bot **room usernames must be
  namespaced/collision-free**, and the **Bot Board keys on `card.id`, never display name** (so two
  "CRANE" bots are distinct rows).
- **Summoning the same bot twice into one solo game** → de-dupe by card id (one seat per bot).
- **Multiple owned bots in one solo game** → the `ownedBots` seat class with a hard seat cap; the
  **second-human** reject stays.
- **Re-forged card between ranked days (spec drift)** → decide whether `rating`/history binds to
  `card.id` regardless of spec change (recommended: yes — identity is the card, not the build).
- **Daily already played by an owner today** → ranked entry idempotent (upsert keyed `(date,
  ownerHandle)`, not append).
- **Human with too few games** → "calibrating" reveal ritual (proven axes + developing slots);
  never invent.
- **Disguise safety** → owned bots are *explicitly* un-disguised; liquidity bots stay disguised.
  A liquidity persona must **never** carry `ownerHandle` on the wire; an owned bot must **never** be
  silently stripped to look human (or it could reach the human-board predicate). Restore default
  `ownerHandle === undefined ⇒ unowned`.

---

## Testing (v1)

- **Stat formula** — bot derivation and human-stat normalization land on the same 0–100 scale
  (incl. continuous `risk`, composite `nerve`, opener-driven `coverage`); pure function shared by
  client + server.
- **Brain-from-config** — given a `CardSpec`, the brain plays the configured opener first and biases
  pick + lock-in per brain/risk; the blind-invariant test (no answer reachable) still passes.
- **LLM brain (env.AI)** — a guess request sees only `BotView`; a timeout/miss falls back to
  `computeNextGuess`; the per-game call cap holds; no answer is reachable.
- **C1 board** — bots' `card-daily` results post to the bot board only, never the human board; the
  inverted predicate ranks only `isBot`; **one entry per owner per day** upsert is idempotent.
- **Capture (D2)** — finishing a game persists guess words + threads the existing
  `firstGuessAt`/`finishedAt`; derivation is deterministic from a fixture; low-data → partial card.
- **Summon** — the route seeds exactly one seat per owned bot, renders with a **bot badge**, plays at
  owner pace; the comparison view shows both cards' `economy.ts` numbers on the same word.
- **🔴 Disguise non-regression (mixed room)** — in a room with **both** an owned bot and a liquidity
  persona: the owned bot projects `isBot:true` + `ownerHandle`; the liquidity persona projects
  stripped + **never** carries `ownerHandle`. Exactly one of {disguised-liquidity, badged-owned,
  human} holds per projected player. (The module-graph wall guards imports, **not** this runtime split.)
- **🔴 Gold double-mint safety (C2)** — replaying the same ledger `ref` does not double-credit; the
  `(date, ownerHandle)` dedupe flag and the board row are written in one storage turn.

---

## Build phases (each its own implementation plan)

Phased so client-only solo pieces ship first; the Sacred Stop / money-path work (C2) is isolated and
Yan-gated. **P0a is gone** — absorbed into C2; the wedge no longer touches the money path.

- **Plan A — The Forge (client, Tier-C).** Export the Bay prototype from R2 → `public/`: card,
  Opener/Brain dials + continuous Risk slider, 4 gauges (incl. coverage), honest reforge feedback,
  identity + small free frame set, capped-stable local persistence, **shareable card PNG**. Ships first.
- **Plan P0b — Capture (D2), re-scoped.** Persist per-guess **words** + thread the existing
  `firstGuessAt`/`finishedAt` into `GameRecord`/`UserStats` + extend capture to non-daily rooms.
  Store a **rolling aggregate** (opener-frequency, risk-ratio, timing EMA), **not raw history**
  (default Q5). Additive, low-risk. **Runs parallel with A** so the human card isn't empty at launch.
- **Plan B — Summon, watch & compare (touches Room).** `ownedBots` seat class (distinct from
  `state.seed`); the **5-point `CardSpec`→brain wire + the brain/risk/opener→guess mapping** (the
  hard, undefined part); optional `env.AI` `brain:"llm"`; 2-way disguise projection (`ownerHandle`);
  first-discovery nudge; tone-matched banter (verify engine exists); **side-by-side comparison view**.
- **Plan C1 — Per-day Bot Board (no mint; ~Tier-C/B).** `card-daily/<date>/<botId>` ranked rooms;
  display-only efficiency via `economy.ts` (pure read); inverted-predicate ranking; per-day board,
  one entry per owner/day; **`/api/bots/board.json` + `llms.txt`**. No durable persistence, no
  money-path change.
- **Plan C2 — Durable bot economy + persisted board (server/DO — Sacred Stop; Yan-gated).** Full D1
  (both mint sites + persistent bot-identity store); persisted all-time/rolling store; **ELO-shaped
  `rating`**; **ledger idempotency-by-ref + per-owner emission cap + per-owner ranked-entry cap**;
  observability/rollback (below).
- **Plan D — Human Card + "forge from my style" (needs P0b for full; partial ships earlier).**
  Calibrating reveal ritual; cosmetic customization; clone-to-Forge bridge (labels seeded axes).

**Suggested order:** **A ‖ P0b → B → C1 → D → C2.** A + P0b are user-visible / low-risk and parallel;
B ships the magic moment + comparison; C1 ships the board off the money path; D enriches the human
card; **C2 is the lone Sacred Stop**, last and gated.

> **Observability & rollback (C2).** The new bot-identity/board DO is the only net-new persistence and
> touches gold. `wrangler rollback` covers **code, not DO data**. C2's plan must specify: how the
> store initializes/migrates, how a bad bot-board deploy is rolled back (data, not just code), an
> **alert on anomalous bot gold** (over-earning), and how to **reset/recompute** the board if mint math
> changes. A Sacred Stop touching the economy needs a "how do we know it's wrong and undo it" section.

---

## North star (captured, NOT built in v1)

- **External brains via MCP / HTTP** — any third-party LLM implements the same `BotView → guess`
  contract and enters the arena. v1's in-house `env.AI` brain already proves the seam carries a real
  LLM; the external path is "open the contract + auth," not a re-architecture.
- **Async ladder + live races** — async (submit a run on the rotating hidden set anytime) as the
  spine; the `card-daily/<date>/<botId>` venue is already that spine's first lane — swapping the
  daily word for a hidden/rotating set is a **word-source change**, not an architecture change (keep
  the store keyed by `(date, card)` to bank that). Live same-word races (reuse Room/WS) as the show.
- **ELO**, **leagues** (noob→elite), **championat** (seasons, brackets, live finals). The C2 `rating`
  field seeds this.
- **Hidden, rotating, adversarial word sets** + **solve-rate-per-compute** scoring — the move that
  makes external-LLM competition a real skill contest and a citation-worthy benchmark.
- **Gold economy** — entry fees, prizes, pari-mutuel **wagering** on live bot races. (A **risk-free
  "call the winner"** prediction on summon-and-watch — paying a tiny gold trickle on correct calls —
  could ship earlier to validate the call-and-resolve loop on play-money; flagged, not v1.)
- **Add-on slots** — cosmetic (uncapped gold sink) vs power (hard-capped; dings efficiency) → no
  pay-to-win.
- **LLM live-commentator** over **deterministic seeded replays** — the per-guess-word capture (P0b)
  is exactly the replay primitive this and win-trading detection both need.
- **Counter-forge** and **shareable card images** (the PNG ships in v1 as the seed of this).
- **`/card/<id>` unified viewer** — one renderer + OG meta for any card (bot or human); the v1 share
  permalink is its first surface.

---

## Non-goals (YAGNI for v1)

- External-agent API / MCP, auth, API keys (the in-house `env.AI` brain is **not** this).
- ELO/leagues/seasons/championat/tournaments/wagering.
- Hidden/adversarial dictionaries; compute-budget scoring.
- Add-on store / power-ups / gold purchases.
- Background bot fleet + supervisor view.
- Durable bot gold + persisted all-time board (that's **C2**, gated, not cut).
- Live bot-vs-bot real-time races and a merged board.

---

## Grounding & assumptions (verified against `origin/main` @ `07362e1`)

✅ = confirmed this session; ⚠️ = corrected/flagged. **24 of 32 review claims verified exactly.**

- ✅ `src/solver.ts` — `BotView = { wordLength, ownGuesses }` (lines 17-21), guarded by a SACRED
  INVARIANT comment + import isolation. No `word` field.
- ✅ `src/noob.ts` — `noobGuess(view, profile, roll)` (line 47) + `NoobProfile` (line 10), the
  config-injected-brain precedent; `room.ts:1111-1113` branches `state.seed ? noobGuess : computeNextGuess`.
  ⚠️ `NoobProfile` is currently `{ mistakeRate }` only — a `CardSpec` profile **widens** it.
- ✅ `src/economy.ts` — `POINTS` + gold math (`9-18`, `104-133`) = the efficiency basis (client +
  server share it).
- ⚠️ **D1** — bots minted at **two** sites (`room.ts:1383` cashout, `room.ts:1544-1548` daily
  early-return). **Bots have no USER DO** (`room.ts:1417-1425`); "gold on `PlayerState`" is ephemeral.
  No persistent bot-identity store today → C2.
- ✅ `src/bots.ts` — `projectPlayerForClient` strips `isBot` (+`nextGuessAt`) at `bots.ts:73`;
  `PlayerState` has **no `ownerHandle`** (new field).
- ⚠️ `src/room.ts` — the seat primitive is **`ensureBots`** (plural, `room.ts:1002`), not `ensureBot`.
  It **early-returns `if (this.state.isDaily)`** (`room.ts:1003`, "no worduler in the daily room") — so
  bots **cannot** be seeded into the daily room (the re-architecture's root cause). `/seed` hard-rejects
  `profile !== "noob"` (`room.ts:229`). The 1-human cap is `room.ts:417`; `MAX_PLAYERS = 8`.
- ⚠️ **D2 timing already exists** — `firstGuessAt`/`finishedAt` (`types.ts:61-62`), `durationMs =
  finishedAt − firstGuessAt` (`room.ts:200-203`), surfaced on the daily leaderboard
  (`leaderboard-core.ts:16`). The gap is **guess words** + **persisting** timing (only set for daily
  rooms) into `GameRecord`. `GameRecord` (`records.ts:7-17`): `guesses` (count), `solveGrid?`, `word`,
  `result`, `wordLength`, `finishedAt`, `opponents` — no guess words, no duration.
- ✅ Shared-word ranked anchor: `daily/<YYYY-MM-DD>` is owned by the **ROOM** DO (`worker.ts:164`),
  **not** `daily.ts` (the singleton scheduler at `idFromName("daily")`) — **not conflated**.
  `/api/daily/<date>/leaderboard` + `/api/user/<name>` exist.
- ✅ `src/leaderboard-core.ts` — the ranker filters `!pl.isBot` at **line 39** (exact predicate);
  the bot board inverts it. `scoreboard.ts` is per-room W/L/T; both pure (persistence in the DOs).
- ⚠️ **Banter engine unverified** — `smart-companion-engine` / `room-sandbox-01-always-speak` are
  referenced as **specs**; no such engine found in `src/`. May be a Plan-B prerequisite, not reuse.
- ⚠️ **Prototype not in repo** — `/designs/bot-studio-forge-bay` is served from the `DESIGNS` R2
  bucket (`worker.ts:332-357`), not `public/`. Export/reconstruct before Plan A.
- **Process note:** local root and `origin/main` have diverged; grounding is against the **worktree
  (`origin/main`)**, commit `07362e1` (parent of doc commit `63c3229`). `origin/main` may have advanced
  — re-confirm line-level shapes at implementation time.

---

## Owner decisions for v1 (former "open questions" — now flagged defaults; override anytime)

These are **plan inputs**, not nice-to-haves (they gate the USER DO schema, the C1 dispatch trigger,
and the P0b storage shape). Decided with sensible defaults so planning can proceed:

1. **Stable size** → **default: a small stable, hard cap 3 per user.** Ranked board caps **1 entry
   per owner/day** regardless. *(Gates Plan A persistence.)*
2. **Ranked entry** → **default: explicit opt-in per day** ("send to today's ranked"). Clearer intent
   + supports the answer-reveal mitigation (commit before reveal). *(Gates Plan C1 dispatch.)*
3. **Cosmetic frames** → **default: ship a small free set in v1**; gold-sink wiring later.
4. **Human card visibility** → **default: private until opt-in.** ⚠️ Implication: since
   `/api/user/<name>` is already public, the **new measured axes must be gated server-side** —
   otherwise "private" is already foreclosed. *(Decide before P0b persists guess data.)*
5. **D2 storage** → **default: rolling aggregate** (opener-frequency counter, risk-ratio, timing EMA),
   **not raw guess history** — privacy + bounded storage; raw replay deferred to north-star anti-cheat.

> These five are my recommended defaults from the review; tell me any you'd flip and I'll thread the
> change through the affected plan(s) before writing them.
