// Wordul — settings panel + the avatar hub
// Owns the player's preference storage (get/save/apply) AND the two consolidated
// menus that used to be scattered icons: the SETTINGS modal (now collapsible
// chevron sections, calm on open) and the avatar HUB popover (settings / mute /
// stats / theme + the mid-play-hidden chrome: share / rename / scoreboard).
//
// Pure of app.js globals — every orchestrator action (render, toast, stats, share,
// rename, scoreboard, the keyboard layout picker) is injected via callbacks so this
// module never imports app.js (the <script type="module"> entry) and the graph
// never cycles. The keyboard layout picker is mounted via the `mountLayoutPicker`
// callback the orchestrator passes in (keyboard.js imports settings, not the reverse).

const SETTINGS_KEY = "wr.settings";

export const DEFAULT_SETTINGS = {
  hardMode: false,
  colorBlind: false,
  reducedMotion: false,
  // "auto" = detect from browser/OS locale (fr-* → AZERTY) until the player picks
  // explicitly in settings; an explicit pick is persisted and always wins.
  keyboardLayout: "auto",
};

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  applySettings(s);
}

export function applySettings(s) {
  document.body.classList.toggle("cb", !!s.colorBlind);
  document.body.classList.toggle("reduced-motion", !!s.reducedMotion);
}

// --- Settings modal ---
//
// The panel is a list of collapsible chevron SECTIONS, all collapsed on open
// ("calm" — less colour/noise). A single delegated listener on the modal toggles a
// section open/closed and flips its head's aria-expanded (the chevron rotation is
// pure CSS, disabled under reduced-motion).
function wireSectionToggles(modal) {
  // Idempotent: re-wiring on every open is fine because we only ever attach ONE
  // delegated click handler to the modal (the dataset guard), and collapse all
  // sections back to "calm" each open.
  for (const head of modal.querySelectorAll(".settings-section-head")) {
    head.setAttribute("aria-expanded", "false");
  }
  if (modal.dataset.sectionsWired === "1") return;
  modal.dataset.sectionsWired = "1";
  modal.addEventListener("click", (e) => {
    const head = e.target.closest(".settings-section-head");
    if (!head || !modal.contains(head)) return;
    const open = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!open));
  });
}

// openSettings({ onChange, mountLayoutPicker, renderEditionPicker })
//  - onChange()           re-applies the live board after a toggle/theme change (the
//                         orchestrator wires this to `() => { if (game.snapshot) render(); }`).
//  - mountLayoutPicker(el) lets the orchestrator (or keyboard.js) render the layout
//                         picker into the Advanced section — avoids a settings↔keyboard cycle.
//  - renderEditionPicker(el, onPick) the edition.js theme picker (re-imported by the caller).
//  - toast(text, opts)    optional feedback channel (app.js owns the toast UI).
export function openSettings({ onChange, mountLayoutPicker, renderEditionPicker, onEditionPick, editionLocked, toast } = {}) {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;
  const s = getSettings();
  const hm = document.getElementById("setHardMode");
  const cb = document.getElementById("setColorBlind");
  const rm = document.getElementById("setReducedMotion");
  if (hm) hm.checked = s.hardMode;
  if (cb) cb.checked = s.colorBlind;
  if (rm) rm.checked = s.reducedMotion;

  // Wire toggles every open (idempotent — replace old listeners by cloning so a
  // re-open never stacks duplicate change handlers that double-fire).
  const wire = (el, key) => {
    if (!el) return;
    const fresh = el.cloneNode(true);
    el.replaceWith(fresh);
    fresh.checked = s[key];
    fresh.addEventListener("change", () => {
      const next = { ...getSettings(), [key]: fresh.checked };
      saveSettings(next);
      onChange?.(); // apply colorblind/hard-mode/reduced-motion to the live board now
    });
  };
  wire(hm, "hardMode");
  wire(cb, "colorBlind");
  wire(rm, "reducedMotion");

  // Theme/edition picker. The theme is bound to the room, so a pick re-applies settings
  // locally AND notifies the caller (onEditionPick → set_edition for everyone). Locked
  // mid-game: the picker renders disabled so the look can't shift under a live board.
  const picker = document.getElementById("editionPicker");
  if (picker && renderEditionPicker) {
    renderEditionPicker(picker, (id) => {
      applySettings(getSettings());
      onChange?.();
      onEditionPick?.(id);
      toast?.("Theme applied — everyone in the room sees it", { duration: 1200 });
    }, { disabled: !!editionLocked });
  }

  // Keyboard layout picker lives under "Advanced". The orchestrator owns the
  // save → rebuild → re-render; we just hand it the mount element.
  const layoutPicker = document.getElementById("layoutPicker");
  if (layoutPicker && mountLayoutPicker) mountLayoutPicker(layoutPicker);

  wireSectionToggles(modal);

  modal.hidden = false;
  modal.removeAttribute("hidden");
  modal.addEventListener("click", onSettingsModalClick);
}

