# Universal Card Arena — Design Spec (v1)

**Date:** 2026-06-04
**Status:** brainstorm approved (this session) → ready for implementation plan(s). Server/Durable-Object phases are **Sacred Stops** gated on Yan's go (see Build Phases). **Code-grounded** against worktree `card-arena-spec` (`origin/main`, HEAD `07362e1`).
**First consumer:** Wordul (`wordul.com`)
**Visual direction (locked, live prototype):** `https://wordul.com/designs/bot-studio-forge-bay`

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
+ a segregated bot board + the human card** — on top of **two cross-cutting prerequisites**
discovered in code-grounding (bots must earn gold; per-guess + timing must be captured). See
**Dependencies** and **Build Phases**.

### The one magic moment v1 must nail

> Open the **Forge** → tune your bot's chevron dials and watch its **card reforge** + stats
> react → in a solo game tap the subtle **`+`** → your bot **drops in, plays openly, and talks
> in its own voice** → see it land on the **Bot Board** (walled off from humans), its specs
> directly comparable to your *own* measured **human card**.

Everything below exists to produce that moment. If a piece doesn't serve it, it's north-star.

---

## Decisions locked this session

| Fork | Decision |
|------|----------|
| Who plays | **Universal arena** — house bots, user bots, *and* (later) external LLMs; leagues noob→elite; championat. |
| Match format | **Spec all**; v1 leans on existing modes — bot can be **sent to Daily** (ranked) and summoned into solo (playground). |
| Config depth | **Small strategy stack** — 3 dials (Opener · Brain · Risk) + identity. Add-ons slot in later. |
| Play loop | v1 = **summon into your solo game via a subtle `+`**, watch it play + chat. Background "fleet + supervisor (like Claude agents)" = **deferred**. |
| Scoreboard | **Full segregated bot board in v1** (ranked by gold/efficiency, walled off from humans). |
| Visual direction | **Forge · Bay** — collectible card hero + Pit-Lane chevron telemetry. **No presets** (forge-from-scratch). |
| Human card | **Measured + cosmetic + "forge a bot from my style" bridge** (specs derived from real play, not editable). |

---

## The spine — the Card

A **Card** is the single identity object for any competitor. Same shape, same axes, whether
the brain behind it is silicon or flesh. The **only** difference is how the specs get filled:

| | Specs come from | Editable? |
|---|---|---|
| 🤖 **Bot card** | **configured** — the Forge's chevron dials | yes, in the Forge |
| 🧑 **Human card** | **measured** — derived from real play | no (your play *is* the tuning); cosmetics only |

Because both are drawn from the **same axes**, a bot card and a human card are **directly
comparable** — that is what makes the "universal arena" literal rather than a slogan.

### Card model (shape — names to be finalized in planning)

```ts
type CardSpec = {
  opener: string;                 // first guess, e.g. "CRANE"
  brain: "cautious" | "balanced" | "sharp";
  risk:  "verify"   | "lockin";
};

type CardStats = {                // derived 0–100, same scale for bots and humans
  speed: number;
  accuracy: number;
  nerve: number;
};

type Card = {
  id: string;
  kind: "bot" | "human";
  ownerHandle: string;            // the human account that owns this card (NEW field on PlayerState)
  identity: { name: string; face: string; frame?: string };  // frame = cosmetic
  spec: CardSpec;                 // bot: configured · human: measured (read-only)
  stats: CardStats;               // computed from spec
  tier: string;                   // cosmetic/rank label (v1: "FORGED" / measured tier)
  gold: number;                   // running competitive score
};
```

### Derived-stat formula (single source of truth — bots **and** humans land on this scale)

```
speed    = base{cautious:40, balanced:60, sharp:85} + (lockin ? +15 : 0) + (verify ? -10 : 0)
accuracy = base{cautious:85, balanced:70, sharp:60} + (verify ? +10 : 0) + (lockin ? -10 : 0)
nerve    = verify ? 35 : 80
                                                            // all clamped to [0,100]
```

- **Bot cards** apply this directly from the configured `spec` (the Forge prototype already does).
- **Human cards** map *measured* play onto the **same three axes** so the numbers mean the same
  thing on either card. **This requires data Wordul does not capture today** — see Dependencies.

---

## Dependencies discovered in code-grounding (must precede the dependent pillars)

Two cross-cutting prerequisites surfaced when grounding against `origin/main`. They are **not
optional polish** — Pillars 3 and 4 are impossible without them:

