// src/challenge.ts — one Durable Object per challenge id. Holds the pinned word,
// the owner's result (for the share card), and an append-only attempts list.
// The word NEVER leaves the server: /meta returns toMeta() which omits it, and the
// pinned word is handed only to a seeded Room DO (server→server) for masking.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import type { ChallengeState, ChallengeAttempt } from "./challenge-core.ts";
import { toMeta, computeRecord } from "./challenge-core.ts";

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

    return new Response("not found", { status: 404 });
  }
}
