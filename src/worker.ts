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

    // Design gallery: serve /designs/* from the DESIGNS R2 bucket (permanent,
    // upload-only — no redeploy needed to publish a new prototype).
    if (url.pathname === "/designs" || url.pathname === "/designs/") {
      const idx = await env.DESIGNS.get("designs/index.html");
      if (idx) {
        return new Response(idx.body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("No designs yet.", { status: 404 });
    }
    if (url.pathname.startsWith("/designs/")) {
      const key = url.pathname.slice(1); // drop leading "/"
      // Pretty slug URLs (/designs/<slug>) map to <slug>.html objects; fall back
      // when the verbatim key misses so manifest.json / index.html still hit directly.
      const obj =
        (await env.DESIGNS.get(key)) ??
        (key.endsWith(".html") ? null : await env.DESIGNS.get(key + ".html"));
      if (obj) {
        const ct = obj.httpMetadata?.contentType ?? "text/html; charset=utf-8";
        return new Response(obj.body, { headers: { "content-type": ct } });
      }
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Design not found</title>" +
          "<body style=font-family:system-ui;padding:3rem><h1>Design not found</h1>" +
          "<p><a href=/designs/>← back to the gallery</a></p>",
        { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    // Everything else: static asset (SPA fallback handled by wrangler).
    return env.ASSETS.fetch(req);
  },
};
