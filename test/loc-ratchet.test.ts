import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// LOC ratchet for the files every feature touches.
//
// Why this exists: many parallel tabs all wire their features into the same
// few hub files (app.js above all), which makes them the #1 merge-conflict
// surface of the multi-tab workflow — and they grow silently (app.js went
// 3.3k → 5.5k lines in a few weeks). This is NOT a style cap: the caps sit
// well above current size, so today's work never blocks. They only trip when
// a file has crept past its headroom.
//
// When this fails: do NOT raise the cap as a reflex. The fix is to extract a
// cohesive section into its own public/<feature>.js module with a test (the
// established pattern — see gold.js, powerups.js, keyboard.js, celebrate.js)
// and keep only imports + wiring in the hub file. Raise a cap only when an
// extraction genuinely doesn't make sense, and raise it in the same commit
// that explains why.
//
// Generated data files (public/data/, data/) are deliberately not covered.

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

// file → max lines (current size + headroom at the time the cap was set)
const CAPS: Record<string, number> = {
  "public/app.js": 6000, // 5472 on 2026-06-07
  "src/room.ts": 2600, // 2311 on 2026-06-07
  "src/worker.ts": 1300, // 1079 on 2026-06-07
};

function lineCount(rel: string): number {
  return readFileSync(resolve(ROOT, rel), "utf8").split("\n").length;
}

describe("LOC ratchet — hub files stay extractable", () => {
  for (const [rel, cap] of Object.entries(CAPS)) {
    it(`${rel} stays under ${cap} lines`, () => {
      const lines = lineCount(rel);
      if (lines > cap) {
        throw new Error(
          `${rel} is ${lines} lines (cap ${cap}).\n` +
            `Don't raise the cap — extract a cohesive section into its own module with a test\n` +
            `(pattern: public/gold.js, public/powerups.js, public/keyboard.js) and keep only\n` +
            `imports + wiring here. See the header comment in test/loc-ratchet.test.ts.`,
        );
      }
      expect(lines).toBeLessThanOrEqual(cap);
    });
  }
});