- **D1 — Bots must earn gold.** Today gold is minted only for humans: the minting path guards on
  `!isBot`, and `leaderboard-core.ts:39` ranks with `.filter((pl) => pl && !pl.isBot && typeof pl.goldAwarded === "number")`. So bots currently have **no `goldAwarded`** at all. A segregated
  bot board "ranked by gold/efficiency" (Pillar 3) requires first **minting gold for bots** using
  the same `economy.ts` math, stored on the bot's `PlayerState`. *(Blocks Pillar 3.)*
- **D2 — Per-guess words + per-game timing must be persisted.** `GameRecord` (`records.ts`)
  stores `guesses` as a **count**, `solveGrid` as **color patterns (daily only)**, plus
  `word/result/wordLength/finishedAt/opponents`. It stores **neither the player's actual guess
  words nor any timing.** The human card's Opener, Risk and Speed axes (Pillar 4) are
  underivable without this capture. *(Blocks the full Pillar 4; a partial card ships without it — see below.)*

---

## v1 scope — four pillars

### Pillar 1 — The Forge (client; Tier-C; solo-playable, no protocol change)

The studio, **Bay layout, no presets** (per the locked prototype). Opens directly on a single
editable card defaulting to **CRANE / Balanced / Verify**, name editable from the first tap,
neutral **FORGED** tier.

- **Chevron dials** (Pit-Lane steppers) for **Opener / Brain / Risk**.
- **Live gauges** **Speed / Accuracy / Nerve** animate instantly from the formula above.
- **Reforge shimmer** on the card on any change.
- **Identity:** editable name + emoji face + (cosmetic) frame.
- **Persistence:** a user can own one or more bot cards (saved to their account / `USER` DO).
  v1 may start with a single bot; the model allows a small stable.

The reference implementation is the live prototype — production code lifts its markup/interaction
into Wordul's `public/` as a normal promotion pass (the design ritual stops at publish).

### Pillar 2 — Summon & watch (touches the Room)

In **solo**, a **subtle `+`** adds the user's bot(s) into their current game as **openly-AI**
racers (un-disguised — the opposite of today's liquidity disguise).

- **Brain — reuse the already-shipped config-injection seam.** The strategy-injectable brain
  pattern **already exists**: `src/noob.ts` `noobGuess(view: BotView, profile: NoobProfile, roll)`
  wraps the blind `computeNextGuess`, and `room.ts` already **branches between brains** on a
  `state.seed` flag. A card's `spec` becomes a richer profile passed the same way — **a third
  argument, never a `BotView` field** — so the solver's **sacred blind invariant is preserved**
  (a configured bot still sees only masks, never the answer). Opener forces the first guess;
  brain/risk bias pick + lock-in.
- **Seat injection — reuse the primitive, build a new flow.** The seat primitive `ensureBot()`
  exists in `room.ts`, but today it is **arena-coupled**: gated to the `/robots` room or a
  `state.seed`-marked arena room, reachable only via a **server-to-server `/seed` POST from the
  ARENA DO**, hardcoded to `profile:"noob"`, forced to slow/beatable pacing, and the Room
  **rejects a 2nd human** (`some(p => !p.isBot)` guard). So summon **reuses `ensureBot` + the
  `/seed` body shape**, but Pillar 2 must add: a **user-facing summon route**, **non-noob
  (card-configured) brain selection**, **lift/relax the 1-human cap** for owned-bot seats, and
  the **disguise inversion** (a new `ownerHandle` on `PlayerState`; owned-bot seats bypass
  `projectPlayerForClient`'s `isBot` strip and the `seed`-blanking, rendering a bot badge).
- **Banter:** personality-flavored chat tied to the build's tone (sharp+lockin = cocky;
  cautious+verify = measured; balanced = easygoing), reusing the companion/"always-speak"
  engine already specced (`2026-06-02-smart-companion-engine`, `room-sandbox-01-always-speak`).
- **Deferred:** background dispatch "like Claude agents" + a **supervisor** view to quick-view /
  join a running bot's room. North-star, not v1.

### Pillar 3 — Segregated Bot Board (server / Durable-Object — **Sacred Stop**; depends on D1)

A real global bot leaderboard, **walled off** from the human board.

- **Ranked path = the shared Daily word.** A bot earns a *ranked* result by playing **today's
  Daily** word (`ROOM` keyed `daily/<YYYY-MM-DD>`, already exists). A shared word is the only
  fair basis for a global board, and **one ranked entry per bot per day** makes it
  **un-farmable**. The solo `+` summon stays the *playground*; Daily is the *ranked* lane.
- **Ranked by gold/efficiency — once D1 lands.** Wordul's gold economy (`src/economy.ts`
  `POINTS`) already rewards green/yellow/solve/speed and bleeds on wasted-letter reuse — i.e. it
  already measures **efficiency**. But **bots don't earn gold today** (D1): minting must be
  extended to bots first.
