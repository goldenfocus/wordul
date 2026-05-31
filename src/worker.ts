import { Room } from "./room.ts";
import type { Env } from "./types.ts";
export { Room };

// Accepts either word-pair codes (happy-otter) or legacy alphanumeric (5sy7uk).
// Min 3 chars to discourage trivial codes; max enforced by normalize().
const ROOM_CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ROOM_CODE_MIN = 3;

function normalizeCode(input: string): string {
  // Lowercase, drop everything that isn't alphanumeric or hyphen, collapse multiple hyphens,
  // trim hyphens from the ends, clip length.
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // WebSocket endpoint: /ws?code=ABC123
    if (url.pathname === "/ws") {
      const codeRaw = url.searchParams.get("code") ?? "";
      const code = normalizeCode(codeRaw);
      if (code.length < ROOM_CODE_MIN || !ROOM_CODE_RE.test(code)) {
        return new Response("invalid room code", { status: 400 });
      }
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      // Pass the code along so the DO can stamp it into its snapshot.
      const upstream = new URL(req.url);
      upstream.pathname = "/ws";
      upstream.searchParams.set("code", code);
      return stub.fetch(new Request(upstream.toString(), req));
    }

    // Everything else: static asset (SPA fallback handled by wrangler).
    return env.ASSETS.fetch(req);
  },
};
