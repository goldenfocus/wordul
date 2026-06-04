# Vibe Studio — Design (the "total room vibe" editor for Wordul of the Day)

**Status:** design spec, ready for implementation-planning. No code shipped yet.
**Supersedes the planning in:** `docs/HANDOFF-2026-06-03-vibe-studio.md` (this is the focused spec that handoff's "Lane 1" called for).
**Cites (does not redefine):**
- `docs/superpowers/specs/2026-06-02-wordul-of-the-day-design.md` — the `World` bundle, `DAILY` DO, `POST /daily/schedule`, `DAILY_ADMIN_TOKEN`.
- `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md` — the canonical `RoomConfig` schema, `mergeConfig`, version log. The studio's voice editing is a UI over **that** schema; it must not redefine it.

**Design exploration that produced this (live, playable):**
- Primary direction chosen — **Stage**: https://wordul.com/designs/vibe-studio-stage (source: `docs/prototypes/vibe-studio/workshop.html` + the stage iterations)
- Rejected alternates: `/designs/vibe-studio-console` (B), `/designs/vibe-studio-ritual` (C). Two ideas were salvaged from them (see Decisions).

---

## North star (the full vision, for context)

A curator opens a beautiful, joyful editor and authors a *whole day*: a title, a word, a coherent palette that re-lights everything live, a companion voice (with escalating "curse" lines for repeat mistakes), a personal story, background imagery, and a room soundtrack — and **sees the assembled day as they build it**, so a clash like the 2026‑05‑31 daily (purple unlock veil fighting the board) can never ship again. Later: AI assists (generate a vibe, expand the story, make music), voice cloning, the hidden‑word creative gift, and a winner‑curates‑tomorrow loop. The editor is the front door to the broader Room Sandbox vision — one extensible `roomConfig`, progressively disclosed.

---

## Goal of this spec (v1 — manual, no AI on the critical path)

Ship the **Stage** editor and the **themed day page** it produces, end to end, for **admins and assigned curators**, with **zero AI dependency**. Concretely, v1 delivers:

1. An extended `World` bundle (additive, back‑compatible) carrying title, colors, per‑zone glow, images, `roomConfig` voice, guesses, playlist.
2. A **studio UI** (the Stage surface) to author every one of those, with live themed preview.
3. A **theme‑driven day page** (kills the clash) that renders the enriched `World`.
4. **Role‑scoped scheduling** (admin any‑date / curator locked‑to‑assigned‑date) over the existing schedule path.

AI ("spin a vibe", "expand story", "make music with Suno"), voice **cloning**, and the hidden‑word gift are **seams only** in v1 — visible, clearly optional ghosts that never block a manual day.

---

## Non-goals (deferred — keep OUT of v1)

- **AI vibe generation** (prompt → palette+voice+starter). Ghost button only.
- **AI story expansion + image/video generation.** The story "✨ continue" sparkle is a *seam* with mocked output in the prototype; the real model call is v2.
- **Voice cloning backend** (record/upload → tunnel → train). UI affordance only; ties to `[[yang-edition-golden-voice]]` + the voice-line arc remote-render/clone parts.
- **AI music (Suno).** Ghost button; real generation later.
- **Hidden‑word creative gift** (Minecraft/Roblox/SimCity). Rides on `World.bonusWord`, which `daily-core.ts:7` marks RESERVED "no behavior yet." Whole separate product.
- **Winner‑curates‑tomorrow loop.** `World.curator` is RESERVED; the *credit* render is in scope (below), the *claiming* flow is not.
- **Persistent‑room vibe forking / version history UI.** `roomConfig` already versions (keystone); exposing browse/revert in the studio is later.

---

## The chosen direction: Stage (WYSIWYG)

Three directions were prototyped. **Stage won**: the day artifact *is* the editable canvas — you edit the real themed surface (click the title, write the story in place, type into the board) while floating glass tools recolor and reconfigure it live. This most directly serves the north‑star job ("see the clash before it ships") because there is no separate abstract form — you are always looking at the day.

Salvaged from the rejected directions:
- From **Console (B)**: the footer becomes a **room MP3 player** that auto‑plays on entry.
- From **Ritual (C)**: a **consistent glow** (fixed aurora) that persists while scrolling the whole studio.

---

## Decisions (locked)

Design language and behavior, converged through the ritual + live feedback. These are settled; the plan implements them.

### Aesthetic
- **Glass Aurora, ZERO pills** ([[wordul-no-pills-glass-aesthetic]]). No chips/capsules anywhere. The primary **Submit/Schedule action is NOT a rounded pill** — it is text + arrow + glow underline. Buttons are glass with dissolved edges or text‑with‑glow.
- **Consistent scroll glow** — a fixed, palette‑driven aurora behind the entire studio and day page.

### Word & board
- **Word is set in ONE place** — the "Word & size" tool (settings), never typed into the canvas board. The board on the canvas is **test‑play only**.
- The chosen word **surfaces as a label above the grid**, live.
- **Variable length 4–12 letters**; the board **reflows live** (tile size is CSS‑derived from column count, not JS px — required for mobile).
- **Variable guesses (rows) 3–10**, default 6, also set in "Word & size", reflows live.
- **Invented words are allowed and become a feature** ("guess the curator's coinage"). A **soft, non‑blocking dictionary check** labels a word real (✓) vs invented (✨). The only **hard** gate is length 4–12. → *This requires relaxing `normalizeWorld`'s pool rejection; see Architecture.*

### Palette / light
- Color tools are exactly two: **three individual swatch pickers** (tap each to recolor) **+ Random harmony**. Sparkle‑from‑title and screen eyedropper are **removed**.
- Changing a color **re‑lights everything live** via CSS variables (`--a1/--a2/--a3`): board greens, glows, aurora, day chrome.

### Voice (the companion)
- The companion **is** the voice. A **🎙 mic** opens the voice editor; a **▶ play button beside the mic** previews / speaks the current line (and toggles "speak lines aloud as they fire"). The old separate toggle row is gone.
- **Voice picker** — an elegant dropdown of available voices. v1 = system `speechSynthesis` voices (real, free, works today). The same control later gains **Wordul's curated voices** and the curator's **cloned voice** as options — interface unchanged.
- **Real TTS in‑editor**: lines can be read aloud (`speechSynthesis`); when "speak aloud" is on, the companion speaks reactions during test‑play.
- **Per‑line custom audio**: any line can have an uploaded `wav/mp3` that plays instead of TTS.
- **Simple + Advanced**: default shows the core "greens" lines + voice picker + frequency. **Advanced** unfurls every category, including the **escalating repeat‑mistake tiers (1st gentle / 2nd pointed / 3rd+ "the curse bites")**, add‑line, and the cloning affordance. (Repeat‑mistake escalation is the existing `[[wordul-default-theme-and-curse]]` curse, authored here.)
- **Frequency / talkativeness** slider → maps to `roomConfig.voice` talkativeness.

### Story
- Manual `story.body` (long form). As the curator writes, a **✨ "let AI continue"** sparkle appears. It **shows the prompt it would send** (teaching the prompting language) and offers three tones: **Inspirational · Educative · Mind‑blowing**. v1 = seam (mocked completion); the real call is v2. Manual text always stands alone.

### Images & glow
- Upload a background image into any of **three bands — header / middle / footer**.
- **Glow is per image** — each band has its own glow dial ("lock the hour" per band) — *plus* one **atmosphere glow** for the aurora.

### Room sound
- A **real MP3 player** look: album art, prev / play / next, **seekable scrubber**, current/duration times, playlist. Curator uploads mp3s; **auto‑plays when a player enters the room**.
- Future: **make a theme with Suno** (AI music, ghost). Consider building the player as a reusable **GoldenBlock** (the user notes we have mp3‑player code in other projects — reuse rather than rewrite).

### Where leaderboard + celebration live
- The **leaderboard and the winner/celebration ("warded by", curator credit) are NOT in the studio** — they are the **published day page, post‑play**. The studio is the authoring surface; those are outcomes. (They appeared in early prototypes inside the editor and read as confusing.)

### Scheduling by role (the meaningful one)
- **Admin** (holds `DAILY_ADMIN_TOKEN`): may edit/schedule **any date** on the calendar (a date picker).
- **Curator** (assigned a specific date): may **only** author **their assigned date**; the date is **locked and unchangeable** in the UI *and enforced server‑side*. "Submit my day," not "schedule."
- "Tomorrow" is removed from the language entirely.

### Mobile (must be elegant)
- **Tap the board → soft keyboard** via a hidden capture input (`font-size:16px` to stop iOS zoom; routes `beforeinput`/keydown into the board). Desktop physical typing path is unchanged.
- Tool panels are **bottom sheets** (full‑width, grab handle, dim backdrop) above a **bottom tool toolbar**; the **schedule bar moves to the top** and is **scroll‑aware** (hides on scroll‑down, returns on scroll‑up — "not floating all the time").
- **Responsive board** (CSS tile sizing); **board‑first** on load (no sheet covering it).

---

## Architecture & integration

### Data model — extend `World` (additive, optional, back‑compatible)
`World` lives in `src/daily-core.ts`. Today: `date, word, bonusWord?, edition, voice, story{title,body,tip?}, curator?, createdAt`. Add **only optional** fields so every already‑scheduled day still resolves:

```ts
interface World {
  // …existing…
  vibeTitle?: string;                       // the day's display title (header). Falls back to story.title.
  rows?: number;                            // guesses, 3–10. Default 6.
  invented?: boolean;                       // word is an intentional coinage (skip dictionary gate)
  colorScheme?: { a1: string; a2: string; a3: string };  // the 3 colors; default derived from edition
  glow?: { atmosphere?: number; header?: number; middle?: number; footer?: number }; // 0–1
  images?: { header?: string; middle?: string; footer?: string }; // R2 keys
  roomConfig?: RoomConfig;                  // FROM the keystone — voice lines/banks/react/talkativeness, etc.
  lineAudio?: Record<string, string>;       // "greens:0" → R2 key of an uploaded clip (or fold into roomConfig.voice)
  playlist?: { keys: string[]; autoplayOnEntry?: boolean }; // R2 keys of mp3s
}
```
`story.body` already supports long text; rich media is handled via `images` + `playlist`, not inline markup, in v1.

### `normalizeWorld` — back‑compat + the invented‑word change
`normalizeWorld` (daily-core.ts:63) is the single validated entry point and must:
- **Default** every new field when absent so old Worlds render unchanged (`rows ??= 6`, `colorScheme` from edition, empty `images`/`playlist`, `roomConfig ??= {}` = pure edition default).
- **Relax the dictionary gate** (currently daily-core.ts:72‑73 rejects any word not in `WORDS_BY_SIZE[len]`). New rule: a word is accepted if it is **either** (a) in the pool for its length **or** (b) `invented === true`. Length 4–12 + `^[A-Z]+$` remain hard. This is what lets coinages ship as "guess my word."
- Validate/clamp `rows` (3–10), `glow` (0–1), `colorScheme` (hex/`hsl`), `roomConfig` via the keystone's `sanitizeRoomConfig()`.
- *Open:* confirm `WORDS_BY_SIZE` has pools for all of 4,6–12 (length 5 is special). Lengths without a pool only work in `invented` mode. (See Open items.)

### Voice = `roomConfig`, not a new field
The studio's voice editor reads/writes **`roomConfig.voice`** per the Room Sandbox keystone (`mergeConfig`, `set_room_config`, the `lines`/`react`/`talkativeness` shape). The daily seeds `roomConfig` into the day's room (like it already seeds `edition`/`voice`/`story`), so companion reactions use the curated lines via the existing `pickGuessEvent`/`companionReact` path. The chosen **voiceId** (system/Wordul/cloned) and per‑line audio attach to the voice section. **Do not invent a parallel voice schema.**

### Day page — theme‑driven rendering (kills the clash)
`renderDailyUnlock` (`public/app.js`) + `.daily-unlock` (`public/style.css:2249+`) become fully theme‑driven:
- Pull `colorScheme` → CSS vars; the hardcoded purple veil at **`style.css:2266` (`.daily-unlock::before`)** must use `var(--accent)`/`colorScheme` or be per‑vibe — this is the clash source.
- Apply `images` (header/middle/footer) with per‑zone glow; render long `story.body`; play `playlist` on entry.
- **Post‑play surfaces** (leaderboard, celebration/"warded by" curator credit from `World.curator`) live here, not in the studio.

### Lane 0 — ship the clash fix independently (no studio needed)
A standalone Tier‑C fix that closes the original pain now: `.daily-unlock::before` → `var(--accent)` + edition‑scoped overrides, and fix `houseWorld` (daily-core.ts:42‑55) so the fallback uses a **coherent** edition+voice (not `default`+`yang`). Ships before/independent of the studio.

### Role‑scoped scheduling
Admin path exists: `worker.ts:92‑99` checks `Bearer DAILY_ADMIN_TOKEN` → forwards to the `DAILY` DO `/schedule`; `daily.ts:43‑44` runs `normalizeWorld`. v1 adds the **curator** path:
- An **assignment record**: `date → { curator, token }` (new; stored on the DAILY DO). How assignments are created is admin‑only (out of deep scope; a simple admin action).
- A curator submits with their token; the server **looks up the assignment for the target date, verifies the token, and forces `world.date` to the assigned date** (ignores any client‑supplied date). A curator can never write another day. Admins (full token) bypass the assignment check and may target any date.
- The UI reflects this: curator sees a 🔒 locked date; admin sees a date picker. **The lock is server‑enforced, not just UI.**

---

## Studio surface (the Stage, section by section)

The page reads top‑to‑bottom as the *day itself*; a floating glass tool rail opens each editor.
- **Header** — editable **title** (`vibeTitle`), date/role line, optional header image.
- **Board + voice** — the word label above a live, test‑playable board (variable length/rows); the **companion** card with 🎙 edit + ▶ play; companion speaks reactions when "speak aloud" is on.
- **Story** — in‑place long text + the ✨ AI‑continue sparkle (tones, prompt shown).
- **Room sound** — the real MP3 player (footer band, optional footer image behind it).
- **Tools (rail → bottom sheets on mobile):** Word & size · Palette · Voice · Images & glow.
- **Schedule bar:** role switch (admin/curator) + role‑aware date + Submit/Schedule (non‑pill).

The studio does **not** render leaderboard/celebration. (Optional later: a "preview the finished day" view that opens the real day page.)

---

## Flow

**Curator (assigned a date):**
1. Opens studio at their assigned date (locked). 2. Sets word + guesses (sees real/invented badge). 3. Picks palette / rolls harmony — day re‑lights. 4. Writes voice lines (core + advanced curse tiers), picks a voice, optionally attaches audio. 5. Writes the story (optionally ✨‑continues). 6. Uploads images + tunes per‑band glow; uploads room mp3s. 7. **Submit my day** → `POST /daily/schedule` (curator token) → server pins it to the assigned date.

**Admin:** same, but a **date picker** for any day; full `DAILY_ADMIN_TOKEN`.

**Player (next day, the published page):** finishes the word → sees the themed day (chrome from `colorScheme`, images, long story, room music), the companion voiced as authored, then **leaderboard + celebration** with the curator credit.

---

## Testing
- **Pure (`daily-core`):** `normalizeWorld` defaults every new field; back‑compat (an old World with none of the new fields normalizes unchanged); invented‑word acceptance only when `invented:true`; `rows`/`glow`/`colorScheme` clamping; curator date‑pinning logic.
- **roomConfig:** voice authoring round‑trips through `mergeConfig`/`sanitizeRoomConfig` (keystone tests).
- **Day page:** renders themed from a colorScheme without the purple clash; renders with/without images, playlist, long story.
- **Auth:** curator token can only write its assigned date; wrong/absent token → 401; admin token → any date.
- **Manual smoke:** schedule a day in studio → open it as a player → confirm "what you saw is what shipped."

## Build order (hand to `writing-plans` next)
1. **Lane 0** clash fix (independent, today).
2. `World` schema + `normalizeWorld` defaults/invented + tests.
3. Day‑page theme‑driven rendering (colorScheme/images/glow/story/playlist) + clash removal.
4. Studio shell + Word/size, Palette (the cheap, high‑signal core).
5. Voice editor over `roomConfig` (picker, lines, advanced curse tiers, TTS, per‑line audio, frequency).
6. Images & glow; Room MP3 player (consider GoldenBlock).
7. Role‑scoped scheduling (curator assignment + server date‑pin).
8. Mobile pass (bottom sheets, keyboard capture, scroll‑aware top bar, responsive board).
9. AI/clone/Suno/hidden‑gift **seams** wired to stubs.

## Open items
- **`WORDS_BY_SIZE` coverage** for lengths 4,6–12 — which exist? Lengths without a pool are invented‑only. Confirm before promising "4–12."
- **Curator assignment storage + admin assignment UI** — minimal shape (date→curator/token) on the DAILY DO; how an admin assigns. Needs a short design.
- **Media storage** — R2 bucket + key convention for images/mp3s/line‑audio referenced from `World`; upload path from the studio (signed PUT vs worker proxy).
- **GoldenBlock for the MP3 player** — does a reusable block already exist to vendor, or do we make one?
- **"B.E.O." credit** (seen in early celebration mock) — define or drop; do not ship an undefined acronym.
- **Suno vs Sonos** — confirmed AI‑music = **Suno**; flagged in case hardware (Sonos) was meant.

## References
- Handoff / lanes: `docs/HANDOFF-2026-06-03-vibe-studio.md`
- Daily contract: `docs/superpowers/specs/2026-06-02-wordul-of-the-day-design.md`
- `roomConfig` keystone: `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md`
- Code: `src/daily-core.ts` (`World`, `normalizeWorld`, `houseWorld`), `src/daily.ts` (`/schedule`), `src/worker.ts:92` (admin auth), `public/app.js` (`renderDailyUnlock`), `public/style.css:2249` (`.daily-unlock`)
- Live prototype: https://wordul.com/designs/vibe-studio-stage · gallery https://wordul.com/designs/ · source `docs/prototypes/vibe-studio/`
