// Wordul — the hacker-log terminal.
//
// A transient, green-on-dark terminal that fades in near the board during a gold
// payout and types each line out monospace with a ">" prompt. After the payout it
// collapses to a 1-line ticker ("▸ <last line> [tap to expand]"); tapping it expands
// the full scrollback. It keeps an in-memory scrollback for the round and exposes the
// structured entries via getEntries() so the end-screen / replay can render the run
// "line by line".
//
// Self-contained: no imports from app.js, no economy knowledge. reducedMotion is passed
// IN by the caller (app.js reads getSettings().reducedMotion) so this module stays
// decoupled. reducedMotion → lines appear instantly (no typewriter, no pending timers).
//
// NOTE: this module is NOT wired into the guess flow yet — playPayoutSequence will call
// logLine() per beat in a later step. It is safe to mount and exercise standalone.

// Per-character typing cadence for the typewriter effect (ms). Tunable.
export const TYPE_CHAR_MS = 22;

// Build the DOM scaffold for the terminal inside `mountEl`.
function buildDom(mountEl) {
  mountEl.classList.add("hacklog");
  mountEl.innerHTML = "";
  const body = document.createElement("div");
  body.className = "hacklog-body";
  const ticker = document.createElement("div");
  ticker.className = "hacklog-ticker";
  ticker.setAttribute("role", "button");
  ticker.setAttribute("tabindex", "0");
  mountEl.appendChild(body);
  mountEl.appendChild(ticker);
  return { body, ticker };
}

// createHacklog(mountEl, { reducedMotion }) → terminal API.
// API:
//   logLine(text, { tone })  append a ">"-prefixed line; types it out when expanded
//                            (unless reducedMotion). tone ∈ 'gain' | 'loss' | 'combo'.
//   addInstant(text, opts)   append a line with no typewriter, ever.
//   collapse()               collapse to the 1-line ticker.
//   expand()                 show the full scrollback.
//   getEntries()             → Array<{ text, tone }> in append order (for replay).
//   clear()                  reset scrollback + ticker (between rounds).
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

  const { body, ticker } = buildDom(mountEl);

  const entries = [];        // structured scrollback: { text, tone }
  const queue = [];          // pending lines to type (so calls never interleave)
  let typing = false;        // is the typewriter loop currently running?
  let typeTimer = null;      // active per-char interval id
  let collapsed = true;      // ticker vs full scrollback — DEFAULT one-line ticker (mobile-pure)

  // Render the collapsed ticker from the most recent entry.
  function renderTicker() {
    const last = entries[entries.length - 1];
    ticker.textContent = last ? `▸ ${last.text}  [tap to expand]` : "▸ [tap to expand]";
  }

  // Reflect collapsed/expanded state on the DOM.
  function applyState() {
    mountEl.classList.toggle("collapsed", collapsed);
    if (collapsed) renderTicker();
    else body.scrollTop = body.scrollHeight; // keep the newest line in view
  }

  // Append a finished line element to the scrollback body.
  function appendLineEl(text, tone) {
    const el = document.createElement("div");
    el.className = "hacklog-line" + (tone ? ` ${tone}` : "");
    el.textContent = text;
    body.appendChild(el);
    if (!collapsed) body.scrollTop = body.scrollHeight;
    return el;
  }

  // Pump the typing queue: type each pending line char-by-char, in order.
  function pump() {
    if (typing) return;
    const next = queue.shift();
    if (!next) return;
    typing = true;
    const { text, tone } = next;
    const el = appendLineEl("", tone);
    let i = 0;
    typeTimer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (!collapsed) body.scrollTop = body.scrollHeight;
      if (i >= text.length) {
        clearInterval(typeTimer);
        typeTimer = null;
        typing = false;
        pump(); // type the next queued line, if any
      }
    }, TYPE_CHAR_MS);
  }

  function logLine(text, o = {}) {
    const line = `> ${String(text)}`;
    const tone = o.tone || null;
    entries.push({ text: line, tone });
    if (collapsed) renderTicker();
    if (reducedMotion) {
      appendLineEl(line, tone);
      return;
    }
    queue.push({ text: line, tone });
    pump();
  }

  function addInstant(text, o = {}) {
    const line = String(text);
    const tone = o.tone || null;
    entries.push({ text: line, tone });
    appendLineEl(line, tone);
    if (collapsed) renderTicker();
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
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    typing = false;
    queue.length = 0;
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

  applyState(); // reflect the default collapsed (one-line ticker) state on mount
  return { logLine, addInstant, collapse, expand, getEntries, clear };
}
