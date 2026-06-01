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
  // Make every LETTER key the same width across ALL rows (not just within a row): give
  // each row the same total flex "units" by padding the shorter rows with end spacers.
  // units = letters (1 each) + a wide key (1.5) on rows 0/1. Deficit vs the widest row is
  // split as a spacer on each end → all letters render at rowWidth / maxUnits.
  const WIDE = 1.5;
  const units = rows.map((letters, idx) => letters.length + (idx <= 1 ? WIDE : 0));
  const maxUnits = Math.max(...units);
  const spacer = (flex) => {
    const s = document.createElement("div");
    s.className = "kb-spacer";
    s.style.flex = `${flex} 1 0`;
    return s;
  };
  rows.forEach((letters, idx) => {
    const row = document.createElement("div");
    row.className = "kb-row";
    const pad = (maxUnits - units[idx]) / 2; // split the deficit across both ends
    if (pad > 0) row.appendChild(spacer(pad));
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
    if (pad > 0) row.appendChild(spacer(pad));
    root.appendChild(row);
  });
  if (root.dataset.kbWired !== "1") {
    root.dataset.kbWired = "1";

    function fire(t) {
      if (!t) return;
      if (t.dataset.action === "enter") handlers.onEnter();
      else if (t.dataset.action === "back") handlers.onBack();
      else if (t.dataset.key) handlers.onLetter(t.dataset.key);
    }
    const keyAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && el.closest ? el.closest("button.key") : null;
    };

    // Touch path — mimic the iOS keyboard so it stops feeling twitchy: the key only
    // commits on RELEASE, the key under your finger updates as you slide (slide to
    // correct a mis-tap), and lifting off any key cancels instead of firing. A gap
    // tap registers nothing. We handle touch ourselves and swallow the synthesized
    // click so it can't double-fire; mouse + synthetic .click() still use the click
    // path below (keeps desktop + tests working).
    let activeKey = null;
    let suppressClick = false;
    const press = (k) => {
      if (activeKey && activeKey !== k) activeKey.classList.remove("pressed");
      activeKey = k;
      if (k) k.classList.add("pressed");
    };
    root.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") { e.preventDefault(); return; } // focus off; let click handle it
      const k = e.target.closest && e.target.closest("button.key");
      if (!k) return;
      e.preventDefault();
      press(k);
    });
    root.addEventListener("pointermove", (e) => {
      if (!activeKey) return;
      const k = keyAt(e.clientX, e.clientY);
      press(k); // null when slid into a gap → release there cancels
    });
    function endTouch(e) {
      if (e.pointerType === "mouse") return;
      const target = activeKey;
      if (activeKey) { activeKey.classList.remove("pressed"); activeKey = null; }
      // Commit the key under the lift-off point (slide-to-correct); none → cancel.
      const k = (e.type === "pointerup") ? (keyAt(e.clientX, e.clientY) || target) : null;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 400);
      fire(k);
    }
    root.addEventListener("pointerup", endTouch);
    root.addEventListener("pointercancel", endTouch);

    root.addEventListener("click", (e) => {
      if (suppressClick) return; // touch already handled this
      fire(e.target.closest("button.key"));
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
