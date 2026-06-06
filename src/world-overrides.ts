import type { WorldDef } from "./worlds.ts";

export type WorldOverrides = {
  edits: Record<string, Partial<WorldDef>>; // field changes keyed by world id
  added: WorldDef[];                          // brand-new worlds not in code
  deleted: string[];                          // ids hidden/removed
};

export const EMPTY_OVERRIDES: WorldOverrides = { edits: {}, added: [], deleted: [] };

// Pure: code base + override layer -> effective list, sorted by order.
// A base world's `id` is immutable; edits to `id` are ignored.
export function mergeWorlds(base: WorldDef[], ov: WorldOverrides): WorldDef[] {
  const del = new Set(ov?.deleted ?? []);
  const edits = ov?.edits ?? {};
  const out: WorldDef[] = [];
  for (const w of base) {
    if (del.has(w.id)) continue;
    out.push({ ...w, ...(edits[w.id] ?? {}), id: w.id });
  }
  for (const a of ov?.added ?? []) {
    if (del.has(a.id)) continue;
    out.push({ ...a, ...(edits[a.id] ?? {}), id: a.id });
  }
  return out.sort((x, y) => x.order - y.order);
}

export type NormResult =
  | { ok: true; value: WorldOverrides }
  | { ok: false; reason: string };

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const NAME_MAX = 60;
const BLURB_MAX = 140;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Validate an admin-supplied override doc against the code base. Returns a cleaned
// doc or a human-readable reason. Strategy: coerce shape, merge, validate the
// EFFECTIVE list (catches both added and edited worlds in one pass).
export function normalizeOverrides(raw: unknown, base: WorldDef[]): NormResult {
  const o = asObj(raw);
  const edits = asObj(o.edits) as Record<string, Partial<WorldDef>>;
  const added = Array.isArray(o.added)
    ? (o.added as unknown[]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as WorldDef[]
    : [];
  const deleted = Array.isArray(o.deleted) ? (o.deleted as unknown[]).filter((x) => typeof x === "string") as string[] : [];

  const baseIds = new Set(base.map((w) => w.id));
  for (const id of Object.keys(edits)) {
    if (!SLUG_RE.test(id)) return { ok: false, reason: `invalid edit key: ${id}` };
    if (!baseIds.has(id) && !added.some((a) => a && a.id === id)) {
      return { ok: false, reason: `edit references unknown world id: ${id}` };
    }
  }

  // Valid edition ids come from the code base only — new worlds must reuse an existing edition (theme authoring is a later slice).
  const validEditions = new Set(base.map((w) => w.editionId));
  const clean: WorldOverrides = { edits, added, deleted };
  const effective = mergeWorlds(base, clean);

  const seenSlug = new Set<string>();
  for (const w of effective) {
    if (typeof w.id !== "string" || !w.id) return { ok: false, reason: "world missing id" };
    if (typeof w.slug !== "string" || !SLUG_RE.test(w.slug)) return { ok: false, reason: `bad slug: ${String(w.slug)}` };
    if (seenSlug.has(w.slug)) return { ok: false, reason: `duplicate slug: ${w.slug}` };
    seenSlug.add(w.slug);
    if (typeof w.name !== "string" || !w.name.trim() || w.name.length > NAME_MAX) return { ok: false, reason: `bad name for ${w.slug}` };
    if (typeof w.blurb !== "string" || w.blurb.length > BLURB_MAX) return { ok: false, reason: `bad blurb for ${w.slug}` };
    if (!validEditions.has(w.editionId)) return { ok: false, reason: `unknown editionId: ${String(w.editionId)}` };
    if (typeof w.featured !== "boolean") return { ok: false, reason: `featured must be boolean for ${w.slug}` };
    if (typeof w.order !== "number" || !Number.isFinite(w.order)) return { ok: false, reason: `bad order for ${w.slug}` };
  }
  return { ok: true, value: clean };
}