- **Ranking logic — invert one predicate.** `leaderboard-core.ts`'s `topDaily` is a pure ranker
  that **excludes** bots (`!pl.isBot` filter, line 39). A bot board is that same logic with the
  predicate **inverted/parametrized** (rank `isBot === true`). Low effort *for the ranking fn*.
- **Storage is NEW, not an extension.** `leaderboard-core.ts` / `scoreboard.ts` / `records.ts`
  are **pure** (no persistence); `scoreboard.ts` is per-room W/L/T only (not a global board).
  The actual persisted state lives in the Durable Objects. A bot-scoped board (per-Daily-date +
  all-time/rolling, one-entry-per-bot-per-day idempotent) is **new DO/KV plumbing** — the Sacred
  Stop. Exact layout is a planning decision; confirm against the live snapshot protocol.
- **Walling:** bots never appear on the human board and vice versa. A future **unified Card
  viewer** may show both side-by-side for comparison without merging the *rankings*.

### Pillar 4 — The Human Card (depends on D2 for the full version; partial ships without it)

Every human gets the **same card**, specs **measured** from real play.

- **Source:** `src/user-core.ts` / `src/stats.ts` / `src/records.ts`, surfaced via
  `/api/user/<name>`. The human card is a **derivation/view** over these — **but most axes are
  not capturable from what's persisted today** (D2). Honest status per axis:

  | Spec axis | Derivable today? | Why |
  |---|---|---|
  | **Accuracy** (solve-rate) | ✅ **Yes** | `UserStats` wins / gamesPlayed. |
  | **Brain** (guesses-to-solve) | 🟡 **Partial** | `UserStats.guessDistribution` gives the distribution; full "info-efficiency" needs masks. |
  | **Opener** (most-frequent first guess) | ❌ **No** | guess **words** are never persisted (D2). |
  | **Risk** (lock-in vs safe-filler) | ❌ **No** | needs per-guess words (D2). |
  | **Speed** | ❌ **No** | no timing in `GameRecord`/`UserStats` (D2). |
  | **Nerve** | ❌ **No** | defined off the Risk axis (D2). |

- **Phasing:** v1 can ship a **partial human card** from what exists (Accuracy + a provisional
  Brain), clearly marked "calibrating," and **progressively enrich** Opener/Risk/Speed/Nerve as
  D2 capture accrues games. This avoids inventing confident numbers from absent data.
- **Editable?** No — specs are read-only (the fingerprint is honest). **Cosmetics only**
  (face / name display / frame), a clean gold sink.
- **The bridge — "forge a bot from my style":** one tap clones the human card's *measured* spec
  into a new **editable** bot card in the Forge ("here's you as a bot — now make it sharper").
  This is the studio's natural onboarding and sets up **counter-forge** (build a bot to beat a
  rival's card) later. (Note: a fully meaningful clone needs D2; the partial-card clone seeds
  defaults for the unmeasured axes.)

---

## Data flow (v1)

```
FORGE (client)
  chevron dials → CardSpec → derive CardStats → render card + gauges → save bot card (USER DO)

SUMMON (solo)
  tap +  → user summon route → ensureBot seat in the player's Room (un-disguised, ownerHandle)
         → bot guesses via noob-style brain(spec) over solver BotView   [blind invariant intact]
         → banter via companion engine
         → game gold computed via economy.ts (incl. bots — D1)

RANKED (Daily)
  send bot → today's daily/<date> word → bot plays → gold/efficiency (D1)
         → segregated Bot Board (per-day + all-time, new DO store), walled off from humans

HUMAN CARD
  stats.ts / records.ts (+ D2 capture) → derive CardSpec(measured) + CardStats → render same card
         → "forge a bot from my style" → clones spec into an editable Forge bot card
```

---

## Fairness & anti-cheat (v1)

- **Shared word for ranking** (Daily) — the only apples-to-apples basis for a global board.
- **One ranked entry per bot per day** — kills summon-spam farming.
- **Blind solver invariant** (`solver.ts`) — a configured bot still cannot see the answer;
  config is a **profile arg** (like `noob.ts`), never a `BotView` field. Making the answer
  reachable would require editing the `BotView` type or the solver's imports, a visible,
  test-guarded act.
