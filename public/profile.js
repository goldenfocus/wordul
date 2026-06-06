// Fetch + render a public profile at /@username.
//
// SECURITY: this builds markup via innerHTML, so EVERY user-controlled value
// (username, room name, slug, roomPath) MUST pass through escapeHtml, and
// numeric fields through Number(...). This is defense-in-depth — the server
// already strips <>/control chars from usernames and room names at the boundary
// (see room.ts onHello/onRename) — but the client escaping is the second layer.
// Do NOT interpolate any raw profile field into markup.
//
// SPOILER SAFETY: the answer word is NEVER rendered (the server strips it via
// toPublicGame; recentGameView never reads it either). Today's daily stays locked until
// the viewer has played, then renders letterless — UNLESS the viewer FINISHED today, in
// which case their finisher token (server-validated) unlocks this profile's letter rows
// via the daily leaderboard API. See profile-core.js for the rules.
import { recentGameView, formatLedgerRow } from "/profile-core.js";
import { renderStamp } from "/daily-card.js";
import { t } from "/i18n.js";

// Friendly i18n label for a gold-history part leg ("score"/"daily"/"speed"); unknown legs
// fall back to their raw label (already a short word from the server).
const PART_KEY = { score: "gold.history.part.score", daily: "gold.history.part.daily", speed: "gold.history.part.speed" };
function partLabel(label) {
  const key = PART_KEY[label];
  return key ? t(key) : String(label);
}

const DAILY_SOLVE_LS = "wr.dailySolve"; // mirrors LS.dailySolve in app.js (client-only solve)
const DAILY_TOKEN_LS = "wr.dailyToken"; // mirrors LS.dailyToken in app.js (per-date proof-of-finish)

// A viewer who FINISHED today's daily holds the per-date finisher token. Exchange it (the
// server validates — a wrong/absent token just yields no letters) for this profile's letter
// rows on today's daily, so a finisher sees the full letter-card instead of colors-only.
// Returns string[] | null; null on any miss (not played, storage off, not on the board, …).
async function fetchTodayWords(username, today) {
  let token = "";
  try { token = localStorage.getItem(`${DAILY_TOKEN_LS}:${today}`) || ""; } catch { /* storage off */ }
  if (!token) return null;
  try {
    const res = await fetch(`/api/daily/${today}/leaderboard?full=1&t=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const lb = await res.json();
    const want = String(username).toLowerCase();
    const hit = (lb.players || []).find((e) => String(e.username || "").toLowerCase() === want);
    return hit && Array.isArray(hit.words) && hit.words.length ? hit.words : null;
  } catch { return null; }
}

export async function renderProfile(username, mountEl) {
  if (!mountEl) return;
  mountEl.innerHTML = `<p class="profile-loading muted">Loading @${escapeHtml(username)}…</p>`;

  let p;
  try {
    const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    p = await res.json();
  } catch (e) {
    mountEl.innerHTML = `<h1>@${escapeHtml(username)}</h1><p class="muted">Couldn't load this profile right now.</p>`;
    return;
  }

  const s = p.stats || {};
  const games = Number(s.gamesPlayed) || 0;
  const wins = Number(s.wins) || 0;
  const winRate = games ? Math.round((wins / games) * 100) : 0;
  const curStreak = Number(s.currentStreak) || 0;
  const bestStreak = Number(s.bestStreak) || 0;

  const rooms = (p.ownedRooms || [])
    .map((r) => {
      const slug = escapeHtml(r.slug);
      const name = escapeHtml(r.name || r.slug);
      return `<li><a class="link" href="/@${escapeHtml(username)}/${slug}">${name}</a></li>`;
    })
    .join("");

  const today = new Date().toISOString().slice(0, 10);
  let playedToday = false;
  try { playedToday = !!localStorage.getItem(`${DAILY_SOLVE_LS}:${today}`); } catch { /* storage off */ }

  // Only worth a fetch when this profile actually has a letters-stripped game for today.
  const hasLiveDaily = (p.games || []).some(
    (g) => String(g.roomPath || "") === `daily/${today}` && !(Array.isArray(g.words) && g.words.length),
  );
  const todayWords = playedToday && hasLiveDaily ? await fetchTodayWords(username, today) : null;

  const recent = (p.games || [])
    .map((g) => renderRecentGame(recentGameView(g, { today, playedToday, todayWords })))
    .join("");

  const goldRows = (p.goldHistory || [])
    .map((tx) => renderGoldRow(formatLedgerRow(tx)))
    .join("");

  mountEl.innerHTML = `
    <h1 class="profile-name">@${escapeHtml(username)}${p.claimed ? ' <span class="claimed-badge" title="Secured account">🔒</span>' : ""}${p.verified ? ' <span class="verified-badge" title="Verified">✔</span>' : ""}</h1>
    <div class="profile-stats">
      <div class="pstat"><span class="pstat-num">${games}</span><span class="pstat-label">Games</span></div>
      <div class="pstat"><span class="pstat-num">${wins}</span><span class="pstat-label">Wins</span></div>
      <div class="pstat"><span class="pstat-num">${winRate}%</span><span class="pstat-label">Win rate</span></div>
      <div class="pstat"><span class="pstat-num">🔥 ${curStreak}</span><span class="pstat-label">Streak (best ${bestStreak})</span></div>
    </div>
    <h2 class="profile-h2">Rooms</h2>
    <ul class="profile-list">${rooms || '<li class="muted">No rooms yet</li>'}</ul>
    <h2 class="profile-h2">Recent games</h2>
    <ul class="profile-list profile-games">${recent || '<li class="muted">No games yet</li>'}</ul>
    <section id="gold-history">
      <h2 class="profile-h2">${escapeHtml(t("gold.history.title"))}</h2>
      <ul class="profile-list gold-history">${goldRows || `<li class="muted">${escapeHtml(t("gold.history.empty"))}</li>`}</ul>
    </section>`;

  // Tap a daily row to expand that player's letterless board (or the "play first" prompt).
  mountEl.querySelectorAll(".profile-game-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const board = btn.nextElementSibling;
      if (!board) return;
      const opening = board.hidden;
      board.hidden = !opening;
      btn.setAttribute("aria-expanded", String(opening));
      btn.classList.toggle("is-open", opening);
    });
  });

  // Honor a #gold-history deep-link (e.g. from the tappable ◆ HUD): the section is rendered
  // async after fetch, so the browser's native anchor jump has already missed — scroll now.
  if (location.hash === "#gold-history") {
    mountEl.querySelector("#gold-history")?.scrollIntoView({ block: "start" });
  }

  // Tap a gold-history row WITH parts to reveal its component legs (granular mode).
  mountEl.querySelectorAll(".gold-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const legs = btn.nextElementSibling;
      if (!legs) return;
      const opening = legs.hidden;
      legs.hidden = !opening;
      btn.setAttribute("aria-expanded", String(opening));
      btn.classList.toggle("is-open", opening);
    });
  });
}

