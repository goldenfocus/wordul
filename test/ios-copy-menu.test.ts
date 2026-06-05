// Guard against the iOS long-press "Copy / Look Up" edit menu popping mid-game.
//
// iOS long-press SMART SELECTION snaps to the nearest selectable text even when the
// touched element itself is user-select:none — so guarding `.keyboard` alone (the
// Jun 2 fix) wasn't enough: a long-press near tiles, player names, or the hacklog
// still selected text and floated the native edit menu over the keyboard mid-race
// (Jun 5 2026 screenshot bug). A game screen must be unselectable AT THE ROOT, with
// only genuinely copyable surfaces (typed fields, chat history) opted back in.
//
// This test fails if the body-level guard (all three declarations — Safari needs
// the -webkit pair; bare `user-select` only works on iOS >= 18.4) or the opt-back-in
// rule disappears from style.css.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const css = readFileSync(join(PUBLIC, "style.css"), "utf8");

// Extract the declaration block for the first rule whose selector matches `re`.
function block(re: RegExp): string {
  const m = new RegExp(`(^|\\})\\s*(${re.source})\\s*\\{([^}]*)\\}`, "m").exec(css);
  return m ? m[3] : "";
}

describe("iOS long-press edit menu guard (style.css)", () => {
  // Docs pages (body.howto / body.studio) keep normal text selection — the guard
  // must scope to the game shell only.
  const guard = block(/body:not\(\.howto\):not\(\.studio\)/);

  it("game body kills selection with the full trio", () => {
    expect(guard, "body-level selection guard rule missing").toBeTruthy();
    expect(guard).toMatch(/-webkit-user-select:\s*none/);
    expect(guard).toMatch(/(^|[^-])user-select:\s*none/);
    expect(guard).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it("copyable surfaces opt back in (inputs would lose their caret on iOS otherwise)", () => {
    const optIn = block(/input,\s*textarea,\s*\.chat-log/);
    expect(optIn, "opt-back-in rule for input, textarea, .chat-log missing").toBeTruthy();
    expect(optIn).toMatch(/-webkit-user-select:\s*text/);
    expect(optIn).toMatch(/(^|[^-])user-select:\s*text/);
  });
});
