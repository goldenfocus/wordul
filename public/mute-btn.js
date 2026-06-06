// The visible in-game mute toggle (#muteBtn in the magic-bar, above the board).
// Single source of truth is localStorage["wordul.muted"] — the same key voice.js,
// drama.js, and app.js's playChime/playNoise already honor — so this button, the
// avatar-hub "Sound on/off" row, and every audio consumer stay in agreement.

const MUTE_LS = "wordul.muted";

export function isMuted() {
  return localStorage.getItem(MUTE_LS) === "1";
}

// Flip the flag, refresh the button, return the NEW muted state.
export function toggleMuted() {
  const muted = !isMuted();
  localStorage.setItem(MUTE_LS, muted ? "1" : "0");
  syncMuteBtn();
  return muted;
}

// Reflect the current flag on #muteBtn (glyph + a11y). Safe to call any time —
// also from the hub's mute row, so an out-of-band toggle updates the button.
export function syncMuteBtn() {
  const btn = document.getElementById("muteBtn");
  if (!btn) return;
  const muted = isMuted();
  btn.textContent = muted ? "🔇" : "🔊";
  btn.title = muted ? "Unmute" : "Mute";
  btn.setAttribute("aria-label", btn.title);
  btn.setAttribute("aria-pressed", muted ? "true" : "false");
  btn.classList.toggle("is-muted", muted);
}

// Wire the tap once + sync. Per-node guard (see #magicBtn note in powerups.js):
// the button is re-cloned on each room mount, so the flag rides the node itself.
export function wireMuteBtn(opts = {}) {
  const btn = document.getElementById("muteBtn");
  if (!btn) return;
  syncMuteBtn();
  if (btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const muted = toggleMuted();
    if (opts.onToggle) opts.onToggle(muted);
  });
}
