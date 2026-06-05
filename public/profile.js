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
// toPublicGame; recentGameView never reads it either). A player's board is only ever drawn
// LETTERLESS from solveGrid, and today's daily stays locked until the viewer has played —
// see profile-core.js for the rules.
import { recentGameView } from "/profile-core.js";
import { renderStamp } from "/daily-card.js";

const DAILY_SOLVE_LS = "wr.dailySolve"; // mirrors LS.dailySolve in app.js (client-only solve)

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

  const recent = (p.games || [])
    .map((g) => renderRecentGame(recentGameView(g, { today, playedToday })))
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
    <ul class="profile-list profile-games">${recent || '<li class="muted">No games yet</li>'}</ul>`;

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
