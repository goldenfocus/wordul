// test/intel-merge.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readVerifiedCards, writeSlim, writeRich, mergeStagingToCorpus } from "../scripts/lib/intel-merge.mjs";

let dir, staging, rich, slim;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intel-"));
  staging = join(dir, "staging");
  mkdirSync(staging, { recursive: true });
  rich = join(dir, "rich.js");
  slim = join(dir, "slim.js");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const card = (w, extra = {}) => ({
  word: w, def: `${w} def`, facts: [`${w} fact`], quote: `${w} quote`, author: "Someone",
  poem: { form: "haiku", lines: ["a", "b", "c"] }, schemaVersion: 2, ...extra,
});

describe("intel-merge", () => {
  it("readVerifiedCards reads *.verified.json into an UPPERCASE map, skips junk", () => {
    writeFileSync(join(staging, "ocean.verified.json"), JSON.stringify(card("OCEAN")));
    writeFileSync(join(staging, "power.json"), JSON.stringify(card("POWER"))); // not .verified
    writeFileSync(join(staging, "bad.verified.json"), "{not json");
    const map = readVerifiedCards(staging);
    expect(Object.keys(map)).toEqual(["OCEAN"]);
  });

  it("writeSlim emits only {def,fact,quote,author} + the wordIntel() footer", async () => {
    writeSlim(slim, { OCEAN: card("OCEAN") });
    const src = readFileSync(slim, "utf8");
    expect(src).toContain("export const WORD_INTEL =");
    expect(src).toContain("export function wordIntel(");
    const mod = await import(pathToFileURL(slim).href);
    expect(mod.WORD_INTEL.OCEAN).toEqual({ def: "OCEAN def", fact: "OCEAN fact", quote: "OCEAN quote", author: "Someone" });
    expect(mod.WORD_INTEL.OCEAN.poem).toBeUndefined(); // rich field NOT in the slim game file
  });

  it("writeRich keeps the full rich card", async () => {
    writeRich(rich, { OCEAN: card("OCEAN") });
    const mod = await import(pathToFileURL(rich).href);
    expect(mod.WORD_INTEL.OCEAN.poem.form).toBe("haiku");
  });

  it("mergeStagingToCorpus overlays staging onto an existing corpus and is byte-idempotent", async () => {
    writeRich(rich, { OCEAN: card("OCEAN", { def: "old ocean" }) });
    writeFileSync(join(staging, "dream.verified.json"), JSON.stringify(card("DREAM")));
    writeFileSync(join(staging, "ocean.verified.json"), JSON.stringify(card("OCEAN", { def: "new ocean" })));
    const r1 = await mergeStagingToCorpus({ stagingDir: staging, richPath: rich, slimPath: slim });
    expect(r1.merged).toBe(2);
    expect(r1.keys.sort()).toEqual(["DREAM", "OCEAN"]);
    const richBytes1 = readFileSync(rich, "utf8");
    expect(richBytes1).toContain("new ocean"); // staging won
    const r2 = await mergeStagingToCorpus({ stagingDir: staging, richPath: rich, slimPath: slim });
    expect(readFileSync(rich, "utf8")).toBe(richBytes1);
    expect(r2.merged).toBe(2);
  });
});
