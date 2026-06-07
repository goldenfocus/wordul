// test/lobby-gating.test.js — source-wiring guards: the client-side gates that have no
// jsdom harness. Pattern borrowed from room-core.test.ts's wiring assertions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

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
