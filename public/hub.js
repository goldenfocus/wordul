// public/hub.js — the Wordul home hub: shell + bottom nav + The Daily landing.
// Other tabs (Arena/Floor/Feed) are honest stubs in Phase A. Pure helpers live here too.

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
// TASK 3 — Shell render + tab switching + stub panels
// ─────────────────────────────────────────────────────────────────────────────

let activeTab = "daily";
let hubCallbacks = {};

// Shared, hub-wide state the panels read (set on mount from the profile).
export const hubState = { gold: 0, streak: 0, username: "" };

export function setTab(tab) {
  activeTab = tab;
  const content = document.getElementById("hubContent");
  if (!content) return;
  content.innerHTML = PANELS[tab] ? PANELS[tab]() : "";
  document.querySelectorAll(".hub-tab").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (tab === "daily") wireDaily();
}

function stubPanel(emoji, title, line, extra = "") {
  return `<section class="hub-panel hub-stub">
    <div class="stub-emoji">${emoji}</div>
    <h2 class="stub-title">${title}</h2>
    <p class="stub-line muted">${line}</p>${extra}
  </section>`;
}

const PANELS = {
  daily: () => renderDaily(),
  arena: () => stubPanel("⚡", "The Arena", "Live games to join — coming soon."),
  floor: () => stubPanel("🃏", "The Floor", "Stake tables &amp; buy-ins — coming soon.",
    `<p class="stub-bankroll">Your bankroll: ◆ <span id="floorGold">${hubState.gold}</span></p>`),
  feed:  () => stubPanel("👥", "The Feed", "Your friends' games — coming soon.",
    `<button id="feedInvite" class="btn ghost">＋ Invite friends</button>`),
};

// callbacks: { username, editions, editionName(id), companionIdleLine(), onPlay(editionId),
//              renderRecentRooms(mountEl), onInvite(), openMenu(anchor) }
export function renderHub(profile, callbacks) {
  hubState.gold = (profile && typeof profile.gold === "number") ? profile.gold : 0;
  hubState.streak = profile?.stats?.currentStreak ?? 0;
  hubState.username = callbacks.username ?? "";
  hubCallbacks = callbacks;

  const hub = document.getElementById("hub");
  if (hub) hub.hidden = false;
  const g = document.getElementById("hubGoldVal");
  const s = document.getElementById("hubStreakVal");
  if (g) g.textContent = String(hubState.gold);
  if (s) s.textContent = String(hubState.streak);

  document.querySelectorAll(".hub-tab").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tab)));
  // Note: global topbar has #avatarBtn; hub uses #hubAvatarBtn to avoid duplicate ids.
  const avatar = document.getElementById("avatarBtn") || document.getElementById("hubAvatarBtn");
  if (avatar && callbacks.openMenu) avatar.addEventListener("click", () => callbacks.openMenu(avatar));

  setTab("daily");
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 4 — The Daily panel
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
    </article>
    <div class="daily-stats">
      <span class="stat-card">◆ <strong>${hubState.gold}</strong><span class="muted">Gold</span></span>
      <span class="stat-card">🔥 <strong>${hubState.streak}</strong><span class="muted">Streak</span></span>
    </div>
    <section class="daily-challenges">
      <span class="section-label">Challenges</span>
      <div class="challenge-rail">
        <div class="challenge-card soon">Speed Round<span class="soon-badge">soon</span></div>
        <div class="challenge-card soon">6-Letter Friday<span class="soon-badge">soon</span></div>
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
  const recent = document.getElementById("dailyRecent");
  const list = document.getElementById("hubRoomList");
  if (recent && list && hubCallbacks.renderRecentRooms) {
    hubCallbacks.renderRecentRooms(list);
    if (list.children.length > 0) recent.hidden = false;
  }
  const goldEl = document.querySelector("#dailyPanel .stat-card strong");
  if (goldEl && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) countUp(goldEl, hubState.gold);
}

function countUp(el, to) {
  const start = performance.now(), dur = 600, from = 0;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = String(Math.round(from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
