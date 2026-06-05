// Guard the viewport meta against pinch-zoom killers (see the "iOS Input-Zoom Trap"
// scar in the global CLAUDE.md).
//
// `maximum-scale=1` / `user-scalable=no` disable pinch-zoom — iOS Safari ignores them
// for accessibility, but standalone (home-screen) mode RESPECTS them, which left users
// unable to pinch the app to fit when the layout overflowed (Jun 5 2026 home page bug).
// The accessible fix for input auto-zoom is the >= 16px font floor (enforced by
// test/ios-input-zoom.test.ts), never the viewport meta. This test fails if a
// pinch-blocking directive sneaks back into any served page.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const htmlFiles = readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));

describe("viewport meta allows pinch-zoom (no maximum-scale / user-scalable=no)", () => {
  it("found the served HTML pages", () => {
    expect(htmlFiles.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of htmlFiles) {
    it(`${file} does not block pinch-zoom`, () => {
      const html = readFileSync(join(PUBLIC, file), "utf8");
      const viewport = /<meta\s+name="viewport"[^>]*>/i.exec(html)?.[0] ?? "";
      expect(
        /maximum-scale|user-scalable\s*=\s*no/i.test(viewport),
        `${file}: viewport meta must not set maximum-scale or user-scalable=no — ` +
          `fix input zoom with the 16px font floor instead (iOS scar).`,
      ).toBe(false);
    });
  }
});
