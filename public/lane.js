// public/lane.js — browser twin of src/lane.ts. The client reads a room's lane off the
// snapshot to gate the ✨ power-ups (Gate A). Hand-kept in sync with src/lane.ts (same
// twin pattern as gold.js ↔ economy.ts).
export const VANILLA = { powerUps: false };
export const WILD = { powerUps: true };

export function laneSig(r) {
  return `p${r && r.powerUps ? 1 : 0}`;
}

// A snapshot with no ruleset (legacy / pre-lane) resolves to WILD — today's
// power-ups-everywhere behavior, so nothing regresses before the lane is everywhere.
export function rulesetOf(snap) {
  return (snap && snap.ruleset) || WILD;
}
export function powerUpsOn(snap) {
  return rulesetOf(snap).powerUps !== false;
}
