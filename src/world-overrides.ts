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
