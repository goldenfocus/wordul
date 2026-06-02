// public/hub.js — the Wordul home hub: shell + bottom nav + The Daily landing.
// Other tabs (Arena/Floor/Feed) are honest stubs in Phase A. Pure helpers live here too.

// Deterministic featured edition for a given date: rotates through the non-default
// editions so every day has a "theme of the day" with no server. Same date -> same
// theme for everyone (UTC day boundary).
export function dayTheme(date, editionIds) {
  const pool = editionIds.filter((id) => id !== "default");
  if (pool.length === 0) return "default";
  const dayNumber = Math.floor(date.getTime() / 86400000);
  return pool[dayNumber % pool.length];
}
