// public/word-page.js — hydrates the live stats panel on a word page.
(function () {
  const panel = document.querySelector(".wp-stats");
  if (!panel) return;
  const word = (panel.dataset.word || "").toLowerCase();
  const body = panel.querySelector(".wp-stats-body");
  if (!word || !body) return;

  fetch(`/api/word/${encodeURIComponent(word)}/stats`)
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s || s.neverPlayed) return; // keep the baked-in "Be the first to solve it."
      const pct = Math.round(s.solveRate * 100);
      const avg = s.avgGuesses != null ? s.avgGuesses.toFixed(1) : "—";
      const times = s.answered === 1 ? "once" : `${s.answered.toLocaleString()} times`;
      body.textContent = `Played ${times} · ${pct}% solved · ${avg} guesses on average.`;
    })
    .catch(() => { /* leave the placeholder on any error */ });
})();
