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
//   • A viewer who FINISHED today holds the per-date finisher token; profile.js exchanges
//     it (server-validated) for this profile's letter rows and passes them as ctx.todayWords,
//     so a finisher sees the full letter-card. The lock above never consults it.

import { t } from "/i18n.js";

// Known mint reasons → friendly i18n labels; anything else is cleaned into Title Case
// (split on : _ - , capitalize each word) so an unforeseen reason still reads as a label.
const REASON_KEY = { "mint:daily": "gold.history.reason.daily", "mint:cashout": "gold.history.reason.cashout" };
export function humanizeReason(reason) {
  const key = REASON_KEY[reason];
  if (key) return t(key);
  const words = String(reason || "").split(/[:_\-\s]+/).filter(Boolean);
  if (words[0] === "mint" && words.length > 1) words.shift(); // drop the internal "mint:" prefix
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// A short, human date for a ledger row: "Today" for same-day earnings, else "Mon D"
// (e.g. "Jun 4"). `now` is injectable for tests; defaults to wall-clock now.
function ledgerDate(ts, now = Date.now()) {
  const d = new Date(Number(ts) || 0);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return t("gold.history.dateToday");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// View-model for one gold-ledger row. The server ships { delta, reason, ts, ref?, parts? }
// with Σ parts === delta when present; we re-verify that invariant on the client and DROP a
// malformed parts (show the flat total only) — defense-in-depth against a bad/old record.
//   → { kind, label, date, amount, parts }   (kind picks the faded glyph: "cashout" | "daily")
export function formatLedgerRow(tx, now = Date.now()) {
  const delta = Number(tx?.delta) || 0;
  const kind = tx?.reason === "mint:cashout" ? "cashout" : "daily";
  const raw = Array.isArray(tx?.parts) ? tx.parts : [];
  const sum = raw.reduce((s, p) => s + (Number(p?.delta) || 0), 0);
  const parts = raw.length && sum === delta ? raw : [];
  return {
    kind,
    label: humanizeReason(tx?.reason),
    date: ledgerDate(tx?.ts, now),
    amount: `+${delta}`,
    parts,
  };
}

// Running balance per ledger row — the chain-explorer column. `history` is newest-first;
// balances[i] is the holder's gold right AFTER row i landed, walked BACKWARDS from the
// current total. That keeps the 50-row public window honest: rows older than the window
// never need to be summed, only subtracted away.
export function ledgerBalances(history, total) {
  const out = [];
  let bal = Number(total) || 0;
  for (const tx of Array.isArray(history) ? history : []) {
    out.push(bal);
    bal -= Number(tx?.delta) || 0;
  }
  return out;
}

// Turn a room slug ("snappy-moose") into a spaced Title Case label ("Snappy Moose").
export function prettyRoomLabel(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Card-sized caption for a daily stamp: today reads "Daily"; a past day reads as a short
// local date ("Jun 1") — the raw ISO string is too wide for a tiny caption.
function dailyShortLabel(date, isToday) {
  if (isToday) return "Daily";
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return String(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

// Build the view-model for one recent game.
//   game: a PublicGameRecord ({ roomPath, result, guesses, solveGrid?, words?, ... }) — NO word.
//   ctx:  { today: "YYYY-MM-DD", playedToday: boolean, todayWords?: string[] | null }
//     todayWords: this profile's letter rows for TODAY's daily, fetched by profile.js from
//     the token-gated leaderboard (only a viewer who FINISHED today holds that token — at
//     that point the answer isn't a secret to them). Used only when the record itself
//     shipped no words, and only when it aligns row-for-row with the color grid.
// Returns { kind, won, guesses, label, shortLabel, result, date, wordLength, grid, words,
// locked, roomHref }. wordLength sizes the card's constant board frame (boardRows pads a
// solve-in-2 and a miss-in-6 to the same height); legacy records infer it from the grid.
export function recentGameView(game, ctx = {}) {
  const { today = "", playedToday = false, todayWords = null } = ctx;
  const roomPath = String(game.roomPath || "");
  const won = game.result === "won";
  const guesses = Number(game.guesses) || 0;
  const result = won ? `solved in ${guesses}` : "missed";
  const rawGrid = Array.isArray(game.solveGrid) ? game.solveGrid : null;
  const rawWords = Array.isArray(game.words) ? game.words : null; // letters, when shipped
  const wordLength =
    Number(game.wordLength) || (rawGrid && rawGrid[0] ? String(rawGrid[0]).length : 5);

  if (roomPath.startsWith("daily/")) {
    const date = roomPath.slice("daily/".length);
    const isToday = date === today;
    const label = isToday ? "Daily" : `Daily · ${date}`;
    // Lock today's board until the viewer has played; withhold colors AND letters while locked.
    const locked = isToday && !playedToday;
    // The live daily ships no `words` (server-stripped) — fall back to the finisher-token
    // letters when they align with the grid; a mismatch renders letterless, never misrowed.
    const unlockedWords =
      rawWords ??
      (isToday && Array.isArray(todayWords) && rawGrid && todayWords.length === rawGrid.length
        ? todayWords
        : null);
    return {
      kind: "daily", won, guesses, label, shortLabel: dailyShortLabel(date, isToday), result, date, wordLength,
      grid: locked ? null : rawGrid,
      words: locked ? null : unlockedWords,
      locked,
      roomHref: null,  // /@daily/<date> would render the VIEWER's own board — never link it
    };
  }

  // Challenge game (roomPath "c:<id>:<player>"): the server strips `words` (toPublicGame —
  // the pinned word replays for every player, so letters would spoil /c/<id>); render the
  // colors-only stamp and link the caption to PLAY that same challenge.
  if (roomPath.startsWith("c:")) {
    const id = roomPath.split(":")[1] || "";
    return {
      kind: "challenge", won, guesses, label: "Challenge", shortLabel: "Challenge", result, date: null, wordLength,
      grid: rawGrid,
      words: null,   // belt-and-braces: never letters for a challenge, even on an old payload
      locked: false,
      roomHref: id ? `/c/${id}` : null,
    };
  }

  // Room game: render the stored letter-card if we have one; legacy records with no board
  // fall back to a link into the room.
  const slug = roomPath.includes("/") ? roomPath.split("/")[1] || "" : roomPath;
  const label = prettyRoomLabel(slug);
  return {
    kind: "room", won, guesses, label, shortLabel: label, result, date: null, wordLength,
    grid: rawGrid,
    words: rawWords,
    locked: false,
    roomHref: rawGrid ? null : (roomPath ? `/@${roomPath}` : null),
  };
}
