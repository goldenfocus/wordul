// public/studio-voice-core.js
// Pure transforms for the voice editor. No DOM, no fetch.
// working shape: { [worldId]: { on: boolean, source?: VoiceSource } }

export function setOn(working, id, on) {
  const cur = working[id] ?? {};
  return { ...working, [id]: { ...cur, on: !!on } };
}

export function setSource(working, id, source) {
  const cur = working[id] ?? { on: false };
  return { ...working, [id]: { ...cur, source } };
}

export function clearVoice(working, id) {
  const next = { ...working };
  delete next[id];
  return next;
}

// Emit the minimal override doc the server validator accepts: only entries that have
// a complete source. (on:false WITH a source is kept — a deactivated-but-assigned voice.)
export function buildVoiceOverride(working, base) {
  const ids = new Set(base.map((w) => w.id));
  const out = {};
  for (const id of Object.keys(working)) {
    if (!ids.has(id)) continue;
    const e = working[id];
    if (!e || !e.source || !e.source.kind) continue;
    out[id] = { on: !!e.on, source: e.source };
  }
  return out;
}
