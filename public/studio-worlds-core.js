// public/studio-worlds-core.js
// Pure CRUD transforms for the World manager. No DOM, no fetch.
// A "world" is { id, slug, name, blurb, editionId, featured, order }.

const FIELDS = ["slug", "name", "blurb", "editionId", "featured", "order"];

export function updateField(list, id, key, value) {
  return list.map((w) => (w.id === id ? { ...w, [key]: value } : w));
}

export function addWorld(list, partial) {
  const order = list.reduce((m, w) => Math.max(m, w.order), -1) + 1;
  const slug = (partial.slug || "new-world").toString();
  const id = uniqueId(list, slug);
  const w = {
    id,
    slug,
    name: partial.name || "New World",
    blurb: partial.blurb || "",
    editionId: partial.editionId || "default",
    featured: !!partial.featured,
    order,
  };
  return [...list, w];
}

export function removeWorld(list, id) {
  return list.filter((w) => w.id !== id);
}

// dir: -1 (up) or +1 (down). Swaps the `order` value with the adjacent world.
export function moveWorld(list, id, dir) {
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return list;
  const a = sorted[i], b = sorted[j];
  return list.map((w) => {
    if (w.id === a.id) return { ...w, order: b.order };
    if (w.id === b.id) return { ...w, order: a.order };
    return w;
  });
}

// Diff a working list against the code base -> override doc the server understands.
export function buildOverrides(working, base) {
  const baseById = new Map(base.map((w) => [w.id, w]));
  const workingIds = new Set(working.map((w) => w.id));
  const edits = {};
  const added = [];
  const deleted = [];
  for (const w of working) {
    const b = baseById.get(w.id);
    if (!b) { added.push({ ...w }); continue; }
    const diff = {};
    for (const k of FIELDS) if (w[k] !== b[k]) diff[k] = w[k];
    if (Object.keys(diff).length) edits[w.id] = diff;
  }
  for (const b of base) if (!workingIds.has(b.id)) deleted.push(b.id);
  return { edits, added, deleted };
}

function uniqueId(list, slug) {
  const taken = new Set(list.map((w) => w.id));
  let id = slug;
  let n = 1;
  while (taken.has(id)) id = `${slug}-${n++}`;
  return id;
}
