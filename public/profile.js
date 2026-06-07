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
import { recentGameView, formatLedgerRow, ledgerBalances } from "/profile-core.js";
import { renderStamp, boardRows, goldValue } from "/daily-card.js";
import { GLYPH } from "/hub-glyphs.js";
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
    .map((g) => renderGameCard(recentGameView(g, { today, playedToday, todayWords })))
    .join("");

  // The ledger's running-balance column: walked backwards from the current gold total.
  // No total on the payload → no column (rows render without balances, never NaN).
  const totalGold = Number(p.balances?.gold);
  const balances = Number.isFinite(totalGold) ? ledgerBalances(p.goldHistory || [], totalGold) : [];
  const goldRows = (p.goldHistory || [])
    .map((tx, i) => renderGoldRow(formatLedgerRow(tx), balances[i]))
    .join("");

  mountEl.innerHTML = `
    <h1 class="profile-name">@${escapeHtml(username)}${p.claimed ? ` <span class="claimed-badge" title="Secured account">${GLYPH.lock}</span>` : ""}${p.verified ? ` <span class="verified-badge" title="Verified">${GLYPH.check}</span>` : ""}</h1>
    <div class="profile-stats">
      <div class="pstat"><span class="pstat-num">${games}</span><span class="pstat-label">Games</span></div>
      <div class="pstat"><span class="pstat-num">${wins}</span><span class="pstat-label">Wins</span></div>
      <div class="pstat"><span class="pstat-num">${winRate}%</span><span class="pstat-label">Win rate</span></div>
      <div class="pstat"><span class="pstat-num">${GLYPH.flame} ${curStreak}</span><span class="pstat-label">Streak (best ${bestStreak})</span></div>
    </div>
    <h2 class="profile-h2">Rooms</h2>
    <ul class="profile-list">${rooms || '<li class="muted">No rooms yet</li>'}</ul>
    <h2 class="profile-h2">Recent games</h2>
    <ul class="profile-list profile-games">${recent || '<li class="muted">No games yet</li>'}</ul>
    <section id="gold-history">
      <h2 class="profile-h2 ledger-h2"><span>${escapeHtml(t("gold.history.title"))}</span>${Number.isFinite(totalGold) ? `<span class="ledger-balance">${goldValue(totalGold)}</span>` : ""}</h2>
      <ul class="profile-list gold-history">${goldRows || `<li class="muted">${escapeHtml(t("gold.history.empty"))}</li>`}</ul>
    </section>`;

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

// One "Gold ledger" row from a formatLedgerRow() view-model + its running balance.
// A row WITH valid parts is a tappable button (›) that expands into component legs;
// a flat earning is a static line. Chain-explorer columns, faded glyphs, never emoji:
//   date · ⛀ label · +N · balance   [›]
//     └ score +28 · daily +100 · speed +5
function renderGoldRow(v, balance) {
  const glyph = v.kind === "cashout" ? GLYPH.flag : GLYPH.coin;
  const head =
    `<span class="gold-date">${escapeHtml(v.date)}</span>` +
    `<span class="gold-label">${glyph}<span class="gold-label-text">${escapeHtml(v.label)}</span></span>` +
    `<span class="gold-amount">${escapeHtml(v.amount)}</span>` +
    `<span class="gold-balance">${Number.isFinite(balance) ? Number(balance).toLocaleString() : ""}</span>`;
  if (!v.parts.length) {
    return `<li class="gold-row"><span class="gold-row-static">${head}<span class="gold-chev"></span></span></li>`;
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

// A glyph-less board shell (all empty cells) — the constant frame behind a locked or
// legacy (no stored board) game card. aria-hidden: the caption carries the meaning.
function emptyBoard(rows, cols) {
  const row = `<div class="stamp-row">${`<span class="stamp-cell is-empty"></span>`.repeat(cols)}</div>`;
  return `<div class="daily-stamp" aria-hidden="true">${row.repeat(rows)}</div>`;
}

// One "Recent games" card, built from a recentGameView() view-model. Every card is the
// SAME constant frame (boardRows pads a solve-in-2 and a miss-in-6 alike) so the list
// reads as a uniform grid of little board avatars. Tapping a stamp replays it in place —
// stamp-replay.js's delegated listener picks up any rendered .daily-stamp for free.
//   • locked (today's daily, viewer hasn't played) → empty shell + faded lock, links home
//   • has grid → the stamp, with LETTERS when words legitimately shipped
//   • legacy game with no stored board → empty shell; rooms keep their link caption
function renderGameCard(v) {
  const rows = boardRows(v.wordLength);
  const cols = Number(v.wordLength) || 5;
  const mark = v.won
    ? `<span class="pgame-in">in ${Number(v.guesses) || 0}</span>`
    : `<span class="pgame-mark" role="img" aria-label="missed" title="missed">${GLYPH.cross}</span>`;
  const name = v.roomHref
    ? `<a class="pgame-name" href="${escapeHtml(v.roomHref)}">${escapeHtml(v.shortLabel)}</a>`
    : `<span class="pgame-name">${escapeHtml(v.shortLabel)}</span>`;
  const cap = `<div class="pgame-cap">${name}${mark}</div>`;
  if (v.locked) {
    // The result stays visible (it was never a spoiler) — only the board hides behind
    // the lock until the viewer has played today. Tapping the veil goes home to play.
    return `<li class="pgame is-locked">
        <a class="pgame-veil" href="/" title="Play today's Wordul to unlock" aria-label="Play today's Wordul to unlock this board">
          ${emptyBoard(rows, cols)}
          <span class="pgame-lock">${GLYPH.lock}</span>
        </a>${cap}
      </li>`;
  }
  const board = Array.isArray(v.grid) && v.grid.length
    ? renderStamp(v.grid, Array.isArray(v.words) ? v.words : undefined, rows)
    : emptyBoard(rows, cols);
  return `<li class="pgame">${board}${cap}</li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
