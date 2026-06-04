# Room Sandbox — Config Foundation + Always-Speak (all themes)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 1**.

> Cites the canonical schema and merge contract in
> `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md` (the Keystone).
> Cites the shipped scoring engine in
> `docs/superpowers/specs/2026-06-02-smart-companion-engine-design.md` (Subsystem A).
> This rung does **not** redefine `RoomConfig`, the merge rules, or `companion.react` — it consumes them.

---

## Problem

The companion is silent across almost every theme, and even on Yang it skips real progress.

The single gate is `public/app.js` lines 1007-1012:

```js
// Yang keeps its green party; other editions only get nudged on a dud guess.
if (getActiveEditionId() === "yang" && ng >= 1) {
  setTimeout(() => celebrateGreens(ng), flipDoneMs);
} else if (discoveries === 0) {
  showCompanion("wrong", { reusedDeadLetter: wasted.letters.length > 0 });
}
```

Consequences:
1. **Non-Yang editions are near-mute.** They only react on a *zero-discovery* guess. Land a green or a yellow on the Wordul/Arcade theme and nothing speaks.
2. **Yang skips the yellow-only guess.** A guess with `ng === 0` but `ny >= 1` (pure yellows, real progress) falls into neither branch — silent.
3. **There is no "modest progress" voice at all.** The vision's tier (2) — *one green OR any yellows* — has no event and no line bank anywhere.

Note: the voice *clip layer* is already global. `VOICE_EDITION = "yang"` (`edition.js:69`) pins `companionReact` to Yang's banks no matter which visual theme is active, and `showCompanion` always plays through `speakLine(VOICE_EDITION, …)`. So "voice on every edition" needs **no** voice-layer change — only the reaction *trigger* must stop gating on `getActiveEditionId() === "yang"`.

## Goal

Make the companion **never silent**: every valid in-game guess speaks exactly one line, chosen by the canonical priority resolver, on **every** edition. Deliver this as the first concrete slice of the Keystone:

