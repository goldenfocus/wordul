import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PERSONAS, pickPersona, pickPersonas, projectPlayerForClient } from "../src/bots.ts";
import type { PlayerState } from "../src/types.ts";

const KNOWN_EDITIONS = ["default", "yang", "jackpot", "arcade", "editorial", "tactile", "robot"];

describe("PERSONAS roster", () => {
  it("every persona has non-empty id/name/avatar/edition/blurb", () => {
    for (const p of PERSONAS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.avatar).toBeTruthy();
      expect(p.edition).toBeTruthy();
      expect(p.blurb).toBeTruthy();
    }
  });

  it("persona ids are unique", () => {
    const ids = PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every persona.edition is a known edition id", () => {
    for (const p of PERSONAS) expect(KNOWN_EDITIONS).toContain(p.edition);
  });
});

describe("pickPersona", () => {
  it("is deterministic — same args, same result", () => {
    const open = new Set<string>();
    expect(pickPersona(2, open)?.id).toBe(pickPersona(2, open)?.id);
  });

  it("varies across seedCounts (full roster coverage)", () => {
    const open = new Set<string>();
    const ids = new Set<string>();
    for (let i = 0; i < PERSONAS.length; i++) ids.add(pickPersona(i, open)!.id);
    expect(ids.size).toBe(PERSONAS.length);
  });

  it("skips openPersonaIds", () => {
    const first = pickPersona(0, new Set())!;
    const picked = pickPersona(0, new Set([first.id]));
    expect(picked).not.toBeNull();
    expect(picked!.id).not.toBe(first.id);
  });

  it("returns null when all personas are open", () => {
    const all = new Set(PERSONAS.map((p) => p.id));
    expect(pickPersona(0, all)).toBeNull();
  });
});

describe("projectPlayerForClient (disguise)", () => {
  const seededPersona: PlayerState = {
    username: "maya",
    connected: true,
    guesses: [],
    status: "playing",
    isBot: true,
    points: 0,
    pointsSpent: 0,
  };

  it("strips isBot — JSON.stringify has no \"isBot\" (multiplayer branch)", () => {
    const out = projectPlayerForClient(seededPersona);
    expect(JSON.stringify(out)).not.toContain("isBot");
    expect(out.username).toBe("maya");
  });

  it("strips isBot on the single-player (daily 'me') shape too", () => {
    const me: PlayerState = { ...seededPersona, username: "yan", isBot: true };
    const out = projectPlayerForClient(me);
    expect("isBot" in out).toBe(false);
    expect(out.username).toBe("yan");
  });
});

describe("pickPersonas", () => {
  it("returns n distinct personas", () => {
    const picked = pickPersonas(0, 3, new Set());
    expect(picked.length).toBe(3);
    expect(new Set(picked.map((p) => p.id)).size).toBe(3);
  });

  it("skips open persona ids", () => {
    const open = new Set([PERSONAS[0].id, PERSONAS[1].id]);
    const picked = pickPersonas(0, 3, open);
    for (const p of picked) expect(open.has(p.id)).toBe(false);
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });

  it("degrades to fewer when the roster is exhausted (never duplicates)", () => {
    const picked = pickPersonas(0, PERSONAS.length + 5, new Set());
    expect(picked.length).toBe(PERSONAS.length);
    expect(new Set(picked.map((p) => p.id)).size).toBe(PERSONAS.length);
  });

  it("returns [] when n <= 0 or all personas are open", () => {
    expect(pickPersonas(0, 0, new Set())).toEqual([]);
    expect(pickPersonas(0, 3, new Set(PERSONAS.map((p) => p.id)))).toEqual([]);
  });

  it("pickPersona is the n=1 case", () => {
    const open = new Set<string>();
    expect(pickPersonas(2, 1, open)[0]?.id).toBe(pickPersona(2, open)?.id);
  });
});

describe("multi-bot disguise", () => {
  it("strips isBot AND the bot-only nextGuessAt from every bot in an N-bot room", () => {
    const bots: PlayerState[] = PERSONAS.slice(0, 4).map((p, i) => ({
      username: p.id, connected: true, guesses: [], status: "playing",
      isBot: true, scienceOptOut: true, points: 0, pointsSpent: 0,
      nextGuessAt: 1_000_000 + i * 1000, // bot-only heartbeat field — must NOT leak
    }));
    for (const b of bots) {
      const out = projectPlayerForClient(b);
      expect("isBot" in out).toBe(false);
      expect("nextGuessAt" in out).toBe(false);
      const json = JSON.stringify(out);
      expect(json).not.toContain("isBot");
      expect(json).not.toContain("nextGuessAt");
    }
  });
});

describe("bots.ts blindness", () => {
  it("imports nothing that exposes the answer (src-reading)", () => {
    const code = readFileSync(new URL("../src/bots.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']\.\/solver/);
    expect(code).not.toMatch(/from\s+["']\.\/wordsbysize/);
    expect(code).not.toMatch(/from\s+["']\.\/room/);
  });
});

describe("projectPlayerForClient — pendingWord disguise", () => {
  it("strips the bot's pending (decided-but-uncommitted) word", () => {
    const bot: PlayerState = {
      username: "maya", connected: true, guesses: [], status: "playing",
      isBot: true, ready: true, role: "duelist", points: 0, pointsSpent: 0,
      nextGuessAt: 123, pendingWord: "CRANE",
    };
    const out = projectPlayerForClient(bot) as Record<string, unknown>;
    expect("pendingWord" in out).toBe(false);
    expect("isBot" in out).toBe(false);
    expect("nextGuessAt" in out).toBe(false);
    expect(out.username).toBe("maya");
  });
});