- **Efficiency, not just win/lose** — because Daily is solvable by most sharp bots, the gold
  spread (speed + low waste) is the real differentiator, which resists trivial maxing.
- North-star anti-abuse (stake-to-rank, per-owner rate limits, daily gold emission caps,
  win-trading detection via seeded replays) is **deferred** — noted so v1 doesn't foreclose it.

---

## Error handling & edge cases (v1)

- **Bot with no name** → falls back to a label ("your bot"); never renders blank (prototype
  already does this via `botLabel()`).
- **Summoning the same bot twice into one solo game** → de-dupe by card id (one seat per bot).
- **Multiple owned bots in one solo game** → requires relaxing the Room's 1-human/1-bot
  invariant for owned-bot seats; cap the seat count to keep the board readable.
- **Daily already played by a bot today** → ranked entry is idempotent (upsert, not append).
- **Human with too few games to derive stats** → "calibrating" card: only the proven axes
  (Accuracy, provisional Brain) show; the rest read "—" until D2 capture accrues. Never invent.
- **Disguise safety** → owned bots are *explicitly* un-disguised; liquidity bots stay disguised.
  The two paths must not cross-contaminate (a liquidity persona must never leak `ownerHandle`;
  an owned bot must never be silently stripped to look human; the `seed`-blanking path must be
  threaded correctly).

---

## Testing (v1)

- **Stat formula** — unit-test bot derivation and human-stat normalization land on the same
  0–100 scale for equivalent builds (pure function shared by client + server).
- **Brain-from-config** — given a `CardSpec`, the brain plays the configured opener first and
  biases per brain/risk; the blind-invariant test (no answer reachable) still passes; mirrors
  the existing `noob.ts` test pattern.
- **Bot gold (D1)** — bots accrue `goldAwarded` via `economy.ts` identically to humans; an
  end-to-end bot game yields a gold figure.
- **Segregated board** — bot results post to the bot board only, never the human board;
  the inverted predicate ranks only `isBot` rows; one-entry-per-bot-per-day upsert is idempotent.
- **Capture (D2)** — finishing a game persists the player's guess words + timing; derivation is
  deterministic from a fixture profile; low-data profile yields a partial (not confident) card.
- **Summon** — the user route seeds exactly one seat per owned bot, renders with a bot badge
  (not stripped), and the game's gold matches `economy.ts`.

---

## Build phases (each its own implementation plan)

Phased so client-only solo pieces ship first and the Sacred Stops / prerequisites are isolated
and Yan-gated — mirroring the gold-economy spec's structure.

- **Plan A — The Forge (client, Tier-C).** Promote the Bay prototype into `public/`: card,
  chevron dials, gauges, reforge, identity, local persistence. Solo, no protocol change. Ships first.
- **Plan P0a — Bots earn gold (D1).** Extend `economy.ts` minting to `isBot` players; store
  `goldAwarded` on bot `PlayerState`. Prerequisite for Plan C.
- **Plan P0b — Capture guess words + timing (D2).** Persist per-guess words + per-game timing in
  `GameRecord`/room finish. Prerequisite for the full Plan D. Additive, low-risk schema growth.
- **Plan B — Summon & watch (touches Room).** User-facing summon route; card-configured brain via
  the `noob.ts`-style profile seam; disguise inversion (`ownerHandle`, bypass strip); relax the
  1-human cap for owned-bot seats; tone-matched banter.
- **Plan C — Segregated Bot Board + Daily-anchored ranked dispatch (server/DO — Sacred Stop;
  needs P0a).** Inverted-predicate ranking; new bot-scoped DO store (per-day + all-time);
  one-entry-per-bot-per-day. Yan-gated.
- **Plan D — Human Card + "forge from my style" (needs P0b for full; partial ships earlier).**
  Derive measured card; cosmetic customization; clone-to-Forge bridge.

Suggested order: **A → P0a/P0b (parallel) → B → C → D**. A and the Forge are user-visible fast;
P0a/P0b are quiet prerequisites; C is the Sacred Stop.

---

## North star (captured, NOT built in v1)

Documented so v1 decisions don't foreclose them:

- **External brains via MCP / HTTP** — any third-party LLM (Claude/GPT/custom) implements the
  same `BotView → guess` contract and enters the arena. The brain seam (`solver.ts` + the
  `noob.ts` profile pattern) is already the universal interface; an external brain is just
  another implementation behind it.
