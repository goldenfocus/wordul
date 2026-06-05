import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression guard for the rematch settle path (incident, Jun 5 2026):
// `settleRematchHome` is the "opponent left / declined / timed out — fade Home"
// handler. A typo shipped it calling `showHub()` instead of `showHome()`, so a
// bot leaving mid-rematch-wait stranded the player on the dead room URL with the
// avatar hub menu rendered ANCHORLESS — positionHub() no-ops without an anchor,
// so the menu landed in document flow at the bottom of the page.
//
// app.js is the side-effectful orchestrator (can't be imported in a test), so —
// like module-graph.test.ts — this asserts on the source directly.

const appSrc = readFileSync(
  fileURLToPath(new URL("../public/app.js", import.meta.url)),
  "utf8",
);

/** The body of a top-level `function name(...) {...}` via brace counting. */
function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} exists in app.js`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces scanning ${name}`);
}

describe("settleRematchHome — cancelled rematch fades HOME, not the hub menu", () => {
  const body = functionBody(appSrc, "settleRematchHome");

  it("leaves the room and goes home", () => {
    expect(body).toContain("leaveRoom()");
    expect(body).toContain("showHome()");
  });

  it("never opens the avatar hub (anchorless hub renders at page bottom)", () => {
    expect(body).not.toContain("showHub(");
  });
});
