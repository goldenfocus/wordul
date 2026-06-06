// test/lobby-gating.test.js — source-wiring guards: the client-side gates that have no
// jsdom harness. Pattern borrowed from room-core.test.ts's wiring assertions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

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
