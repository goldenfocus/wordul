// test/tape-recorder.test.js — the daily solve recorder: pure event buffer + crash mirror.
import { describe, it, expect, beforeEach } from "vitest";
import {
  newTape, tapePush, TAPE_EVENT_CAP, TAPE_BYTE_CAP,
  tapeStart, tapeRecord, tapeForUpload, tapeMirror, tapeClear, tapeIsLive, tapeSuspend,
} from "../public/tape-recorder.js";

describe("tape core", () => {
  it("records events as [t, kind, data?] with ms offsets from t0", () => {
    const tape = newTape(1000);
    tapePush(tape, "k", "S", 1500);
    tapePush(tape, "b", undefined, 2000);
    expect(tape.events).toEqual([[500, "k", "S"], [1000, "b"]]);
  });
  it("clamps a skewed clock so t stays monotonic", () => {
    const tape = newTape(1000);
    tapePush(tape, "k", "A", 2000);
    tapePush(tape, "k", "B", 1500); // clock went backwards
    expect(tape.events[1][0]).toBe(1000); // clamped to previous t
  });
  it("stops at the event cap and marks truncated", () => {
    // The byte cap fires first for any organically-pushed tape (5000 × ≥8 bytes > 30KB),
    // so exercise the event-cap branch directly with a pre-filled buffer.
    const tape = newTape(0);
    tape.events = Array.from({ length: TAPE_EVENT_CAP }, (_, i) => [i, "b"]);
    tapePush(tape, "k", "A", TAPE_EVENT_CAP);
    expect(tape.events.length).toBe(TAPE_EVENT_CAP);
    expect(tape.truncated).toBe(true);
  });
  it("stops at the byte cap and marks truncated", () => {
    const tape = newTape(0);
    const fat = "x".repeat(280); // each event ~600 bytes serialized; 200 ≈ 120KB → must trip 30KB
    for (let i = 0; i < 200; i++) tapePush(tape, "v", { raw: fat, text: fat, voice: { mode: "silent" } }, i);
    expect(tape.truncated).toBe(true);
    expect(JSON.stringify(tape.events).length).toBeLessThanOrEqual(TAPE_BYTE_CAP);
  });
  it("recomputes bytes for a mirror that predates the field on resume", () => {
    localStorage.setItem("wr.tape:2026-06-07", JSON.stringify({ v: 1, t0: 0, truncated: false, events: [[5, "k", "Z"]] }));
    tapeStart("2026-06-07", 1000);
    const big = "y".repeat(TAPE_BYTE_CAP); // a single push past the cap must trip immediately
    tapeRecord("v", big, 1100);
    const up = tapeForUpload("2026-06-07");
    expect(up.truncated).toBe(true);
    expect(up.events).toEqual([[5, "k", "Z"]]); // mirror kept, oversize event dropped
    localStorage.removeItem("wr.tape:2026-06-07");
  });
});

describe("live recorder + mirror", () => {
  beforeEach(() => { localStorage.clear(); tapeClear("2026-06-07"); });
  it("is a no-op before tapeStart (recording must never break gameplay)", () => {
    expect(() => tapeRecord("k", "A")).not.toThrow();
    expect(tapeIsLive()).toBe(false);
  });
  it("records after start and mirrors to localStorage every 10 events", () => {
    tapeStart("2026-06-07", 0);
    for (let i = 0; i < 9; i++) tapeRecord("k", "A", i);
    expect(localStorage.getItem("wr.tape:2026-06-07")).toBeNull();
    tapeRecord("k", "B", 9); // 10th event → mirror flush
    const mirrored = JSON.parse(localStorage.getItem("wr.tape:2026-06-07"));
    expect(mirrored.events.length).toBe(10);
  });
  it("tapeForUpload returns the live tape once, then clears live + mirror", () => {
    tapeStart("2026-06-07", 0);
    tapeRecord("k", "A", 100);
    const up = tapeForUpload("2026-06-07");
    expect(up.events).toEqual([[100, "k", "A"]]);
    expect(tapeIsLive()).toBe(false);
    expect(localStorage.getItem("wr.tape:2026-06-07")).toBeNull();
    expect(tapeForUpload("2026-06-07")).toBeNull(); // nothing left
  });
  it("tapeForUpload falls back to a crash mirror when no live tape exists", () => {
    localStorage.setItem("wr.tape:2026-06-07", JSON.stringify({ v: 1, t0: 0, truncated: false, events: [[5, "k", "Z"]] }));
    const up = tapeForUpload("2026-06-07");
    expect(up.events).toEqual([[5, "k", "Z"]]);
  });
  it("tapeStart resumes from a same-day mirror instead of losing earlier events", () => {
    localStorage.setItem("wr.tape:2026-06-07", JSON.stringify({ v: 1, t0: 0, truncated: false, events: [[5, "k", "Z"]] }));
    tapeStart("2026-06-07", 1000);
    tapeRecord("k", "A", 1100);
    const up = tapeForUpload("2026-06-07");
    expect(up.events[0]).toEqual([5, "k", "Z"]);   // mirror preserved
    expect(up.events[1][1]).toBe("k");             // new event appended after it
    expect(up.events[1][0]).toBeGreaterThanOrEqual(5); // still monotonic
  });
  it("tapeSuspend flushes to the mirror, detaches, and keeps the mirror", () => {
    tapeStart("2026-06-07", 0);
    tapeRecord("k", "A", 100); // below the 10-event flush threshold
    tapeSuspend();
    expect(tapeIsLive()).toBe(false);
    const mirrored = JSON.parse(localStorage.getItem("wr.tape:2026-06-07"));
    expect(mirrored.events).toEqual([[100, "k", "A"]]);
  });
  it("a suspended tape resumes on the next tapeStart", () => {
    tapeStart("2026-06-07", 0);
    tapeRecord("k", "A", 100);
    tapeSuspend();
    tapeStart("2026-06-07", 5000);
    tapeRecord("k", "B", 5100);
    const up = tapeForUpload("2026-06-07");
    expect(up.events.length).toBe(2);
    expect(up.events[0]).toEqual([100, "k", "A"]);
  });
});
