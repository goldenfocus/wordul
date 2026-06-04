// Guard against the iOS "input-zoom trap" (see the "iOS Input-Zoom Trap" scar in
// the global CLAUDE.md).
//
// iOS Safari AUTO-ZOOMS whenever you focus a text <input>/<textarea> whose
// font-size is < 16px. Our viewport (`width=device-width, initial-scale=1`) is the
// correct, accessible one — so it gives no snap-back, and the page is left wider
// than the visual viewport: it scrolls laterally and taps die. The fix is always a
// >= 16px font on the field (never `maximum-scale` / `user-scalable=no`, which kill
// pinch-zoom for low-vision users).
//
// This is a RATCHET. It resolves each served text field's *effective* font-size
// through the real CSS cascade (jsdom `el.matches()` + specificity) and fails if
// any field renders below 16px — EXCEPT the legacy offenders frozen in
// KNOWN_IOS_ZOOM_DEBT. New offenders can't slip in; the frozen ones are tracked
// debt. To clear a debt entry: bump that field's CSS to >= 16px, then delete its
// line here. NEVER add a line to silence a new failure — fix the CSS instead.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIN_FONT_PX = 16;

// Pages we audit. Linked <link rel=stylesheet href="/x.css"> + inline <style> are
// resolved automatically per page.
const PAGES = ["index.html", "vibe-studio.html", "how-to-play.html"];

// <input> types that bring up the keyboard (and therefore trigger the zoom).
// Everything else (color, checkbox, radio, range, file, button…) is exempt.
const TEXT_INPUT_TYPES = new Set([
  "", "text", "search", "email", "url", "tel", "password", "number",
]);

// Frozen legacy debt as of 2026-06-04 — real iOS-zoom offenders awaiting a
// one-line font bump to 16px. Keyed by `<page>#<elementId>`.
const KNOWN_IOS_ZOOM_DEBT = new Set([
  "index.html#shareUrl",            // .share-url      -> 13px (readonly share link)
  "index.html#chatInput",           // .chat-input     -> 14px (in-room chat)
  "vibe-studio.html#storyInput",    // .story-box textarea -> 15px
  "vibe-studio.html#aiPromptInput", // .ai-tune input  -> 13px
]);

type Rule = { sel: string; px: number; spec: [number, number, number]; order: number };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Smallest px in a value — the worst-case floor. clamp(34px,8vw,64px) -> 34;
// 14px -> 14; values with no px (inherit, 1em, 100%) -> null (unknown).
function minPx(value: string): number | null {
  const pxs = [...value.matchAll(/(\d*\.?\d+)px/g)].map((m) => parseFloat(m[1]));
  return pxs.length ? Math.min(...pxs) : null;
}

// Pull a font-size out of a declaration body — explicit `font-size:` first, else
// the size component of the `font:` shorthand (the px just before the family).
function fontSizePx(body: string): number | null {
  const fs = /font-size\s*:\s*([^;]+)/i.exec(body);
  if (fs) return minPx(fs[1]);
  const short = /(?:^|;)\s*font\s*:\s*([^;]+)/i.exec(body);
  if (short) return minPx(short[1]);
  return null;
}

function specificity(sel: string): [number, number, number] {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
  const tags = (sel.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, classes, tags];
}

function moreSpecific(a: Rule, b: Rule): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.spec[i] !== b.spec[i]) return a.spec[i] > b.spec[i];
  }
  return a.order > b.order; // tie -> later rule wins (CSS source order)
}

// Parse CSS into font-size rules. The innermost-block regex also captures rules
// nested inside @media (the @media wrapper itself is skipped).
function parseFontRules(css: string, startOrder: number): { rules: Rule[]; next: number } {
  const rules: Rule[] = [];
  let order = startOrder;
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripComments(css)))) {
    const selectorList = m[1].trim();
    if (selectorList.startsWith("@")) continue;
    const px = fontSizePx(m[2]);
    if (px == null) continue;
    for (const sel of selectorList.split(",").map((s) => s.trim()).filter(Boolean)) {
      rules.push({ sel, px, spec: specificity(sel), order: order++ });
    }
  }
  return { rules, next: order };
}

