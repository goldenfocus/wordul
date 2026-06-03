// public/hub.js — the Wordul home: identity bar + The Daily launcher.
// One landing: play today's word, view the day's page, or jump into Solo / Head-to-head.
// (No tabs — the old Arena/Floor/Feed sections weren't real yet, so we don't tease them.)

// Deterministic featured edition for a given date: rotates through the non-default
// editions so every day has a "theme of the day" with no server. Same date -> same
// theme for everyone (UTC day boundary).
export function dayTheme(date, editionIds) {
  const pool = editionIds.filter((id) => id !== "default");
  if (pool.length === 0) return "default";
  const dayNumber = Math.floor(date.getTime() / 86400000);
  return pool[dayNumber % pool.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell render — identity bar + The Daily launcher
// ─────────────────────────────────────────────────────────────────────────────

let hubCallbacks = {};

// Shared, hub-wide state the launcher reads (set on mount from the profile).
export const hubState = { gold: 0, streak: 0, username: "" };

// callbacks: { username, editions, editionName(id), companionIdleLine(), onPlay(editionId),
//              onViewDay(), onSolo(), onPvP(), renderRecentRooms(mountEl) }
// The avatar/menu is the one persistent topbar avatar (#avatarBtn → showHub), already
// wired on load — the hub no longer carries its own bar or avatar.
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

// ─────────────────────────────────────────────────────────────────────────────
// The Daily launcher
// ─────────────────────────────────────────────────────────────────────────────

function renderDaily() {
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  const themeId = dayTheme(new Date(), ids.length ? ids : ["default"]);
  const themeName = hubCallbacks.editionName ? hubCallbacks.editionName(themeId) : themeId;
  const quip = hubCallbacks.companionIdleLine ? hubCallbacks.companionIdleLine() : "The board is waiting.";
  return `<section class="hub-panel daily" id="dailyPanel">
    <article class="daily-hero" data-theme="${themeId}">
      <span class="daily-kicker">Theme of the day</span>
      <h1 class="daily-theme-name">${themeName}</h1>
      <p class="daily-quip muted">${quip}</p>
      <button id="dailyPlay" class="btn primary block hero-btn">▶ Play today's word</button>
      <button id="dailyView" class="hub-textlink" type="button">View today's page →</button>
    </article>
    <section class="hub-modes">
      <span class="section-label">Jump in</span>
      <div class="mode-grid">
        <button id="modeSolo" class="mode-tile" type="button">
          <span class="mode-emoji" aria-hidden="true">⚡</span>
          <span class="mode-name">Solo</span>
          <span class="mode-sub muted">A fresh word, right now</span>
        </button>
        <button id="modePvP" class="mode-tile" type="button">
          <span class="mode-emoji" aria-hidden="true">👥</span>
          <span class="mode-name">Head-to-head</span>
          <span class="mode-sub muted">Race a friend</span>
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
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  const themeId = dayTheme(new Date(), ids.length ? ids : ["default"]);
  const play = document.getElementById("dailyPlay");
  if (play && hubCallbacks.onPlay) play.addEventListener("click", () => hubCallbacks.onPlay(themeId));
  const view = document.getElementById("dailyView");
  if (view && hubCallbacks.onViewDay) view.addEventListener("click", () => hubCallbacks.onViewDay());
  const solo = document.getElementById("modeSolo");
  if (solo && hubCallbacks.onSolo) solo.addEventListener("click", () => hubCallbacks.onSolo());
  const pvp = document.getElementById("modePvP");
  if (pvp && hubCallbacks.onPvP) pvp.addEventListener("click", () => hubCallbacks.onPvP());
  const recent = document.getElementById("dailyRecent");
  const list = document.getElementById("hubRoomList");
  if (recent && list && hubCallbacks.renderRecentRooms) {
    hubCallbacks.renderRecentRooms(list);
    if (list.children.length > 0) recent.hidden = false;
  }
}
