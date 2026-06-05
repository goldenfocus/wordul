// public/word-page.js — hydrates the live stats panel on a word page, plus the
// word's challenge CTA. One-shot rule: the page SPOILS its word by design, so it is
// a trophy room — it shows the record and hands out blind /c/<id> links, but never
// opens a scored board itself.
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

  // The word's standing challenge: record line in the stats panel + the share CTA.
  // The link is blind for the recipient (the /c/<id> hash never names the word) and
  // carries ?vs=<me> so a friend races MY ghost when I've played it (dual replay).
  const cta = document.querySelector(".wp-cta");
  if (!cta) return;
  fetch(`/api/word/${encodeURIComponent(word)}/challenge`)
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c || !c.id) return;
      if (c.record) {
        const rec = document.createElement("p");
        rec.className = "wp-record";
        const raced = c.attempts === 1 ? "1 player raced it" : `${c.attempts.toLocaleString()} players raced it`;
        rec.textContent = `Record: @${c.record.username} ${c.record.score} · ${raced}`;
        panel.appendChild(rec);
      }
      let me = "";
      try { me = localStorage.getItem("wr.username") || ""; } catch { /* private mode */ }
      const url = `${location.origin}/c/${c.id}${me ? `?vs=${encodeURIComponent(me)}` : ""}`;
      const text = me
        ? "I challenge you to this word — blind race on Wordul."
        : "Bet you can't crack this word — blind race on Wordul.";
      const a = document.createElement("a");
      a.className = "wp-challenge";
      a.href = url;
      a.textContent = "Challenge a friend →";
      a.addEventListener("click", async (e) => {
        e.preventDefault(); // the link target spoils nothing, but the gesture is SHARE
        if (navigator.share) {
          try { await navigator.share({ text, url }); return; }
          catch (err) { if (err && err.name === "AbortError") return; }
        }
        try {
          await navigator.clipboard.writeText(`${text} ${url}`);
          a.textContent = "Link copied ✓";
          setTimeout(() => { a.textContent = "Challenge a friend →"; }, 1600);
        } catch { prompt("Copy this link:", url); }
      });
      cta.appendChild(a);
    })
    .catch(() => { /* no CTA on any error — the page stands on its own */ });
})();