function onSettingsModalClick(e) {
  if (e.target.matches("[data-close-settings]")) closeSettings();
}

function closeSettings() {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("hidden", "");
  modal.removeEventListener("click", onSettingsModalClick);
}

// --- Avatar hub ---
//
// The avatar in the topbar is the single entry point that replaces the scattered
// ⚙ / 📊 / 🔊 icons AND keeps the mid-play-hidden chrome reachable (share / rename /
// scoreboard). It's a lightweight popover: the orchestrator wires every action as a
// callback (stats/share/rename/scoreboard logic all live in app.js), settings.js just
// builds the menu and routes taps.
//
// openHub({ anchor, onSettings, onStats, onMute, onShare, onRename, onScoreboard,
//           isMuted, inRoom })
//  - anchor       the avatar button the popover hangs off (for positioning + outside-click).
//  - inRoom       true while inside a room — gates the room-only rows (share/rename/scoreboard).
//  - onShare/onRename/onScoreboard may be omitted (e.g. on home); their rows hide.
//  - onShare MUST run synchronously inside this click so navigator.share keeps its
//    user-gesture (we close the hub AFTER invoking, never before).
let hubEl = null;
let hubOutsideHandler = null;

function closeHub() {
  if (hubEl) { hubEl.remove(); hubEl = null; }
  if (hubOutsideHandler) {
    document.removeEventListener("click", hubOutsideHandler, true);
    hubOutsideHandler = null;
  }
}

export function openHub(opts = {}) {
  // Toggle: a second tap on the avatar closes it.
  if (hubEl) { closeHub(); return; }
  const { anchor, isMuted, inRoom } = opts;

  const menu = document.createElement("div");
  menu.className = "hub-menu";
  menu.setAttribute("role", "menu");

  const addItem = (icon, label, handler, { keepOpen = false } = {}) => {
    if (!handler) return;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "hub-item";
    item.setAttribute("role", "menuitem");
    const ic = document.createElement("span");
    ic.className = "hub-icon";
    ic.textContent = icon;
    ic.setAttribute("aria-hidden", "true");
    const tx = document.createElement("span");
    tx.className = "hub-label";
    tx.textContent = label;
    item.append(ic, tx);
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      // Run the action FIRST (synchronous → navigator.share keeps its gesture),
      // then close — unless the action wants the menu to stay (mute re-renders inline).
      handler();
      if (!keepOpen) closeHub();
    });
    menu.appendChild(item);
  };

  // Always available.
  addItem("⚙", "Settings", opts.onSettings);
  addItem("🎨", "Theme", opts.onTheme);
  addItem(isMuted ? "🔇" : "🔊", isMuted ? "Sound off" : "Sound on", opts.onMute, { keepOpen: false });
  addItem("📊", "Stats", opts.onStats);

  // Room-only — these are the chrome we hide mid-play, surfaced here so nothing is orphaned.
  if (inRoom) {
    addItem("↗", "Share / invite", opts.onShare);
    addItem("✎", "Rename room", opts.onRename);
    addItem("🏆", "Scoreboard", opts.onScoreboard);
  }

  hubEl = menu;
  document.body.appendChild(menu);
  positionHub(menu, anchor);

  // Outside-click / Escape closes. Capture phase so it runs before the avatar's own
  // toggle handler re-opens it. Deferred a tick so THIS opening click doesn't insta-close.
  setTimeout(() => {
    hubOutsideHandler = (e) => {
      if (menu.contains(e.target) || (anchor && anchor.contains(e.target))) return;
      closeHub();
    };
    document.addEventListener("click", hubOutsideHandler, true);
  }, 0);
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { closeHub(); document.removeEventListener("keydown", onKey); }
  });
}

// Anchor the popover under the avatar, clamped to the viewport's right edge.
function positionHub(menu, anchor) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  // Right-align to the avatar so the menu never spills off-screen.
  const right = Math.max(8, window.innerWidth - Math.round(r.right));
  menu.style.right = `${right}px`;
}
