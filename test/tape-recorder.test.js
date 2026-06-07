// test/tape-recorder.test.js — the daily solve recorder: pure event buffer + crash mirror.
import { describe, it, expect, beforeEach } from "vitest";
import {
  newTape, tapePush, TAPE_EVENT_CAP,
  tapeStart, tapeRecord, tapeForUpload, tapeMirror, tapeClear, tapeIsLive,
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
    const tape = newTape(0);
    for (let i = 0; i <= TAPE_EVENT_CAP + 5; i++) tapePush(tape, "k", "A", i);
    expect(tape.events.length).toBe(TAPE_EVENT_CAP);
    expect(tape.truncated).toBe(true);
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
});
