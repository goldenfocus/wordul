import { describe, it, expect } from "vitest";
import { normalizeVoiceOverrides, EMPTY_VOICE } from "../src/voice-overrides.ts";
import type { WorldDef } from "../src/worlds.ts";

const base: WorldDef[] = [
  { id: "default", slug: "wordul", name: "Wordul", blurb: "", editionId: "default", featured: true, order: 0 },
  { id: "yang", slug: "yangs-table", name: "Yang's Table", blurb: "", editionId: "yang", featured: false, order: 6 },
];
const clipSets = ["default", "yang", "my-upload"];

describe("normalizeVoiceOverrides", () => {
  it("accepts empty and round-trips an ai + clips doc", () => {
    expect(normalizeVoiceOverrides({}, base, clipSets)).toEqual({ ok: true, value: {} });
    const raw = {
      yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } },
      default: { on: false, source: { kind: "ai", voiceName: "Daniel", rate: 1.1, pitch: 0.9 } },
    };
    const r = normalizeVoiceOverrides(raw, base, clipSets);
    expect(r).toEqual({ ok: true, value: raw });
  });

  it("rejects an unknown world id", () => {
    const r = normalizeVoiceOverrides({ nope: { on: true, source: { kind: "ai", voiceName: "x" } } }, base, clipSets);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown source kind and a missing ai voiceName", () => {
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "wat" } } }, base, clipSets).ok).toBe(false);
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "ai", voiceName: "" } } }, base, clipSets).ok).toBe(false);
  });

  it("rejects a clipSetId not in the known set and a bad origin", () => {
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "clips", clipSetId: "ghost", origin: "upload" } } }, base, clipSets).ok).toBe(false);
    expect(normalizeVoiceOverrides({ yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "bad" } } }, base, clipSets).ok).toBe(false);
  });

  it("clamps ai rate/pitch into range", () => {
    const r = normalizeVoiceOverrides({ yang: { on: true, source: { kind: "ai", voiceName: "x", rate: 9, pitch: -3 } } }, base, clipSets);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.yang.source).toMatchObject({ rate: 2, pitch: 0 });
  });

  it("coerces on to boolean and drops unknown fields", () => {
    const r = normalizeVoiceOverrides({ yang: { on: 1, junk: true, source: { kind: "ai", voiceName: "x", junk: 1 } } } as any, base, clipSets);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.yang).toEqual({ on: true, source: { kind: "ai", voiceName: "x" } });
  });
});
