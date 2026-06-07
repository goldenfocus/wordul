// public/hub-glyphs.js — the home's inline SVG icon set. No OS emoji anywhere on the
// home (they cheapen the surface and don't theme): these are currentColor strokes,
// sized by the parent, consistent weight. Shared by the shell and the daily card.
export const GLYPH = {
  bolt: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>`,
  // Mode glyphs read as a player-count hierarchy: solo = one, duo = two (head-to-head),
  // crowd = many (the Arena). currentColor strokes, no labels needed on the tile.
  solo: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/></svg>`,
  duo: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M17.5 13.4A5.5 5.5 0 0 1 20.5 19"/></svg>`,
  crowd: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7.5" r="2.7"/><path d="M7.6 15a4.5 4.5 0 0 1 8.8 0"/><circle cx="4.6" cy="10" r="2.1"/><path d="M1.8 16.4A3.8 3.8 0 0 1 4.6 13"/><circle cx="19.4" cy="10" r="2.1"/><path d="M22.2 16.4A3.8 3.8 0 0 0 19.4 13"/></svg>`,
  bars: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 20v-6M12 20V6M19 20v-9"/></svg>`,
  swords: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4M7 17l-3 3M3 19l2 2"/></svg>`,
  check: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg>`,
  cross: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  // A line-art skull — the home's mark for "gave up" (vs cross = ran out of guesses).
  // currentColor stroke so it themes; never an OS emoji.
  skull: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 11a6 6 0 0 1 12 0c0 2.2-1 3.6-2.2 4.4v2.2a1.4 1.4 0 0 1-1.4 1.4H9.6a1.4 1.4 0 0 1-1.4-1.4v-2.2C7 14.6 6 13.2 6 11Z"/><circle cx="9.5" cy="11" r="1.6"/><circle cx="14.5" cy="11" r="1.6"/><path d="M12 13.4l-.9 1.5h1.8z"/><path d="M10.5 19v-1.3M12 19v-1.3M13.5 19v-1.3"/></svg>`,
  share: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg>`,
  // Profile vocabulary (faded line art, never OS emoji): lock = spoiler-locked board /
  // secured account; flame = streak; flag = race win; coin = a struck mint (the ◆ diamond
  // echoes the gold HUD) for ledger entries.
  lock: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  flame: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a6 6 0 0 1-6-6c0-3.4 2.4-5 3.4-7.4.8 1 1.2 2.1 1.1 3.4C12.3 9.2 13.4 6.4 13 3c3 2.4 5 5.9 5 9a6 6 0 0 1-6 6Z"/><path d="M12 21c-1.7 0-2.8-1.3-2.8-2.9 0-1.5 1.4-2.4 1.9-3.8.8.9 3.7 1.7 3.7 3.8 0 1.6-1.1 2.9-2.8 2.9Z"/></svg>`,
  flag: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h13l-2.6 4L18 12H5"/><path d="M9.3 4v8M13.7 4v8M5 8h13"/></svg>`,
  coin: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M12 8.4 14.6 12 12 15.6 9.4 12Z"/></svg>`,
};
