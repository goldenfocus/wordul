// src/lane.ts — the two-lane spine. Pure, dependency-free, unit-tested.
// A room's competitive Ruleset selects a "lane": Vanilla (the fair lane — power-ups OFF)
// or Wild (power-ups ON). Power-ups are an in-game Points spend (see the two-token
// economy); the lane just decides whether they exist in a given room.
//
// Scope note: this is intentionally a single-axis lane (power-ups on/off). "Stakes"
// (buy-ins / freeze-out) is a separate dimension owned by the home-hub economy work and
// is deliberately NOT modeled here. Ruleset stays an object (not a bare boolean) so that
// work can add fields later without renaming the room property.

export type Ruleset = {
  powerUps: boolean; // are power-ups available in this room?
};

export type LaneName = "vanilla" | "wild";

export const VANILLA: Ruleset = { powerUps: false };
export const WILD: Ruleset = { powerUps: true };

// Canonical board/identity key. Today resolves to "p0"/"p1"; if the lane ever gains axes,
// the signature grows new segments automatically (no stored-data migration).
export function laneSig(r: Ruleset): string {
  return `p${r.powerUps ? 1 : 0}`;
}

// Resolve a UI preset name to a FRESH Ruleset. Unknown/invalid → WILD, preserving
// today's power-ups-everywhere behavior for any unexpected input.
export function lanePreset(name: unknown): Ruleset {
  return name === "vanilla" ? { ...VANILLA } : { ...WILD };
}
