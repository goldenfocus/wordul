// public/worduls-gallery.js — renders @<owner>'s published worduls as play cards.
// Exposed as renderWorduls(owner, root) so app.js mounts it inside the SPA shell.
import { getSessionToken } from "/account.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cardHtml(w) {
  const cs = w.colorScheme || {};
  const swatch = [cs.a1, cs.a2, cs.a3].filter(Boolean)
    .map((c) => `<span style="background:${escapeHtml(c)}"></span>`).join("");
  const board = Array.from({ length: w.rows || 6 }, () => `<i></i>`).join(""); // masked board
  const tag = w.status !== "published" ? ` <em>(${escapeHtml(w.status)})</em>` : "";
  return `<li class="wordul-card">
    <a href="/@${escapeHtml(w.owner)}/${escapeHtml(w.slug)}">
      <div class="swatch">${swatch}</div>
      <div class="masked-board" data-cols="${w.rows || 6}">${board}</div>
      <h3>${escapeHtml(w.vibeTitle)}${tag}</h3>
      <p class="plays">${w.plays || 0} ${(w.plays === 1) ? "play" : "plays"}</p>
    </a></li>`;
}

// Render @<owner>'s worduls into `root`. Sends the session token only when the VIEWER is
// the owner, so the owner also sees their drafts/unpublished; everyone else gets the
// published-only list (isOwner fails for a non-owner token → published projection).
export async function renderWorduls(owner, root) {
  if (!owner || !root) return;
  const token = (localStorage.getItem("wr.username") === owner) ? getSessionToken() : "";
  let worlds = [];
  try {
    const res = await fetch(`/api/worduls/${owner}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    if (res.ok) ({ worlds } = await res.json());
  } catch { /* render empty state below */ }
  root.innerHTML = `<h1 class="worduls-gallery-title">@${escapeHtml(owner)}'s worduls</h1>` + (worlds.length
    ? `<ul class="wordul-cards">` + worlds.map(cardHtml).join("") + `</ul>`
    : `<p class="empty">No worduls yet.</p>`);
}

// Standalone fallback: if this module is ever loaded directly on a /@owner/worduls page
// (outside the SPA), self-mount into #worduls-root.
const m = location.pathname.match(/^\/@([a-z0-9_-]{3,20})\/worduls$/);
const standaloneRoot = document.getElementById("worduls-root");
if (m && standaloneRoot && !standaloneRoot.dataset.spaMounted) {
  renderWorduls(m[1], standaloneRoot);
}
