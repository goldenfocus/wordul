# Pure Immersive UI + Settings Reorg (design)

Date: 2026-06-01
Status: captured from live playtest (Yan). Tier C (frontend). Not yet built.
Companion to: `2026-05-31-gold-economy-leaderboards-design.md`.

## Vision: "make it pure"

During play, strip the chrome so it's **just you + the board + your gold**. Yan,
playing live: "to make everything more pleasant there's only one avatar on top,
and underneath it the username… the only other things that appear are the
superpower boost or the suicide skull."

### Header (in-game)
- **One avatar**, with the **username underneath it**. The avatar **is the hub** —
  tapping it opens everything that currently lives in separate controls: settings,
  sound (mute), stats, theme, etc. (Replaces the scattered ⚙ / 📊 / 🔊 icons.)
- **Gold balance lives in the header** (◆ N), prominent.
- That's it up top: avatar(+name) and gold.

### Hide during play (full immersion)
- Room **name**, the **✎ edit/rename**, and **Share ↗** — hidden in-game.
- The **scoreboard** — hidden in-game.
- Goal: "just you in the game and the gold." (These still need to exist somewhere —
  likely surfaced via the avatar hub or only in the lobby / finished states, not
  during active play.)

### The only things that surface mid-play
- The ✨ **superpower / boost** affordance (the magic power-up — appears only when
  affordable; see gold spec P5.1b).
- The 💀 **"suicide skull"** (give-up / negative power-up — appears when stuck;
  triggers the bankruptcy-style explosion).

> "We'll redesign it nicer but basically make it pure. You see what's there."

## Settings reorg

Opening Settings today is visually heavy ("hurts your eyes — too many colors, too
much stuff"). Organize it:
- **Collapsible sections with chevrons** — group related settings; collapsed by
  default so the panel is calm on open.
- **Keyboard layout → "more/advanced settings"**, and **auto-detect** QWERTY vs
  AZERTY (from the browser/OS locale or first physical keystrokes) so most users
  never touch it.
- General principle: progressive disclosure, less color/noise, a little hierarchy.

## Keyboard polish
- **All keys the same size.** Yan noticed the **I** key rendering narrower than
  **O**. Likely flex/sub-pixel rounding from `flex:1 + max-width`. Fix to truly
  uniform widths — consider a CSS grid keyboard (equal-fraction columns) or a
  fixed key basis so every letter key is identical regardless of glyph width.

## Notes
- All Tier-C frontend; ships freely after local verify.
- The avatar-hub consolidation pairs naturally with retiring the EZ toggle and the
  magic-icon power-up from the gold spec — do them together for a coherent header.
