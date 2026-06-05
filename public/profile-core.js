// public/profile-core.js — PURE view-model helpers for a public profile's "Recent games"
// list. No DOM, no fetch — unit-tested in test/profile-core.test.js. profile.js renders
// the markup from these.
//
// SPOILER RULES (mirror the home recap's invariant):
//   • The LIVE daily's letters never reach the client — the server strips words for
//     daily/<activeDate> (toPublicGame). We also never read the redundant top-level g.word.
//   • Past games (past dailies + rooms) ship their `words`, so we render the FULL letter
//     card. Games with only colors (legacy records) render letterless.
//   • TODAY's daily stays LOCKED (no colors, no letters) until the viewer has played today,
//     so a stranger's board can't hint at the live answer. Past dailies + rooms are open.

// Turn a room slug ("snappy-moose") into a spaced Title Case label ("Snappy Moose").
export function prettyRoomLabel(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Build the view-model for one recent game.
//   game: a PublicGameRecord ({ roomPath, result, guesses, solveGrid?, words?, ... }) — NO word.
//   ctx:  { today: "YYYY-MM-DD", playedToday: boolean }
// Returns { kind, icon, label, result, date, grid, words, locked, roomHref }.
export function recentGameView(game, ctx = {}) {
  const { today = "", playedToday = false } = ctx;
  const roomPath = String(game.roomPath || "");
  const won = game.result === "won";
  const icon = won ? "✅" : "❌";
  const guesses = Number(game.guesses) || 0;
  const result = won ? `solved in ${guesses}` : "missed";
  const rawGrid = Array.isArray(game.solveGrid) ? game.solveGrid : null;
  const rawWords = Array.isArray(game.words) ? game.words : null; // letters, when shipped

  if (roomPath.startsWith("daily/")) {
    const date = roomPath.slice("daily/".length);
    const isToday = date === today;
    const label = isToday ? "Daily" : `Daily · ${date}`;
    // Lock today's board until the viewer has played; withhold colors AND letters while locked.
    const locked = isToday && !playedToday;
    return {
      kind: "daily", icon, label, result, date,
      grid: locked ? null : rawGrid,
      words: locked ? null : rawWords,
      locked,
      roomHref: null,  // /@daily/<date> would render the VIEWER's own board — never link it
    };
  }

  // Room game: render the stored letter-card if we have one; legacy records with no board
  // fall back to a link into the room.
  const slug = roomPath.includes("/") ? roomPath.split("/")[1] || "" : roomPath;
  return {
    kind: "room", icon, label: prettyRoomLabel(slug), result, date: null,
    grid: rawGrid,
    words: rawWords,
    locked: false,
    roomHref: rawGrid ? null : (roomPath ? `/@${roomPath}` : null),
  };
}
