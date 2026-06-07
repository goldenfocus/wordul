// @vitest-environment jsdom
// Premium stacked gold (iter3 §3): the ◆ glyph is its OWN element riding above the
// amount, and every count-up tween writes ONLY the number child — the glyph never
// repaints, #roundScore keeps its legacy inline "<prefix>N" shape.
import { describe, it, expect, beforeEach } from "vitest";
import { goldCountTarget, renderGoldHud, awardGold, goldDrain } from "/gold.js";
import { setGold } from "/edition.js";

describe("goldCountTarget (pure resolver: stacked hud → number child, no prefix)", () => {
  it("targets the .gold-stack-num child with an EMPTY prefix on a stacked hud", () => {
    const hud = document.createElement("div");
    const num = document.createElement("span");
    num.className = "gold-stack-num";
    hud.appendChild(num);
    const t = goldCountTarget(hud, "◆ ");
    expect(t.el).toBe(num);
    expect(t.prefix).toBe("");
  });

  it("keeps the whole element + given prefix for a plain hud (#roundScore)", () => {
    const el = document.createElement("div");
    const t = goldCountTarget(el, "Score ");
    expect(t.el).toBe(el);
    expect(t.prefix).toBe("Score ");
  });

  it("survives a null/duck-typed element", () => {
    expect(goldCountTarget(null, "◆ ").el).toBe(null);
    const duck = {};
    expect(goldCountTarget(duck, "x").el).toBe(duck);
  });
});

describe("renderGoldHud — stacked structure (◆ above the amount)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="room-header"></div>';
    setGold(0);
  });

  it("builds glyph-above-number: ◆ in its own aria-hidden span, balance in .gold-stack-num", () => {
    setGold(120);
    renderGoldHud();
    const hud = document.getElementById("goldHud");
    expect(hud.classList.contains("gold-stack")).toBe(true);
    const kids = [...hud.children];
    expect(kids.map((k) => k.className)).toEqual(["gold-stack-glyph", "gold-stack-num"]);
    expect(kids[0].textContent).toBe("◆");
    expect(kids[0].getAttribute("aria-hidden")).toBe("true");
    expect(kids[1].textContent).toBe("120");
  });

  it("reads sensibly to screen readers: aria-label carries the balance", () => {
    setGold(75);
    renderGoldHud();
    expect(document.getElementById("goldHud").getAttribute("aria-label")).toBe(
      "75 gold — view your gold history",
    );
  });

  it("re-renders are idempotent: repaints only the number, never duplicates children", () => {
    setGold(10);
    renderGoldHud();
    const glyphBefore = document.querySelector("#goldHud .gold-stack-glyph");
    setGold(999);
    renderGoldHud();
    const hud = document.getElementById("goldHud");
    expect(hud.children.length).toBe(2);
    expect(hud.querySelector(".gold-stack-glyph")).toBe(glyphBefore); // glyph element untouched
    expect(hud.querySelector(".gold-stack-num").textContent).toBe("999");
  });
});

describe("count-up tween targets — stacked hud vs plain #roundScore", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="room-header"></div>';
    setGold(0);
  });

  it("awardGold tweens ONLY the number child of the stacked #goldHud (glyph never repaints)", async () => {
    setGold(100);
    renderGoldHud();
    const hud = document.getElementById("goldHud");
    await new Promise((res) => awardGold(50, true, { onDone: res }));
    expect(hud.querySelector(".gold-stack-glyph").textContent).toBe("◆");
    expect(hud.querySelector(".gold-stack-num").textContent).toBe("150");
    expect(hud.classList.contains("gold-bump")).toBe(true); // bump still lands on the container
    expect(hud.getAttribute("aria-label")).toBe("150 gold — view your gold history");
  });

  it("goldDrain mirrors it: number-only tween + the loss bump on the container", async () => {
    setGold(200);
    renderGoldHud();
    const hud = document.getElementById("goldHud");
    await new Promise((res) => goldDrain(60, true, null, { onDone: res }));
    expect(hud.querySelector(".gold-stack-num").textContent).toBe("140");
    expect(hud.classList.contains("gold-bump-loss")).toBe(true);
  });

  it("#roundScore keeps the inline `${prefix}${v}` shape (NOT stacked)", async () => {
    const score = document.createElement("div");
    score.id = "roundScore";
    document.body.appendChild(score);
    let v = 0;
    const wallet = { get: () => v, add: (d) => { v += d; }, drain: (d) => { v -= d; } };
    await new Promise((res) =>
      awardGold(25, true, { wallet, hud: score, prefix: "Score ", onDone: res }),
    );
    expect(score.textContent).toBe("Score 25");
    expect(score.querySelector(".gold-stack-num")).toBe(null);
  });
});
