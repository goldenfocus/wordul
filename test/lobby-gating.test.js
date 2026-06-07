// test/lobby-gating.test.js — source-wiring guards: the client-side gates that have no
// jsdom harness. Pattern borrowed from room-core.test.ts's wiring assertions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

describe("lobby gating wiring", () => {
  it("canEditLength is host-gated and challenge-locked", () => {
    const fn = app.slice(app.indexOf("function canEditLength"), app.indexOf("function canEditLength") + 500);
    expect(fn).toContain("game.challengeId");
    expect(fn).toContain("snap.hostId");
  });
  it("lobby board reserves a single row track", () => {
    // setProperty("--rows") lives ~4500 chars into renderBoards — widen window to 5000
    const rb = app.slice(app.indexOf("function renderBoards"), app.indexOf("function renderBoards") + 5000);
    expect(rb).toContain('setProperty("--rows", String(rowsToDraw))');
  });
});

describe("lobby v2 structural tokens", () => {
  it("defines the 4pt spacing scale and radius family in :root", () => {
    const root = css.slice(0, css.indexOf("}"));
    for (const t of ["--space-1: 4px", "--space-2: 8px", "--space-3: 12px",
                     "--space-4: 16px", "--space-5: 24px", "--space-6: 32px",
                     "--r-sm: 6px", "--r-md: 8px", "--r-lg: 14px"]) {
      expect(root).toContain(t);
    }
  });
  it("lobby components consume the tokens", () => {
    expect(css).toContain("border-radius: var(--r-md)");
    expect(css).toContain("border-radius: var(--r-sm)");
    expect(css).toContain("gap: var(--space-2)");
  });
});

describe("lobby v2 seat strip wiring", () => {
  it("the seat strip carries capacity steppers, a watching chip, and the spectator hint", () => {
    for (const id of ["capMinus", "capPlus", "myTableWatch", "spectatorHint"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
  it("canEditCapacity is strictly host-gated (server enforces; no un-hosted fallback)", () => {
    const fn = app.slice(app.indexOf("function canEditCapacity"), app.indexOf("function canEditCapacity") + 400);
    expect(fn).toContain("snap.hostId === getUsername()");
    expect(fn).toContain("snap.isDuel");
  });
  it("stepCapacity clamps and sends set_capacity", () => {
    const fn = app.slice(app.indexOf("function stepCapacity"), app.indexOf("function stepCapacity") + 600);
    expect(fn).toContain('send({ type: "set_capacity"');
    expect(fn).toContain("MAX_CAPACITY");
  });
});

describe("lobby v2 mobile order", () => {
  it("arrangeLobbyLayout appends chat BEFORE the rail (mobile-first DOM)", () => {
    const fn = app.slice(app.indexOf("function arrangeLobbyLayout"), app.indexOf("function arrangeLobbyLayout") + 1600);
    const chatAt = fn.indexOf("right.appendChild(chat)");
    const railAt = fn.indexOf("right.appendChild(rail)");
    expect(chatAt).toBeGreaterThan(-1);
    expect(railAt).toBeGreaterThan(-1);
    expect(chatAt).toBeLessThan(railAt);
  });
  it("desktop lifts the rail above chat via flex order", () => {
    expect(css).toMatch(/min-width: 881px[\s\S]{0,200}\.lobby-rail \{ order: -1; \}/);
  });
});
