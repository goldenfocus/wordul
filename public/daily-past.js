// public/daily-past.js — pure render for ONE past day's card in the home carousel.
// Answer + that day's stats are always shown; the solve stamp + replay appear only when
// the viewer played that day (myRecord present), else a "Play it" link. No DOM, no fetch
// — the carousel owns data + wiring; this only turns data into markup (unit-tested).
import { renderStamp, boardRows } from "/daily-card.js";

// Carousel index lives in (-(n-1) .. 0): 0 = today, -1 = yesterday, oldest = -(n-1).
export function clampOffset(offset, n) {
  const oldest = -(Math.max(1, n) - 1);
  return Math.max(oldest, Math.min(0, offset));
}

const fmt = (x) => Number(x).toLocaleString("en-US");

// The answer + theme are off-the-wire (server-curated, but never trust the wire as markup
// — same posture as renderDailyStatsReveal). Escape before interpolating into the string.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// opts: { date, themeName, word, stats:{played,winRate}, myRecord:{won,guesses,solveGrid,solveWords}|null }
export function renderPastDailyCard({ date, themeName, word, stats, myRecord }) {
  const cols = myRecord?.solveGrid?.[0] ? String(myRecord.solveGrid[0]).length : 5;
  const rows = boardRows(cols);                       // full-board height for this word length

  const hero = myRecord
    ? `<div class="daily-stamp-hero ${myRecord.won ? "is-won" : "is-lost"}">
         ${renderStamp(myRecord.solveGrid, myRecord.solveWords, rows)}
         <span class="past-result">${myRecord.won ? `${myRecord.guesses}/${rows}` : "✗"}</span>
       </div>`
    : "";

  const safeWord = esc(word);
  const wikiSlug = encodeURIComponent(String(word).toLowerCase());

  const action = myRecord
    ? `<button type="button" class="btn ghost small" data-past-replay>▶ Watch replay</button>`
    : `<button type="button" class="btn primary small" data-past-play data-date="${esc(date)}">Play it →</button>`;

  const played = stats?.played ?? 0;
  const winRate = stats?.winRate;
  const statsLine = played > 0
    ? `<p class="past-stats muted small">${fmt(played)} played · ${winRate == null ? "—" : winRate + "%"} solved</p>`
    : `<p class="past-stats muted small">No finishers recorded.</p>`;

  return `<article class="daily-card daily-past" data-date="${esc(date)}" data-theme-name="${esc(themeName)}">
    ${hero}
    <p class="past-answer"><span class="past-answer-label">Answer</span> <a class="past-answer-word" href="/word/${wikiSlug}" data-past-wiki data-word="${safeWord}">${safeWord}</a></p>
    ${statsLine}
    <div class="past-actions">
      ${action}
      <button type="button" class="link past-stats-link" data-past-stats data-date="${esc(date)}">Stats ›</button>
    </div>
  </article>`;
}
