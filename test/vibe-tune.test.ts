import { describe, it, expect } from "vitest";
import {
  buildTuneMessages,
  cleanTuneOutput,
  DEFAULT_TUNE_PROMPT,
  TUNE_MODEL,
} from "../src/vibe-tune.ts";

describe("buildTuneMessages", () => {
  it("returns a system + user message pair", () => {
    const msgs = buildTuneMessages("because you are smart", "Make it legendary.");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("includes the story and the instruction in the user turn", () => {
    const msgs = buildTuneMessages("because you are smart", "Make it legendary.");
    expect(msgs[1].content).toContain("because you are smart");
    expect(msgs[1].content).toContain("Make it legendary.");
  });

  it("falls back to the default prompt when the instruction is blank", () => {
    const msgs = buildTuneMessages("hello world", "   ");
    expect(msgs[1].content).toContain(DEFAULT_TUNE_PROMPT);
  });

  it("falls back to the default prompt when the instruction is missing", () => {
    const msgs = buildTuneMessages("hello world", undefined);
    expect(msgs[1].content).toContain(DEFAULT_TUNE_PROMPT);
  });

  it("tolerates a non-string story", () => {
    const msgs = buildTuneMessages(null as unknown as string, "x");
    expect(msgs[1].role).toBe("user");
    expect(typeof msgs[1].content).toBe("string");
  });
});

describe("cleanTuneOutput", () => {
  it("trims surrounding whitespace", () => {
    expect(cleanTuneOutput("  hello  ")).toBe("hello");
  });

  it("strips wrapping straight double quotes", () => {
    expect(cleanTuneOutput('"You are brilliant."')).toBe("You are brilliant.");
  });

  it("strips wrapping curly quotes", () => {
    expect(cleanTuneOutput("“You are brilliant.”")).toBe("You are brilliant.");
  });

  it("strips a leading 'Here is...' preamble", () => {
    expect(cleanTuneOutput("Here is the rewritten text: You are brilliant.")).toBe(
      "You are brilliant.",
    );
  });

  it("strips a 'Sure! Here's...' preamble", () => {
    expect(cleanTuneOutput("Sure! Here's a legendary version: Shine on.")).toBe("Shine on.");
  });

  it("strips ``` code fences", () => {
    expect(cleanTuneOutput("```\nYou are brilliant.\n```")).toBe("You are brilliant.");
  });

  it("leaves clean prose untouched", () => {
    expect(cleanTuneOutput("You are brilliant, and you know it.")).toBe(
      "You are brilliant, and you know it.",
    );
  });

  it("does not strip a colon that is part of normal prose", () => {
    expect(cleanTuneOutput("One truth: you are brilliant.")).toBe("One truth: you are brilliant.");
  });

  it("returns empty string for empty/garbage input", () => {
    expect(cleanTuneOutput("")).toBe("");
    expect(cleanTuneOutput(null as unknown as string)).toBe("");
  });
});

describe("constants", () => {
  it("exposes a Workers AI model id", () => {
    expect(TUNE_MODEL).toMatch(/^@cf\//);
  });
  it("exposes a default prompt", () => {
    expect(typeof DEFAULT_TUNE_PROMPT).toBe("string");
    expect(DEFAULT_TUNE_PROMPT.length).toBeGreaterThan(0);
  });
});
