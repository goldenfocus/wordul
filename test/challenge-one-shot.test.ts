import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { challengeRoundLocked } from "../src/challenge-core.ts";

// Death is final (bug report, Jun 6 2026): a player LOST a /c/<id> challenge and the
// game let them replay the same pinned word — end-screen "Play again" (and the header
// rematch button, and even a stray Enter keypress) started a fresh round on the SAME
// word, rendered as a fully real run with a WON badge. Server scoring was already
// one-shot (challenge.ts /attempt: first run forever), so the "win" silently didn't
// count — the UI lied. The fix: a challenge room plays exactly ONE round per player.
// Once your run ends, you're done — like dying in a real live race.

describe("challengeRoundLocked — one round per challenge room, forever", () => {
  it("locks a challenge room after its first round", () => {
    expect(challengeRoundLocked("AbC12", 1)).toBe(true);
    expect(challengeRoundLocked("AbC12", 3)).toBe(true);
  });

  it("allows the first round of a challenge room", () => {
    expect(challengeRoundLocked("AbC12", 0)).toBe(false);
  });

  it("never locks a normal room (rematch on a fresh word stays legal)", () => {
    expect(challengeRoundLocked(null, 0)).toBe(false);
    expect(challengeRoundLocked(null, 5)).toBe(false);
  });
});

// app.js / room.ts are side-effectful orchestrators (can't be imported in a test), so —
// house pattern (rematch-settle.test.js, room-ghost-wiring.test.ts) — wiring is locked
// by source assertions.

const appSrc = readFileSync(
  fileURLToPath(new URL("../public/app.js", import.meta.url)),
  "utf8",
);
const roomSrc = readFileSync(
  fileURLToPath(new URL("../src/room.ts", import.meta.url)),
  "utf8",
);

/** The body of a `function name(...) {...}` / method via brace counting. */
function bodyOf(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `${marker} exists`).toBeGreaterThan(-1);
  // Find the body's "{": skip the param list by paren-counting (default params like
  // (opts = {}) and return types like ): Promise<boolean> defeat naive indexOf("{")).
  let p = src.indexOf("(", start);
  let parens = 0;
  for (; p < src.length; p++) {
    if (src[p] === "(") parens++;
    else if (src[p] === ")" && --parens === 0) break;
  }
  const open = src.indexOf("{", p);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces scanning ${marker}`);
}

describe("server: runStart refuses a second round in a challenge room", () => {
  const body = bodyOf(roomSrc, "private async runStart(");

  it("guards via challengeRoundLocked before picking a word", () => {
    expect(body).toMatch(/challengeRoundLocked\(this\.state\.challengeId(?: \?\? null)?, this\.state\.round\)/);
    // the guard must fire before the pinned-word fetch (no wasted DO hop, no restart)
    expect(body.indexOf("challengeRoundLocked")).toBeLessThan(body.indexOf('"https://do/word"'));
  });

  it("tells the player why (not a silent dead button)", () => {
    expect(body).toMatch(/score is locked/i);
  });
});

describe("client: a finished challenge offers no Play Again", () => {
  it("end-screen modal hides #modalPlayAgain in challenge rooms (Enter shortcut dies with it)", () => {
    const body = bodyOf(appSrc, "function openStats(");
    expect(body).toMatch(/finished && !game\.challengeId/);
  });

  it("header rematch button stays hidden in a finished challenge room", () => {
    // the render() finished-phase branch: `rematchBtn.hidden = !!game.challengeId` replaces
    // the unconditional `rematchBtn.hidden = false`
    expect(appSrc).toContain("rematchBtn.hidden = !!game.challengeId");
    expect(appSrc).not.toContain("rematchBtn.hidden = false");
  });
});
