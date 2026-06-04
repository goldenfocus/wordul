// public/daily-card.js — the heart of the home: today's Wordul as one calm card.
// Two states, one surface:
//   • play invitation — a 5-tile row you tap (or just start typing) to bloom into
//     the board; a quiet Stats chip.
//   • post-play recap — once you've finished today: your result, a live countdown
//     to the next word, and Share / Stats. No replay teleport.
// The shell (hub.js) supplies the header + modes; this file owns the card.
import { GLYPH } from "/hub-glyphs.js";

const MEDALS = ["🥇", "🥈", "🥉"];
function escAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, ""); } // usernames are [a-z0-9_-]
function fmtGold(n) { return `${Number(n).toLocaleString()}g`; }

// Build the leaderboard HTML from a LeaderboardView ({ top, you, total }) and the
// viewer's own username. Top-3 medal rows; your medal row gets .is-you; if you're
// outside the top, a pinned row with your real rank — always shown ("celebrate you").
function renderLeaderboard(view, me) {
  if (!view || !Array.isArray(view.top) || view.top.length === 0) return "";
  const row = (entry, rank, opts = {}) => {
    const u = escAttr(entry.username);
    const badge = opts.pinned ? `#${rank}` : (MEDALS[rank - 1] ?? `#${rank}`);
    const mine = u === escAttr(me);
    const label = mine ? `you (@${u})` : `@${u}`;
    return `<li class="daily-top-row${mine ? " is-you" : ""}${opts.pinned ? " is-pinned" : ""}">
      <span class="daily-top-rank" aria-hidden="true">${badge}</span>
      <a class="daily-top-name" href="/@${u}" data-profile="${u}">${label}</a>
      <span class="daily-top-gold">${fmtGold(entry.gold)}</span>
      <span class="daily-top-guesses">in ${entry.guesses}</span>
    </li>`;
  };
  const medals = view.top.map((e, i) => row(e, i + 1)).join("");
  const pinned = view.you ? `<li class="daily-top-sep" aria-hidden="true"></li>${row(view.you, view.you.rank, { pinned: true })}` : "";
  return `<span class="section-label">Today's Top</span><ul class="daily-top-list">${medals}${pinned}</ul>`;
}

// Deterministic featured edition for a date: rotates the non-default editions so
// every day has a theme with no server. Same UTC day -> same theme for everyone.
export function dayTheme(date, editionIds) {
  const pool = editionIds.filter((id) => id !== "default");
  if (pool.length === 0) return "default";
  return pool[Math.floor(date.getTime() / 86400000) % pool.length];
}

// ── Countdown to the next Wordul (UTC midnight, mirroring server activeDate()) ──
function msToNextDaily(now) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}
function fmtCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

let countdownTimer = null;
function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}
function startCountdown() {
  stopCountdown();
  const tick = () => {
    const el = document.getElementById("dailyCountdown");
    if (!el) { stopCountdown(); return; } // home unmounted — stop ticking
    el.textContent = fmtCountdown(msToNextDaily(new Date()));
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ── Render ──────────────────────────────────────────────────────────────────
// state.result is null (not played yet) or { won: boolean, guesses: number }.
export function renderDailyCard({ themeId, result }) {
  if (result) {
    const won = !!result.won;
    return `<article class="daily-card daily-done" data-theme="${themeId}">
      <div class="daily-result ${won ? "is-won" : "is-lost"}">
        <span class="daily-result-mark" aria-hidden="true">${won ? GLYPH.check : GLYPH.cross}</span>
        <span class="daily-result-text">${won ? `Solved in ${result.guesses}` : "Missed today"}</span>
        <span class="daily-result-gold" id="dailyResultGold" hidden></span>
      </div>
      <section class="daily-top" id="dailyTop" hidden aria-label="Today's top players"></section>
      <div class="daily-next">
        <span class="daily-next-label">Next Wordul in</span>
        <span class="daily-countdown" id="dailyCountdown">—</span>
      </div>
      <div class="daily-done-actions">
        <button id="dailyShare" class="daily-done-btn" type="button">${GLYPH.share}<span>Share</span></button>
        <button id="dailyStats" class="daily-done-btn" type="button">${GLYPH.bars}<span>Stats</span></button>
      </div>
    </article>`;
  }
  const tiles = Array.from({ length: 5 }, (_, i) =>
    `<span class="daily-tile${i === 0 ? " is-cursor" : ""}"></span>`).join("");
  return `<article class="daily-card" id="dailyCard" data-theme="${themeId}"
           role="button" tabindex="0" aria-label="Play today's Wordul">
    <div class="daily-row" aria-hidden="true">${tiles}</div>
    <button class="daily-stats-link" id="dailyStats" type="button" aria-label="See today's stats">
      ${GLYPH.bars}<span class="daily-stats-label" id="dailyStatsLabel">Stats</span><span class="daily-chev" aria-hidden="true">›</span>
    </button>
  </article>`;
}

// ── Wire ────────────────────────────────────────────────────────────────────
// Binds the card's events for the current state. Returns { onType } — a letter
// handler the shell registers for type-to-play (a no-op once you've played today).
export function wireDailyCard({ themeId, result, username, onPlay, onStats, onShareDaily, onProfile, fetchPlayed, fetchLeaderboard }) {
  stopCountdown(); // never leave a stale timer running across re-renders

  const stats = document.getElementById("dailyStats");
  if (stats && onStats) stats.addEventListener("click", (e) => { e.stopPropagation(); onStats(); });

  // Post-play: result + gold + Today's Top + countdown + share. No play surface.
  if (result) {
    const share = document.getElementById("dailyShare");
    if (share && onShareDaily) share.addEventListener("click", () => onShareDaily());
    startCountdown();

    // Best-effort leaderboard: fills the gold line + the board once it resolves; a
    // failure or empty board just leaves them hidden (recap still renders).
    if (fetchLeaderboard && username) {
      fetchLeaderboard(username).then((view) => {
        if (!view) return;
        const mine = (view.you) ?? (view.top || []).find((e) => e.username === username);
        const goldEl = document.getElementById("dailyResultGold");
        if (goldEl && mine && typeof mine.gold === "number") {
          goldEl.textContent = ` · +${mine.gold.toLocaleString()} gold`;
          goldEl.hidden = false;
        }
        const board = document.getElementById("dailyTop");
        const html = renderLeaderboard(view, username);
        if (board && html) {
          board.innerHTML = html;
          board.hidden = false;
          if (onProfile) {
            board.querySelectorAll("a[data-profile]").forEach((a) => {
              a.addEventListener("click", (e) => { e.preventDefault(); onProfile(a.getAttribute("data-profile")); });
            });
          }
        }
      }).catch(() => {});
    }
    return { onType: () => {} };
  }

  // Play invitation: tap / Enter / Space / start-typing all bloom into the board.
  const card = document.getElementById("dailyCard");
  const play = (seed) => { if (onPlay) onPlay(themeId, seed); };
  if (card) {
    card.addEventListener("click", () => play());
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); }
    });
  }
  // Real "N played" count from public aggregates (best-effort; reads "Stats" until
  // a count arrives — never a fake number).
  if (fetchPlayed) {
    fetchPlayed().then((n) => {
      const el = document.getElementById("dailyStatsLabel");
      if (el && typeof n === "number" && n > 0) el.textContent = `${n.toLocaleString()} played`;
    }).catch(() => {});
  }
  return { onType: (letter) => play(letter) };
}