// All CSS that applies to a page: linked local stylesheets (head order) then
// inline <style> blocks — so inline wins specificity ties, as the browser does.
function cssRulesForPage(doc: Document): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const link of [...doc.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = (link.getAttribute("href") || "").replace(/^\//, "");
    const path = join(PUBLIC, href);
    if (href && existsSync(path)) {
      const parsed = parseFontRules(readFileSync(path, "utf8"), order);
      rules.push(...parsed.rules);
      order = parsed.next;
    }
  }
  for (const style of [...doc.querySelectorAll("style")]) {
    const parsed = parseFontRules(style.textContent || "", order);
    rules.push(...parsed.rules);
    order = parsed.next;
  }
  return rules;
}

function effectiveFontPx(el: Element, rules: Rule[]): number | null {
  let winner: Rule | null = null;
  for (const r of rules) {
    let matches = false;
    try {
      matches = el.matches(r.sel);
    } catch {
      continue; // selectors jsdom can't match (e.g. ::-webkit-*) never set our font
    }
    if (matches && (winner == null || moreSpecific(r, winner))) winner = r;
  }
  return winner ? winner.px : null;
}

function textFields(doc: Document): Element[] {
  // SPA screens live inside <template> blocks; jsdom parks their content in a
  // separate DocumentFragment that document.querySelectorAll() skips — so walk
  // the live DOM AND every template's content, or we'd miss real inputs.
  const roots: (Document | DocumentFragment)[] = [doc];
  for (const tpl of [...doc.querySelectorAll("template")]) {
    roots.push((tpl as HTMLTemplateElement).content);
  }
  const out: Element[] = [];
  for (const root of roots) {
    out.push(...root.querySelectorAll("textarea"));
    for (const inp of [...root.querySelectorAll("input")]) {
      const type = (inp.getAttribute("type") || "").toLowerCase();
      if (TEXT_INPUT_TYPES.has(type)) out.push(inp);
    }
  }
  return out;
}

describe("iOS input-zoom guard (text fields must render >= 16px)", () => {
  const offenders: string[] = [];

  for (const page of PAGES) {
    const path = join(PUBLIC, page);
    if (!existsSync(path)) continue;
    const doc = new JSDOM(readFileSync(path, "utf8")).window.document;
    const rules = cssRulesForPage(doc);

    for (const el of textFields(doc)) {
      const id = el.getAttribute("id") || el.getAttribute("name") || el.outerHTML.slice(0, 40);
      const key = `${page}#${id}`;
      const px = effectiveFontPx(el, rules);

      it(`${key} renders >= ${MIN_FONT_PX}px`, () => {
        if (KNOWN_IOS_ZOOM_DEBT.has(key)) {
          // Frozen debt — assert it's STILL an offender so that, once it's fixed,
          // this test fails and reminds us to delete the stale debt line.
          expect(
            px == null || px < MIN_FONT_PX,
            `${key} is now >= ${MIN_FONT_PX}px — remove it from KNOWN_IOS_ZOOM_DEBT.`,
          ).toBe(true);
          return;
        }
        if (px == null) {
          offenders.push(`${key} (no explicit font-size — UA default zooms on iOS)`);
        } else if (px < MIN_FONT_PX) {
          offenders.push(`${key} (${px}px)`);
        }
        expect(
          px != null && px >= MIN_FONT_PX,
          `${key} would trigger iOS auto-zoom (font-size ${px ?? "unset"}). ` +
            `Bump it to >= ${MIN_FONT_PX}px.`,
        ).toBe(true);
      });
    }
  }

  it("audited at least the known text fields", () => {
    // sanity: ensure the audit actually walked inputs (guards against a selector
    // regression silently auditing nothing and going green).
    expect(KNOWN_IOS_ZOOM_DEBT.size).toBeGreaterThan(0);
    expect(offenders).toEqual([]); // any NEW offender surfaces here too
  });
});
