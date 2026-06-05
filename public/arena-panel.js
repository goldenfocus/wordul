// public/arena-panel.js — the Arena (liquidity-bot) open-games list. Mount-agnostic by
// design: the home layout is being replaced by a 3-way launcher where "bots live in PvP",
// so this module exposes pure helpers + a `mountArenaList(el, { onJoin })` that can be
// dropped into whatever the PvP surface ends up being.
import { triesFor } from "/lobby-view.js";

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

// "taken/capacity" string for a row; defaults to a 1v1 when a rec omits seats.
export function seatLabel(game) {
  return (game && game.seats) || "1/2";
}

// FOMO highlight: a bigger room one seat from full → "grab the last seat" energy (the
// 4/5-vs-your-1/6 moment). Gated to capacity ≥ 3 so a plain 1/2 (and the missing-seats
// default) isn't flagged — otherwise nearly every room would glow and the cue is noise.
// A full room is about to vanish (unjoinable), so it's not hot either. Malformed → false.
export function isHot(game) {
  const [t, c] = seatLabel(game).split("/").map((n) => parseInt(n, 10));
  return Number.isFinite(t) && Number.isFinite(c) && c >= 3 && c - t === 1;
}

const POLL_MS = 8000;
const EMPTY_POLL_MS = 2000;

// Adaptive poll cadence: the standalone Arena polls fast while there's nothing tappable
// (loading/empty/error) — the server's alarmKick mints a room within ~250ms of an empty
// GET, so a quick re-poll is what makes it show up snappily — then relaxes to POLL_MS
// once rows exist. The in-room lobby rail always uses the calm cadence: it lives for
// minutes and its list is OFTEN legitimately empty (your own room is excluded).
export function nextPollMs(state, inLobby) {
  return state === "list" || inLobby ? POLL_MS : EMPTY_POLL_MS;
}

// Render the open-games list into `mountEl`, polling while mounted. Returns a stop()
// that clears the poll — the caller MUST invoke it on teardown (leaving the surface).
// onJoin(routePath) is called when a row is tapped (typically → navigate(routePath)).
// opts.excludePath: drop the row for that routePath (the room you're already sitting in)
//   and, when given, show the "you're first — others trickle in" lobby copy on an empty list.
export function mountArenaList(mountEl, { onJoin, excludePath } = {}) {
  if (!mountEl) return () => {};
  let stopped = false;
  let timer = null;
  const inLobby = excludePath != null; // rail-in-your-room mode vs the standalone /arena list
  let lastState = "loading"; // drives the adaptive poll cadence (nextPollMs)

  const draw = (games, isError) => {
    if (stopped) return;
    const visible = Array.isArray(games) ? games.filter((g) => g && g.routePath !== excludePath) : games;
    const state = arenaEmptyState(visible, isError);
    lastState = state;
    if (state === "loading") { mountEl.innerHTML = `<div class="arena-state">Finding opponents…</div>`; return; }
    if (state === "error") { mountEl.innerHTML = `<div class="arena-state">Couldn't reach the Arena. Retrying…</div>`; return; }
    if (state === "empty") {
      // Standalone empty stays on "Finding opponents…" — the fast poll + server kick will
      // surface a room in a beat or two, so "no open games" would just be a jarring flash.
      mountEl.innerHTML = `<div class="arena-state">${inLobby ? "You're first. Others will trickle in…" : "Finding opponents…"}</div>`;
      return;
    }
    const list = document.createElement("div");
    list.className = "arena-list";
    for (const g of visible) {
      const p = arenaRowProps(g);
      const tries = triesFor(p.wordLength);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "arena-row" + (isHot(g) ? " is-hot" : "");
      row.dataset.edition = p.edition;
      row.innerHTML =
        `<span class="arena-row-avatar" aria-hidden="true">${p.avatar}</span>` +
        `<span class="arena-row-body"><span class="arena-row-host">${p.host}</span>` +
        `<span class="arena-row-meta muted">${p.wordLength} letters · <span class="arena-row-tries">×${tries}</span></span></span>` +
        `<span class="arena-row-seats">${p.seats}</span>`;
      row.addEventListener("click", () => { if (onJoin) onJoin(p.routePath); });
      list.appendChild(row);
    }
    mountEl.innerHTML = "";
    const count = document.createElement("div");
    count.className = "arena-count muted";
    count.textContent = `${visible.length} open`;
    mountEl.appendChild(count);
    mountEl.appendChild(list);
  };

  // Self-scheduling poll (not setInterval): each tick re-arms at the cadence the freshly
  // drawn state calls for — fast while empty, relaxed once the list has rows.
  const tick = () => {
    fetch("/api/arena/open")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((games) => draw(games, false))
      .catch(() => draw(null, true))
      .then(() => {
        if (!stopped) timer = setTimeout(tick, nextPollMs(lastState, inLobby));
      });
  };

  draw(null, false); // loading state immediately
  tick();

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
