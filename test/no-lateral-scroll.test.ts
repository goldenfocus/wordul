// Guard the site-wide "no horizontal scroll on mobile" safety net.
//
// Decorative elements (home aura/orbs) and back-to-back link rows have caused the page to
// be wider than the viewport on iPhone — it scrolls laterally with dead taps (see the iOS
// Input-Zoom Trap scar; same family of bug). The fix is an `overflow-x: clip` floor on the
// root/body of every served top-level stylesheet. This test fails if that floor is removed,
// so the lateral-scroll regression can't sneak back in. (It's a static presence check —
// actual overflow is verified in-browser at ship time, which jsdom can't measure.)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// stylesheet -> the selector that must carry the overflow-x guard on that page.
const GUARDED: { file: string; selector: RegExp }[] = [
  { file: "style.css", selector: /html,\s*body\s*\{/ },     // main app + worlds home
  { file: "word-page.css", selector: /html,\s*\.wp\s*\{/ }, // word wiki pages
];

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("no-lateral-scroll guard (overflow-x clip on root/body)", () => {
  for (const { file, selector } of GUARDED) {
    it(`${file} declares overflow-x: clip|hidden on its root/body rule`, () => {
      const css = stripComments(readFileSync(join(PUBLIC, file), "utf8"));
      const m = selector.exec(css);
      expect(m, `${file}: expected a root/body rule matching ${selector}`).not.toBeNull();
      // body of that rule, up to the closing brace
      const body = css.slice(m!.index, css.indexOf("}", m!.index));
      expect(
        /overflow-x\s*:\s*(clip|hidden)/.test(body),
        `${file}: root/body rule must set overflow-x: clip (or hidden) to prevent lateral scroll`,
      ).toBe(true);
    });
  }
});

// `.screen.home` and `#hub` are flex items in centered columns, so by default they
// shrink-wrap to their content's INTRINSIC width — and a horizontal rail of
// `flex: 0 0 auto` cards (the worlds strip) inflates that past the phone viewport
// (488px on a 393px iPhone, Jun 5 2026). With overflow-x:clip on body, the cut-off
// content isn't even scrollable — it's unreachable. The fix is claiming the parent
// width with `width: 100%` OUTSIDE any media query (the desktop block already had
// it; mobile didn't). This guard fails if those base-level width claims are removed.
describe("home shell claims the viewport width on mobile (no shrink-wrap overflow)", () => {
  // Strip @media blocks (balanced-brace scan) so we only see base-level rules.
  function stripMediaBlocks(css: string): string {
    let out = "";
    let i = 0;
    while (i < css.length) {
      const at = css.indexOf("@media", i);
      if (at === -1) { out += css.slice(i); break; }
      out += css.slice(i, at);
      let j = css.indexOf("{", at);
      let depth = 1;
      while (depth > 0 && ++j < css.length) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
      }
      i = j + 1;
    }
    return out;
  }

  const base = stripMediaBlocks(stripComments(readFileSync(join(PUBLIC, "style.css"), "utf8")));

  for (const sel of [".screen.home", "#hub"]) {
    it(`${sel} has a base-level (non-@media) width: 100% rule`, () => {
      const re = new RegExp(
        sel.replace(/[.#]/g, "\\$&") + String.raw`[^{},]*\{[^}]*width\s*:\s*100%`,
      );
      expect(
        re.test(base),
        `style.css: ${sel} must claim width:100% outside @media, or the home shell ` +
          `shrink-wraps wider than phone viewports (worlds-rail intrinsic width).`,
      ).toBe(true);
    });
  }
});
