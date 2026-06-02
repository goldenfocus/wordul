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
    expect(root.querySelector('.key[data-action="enter"]').textContent).toBe("Return");
    // ⌫ lives on the top row, Return on the bottom row (both right-edge).
    const kbRows = root.querySelectorAll(".kb-row");
    expect(kbRows[0].querySelector('.key[data-action="back"]')).not.toBeNull();
    expect(kbRows[kbRows.length - 1].querySelector('.key[data-action="enter"]')).not.toBeNull();
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
        { word: "QUERY", mask: ["gray", "yellow", "green", "gray", "gray"] },
        { word: "QUEEN", mask: ["green", "gray", "gray", "gray", "gray"] }, // Q upgrades gray→green
      ],
    };
    renderKeyboard(root, me);
    expect(root.querySelector('.key[data-key="Q"]').classList.contains("green")).toBe(true);
    expect(root.querySelector('.key[data-key="U"]').classList.contains("yellow")).toBe(true);
    expect(root.querySelector('.key[data-key="E"]').classList.contains("green")).toBe(true);
    expect(root.querySelector('.key[data-key="R"]').classList.contains("gray")).toBe(true);
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
