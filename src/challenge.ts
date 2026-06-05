// src/challenge.ts — one Durable Object per challenge id. Holds the pinned word,
// the owner's result (for the share card), and an append-only attempts list.
// The word NEVER leaves the server: /meta returns toMeta() which omits it, and the
// pinned word is handed only to a seeded Room DO (server→server) for masking.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import type { ChallengeState, ChallengeAttempt } from "./challenge-core.ts";
import { toMeta, computeRecord, ghostsOf } from "./challenge-core.ts";
import type { GhostTape } from "./ghost-core.ts";

export class Challenge extends DurableObject<Env> {
  private async load(): Promise<ChallengeState | null> {
    return (await this.ctx.storage.get<ChallengeState>("state")) ?? null;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/") {
      const body = (await req.json()) as Omit<ChallengeState, "createdAt" | "attempts">;
      const existing = await this.load();
      if (existing) return Response.json({ id: existing.id });
      const state: ChallengeState = { ...body, createdAt: Date.now(), attempts: [] };
      await this.ctx.storage.put("state", state);
      return Response.json({ id: state.id });
    }

    if (req.method === "GET" && url.pathname === "/meta") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      return Response.json(toMeta(state));
    }

    if (req.method === "GET" && url.pathname === "/word") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      return Response.json({ word: state.word, wordLength: state.wordLength });
    }

    if (req.method === "POST" && url.pathname === "/attempt") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      const a = (await req.json()) as Omit<ChallengeAttempt, "at">;
      state.attempts.push({ ...a, at: Date.now() });
      if (state.attempts.length > 500) state.attempts = state.attempts.slice(-500);
      await this.ctx.storage.put("state", state);
      return Response.json({ record: computeRecord(state.attempts) });
    }

    // File the original race's ghost tape. First write wins — a rematch round minting a
    // NEW challenge id files its own tape; this id's tape is immutable once set.
    if (req.method === "POST" && url.pathname === "/tape") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      if (state.ghosts) return Response.json({ ok: true });
      const b = (await req.json().catch(() => null)) as { ghosts?: GhostTape } | null;
      if (!b?.ghosts || !Array.isArray(b.ghosts.events)) return new Response("bad request", { status: 400 });
      state.ghosts = b.ghosts;
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true });
    }

    // Wordless replay feed for the challenge client (same trust model as /meta).
    if (req.method === "GET" && url.pathname === "/ghosts") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      return Response.json(ghostsOf(state));
    }

    // Stamp the owner's real result once they finish (seeded Arena mints the challenge
    // BEFORE the race resolves, so ownerScore starts empty and lands here).
    if (req.method === "POST" && url.pathname === "/owner-result") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      const b = (await req.json().catch(() => null)) as { ownerScore?: string; ownerGrid?: string[][] } | null;
      if (typeof b?.ownerScore === "string") state.ownerScore = b.ownerScore;
      if (Array.isArray(b?.ownerGrid)) state.ownerGrid = b.ownerGrid;
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }
}
