# Post-game card dedup + wiki "Continue with AI" — design

**Date:** 2026-06-05 · **Tier:** C (frontend only) · **Approved by:** Yan (chat)

## Problem

1. **End-game word card echoes itself.** `renderWordCard()` (`public/app.js:3418`) shows the
   word twice (big `.ewc-word` text + the OG tile image) and the definition twice (the image's
   baked-in 90-char tagline + the `.ewc-def` text right below it).
2. **The wiki page is a dead end for the curious.** `/word/<word>` has rich intel but no
   "go deeper" path. Yan wants a Google-style "continue with AI" hand-off.

## Decisions (made with Yan)

- **Dedup:** keep the tile image as the hero; drop the text echo. The big word text and def
  text stay in the DOM but **hidden**; `img.onerror` un-hides them (offline / missing PNG /
  no-intel fallback words). The card can never end up empty.
- **AI target:** Google AI Mode — `https://www.google.com/search?udm=50&q=<prompt>`,
  `target="_blank" rel="noopener"`. (Gemini has no public URL-prefill; AI Mode does.)
- **Placement:** wiki page only, in the `.wp-cta` row beside "Play today's Wordul →", styled
  as a quieter ghost button so Play stays primary.
- **Prompt:** `Tell me something surprising about the word "<WORD>" — where it comes from,
  how its meaning has shifted over the centuries, and a cool way it's used today.`

## Changes

| File | Change |
|------|--------|
| `public/app.js` | `renderWordCard`: hide `.ewc-word` + `.ewc-def` via `.ewc-text-fallback` class when intel path renders the image; `preview.onerror` removes the image and un-hides them. Dictionary-fallback path unchanged (def visible — those words may have no OG card). |
| `public/style.css` | `.ewc-text-fallback { display: none }` (+ un-hide state). |
| `scripts/lib/word-page.mjs` | Add `Continue with AI ✦` link (class `wp-ai`) next to `.wp-play` in the CTA block, with encoded AI-Mode URL. |
| `public/word-page.css` | `.wp-ai` ghost-button style (outline sibling of `.wp-play`), wraps on mobile. |
| `public/word/*.html` (2,315) | Regenerated via `npm run wiki:pages` — mechanical. |

## Testing

- Vitest (jsdom-style, matching existing `test/` patterns): end card hides word/def text when
  image present; image `error` event un-hides them; fallback path keeps def visible.
- Generated-page test: a sample page contains `wp-ai` link with `udm=50`, the encoded word in
  the `q=` prompt, and `rel="noopener"`.
- Guards stay green: `ios-input-zoom` (no inputs touched), `no-lateral-scroll` (button wraps).

## Out of scope

- Wiring our own AI/chat (explicitly deferred by Yan — hand-off only).
- Changing the OG card art or its social-share use.
- End-game-card AI link (wiki page only, per decision).
