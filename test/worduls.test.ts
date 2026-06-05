import { describe, it, expect, beforeEach } from "vitest";
import { Worduls } from "../src/worduls.ts";

// Minimal in-memory DurableObjectState stub: only ctx.storage.get/put used.
function makeStub() {
  const map = new Map<string, unknown>();
  const ctx = { storage: {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
  } } as unknown as DurableObjectState;
  return new Worduls(ctx, {} as never);
}
async function call(o: Worduls, method: string, path: string, body?: unknown) {
  return o.fetch(new Request(`https://do${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  }));
}

describe("Worduls DO", () => {
  let o: Worduls;
  beforeEach(() => { o = makeStub(); });

  it("publishes a wordul and lists it", async () => {
    const pub = await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { vibeTitle: "Ocean Day", word: "ocean", story: { title: "Why", body: "Tides." } }, now: 1000 });
    expect(pub.status).toBe(200);
    const { url, worldId } = await pub.json() as { url: string; worldId: string };
    expect(url).toBe("/@zang/ocean-day");
    expect(worldId).toMatch(/^wd_/);
    const list = await (await call(o, "GET", "/list?owner=zang")).json() as { worlds: unknown[] };
    expect(list.worlds.length).toBe(1);
  });

  it("auto-suffixes a colliding slug", async () => {
    const base = { owner: "zang", bundle: { vibeTitle: "Dup", word: "ocean", story: { title: "t", body: "b" } } };
    await call(o, "POST", "/publish", { ...base, desiredSlug: "dup", now: 1 });
    const second = await call(o, "POST", "/publish", { ...base, desiredSlug: "dup", now: 2 });
    expect((await second.json() as { url: string }).url).toBe("/@zang/dup-2");
  });

  it("rejects a reserved slug by suffixing past it", async () => {
    const res = await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "worduls", bundle: { word: "ocean", story: { title: "t", body: "b" } }, now: 1 });
    expect((await res.json() as { url: string }).url).not.toBe("/@zang/worduls");
  });

  it("rejects an invalid bundle", async () => {
    const res = await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "x", bundle: { word: "x", story: { title: "t", body: "b" } }, now: 1 });
    expect(res.status).toBe(400);
  });

  it("resolve locks the word WITHOUT counting a play; /play counts per player", async () => {
    await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { word: "ocean", story: { title: "Why", body: "B" } }, now: 1 });
    const r1 = await call(o, "GET", "/resolve?slug=ocean-day");
    expect(r1.status).toBe(200);
    expect((await r1.json() as { word: string }).word).toBe("OCEAN");
    await call(o, "GET", "/resolve?slug=ocean-day"); // idempotent re-seed — still no play
    let list = await (await call(o, "GET", "/list?owner=zang&includeAll=1")).json() as { worlds: Array<{ plays: number; wordLocked: boolean }> };
    expect(list.worlds[0].wordLocked).toBe(true); // locked on first resolve
    expect(list.worlds[0].plays).toBe(0);         // resolve NEVER counts a play
    await call(o, "POST", "/play?slug=ocean-day");
    await call(o, "POST", "/play?slug=ocean-day");
    list = await (await call(o, "GET", "/list?owner=zang&includeAll=1")).json() as { worlds: Array<{ plays: number }> };
    expect(list.worlds[0].plays).toBe(2);          // two distinct players → 2
  });

  it("404s resolve for an unknown slug", async () => {
    expect((await call(o, "GET", "/resolve?slug=nope")).status).toBe(404);
  });

  it("patches cosmetics but refuses to change a locked word", async () => {
    await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { word: "ocean", story: { title: "Why", body: "B" } }, now: 1 });
    await call(o, "GET", "/resolve?slug=ocean-day"); // locks the word
    const patch = await call(o, "PATCH", "/patch?slug=ocean-day", { vibeTitle: "Renamed", word: "OTHER" });
    expect(patch.status).toBe(200);
    const got = await (await call(o, "GET", "/get?slug=ocean-day")).json() as { vibeTitle: string; word: string };
    expect(got.vibeTitle).toBe("Renamed");
    expect(got.word).toBe("OCEAN"); // word change ignored once locked
  });

  it("unpublishes (hidden from public list, still present for owner)", async () => {
    await call(o, "POST", "/publish", { owner: "zang", desiredSlug: "ocean-day", bundle: { word: "ocean", story: { title: "Why", body: "B" } }, now: 1 });
    await call(o, "PATCH", "/patch?slug=ocean-day", { status: "unpublished" });
    const pub = await (await call(o, "GET", "/list?owner=zang")).json() as { worlds: unknown[] };
    expect(pub.worlds.length).toBe(0);
    const all = await (await call(o, "GET", "/list?owner=zang&includeAll=1")).json() as { worlds: unknown[] };
    expect(all.worlds.length).toBe(1);
  });
});
