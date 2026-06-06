// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isMuted, toggleMuted, syncMuteBtn, wireMuteBtn } from "/mute-btn.js";

// The visible in-game mute button (magic-bar, above the board). One source of
// truth: localStorage["wordul.muted"] — the same key voice.js / drama.js /
// playChime already honor.

function mount() {
  const btn = document.createElement("button");
  btn.id = "muteBtn";
  document.body.appendChild(btn);
  return btn;
}

describe("mute-btn", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("isMuted reads the wordul.muted flag", () => {
    expect(isMuted()).toBe(false);
    localStorage.setItem("wordul.muted", "1");
    expect(isMuted()).toBe(true);
  });

  it("syncMuteBtn shows 🔊 when sound is on", () => {
    const btn = mount();
    syncMuteBtn();
    expect(btn.textContent).toBe("🔊");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.classList.contains("is-muted")).toBe(false);
  });

  it("syncMuteBtn shows 🔇 when muted", () => {
    localStorage.setItem("wordul.muted", "1");
    const btn = mount();
    syncMuteBtn();
    expect(btn.textContent).toBe("🔇");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.classList.contains("is-muted")).toBe(true);
  });

  it("syncMuteBtn is a no-op without the button", () => {
    expect(() => syncMuteBtn()).not.toThrow();
  });

  it("toggleMuted flips the flag and returns the new state", () => {
    expect(toggleMuted()).toBe(true);
    expect(localStorage.getItem("wordul.muted")).toBe("1");
    expect(toggleMuted()).toBe(false);
    expect(localStorage.getItem("wordul.muted")).toBe("0");
  });

  it("wireMuteBtn: a tap flips the flag, glyph, and reports the new state", () => {
    const btn = mount();
    const onToggle = vi.fn();
    wireMuteBtn({ onToggle });
    expect(btn.textContent).toBe("🔊"); // wired = synced immediately

    btn.click();
    expect(localStorage.getItem("wordul.muted")).toBe("1");
    expect(btn.textContent).toBe("🔇");
    expect(onToggle).toHaveBeenCalledWith(true);

    btn.click();
    expect(localStorage.getItem("wordul.muted")).toBe("0");
    expect(btn.textContent).toBe("🔊");
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("wireMuteBtn twice does not double-toggle on one tap (per-node guard)", () => {
    const btn = mount();
    wireMuteBtn();
    wireMuteBtn(); // room re-render calls again — must not stack listeners
    btn.click();
    expect(isMuted()).toBe(true); // one flip, not two
  });
});
