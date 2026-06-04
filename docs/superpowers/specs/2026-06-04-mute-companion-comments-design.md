# Mute the companion's written comments — design

**Date:** 2026-06-04
**Tier:** C (UI-only, reversible, non-money)
**Branch:** `mute-comments`

## Problem

The companion has a personality: it reacts to wins, losses, wrong guesses, idle
stretches, and board wipes. Each reaction surfaces two ways — a **written** toast and
(for big enough moments) a **spoken** voice line. Today the only mute is `wordul.muted`
(the avatar hub's 🔊/🔇 toggle), which silences companion *voice* + UI chimes. It does
nothing to the written toasts. A player who finds the chatty text noisy has no way to
turn it off without also killing every other signal.

This adds an independent control for the **written** companion comments.

## Scope

- **In scope:** the personality reaction lines routed through `showCompanion()`
  (`public/app.js`) — `win`, `loss`, `wrong`, `idle`, `wipe`, etc.
- **Out of scope:** functional toasts (combo flourish, "Theme applied", "Copied to
  share", non-word error feedback). These are gameplay feedback, not chatter, and keep
  firing regardless.
- **Out of scope:** voice. Spoken lines stay governed independently by the existing
  `wordul.muted` sound toggle. "Written" and "spoken" are two separate channels.

## The setting

Add one persisted preference to `DEFAULT_SETTINGS` in `public/settings.js`:

```js
companionComments: true,   // default ON — existing players see no change until they opt out
```

It rides the existing `getSettings()` / `saveSettings()` / localStorage (`wr.settings`)
machinery. No new storage key, no new persistence code.

## The control

A checkbox in the Settings modal, following the exact pattern of `hardMode`,
`reducedMotion`, etc.:

- HTML (`public/index.html`): a new `.setting-row` `<label for="setCompanionComments">`
  added to the **Gameplay** section (the `<section>` holding Hard Mode + Reduced Motion,
  body at `index.html:326`), right after the Reduced Motion row. It reuses the existing
  `.setting-text` / `.setting-name` / `.setting-desc` + `.switch` > `<input
  type="checkbox" id="setCompanionComments">` markup verbatim. Name: **"Companion
  comments"**. Desc: **"Show the companion's written reactions"**.
- JS (`settings.js`, inside `openSettings()`): grab the element
  (`document.getElementById("setCompanionComments")`), set `.checked =
  s.companionComments`, and wire it with the existing `wire(el, key)` helper —
  `wire(cc, "companionComments")`. No new wiring machinery; `wire` already
  clones-to-dedupe listeners and calls `saveSettings` + `onChange`.

Settings-modal-only — no avatar-hub quick toggle (per the approved design).

## The behavior

Gate **only the toast** in `showCompanion()` (`public/app.js`):

```js
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak } = companionReact(event, ctx);
  if (!text) return;
  if (getSettings().companionComments) {        // ← new gate, toast only
    const big = tier && !(event === "wrong" && tier === "normal");
    toast(text, { duration: big ? 4200 : 3200 });
  }
  if (!speak || event === "wipe") return;
  if (raw.includes("{answer}")) speakTemplated(VOICE_EDITION, raw, ctx);
  else speakLine(VOICE_EDITION, raw, text);
}
```

Note the voice path is left entirely outside the gate, so the four combinations all work
independently:

| Sound (`wordul.muted`) | Comments (`companionComments`) | Result |
|---|---|---|
| on  | on  | text toast + voice (today's behavior) |
| on  | off | voice only — the companion talks, no text |
| off | on  | text only — the companion writes, no voice |
| off | off | silent companion |

`app.js` already imports `getSettings` from `settings.js` (`app.js:13`), so the gate needs
no new import and there's no risk of a cycle.

## Components touched

- `public/settings.js` — add `companionComments: true` to `DEFAULT_SETTINGS`; grab + wire
  the checkbox in `openSettings()`.
- `public/index.html` — add the checkbox row to the Gameplay section (after Reduced
  Motion, body at `index.html:326`).
- `public/app.js` — one-line gate around the toast in `showCompanion()` (`app.js:1142`).

## Testing

- `companion.js` is pure line-scoring and is **not** touched — its tests stay green.
- `npm run typecheck` + `npm test` stay green (no type/contract changes).
- Manual dogfood:
  1. Default (comments on, sound on): play a round → wrong/win/loss toasts appear, voice
     speaks. Unchanged.
  2. Comments off, sound on: toggle the checkbox → wrong/win/loss toasts gone, voice
     still speaks; combo flourish + "Theme applied" toasts still appear.
  3. Comments on, sound off: 🔊 mute → toasts appear, no voice. Unchanged from today.
  4. Setting persists across reload (localStorage).

## Risks

- **Low.** One conditional + one persisted bool + one checkbox. Worst case the toast is
  wrongly suppressed, which is cosmetic and instantly reversible by re-toggling.
- Make sure the gate wraps *only* the companion toast, not the voice path or the
  `idle`/`wipe` early-returns — otherwise voice could be silenced as a side effect.
