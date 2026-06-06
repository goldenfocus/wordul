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
  // Letters fill a column on the left; the two actions live in a tall right rail.
  // Every row stretches edge-to-edge of the keyboard rectangle: shorter rows simply
  // get WIDER keys (flex stretch, capped by .key max-width) — no equalizing spacers.
  const letters = document.createElement("div");
  letters.className = "kb-letters";
  rows.forEach((rowLetters) => {
    const row = document.createElement("div");
    row.className = "kb-row";
    for (const l of rowLetters) {
      const k = document.createElement("button");
      k.className = "key";
      k.textContent = l;
      k.dataset.key = l;
      row.appendChild(k);
    }
    letters.appendChild(row);
  });
  root.appendChild(letters);

  // Right rail: ⌫ stacked on top, the big Return below — both fall under the right thumb.
  const rail = document.createElement("div");
  rail.className = "kb-rail";
  const back = document.createElement("button");
  back.className = "key rail-key";
  back.textContent = "⌫";
  back.dataset.action = "back";
  back.setAttribute("aria-label", "Backspace");
  const enter = document.createElement("button");
  enter.className = "key rail-key enter";
  enter.textContent = "↵";
  enter.dataset.action = "enter";
  enter.setAttribute("aria-label", "Enter");
  rail.append(back, enter);
  root.appendChild(rail);
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
    // One tap = one letter (the double-letter bug, Jun 5): only the pointer that
    // PRESSED a key may commit on its lift — a palm graze, a resting thumb, or a
    // finger that went down on the board and lifted over the keys types nothing.
    let activeKey = null;
    let activePointer = null; // pointerId that owns the current press
    let suppressClick = false;
    let suppressTimer = null;
    // Long-press ⌫ to wipe the whole row (the mobile twin of desktop's Esc). The
    // timer arms on press of the back key and disarms the moment you slide off it.
    let longPressTimer = null;
    let didLongPress = false;
    const HOLD_MS = 400;
    const armHold = (k) => {
      clearHold();
      if (k && k.dataset.action === "back" && handlers.onClear) {
        longPressTimer = setTimeout(() => {
          didLongPress = true;
          if (activeKey) { activeKey.classList.remove("pressed"); activeKey = null; }
          handlers.onClear();
        }, HOLD_MS);
      }
    };
    const clearHold = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };
    const press = (k) => {
      if (activeKey && activeKey !== k) activeKey.classList.remove("pressed");
      if (k !== activeKey) { clearHold(); armHold(k); }
      activeKey = k;
      if (k) k.classList.add("pressed");
    };
    root.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") { e.preventDefault(); return; } // focus off; let click handle it
      const k = e.target.closest && e.target.closest("button.key");
      if (!k) return;
      e.preventDefault();
      // A second finger landing while a key is held commits the held key NOW (how the
      // iOS keyboard handles two-thumb typing) — and hands the press to the new finger,
      // so the first finger's later lift-off can't fire anything.
      if (activeKey && activePointer !== null && e.pointerId !== activePointer) {
        clearHold();
        const held = activeKey;
        held.classList.remove("pressed");
        activeKey = null;
        fire(held);
      }
      didLongPress = false;
      activePointer = e.pointerId;
      press(k);
    });
    root.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activePointer) return; // an extra/resting finger can't steal the press
      if (!activeKey && !longPressTimer) return;
      const k = keyAt(e.clientX, e.clientY);
      press(k); // null when slid into a gap → release there cancels
    });
    function endTouch(e) {
      if (e.pointerType === "mouse") return;
      if (e.pointerId !== activePointer) return; // this pointer never pressed a key — nothing to commit
      activePointer = null;
      clearHold();
      const target = activeKey;
      if (activeKey) { activeKey.classList.remove("pressed"); activeKey = null; }
      suppressClick = true;
      // Rapid taps: cancel the previous tap's backstop or it'd unsuppress THIS tap's
      // still-pending synthesized click mid-window — the timer race behind doubles.
      if (suppressTimer) clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => { suppressClick = false; suppressTimer = null; }, 400);
      // A long-press already cleared the row on its own — don't also fire a backspace.
      if (didLongPress) { didLongPress = false; return; }
      // Commit the key under the lift-off point (slide-to-correct); none → cancel.
      const k = (e.type === "pointerup") ? (keyAt(e.clientX, e.clientY) || target) : null;
      fire(k);
    }
    root.addEventListener("pointerup", endTouch);
    root.addEventListener("pointercancel", endTouch);

    root.addEventListener("click", (e) => {
      // A tap's synthesized click must never re-type the letter. Three layers, because
      // main-thread jank (tile flips, payout tweens) can deliver the click later than
      // any fixed timer: a one-shot flag eats the expected click, the timed backstop
      // clears a flag no click ever claimed, and pointerType — on browsers that ship
      // click as a PointerEvent — catches a click that outlived both.
      if (suppressClick) { suppressClick = false; return; }
      if (e.pointerType === "touch" || e.pointerType === "pen") return;
      fire(e.target.closest("button.key"));
    });
  }
}

// Color the keys from MY guesses only (hot beats warm beats cold).
export function renderKeyboard(root, me) {
  if (!root) return;
  const map = {};
  const priority = { cold: 1, warm: 2, hot: 3 };
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
    key.classList.remove("hot", "warm", "cold");
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
