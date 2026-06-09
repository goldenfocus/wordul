// public/daily-carousel.js — the home daily card as a day carousel. Offset 0 = today
// (the existing card, never destroyed — just hidden when you swipe away). Offset < 0 =
// a past day, rendered fresh on landing and cached. Arrows + touch-swipe step one day;
// forward clamps at today, back goes to day one. Stats reuse the roster reducer so the
// numbers match the /daily/<date>/stats page exactly; replay reuses the stamp-replay path.
import { computeDailyStatsFromRoster } from "/daily-stats.js";
import { playStampReplay, wireStampReplays } from "/stamp-replay.js";
import { renderPastDailyCard, clampOffset } from "/daily-past.js";
import { t } from "/i18n.js";

const SWIPE_MIN = 40; // px of horizontal intent before a swipe counts

// deps: { dates:string[], shortDate(date)->str, editionName(themeId)->str,
//         pastRecord(date)->myRecord|null, navigate(path), onPlayDate(date) }
export function initDailyCarousel(root, deps) {
  const slot = root.querySelector("#dailyCarSlot");
  const todayEl = root.querySelector("#dailyToday");
  const pastEl = root.querySelector("#dailyPast");
  const prevBtn = root.querySelector("#dailyPrev");
  const nextBtn = root.querySelector("#dailyNext");
  const label = root.querySelector("#dailyCarDate");
  if (!slot || !todayEl || !pastEl) return;

  const dates = deps.dates.slice().sort();           // ascending; last = today
  const n = dates.length;
  const cache = new Map();                            // date -> { word, themeId, stats }
  let offset = 0;

  const dateAt = (off) => dates[n - 1 + off];        // off 0 -> today

  async function fetchDay(date) {
    if (cache.has(date)) return cache.get(date);
    const [wordRes, lbRes] = await Promise.all([
      fetch(`/api/daily/word?date=${date}`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/daily/${date}/leaderboard?full=1&username=`).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    const stats = lbRes ? computeDailyStatsFromRoster(lbRes) : { played: 0, winRate: null };
    const day = { word: wordRes?.word || "", themeId: wordRes?.themeId || "", stats };
    cache.set(date, day);
    return day;
  }

  function render() {
    offset = clampOffset(offset, n);
    const date = dateAt(offset);
    if (label) label.textContent = deps.shortDate(date);
    // Carousel is armed (n > 1, else initDailyCarousel isn't called) → reveal back-arrow;
    // disable it only at the oldest day. Forward-arrow shows only off today.
    if (prevBtn) { prevBtn.hidden = false; prevBtn.disabled = offset <= -(n - 1); }
    if (nextBtn) nextBtn.hidden = offset === 0;       // today is the right edge

    if (offset === 0) {
      todayEl.hidden = false;
      pastEl.hidden = true;
      pastEl.innerHTML = "";
      return;
    }
    todayEl.hidden = true;
    pastEl.hidden = false;
    pastEl.innerHTML = `<p class="muted small past-loading">${t("daily.loadingDay")}</p>`;
    fetchDay(date).then((day) => {
      if (dateAt(offset) !== date) return;            // swiped away mid-fetch
      const themeName = day.themeId ? deps.editionName(day.themeId) : "";
      if (label) label.textContent = themeName ? `${deps.shortDate(date)} · ${themeName}` : deps.shortDate(date);
      pastEl.innerHTML = renderPastDailyCard({
        date, themeName, word: day.word,
        stats: day.stats, myRecord: deps.pastRecord(date),
      });
      wirePast(date);
    });
  }

  function wirePast(date) {
    wireStampReplays(pastEl);                          // stamp tap → replay
    pastEl.querySelector("[data-past-replay]")?.addEventListener("click", () => {
      const stamp = pastEl.querySelector(".daily-stamp");
      if (stamp) playStampReplay(stamp);
    });
    pastEl.querySelector("[data-past-play]")?.addEventListener("click", () => deps.onPlayDate(date));
    pastEl.querySelector("[data-past-stats]")?.addEventListener("click", () => deps.navigate(`/daily/${date}/stats`));
    pastEl.querySelector("[data-past-wiki]")?.addEventListener("click", (e) => {
      e.preventDefault();
      deps.navigate(`/word/${String(e.currentTarget.getAttribute("data-word")).toLowerCase()}`);
    });
  }

  const step = (d) => { offset = clampOffset(offset + d, n); render(); };
  prevBtn?.addEventListener("click", () => step(-1));  // older
  nextBtn?.addEventListener("click", () => step(1));   // newer

  // Touch swipe, scoped to the card slot so the Worlds strip below still scrolls.
  let x0 = null, y0 = null;
  slot.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  slot.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return; // not a horizontal swipe
    step(dx < 0 ? -1 : 1);                              // swipe left → older, right → newer
  }, { passive: true });

  render();
}