// One "Gold history" row from a formatLedgerRow() view-model. A row WITH valid parts is a
// tappable button (▸) that expands into component legs; a flat earning is a static line.
//   date · 🎁/🏁 label · +N   [▸]
//     └ score +28 · daily +100 · speed +5
function renderGoldRow(v) {
  const head =
    `<span class="gold-date">${escapeHtml(v.date)}</span>` +
    `<span class="gold-label">${v.icon} ${escapeHtml(v.label)}</span>` +
    `<span class="gold-amount">${escapeHtml(v.amount)}</span>`;
  if (!v.parts.length) {
    return `<li class="gold-row"><span class="gold-row-static">${head}</span></li>`;
  }
  const legs = v.parts
    .map((p) => `${escapeHtml(partLabel(p.label))} +${Number(p.delta) || 0}`)
    .join(" · ");
  return `<li class="gold-row">
      <button class="gold-row-btn" type="button" aria-expanded="false">
        ${head}
        <span class="gold-chev" aria-hidden="true">›</span>
      </button>
      <div class="gold-row-legs" hidden>${legs}</div>
    </li>`;
}

// One "Recent games" row, built from a recentGameView() view-model.
//   • locked (today's daily, not yet played) → tap reveals a "play today first" prompt
//   • has grid → tap reveals that player's board — with LETTERS when words shipped, else
//     letterless (today's daily ships no letters by design; past games + rooms do)
//   • legacy room with no stored board → a link into the room
//   • legacy daily with no board → static line, nothing to expand
function renderRecentGame(v) {
  const head = `${v.icon} ${escapeHtml(v.label)} · ${escapeHtml(v.result)}`;
  let body = "";
  if (v.locked) {
    body = `<a class="link" href="/">Play today's Wordul</a> to compare boards`;
  } else if (Array.isArray(v.grid) && v.grid.length) {
    body = renderStamp(v.grid, Array.isArray(v.words) ? v.words : undefined);
  } else if (v.roomHref) {
    return `<li class="profile-game"><a class="link profile-game-link" href="${escapeHtml(v.roomHref)}">${head}</a></li>`;
  } else {
    return `<li class="profile-game"><span class="profile-game-static">${head}</span></li>`;
  }
  return `<li class="profile-game">
      <button class="profile-game-row" type="button" aria-expanded="false">
        <span class="profile-game-label">${head}</span>
        <span class="profile-game-chev" aria-hidden="true">›</span>
      </button>
      <div class="profile-game-board" hidden>${body}</div>
    </li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
