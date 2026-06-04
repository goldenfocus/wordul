import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Static integrity check for the browser asset + ES-module graph under public/.
//
// Why this exists: this is a no-bundler ES-module app — index.html loads
// /app.js as <script type="module">. If ANY static import resolves to a file
// that doesn't exist (e.g. an import landed on main but the imported module
// did not), the browser 404s on that module and aborts the ENTIRE graph, so
// app.js never runs and the page renders blank. tsc only covers src/ and no
// runtime test loads the public/ graph, so such a miss is invisible until prod.
//
// Two checks:
//  1. every app-local `import`/`export ... from` in public/**/*.js resolves;
//  2. every <script src>/<link href>/inline-<script> import in public/*.html
//     resolves (a renamed /style.css or /howto.js referenced only from HTML
//     would blank or unstyle the page and the JS-graph scan alone can't see it).
// Pure fs + regex; no bundler, no net. Fails listing every miss at once.

const PUBLIC_DIR = resolve(fileURLToPath(new URL("../public/", import.meta.url)));

/** Recursively collect every file with the given extension under dir (absolute paths). */
function collectFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, ext));
    } else if (name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract every module specifier referenced by a JS source string.
 * Covers: `import ... from "x"`, side-effect `import "x"`, dynamic
 * `import("x")`, and `export ... from "x"`. Spans newlines (multiline imports).
 */
function extractSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const patterns: RegExp[] = [
    // import ...binding... from "spec"   and   export ...binding... from "spec"
    /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
    // side-effect import "spec";  (import directly followed by a string literal)
    /\bimport\s*["']([^"']+)["']/g,
    // dynamic import("spec")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

/**
 * Extract every app-loadable asset reference from an HTML source string.
 * Scoped deliberately to `<script src>` and `<link href>` (the tags that load
 * files) plus the import specifiers inside inline `<script>` bodies. NOT generic
 * `href` — `<a href="/how-to-play">` is a Worker route, not a file on disk, and
 * checking it would false-flag every route link.
 */
function extractHtmlRefs(src: string): string[] {
  const refs: string[] = [];
  const tagPatterns: RegExp[] = [
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const re of tagPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) refs.push(m[1]);
  }
  // Inline <script>…</script> bodies (those WITHOUT a src). The import regexes
  // only match real import statements, so JSON-LD / plain inline scripts yield
  // nothing — no false positives.
  const inline = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let s: RegExpExecArray | null;
  while ((s = inline.exec(src)) !== null) refs.push(...extractSpecifiers(s[1]));
  return refs;
}

/** Is this an app-local specifier we should resolve on disk? */
function isAppLocal(spec: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return false; // http:, https:, data:, node: ...
  return spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Resolve an app-local specifier to an absolute path under public/.
 * "/x.js" is rooted at public/ (the web root); "./" / "../" are relative to
 * the importing file's directory.
 */
function resolveSpecifier(spec: string, importerAbs: string): string {
  if (spec.startsWith("/")) return join(PUBLIC_DIR, spec.slice(1));
  return resolve(dirname(importerAbs), spec);
}

describe("public/ module + asset graph is whole", () => {
  it("every app-local import in public/**/*.js resolves to a file that exists on disk", () => {
    const files = collectFiles(PUBLIC_DIR, ".js");
    expect(files.length).toBeGreaterThan(0); // guard against an empty/moved scan

    const misses: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const importer = relative(PUBLIC_DIR, file);
      for (const spec of extractSpecifiers(src)) {
        if (!isAppLocal(spec)) continue;
        const target = resolveSpecifier(spec, file);
        if (!existsSync(target)) {
          misses.push(`  ${importer} → ${spec}  (resolved: ${relative(PUBLIC_DIR, target)})`);
        }
      }
    }

    if (misses.length > 0) {
      throw new Error(
        `Broken ES-module import(s) in public/ — these specifiers resolve to files that do not exist.\n` +
          `A missing static import 404s and blanks the whole app in production.\n` +
          `importer → missing specifier (resolved path):\n` +
          misses.join("\n"),
      );
    }
  });

  it("every <script src> / <link href> / inline import in public/*.html resolves", () => {
    const files = collectFiles(PUBLIC_DIR, ".html");
    expect(files.length).toBeGreaterThan(0); // guard against an empty/moved scan

    const misses: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const importer = relative(PUBLIC_DIR, file);
      for (const ref of extractHtmlRefs(src)) {
        if (!isAppLocal(ref)) continue;
        const target = resolveSpecifier(ref, file);
        if (!existsSync(target)) {
          misses.push(`  ${importer} → ${ref}  (resolved: ${relative(PUBLIC_DIR, target)})`);
        }
      }
    }

    if (misses.length > 0) {
      throw new Error(
        `Broken asset reference(s) in public/*.html — these resolve to files that do not exist.\n` +
          `A missing <script>/<link>/inline import breaks or unstyles the page in production.\n` +
          `html → missing ref (resolved path):\n` +
          misses.join("\n"),
      );
    }
  });
});
