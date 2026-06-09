import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown; env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Daily } from "../src/daily.ts";

function makeDaily() {
  const store = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, v); },
    },
  };
  // DAILY_SALT unset → strict no-op salt (house words), matches prod-with-no-secret.
  return new Daily(ctx as never, {} as never);
}

const get = (d: Daily, date: string) =>
  d.fetch(new Request(`https://do/word?date=${date}`, { method: "GET" }));

describe("Daily /word (past-only answer reveal)", () => {
  it("returns the word + themeId for a past date", async () => {
    const res = await get(makeDaily(), "2026-06-01");
    expect(res.status).toBe(200);
    const body = await res.json() as { date: string; word: string; themeId: string };
    expect(body.date).toBe("2026-06-01");
    expect(body.word).toMatch(/^[A-Z]+$/);        // a real uppercase answer
    expect(typeof body.themeId).toBe("string");
  });

  it("refuses a far-future date (no live/future answer leak)", async () => {
    const res = await get(makeDaily(), "2999-12-31");
    expect(res.status).toBe(404);
  });

  it("refuses a malformed date", async () => {
    const res = await get(makeDaily(), "nope");
    expect(res.status).toBe(404);
  });
});
