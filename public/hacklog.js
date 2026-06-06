// Wordul — the hacker-log terminal.
//
// The visible play surface is a FLOATING terminal line below the board: each event
// types in monospace with a ">" prompt, holds a beat, then vanishes (the previous
// line ghosts faintly while the new one lands). Nothing persists on screen except a
// dim "▸" tap target — tapping it expands the full scrollback as an overlay. Lines
// are tone-classed from the tile palette (hot/warm/loss/combo/gain) so editions
// re-light them via CSS.
//
// It keeps an in-memory scrollback for the round and exposes the structured entries
// via getEntries() so the end-screen / replay can render the run "line by line".
//
// Self-contained: no imports from app.js, no economy knowledge. reducedMotion is passed
// IN by the caller (app.js reads getSettings().reducedMotion) so this module stays
// decoupled. reducedMotion → lines appear instantly (no typewriter) but still auto-hide.

// Per-character typing cadence for the typewriter effect (ms). Tunable.
export const TYPE_CHAR_MS = 22;
// How long a finished float line stays readable before it starts to vanish.
export const HOLD_MS = 3500;
// Vanish fade duration (matches the CSS .vanishing transition).
export const FADE_MS = 450;
// How long a preempted line lingers as a ghost above the new one.
export const GHOST_MS = 900;

// Build the DOM scaffold for the terminal inside `mountEl`.
function buildDom(mountEl) {
  mountEl.classList.add("hacklog");
  mountEl.innerHTML = "";
  const float = document.createElement("div");
  float.className = "hacklog-float";
  const body = document.createElement("div");
  body.className = "hacklog-body";
  const ticker = document.createElement("div");
  ticker.className = "hacklog-ticker";
  ticker.setAttribute("role", "button");
  ticker.setAttribute("tabindex", "0");
  ticker.setAttribute("aria-label", "Show full event log");
  mountEl.appendChild(float);
  mountEl.appendChild(body);
  mountEl.appendChild(ticker);
  return { float, body, ticker };
}

// createHacklog(mountEl, { reducedMotion }) → terminal API.
// API:
//   logLine(text, { tone })  append a ">"-prefixed line; surfaces it as the floating
//                            line (typewriter unless reducedMotion). tone ∈
//                            'hot' | 'warm' | 'loss' | 'combo' | 'gain'.
//   addInstant(text, opts)   append a line with no typewriter, ever.
//   collapse()               collapse to the play surface (float line + ▸ target).
//   expand()                 show the full scrollback.
//   getEntries()             → Array<{ text, tone }> in append order (for replay).
//   clear()                  reset scrollback + float zone (between rounds).
export function createHacklog(mountEl, opts = {}) {
  const reducedMotion = !!opts.reducedMotion;
  if (!mountEl) {
    // No mount point — return a no-op API so callers never have to null-check.
    const entries = [];
    return {
      logLine(text, o = {}) { entries.push({ text: String(text), tone: o.tone || null }); },
      addInstant(text, o = {}) { entries.push({ text: String(text), tone: o.tone || null }); },
      collapse() {}, expand() {}, getEntries() { return entries.slice(); }, clear() { entries.length = 0; },
    };
  }

  const { float, body, ticker } = buildDom(mountEl);

  const entries = [];        // structured scrollback: { text, tone }
  let collapsed = true;      // play surface vs full scrollback — DEFAULT collapsed
  let active = null;         // current float line: { el, typeTimer, holdTimer, fadeTimer }
  let ghost = null;          // preempted float line: { el, timer }

  // The rest-state ticker is a bare tap affordance — never a copy of the log.
  function renderTicker() {
    ticker.textContent = "▸";
  }

  // Reflect collapsed/expanded state on the DOM.
  function applyState() {
    mountEl.classList.toggle("collapsed", collapsed);
    if (!collapsed) body.scrollTop = body.scrollHeight; // keep the newest line in view
  }

  // Append a finished line element to the scrollback body (always instant — the
  // body is the audit log; the typewriter lives on the float line only).
  function appendLineEl(text, tone) {
    const el = document.createElement("div");
    el.className = "hacklog-line" + (tone ? ` ${tone}` : "");
    el.textContent = text;
    body.appendChild(el);
    if (!collapsed) body.scrollTop = body.scrollHeight;
    return el;
  }

  // ---- floating-line lifecycle: surface → (type) → hold → vanish ----

  function dropGhost() {
    if (!ghost) return;
    clearTimeout(ghost.timer);
    ghost.el.remove();
    ghost = null;
  }

  function dropActive() {
    if (!active) return;
    if (active.typeTimer) clearInterval(active.typeTimer);
    clearTimeout(active.holdTimer);
    clearTimeout(active.fadeTimer);
    active.el.remove();
    active = null;
  }

  // Preempt the current line: it becomes the ghost (one ghost max), making room
  // for the incoming line. Bursts therefore never stack more than active+ghost.
  function ghostActive() {
    if (!active) return;
    dropGhost();
    if (active.typeTimer) clearInterval(active.typeTimer);
    clearTimeout(active.holdTimer);
    clearTimeout(active.fadeTimer);
    const el = active.el;
    el.textContent = active.text; // a half-typed line ghosts as its FULL after-image
    el.classList.add("ghost");
    ghost = { el, timer: setTimeout(() => { el.remove(); if (ghost && ghost.el === el) ghost = null; }, GHOST_MS) };
    active = null;
  }

  function beginHold(entry) {
    entry.holdTimer = setTimeout(() => {
      if (reducedMotion) {
        // No blur/fade animation — just leave the screen at the end of the hold.
        entry.el.remove();
        if (active === entry) active = null;
        return;
      }
      entry.el.classList.add("vanishing");
      entry.fadeTimer = setTimeout(() => {
        entry.el.remove();
        if (active === entry) active = null;
      }, FADE_MS);
    }, HOLD_MS);
  }

  function surfaceFloat(text, tone, instant) {
    ghostActive();
    const el = document.createElement("div");
    el.className = "hacklog-fline" + (tone ? ` ${tone}` : "");
    float.appendChild(el);
    const entry = { el, text, typeTimer: null, holdTimer: null, fadeTimer: null };
    active = entry;
    if (instant || reducedMotion) {
      el.textContent = text;
      beginHold(entry);
      return;
    }
    let i = 0;
    entry.typeTimer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(entry.typeTimer);
        entry.typeTimer = null;
        beginHold(entry);
      }
    }, TYPE_CHAR_MS);
  }

  function logLine(text, o = {}) {
    const line = `> ${String(text)}`;
    const tone = o.tone || null;
    entries.push({ text: line, tone });
    appendLineEl(line, tone);
    surfaceFloat(line, tone, false);
  }

  function addInstant(text, o = {}) {
    const line = String(text);
    const tone = o.tone || null;
    entries.push({ text: line, tone });
    appendLineEl(line, tone);
    surfaceFloat(line, tone, true);
  }

  function collapse() {
    collapsed = true;
    applyState();
  }

  function expand() {
    collapsed = false;
    applyState();
  }

  function getEntries() {
    return entries.map((e) => ({ text: e.text, tone: e.tone }));
  }

  function clear() {
    dropActive();
    dropGhost();
    entries.length = 0;
    body.innerHTML = "";
    renderTicker();
  }

  // Tapping (or Enter/Space on) the ticker toggles expand/collapse.
  function toggle() {
    if (collapsed) expand(); else collapse();
  }
  ticker.addEventListener("click", toggle);
  ticker.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });

  renderTicker();
  applyState(); // reflect the default collapsed state on mount
  return { logLine, addInstant, collapse, expand, getEntries, clear };
}
