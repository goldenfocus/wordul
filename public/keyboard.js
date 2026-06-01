// Wordul — on-screen keyboard
// Owns the visual keyboard: layout tables (QWERTY/AZERTY), build + click wiring,
// the color map from MY guesses, and the settings layout picker. Pure of app.js
// globals — all app state (settings, input actions, board re-render) is injected
// by the orchestrator so this module never imports app.js (no circular import).

export const KEYBOARD_LAYOUTS = {
  qwerty: ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"],
  azerty: ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"],
};
export const KEYBOARD_LAYOUT_LABELS = { qwerty: "QWERTY", azerty: "AZERTY" };

// Resolve a layout *id* (not a settings object) to a known layout, falling back
// to qwerty. The orchestrator owns settings and passes the chosen id in.
export function activeLayoutId(layoutSetting) {
  return KEYBOARD_LAYOUTS[layoutSetting] ? layoutSetting : "qwerty";
}

// Auto-detect from the browser/OS locale. Only fr-* gets AZERTY today (the only
// non-QWERTY layout we ship); everything else is QWERTY. Pure + testable.
export function detectLayout(navLang) {
  const lang = (navLang || "").toLowerCase();
  return lang.startsWith("fr") ? "azerty" : "qwerty";
}

// Build the on-screen keyboard into `root` for `layoutId`, wiring a single
// delegated click listener that calls the injected handlers. innerHTML clears
// children on every rebuild (e.g. a layout switch) but the per-root listener is
// attached exactly once (guarded by a dataset flag) so clicks never double-fire.
export function buildKeyboard(root, layoutId, handlers) {
  if (!root) return;
  const rows = KEYBOARD_LAYOUTS[activeLayoutId(layoutId)];
  root.innerHTML = "";
  rows.forEach((letters, idx) => {
    const row = document.createElement("div");
    row.className = "kb-row";
    for (const l of letters) {
      const k = document.createElement("button");
      k.className = "key";
      k.textContent = l;
      k.dataset.key = l;
      row.appendChild(k);
    }
    // Match a real computer keyboard: ⌫ sits top-right (end of row 1), Enter
    // mid-right (end of row 2). The bottom row is letters only.
    if (idx === 0) {
      const back = document.createElement("button");
      back.className = "key wide";
      back.textContent = "⌫";
      back.dataset.action = "back";
      row.appendChild(back);
    } else if (idx === 1) {
      const enter = document.createElement("button");
      enter.className = "key wide";
      enter.textContent = "Enter";
      enter.dataset.action = "enter";
      row.appendChild(enter);
    }
    root.appendChild(row);
  });
  if (root.dataset.kbWired !== "1") {
    root.dataset.kbWired = "1";
    root.addEventListener("click", (e) => {
      const t = e.target.closest("button.key");
      if (!t) return;
      if (t.dataset.action === "enter") handlers.onEnter();
      else if (t.dataset.action === "back") handlers.onBack();
      else if (t.dataset.key) handlers.onLetter(t.dataset.key);
    });
  }
}

// Color the keys from MY guesses only (green beats yellow beats gray).
export function renderKeyboard(root, me) {
  if (!root) return;
  const map = {};
  const priority = { gray: 1, yellow: 2, green: 3 };
  if (me) {
    for (const g of me.guesses) {
      for (let i = 0; i < g.word.length; i++) {
        const k = g.word[i];
        const c = g.mask[i];
        if (!map[k] || priority[c] > priority[map[k]]) map[k] = c;
      }
    }
  }
  for (const key of root.querySelectorAll(".key")) {
    key.classList.remove("green", "yellow", "gray");
    const v = key.dataset.key;
    if (v && map[v]) key.classList.add(map[v]);
  }
}

// Settings: render the QWERTY / AZERTY chips. The picker stays settings-agnostic —
// it highlights `current` and calls `onPick(id)`; the orchestrator owns the
// save → rebuild → re-render. Physical typing is unaffected (onPhysicalKey types
// by character), so layout is purely the visual + click order.
export function renderLayoutPicker(rootEl, { current, onPick }) {
  rootEl.innerHTML = "";
  for (const id of Object.keys(KEYBOARD_LAYOUTS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edition-chip" + (id === current ? " is-active" : "");
    btn.textContent = KEYBOARD_LAYOUT_LABELS[id] ?? id.toUpperCase();
    btn.addEventListener("click", () => {
      rootEl.querySelectorAll(".edition-chip").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      onPick(id);
    });
    rootEl.appendChild(btn);
  }
}