- The pure client module `public/roomConfig.js` exists with **`pickGuessEvent`** and **`mergeConfig`** (the two functions rung 1 actually uses), unit-tested.
- A new **`progress`** event + line bank (~10 lines, Yang's voice) so tier (2) has something to say.
- `companionReact` resolves its `react` config through `mergeConfig(editionDefault, roomConfig?.voice)` so rung 2 can drop persistence in with no further client change.
- Yang's green **confetti** stays Yang-only (cosmetic); the **voice** is global.
- Ships **Tier-C, no backend**: `roomConfig` is read as `{}` (pure edition default). Persistence/protocol is rung 2.

This is the rung that fixes the silence **today**.

---

## Design

### Architecture

Rung 1 implements two of the Keystone's pure functions and rewires the single guess-reaction call site. No server, no new message, no snapshot field.

```
public/roomConfig.js   (NEW, pure, Vitest)        public/edition.js   (companionReact merges voice over react)
  pickGuessEvent(ng, ny, reusedDeadLetter, voice?) ───┐
  mergeConfig(...layers)                              ├──► public/app.js  (guess-reaction branch calls pickGuessEvent)
  CONFIG_CAPS (constant; only what rung 1 reads)      │
                                                      └──► public/editions/yang.js  (+ progress bank, + progress react default)
```

`companion.js` is **untouched** — its scoring functions already take `cfg` as a plain param; rung 1 only changes the object handed in (`mergeConfig` result instead of `ed.companion.react`).

### Components / files (exact paths)

**NEW — `public/roomConfig.js`** (no DOM, no `localStorage`, no imports from `app.js`; Vitest-importable via the `/`-alias in `vitest.config.ts`):

- **`pickGuessEvent(ng, ny, reusedDeadLetter, voice = {})` → `{ event, ctx }`**
  The always-speak priority resolver. Implements the Keystone's resolver verbatim (Keystone §"The always-speak priority resolver"):

  ```
  priority = voice.priority ?? ["greens", "progress", "wrong"]
  for event of priority:
    if voice.events?.[event] === false: continue
    if event === "greens"   && ng >= 2:            return { event: "greens",   ctx: { count: ng } }
    if event === "progress" && (ng === 1 || ny >= 1): return { event: "progress", ctx: {} }
    if event === "wrong":                           return { event: "wrong",    ctx: { reusedDeadLetter } }
  return { event: "wrong", ctx: { reusedDeadLetter } }   // terminal fallback — always speaks
  ```

  - Returns `{ event: "wrong", ctx: { reusedDeadLetter: false } }` even if `wrong` is toggled off in `events` — the terminal fallback guarantees a guess is **never** silent (the toggle suppresses `wrong` as a *priority slot*, not as the last resort). This keeps the "never silent" invariant absolute.
  - `count` on the greens event is the **real** `ng`, so the existing `scoreGreens`/`celebrateGreens` count matches (kills the "two" bug per Subsystem A).
  - `voice` is optional; rung 1 always calls it with `{}` (no override exists yet). The param exists now so rung 2 passes `mergeConfig(...).voice` without changing the signature.

- **`mergeConfig(...layers)` → `RoomConfig`**
  The precedence chain from the Keystone (Keystone §"Merge semantics"). Rung 1 only ever calls it with two layers (`editionDefault.voice`-bearing config, `{}`), but it is variadic from day one so rung 2+ add layers at the call site only. Implements all five locked rules:
  1. sections fall through independently;
  2. objects shallow-merge one level deep, **except `voice.react` deep-merges by sub-key** (`win`/`greens`/`mistake`/`voiceBudget`);
  3. `events` (key-by-key) and `priority` (wholesale) replace;
  4. line banks **append** unless wrapped `{ replace: [...] }`;
  5. `preset` carries provenance (highest non-default layer wins).

  **Default-preserving guarantee (regression contract):** `mergeConfig(editionDefault, {})` deep-equals `editionDefault`.

- **`CONFIG_CAPS`** — the limit constants object from the Keystone (`historyMax: 50`, `bankMax: 24`, `lineMax: 140`). Rung 1 reads only `bankMax`/`lineMax` (inside `mergeConfig` when capping a merged bank). Declared whole so later rungs import the same source of truth.

> `resolvePreset`, `diffConfig`, `PRESETS`, and `sanitizeRoomConfig` are **deferred** to the rungs that use them (Non-goals). Rung 1 ships only `pickGuessEvent` + `mergeConfig` + `CONFIG_CAPS` to honor YAGNI.

**`public/edition.js`** — `companionReact` change is two lines:
- Import `mergeConfig` from `/roomConfig.js`.
- Replace `const react = ed.companion?.react;` with a merge over the (currently empty) room override:
  ```js
  const merged = mergeConfig({ voice: { react: ed.companion?.react ?? {} } }, snapshotVoiceConfig());
  const react = merged.voice?.react;
  const banks = mergedLines(ed.companion?.lines, merged.voice?.lines, event);
  ```
  In rung 1, `snapshotVoiceConfig()` returns `{}` (no snapshot field yet), so `react` resolves byte-for-byte to `ed.companion.react` and `banks` to `ed.companion.lines[event]` — the default-preserving guarantee in live code. The seam is the single place rung 2 wires `snapshot.roomConfig?.voice`.
  - `mergedLines` applies the append-vs-`{replace}` rule for the one resolved event's bank; with an empty override it returns the edition bank unchanged.
- `VOICE_EDITION` stays `"yang"` (Keystone locked decision 10). Untouched.

**`public/editions/yang.js`** — add the `progress` line bank and a `progress` react default:
- New `companion.lines.progress` flat array (~10 lines — see Line bank below).
- `progress` is **not** a routine event (it is not `wrong.normal` or `invalid`), so `shouldSpeak` returns `true` for it without any change to `companion.js`. No `react` threshold is needed for `progress` (flat bank, `resolveTier` returns `null` for it via its `default` case). No edit to `companion.react` required beyond confirming `resolveTier`'s `default → null` already covers `progress` (it does — `companion.js:45`).

**`public/app.js`** — replace the lines 1007-1012 branch with the resolver:
```js
const { event, ctx } = pickGuessEvent(ng, ny, wasted.letters.length > 0 /*, voice */);
// Confetti stays Yang-only + cosmetic; the VOICE is global.
if (getActiveEditionId() === "yang" && event === "greens") {
  setTimeout(() => celebrateGreens(ng), flipDoneMs);   // celebrateGreens already calls showCompanion("greens", { count })
} else {
  setTimeout(() => showCompanion(event, ctx), flipDoneMs);
}
resetIdle();
```
- `ng`, `ny`, and `wasted.letters` are already in scope (app.js:922-923, 937).
- The `setTimeout(..., flipDoneMs)` defers the toast/voice until the row finishes flipping, matching the existing celebrateGreens timing so voice lands as colors reveal.
- **No double-speak:** when `event === "greens"` on Yang, only `celebrateGreens` runs (it internally calls `showCompanion("greens", { count })`); the `else` is skipped. On non-Yang, `greens` flows through `showCompanion` directly (no confetti). For `progress`/`wrong`, `showCompanion` always handles it on every edition.
- The `discoveries === 0` condition is **removed** — that was the silence bug. Every accepted guess now resolves to exactly one event.

### Data flow (one valid guess)

```
server accepts guess → snapshot diff (app.js ~907)
  → compute ng, ny, wasted.letters (existing)
  → pickGuessEvent(ng, ny, reusedDeadLetter, {}) → { event, ctx }
      greens>=2 → "greens" {count:ng}
      else 1 green or any yellow → "progress" {}
      else → "wrong" { reusedDeadLetter }   (sloppy vs normal decided downstream by scoreMistake)
  → Yang + greens? celebrateGreens(ng) [confetti] → showCompanion("greens",…)
    else showCompanion(event, ctx)
        → companionReact(event, ctx)
            react = mergeConfig({voice:{react: yangReact}}, {}).voice.react   // == yangReact in rung 1
            tier = resolveTier(event, ctx, react)   // "progress" → null (flat bank)
            line = round-robin within bank, {answer} substituted
            speak = voiceOn && shouldSpeak(event, tier, react)  // progress: not routine → true
        → toast(line) + speakLine(VOICE_EDITION="yang", raw, text)
```

### Error handling

- **Unknown / malformed `priority`** in `voice` (rung 2+ data): `pickGuessEvent` ignores unrecognized event names by simply not matching any branch for them; if the array yields no match, the terminal `wrong` fallback fires. Never throws.
- **`events` toggles all guess events off:** the terminal `wrong` fallback still fires — never silent (see resolver note).
- **Missing `progress` bank on a non-Yang edition:** irrelevant in rung 1 because `companionReact` always reads `VOICE_EDITION = "yang"`, which **does** have the bank. (If a later rung makes voice per-edition, a missing bank → `companionReact` returns empty text → `showCompanion` early-returns → silent for that one event on that edition, never an error. Keystone §"Error handling".)
- **`mergeConfig` over-cap banks:** a merged bank longer than `CONFIG_CAPS.bankMax` is truncated (not rejected); a line longer than `lineMax` is left to `sanitizeRoomConfig` (rung 2, server-side) — rung 1's only merge input is trusted edition data, so caps are effectively inert this rung but implemented for the contract.

### Line bank — `progress` (Yang's voice)

~10 lines for tier (2): one green OR any yellows landed, but fewer than 2 greens. Warm, encouraging, a notch below the greens-burst energy. **TTS-clean per brief:** ≤ 80 chars, only `[A-Za-z0-9 ,.'?-]` and the em dash. No `{answer}` token (progress reveals nothing). Authored to seed cleanly into `lineKey()`-rendered clips later.

```js
progress: [
  "Ooh, something stuck. We're getting warmer.",
  "There it is, a thread to pull. Keep tugging.",
  "Progress, my favorite person. The word's nervous now.",
  "A little color on the board. I like where this goes.",
  "Yes, that one's talking. Follow it.",
  "Warmer. The puzzle just blinked first.",
  "Now we're cooking. Don't lose the scent.",
  "A clue lands. Quietly thrilling, isn't it?",
  "That's a real lead. Work it, detective.",
  "Mmm, movement. The grid is starting to crack.",
]
```

(Round-robin within the flat bank, same selection path as `invalid`/`idle`.)

### Testing approach

Pure Vitest suites in `test/roomConfig.test.ts` (TDD — write these first, per the global TDD rule). No DOM, no audio.

**`pickGuessEvent` matrix** (the never-silent contract):

| ng | ny | reusedDead | expected event | ctx |
|----|----|-----------|----------------|-----|
| 2  | 0  | false | `greens`   | `{count: 2}` |
| 5  | 1  | false | `greens`   | `{count: 5}` |
| 1  | 0  | false | `progress` | `{}` |
| 0  | 1  | false | `progress` | `{}` |
| 1  | 3  | false | `progress` | `{}` (1 green is still tier 2, not greens) |
| 0  | 0  | true  | `wrong`    | `{reusedDeadLetter: true}` |
| 0  | 0  | false | `wrong`    | `{reusedDeadLetter: false}` |

Plus:
- **Priority override:** `voice.priority = ["wrong","greens","progress"]` with `ng:3` → `wrong` wins (gremlin-style scolding-first).
- **Toggle skip:** `voice.events = { progress: false }` with `ng:0, ny:1` → falls through to `wrong` (progress slot disabled).
- **Never-silent under full mute:** `voice.events = { greens:false, progress:false, wrong:false }`, any inputs → terminal fallback `wrong` (asserts the invariant).
- **Default priority when `voice` absent:** `pickGuessEvent(2,0,false)` with no 4th arg → `greens`.

**`mergeConfig` suite:**
- **Default-preserving regression (the locked contract):** `mergeConfig(yangVoiceConfig, {})` deep-equals `yangVoiceConfig`.
- Section fall-through: `mergeConfig({voice:{talkativeness:1}}, {palette:{}})` keeps `voice` untouched.
- Shallow replace: override `talkativeness` replaces; absent `events` falls through.
- `react` **deep-merge exception:** override `react.win.genius.maxGuesses` keeps `react.greens.thresholds` from the base.
- `events` key-by-key replace; `priority` wholesale replace.
- Line banks **append**: base `wrong.normal:[A]` + override `[B]` → `[A,B]`.
- `{replace}` wrapper: override `wrong.normal:{replace:[B]}` → `[B]` (base discarded).
- Cap: a merged bank exceeding `CONFIG_CAPS.bankMax` is truncated to `bankMax`.

Side-effect glue (`companionReact` merge wiring, the app.js call site, the new `progress` line landing) is verified by manual smoke (Non-goals don't excuse it): play one round on a non-Yang edition, confirm a line speaks on a yellow-only guess; play Yang, confirm confetti still fires on greens and a `progress` line speaks on a lone yellow.

---

## Non-goals (deferred to other rungs)

- **Per-room persistence + protocol** (`RoomConfig` on the snapshot, `set_room_config`/`revert_config`, DO storage, `sanitizeRoomConfig`, `onHello` seed, version history) — **rung 2** (Keystone §Persistence + protocol). Rung 1 reads `roomConfig` as `{}`.
- **Preset chips + talkativeness dial + advanced editor** (`resolvePreset`, `PRESETS`, `settings.js` "Companion & Vibe" section) — **rung 3** (Keystone dependency table).
- **Version history UI** (`configHistory`, `revert_config`, optional on-demand `get_config_history`) — read+revert timeline folds into **rung 03**; richer history-diff UX is a later enhancement.
- **Personal defaults** (`userDefault` merge layer, User DO `defaultRoomConfig`) — **rung 06**.
- **Palette / fonts / rules / creature / economy sections** — stubbed in the Keystone only; economy is Tier A / Sacred.
- **Per-room non-Yang rendered voice** (`voice.voiceEdition`, dynamic `VOICE_EDITION`) — reserved; Keystone locked decision 10 pins `"yang"`.
- **Populating `progress` (and `greens`) banks on non-Yang editions** — moot while `VOICE_EDITION` is pinned to Yang; only relevant once voice goes per-edition. The arcade `rush`→`greens` key migration noted in the exploration is **not** rung 1's problem for the same reason.
- **Live render of the new `progress` lines into Yan's cloned voice** — "Part C"; unrendered lines fall back to `speechSynthesis` (existing behavior).

## Open questions

1. ~~**Progress voice budget.**~~ **RESOLVED (Yan, 2026-06-02).** `progress` speaks based on a configurable `voiceBudget.progress` knob in `voice.react.voiceBudget` (alongside `routine`). DEFAULT = 1.0 (always-speak), honoring "never silent". The room's talkativeness dial can lower it. Rung 1 ships `progress` as always-speak (default 1.0); rung 3's talkativeness dial is the off-ramp. The `voiceBudget.progress` field is defined in rung 00's `VoiceConfig.react` shape.
2. **`progress` toast duration.** `showCompanion`'s `big` flag is `tier && !(wrong.normal)`; `progress` has `tier === null`, so it gets the short 3200ms toast. That's probably right (modest moment), but confirm we don't want `progress` to linger slightly longer than a routine `wrong`.

## Locked decisions

1. **Rung 1 ships exactly two pure functions** — `pickGuessEvent`, `mergeConfig` (+ `CONFIG_CAPS`). Everything else in `roomConfig.js` is deferred to its consuming rung (YAGNI).
2. **Never silent is absolute** — the terminal `wrong` fallback fires even when every guess event is toggled off.
3. **`pickGuessEvent` carries the `voice?` param now**, called with `{}` in rung 1, so rung 2 wires the override with zero signature change.
4. **`companionReact` merges through `mergeConfig`** with an empty override this rung — the one seam rung 2 fills.
5. **Confetti stays Yang-only and cosmetic; voice is global** — the `getActiveEditionId() === "yang"` check survives **only** around `celebrateGreens`, never around the voice.
6. **`progress` is a flat bank with a configurable budget** — `voiceBudget.progress` (defined in rung-00 `VoiceConfig.react.voiceBudget`) defaults to 1.0 (always-speak this rung); no `react` threshold, no `companion.js` change required in rung 1.
7. **`VOICE_EDITION` stays `"yang"`** (inherited from Keystone locked decision 10).
8. **Default-preserving guarantee is a test** — `mergeConfig(editionDefault, {})` ≡ `editionDefault`, enforced in `test/roomConfig.test.ts`.
