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

  const cta = document.querySelector(".wp-cta");
  if (!cta) return;

  // CTA precedence: if this page IS the Word of the Day that THIS browser just solved,
  // it's a result to show off — a card + "Play today's Wordul →", never a ghost duel.
  // Otherwise it's an archived word: the standing /c/<id> blind-race challenge below.
  // Both fail open to the generic challenge CTA on any hiccup.
  (async () => {
    if (await maybeRenderDailyResult(word, cta, panel)) return;
    renderWordChallenge(word, cta, panel);
  })();

  // Word-of-the-Day result card. Spoiler-safe: the only "is this today's daily" signal is
  // this browser's own wr.dailySolve:<date> (the answer + grid never leave the device). On
  // a match, render the exact in-app share card (dynamically imported, no module page) and
  // a link-first "Share result →". Returns true when it took over the CTA.
  async function maybeRenderDailyResult(pageWord, ctaEl, panelEl) {
    const today = new Date().toISOString().slice(0, 10);
    let raw = null;
    try { raw = localStorage.getItem(`wr.dailySolve:${today}`); } catch { return false; }
    if (!raw) return false;
    try {
      const { dailyShareModel } = await import("/daily-share-core.js");
      const model = dailyShareModel({ pageWord, raw });
      if (!model) return false;
      const { buildShareCardModel, renderShareCard } = await import("/share-card.js");
      let me = "";
      try { me = localStorage.getItem("wr.username") || ""; } catch { /* private mode */ }
      const dailyUrl = `${location.origin}/daily/${today}`;
      const cardModel = buildShareCardModel({
        username: me || "you",
        guesses: model.masks.map((mask) => ({ mask })),
        won: model.won, score: model.score,
        challengeUrl: dailyUrl.replace(/^https?:\/\//, ""),
      });
      const canvas = renderShareCard(cardModel, model.cols);
      canvas.className = "wp-result-card";
      const fig = document.createElement("figure");
      fig.className = "wp-result";
      fig.appendChild(canvas);
      ctaEl.parentNode.insertBefore(fig, ctaEl);

      // The static page already carries "Play today's Wordul →"; point it at today's board.
      const play = panelEl.querySelector(".wp-play") || document.querySelector(".wp-play");
      if (play) play.href = dailyUrl;

      const text = model.won
        ? `I solved today's Wordul in ${model.score}. Your turn?`
        : "Today's Wordul got me. Your turn?";
      const share = document.createElement("a");
      share.className = "wp-challenge";
      share.href = dailyUrl;
      share.textContent = "Share result →";
      share.addEventListener("click", async (e) => {
        e.preventDefault();
        if (navigator.share) {
          try { await navigator.share({ text, url: dailyUrl }); return; }
          catch (err) { if (err && err.name === "AbortError") return; }
        }
        try {
          await navigator.clipboard.writeText(`${text} ${dailyUrl}`);
          share.textContent = "Link copied ✓";
          setTimeout(() => { share.textContent = "Share result →"; }, 1600);
        } catch { prompt("Copy this link:", dailyUrl); }
      });
      ctaEl.appendChild(share);
      return true;
    } catch { return false; } // bad JSON / failed import — fall back to the challenge CTA
  }

  // The archived word's standing challenge: record line + a blind /c/<id> share link that
  // carries ?vs=<me> so a friend races MY ghost when I've played it (dual replay).
  function renderWordChallenge(pageWord, ctaEl, panelEl) {
    fetch(`/api/word/${encodeURIComponent(pageWord)}/challenge`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c || !c.id) return;
        if (c.record) {
          const rec = document.createElement("p");
          rec.className = "wp-record";
          const raced = c.attempts === 1 ? "1 player raced it" : `${c.attempts.toLocaleString()} players raced it`;
          rec.textContent = `Record: @${c.record.username} ${c.record.score} · ${raced}`;
          panelEl.appendChild(rec);
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
        ctaEl.appendChild(a);
      })
      .catch(() => { /* no CTA on any error — the page stands on its own */ });
  }
})();
