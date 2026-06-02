import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Static integrity check for the browser ES-module graph under public/.
//
// Why this exists: this is a no-bundler ES-module app — index.html loads
// /app.js as <script type="module">. If ANY static import resolves to a file
// that doesn't exist (e.g. an import landed on main but the imported module
// did not), the browser 404s on that module and aborts the ENTIRE graph, so
// app.js never runs and the page renders blank. tsc only covers src/ and no
// runtime test loads the public/ graph, so such a miss is invisible until prod.
//
// This test recursively scans every public/**/*.js, extracts app-local
// specifiers, resolves them against the filesystem, and fails (listing every
// miss at once) if any target is absent. Pure fs + regex; no bundler, no net.

const PUBLIC_DIR = resolve(fileURLToPath(new URL("../public/", import.meta.url)));

/** Recursively collect every *.js file under dir (absolute paths). */
function collectJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (name.endsWith(".js")) {
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

describe("public/ ES-module graph is whole", () => {
  it("every app-local import resolves to a file that exists on disk", () => {
    const files = collectJsFiles(PUBLIC_DIR);
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
});