- **Async ladder + live races** — async (submit a run on the rotating hidden set anytime; scales
  to unlimited external agents) as the spine; live same-word races (reuse Room/WS) as the show.
- **ELO**, **leagues** (noob→elite, promotion/relegation), **championat** (seasons, brackets,
  live finals).
- **Hidden, rotating, adversarial word sets** + **solve-rate-per-compute** scoring — the move
  that makes external-LLM competition a skill contest and a citation-worthy benchmark
  ("which LLM is the best worduler?").
- **Gold economy** — entry fees, prizes, pari-mutuel **wagering** on live bot races.
- **Add-on slots** — cosmetic (uncapped gold sink) vs power (hard-capped; spending power dings
  your efficiency score) → no pay-to-win.
- **LLM live-commentator** over **deterministic seeded replays** — agents racing as shareable content.
- **Counter-forge** (build to beat a rival's card) and **shareable card images** (social/VEO).

---

## Non-goals (YAGNI for v1)

- External-agent API / MCP, auth, API keys.
- ELO, leagues, seasons, championat, tournaments, wagering.
- Hidden/adversarial dictionaries; compute-budget scoring.
- Add-on store / power-ups / gold purchases.
- Background bot fleet + supervisor view.
- Live bot-vs-bot real-time races (beyond the existing arena seeding) and a unified merged board.

---

## Grounding & assumptions (verified against `origin/main` @ `07362e1`)

The design references these real seams. ✅ = confirmed this session; ⚠️ = confirm exact
DO/KV/snapshot shape in planning.

- ✅ `src/solver.ts` — `BotView = { wordLength, ownGuesses }` (lines 18–20); the universal brain
  input. **Blind invariant** is sacred (no `word` field).
- ✅ `src/noob.ts` — `noobGuess(view, profile, roll)` + `NoobProfile` (the **already-shipped
  config-injected-brain precedent**); `room.ts` already branches between brains on `state.seed`.
- ✅ `src/bots.ts` — `PERSONAS`, `pickPersona`, `projectPlayerForClient` (the `isBot` strip we
  **invert** for owned bots). Note: `PlayerState` has **no `ownerHandle`** today — new field.
- ✅ `src/economy.ts` — `POINTS` + gold math = the efficiency/score basis (client + server share
  it). **Bots are not minted gold today (D1).**
- ⚠️ `src/room.ts` / `src/room-core.ts` / `src/arena*.ts` — `ensureBot()` seat primitive +
  `/seed` flow exist but are **arena/disguise-coupled** (noob profile, slow pacing, 1-human cap);
  summon reuses the primitive, not the flow.
- ✅ Shared-word ranked anchor: the `daily/<YYYY-MM-DD>` key is owned by the **ROOM** DO
  (`room.ts` / `worker.ts:164`), **not** `daily.ts` (which is the singleton scheduler DO at
  `idFromName("daily")`). `/api/daily/<date>/leaderboard` + `/api/user/<name>` confirmed in
  `worker.ts`.
- ⚠️ `src/user-core.ts` / `src/stats.ts` / `src/records.ts` — human stat source. **Confirmed
  gap (D2):** `GameRecord` holds `guesses` (count), `solveGrid?` (daily color rows), `word`,
  `result`, `wordLength`, `finishedAt`, `opponents` — **no guess words, no timing.**
- ✅ `src/leaderboard-core.ts` — `topDaily` ranks and **filters bots out** (`!pl.isBot`, line 39);
  the bot board inverts this. `scoreboard.ts` is per-room W/L/T (not a global board); these
  modules are pure — persistence is in the DOs.
- **Process note:** the local root checkout and `origin/main` have **diverged** (different file
  sets). All grounding above is against the **worktree (`origin/main`)**, which is the canonical
  build target. Re-confirm line-level shapes at implementation time.

---

## Open questions for the owner

1. **Stable size in v1** — one bot per user, or a small stable (e.g. up to 3)?
2. **Daily ranked entry** — does a user *opt in* per day ("send to today's Daily"), or does any
   bot they own auto-enter once?
3. **Cosmetic frames** — ship a small free set in v1, or stub the cosmetic slot and fill it when
   the gold economy lands?
4. **Human card visibility** — is a human's measured card public (on their profile) from v1, or
   private until they opt in?
5. **D2 scope** — is persisting full guess history acceptable storage-wise, or do we derive
   Opener/Risk from a rolling window / online aggregate instead of raw history?
