# Dare Ritual — clean stage, one-word CTA, spoiler-free gift image

**Date:** 2026-06-07 · **Status:** approved by Yan · **Branch:** `dare-ritual`

## Why

Right after winning the daily, the player is at peak joy — that is THE moment to invite a
friend. Today the moment is cluttered (speaker icon, hacklog chevron, header chat/link
icons compete with the board) and the existing "Challenge a friend" button sits below the
golden card where the eye never lands. And the shared link carries a generic preview
image, wasting the most enticing artifact we have: the player's own golden board.

Three moves: clear the stage, put one golden word between the board and the card, and
make the link itself a gift.

## 1. Stage cleanup — hide chrome during the ritual

When the daily finish ritual begins (settlement teardown → reveal, the moment
`renderDailyUnlock` runs), add a `ritual` state class (e.g. `body.daily-ritual`) that
fades out non-ritual chrome:

| Element | Where | Behavior during ritual |
|---|---|---|
| `#muteBtn` (🔊 speaker) | `.board-gap`, `index.html:227` | hidden (CSS fade) |
| hacklog `▸` chevron + floating line | `#hacklog`, rendered by `hacklog.js` | hidden |
| `#chatToggle` (💬) | header | hidden |
| `#roomLinkBtn` (🔗 copy-link) | header | hidden |

- Nothing is removed from the DOM and nothing changes mid-game; the class is added only
  when the ritual starts. Mute state itself is untouched (only the toggle hides).
- The **revisit path** (`autoPlayBoardOnce` cold-render of a finished daily) applies the
  same class, so a finished day always presents the clean stage.
- CSS-only hiding (opacity/visibility transition) — no JS teardown, so leaving the daily
  page restores everything for other room types.
- The bottom-of-screen share icon in Yan's screenshot is Chrome's own toolbar — out of
  our control, explicitly not in scope.

## 2. The DARE CTA — one golden word between board and card

- Move `#dailyShareBtn` from the `.daily-bridge` section to a new slot **between the
  board and `#dailyReveal`** (markup-wise: a small container after `.board-gap` /
  before `#dailyReveal`, visible only during the ritual).
- Relabel: locale key `daily.challenge` ("Challenge a friend") → **"◆ Dare ◆"**.
  One word; a dare is a challenge + an invitation in a single act.
- Styling: golden pill matching the ritual aesthetic — tile gold (`#f0c14b` family,
  same as the card's first-letter), dark fill, serif or small-caps consistent with
  "AND THE WORD IS". Short word, generous tap target (min 44px height, comfortable
  horizontal padding).
- **Timing:** appears with the golden card's reveal animation (same stage as
  `#dailyReveal` becoming visible), never before — the board replay finishes
  uninterrupted. On revisit it is present immediately alongside the card.
- **Handler unchanged:** the tap still calls `shareDailyResult(...)` on the same
  gesture (it is gesture-safe today, `app.js:2625-2627`; keep it that way).
- Works for losses too — same label, the dare to avenge.

## 3. The gift link — per-player spoiler-free OG image

The shared URL gains the player's own masked board as its link-preview image.

### Pattern encoding (client)

- Tile vocabulary is already `hot` / `warm` / `cold` (`board-replay.js:15` COLORS,
  `guess.mask`). Encode each guess row as 5 chars from `{h,w,c}`, rows joined by `-`:
  e.g. `chwcc-hwcch-hhhhh` (≤ 6 rows → ≤ 35 chars).
- Share URL becomes `location.origin + "/daily/<date>?g=<pattern>"`.
- **Spoiler guarantee:** the pattern is colors only — no letters ever leave the device.
  Same provable property as the existing challenge share card (`share-card.js` masks).
- `shareDailyResult` gains the pattern (threaded from the player's `guesses[].mask`);
  when no mask data is available (e.g. home-page share path, `app.js:287`) it omits
  `?g=` and everything degrades to today's behavior.

### OG image route (worker)

- New route: `GET /daily/og/<date>/<pattern>.png` in `src/worker.ts`.
- Validation: `<date>` must match `\d{4}-\d{2}-\d{2}`; `<pattern>` must match
  `^[hwc]{5}(-[hwc]{5}){0,5}$`. Anything else → 404. The pattern is pure public-safe
  data, so the route needs no auth and is freely cacheable.
- Rendering: `workers-og` (Satori + resvg-wasm — the standard Workers approach).
  The image is the masked board: golden (`hot`), dim-gold/warm, and dark rounded
  tiles on the dark ritual background, letters absent by construction, small Wordul
  wordmark + date. 1200×630. Simple rects + one short text line — satori-friendly.
- Caching: strong `Cache-Control` (immutable — a date+pattern never changes meaning)
  + `caches.default` edge cache, so each distinct board renders once per colo.
- Bundle note: resvg wasm adds ~1–2 MB to the worker bundle; acceptable on the paid
  plan, but verify `wrangler deploy` size after adding the dependency.

### Meta injection (worker)

- When `/daily/<date>` is requested **with a valid `?g=` pattern**, the existing
  HTMLRewriter meta-injection pattern (`data-meta="og:title"` AttrSetters,
  `worker.ts:723-768`, `daily-seo.ts buildDailyMeta`) additionally sets:
  - `og:image` → `/daily/og/<date>/<pattern>.png`
  - `og:title` → teaser, e.g. "You've been dared — Wordul of the Day"
  - `og:description` → spoiler-free line ("Solved in N" is derivable from row count
    of the pattern when the last row is all-hot; otherwise generic).
- Without `?g=` (or with a malformed one): current behavior, static OG — zero change
  to SEO/canonical handling. `?g=` pages should keep the canonical pointing at the
  bare `/daily/<date>` so the parameter never fragments search indexing.

## 4. Share copy

Align the share text with the new word (in `shareDailyResult`):

- Win: `I got today's Wordul in N — I dare you.`
- Loss: `Today's Wordul beat me — I dare you to avenge me.`

## Testing

- **Vitest:** pattern encoder (mask → string) and route validation (valid patterns →
  200 `image/png`; malformed pattern/date, >6 rows, wrong alphabet → 404); meta
  injection (with `?g=` → og:image present and correct; without → unchanged);
  spoiler-safety assertion in the style of the existing share-card tests (encoded
  pattern contains no letters from the answer/guesses by construction — alphabet is
  `{h,w,c,-}` only).
- **Manual:** mobile pass on the preview lane (`wrangler deploy -c
  wrangler.preview.jsonc` → wordul-preview.love-00b.workers.dev): play a daily, verify
  chrome fades when the ritual starts, DARE sits between board and card, share sheet
  carries the `?g=` link, and the OG PNG renders the right colors. Verify revisit
  shows the same clean stage. Check link unfurl in iMessage/Slack.

## Out of scope (YAGNI)

- No challenge-room minting from the daily (the link stays `/daily/<date>`; recipients
  just play the day).
- No personalization of the gift image beyond the board (no usernames/avatars on it).
- No changes to the room/end-modal share card (`share-card.js`) or its flow.
- No removal of the mute/hacklog/chat/link controls outside the ritual.
