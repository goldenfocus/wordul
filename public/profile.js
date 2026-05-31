// Fetch + render a public profile at /@username.
//
// SECURITY: this builds markup via innerHTML, so EVERY user-controlled value
// (username, room name, slug, word, roomPath) MUST pass through escapeHtml, and
// numeric fields through Number(...). This is defense-in-depth — the server
// already strips <>/control chars from usernames and room names at the boundary
// (see room.ts onHello/onRename) — but the client escaping is the second layer.
// Do NOT interpolate any raw profile field into markup.
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

  const recent = (p.games || [])
    .map((g) => {
      const path = escapeHtml(g.roomPath || "");
      const word = escapeHtml(g.word || "");
      const icon = g.result === "won" ? "✅" : "❌";
      const guesses = Number(g.guesses) || 0;
      return `<li><a class="link" href="/@${path}">${icon} ${word} · ${guesses} guesses</a></li>`;
    })
    .join("");

  mountEl.innerHTML = `
    <h1 class="profile-name">@${escapeHtml(username)}</h1>
    <div class="profile-stats">
      <div class="pstat"><span class="pstat-num">${games}</span><span class="pstat-label">Games</span></div>
      <div class="pstat"><span class="pstat-num">${wins}</span><span class="pstat-label">Wins</span></div>
      <div class="pstat"><span class="pstat-num">${winRate}%</span><span class="pstat-label">Win rate</span></div>
      <div class="pstat"><span class="pstat-num">🔥 ${curStreak}</span><span class="pstat-label">Streak (best ${bestStreak})</span></div>
    </div>
    <h2 class="profile-h2">Rooms</h2>
    <ul class="profile-list">${rooms || '<li class="muted">No rooms yet</li>'}</ul>
    <h2 class="profile-h2">Recent games</h2>
    <ul class="profile-list">${recent || '<li class="muted">No games yet</li>'}</ul>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
