// public/hub.js — the Wordul home: identity on top, one calm daily card, modes below.
// Tap the card (or just type a letter) to drop into today's board with no reload.
// Stats lives on its own page (premium, easy back) — never an inline expand.
// No OS emoji anywhere on this surface: refined inline SVG glyphs only.

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
// Inline glyphs — currentColor SVG, sized by the parent. No emoji (they cheapen
// the surface and don't theme). Kept tiny and consistent (stroke 1.6, 24-box).
// ─────────────────────────────────────────────────────────────────────────────
const GLYPH = {
  bolt: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>`,
  duo: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M17.5 13.4A5.5 5.5 0 0 1 20.5 19"/></svg>`,
  bars: `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 20v-6M12 20V6M19 20v-9"/></svg>`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shell render — fills the persistent topbar stats, then mounts The Daily.
// ─────────────────────────────────────────────────────────────────────────────

let hubCallbacks = {};

// Shared, hub-wide state the launcher reads (set on mount from the profile).
export const hubState = { gold: 0, streak: 0, username: "" };

// callbacks: { username, editions, editionName(id), onPlay(editionId), onSolo(), onPvP(),
//              onStats(), onSeed(letter), renderRecentRooms(mountEl), fetchPlayed() }
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

// ─────────────────────────────────────────────────────────────────────────────
// The Daily — identity strip on top, one tappable card, modes below.
// ─────────────────────────────────────────────────────────────────────────────

// "3 Jun" style short date for the chosen day (uses local Date for display only).
function shortDate(d) {
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function renderDaily() {
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  const themeId = dayTheme(new Date(), ids.length ? ids : ["default"]);
  const themeName = hubCallbacks.editionName ? hubCallbacks.editionName(themeId) : themeId;
  const tiles = Array.from({ length: 5 }, (_, i) =>
    `<span class="daily-tile${i === 0 ? " is-cursor" : ""}"></span>`).join("");

  return `<section class="hub-panel daily" id="dailyPanel">
    <header class="daily-head">
      <span class="daily-kicker">Today's Wordul</span>
      <h1 class="daily-date">${shortDate(new Date())}</h1>
      <p class="daily-edition">${themeName} <span class="daily-edition-by">· from the Studio</span></p>
    </header>

    <article class="daily-card" id="dailyCard" data-theme="${themeId}"
             role="button" tabindex="0" aria-label="Play today's Wordul">
      <div class="daily-row" aria-hidden="true">${tiles}</div>
      <button class="daily-stats-link" id="dailyStats" type="button" aria-label="See today's stats">
        ${GLYPH.bars}<span class="daily-stats-label" id="dailyStatsLabel">Stats</span><span class="daily-chev" aria-hidden="true">›</span>
      </button>
    </article>

    <section class="hub-modes" aria-label="Other ways to play">
      <div class="mode-grid">
        <button id="modeSolo" class="mode-tile" type="button">
          <span class="mode-ico">${GLYPH.bolt}</span>
          <span class="mode-text"><span class="mode-name">Solo</span><span class="mode-sub">Practice run</span></span>
        </button>
        <button id="modePvP" class="mode-tile" type="button">
          <span class="mode-ico">${GLYPH.duo}</span>
          <span class="mode-text"><span class="mode-name">Head-to-head</span><span class="mode-sub">Live PvP</span></span>
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

  // The card is the play surface: tap, Enter/Space, or just start typing a letter.
  const card = document.getElementById("dailyCard");
  const play = (seed) => { if (hubCallbacks.onPlay) hubCallbacks.onPlay(themeId, seed); };
  if (card) {
    card.addEventListener("click", () => play());
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); }
    });
  }
  // Type-to-play: a bare letter on the home (not in an input) drops you into the
  // board seeded with that letter — "start playing right here, it just expands."
  onHomeTyping = (letter) => play(letter);

  // Stats → its own page (premium, easy back). Never an inline expand.
  const stats = document.getElementById("dailyStats");
  if (stats && hubCallbacks.onStats) stats.addEventListener("click", (e) => { e.stopPropagation(); hubCallbacks.onStats(); });

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

  // Fill the real "N played" count from public daily aggregates (best-effort; the
  // chip reads just "Stats" until/unless a count arrives — never a fake number).
  if (hubCallbacks.fetchPlayed) {
    hubCallbacks.fetchPlayed().then((n) => {
      const el = document.getElementById("dailyStatsLabel");
      if (el && typeof n === "number" && n > 0) el.textContent = `${n.toLocaleString()} played`;
    }).catch(() => {});
  }
}

// Document-level letter capture lives in app.js (it owns the keydown listener while
// the hub is mounted); it calls this when a bare letter is pressed on the home.
let onHomeTyping = null;
export function homeTypeLetter(letter) { if (onHomeTyping) onHomeTyping(letter); }
