// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  KEYBOARD_LAYOUTS,
  KEYBOARD_LAYOUT_LABELS,
  activeLayoutId,
  detectLayout,
  buildKeyboard,
  renderKeyboard,
  renderLayoutPicker,
} from "/keyboard.js";

describe("detectLayout", () => {
  it("maps fr* locales to azerty", () => {
    expect(detectLayout("fr")).toBe("azerty");
    expect(detectLayout("fr-FR")).toBe("azerty");
    expect(detectLayout("FR-CA")).toBe("azerty");
  });
  it("maps everything else to qwerty", () => {
    expect(detectLayout("en-US")).toBe("qwerty");
    expect(detectLayout("de")).toBe("qwerty");
    expect(detectLayout(undefined)).toBe("qwerty");
    expect(detectLayout(null)).toBe("qwerty");
    expect(detectLayout("")).toBe("qwerty");
  });
});

describe("activeLayoutId", () => {
  it("returns a known layout id unchanged", () => {
    expect(activeLayoutId("azerty")).toBe("azerty");
    expect(activeLayoutId("qwerty")).toBe("qwerty");
  });
  it("falls back to qwerty for unknown / missing ids", () => {
    expect(activeLayoutId("bogus")).toBe("qwerty");
    expect(activeLayoutId(undefined)).toBe("qwerty");
    expect(activeLayoutId("auto")).toBe("qwerty");
  });
});

const noopHandlers = () => ({ onEnter: vi.fn(), onBack: vi.fn(), onLetter: vi.fn() });

