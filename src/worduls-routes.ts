// src/worduls-routes.ts — helpers for the worker's /api/worduls endpoints.
import type { Env } from "./types.ts";

export function extractBearer(req: Request): string {
  const a = req.headers.get("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

/** Owner-gate: a request is the owner iff its Bearer session validates against the
 *  owner's User DO (account/verify-session). */
export async function isOwner(env: Env, owner: string, token: string): Promise<boolean> {
  if (!token) return false;
  const res = await env.USER.get(env.USER.idFromName(owner))
    .fetch("https://do/account/verify-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionToken: token }),
    });
  if (!res.ok) return false;
  return (await res.json() as { valid?: boolean }).valid === true;
}

export function wordulsStub(env: Env, owner: string) {
  return env.WORDULS.get(env.WORDULS.idFromName(owner));
}
