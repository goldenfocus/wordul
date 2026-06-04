# Mute Companion Written Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give players a Settings toggle that hides the companion's written reaction
toasts, independent of the existing sound mute.

**Architecture:** Add one persisted boolean (`companionComments`, default `true`) to the
existing `wr.settings` store, expose it as a checkbox in the Settings modal's Gameplay
section (reusing the established toggle markup + `wire()` helper), and gate **only** the
companion toast in `showCompanion()` so voice stays governed separately by `wordul.muted`.

**Tech Stack:** Vanilla ES modules in `public/`, vitest + jsdom for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-04-mute-companion-comments-design.md`

---

### Task 1: Add the `companionComments` default setting

**Files:**
- Modify: `public/settings.js:15-23` (DEFAULT_SETTINGS)
- Test: `test/settings.test.js`

- [ ] **Step 1: Write the failing test**

Add these two tests to `test/settings.test.js` inside the existing `describe("getSettings", …)`
block (after the "merges stored values" test):

```js
it("defaults companionComments to true (companion text reactions on)", () => {
  expect(getSettings().companionComments).toBe(true);
});
it("lets a stored companionComments=false override the default", () => {
  localStorage.setItem("wr.settings", JSON.stringify({ companionComments: false }));
  expect(getSettings().companionComments).toBe(false);
  expect(getSettings().hardMode).toBe(false); // other defaults preserved
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- settings`
Expected: FAIL — `companionComments` is `undefined`, so `expect(undefined).toBe(true)` fails.

- [ ] **Step 3: Add the default**

In `public/settings.js`, add the key to `DEFAULT_SETTINGS` (after `communityScience: true,`):

```js
export const DEFAULT_SETTINGS = {
  hardMode: false,
  colorBlind: false,
  reducedMotion: false,
  communityScience: true,
  // Companion's written reaction toasts (win/loss/wrong/idle/wipe). On by default;
  // independent of the 🔊 sound mute, which governs companion VOICE + chimes.
  companionComments: true,
  // "auto" = detect from browser/OS locale (fr-* → AZERTY) until the player picks
  // explicitly in settings; an explicit pick is persisted and always wins.
  keyboardLayout: "auto",
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- settings`
Expected: PASS — all settings tests green, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add public/settings.js test/settings.test.js
git commit -m "feat(settings): companionComments preference (default on)"
```

---

### Task 2: Add the checkbox to the Settings modal and wire it

**Files:**
- Modify: `public/index.html:337-346` (Gameplay section — add a row after Reduced Motion)
- Modify: `public/settings.js:85-110` (`openSettings` — grab + wire the new checkbox)

- [ ] **Step 1: Add the checkbox row to the Gameplay section**

In `public/index.html`, immediately AFTER the Reduced Motion `<label>` (the one closing at
`index.html:346`) and BEFORE the `</div>` that closes the Gameplay `.settings-section-body`,
insert:

```html
        <label class="setting-row" for="setCompanionComments">
          <div class="setting-text">
            <div class="setting-name">Companion comments</div>
            <div class="setting-desc">Show the companion's written reactions</div>
          </div>
          <span class="switch">
            <input type="checkbox" id="setCompanionComments" />
            <span class="switch-slider" aria-hidden="true"></span>
          </span>
        </label>
```

- [ ] **Step 2: Grab the element in `openSettings()`**

In `public/settings.js`, in the block that grabs the other checkboxes (currently
`const hm = … cs = document.getElementById("setCommunityScience");`), add:

```js
  const cc = document.getElementById("setCompanionComments");
```

Then, alongside the other `if (xx) xx.checked = s.xx;` lines, add:

```js
  if (cc) cc.checked = s.companionComments;
```

- [ ] **Step 3: Wire the toggle**

In `public/settings.js`, next to the other `wire(...)` calls (after `wire(cs, "communityScience");`), add:

```js
  wire(cc, "companionComments");
```

(No new wiring code — `wire(el, key)` already clones-to-dedupe the listener, persists via
`saveSettings`, and calls `onChange`.)

- [ ] **Step 4: Typecheck + run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS — no type errors; all existing tests (settings, companion, etc.) stay green.
(No unit test for the modal DOM wiring — `openSettings` needs the full modal markup and is
verified by dogfood in Task 4. This step just confirms nothing regressed.)

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/settings.js
git commit -m "feat(settings): Companion comments checkbox in Gameplay section"
```

---

### Task 3: Gate the companion toast in `showCompanion()`

**Files:**
- Modify: `public/app.js:1142-1153` (`showCompanion`)

- [ ] **Step 1: Wrap ONLY the toast in the setting check**

In `public/app.js`, change `showCompanion()` from:

```js
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak } = companionReact(event, ctx);
  if (!text) return;
  // Big moments linger; routine lines stay snappy.
  const big = tier && !(event === "wrong" && tier === "normal");
  toast(text, { duration: big ? 4200 : 3200 });
  // The wipe aside is text-only — it fires often enough that voicing it would grate.
  if (!speak || event === "wipe") return;
  // Templated lines (the loss reveal) split across Yan's voice + the robot.
  if (raw.includes("{answer}")) speakTemplated(VOICE_EDITION, raw, ctx);
  else speakLine(VOICE_EDITION, raw, text);
}
```

to:

```js
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak } = companionReact(event, ctx);
  if (!text) return;
  // The written toast is opt-out via Settings → Companion comments. Voice is governed
  // separately by the 🔊 sound mute (wordul.muted), so the two channels stay independent.
  if (getSettings().companionComments) {
    // Big moments linger; routine lines stay snappy.
    const big = tier && !(event === "wrong" && tier === "normal");
    toast(text, { duration: big ? 4200 : 3200 });
  }
  // The wipe aside is text-only — it fires often enough that voicing it would grate.
  if (!speak || event === "wipe") return;
  // Templated lines (the loss reveal) split across Yan's voice + the robot.
  if (raw.includes("{answer}")) speakTemplated(VOICE_EDITION, raw, ctx);
  else speakLine(VOICE_EDITION, raw, text);
}
```

Note: `getSettings` is already imported at `app.js:13` — no new import. The voice path and
the `idle`/`wipe` early-returns stay OUTSIDE the gate so muting text never silences voice.

- [ ] **Step 2: Typecheck + run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS — `companion.js` is untouched and its tests stay green; no type errors.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(companion): gate written reaction toasts behind companionComments setting"
```

---

### Task 4: Manual dogfood verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server boots; open the printed local URL.

- [ ] **Step 2: Default state (comments on, sound on)**

Play a round. Make a wrong guess, then win or lose.
Expected: companion text toasts appear (wrong/win/loss); voice speaks on big moments.
This is unchanged from before.

- [ ] **Step 3: Turn comments off**

Open the avatar hub → Settings → Gameplay → toggle **Companion comments** OFF. Close
Settings, play another round.
Expected: NO companion text toasts on wrong/win/loss/idle/wipe. Voice still speaks (sound
is on). Functional toasts still appear: trigger a multi-letter combo ("✦ N× COMBO …") and
apply a theme ("Theme applied …") — both still show.

- [ ] **Step 4: Independence + persistence**

With comments still OFF, use the hub 🔊 to mute sound. Play: companion is fully silent
(no text, no voice). Un-mute sound: voice returns, text still suppressed. Reload the page,
reopen Settings → confirm **Companion comments** is still OFF (persisted in localStorage).

- [ ] **Step 5: Final gate check**

Run: `npm run typecheck && npm test`
Expected: PASS — clean typecheck, full suite green.