describe("buildKeyboard", () => {
  it("renders all 26 letters once plus ⌫ and Return", () => {
    const root = document.createElement("div");
    buildKeyboard(root, "qwerty", noopHandlers());
    const letterKeys = root.querySelectorAll(".key[data-key]");
    expect(letterKeys.length).toBe(26);
    const letters = Array.from(letterKeys).map((k) => k.dataset.key).sort().join("");
    expect(letters).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(root.querySelector('.key[data-action="back"]').textContent).toBe("⌫");
    expect(root.querySelector('.key[data-action="enter"]').textContent).toBe("↵");
    // Actions live in the right rail (out of the letter grid), ⌫ stacked above Return.
    const rail = root.querySelector(".kb-rail");
    expect(rail).not.toBeNull();
    const railKeys = rail.querySelectorAll(".key[data-action]");
    expect(railKeys[0].dataset.action).toBe("back");
    expect(railKeys[1].dataset.action).toBe("enter");
    // Letter rows are pure letters now — no action keys mixed in, so every letter is full-size.
    for (const row of root.querySelectorAll(".kb-row")) {
      expect(row.querySelector(".key[data-action]")).toBeNull();
    }
  });

  it("reorders keys for azerty (top row starts AZERTY)", () => {
    const root = document.createElement("div");
    buildKeyboard(root, "azerty", noopHandlers());
    const firstRow = root.querySelector(".kb-row");
    const order = Array.from(firstRow.querySelectorAll(".key[data-key]")).map((k) => k.dataset.key).join("");
    expect(order).toBe("AZERTYUIOP");
  });

  it("falls back to qwerty for an unknown layout id", () => {
    const root = document.createElement("div");
    buildKeyboard(root, "bogus", noopHandlers());
    const firstRow = root.querySelector(".kb-row");
    const order = Array.from(firstRow.querySelectorAll(".key[data-key]")).map((k) => k.dataset.key).join("");
    expect(order).toBe("QWERTYUIOP");
  });

  it("fires the right handler on a synthetic click", () => {
    const root = document.createElement("div");
    const h = noopHandlers();
    document.body.appendChild(root);
    buildKeyboard(root, "qwerty", h);
    root.querySelector('.key[data-key="Q"]').click();
    expect(h.onLetter).toHaveBeenCalledWith("Q");
    root.querySelector('.key[data-action="back"]').click();
    expect(h.onBack).toHaveBeenCalledTimes(1);
    root.querySelector('.key[data-action="enter"]').click();
    expect(h.onEnter).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("does not double-bind clicks across rebuilds (layout switch)", () => {
    const root = document.createElement("div");
    const h = noopHandlers();
    document.body.appendChild(root);
    buildKeyboard(root, "qwerty", h);
    buildKeyboard(root, "azerty", h); // rebuild — listener must stay single
    root.querySelector('.key[data-action="enter"]').click();
    expect(h.onEnter).toHaveBeenCalledTimes(1);
    root.remove();
  });
});

describe("renderKeyboard", () => {
  it("color-maps keys from my guesses (green beats yellow beats gray)", () => {
    const root = document.createElement("div");
    buildKeyboard(root, "qwerty", noopHandlers());
    const me = {
      guesses: [
        { word: "QUERY", mask: ["cold", "warm", "hot", "cold", "cold"] },
        { word: "QUEEN", mask: ["hot", "cold", "cold", "cold", "cold"] }, // Q upgrades cold→hot
      ],
    };
    renderKeyboard(root, me);
    expect(root.querySelector('.key[data-key="Q"]').classList.contains("hot")).toBe(true);
    expect(root.querySelector('.key[data-key="U"]').classList.contains("warm")).toBe(true);
    expect(root.querySelector('.key[data-key="E"]').classList.contains("hot")).toBe(true);
    expect(root.querySelector('.key[data-key="R"]').classList.contains("cold")).toBe(true);
  });
});

describe("renderLayoutPicker", () => {
  it("renders a chip per layout, marks current, and calls onPick without saving itself", () => {
    const root = document.createElement("div");
    const onPick = vi.fn();
    renderLayoutPicker(root, { current: "azerty", onPick });
    const chips = root.querySelectorAll(".edition-chip");
    expect(chips.length).toBe(Object.keys(KEYBOARD_LAYOUTS).length);
    const active = root.querySelector(".edition-chip.is-active");
    expect(active.textContent).toBe(KEYBOARD_LAYOUT_LABELS.azerty);
    // Click the qwerty chip → onPick fires with its id; active flips.
    const qwertyChip = Array.from(chips).find((c) => c.textContent === KEYBOARD_LAYOUT_LABELS.qwerty);
    qwertyChip.click();
    expect(onPick).toHaveBeenCalledWith("qwerty");
    expect(qwertyChip.classList.contains("is-active")).toBe(true);
  });
});

// One tap = one letter. The touch path commits on pointerup and must defuse the
// browser's synthesized click — which main-thread jank (tile flips, payout tweens)
// can deliver later than any fixed timer. And only the pointer that actually pressed
// a key may commit: palm grazes and board-origin lift-offs type nothing.
// (The double-letter bug, Jun 5 2026.)
describe("buildKeyboard touch path — one tap, one letter", () => {
  const ptr = (type, target, { id = 1, x = 0, y = 0, ptype = "touch" } = {}) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    e.pointerId = id;
    e.pointerType = ptype;
    e.clientX = x;
    e.clientY = y;
    target.dispatchEvent(e);
    return e;
  };
  const setup = () => {
    const root = document.createElement("div");
    const h = noopHandlers();
    document.body.appendChild(root);
    buildKeyboard(root, "qwerty", h);
    // jsdom has no layout: slide-to-correct's elementFromPoint resolves to nothing,
    // so commits fall back to the pressed key (the `|| target` branch).
    document.elementFromPoint = vi.fn(() => null);
    return { root, h, key: (l) => root.querySelector(`.key[data-key="${l}"]`) };
  };

  it("a touch tap commits exactly once, on release", () => {
    const { root, h, key } = setup();
    ptr("pointerdown", key("Q"));
    ptr("pointerup", key("Q"));
    expect(h.onLetter).toHaveBeenCalledTimes(1);
    expect(h.onLetter).toHaveBeenCalledWith("Q");
    root.remove();
  });

  it("the tap's synthesized click can't double-fire even when jank delays it past the timed backstop", () => {
    vi.useFakeTimers();
    const { root, h, key } = setup();
    ptr("pointerdown", key("Q"));
    ptr("pointerup", key("Q"));
    vi.advanceTimersByTime(500); // jank: click arrives after the 400ms backstop expired
    ptr("click", key("Q")); // modern browsers: click carries pointerType "touch"
    expect(h.onLetter).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    root.remove();
  });

  it("rapid taps: an earlier tap's backstop can't unsuppress the next tap's late click", () => {
    vi.useFakeTimers();
    const { root, h, key } = setup();
    ptr("pointerdown", key("S")); ptr("pointerup", key("S")); // tap 1 — its click never arrives
    vi.advanceTimersByTime(350);
    ptr("pointerdown", key("S")); ptr("pointerup", key("S")); // tap 2 (intended double letter)
    vi.advanceTimersByTime(70); // t=420: tap 1's 400ms backstop would have fired here
    const legacyClick = new Event("click", { bubbles: true }); // old Safari: no pointerType on click
    key("S").dispatchEvent(legacyClick);
    expect(h.onLetter).toHaveBeenCalledTimes(2); // two taps, never three
    vi.useRealTimers();
    root.remove();
  });

  it("a pointer that never pressed a key types nothing on lift-off (palm graze / board lift)", () => {
    const { root, h, key } = setup();
    document.elementFromPoint = vi.fn(() => key("Q")); // lift-off lands over a key…
    ptr("pointerup", root, { id: 9 }); // …but this pointer never went down on one
    expect(h.onLetter).not.toHaveBeenCalled();
    root.remove();
  });

  it("two-thumb overlap: the second finger's press commits the held key; each letter lands once", () => {
    const { root, h, key } = setup();
    ptr("pointerdown", key("Q"), { id: 1 });
    ptr("pointerdown", key("W"), { id: 2 }); // finger 2 lands while finger 1 still holds Q
    expect(h.onLetter).toHaveBeenCalledWith("Q"); // Q commits NOW (iOS behavior)
    ptr("pointerup", key("Q"), { id: 1 }); // finger 1 lifts — must not re-fire
    ptr("pointerup", key("W"), { id: 2 });
    expect(h.onLetter).toHaveBeenCalledTimes(2);
    expect(h.onLetter).toHaveBeenLastCalledWith("W");
    root.remove();
  });

  it("an intended double letter (two clean taps on the same key) still types twice", () => {
    const { root, h, key } = setup();
    ptr("pointerdown", key("S")); ptr("pointerup", key("S"));
    ptr("pointerdown", key("S")); ptr("pointerup", key("S"));
    expect(h.onLetter).toHaveBeenCalledTimes(2);
    root.remove();
  });
});
