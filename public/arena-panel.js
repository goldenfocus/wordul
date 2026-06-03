// public/arena-panel.js — the Arena (liquidity-bot) open-games list. Mount-agnostic by
// design: the home layout is being replaced by a 3-way launcher where "bots live in PvP",
// so this module exposes pure helpers + a `mountArenaList(el, { onJoin })` that can be
// dropped into whatever the PvP surface ends up being. No imports → module graph stays whole.

// Map a server OpenGame to the props a row needs. `avatar` aliases personaIcon so the row
// renderer doesn't reach into wire-shape names.
export function arenaRowProps(game) {
  return {
    routePath: game.routePath,
    avatar: game.personaIcon,
    host: game.host,
    wordLength: game.wordLength,
    seats: game.seats,
    edition: game.edition,
  };
}

// Classify the panel state from the fetch result. games===null → still loading; isError →
// the fetch failed; [] → no open rooms; otherwise there's a list to render.
export function arenaEmptyState(games, isError) {
  if (isError) return "error";
  if (games === null) return "loading";
  if (games.length === 0) return "empty";
  return "list";
}

// "Join next game" target: the first open game that ISN'T the room just played (you don't
// want to rejoin the finished room). Returns its routePath, or null when nothing else is
// waiting — the caller then falls back to the Arena list. Defensive against null/undefined.
export function pickNextGame(games, currentRoutePath) {
  if (!Array.isArray(games)) return null;
  const next = games.find((g) => g && g.routePath && g.routePath !== currentRoutePath);
  return next ? next.routePath : null;
}

const POLL_MS = 8000;

// Render the open-games list into `mountEl`, polling while mounted. Returns a stop()
// that clears the poll — the caller MUST invoke it on teardown (leaving the surface).
// onJoin(routePath) is called when a row is tapped (typically → navigate(routePath)).
export function mountArenaList(mountEl, { onJoin } = {}) {
  if (!mountEl) return () => {};
  let stopped = false;
  let timer = null;

  const draw = (games, isError) => {
    if (stopped) return;
    const state = arenaEmptyState(games, isError);
    if (state === "loading") { mountEl.innerHTML = `<div class="arena-state">Finding opponents…</div>`; return; }
    if (state === "error") { mountEl.innerHTML = `<div class="arena-state">Couldn't reach the Arena. Retrying…</div>`; return; }
    if (state === "empty") { mountEl.innerHTML = `<div class="arena-state">No open games right now.</div>`; return; }
    const list = document.createElement("div");
    list.className = "arena-list";
    for (const g of games) {
      const p = arenaRowProps(g);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "arena-row";
      row.dataset.edition = p.edition;
      row.innerHTML =
        `<span class="arena-row-avatar" aria-hidden="true">${p.avatar}</span>` +
        `<span class="arena-row-body"><span class="arena-row-host">${p.host}</span>` +
        `<span class="arena-row-meta muted">${p.wordLength} letters</span></span>` +
        `<span class="arena-row-seats">${p.seats}</span>`;
      row.addEventListener("click", () => { if (onJoin) onJoin(p.routePath); });
      list.appendChild(row);
    }
    mountEl.innerHTML = "";
    mountEl.appendChild(list);
  };

  const fetchOnce = () => {
    fetch("/api/arena/open")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((games) => draw(games, false))
      .catch(() => draw(null, true));
  };

  draw(null, false); // loading state immediately
  fetchOnce();
  timer = setInterval(fetchOnce, POLL_MS);

  return function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
