// public/daily-lb.js — the golden card's "today's winners" board. Lives inside
// #dailyUnlock (the post-finish reveal), so every caller has ALREADY finished —
// the finisher token unlocks real letters; the server still enforces the gate.
// Three beats: top-3 medals + you (reuses the home card's renderer) → "Show all
// (N)" swaps in the full roster (internal scroll past SCROLL_AT rows) → tapping
// any row pops the player's auto-playing replay (replay-modal, Task 7).
// Decoupling: NEVER imports app.js — i18n comes in via opts.t (settle.js pattern).
import { renderLeaderboard, renderStamp, boardRows, goldValue, rosterRow, resultMark, fmtDuration } from "/daily-card.js";
import { playStampReplay } from "/stamp-replay.js";

const SCROLL_AT = 25; // past this many rows the roster scrolls inside the card
function escAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, ""); } // usernames are [a-z0-9_-]

// Tracks the active modal's close fn so eviction goes through it (no orphaned keydown
// listeners). Set to null when the modal self-closes; overwritten when one replaces another.
let closeActive = null;

// Tap a row → that player's board pops up and replays itself. The stamp is built from
// the row's leaderboard entry (grid always; words only when the server unlocked them
// for this finisher). Scrim tap / ✕ / Esc dismiss; focus returns to the opener row.
// Lifecycle: closeActive tracks the live close fn so evicting a prior modal goes through
// close() — this removes its document keydown listener and avoids orphaned listeners.
// The refocus param lets eviction skip the focus-return (the incoming modal owns focus).
export function openReplayModal(entry, opener) {
  closeActive?.({ refocus: false }); // evict any existing modal cleanly (no orphaned keydown)
  const u = escAttr(entry.username);
  const cols = Array.isArray(entry.grid) && entry.grid[0] ? String(entry.grid[0]).length : 5;
  // The row stays minimal; the full story lives here — result AND how long it took.
  const dur = fmtDuration(entry.durationMs);
  const overlay = document.createElement("div");
  overlay.id = "dailyLbModal";
  overlay.className = "daily-lb-modal";
  overlay.innerHTML = `<div class="daily-lb-modal-card" role="dialog" aria-modal="true" aria-label="@${u} board replay">
    <div class="daily-lb-modal-head">
      <a class="daily-top-name" href="/@${u}" data-profile="${u}">@${u}</a>
      <span class="daily-top-gold">${goldValue(entry.gold)}</span>
      <span class="daily-top-guesses">${resultMark(entry)}</span>
      ${dur ? `<span class="daily-lb-modal-time">${dur}</span>` : ""}
      <button type="button" class="daily-lb-modal-close" aria-label="Close">✕</button>
    </div>
    ${renderStamp(entry.grid, entry.words, boardRows(cols))}
  </div>`;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = ({ refocus = true } = {}) => {
    closeActive = null;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (refocus) opener?.focus?.();
  };
  closeActive = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".daily-lb-modal-close")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  overlay.querySelector(".daily-lb-modal-close")?.focus(); // keyboard users land inside dialog
  const stamp = overlay.querySelector(".daily-stamp");
  if (stamp) playStampReplay(stamp); // auto-play on open; tap snaps to final (existing engine)
  return overlay;
}

// Make every .daily-top-row under root tappable: tap/Enter/Space → that player's replay
// modal (rows whose entry has no grid simply don't open). entries is a Map keyed by the
// row's data-user (escaped username). Shared by the golden card AND the day Stats page.
export function wireReplayRows(root, entries) {
  root.querySelectorAll(".daily-top-row").forEach((row) => {
    row.setAttribute("tabindex", "0");
    const open = () => {
      const hit = entries.get(row.getAttribute("data-user"));
      if (hit && Array.isArray(hit.grid) && hit.grid.length) openReplayModal(hit, row);
    };
    row.addEventListener("click", (e) => { if (!e.target.closest("a")) open(); });
    row.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); open(); }
    });
  });
}

// Mount once per finished daily (idempotent — renderDailyUnlock runs on every snapshot).
// opts: { mount, date, username, t? } — t is the i18n fn (identity fallback keeps tests hermetic).
export function mountDailyLeaderboard({ mount, date, username, t = (_k, f) => f }) {
  if (!mount || mount.dataset.wired) return;
  mount.dataset.wired = "1";
  const token = localStorage.getItem(`wr.dailyToken:${date}`) || "";
  const tq = token ? `&t=${encodeURIComponent(token)}` : "";
  const api = (extra) => `/api/daily/${date}/leaderboard?username=${encodeURIComponent(username)}${extra}${tq}`;
  // Row index by escaped username → entry, so a tap can open the right board.
  const entries = new Map();
  const wireRows = (root) => wireReplayRows(root, entries);
  fetch(api("&n=3"))
    .then((r) => (r.ok ? r.json() : null))
    .then((view) => {
      if (!view || !Array.isArray(view.top) || view.top.length === 0) {
        delete mount.dataset.wired; // transient miss — let the next snapshot's mount retry
        return;
      }
      view.top.forEach((e) => entries.set(escAttr(e.username), e));
      if (view.you) entries.set(escAttr(view.you.username), view.you);
      const more = view.total > view.top.length + (view.you ? 1 : 0);
      // The recap link closes the loop: post-finish card → the day's full Stats page
      // (same rows, same replays) — one continuous after-the-word surface.
      mount.innerHTML = renderLeaderboard(view, username) +
        (more ? `<button type="button" class="daily-lb-showall" id="dailyLbShowAll">${t("daily.lbShowAll", "Show all")} (${view.total}) →</button>` : "") +
        `<a class="daily-lb-recap" href="/daily/${date}/stats">${t("daily.lbRecap", "Full day recap")} →</a>`;
      mount.hidden = false;
      wireRows(mount);
      const showAll = mount.querySelector("#dailyLbShowAll");
      if (showAll) showAll.addEventListener("click", () => {
        showAll.disabled = true;
        fetch(api("&full=1"))
          .then((r) => (r.ok ? r.json() : null))
          .then((fullV) => {
            if (!fullV || !Array.isArray(fullV.players) || fullV.players.length === 0) { showAll.disabled = false; return; }
            fullV.players.forEach((e) => entries.set(escAttr(e.username), e));
            const list = mount.querySelector(".daily-top-list");
            if (!list) return;
            const roster = document.createElement("ul");
            roster.className = `daily-top-list daily-lb-roster${fullV.players.length > SCROLL_AT ? " is-scroll" : ""}`;
            roster.innerHTML = fullV.players.map((e) => rosterRow(e, username)).join("");
            list.replaceWith(roster);
            showAll.remove();
            wireRows(roster);
          })
          .catch(() => { showAll.disabled = false; });
      });
    })
    .catch(() => { delete mount.dataset.wired; }); // recap renders fine without a board; retry next snapshot
}
