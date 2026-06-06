// Cross-browser daily self-heal: you finished today on another browser/device — the
// server knows (rank + gold sync through your account) but THIS browser lacks the two
// client-only artifacts that make the recap come alive: your solve letters
// (wr.dailySolve:<date>) and the finisher token (wr.dailyToken:<date>). The recovery
// module reuses the room's own WS contract — a finished player's snapshot already
// carries `dailyToken` + their guesses (words + masks) — to harvest both, once.
import { describe, it, expect, vi } from "vitest";
import {
  harvestDailyArtifacts,
  needsDailyRecovery,
  recoverDailyArtifacts,
} from "../public/daily-recover.js";

const greens = ["hot", "hot", "hot", "hot", "hot"];
const grays = ["cold", "cold", "cold", "cold", "cold"];

const finishedSnapshot = (over = {}) => ({
  type: "snapshot",
  room: {
    isDaily: true,
    dailyToken: "tok-123",
    players: [{
      username: "papa", status: "won",
      guesses: [{ word: "sloth", mask: grays }, { word: "crane", mask: greens }],
    }],
    ...over,
  },
});

describe("harvestDailyArtifacts", () => {
  it("pulls token + letters/colors from a finished player's snapshot", () => {
    const got = harvestDailyArtifacts(finishedSnapshot(), "papa");
    expect(got).toEqual({
      token: "tok-123",
      solve: { won: true, guesses: 2, words: ["SLOTH", "CRANE"], grid: ["xxxxx", "ggggg"] },
    });
  });

  it("recovers a finished LOSS too (missed boards still replay)", () => {
    const msg = finishedSnapshot();
    msg.room.players[0].status = "lost";
    const got = harvestDailyArtifacts(msg, "papa");
    expect(got?.solve.won).toBe(false);
  });

  it("returns null while the viewer is still playing (no early answer leak)", () => {
    const msg = finishedSnapshot();
    msg.room.players[0].status = "playing";
    expect(harvestDailyArtifacts(msg, "papa")).toBeNull();
  });

  it("returns null for non-snapshot messages, non-daily rooms, and missing players", () => {
    expect(harvestDailyArtifacts({ type: "pong" }, "papa")).toBeNull();
    const notDaily = finishedSnapshot({ isDaily: false });
    expect(harvestDailyArtifacts(notDaily, "papa")).toBeNull();
    expect(harvestDailyArtifacts(finishedSnapshot(), "stranger")).toBeNull();
  });

  it("still harvests the solve when the token is absent (older server)", () => {
    const msg = finishedSnapshot({ dailyToken: undefined });
    const got = harvestDailyArtifacts(msg, "papa");
    expect(got?.token).toBeNull();
    expect(got?.solve.words).toEqual(["SLOTH", "CRANE"]);
  });
});

describe("needsDailyRecovery", () => {
  const date = "2026-06-06";
  it("true when either artifact is missing, false when both present", () => {
    const empty = new Map();
    const storage = { getItem: (k) => empty.get(k) ?? null };
    expect(needsDailyRecovery(date, storage)).toBe(true);
    empty.set(`wr.dailySolve:${date}`, "{}");
    expect(needsDailyRecovery(date, storage)).toBe(true); // token still missing
    empty.set(`wr.dailyToken:${date}`, "tok");
    expect(needsDailyRecovery(date, storage)).toBe(false);
  });
});

describe("recoverDailyArtifacts", () => {
  const date = "2026-06-06";

  function fakeSocketFactory(messages) {
    const sent = [];
    let socket;
    const makeSocket = vi.fn(() => {
      socket = {
        sent,
        readyState: 1,
        listeners: {},
        addEventListener(ev, fn) { this.listeners[ev] = fn; },
        send(s) { sent.push(JSON.parse(s)); },
        close: vi.fn(),
      };
      queueMicrotask(() => {
        socket.listeners.open?.();
        for (const m of messages) socket.listeners.message?.({ data: JSON.stringify(m) });
      });
      return socket;
    });
    return { makeSocket, getSocket: () => socket };
  }

  it("joins, harvests both artifacts into storage, closes, resolves true", async () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    };
    const { makeSocket, getSocket } = fakeSocketFactory([finishedSnapshot()]);
    const ok = await recoverDailyArtifacts({
      date, username: "papa", storage, makeSocket,
      hello: { type: "hello", username: "papa" },
    });
    expect(ok).toBe(true);
    expect(getSocket().sent[0]).toMatchObject({ type: "hello", username: "papa" });
    expect(store.get(`wr.dailyToken:${date}`)).toBe("tok-123");
    expect(JSON.parse(store.get(`wr.dailySolve:${date}`))).toMatchObject({
      won: true, guesses: 2, words: ["SLOTH", "CRANE"], grid: ["xxxxx", "ggggg"],
    });
    expect(getSocket().close).toHaveBeenCalled();
  });

  it("resolves false on timeout without writing anything", async () => {
    vi.useFakeTimers();
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const { makeSocket } = fakeSocketFactory([]); // server never answers
    const p = recoverDailyArtifacts({ date, username: "papa", storage, makeSocket, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5100);
    expect(await p).toBe(false);
    expect(store.size).toBe(0);
    vi.useRealTimers();
  });
});
