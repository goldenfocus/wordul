// public/hub.js — the Wordul home shell: identity on top, the daily card, modes below.
// The daily card (play + post-play states + countdown) lives in daily-card.js; the
// shared icon set in hub-glyphs.js. This file orchestrates the shell + topbar stats.
import { GLYPH } from "/hub-glyphs.js";
import { dayTheme, renderDailyCard, wireDailyCard } from "/daily-card.js";

// Re-exported for back-compat: app.js and tests import dayTheme from here.
export { dayTheme };

let hubCallbacks = {};

// Shared, hub-wide state the shell reads (set on mount from the profile).
export const hubState = { gold: 0, streak: 0, username: "" };

// callbacks: { username, editions, editionName(id), onPlay(editionId, seed), onSolo(),
//   onPvP(), onArena(), onStats(), onShareDaily(), dailyResult, renderRecentRooms(el), fetchPlayed() }
// dailyResult is null until you've played today, then { won, guesses }.
// The avatar/menu is the one persistent topbar avatar (#avatarBtn → showHub).
export function renderHub(profile, callbacks) {
  hubState.gold = (profile && typeof profile.gold === "number") ? profile.gold : 0;
  hubState.streak = profile?.stats?.currentStreak ?? 0;
  hubState.username = callbacks.username ?? "";
  hubCallbacks = callbacks;

  const hub = document.getElementById("hub");
  if (hub) hub.hidden = false;
  // Reveal the home-only gold + streak in the persistent topbar (mount() cleared it).
  document.body.classList.add("hub-home");
  const g = document.getElementById("hubGoldVal");
  const s = document.getElementById("hubStreakVal");
  if (g) g.textContent = String(hubState.gold);
  if (s) s.textContent = String(hubState.streak);
  // Streak only shows when there IS one — no cold flame sitting at 0.
  const streakEl = document.getElementById("hubStreak");
  if (streakEl) streakEl.hidden = hubState.streak <= 0;

  const content = document.getElementById("hubContent");
  if (content) { content.innerHTML = renderDaily(); wireDaily(); }
}

function shortDate(d) { return d.toLocaleDateString("en-US", { day: "numeric", month: "short" }); }

function themeOfDay() {
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  return dayTheme(new Date(), ids.length ? ids : ["default"]);
}

function renderDaily() {
  const themeId = themeOfDay();
  const themeName = hubCallbacks.editionName ? hubCallbacks.editionName(themeId) : themeId;
  return `<section class="hub-panel daily" id="dailyPanel">
    <header class="daily-head">
      <span class="daily-kicker">Today's Wordul</span>
      <h1 class="daily-date">${shortDate(new Date())}</h1>
      <p class="daily-edition">${themeName} <span class="daily-edition-by">· from the Studio</span></p>
    </header>

    ${renderDailyCard({ themeId, result: hubCallbacks.dailyResult ?? null })}

    <section class="hub-modes" aria-label="Other ways to play">
      <div class="mode-grid mode-grid-3">
        <button id="modeSolo" class="mode-tile" type="button" aria-label="Solo" title="Solo">
          <span class="mode-ico">${GLYPH.solo}</span>
        </button>
        <button id="modePvP" class="mode-tile" type="button" aria-label="Head-to-head" title="Head-to-head">
          <span class="mode-ico">${GLYPH.duo}</span>
        </button>
        <button id="modeArena" class="mode-tile" type="button" aria-label="Arena" title="Arena">
          <span class="mode-ico">${GLYPH.crowd}</span>
        </button>
      </div>
    </section>

    <section class="daily-recent" id="dailyRecent" hidden>
      <span class="section-label">Recent</span>
      <ul id="hubRoomList" class="room-list"></ul>
    </section>
  </section>`;
}

function wireDaily() {
  // The card owns its own events; we register its type-to-play handler for the home
  // keydown listener (a no-op in the post-play state).
  const { onType } = wireDailyCard({
    themeId: themeOfDay(),
    result: hubCallbacks.dailyResult ?? null,
    onPlay: hubCallbacks.onPlay,
    onStats: hubCallbacks.onStats,
    onShareDaily: hubCallbacks.onShareDaily,
    fetchPlayed: hubCallbacks.fetchPlayed,
  });
  onHomeTyping = onType;

  const solo = document.getElementById("modeSolo");
  if (solo && hubCallbacks.onSolo) solo.addEventListener("click", () => hubCallbacks.onSolo());
  const pvp = document.getElementById("modePvP");
  if (pvp && hubCallbacks.onPvP) pvp.addEventListener("click", () => hubCallbacks.onPvP());
  const arena = document.getElementById("modeArena");
  if (arena && hubCallbacks.onArena) arena.addEventListener("click", () => hubCallbacks.onArena());

  const recent = document.getElementById("dailyRecent");
  const list = document.getElementById("hubRoomList");
  if (recent && list && hubCallbacks.renderRecentRooms) {
    hubCallbacks.renderRecentRooms(list);
    if (list.children.length > 0) recent.hidden = false;
  }
}

// Document-level letter capture lives in app.js (it owns the keydown listener while
// the hub is mounted); it calls this when a bare letter is pressed on the home.
let onHomeTyping = null;
export function homeTypeLetter(letter) { if (onHomeTyping) onHomeTyping(letter); }
