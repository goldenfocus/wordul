// Wordul — client
// Single-file SPA: home → room (lobby → playing → finished), localStorage stats.
import { getSessionToken, openSecureSheet } from "/account.js";
import { generateRoomCode } from "/codes.js";
import { renderProfile } from "/profile.js";
import { applyEdition, applyColorScheme, getActiveEditionId, setDefaultEdition, getGold, setGold, drainGold, companionReact, renderEditionPicker, VOICE_EDITION, activeMistakeFx } from "/edition.js";
import { pickGuessEvent } from "/roomConfig.js";
import { speakLine, speakTemplated } from "/voice.js";
import { newGreensInLast, orderedDiscoveriesInLast, wastedDeadLettersInLast } from "/celebrate.js";
import { GOLD, comboMultiplier, awardGold, goldDrain, escalatedPenalty, renderGoldHud, playPayoutSequence } from "/gold.js";
import { createHacklog } from "/hacklog.js";
import { renderPowerups, resetPowerHints, handlePowerupMessage, bumpErrorCount, surfaceGiveUp, checkBankruptcy } from "/powerups.js";
import { activeLayoutId, buildKeyboard, renderKeyboard, renderLayoutPicker, detectLayout } from "/keyboard.js";
import { getSettings, saveSettings, applySettings, openSettings, openHub } from "/settings.js";
import { buildShareCardModel, renderShareCard } from "/share-card.js";
import { renderHub, homeTypeLetter, dayTheme } from "/hub.js";
import { mountArenaList, pickNextGame } from "/arena-panel.js";
import { computeDailyStatsView, computeRosterView } from "/daily-stats.js";
import { fmtDuration, goldValue } from "/daily-card.js";
import { computeFeedStreamView, computeFeedPostView } from "/feed.js";
import { EDITIONS, getEdition } from "/editions/index.js";
import { MODES, isAvailableMode } from "/modes.js";
import { getWorld, worldSlugFromPath } from "/worlds.js";
import { t, initLang } from "/i18n.js";
import { wordIntel } from "/data/word-intel.js";
import { pickInspire } from "/inspire.js";
import { lossKind } from "/race-copy.js";

initLang(); // resolve language (saved pick → locale auto-detect) before any t() call

// Apply the active edition at module load (before motion consts read WordulMotion).
applyEdition(getActiveEditionId());

const LS = {
  username: "wr.username",
  session: "wr.session", // raw account session token (bearer) — present only for a secured name
  preferredLength: "wr.length",
  replay: "wr.replay", // structured per-guess payout log, keyed per game (slug:round)
  clearHint: "wr.clearHint", // one-time "press Esc / hold ⌫ to clear the row" nudge
  dailySolve: "wr.dailySolve", // your own daily solve (letters + colors), per date — CLIENT-ONLY
                               // so the home stamp shows real letters without the public
                               // profile ever leaking today's answer.
};

const SOLVE_CELL = { green: "g", yellow: "y", gray: "x" };
// Stash this browser's own finished daily (letters + color grid) so the home recap can
// draw a crystallized stamp with real letters. Never sent to the server.
function captureDailySolve(date, me) {
  if (!date || !me || !Array.isArray(me.guesses)) return;
  try {
    const solve = {
      won: me.status === "won",
      guesses: me.guesses.length,
      words: me.guesses.map((g) => String(g.word || "").toUpperCase()),
      grid: me.guesses.map((g) => (g.mask || []).map((c) => SOLVE_CELL[c] || "x").join("")),
    };
    localStorage.setItem(`${LS.dailySolve}:${date}`, JSON.stringify(solve));
  } catch { /* storage full / disabled — stamp falls back to the server color grid */ }
}

const SUPPORTED_LENGTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_LENGTH = 5;

function getPreferredLength() {
  const n = parseInt(localStorage.getItem(LS.preferredLength) ?? "", 10);
  return SUPPORTED_LENGTHS.includes(n) ? n : DEFAULT_LENGTH;
}
function setPreferredLength(n) {
  if (SUPPORTED_LENGTHS.includes(n)) localStorage.setItem(LS.preferredLength, String(n));
}

// --- settings ---
// Settings storage (get/save/apply), the settings modal, and the avatar hub now
// live in /settings.js (imported above). app.js stays the orchestrator.

// --- identity ---
// A username (no password) is the player's identity everywhere. Normalized to
// [a-z0-9_-], min 3, max 20 — matching the server's onHello + worker regexes.
function normalizeUsername(u) {
  // Mirrors src/identity.ts: re-trim after the slice in case clipping exposes a trailing separator.
  return (u || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+|[-_]+$/g, "").slice(0, 20).replace(/^[-_]+|[-_]+$/g, "");
}
function getUsername() {
  return localStorage.getItem(LS.username) || "";
}
function setUsername(u) {
  const clean = normalizeUsername(u);
  localStorage.setItem(LS.username, clean);
  syncAvatar(); // keep the hub avatar glyph in sync with the chosen name
  return clean;
}
function clearUsername() {
  localStorage.removeItem(LS.username);
  syncAvatar();
}

// --- routing ---
// Owner-nested rooms (/@owner/<slug>) and public profiles (/@username).
const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function parseRoute() {
  const challenge = location.pathname.match(/^\/c\/([0-9A-Za-z]{5})$/);
  if (challenge) return { kind: "challenge", id: challenge[1] };
  if (location.pathname === "/daily/archive") return { kind: "daily-archive" };
  const dailyStats = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})\/stats$/);
  if (dailyStats) return { kind: "daily-stats", date: dailyStats[1] };
  const daily = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (daily) return { kind: "daily", date: daily[1] };
  if (location.pathname === "/daily") return { kind: "daily", date: todayUTC() };
  if (location.pathname === "/arena") return { kind: "arena" };
  if (location.pathname === "/feed") return { kind: "feed" };
  const feedPost = location.pathname.match(/^\/feed\/(\d{4}-\d{2}-\d{2})$/);
  if (feedPost) return { kind: "feed-post", date: feedPost[1] };
  const worldSlug = worldSlugFromPath(location.pathname);
  if (worldSlug) return { kind: "world", slug: worldSlug };
  const room = location.pathname.match(ROOM_RE);
  if (room) return { kind: "room", owner: room[1], slug: room[2] };
  const prof = location.pathname.match(PROFILE_RE);
  if (prof) return { kind: "profile", username: prof[1] };
  return { kind: "home" };
}

// --- DOM helpers ---
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function mount(tplId) {
  const tpl = $("#" + tplId);
  const app = $("#app");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  // Every screen change drops the home-only topbar stats; renderHub re-adds it.
  document.body.classList.remove("hub-home");
}

// Type-to-play: a bare letter pressed on the home (hub up, nothing focused) carries
// into today's board as a seed. Held here between the home keypress and the daily
// board becoming interactive; applied once by seedDailyOnce, then cleared.
let pendingDailySeed = null;
// Arena-origin handoff: set just before navigating INTO a room reached through the Arena
// (open-games row tap or public host). showRoom consumes it into game.fromArena and mirrors
// it to sessionStorage so a mid-game refresh still resolves the Arena end screen.
let pendingArenaOrigin = false;
// Set when a flow wants the home hub to open straight into the Arena list once it renders
// (the "Join next game → none waiting" fallback). Consumed after renderHub.
let pendingOpenArena = false;

// One persistent listener: while the home screen is up and no field is focused, a
// letter key starts today's word seeded with it (the card's own keydown handles
// Enter/Space). Guarded so it never steals typing from the username field or rooms.
document.addEventListener("keydown", (e) => {
  if (parseRoute().kind !== "home") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  if (/^[a-zA-Z]$/.test(e.key)) homeTypeLetter(e.key.toUpperCase());
});

// Best-effort seed of the daily board with the letter typed on the home. Self-
// contained and harmless: it only types through the real input path once an input
// row exists, and gives up quietly after a couple of seconds (e.g. slow WS).
function seedDailyOnce(letter) {
  if (!/^[A-Za-z]$/.test(letter || "")) return;
  let tries = 0;
  const tick = () => {
    if (parseRoute().kind !== "daily") return; // navigated away — abandon
    const ready = document.querySelector("#boards .input-row");
    if (ready) { try { typeLetter(letter.toUpperCase()); } catch (_) {} return; }
    if (++tries < 20) setTimeout(tick, 120);
  };
  setTimeout(tick, 120);
}

// Play today's word as an in-place BLOOM, not a hard cut to a new screen: wrap the
// client-side nav in a View Transition so the home card morphs/grows into the board
// (showDaily tags #tabPlay with the same view-transition-name as .daily-card).
// Progressive + reduced-motion safe: no API or reduce-motion → plain instant nav.
function bloomIntoDaily(voiceId) {
  const target = "/daily/" + todayUTC();
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Apply the daily's voice INSIDE the transition's DOM-swap so the captured "old"
  // frame is still the elegant default home and the "new" frame is the themed board.
  // That difference is what the View Transition morphs through (square→rounded,
  // ultraviolet→the day's accent). Applying it earlier made old==new — a hard cut.
  // The daily room re-applies its voice from the server snapshot, so a reload is fine.
  const swap = () => { if (voiceId) applyEdition(voiceId); navigate(target); };
  if (typeof document.startViewTransition === "function" && !reduce) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

// --- screens ---

function showHome() {
  history.replaceState(null, "", "/");
  mount("tpl-home");
  // No chat available outside a room.
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;

  const input = $("#usernameInput");
  input.value = getUsername();

  // Registration commit: set the username and reveal the hub so the new player can
  // choose Wordul of the Day / Solo / Head-to-head — rather than being dropped
  // straight into a personal room.
  $("#startPlayingBtn").addEventListener("click", () => {
    if (commitUsername()) renderHomeIdentity();
  });
  // Enter in the username field mirrors the CTA → into the hub.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#startPlayingBtn").click();
  });

  // Switch-user reset (returning users): drop identity, reveal the intro, refocus.
  const switchBtn = $("#switchUserBtn");
  if (switchBtn) {
    switchBtn.onclick = () => {
      clearUsername();
      renderHomeIdentity();
      const i = $("#usernameInput");
      if (i) { i.value = ""; i.focus(); }
    };
  }

  renderHomeIdentity();
}

// Toggle greeting vs. intro based on whether we know who the player is.
// For returning users, render the Hub (hides the legacy greeting/rooms sections).
function renderHomeIdentity() {
  // The home wears the app's signature look, never a daily's voice. Reset to the
  // default edition here so today's voice (Tactile, etc.) doesn't bleed onto the
  // hub — it only takes over when you START the WOTD, as a morph (see bloomIntoDaily).
  // This also re-persists "default", so a leftover voice can't leak into a Solo game.
  applyEdition("default");
  applyColorScheme(null); // drop any curated day palette so the hub never wears yesterday's vibe
  const u = getUsername();
  const greeting = $("#homeGreeting");
  const intro = $("#homeIntro");
  const rooms = $("#homeRooms");
  if (u) {
    // Hide legacy home sections — the Hub takes over.
    if (greeting) greeting.hidden = true;
    if (intro) intro.hidden = true;
    if (rooms) rooms.hidden = true;
    // Also hide the CTA button and how-to link — hub has its own play action.
    const cta = $(".home-cta");
    if (cta) cta.hidden = true;
    const howto = $(".home-howto");
    if (howto) howto.hidden = true;

    const cbs = {
      username: u,
      editions: EDITIONS,
      editionName: (id) => getEdition(id).name,
      // Tap or type-to-play: drop into today's board (client-side, no reload). A
      // typed letter is carried as a seed so "start playing right here" feels real.
      onPlay: (editionId, seed) => { pendingDailySeed = seed || null; bloomIntoDaily(editionId); },
      onSolo: () => enterNewRoom({ autoStart: true }),
      onPvP: () => enterNewRoom({ autoStart: false }),
      onArena: () => showArena(),
      onStats: () => navigate("/daily/" + todayUTC() + "/stats"),
      onShareDaily: () => shareDailyResult(cbs.dailyResult),
      onProfile: (name) => navigate("/@" + name),
      onWorld: (slug) => navigate("/w/" + slug),
      onBrowseWorlds: () => navigate("/worlds"),
      fetchLeaderboard: (username) =>
        fetch(`/api/daily/${todayUTC()}/leaderboard?username=${encodeURIComponent(username)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      // dailyResult is filled from the profile below: null until you've played today,
      // then { won, guesses } — flips the home card to its post-play recap.
      dailyResult: null,
      // Real "N played" for the day from public aggregates — never a fake number.
      fetchPlayed: () => fetch("/api/science/today")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s?.totals?.roundsStarted ?? s?.totals?.playerFinishes ?? null),
      renderRecentRooms: (mountEl) => renderRecentRoomsInto(mountEl, 3),
    };
    fetch(`/api/user/${encodeURIComponent(u)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((profile) => {
        // Populate homeRoomRows so renderRecentRoomsInto has data ready.
        homeRoomRows = buildRoomRows(profile, u);
        homeRoomVisible = HOME_ROOMS_PAGE;
        cbs.dailyResult = dailyResultFor(profile);
        renderHub(profile, cbs);
        maybeOpenArena();
      })
      .catch(() => { renderHub({}, cbs); maybeOpenArena(); });
  } else {
    if (greeting) greeting.hidden = true;
    if (intro) intro.hidden = false;
    if (rooms) rooms.hidden = true;
    const i = $("#usernameInput");
    if (i) i.focus();
  }
}

// Today's daily result from the profile (no extra request): the finished game whose
// roomPath is daily/<today>. Drives the home's post-play recap. null = not played yet.
function dailyResultFor(profile) {
  const date = todayUTC();
  const g = (profile?.games || []).find((x) => x.roomPath === "daily/" + date);
  if (!g) return null;
  // Colors come from the server record (cross-device, no spoiler); the real LETTERS come
  // only from THIS browser's own solve (never the public profile). Local wins when present.
  let grid = g.solveGrid ?? null;
  let words = null;
  try {
    const raw = localStorage.getItem(`${LS.dailySolve}:${date}`);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.grid) && s.grid.length) grid = s.grid;
      if (Array.isArray(s.words) && s.words.length) words = s.words;
    }
  } catch { /* ignore */ }
  return { won: g.result === "won", guesses: g.guesses, solveGrid: grid, solveWords: words };
}

// Share today's result from the home — a spoiler-free line + the day's link (no board
// PNG here, since the game isn't loaded on the home). Native sheet, else clipboard.
function shareDailyResult(result) {
  const url = location.origin + "/daily/" + todayUTC();
  const line = result && result.won
    ? `I solved today's Wordul in ${result.guesses}.`
    : "Today's Wordul got me.";
  if (typeof navigator.share === "function") {
    navigator.share({ title: "Wordul of the Day", text: line, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(`${line} ${url}`).then(() => toast("Copied — share it anywhere")).catch(() => {});
  } else {
    toast("Sharing isn't supported on this browser");
  }
}

// Validate + persist the typed username. Returns the committed username, or "" when
// it fails the min-length gate (with inline feedback). Shared by the registration
// CTA and the room-create flow.
function commitUsername() {
  const input = $("#usernameInput");
  const username = setUsername(input ? input.value : getUsername());
  if (username.length < 3) {
    if (input) {
      input.focus();
      input.style.outline = "2px solid var(--error)";
      setTimeout(() => (input.style.outline = ""), 700);
    }
    toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
    return "";
  }
  return username;
}

// Shared create flow for the hub CTAs. autoStart=true → solo game begins on the
// first lobby snapshot (see onServerMessage); false → land in the lobby to invite.
function enterNewRoom({ autoStart, publicArena = false }) {
  const username = commitUsername();
  if (!username) return;
  const slug = generateRoomCode();
  history.pushState(null, "", `/@${username}/${slug}`);
  // Hosting a public Arena room IS an Arena-origin entry — flag it before showRoom consumes it.
  if (publicArena) pendingArenaOrigin = true;
  showRoom(username, slug);
  // showRoom resets game state, so set the one-shot flags after it.
  // Invite path lands quietly in the lobby; the explicit invite button shares on demand.
  if (autoStart) game.autoStart = true;
  // Public Arena host: tell the room (via hello) to list itself in the open-games index.
  if (publicArena) game.publicArena = true;
}

// --- Home rooms list ---

let homeRoomRows = [];
const HOME_ROOMS_PAGE = 6; // show this many at first; "Show more" reveals another page
let homeRoomVisible = HOME_ROOMS_PAGE;

async function loadHomeRooms(username) {
  homeRoomRows = [];
  homeRoomVisible = HOME_ROOMS_PAGE;
  try {
    const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const profile = await res.json();
    homeRoomRows = buildRoomRows(profile, username);
  } catch (e) {
    // Degrade silently — greeting + CTAs still carry the screen.
    console.error("loadHomeRooms failed:", e);
  }
  const rooms = $("#homeRooms");
  if (!rooms) return; // user navigated away mid-fetch
  if (homeRoomRows.length === 0) {
    rooms.hidden = true;
    return;
  }
  rooms.hidden = false;
  renderRoomList();
}

// Merge owned rooms with rooms derived from game history, dedupe by path
// (owned name wins), sort most-recent-first.
function buildRoomRows(profile, username) {
  const byPath = new Map();
  for (const r of profile.ownedRooms || []) {
    const path = `/@${username}/${r.slug}`;
    byPath.set(path, {
      path,
      name: r.name || titleCaseSlug(r.slug),
      ts: r.lastPlayedAt || 0,
      mine: true,
      owned: true,
    });
  }
  for (const g of profile.games || []) {
    const roomPath = g.roomPath || "";
    if (!roomPath.includes("/")) continue;
    const path = `/@${roomPath}`;
    const slug = roomPath.split("/")[1] || "";
    const owner = roomPath.split("/")[0];
    const existing = byPath.get(path);
    if (existing) {
      // Owned name already wins; just keep the most recent timestamp.
      existing.ts = Math.max(existing.ts, g.finishedAt || 0);
      continue;
    }
    byPath.set(path, {
      path,
      name: titleCaseSlug(slug),
      ts: g.finishedAt || 0,
      mine: owner === username,
      owned: false,
    });
  }
  return Array.from(byPath.values()).sort((a, b) => b.ts - a.ts);
}

// Render homeRoomRows into an arbitrary <ul> mount element (defaults to #roomList).
// The hub calls this with #hubRoomList so it can embed the list in The Daily panel.
function renderRecentRoomsInto(mountEl, limit) {
  renderRoomList(mountEl, limit);
}

function renderRoomList(mountEl, limit) {
  const list = mountEl || $("#roomList");
  if (!list) return;
  const rows = homeRoomRows;
  list.textContent = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "room-empty muted small";
    li.textContent = "No rooms yet.";
    list.appendChild(li);
    return;
  }
  // A hard `limit` (the hub) shows exactly N with no "Show more"; the legacy paged
  // list (#roomList) falls back to homeRoomVisible and keeps its reveal control.
  const shown = rows.slice(0, limit || homeRoomVisible);
  for (const row of shown) {
    const li = document.createElement("li");
    li.className = "room-row";
    li.tabIndex = 0;
    li.setAttribute("role", "button");

    const main = document.createElement("div");
    main.className = "room-row-main";
    const name = document.createElement("span");
    name.className = "room-row-name";
    name.textContent = row.name; // textContent → inherently XSS-safe
    main.appendChild(name);
    if (!row.mine) {
      const tag = document.createElement("span");
      tag.className = "room-row-owner";
      tag.textContent = `@${row.path.split("/")[1]}`; // /@owner/slug → owner
      main.appendChild(tag);
    }

    const time = document.createElement("span");
    time.className = "room-row-time muted small";
    time.textContent = relativeTime(row.ts);

    li.appendChild(main);
    li.appendChild(time);
    li.addEventListener("click", () => navigate(row.path));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(row.path); }
    });
    list.appendChild(li);
  }
  // "Show more" — reveal the next page rather than scrolling a wall of rooms.
  // Suppressed when a hard `limit` is set (the hub shows exactly N, no reveal).
  const remaining = rows.length - shown.length;
  if (!limit && remaining > 0) {
    const more = document.createElement("li");
    more.className = "room-row room-more";
    more.tabIndex = 0;
    more.setAttribute("role", "button");
    const moreLabel = document.createElement("span");
    moreLabel.className = "room-more-label";
    moreLabel.textContent = `Show ${Math.min(HOME_ROOMS_PAGE, remaining)} more`;
    const moreChevron = document.createElement("span");
    moreChevron.className = "room-more-chevron";
    moreChevron.textContent = "⌄";
    more.appendChild(moreLabel);
    more.appendChild(moreChevron);
    const showMore = () => { homeRoomVisible += HOME_ROOMS_PAGE; renderRoomList(); };
    more.addEventListener("click", showMore);
    more.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showMore(); }
    });
    list.appendChild(more);
  }
}

// "crunchy-zebra" → "Crunchy Zebra"
function titleCaseSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Compact relative time: "just now" / "5m ago" / "3h ago" / "2d ago".
function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

function showRoomEntry(owner, slug) {
  // For joiners with no username yet — show home but pre-fill the join path and
  // repurpose the primary CTA as "Join room".
  mount("tpl-home");
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  $("#homeGreeting").hidden = true;
  $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = `Join @${owner}'s Wordul room.`;
  $(".sub").textContent = "Pick a username to join.";

  const input = $("#usernameInput");
  input.value = getUsername();
  input.focus();
  const btn = $("#startPlayingBtn");
  const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = "Join room →";
  const join = () => {
    const username = setUsername(input.value);
    if (username.length < 3) {
      input.focus();
      toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
      return;
    }
    showRoom(owner, slug);
  };
  btn.addEventListener("click", join);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
}

// --- Game / room ---

const game = {
  ws: null,
  challengeId: null,   // /c/<id> solo-replay: the challenge being raced (null in normal rooms)
  challengeMeta: null, // cached { owner, ownerScore, record, ... } from /api/challenge/<id>/meta
  isDaily: false,      // /daily/<date>: async one-shot, gated "underneath"
  dailyDate: null,
  fromArena: false,    // reached through the Arena (open-games join or public host) → Arena end screen
  owner: null,
  slug: null,
  path: null,
  name: null,
  snapshot: null,
  pending: "",       // current guess being typed
  toastTimer: null,
  hasShownEndStats: false,
  lastGuessCounts: new Map(),
  typing: new Map(), // username -> # letters in their live (uncommitted) row, for opponent ghost fill
  // Chat state: how many entries we'd already rendered so we can flag new ones for
  // the unread badge while the panel is collapsed.
  lastChatLen: 0,
  unreadChat: 0,
  chatCollapsed: false,
  exploding: false,
  reconnectNoticeTimer: null, // arms the gentle glass pill once an outage is sustained
  reconnectTimer: null, // pending openSocket() after an unintended close
  reconnectAttempts: 0, // backoff counter; reset to 0 on a successful open
  pendingReconnect: null, // { url, session } so online/focus can pull the retry forward
  socketSession: null,  // { ws, reconnect } — stale close handlers bail when !== this
  heartbeatTimer: null,
  pongTimer: null, // heartbeat watchdog — unanswered ping ⇒ recycle a zombie socket
  autoStart: false,  // one-shot: "Start playing" auto-begins the solo game on first lobby snapshot
  shareImage: null,  // { file, url, text, canvas } — pre-rendered result card for sharing
  // EZ-mode power-ups (reset each round): revealed letters + known vowel count.
  ezRound: -1,
  revealed: [],
  vowels: null,
  pendingReveal: false,
  pendingVowel: false,
  // Clearer-wins: structured replay capture + a guard so a mid-payout board repaint
  // (from another player's snapshot) doesn't orphan the tiles the payout is glowing.
  replay: [],
  payingOut: false,
  // Clearer-wins: ids of the deferred payout/drain timers, so leaving the room or
  // starting a new round can cancel them before they fire off-screen (which would
  // mutate the persistent gold balance unseen + run a bankruptcy check on a stale snapshot).
  payoutTimers: [],
  // Loss penalties (C2): per-GAME map of dead-letter (uppercase) → times already
  // wasted this game. The first reuse costs the base penalty; each repeat escalates.
  deadLetterReuse: new Map(),
  // C4 — give-up / bankruptcy state. finishReason is how the game ended from MY view;
  // stuck/errorCount surface the 💀 give-up affordance (reset per round by resetPowerHints).
  finishReason: null, // 'solved' | 'lost' | 'bankrupt' | 'gave_up' | null
  stuck: false,
  errorCount: 0,
};
// Dependency bundle handed to the power-ups module (it must not import app.js — the
// <script type="module"> entry — or the graph would cycle). All app-owned helpers it
// reaches for, in one place. Function refs resolve lazily (hoisted declarations).
const powerupsCtx = {
  game,
  send: (msg) => send(msg),
  render: () => render(),
  toast: (text, opts) => toast(text, opts),
  renderGoldHud,
  getSettings,
  getGold,
  drainGold,                                       // C4: power-up spends can dip gold negative
  getUsername,                                     // resolve "me" inside the module
  forfeit: (reason) => forfeit(reason),            // C4: give-up / bankruptcy — record loss + explode
};
// The hacker-log terminal: lazily mounted into #hacklog on first payout, reused
// across guesses within a room, cleared per round. reducedMotion is read live.
let hacklog = null;
function getHacklog() {
  const el = $("#hacklog");
  if (!el) return null;
  if (!hacklog) hacklog = createHacklog(el, { reducedMotion: getSettings().reducedMotion });
  el.hidden = false; // reveal on every payout (resetRound re-hides between rounds)
  return hacklog;
}
// The localStorage key is per-game (slug + round) so distinct games never clobber
// each other's replay. game.ezRound tracks the live round number.
function replayKey() {
  return `${LS.replay}:${game.slug || "?"}:${game.ezRound}`;
}
// Push one structured per-guess entry into game.replay + persist. This is the exact
// shape the (gated) server-side replay viewer will store — capture it now, no rework.
function recordReplayEntry(entry) {
  game.replay.push(entry);
  try {
    localStorage.setItem(replayKey(), JSON.stringify(game.replay));
  } catch { /* storage full / disabled — the in-memory replay still drives the end-screen */ }
}
// Schedule a deferred payout/drain step, tracking its id so leaveRoom()/resetRound()
// can cancel it. If the room is gone by the time it fires, it no-ops (we don't touch
// gold for a room we've left). See game.payoutTimers.
function deferPayout(fn, ms) {
  const id = setTimeout(() => {
    game.payoutTimers = game.payoutTimers.filter((t) => t !== id);
    if (!game.snapshot) return;
    fn();
  }, ms);
  game.payoutTimers.push(id);
  return id;
}
function clearPayoutTimers() {
  for (const t of game.payoutTimers) clearTimeout(t);
  game.payoutTimers = [];
  game.payingOut = false;
  clearGiveUpTimer(); // a new round / leaving resets the 3-min 💀 unlock
}
// Resolve a tile in MY board's freshly-flipped row by column index, re-querying each
// beat so a board repaint mid-payout never targets a detached node. MY board is the
// first .player-board (renderBoards orders me first, no .spectator).
function getMyFreshTile(colIndex) {
  const myBoard = document.querySelector("#boards .player-board:not(.spectator)");
  if (!myBoard) return null;
  const rows = myBoard.querySelectorAll(".grid .grid-row");
  // The fresh row is the last one carrying a played guess (it has .tile.reveal or a
  // colored tile). Walk from the bottom to find the most-recently-filled row.
  for (let r = rows.length - 1; r >= 0; r--) {
    const tiles = rows[r].querySelectorAll(".tile");
    const filled = tiles[0] && (tiles[0].classList.contains("reveal") ||
      tiles[0].classList.contains("green") || tiles[0].classList.contains("yellow") ||
      tiles[0].classList.contains("gray"));
    if (filled) return tiles[colIndex] || null;
  }
  return null;
}
const REVEAL_STAGGER_MS = window.WordulMotion?.revealStaggerMs ?? 110;
const REVEAL_FLIP_HALF_MS = window.WordulMotion?.flipHalfMs ?? 200; // matches the tile-reveal keyframe halfway point (0.4s flip)

function showRoom(owner, slug) {
  leaveRoom(); // tear down any prior room's socket so room->room nav can't leave a zombie WS
  game.owner = owner;
  game.slug = slug;
  game.path = `${owner}/${slug}`;
  game.name = slug.replace(/-/g, " ");
  game.snapshot = null;
  game.pending = "";
  game.hasShownEndStats = false;
  game.lastChatLen = 0;
  game.unreadChat = 0;
  game.chatCollapsed = false;
  game.lastGuessCounts = new Map();
  game.typing = new Map();
  game.autoStart = false;
  game.publicArena = false; // never carry a public-host intent into the next room
  // Arena origin: the pending flag (set at entry) OR a sessionStorage marker (survives a
  // mid-game refresh, which loses the in-memory flag). Persist it so a reload still resolves
  // the Arena end screen. seed is stripped from snapshots, so origin can't be read off the wire.
  game.fromArena = pendingArenaOrigin || sessionStorage.getItem("arena:" + game.path) === "1";
  pendingArenaOrigin = false;
  if (game.fromArena) { try { sessionStorage.setItem("arena:" + game.path, "1"); } catch {} }
  game.roomTab = "play";
  game.shareImage = null;
  game.replay = [];
  game.payingOut = false;
  // tpl-room mounts a FRESH #hacklog node, so drop any stale terminal bound to the
  // previous room's (now-detached) element — it's re-created lazily on first payout.
  hacklog = null;
  mount("tpl-room");
  renderRoomHeader();
  $("#startBtn").addEventListener("click", () => {
    const snap = game.snapshot;
    if (snap && snap.isDuel) {
      const meP = snap.players.find((p) => p.username === getUsername());
      send({ type: "ready", ready: !(meP && meP.ready) });
    } else {
      send({ type: "start" });
    }
  });
  $("#rematchBtn").addEventListener("click", () => {
    const snap = game.snapshot;
    if (snap && snap.isDuel) {
      // Duel: the between-rounds button readies up for the next KOTH round (no rematch handshake).
      const meP = snap.players.find((p) => p.username === getUsername());
      send({ type: "ready", ready: !(meP && meP.ready) });
    } else {
      proposeRematch();
    }
  });
  wireChat();
  wireRoomTabs();
  buildKeyboard($("#keyboard"), resolvedLayoutId(), keyboardHandlers);
  connect();
}

// A challenge link (/c/<id>): solo board on the owner's exact word, racing their
// standing record. Reuses the room engine via a per-player challenge WS.
async function showChallenge(id) {
  // Gate: a challenge WS needs a username (it's the player's identity + score key).
  if (!getUsername()) { showChallengeEntry(id); return; }
  let meta;
  try {
    const res = await fetch(`/api/challenge/${id}/meta`);
    if (!res.ok) throw new Error("gone");
    meta = await res.json();
  } catch {
    toast("That challenge link has expired.", { error: true, duration: 3000 });
    navigate("/");
    return;
  }
  // Stand up the room view (same engine; challenge chrome instead of owner/slug).
  leaveRoom();
  game.challengeId = id;
  game.challengeMeta = meta;
  game.owner = meta.owner;
  game.slug = null;
  game.path = null;
  game.name = `@${meta.owner}'s challenge`;
  game.snapshot = null;
  game.pending = "";
  game.hasShownEndStats = false;
  game.lastChatLen = 0;
  game.unreadChat = 0;
  game.chatCollapsed = false;
  game.lastGuessCounts = new Map();
  game.typing = new Map();
  game.autoStart = true; // challenge boards go live immediately — no lobby ceremony
  game.roomTab = "play";
  game.shareImage = null;
  game.replay = [];
  game.payingOut = false;
  hacklog = null;
  mount("tpl-room");
  renderRoomHeader();
  wireChat();
  wireRoomTabs();
  buildKeyboard($("#keyboard"), resolvedLayoutId(), keyboardHandlers);

  const target = meta.record
    ? `${meta.record.username} holds the record at ${meta.record.score}`
    : `@${meta.owner} scored ${meta.ownerScore}`;
  toast(`Challenge from @${meta.owner} — ${target}. Beat it.`, { duration: 4200 });
  connectChallenge(id);
}

// No-username gate for a challenge link — pick a name, then resolve the challenge.
// Mirrors showRoomEntry's join flow.
function showChallengeEntry(id) {
  mount("tpl-home");
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  $("#homeGreeting").hidden = true;
  $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = "You've been challenged on Wordul.";
  $(".sub").textContent = "Pick a username to take the challenge.";

  const input = $("#usernameInput");
  input.value = getUsername();
  input.focus();
  const btn = $("#startPlayingBtn");
  const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = "Take the challenge →";
  const go = () => {
    const username = setUsername(input.value);
    if (username.length < 3) {
      input.focus();
      toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
      return;
    }
    showChallenge(id);
  };
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

// The Wordul of the Day: a SHARED room at daily/<date> (everyone joins the same DO).
// Reuses the room engine; daily chrome + the gated unlock are render()-driven.
function showDaily(date) {
  if (!getUsername()) { showDailyEntry(date); return; }
  document.title = `Wordul of the Day — ${date}`;
  showRoom("daily", date);                       // connects to /ws?room=daily/<date>
  game.isDaily = true; game.dailyDate = date;    // AFTER showRoom resets state (mirrors enterNewRoom's autoStart)
  // Morph target: the home's .daily-card grows into the play panel (View Transition).
  // Set synchronously after mount so the transition snapshot picks it up.
  const tabPlay = document.getElementById("tabPlay");
  if (tabPlay) tabPlay.style.viewTransitionName = "wotd-bloom";
  if (pendingDailySeed) { seedDailyOnce(pendingDailySeed); pendingDailySeed = null; }
}

// Username gate for a cold deep-link to /daily/<date> (the hub path already has a username).
function showDailyEntry(date) {
  mount("tpl-home");
  const hub = $("#hub"); if (hub) hub.hidden = true;
  $("#homeGreeting").hidden = true; $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = t("daily.entryTitle");
  $(".sub").textContent = t("daily.entrySub");
  const cta = $(".home-cta"); if (cta) cta.hidden = false;
  const input = $("#usernameInput"); input.value = getUsername(); input.focus();
  const btn = $("#startPlayingBtn"); const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = t("daily.entryCta");
  const play = () => {
    const u = setUsername(input.value);
    if (u.length < 3) { input.focus(); toast("Pick a username — at least 3 letters", { error: true, duration: 1800 }); return; }
    showDaily(date);
  };
  btn.addEventListener("click", play);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
}

// Today's Wordul — its own Stats page (premium, easy back). Real public aggregates
// only: played / solved / averages / guess distribution + the day's Studio title and
// "glow". Usernames are withheld by design, so the top-10 leaderboard is a fast-follow.
async function showDailyStats(date) {
  document.title = `Wordul — Stats · ${date}`;
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");
  const dShort = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const ed = getEdition(dayTheme(new Date(), EDITIONS.map((e) => e.id)));
  const glow = ed.companion?.lines?.idle?.[0] ?? "A quiet day on the board.";
  const screen = document.createElement("section");
  screen.className = "screen daily-stats-screen";
  screen.innerHTML = `
    <a href="/" class="link daily-stats-back" id="dailyStatsBack">← Home</a>
    <header class="daily-stats-head">
      <span class="daily-kicker">Today's Wordul · Stats</span>
      <h1 class="daily-stats-title">${dShort}</h1>
      <p class="daily-stats-studio">${ed.name} <span class="muted">· from the Studio</span></p>
      <p class="daily-stats-glow">${glow}</p>
    </header>
    <div class="daily-stats-body" id="dailyStatsBody"><p class="muted small">Loading today's numbers…</p></div>
    <h2 class="daily-stats-sub">Players</h2>
    <div class="daily-roster" id="dailyRoster"><p class="muted small">Loading players…</p></div>
    <a href="/feed" class="link lab-entry" id="dailyLabLink">🧠 See what the lab learned →</a>`;
  app.appendChild(screen);
  $("#dailyStatsBack").addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
  $("#dailyLabLink").addEventListener("click", (e) => { e.preventDefault(); navigate("/feed"); });
  let summary = null;
  try {
    const res = await fetch(`/api/science/daily/${date}`);
    if (res.ok) summary = await res.json();
  } catch (_) { /* offline / cold day — render the empty state */ }
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  renderDailyStatsBody(summary);
  void renderDailyRoster(date);
}

// Append the full ranked roster (names, gold, guesses, duration) below the aggregates.
// Source is the Room DO leaderboard (public usernames) — NOT the anonymized SCIENCE feed.
async function renderDailyRoster(date) {
  const me = getUsername();
  let full = null;
  try {
    const res = await fetch(`/api/daily/${date}/leaderboard?full=1&username=${encodeURIComponent(me)}`);
    if (res.ok) full = await res.json();
  } catch (_) { /* offline / cold day — show the empty line */ }
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  const host = $("#dailyRoster");
  if (!host) return;
  const view = computeRosterView(full, me);
  if (!view.rows.length) {
    host.innerHTML = `<p class="muted small">No finishers recorded.</p>`;
    return;
  }
  host.innerHTML = `<ul class="daily-roster-list">${view.rows.map((r) => {
    const u = String(r.username).replace(/[^a-z0-9_-]/gi, "");
    const dur = fmtDuration(r.durationMs);
    return `<li class="daily-roster-row${r.isYou ? " is-you" : ""}">
      <span class="daily-roster-rank">${r.rank}</span>
      <a class="daily-roster-name" href="/@${u}" data-profile="${u}">${r.isYou ? `you (@${u})` : `@${u}`}</a>
      <span class="daily-roster-gold">${goldValue(r.gold)}</span>
      <span class="daily-roster-guesses">${r.won ? `in ${r.guesses}` : "missed"}</span>
      ${dur ? `<span class="daily-roster-time">${dur}</span>` : ""}
    </li>`;
  }).join("")}</ul>`;
  host.querySelectorAll("a[data-profile]").forEach((a) => {
    a.addEventListener("click", (e) => { e.preventDefault(); navigate("/@" + a.getAttribute("data-profile")); });
  });
}

function renderDailyStatsBody(summary) {
  const body = $("#dailyStatsBody");
  if (!body) return;
  if (!summary || !summary.totals) {
    body.innerHTML = `<p class="muted daily-stats-empty">No numbers yet today — be the first to finish.</p>`;
    return;
  }
  const v = computeDailyStatsView(summary);
  const fmt = (n) => (n == null ? "—" : n.toLocaleString());
  const stat = (num, label) => `<div class="dstat"><div class="dstat-num">${num}</div><div class="dstat-label">${label}</div></div>`;
  const rows = v.distRows.filter((r) => r.count > 0).map((r) => {
    const pct = v.maxCount > 0 ? Math.round((r.count / v.maxCount) * 100) : 0;
    return `<div class="ddist-row"><span class="ddist-g">${r.guesses}</span><span class="ddist-bar" style="width:${Math.max(pct, 8)}%">${r.count}</span></div>`;
  }).join("");
  body.innerHTML = `
    <div class="dstat-grid">
      ${stat(fmt(v.played), "Played")}
      ${stat(v.winRate == null ? "—" : v.winRate + "%", "Solved")}
      ${stat(v.avgGuesses == null ? "—" : v.avgGuesses.toFixed(2), "Avg guesses")}
      ${stat(v.avgScore == null ? "—" : Math.round(v.avgScore).toLocaleString(), "Avg score")}
    </div>
    <h2 class="daily-stats-sub">Guess distribution</h2>
    <div class="ddist">${rows || '<p class="muted small">No solves yet.</p>'}</div>
    <p class="daily-stats-foot muted small">Failed today: ${fmt(v.losses)}</p>`;
}

// The Living Lab reader — human-readable, blog-style discoveries over the same
// /feed.json the worker serves crawlers. Built with textContent (XSS-safe), so the
// admin editorial intro and authored notes can't inject markup. View-models live in
// feed.js (unit-tested); these functions just fetch + paint into #app.
function showFeed() {
  document.title = "Wordul — The Living Lab";
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");
  const screen = document.createElement("section");
  screen.className = "screen lab-screen";
  const back = document.createElement("a");
  back.href = "/"; back.className = "link lab-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
  const head = document.createElement("header");
  head.className = "lab-head";
  const kicker = document.createElement("span"); kicker.className = "daily-kicker"; kicker.textContent = "The Living Lab";
  const h1 = document.createElement("h1"); h1.className = "lab-title"; h1.textContent = "Discoveries";
  const sub = document.createElement("p"); sub.className = "lab-sub muted"; sub.textContent = "Honest, privacy-preserving notes on how we all play — one day at a time.";
  head.append(kicker, h1, sub);
  const body = document.createElement("div"); body.className = "lab-body"; body.id = "labBody";
  const loading = document.createElement("p"); loading.className = "muted small"; loading.textContent = "Loading the latest discoveries…";
  body.appendChild(loading);
  screen.append(back, head, body);
  app.appendChild(screen);
  loadFeedStream();
}

async function loadFeedStream() {
  let feed = null;
  try { const res = await fetch("/feed.json"); if (res.ok) feed = await res.json(); } catch (_) { /* offline → empty state */ }
  if (parseRoute().kind !== "feed") return; // navigated away mid-fetch
  const body = $("#labBody"); if (!body) return;
  const v = computeFeedStreamView(feed);
  body.innerHTML = "";
  if (v.empty) {
    const empty = document.createElement("p");
    empty.className = "muted lab-empty";
    empty.textContent = "The lab hasn't published a discovery yet — play a few days and check back.";
    body.appendChild(empty);
    return;
  }
  for (const card of v.cards) {
    const a = document.createElement("a");
    a.className = "lab-card"; a.href = "/feed/" + card.date;
    a.addEventListener("click", (e) => { e.preventDefault(); navigate("/feed/" + card.date); });
    const h = document.createElement("h2"); h.className = "lab-card-title"; h.textContent = card.title; a.appendChild(h);
    if (card.intro) { const p = document.createElement("p"); p.className = "lab-card-intro"; p.textContent = card.intro; a.appendChild(p); }
    const more = document.createElement("span"); more.className = "lab-more"; more.textContent = "Read →"; a.appendChild(more);
    body.appendChild(a);
  }
}

async function showFeedPost(date) {
  document.title = "Wordul — Lab · " + date;
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");
  const screen = document.createElement("section");
  screen.className = "screen lab-screen lab-post-screen";
  const back = document.createElement("a");
  back.href = "/feed"; back.className = "link lab-back"; back.textContent = "← The Lab feed";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/feed"); });
  const body = document.createElement("div"); body.className = "lab-body"; body.id = "labPostBody";
  const loading = document.createElement("p"); loading.className = "muted small"; loading.textContent = "Loading…";
  body.appendChild(loading);
  screen.append(back, body);
  app.appendChild(screen);
  let post = null; let status = 0;
  try { const res = await fetch("/feed/" + date + ".json"); status = res.status; if (res.ok) post = await res.json(); } catch (_) { /* network error → message */ }
  if (parseRoute().kind !== "feed-post") return; // navigated away mid-fetch
  renderFeedPostBody(post, status);
}

function renderFeedPostBody(post, status) {
  const body = $("#labPostBody"); if (!body) return;
  body.innerHTML = "";
  if (!post) {
    const msg = document.createElement("p");
    msg.className = "muted lab-empty";
    msg.textContent = status === 404
      ? "This day's discovery isn't published yet — today's word is never spoiled. Check back tomorrow."
      : "Couldn't load this discovery. Please try again in a moment.";
    body.appendChild(msg);
    return;
  }
  const v = computeFeedPostView(post);
  const article = document.createElement("article"); article.className = "lab-post";
  const h1 = document.createElement("h1"); h1.className = "lab-post-title"; h1.textContent = v.title; article.appendChild(h1);
  if (v.intro) { const intro = document.createElement("p"); intro.className = "lab-post-intro"; intro.textContent = v.intro; article.appendChild(intro); }
  if (v.findings.length) {
    const ul = document.createElement("ul"); ul.className = "lab-findings";
    for (const f of v.findings) { const li = document.createElement("li"); li.textContent = f; ul.appendChild(li); }
    article.appendChild(ul);
  }
  for (const n of v.notes) {
    const aside = document.createElement("aside"); aside.className = "lab-note"; aside.dataset.pillar = n.pillar || "";
    const nt = document.createElement("h3"); nt.className = "lab-note-title"; nt.textContent = n.title || ""; aside.appendChild(nt);
    const np = document.createElement("p"); np.textContent = n.note || ""; aside.appendChild(np);
    if (n.citation) { const c = document.createElement("cite"); c.textContent = n.citation; aside.appendChild(c); }
    article.appendChild(aside);
  }
  body.appendChild(article);
}

// Connect the per-player challenge WS — an isolated solo room seeded with the
// challenge's pinned word. Username is guaranteed by showChallenge's gate.
function connectChallenge(id) {
  const username = getUsername();
  if (!username) { showChallengeEntry(id); return; }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?challenge=${id}&username=${encodeURIComponent(username)}`;
  openSocket(url);
}

// Hand the player the invite link with minimum ceremony: native share sheet on
// mobile, clipboard + a clear toast on desktop. Used by the lobby invite button
// AND auto-fired right after "Invite friend" creates a room, so sharing is the
// first thing that happens — no hunting for a button. MUST be called inside a
// user-gesture call stack (a click) for navigator.share to be allowed.
async function shareRoomInvite() {
  const inviteUrl = `${location.origin}/@${game.owner}/${game.slug}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: `Wordul — ${game.name || game.slug}`,
        text: `Race me on Wordul in ${game.owner}'s room!`,
        url: inviteUrl,
      });
      return;
    } catch (e) {
      // User cancelled → done. Real error → fall through to clipboard.
      if (e && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(inviteUrl);
    toast("Link copied — send it to a friend!", { duration: 2400 });
  } catch {
    prompt("Copy this link:", inviteUrl);
  }
}

// Render the room name. The name IS the share affordance — tapping it copies the
// room link. Rename + invite live in the avatar hub now (nothing lost, just moved).
function renderRoomHeader() {
  const nameEl = $("#roomName");
  if (nameEl) {
    nameEl.textContent = game.name || game.slug;
    nameEl.onclick = copyRoomLink;
  }
  renderHeaderIdentity();
  renderGoldHud();
  renderH2HBadge();
}

// Copy the room link with a subtle confirmation. The whole share/copy surface
// collapsed into one gesture: tap the name.
async function copyRoomLink() {
  const url = `${location.origin}/@${game.owner}/${game.slug}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied ✓", { duration: 1200 });
  } catch {
    prompt("Copy this link:", url);
  }
}

// The immersive in-game header (C5) shows username + gold beside the avatar. The
// username sits in #roomHeader; renderGoldHud appends #goldHud after it. Only shown
// in a room (cleared on home/profile via clearHeaderIdentity).
function renderHeaderIdentity() {
  const header = $("#roomHeader");
  if (!header) return;
  let nameEl = $("#headerName");
  if (!nameEl) {
    nameEl = document.createElement("span");
    nameEl.id = "headerName";
    nameEl.className = "header-name";
    header.prepend(nameEl);
  }
  const u = getUsername();
  nameEl.textContent = "";
  if (u) nameEl.appendChild(userLink(u, { at: true }));
  nameEl.hidden = !u;
}

// Strip the in-room identity (username + gold) from the topbar header when we leave
// a room, so home/profile show just the avatar.
function clearHeaderIdentity() {
  const header = $("#roomHeader");
  if (header) header.textContent = "";
}

// Rename the current room. Shared (anyone present can rename) and reachable from
// both the ✎ button (lobby/finished) and the avatar hub (during play).
function renameRoom() {
  const next = prompt("Rename this room:", game.name || game.slug);
  if (next == null) return;
  const clean = next.replace(/[\x00-\x1f\x7f<>]/g, "").trim().slice(0, 40);
  if (!clean) return;
  send({ type: "rename", name: clean });
}

// Reveal + scroll to the scoreboard. It's hidden mid-play; the hub un-hides it
// (clearing the playing-state gate) and scrolls it into view so it isn't orphaned.
function scrollToScoreboard() {
  const sb = $("#scoreboard");
  if (!sb) return;
  if (game.snapshot && (game.snapshot.scoreboard || []).length === 0) {
    toast("No scores yet — finish a round!", { duration: 1600 });
    return;
  }
  sb.classList.add("hub-reveal"); // overrides the body.playing hide for this peek
  sb.hidden = false;
  sb.scrollIntoView({ behavior: getSettings().reducedMotion ? "auto" : "smooth", block: "center" });
}

// --- Edition: gold HUD + companion personality ---
// Gold economy (constants, combo, payout, HUD, coin-rain) lives in /gold.js.
// celebrateCombo stays here because it depends on app-local playChime + toast.

// A satisfying combo flourish: ascending arpeggio + a "✦ N× COMBO" toast.
function celebrateCombo(discoveries, mult) {
  playChime([[523, 0], [659, 0.08], [784, 0.16], [1047, 0.26]]);
  toast(`✦ ${mult}× COMBO · ${discoveries} in one shot`, { duration: 1600 });
}

// Surface the active edition's companion line for an event, reusing the toast.
function showCompanion(event, ctx = {}) {
  const { text, raw, tier, speak } = companionReact(event, ctx);
  if (!text) return;
  // The written toast is opt-out via Settings → Companion comments. Voice is governed
  // separately by the 🔊 sound mute (wordul.muted), so the two channels stay independent.
  if (getSettings().companionComments) {
    // Big moments linger; routine lines stay snappy.
    const big = tier && !(event === "wrong" && tier === "normal");
    toast(text, { duration: big ? 4200 : 3200 });
  }
  // The wipe aside is text-only — it fires often enough that voicing it would grate.
  if (!speak || event === "wipe") return;
  // Templated lines (the loss reveal) split across Yan's voice + the robot.
  if (raw.includes("{answer}")) speakTemplated(VOICE_EDITION, raw, ctx);
  else speakLine(VOICE_EDITION, raw, text);
}

// --- Idle taunts: the companion checks in when you go quiet mid-game. ---
let idleTimer = null;
const IDLE_FIRST_MS = 180000; // 3 min of silence before the companion checks in
const IDLE_REPEAT_MS = 180000; // …and every 3 min after that

function isMyTurn() {
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  return !!(game.snapshot && game.snapshot.phase === "playing" && me && me.status === "playing");
}
function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
function armIdle(delay = IDLE_FIRST_MS) {
  clearIdle();
  if (!isMyTurn()) return;
  idleTimer = setTimeout(() => {
    if (!isMyTurn()) { clearIdle(); return; } // re-check at fire time
    showCompanion("idle");
    armIdle(IDLE_REPEAT_MS);
  }, delay);
}
function resetIdle() { armIdle(IDLE_FIRST_MS); }

// C4: the 💀 give-up escape hatch is intentionally NOT eager — quitting should only be
// an option once you've genuinely been grinding. It surfaces after 3 minutes in a round
// (this timer) OR after too many mistakes (errorCount threshold in powerups.js). The idle
// nudge only shows the companion now; it no longer reveals give-up.
let giveUpTimer = null;
const GIVE_UP_AFTER_MS = 180000; // 3 min into the round before 💀 appears
function clearGiveUpTimer() { if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; } }
function armGiveUpTimer() {
  clearGiveUpTimer();
  if (!isMyTurn()) return;
  giveUpTimer = setTimeout(() => {
    if (isMyTurn()) surfaceGiveUp(powerupsCtx);
  }, GIVE_UP_AFTER_MS);
}

// SPA navigation: pushState + re-dispatch the router.
function navigate(path) {
  stopArenaPoll(); // any route change tears down the Arena open-games poll
  history.pushState(null, "", path);
  route();
}

// The Arena (bots-in-PvP) open-games poll handle. mountArenaList returns a stop() we MUST
// call on teardown (Back, row-tap → navigate, or any nav) so the 8s poll can't leak.
let arenaPollStop = null;
function stopArenaPoll() {
  if (arenaPollStop) { arenaPollStop(); arenaPollStop = null; }
}

// The Arena: open games anyone can jump into — bots now, public human rooms too (a host
// opts in via "Host a public game"). Rendered into #hubContent (home stays mounted); Back
// restores the launcher. Distinct from Head-to-head, which makes a private invite-link room.
// Direct load / refresh of /arena: the Arena view lives inside the home hub (#hubContent),
// so mount home first and let maybeOpenArena() open the Arena once the hub renders. The
// pendingOpenArena one-shot is the same hook the "join next → none waiting" fallback uses.
function showArenaRoute() {
  pendingOpenArena = true;
  leaveRoom();
  showHome();
}

function showArena() {
  const content = document.getElementById("hubContent");
  if (!content) return;
  // The Arena is a real, refresh-survivable route — reflect it in the URL (replace, not push,
  // so it doesn't pile a history entry on top of the hub the user is already standing on).
  history.replaceState(null, "", "/arena");
  stopArenaPoll();
  content.innerHTML =
    `<section class="hub-panel arena-view">
      <button id="arenaBack" class="hub-textlink" type="button">← Back</button>
      <h1 class="pvp-title">Arena</h1>
      <p class="arena-blurb muted">Jump into an open game — beat a worduler or take on whoever's waiting.</p>
      <div id="arenaList" class="arena-mount"></div>
      <button id="arenaHost" class="btn block">Host a public game →</button>
    </section>`;
  const back = document.getElementById("arenaBack");
  if (back) back.addEventListener("click", () => { stopArenaPoll(); navigate("/"); });
  const host = document.getElementById("arenaHost");
  if (host) host.addEventListener("click", () => { stopArenaPoll(); enterNewRoom({ autoStart: false, publicArena: true }); });
  arenaPollStop = mountArenaList(document.getElementById("arenaList"), {
    onJoin: (routePath) => { pendingArenaOrigin = true; navigate(routePath); }, // navigate() calls stopArenaPoll()
  });
}

// --- Arena end-screen actions (the "keep playing the Arena" set) --------------
// "Join next game →": jump straight to the next waiting open game (not the one just
// played). If nothing else is waiting, fall back to the Arena list on the home hub.
function joinNextArena() {
  const current = `/@${game.owner}/${game.slug}`;
  fetch("/api/arena/open")
    .then((r) => (r.ok ? r.json() : []))
    .then((games) => {
      const next = pickNextGame(games, current);
      closeStats();
      if (next) { pendingArenaOrigin = true; navigate(next); }
      else { pendingOpenArena = true; navigate("/"); } // none waiting → open the Arena list
    })
    .catch(() => { closeStats(); pendingOpenArena = true; navigate("/"); });
}

// "Create your own game": leave this finished room and host a fresh public Arena room,
// listed in the open-games index for the next person (or bot) to join.
function hostPublicArena() {
  closeStats();
  enterNewRoom({ autoStart: false, publicArena: true });
}

// "Main menu": close out to the home hub (route() handles leaveRoom + home render).
function backToMenu() {
  closeStats();
  navigate("/");
}

// After the home hub renders, open straight into the Arena list if a flow requested it
// (the "Join next → none waiting" fallback). One-shot; #hubContent only exists post-render.
function maybeOpenArena() {
  if (!pendingOpenArena) return;
  pendingOpenArena = false;
  showArena();
}

// Render a username as a clickable link to their public profile (/@username).
// Single source of truth so every @handle — greeting, chat, scoreboard, player
// boards, owner byline — is a one-tap hop to that player. The name goes through
// textContent (XSS-safe); the click stays in the SPA via navigate().
function userLink(username, { at = false, suffix = "" } = {}) {
  const a = document.createElement("a");
  a.className = "userlink";
  a.href = `/@${username}`;
  a.textContent = (at ? "@" : "") + username + suffix;
  a.addEventListener("click", (e) => { e.preventDefault(); navigate(`/@${username}`); });
  return a;
}

function wireChat() {
  const form = $("#chatForm");
  const input = $("#chatInput");
  const toggle = $("#chatToggle");
  const closeBtn = $("#chatCloseBtn");
  const backdrop = $("#chatBackdrop");
  const topBtn = $("#chatTopBtn");

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = (input.value || "").trim();
      if (!text) return;
      send({ type: "chat", text });
      input.value = "";
    });
  }

  // Desktop toggle: collapse/expand inline panel. Pointer events on the inner X close
  // button still need to reach the close handler, so stop propagation there.
  if (toggle) {
    toggle.addEventListener("click", (e) => {
      if (e.target?.id === "chatCloseBtn") return;
      // On mobile we use the X close button — toggle taps in the header bar still close the sheet.
      if (isMobile()) {
        closeChatSheet();
        return;
      }
      game.chatCollapsed = !game.chatCollapsed;
      const panel = $("#chatPanel");
      panel?.classList.toggle("collapsed", game.chatCollapsed);
      toggle.setAttribute("aria-expanded", String(!game.chatCollapsed));
      if (!game.chatCollapsed) {
        game.unreadChat = 0;
        updateChatBadge();
        scrollChatToBottom();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeChatSheet();
    });
  }
  if (backdrop) backdrop.addEventListener("click", closeChatSheet);
  // Visibility is owned by render() (gated on player count); we just wire the tap.
  if (topBtn) {
    topBtn.onclick = openChatSheet;
  }
}

function isMobile() {
  return window.matchMedia("(max-width: 520px)").matches;
}

function openChatSheet() {
  if (!isMobile()) return;
  const panel = $("#chatPanel");
  const backdrop = $("#chatBackdrop");
  if (!panel) return;
  panel.classList.add("sheet-open");
  backdrop?.classList.add("sheet-open");
  backdrop?.removeAttribute("hidden");
  // Mark read — flush the unread badge.
  game.unreadChat = 0;
  game.chatCollapsed = false;
  updateChatBadge();
  scrollChatToBottom();
  // Focus the input for immediate typing (deferred so iOS doesn't fight the animation).
  setTimeout(() => $("#chatInput")?.focus(), 280);
}

function closeChatSheet() {
  const panel = $("#chatPanel");
  const backdrop = $("#chatBackdrop");
  panel?.classList.remove("sheet-open");
  backdrop?.classList.remove("sheet-open");
  setTimeout(() => backdrop?.setAttribute("hidden", ""), 240);
  $("#chatInput")?.blur();
}

// Reconnect tuning. The philosophy is "premium silent recovery": the first retry is
// near-instant, backoff is gentle-but-capped so a flapping/restarting server is never
// hammered, and we NEVER surface a stark error toast — most drops (dev hot-reload, a
// backgrounded mobile tab, a signal blip) resolve in well under a second and the player
// sees nothing at all. A calm glass pill only appears for a genuinely sustained outage.
const RECONNECT_FIRST_MS = 250;      // first retry — fast enough to feel instant
const RECONNECT_MAX_MS = 6_000;      // backoff ceiling; we keep trying forever, but politely
const RECONNECT_NOTICE_AFTER_MS = 2_600; // only show the (gentle) pill past this much downtime
const HEARTBEAT_MS = 20_000;         // keep the DO path warm
const PONG_TIMEOUT_MS = 8_000;       // no pong in this window ⇒ socket is a zombie, recycle it

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?room=${encodeURIComponent(game.path)}`;
  openSocket(url);
}

// Open (and auto-reconnect) a game WebSocket to `url`, wiring the shared hello /
// snapshot / heartbeat handlers. Used by both the room path (connect) and the
// challenge path (connectChallenge); reconnect re-opens the SAME url.
function openSocket(url) {
  const ws = new WebSocket(url);
  const session = { ws, reconnect: true };
  game.socketSession = session;
  game.ws = ws;

  ws.addEventListener("open", () => {
    if (game.socketSession !== session) return; // superseded by leaveRoom() / a newer socket
    // We're back — drop any reconnecting UI and reset backoff so the next blip is fast again.
    game.reconnectAttempts = 0;
    game.pendingReconnect = null;
    clearReconnectNotice();
    setConnectionStatus("ok");
    send({
      type: "hello",
      username: getUsername(),
      wordLength: getPreferredLength(),
      edition: getActiveEditionId(), // seeds a fresh room with the creator's theme
      mode: "race", // only valid selectable mode today
      scienceOptOut: !getSettings().communityScience,
      public: game.publicArena === true, // host opted into the public Arena open-games list
      sessionToken: getSessionToken() || undefined, // P0 auth seam; absent for unsecured names
    });
    refreshGold(); // sync server-authoritative balance into HUD cache on join
    // Kick off heartbeat so the path stays warm.
    startHeartbeat();
  });

  ws.addEventListener("message", (e) => {
    if (game.socketSession !== session) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "pong") {
      clearTimeout(game.pongTimer); // heartbeat acked — connection is alive
      game.pongTimer = null;
      return;
    }
    onServerMessage(msg);
  });

  // A socket error always precedes/forces a close; close() makes the reconnect path fire.
  ws.addEventListener("error", () => { try { ws.close(); } catch {} });

  ws.addEventListener("close", () => {
    // Stale or intentional close — leaveRoom() cleared socketSession/reconnect, or a
    // newer socket replaced this one. Reconnecting would resurrect a zombie WS that
    // streams snapshots into home/hub/profile where the room scaffold is gone.
    if (game.socketSession !== session || !session.reconnect) return;
    stopHeartbeat();
    scheduleReconnect(url, session);
  });
}

// Backoff scheduler. Captures the (url, session) so a later leaveRoom()/supersede can
// cancel us, and stashes a `pendingReconnect` handle so an online/focus event can pull
// the retry forward instead of waiting out the backoff.
function scheduleReconnect(url, session) {
  setConnectionStatus("reconnecting");
  game.pendingReconnect = { url, session };
  // Arm the gentle notice once. It only paints if we're still down after the grace window.
  if (!game.reconnectNoticeTimer && !document.querySelector(".net-pill")) {
    game.reconnectNoticeTimer = setTimeout(showReconnectNotice, RECONNECT_NOTICE_AFTER_MS);
  }
  const attempt = game.reconnectAttempts++;
  // Exponential backoff with ±30% jitter; first attempt is near-instant.
  const capped = Math.min(RECONNECT_FIRST_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const delay = attempt === 0 ? RECONNECT_FIRST_MS : capped * (0.7 + Math.random() * 0.6);
  clearTimeout(game.reconnectTimer);
  game.reconnectTimer = setTimeout(() => {
    game.reconnectTimer = null;
    if (game.socketSession !== session || !session.reconnect) return;
    openSocket(url);
  }, delay);
}

// Pull a pending reconnect forward — fired when the network returns or the tab regains
// focus. Network's back, so reset backoff and retry immediately instead of idling.
function reconnectNow() {
  const pending = game.pendingReconnect;
  if (!pending) return;
  const { url, session } = pending;
  if (game.socketSession !== session || !session.reconnect) return;
  if (game.ws && (game.ws.readyState === WebSocket.OPEN || game.ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(game.reconnectTimer);
  game.reconnectTimer = null;
  game.reconnectAttempts = 0;
  openSocket(url);
}

function startHeartbeat() {
  stopHeartbeat();
  game.heartbeatTimer = setInterval(() => {
    const ws = game.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "ping" })); } catch { return; }
    // Watchdog: a socket can read OPEN while the underlying path is dead (half-open TCP,
    // sleeping radio). If the pong doesn't land, close it so the reconnect loop kicks in.
    clearTimeout(game.pongTimer);
    game.pongTimer = setTimeout(() => {
      game.pongTimer = null;
      try { ws.close(); } catch {}
    }, PONG_TIMEOUT_MS);
  }, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (game.heartbeatTimer) {
    clearInterval(game.heartbeatTimer);
    game.heartbeatTimer = null;
  }
  if (game.pongTimer) {
    clearTimeout(game.pongTimer);
    game.pongTimer = null;
  }
}

function setConnectionStatus(state) {
  // Ambient cue only: the brand dot breathes in the accent color while reconnecting —
  // calm, on-brand, never alarming. The explicit signal (for sustained outages) is the pill.
  const dot = document.querySelector(".brand-dot");
  if (!dot) return;
  if (state === "ok") {
    dot.style.color = "";
    dot.style.animation = "";
  } else {
    dot.style.color = "var(--accent)";
    dot.style.animation = "pulse 1.6s ease-in-out infinite";
  }
}

// The gentle reconnect notice — a frosted glass pill, not the stark error toast. Only ever
// shown when an outage outlasts RECONNECT_NOTICE_AFTER_MS; removed the instant we're back.
function showReconnectNotice() {
  game.reconnectNoticeTimer = null;
  if (document.querySelector(".net-pill")) return;
  const pill = document.createElement("div");
  pill.className = "net-pill";
  pill.innerHTML = '<span class="net-pill-dot"></span><span>Reconnecting…</span>';
  document.body.appendChild(pill);
}
function clearReconnectNotice() {
  clearTimeout(game.reconnectNoticeTimer);
  game.reconnectNoticeTimer = null;
  const pill = document.querySelector(".net-pill");
  if (pill) {
    pill.classList.add("net-pill-out");
    setTimeout(() => pill.remove(), 240);
  }
}

// Register once: the OS/browser tells us exactly when recovery is possible. Reacting to
// these beats waiting out a backoff timer — flip back to the tab and you're already in.
addEventListener("online", reconnectNow);
addEventListener("focus", reconnectNow);
document.addEventListener("visibilitychange", () => { if (!document.hidden) reconnectNow(); });

function send(msg) {
  if (game.ws && game.ws.readyState === WebSocket.OPEN) {
    game.ws.send(JSON.stringify(msg));
  }
}

// Pull the server-authoritative gold balance into the HUD cache. The server (USER
// ledger) is the source of truth; localStorage is just a display mirror now.
function refreshGold() {
  const name = getUsername();
  if (!name) return;
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (!p) return;
      if (typeof p.gold === "number") { setGold(p.gold); renderGoldHud(); }
      // Cache the head-to-head map so the in-room badge can show "You vs <opp> W–L".
      // It only ever contains personas (the server writes h2h for seeded rooms only), so
      // looking up a live opponent's username naturally scopes the badge to bot rooms.
      game.myH2H = p.h2h || {};
      renderH2HBadge();
    })
    .catch(() => {});
}

// In-room head-to-head record against the current opponent, shown beside the room name.
// Keyed off the opponent's VISIBLE username (no bot-only field on the wire) — present in
// game.myH2H only for personas the player has faced before.
function renderH2HBadge() {
  const nameEl = $("#roomName");
  if (!nameEl) return;
  let badge = $("#roomH2H");
  const snap = game.snapshot;
  const me = getUsername();
  const h2h = game.myH2H || {};
  let text = "";
  if (snap && me) {
    const opp = (snap.players || []).find((p) => p.username !== me);
    const rec = opp && h2h[opp.username];
    if (rec) {
      const oppName = opp.username.charAt(0).toUpperCase() + opp.username.slice(1);
      text = `You vs ${oppName} ${rec.w}–${rec.l}`;
    }
  }
  if (!text) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "roomH2H";
    badge.className = "room-h2h";
    nameEl.insertAdjacentElement("afterend", badge);
  }
  badge.textContent = text;
}

function onServerMessage(msg) {
  if (msg.type === "snapshot") {
    const prev = game.snapshot;
    game.snapshot = msg.room;
    // Live-typing ghosts are transient: drop a player's ghost the moment they commit a guess
    // (their row advanced) or leave the race (won / out / away), so no phantom fill lingers on
    // the new empty row. Done here, before render(), so the board never flashes a stale ghost.
    if (game.typing.size) {
      for (const p of msg.room.players) {
        const before = prev?.players.find((q) => q.username === p.username);
        const committed = before && p.guesses.length > before.guesses.length;
        if (committed || p.status !== "playing" || !p.connected) game.typing.delete(p.username);
      }
    }
    // The room owns the theme: adopt it whenever it differs from what's applied. This is
    // how invitees inherit the host's theme and how a live change reaches everyone. applyEdition
    // also persists it locally, so your last room's vibe sticks into your next solo game.
    const wantEd = game.isDaily
      ? (msg.room.edition && msg.room.edition !== "default" ? msg.room.edition : getActiveEditionId())
      : msg.room.edition;
    if (wantEd && wantEd !== getActiveEditionId()) { applyEdition(wantEd); applySettings(getSettings()); }
    // Vibe Studio: a curated daily ships a colorScheme — re-theme the whole day page from it
    // (a1 → --accent re-lights all the chrome; a1/a2/a3 atoms drive the bespoke palette layers).
    // Non-daily rooms and legacy days pass null → falls back to the active edition's own accent.
    applyColorScheme(game.isDaily ? msg.room.colorScheme : null);
    // EZ-mode hints belong to a single round — wipe them on any new round (start,
    // rematch, or reconnecting into a different round).
    if (msg.room.phase === "playing" && msg.room.round !== game.ezRound) {
      resetRound(msg.room.round);
    }
    // "Start playing" one-shot: kick off the solo game as soon as we're in the
    // lobby. Cleared immediately so a reconnect (which replays a snapshot) can't
    // re-trigger it, and lobby-gated so it never fires mid-game.
    if (game.autoStart && msg.room.phase === "lobby") {
      game.autoStart = false;
      // In a duel room, auto-start goes through the ready-gate so solo still gets the 3-2-1.
      send(msg.room.isDuel ? { type: "ready", ready: true } : { type: "start" });
    }
    // Duel 3-2-1 overlay: enter on the move into countdown, leave when it exits.
    if (prev?.phase !== "countdown" && msg.room.phase === "countdown" && msg.room.goAt) {
      startCountdownOverlay(msg.room.goAt);
    } else if (prev?.phase === "countdown" && msg.room.phase !== "countdown") {
      stopCountdownOverlay();
    }
    // Synchronized start celebration: any transition INTO playing (fresh start or
    // rematch) fires GO! + confetti. Driven by the shared snapshot, so it lands on
    // every player's screen at once. Late joiners (prev === null) don't get it.
    if (prev && prev.phase !== "playing" && msg.room.phase === "playing") {
      triggerStartCelebration();
      resetIdle();
      armGiveUpTimer(); // 💀 give-up only unlocks 3 min into the round
    }
    const me = msg.room.players.find((p) => p.username === getUsername());
    const prevMe = prev?.players.find((p) => p.username === getUsername());
    renderH2HBadge(); // opponent may have just joined; refresh the "You vs X W–L" badge
    // Server accepted our guess → clear pending letters.
    if (me && prevMe && me.guesses.length > prevMe.guesses.length) {
      game.pending = "";
      // A valid guess landed. If it didn't end the game, the companion reacts —
      // and in Yang's edition, new greens get a scaled celebration instead.
      if (me.status === "playing" && !game.hasShownEndStats) {
        // Gold flows on progress for EVERY edition: new greens + yellows pay out, with
        // a combo multiplier for multiple hits in one shot. Clearer wins: instead of one
        // lump coin-burst, we SEQUENCE the payout — yellows first, then greens, each its
        // own beat (glow + "+N" floater + HUD tick + ascending chime + a hacker-log line),
        // then a "✦ N× COMBO" finale lands the multiplier last. The TOTAL is identical to
        // the old lump Math.round((ng*green + ny*yellow)*mult); only the timing is staged.
        const discoveryList = orderedDiscoveriesInLast(me.guesses).map((d) => ({
          ...d,
          value: d.kind === "green" ? GOLD.green : GOLD.yellow,
        }));
        const ng = discoveryList.filter((d) => d.kind === "green").length;
        const ny = discoveryList.filter((d) => d.kind === "yellow").length;
        const discoveries = discoveryList.length;
        const mult = comboMultiplier(discoveries);
        const base = discoveryList.reduce((s, d) => s + d.value, 0);
        const total = Math.round(base * mult); // ← exactly the old `earned`
        const bonus = total - base;
        const guessIndex = me.guesses.length - 1;
        const flipDoneMs = me.guesses[guessIndex].word.length * REVEAL_STAGGER_MS + REVEAL_FLIP_HALF_MS;

        // Loss penalty (C2): reusing a known-dead letter (proven wrong by a PRIOR guess,
        // duplicate-letter safe) drains gold per wasted letter, capped per guess. Repeat
        // the SAME mistake and it escalates via game.deadLetterReuse. We read-then-increment
        // the Map NOW (deterministic, once per accepted guess); the drain itself is deferred
        // so it lands AFTER the win payout finishes — never racing the HUD tween.
        const wasted = wastedDeadLettersInLast(me.guesses);
        let penalty = 0;
        const penaltyLines = [];
        for (const letter of wasted.letters) {
          const reuse = game.deadLetterReuse.get(letter) ?? 0;
          const pen = escalatedPenalty(GOLD.wastedLetterPenalty, reuse);
          penalty += pen;
          penaltyLines.push(`wasted  ${letter}  −${pen}`);
          game.deadLetterReuse.set(letter, reuse + 1);
        }
        penalty = Math.min(penalty, GOLD.wastedCapPerGuess);
        // Drain + red log lines. Caller owns the line text; goldDrain stays generic.
        if (penalty > 0) game.goldThisRound = (game.goldThisRound || 0) - penalty;
        const runDrain = () => {
          if (penalty <= 0) return;
          if (!game.snapshot || game.hasShownEndStats) return; // game ended / left room — don't drain off-screen
          const reducedMotion = getSettings().reducedMotion;
          goldDrain(penalty, reducedMotion, playChime);
          const log = getHacklog();
          for (const line of penaltyLines) log?.logLine(line, { tone: "loss" });
          mistakeFx(activeMistakeFx(), wasted.letters); // sensory punishment for the sloppy reuse (room-themed)
          checkBankruptcy(powerupsCtx); // C4: a wasted-letter drain may bankrupt Hard Mode
        };

        if (discoveries > 0) {
          const balanceBefore = getGold();
          // Record the structured replay entry up front (deterministic: balanceAfter =
          // before + total, since the sequence awards exactly `total`). Persisted now so
          // a refresh/end-screen can render "your run, line by line" even mid-payout.
          recordReplayEntry({
            guessIndex,
            events: discoveryList.map((d) => ({
              kind: d.kind, index: d.index, letter: d.letter, delta: d.value,
            })),
            combo: { discoveries, mult, bonus },
            balanceAfter: balanceBefore + total,
          });
          game.goldThisRound = (game.goldThisRound || 0) + total;
          const reducedMotion = getSettings().reducedMotion;
          const log = getHacklog();
          // Start the payout after the row finishes flipping, so coins land as colors do.
          // payingOut is flipped on INSIDE the deferred callback (not now): setting it
          // before this snapshot's render() would make renderBoards preserve my OLD board
          // and skip drawing the freshly-flipped colored row — so colors wouldn't appear
          // until the whole payout finished. By the time the payout starts the colors are
          // already revealed, and the guard still protects the coin-floater animations.
          deferPayout(() => {
            game.payingOut = true;
            playPayoutSequence({
              discoveries: discoveryList,
              mult,
              hud: $("#goldHud"),
              getTile: getMyFreshTile,
              log,
              playChime,
              celebrateCombo,
              reducedMotion,
            }).finally(() => {
              game.payingOut = false;
              // Drain AFTER the award sequence resolves so the two HUD tweens never race
              // on the same #goldHud (animateCount has no cancel guard). A short beat lets
              // the win land before the loss bites.
              if (penalty > 0) deferPayout(runDrain, 350);
              if (log) deferPayout(() => log.collapse(), penalty > 0 ? 1100 : 700);
            });
          }, flipDoneMs);
        } else if (penalty > 0) {
          // No discoveries this guess — no payout to wait on; drain once the row flips.
          deferPayout(runDrain, flipDoneMs);
        }
        // Never silent: every accepted guess resolves to exactly ONE companion event,
        // on EVERY edition. Yang's green confetti stays Yang-only + cosmetic; voice is global.
        const { event: guessEvent, ctx: guessCtx } = pickGuessEvent(ng, ny, wasted.letters.length > 0);
        if (getActiveEditionId() === "yang" && guessEvent === "greens") {
          setTimeout(() => celebrateGreens(ng), flipDoneMs); // celebrateGreens internally showCompanion("greens",{count})
        } else {
          setTimeout(() => showCompanion(guessEvent, guessCtx), flipDoneMs);
        }
        resetIdle();
      }
    }
    // Three ways the game ends from my perspective (the room may keep running for others):
    //   (a) phase transitions to finished (everyone is done)
    //   (b) I personally ran out of guesses while the room continues
    //   (c) I personally SOLVED it while the room continues — others race on for their gold
    // Each fires my end sequence (handleGameOver branches on won/lost).
    const phaseEnded = prev && prev.phase !== "finished" && msg.room.phase === "finished";
    const personallyLost = prevMe?.status === "playing" && me?.status === "lost";
    const personallyWon = prevMe?.status === "playing" && me?.status === "won";
    // Daily owns its OWN reveal (#dailyUnlock: goody + curated story + bridge), so the
    // generic stats/challenge/share modal must NOT also fire for daily — it would stack
    // over and bury the curated reveal.
    if ((phaseEnded || personallyLost || personallyWon) && !game.hasShownEndStats && !game.isDaily) {
      handleGameOver(msg.room);
    }
    if (msg.room.phase === "finished") refreshGold(); // reconcile persistent balance after cash-out
    // Daily rooms never globally "finish" (per-player async scoring) — so reconcile the
    // gold HUD the moment YOU personally complete, the same way the race path does on
    // finish, so the daily goody mint actually shows up in the HUD.
    if (game.isDaily && (personallyWon || personallyLost)) {
      refreshGold();
      captureDailySolve(game.dailyDate, me); // client-only — powers the home's letter stamp
    }
    render();
  } else if (msg.type === "invalid_guess") {
    // Letters are still in game.pending — we never cleared them. Shake the row and
    // toast prominently, but DON'T burn a guess slot. The gold is the cost (C2).
    flashShake();
    const reason = msg.reason || "not a word";
    toast(`${reason} — doesn't count, try again`, { error: true, duration: 2500 });
    showCompanion("invalid");
    // Only MY live turn is penalized: a late / duplicate / out-of-phase reject must not
    // silently subtract gold or inch me toward the 💀 offer with no visible cause.
    const meNow = game.snapshot?.players.find((p) => p.username === getUsername());
    if (!meNow || meNow.status !== "playing" || game.hasShownEndStats) return;
    // Penalty: a non-word submit drains gold + a red hacker-log line.
    // game.pending still holds the rejected letters (we never cleared them above).
    const rejected = (game.pending || "").toUpperCase();
    const reducedMotion = getSettings().reducedMotion;
    goldDrain(GOLD.invalidPenalty, reducedMotion, playChime);
    game.goldThisRound = (game.goldThisRound || 0) - GOLD.invalidPenalty;
    const log = getHacklog();
    log?.logLine(
      `rejected  ${rejected || reason}  −${GOLD.invalidPenalty}`,
      { tone: "loss" },
    );
    // C4: a rejected submit is an error (surfaces 💀 after enough) and a drain (may
    // tip Hard Mode into bankruptcy).
    bumpErrorCount(powerupsCtx);
    checkBankruptcy(powerupsCtx);
  } else if (msg.type === "typing") {
    // An opponent's live row length (anonymous — count only). Patch just their ghost row
    // in place; a full render() per keystroke would nuke in-flight board animations.
    if (msg.username && msg.username !== getUsername()) {
      const len = Math.max(0, msg.len | 0);
      if (len > 0) game.typing.set(msg.username, len);
      else game.typing.delete(msg.username);
      updateOpponentGhost(msg.username);
    }
  } else if (msg.type === "revealed_letter" || msg.type === "vowels") {
    handlePowerupMessage(powerupsCtx, msg);
  } else if (msg.type === "rematch_proposed") {
    if (msg.proposer !== getUsername()) renderRematchPrompt(msg.proposer);
  } else if (msg.type === "rematch_accepted") {
    game.hasShownEndStats = false;
    renderRematchIdle();
    closeStats();
  } else if (msg.type === "rematch_cancelled") {
    settleRematchHome(msg.reason, opponentName());
  } else if (msg.type === "error") {
    toast(msg.message || "Error", { error: true });
  }
}

// --- Render ---

// --- Room tabs (Play / Games / Players) ---
// Tabs are a between-games surface; active guessing stays immersive (board only,
// driven by body.playing). Off-play, the active tab gates the three panels.

function wireRoomTabs() {
  const tabs = $("#roomTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".room-tab").forEach((btn) => {
    btn.addEventListener("click", () => setRoomTab(btn.dataset.tab));
  });
  updateTabUI();
}

function setRoomTab(tab) {
  game.roomTab = tab;
  updateTabUI();
  applyTabVisibility(game.snapshot?.phase === "playing");
}

function updateTabUI() {
  $("#roomTabs")?.querySelectorAll(".room-tab").forEach((b) => {
    const on = b.dataset.tab === game.roomTab;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
  });
}

function applyTabVisibility(playing) {
  const play = $("#tabPlay"), games = $("#tabGames"), players = $("#tabPlayers");
  if (!play) return;
  if (playing) {
    // Immersive: board only. #tabPlayers wrapper stays present so the .playing CSS
    // (and its hub-reveal peek) keeps owning #scoreboard.
    play.hidden = false;
    games.hidden = true;
    players.hidden = false;
    return;
  }
  play.hidden = game.roomTab !== "play";
  games.hidden = game.roomTab !== "games";
  players.hidden = game.roomTab !== "players";
}

// The "underneath", revealed once you finish today's word: a goody line, the story behind
// the word, and a one-tap bridge back to the hub. Idempotent per snapshot.
// snap.story may be null (house day / World fetch failed) — goody + bridge still render.
function renderDailyUnlock(snap, me) {
  const box = $("#dailyUnlock");
  if (!box) return;
  const done = me && me.status !== "playing";
  box.hidden = !done;
  if (!done) return;
  // The curated day's name (vibeTitle) crowns the reveal — a palette-gradient hero on a
  // themed day (see .daily-vibe-title), inserted once above the goody. Absent on legacy days.
  if (snap.vibeTitle && !box.dataset.vibeTitled) {
    const h = document.createElement("h2");
    h.className = "daily-vibe-title";
    h.id = "dailyVibeTitle";
    h.textContent = snap.vibeTitle;
    box.insertBefore(h, box.firstChild);
    box.dataset.vibeTitled = "1";
  }
  const won = me.status === "won";
  // Only a CONFIRMED gold mint sets player.goldAwarded (a number). Drive both the
  // copy and the celebration off it — never claim/float gold the server didn't grant.
  const award = (me && typeof me.goldAwarded === "number") ? me.goldAwarded : 0;
  const goody = $("#dailyGoody");
  if (goody && !goody.dataset.filled) {
    const word = snap.word || "";
    goody.textContent = won
      ? (award > 0 ? t("daily.goodySolved", { word, gold: award }) : t("daily.goodySolvedNoGold", { word }))
      : (award > 0 ? t("daily.goodyMissed", { word, gold: award }) : t("daily.goodyMissedNoGold", { word }));
    if (won) goody.classList.add("is-win"); // gold halo (CSS) — solve only
    goody.dataset.filled = "1";
    // GOLD-FLIGHT: celebrate a confirmed gold solve once — bump the HUD + send a few
    // floaters rising toward it. Reuses the existing .gold-floater / gold-bump system;
    // skip entirely under reduced motion (the calm CSS appear covers that case), and
    // skip when the mint credited 0 (no coins for a zero/failed award).
    if (won && award > 0 && !getSettings().reducedMotion) celebrateDailyUnlock();
  }
  const story = $("#dailyStory");
  if (story && snap.story && !story.dataset.filled) {
    const kicker = document.createElement("span"); kicker.className = "daily-story-kicker"; kicker.textContent = t("daily.storyKicker");
    const h = document.createElement("h3"); h.textContent = snap.story.title || t("daily.storyFallbackTitle");
    const p = document.createElement("p"); p.textContent = snap.story.body || "";
    story.append(kicker, h, p);
    if (snap.story.tip) { const tip = document.createElement("p"); tip.className = "daily-tip"; tip.textContent = "💡 " + snap.story.tip; story.appendChild(tip); }
    story.dataset.filled = "1";
  }
  const bridge = $("#dailyBridgeBtn");
  if (bridge && !bridge.dataset.wired) {
    bridge.textContent = "▶ " + t("daily.keepPlaying");
    bridge.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); }); bridge.dataset.wired = "1";
  }
  const arch = $("#dailyArchiveLink");
  if (arch && !arch.dataset.wired) {
    arch.textContent = t("daily.browsePast");
    arch.addEventListener("click", (e) => { e.preventDefault(); navigate("/daily/archive"); }); arch.dataset.wired = "1";
  }
}

// The daily solve's gold-flight: pulse the gold HUD and float a few coins from the
// goody line up toward it. Pure presentation, reuses the room's existing gold-motion
// vocabulary (.gold-floater + .gold-hud.gold-bump). Caller guards reduced-motion.
function celebrateDailyUnlock() {
  const hud = $("#goldHud");
  if (hud) { hud.classList.remove("gold-bump"); void hud.offsetWidth; hud.classList.add("gold-bump"); }
  const goody = $("#dailyGoody");
  const origin = (goody || $("#dailyUnlock"))?.getBoundingClientRect();
  if (!origin) return;
  // a small, intentional flight — 5 coins, staggered, drifting up (the .gold-floater
  // keyframe rises and fades; that reads as coins lifting toward the HUD).
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const f = document.createElement("div");
      f.className = "gold-floater";
      f.textContent = "◆";
      f.style.left = `${origin.left + origin.width * (0.3 + Math.random() * 0.4)}px`;
      f.style.top = `${origin.top + origin.height * 0.5}px`;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 800);
    }, i * 90);
  }
}

function renderGames(snap) {
  const panel = $("#gamesPanel");
  if (!panel) return;
  panel.textContent = "";
  const frag = document.createDocumentFragment();

  if (snap.phase === "playing") {
    const names = snap.players.map((p) => p.username);
    frag.appendChild(gameRow({ live: true, solo: names.length === 1, names, result: "in progress" }));
  }
  const hist = Array.isArray(snap.history) ? snap.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const g = hist[i];
    const names = g.players.map((p) => p.username);
    const winnerP = g.players.find((p) => p.username === g.winner);
    const result = g.winner
      ? `${g.winner === getUsername() ? "you" : g.winner} · ${winnerP?.guesses ?? "?"}/${snap.maxGuesses}`
      : `no one · X/${snap.maxGuesses}`;
    frag.appendChild(gameRow({ live: false, solo: g.solo, names, result, when: relativeTime(g.finishedAt) }));
  }

  if (!frag.childNodes.length) {
    const empty = document.createElement("p");
    empty.className = "muted small games-empty";
    empty.textContent = "No games yet. Start one to begin this room's story.";
    panel.appendChild(empty);
    return;
  }
  panel.appendChild(frag);
}

function gameRow(g) {
  const row = document.createElement("div");
  row.className = "game-row" + (g.live ? " is-live" : "");

  const mode = document.createElement("span");
  mode.className = "game-mode";
  mode.dataset.mode = g.solo ? "solo" : "race";
  mode.textContent = g.solo ? "solo" : "race";
  row.appendChild(mode);

  const who = document.createElement("span");
  who.className = "game-who";
  who.textContent = g.names.map((n) => (n === getUsername() ? "you" : n)).join(g.solo ? "" : " vs ");
  row.appendChild(who);

  const res = document.createElement("span");
  res.className = "game-result";
  if (g.live) {
    const dot = document.createElement("span");
    dot.className = "live-dot";
    res.appendChild(dot);
  }
  res.appendChild(document.createTextNode(g.result));
  row.appendChild(res);

  if (g.when) {
    const when = document.createElement("span");
    when.className = "game-when";
    when.textContent = g.when;
    row.appendChild(when);
  }
  return row;
}

function render() {
  if (!game.snapshot) return;
  // A late snapshot can land after we've left the room view: tpl-room is unmounted
  // on home/hub/profile, so the room scaffold (#boards, #lobbyControls, …) is gone.
  // With nothing to draw, bail before dereferencing room-only elements that would
  // throw against the wrong template. #boards is the room scaffold's signature node.
  if (!$("#boards")) return;
  const snap = game.snapshot;
  const me = snap.players.find((p) => p.username === getUsername());

  // Daily hard-gate: until YOU finish (win/give up), only your board is visible.
  // me.status flips to won/lost on completion → the whole "underneath" unlocks.
  const dailyLocked = game.isDaily && (!me || me.status === "playing");
  if (game.isDaily) {
    document.body.classList.add("daily");
    const tabs = $("#roomTabs"); if (tabs) tabs.hidden = dailyLocked; // no leaderboard/games until done
    const nameBtn = $("#roomName"); if (nameBtn) nameBtn.textContent = t("daily.boardTitle", { date: game.dailyDate });
    // The lobby bar's controls (choose-mode / start / play-again) are all meaningless for
    // the daily (it auto-starts, never resets) — hide the otherwise-empty bar entirely.
    const lobbyBar = $(".lobby-bar"); if (lobbyBar) lobbyBar.hidden = true;
  }
  if (game.isDaily) renderDailyUnlock(snap, me);

  // Keep the header name (and tab title) in sync with server renames.
  if (snap.name && snap.name !== game.name) {
    game.name = snap.name;
    const nameEl = $("#roomName");
    if (nameEl) nameEl.textContent = game.name;
    document.title = `${game.name} — Wordul`;
  }

  // A rename can also move the room's URL slug. The old slug still resolves
  // (server-side alias), so we just slide the address bar + share link over to
  // the new one — no reconnect, the socket stays on the same room.
  if (snap.slug && snap.slug !== game.slug) {
    game.slug = snap.slug;
    game.path = `${game.owner}/${game.slug}`;
    history.replaceState(null, "", `/@${game.owner}/${game.slug}`);
  }

  // Lobby controls. Control is shared — anyone present can start/rename/rematch.
  const lobby = $("#lobbyControls");
  const startBtn = $("#startBtn");
  const endControls = $("#endControls");
  const rematchBtn = $("#rematchBtn");

  if (snap.phase === "lobby") {
    lobby.hidden = false;
    endControls.hidden = true;
    syncModePicker(snap);
    syncLobbySetup(snap);
    if (snap.isDuel) applyDuelReadyButton(startBtn, snap, me);
    else startBtn.hidden = false;
  } else if (snap.phase === "countdown") {
    lobby.hidden = true;
    endControls.hidden = true;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  } else if (snap.phase === "playing") {
    lobby.hidden = true;
    endControls.hidden = true;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  } else if (snap.phase === "finished") {
    lobby.hidden = true;
    endControls.hidden = false;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
    // Duel: the between-rounds intermission reuses the rematch button as the ready toggle
    // (KOTH replaces the rematch handshake); queued spectators just watch the queue advance.
    if (snap.isDuel) applyDuelReadyButton(rematchBtn, snap, me);
    else rematchBtn.hidden = false;
  }

  syncModeChip(snap);

  // Chat is social — keep it out of sight while you're playing solo, and only
  // surface it (inline on desktop, 💬 button on mobile) once someone else is in
  // the room. `me` is always in snap.players, so >= 2 means real company.
  const hasCompany = snap.players.length >= 2;
  const showSocial = game.isDaily ? !dailyLocked : hasCompany;
  const chatPanel = $("#chatPanel");
  const chatTopBtn = $("#chatTopBtn");
  if (chatPanel) chatPanel.hidden = !showSocial;
  if (chatTopBtn) chatTopBtn.hidden = !showSocial;
  if (!showSocial) closeChatSheet();

  // Immersive UI (C5): mid-play, the in-game header collapses to just avatar +
  // username + gold. Room name, ✎ rename, Share ↗, and the scoreboard hide while
  // you're guessing (all reachable via the avatar hub) and return in lobby/finished.
  setChromeVisibility(snap.phase);

  renderBoards(snap, me);
  renderKeyboard($("#keyboard"), me);
  renderChat(snap);
  renderScoreboard(snap);
  renderQueue(snap);
  renderGames(snap);
  applyTabVisibility(snap.phase === "playing");
  renderPowerups(powerupsCtx, snap, me);

  // Show the keyboard only when a guess is actually possible — keeps the lobby
  // unambiguous (no dead keys to mash) and post-game state minimal.
  const kb = $("#keyboard");
  const canType = snap.phase === "playing" && me && me.status === "playing" && (!snap.isDuel || me.role === "duelist");
  if (kb) kb.hidden = !canType;
}

// Immersive UI hide-chrome gate (C5). A single `body.playing` class drives the CSS
// that hides the room name / ✎ rename / Share ↗ / scoreboard while a guess is in
// progress; lobby + finished restore the full chrome. Everything hidden here is
// reachable via the avatar hub, so nothing is orphaned.
function setChromeVisibility(phase) {
  const playing = phase === "playing";
  document.body.classList.toggle("playing", playing);
  // A hub "peek" at the scoreboard adds .hub-reveal to force it visible mid-play;
  // drop that the moment we leave the playing phase so normal gating resumes.
  if (!playing) $("#scoreboard")?.classList.remove("hub-reveal");
}

// --- Per-round reset ---

// A fresh round: clear the power-up hints (owned by powerups.js) AND the gold-economy
// / clearer-wins per-round state (owned here). Both halves reset together on the same
// new-round snapshot hook.
function resetRound(round) {
  resetPowerHints(game, round); // ezRound, revealed, vowels, pending*, stuck, errorCount
  // A new round reopens input: the end-stats lock (set on game over / give-up) must clear here,
  // or a duel REPLAY (ready→KOTH next round) leaves the keyboard dead — that path never hits the
  // rematch_accepted handler that otherwise resets it. Covers fresh start, rematch, and reconnect.
  game.hasShownEndStats = false;
  game.finishReason = null; // C4: how this round ended, from my view — fresh each round
  game.goldThisRound = 0; // per-round earnings, shown as your score on the end screen
  // Clearer-wins: a fresh round starts an empty replay + a cleared hacker-log.
  game.replay = [];
  clearPayoutTimers(); // cancel any pending payout/drain from the prior round + reset payingOut
  // Loss penalties (C2): escalation is per-game, so a fresh round forgets old mistakes.
  game.deadLetterReuse = new Map();
  if (hacklog) {
    hacklog.clear();
    const el = $("#hacklog");
    if (el) el.hidden = true;
  }
}

function renderChat(snap) {
  const log = $("#chatLog");
  if (!log) return;
  const chat = snap.chat || [];
  // Only append new entries — avoid rebuilding scroll position on every snapshot.
  if (chat.length < game.lastChatLen) {
    // Backwards jump shouldn't happen (chat is append-only) but be defensive.
    log.textContent = "";
    game.lastChatLen = 0;
  }
  const appended = chat.length - game.lastChatLen;
  let notifyCount = 0;
  for (let i = game.lastChatLen; i < chat.length; i++) {
    const e = chat[i];
    log.appendChild(renderChatRow(e));
    // Only notify for meaningful entries: system join/quit lines, or a non-empty
    // message from someone else. Blank entries and your own messages don't ping.
    const hasText = (e.text || "").trim().length > 0;
    if (e.kind === "system" ? hasText : (hasText && e.from !== getUsername())) notifyCount++;
  }
  game.lastChatLen = chat.length;
  if (appended > 0) {
    const panel = $("#chatPanel");
    const sheetOpen = panel?.classList.contains("sheet-open");
    const visible = isMobile() ? sheetOpen : !game.chatCollapsed;
    if (visible) {
      scrollChatToBottom();
    } else if (notifyCount > 0) {
      game.unreadChat += notifyCount;
    }
    updateChatBadge();
  }
}

function renderChatRow(entry) {
  const row = document.createElement("div");
  if (entry.kind === "system") {
    row.className = "chat-row system";
    row.textContent = entry.text;
  } else {
    const mine = entry.from && entry.from === getUsername();
    row.className = "chat-row user" + (mine ? " mine" : "");
    const from = userLink(entry.from);
    from.classList.add("from");
    row.appendChild(from);
    row.appendChild(document.createTextNode(": " + entry.text));
  }
  return row;
}

function scrollChatToBottom() {
  const log = $("#chatLog");
  if (!log) return;
  // Defer to next frame so newly-appended rows have their height.
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function updateChatBadge() {
  const inline = $("#chatBadge");
  const topBadge = $("#chatTopBadge");
  // On desktop the inline badge shows while the panel is collapsed.
  const desktopUnread = game.unreadChat > 0 && game.chatCollapsed;
  if (inline) inline.hidden = !desktopUnread;
  if (inline && desktopUnread) inline.textContent = String(game.unreadChat);
  // On mobile the topbar button shows the unread count whenever the sheet is closed.
  const panel = $("#chatPanel");
  const sheetClosed = panel ? !panel.classList.contains("sheet-open") : true;
  const mobileUnread = isMobile() && game.unreadChat > 0 && sheetClosed;
  if (topBadge) {
    topBadge.hidden = !mobileUnread;
    if (mobileUnread) topBadge.textContent = String(game.unreadChat);
  }
}

function syncModePicker(snap) {
  const list = $("#modeList");
  const control = $("#modeControl");
  if (!list || !control) return;
  $("#modeHeading").textContent = t("mode.heading");

  // Only show modes that are actually online — no locked "coming soon" teasers cluttering
  // the lobby. With a single playable mode there's nothing to pick, so hide the whole
  // control; the picker only earns its space once a second mode ships.
  const availableIds = Object.keys(MODES).filter(isAvailableMode);
  control.hidden = availableIds.length <= 1;

  // Build rows once.
  if (list.children.length === 0) {
    for (const id of availableIds) {
      const li = document.createElement("li");
      li.className = "mode-row";
      li.dataset.mode = id;
      li.setAttribute("role", "radio");

      const main = document.createElement("div");
      main.className = "mode-row-main";
      const label = document.createElement("span");
      label.className = "mode-row-label";
      label.textContent = t(`mode.${id}.label`);
      const blurb = document.createElement("span");
      blurb.className = "mode-row-blurb";
      blurb.textContent = t(`mode.${id}.blurb`);
      main.append(label, blurb);

      const tag = document.createElement("span");
      tag.className = "mode-row-tag";
      li.append(main, tag);

      li.tabIndex = 0;
      const choose = () => send({ type: "set_mode", mode: id });
      li.addEventListener("click", choose);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      });
      list.appendChild(li);
    }
  }

  // Reflect current selection from the snapshot (server is source of truth).
  for (const li of list.children) {
    const selected = li.dataset.mode === snap.mode;
    li.classList.toggle("selected", selected);
    li.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function syncModeChip(snap) {
  const chip = $("#modeChip");
  if (!chip) return;
  if (game.isDaily) { chip.hidden = true; return; } // daily has its own title; no mode chip
  chip.textContent = t(`mode.${snap.mode}.label`);
  // Read-only chip shows whenever the interactive picker is hidden (playing /
  // finished) — late-joiners mid-play still see the mode.
  chip.hidden = snap.phase === "lobby";
}

// Word-length picker — now mounted in the Settings "Room" section (out of the lobby).
// Called when the gear opens in a room. Builds options once, reflects the room's current
// length (server is source of truth), and disables once the game starts (length is locked).
function syncLengthSelect(snap) {
  const sel = $("#lengthSelect");
  if (!sel || !snap) return;
  if (sel.options.length === 0) {
    for (const n of SUPPORTED_LENGTHS) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = `${n} letters`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      const n = parseInt(sel.value, 10);
      if (SUPPORTED_LENGTHS.includes(n)) {
        setPreferredLength(n);
        send({ type: "set_length", wordLength: n });
      }
    });
  }
  sel.disabled = snap.phase !== "lobby"; // can't resize the words under a live/finished board
  if (parseInt(sel.value, 10) !== snap.wordLength) sel.value = String(snap.wordLength);
}

// The lobby gear — one bare ⚙ that opens Settings (where length + theme live). The
// "5 letters · Theme" label is gone; the gear is the whole affordance.
function syncLobbySetup() {
  const btn = $("#lobbySetup");
  if (!btn) return;
  btn.hidden = false;
  if (!btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => showSettings());
  }
}

// Per-room cumulative scoreboard (wins/played across rounds), sorted by wins desc.
function renderScoreboard(snap) {
  const root = $("#scoreboard");
  if (!root) return;
  const board = (snap.scoreboard || []).slice().sort((a, b) => b.wins - a.wins || b.played - a.played);
  if (board.length === 0) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.textContent = "";
  const title = document.createElement("div");
  title.className = "scoreboard-title";
  title.textContent = "Scoreboard";
  root.appendChild(title);
  const me = getUsername();
  for (const e of board) {
    const row = document.createElement("div");
    row.className = "score-row" + (e.username === me ? " mine" : "");
    const name = document.createElement("span");
    name.className = "score-name";
    name.appendChild(userLink(e.username, { suffix: e.username === me ? " (you)" : "" }));
    const tally = document.createElement("span");
    tally.className = "score-tally";
    tally.textContent = `${e.wins}W · ${e.losses ?? 0}L · ${e.ties ?? 0}T`;
    row.appendChild(name);
    row.appendChild(tally);
    root.appendChild(row);
  }
}

// Duel ready / "Challenge 👑" button, shared by the lobby start button and the
// between-rounds intermission button. Only duelists ready up; spectators see no button.
function applyDuelReadyButton(btn, snap, me) {
  const amDuelist = me && me.role === "duelist";
  btn.hidden = !amDuelist;
  if (!amDuelist) return;
  const ready = !!me.ready;
  const challenger = snap.throne && snap.throne.username !== getUsername();
  btn.textContent = ready ? "Ready ✓" : (challenger ? "Challenge 👑" : "Ready");
  btn.classList.toggle("ready-on", ready);
}

// Duel queue strip: the throne holder + the line of waiting challengers. Hidden when
// there's no queue and no throne (a fresh 1v1 with nobody waiting), or in a non-duel room.
function renderQueue(snap) {
  const strip = $("#queueStrip");
  if (!strip) return;
  const queue = Array.isArray(snap.queue) ? snap.queue : [];
  if (!snap.isDuel || (queue.length === 0 && !snap.throne)) {
    strip.hidden = true; strip.textContent = ""; return;
  }
  strip.hidden = false;
  strip.textContent = "";
  if (snap.throne) {
    const king = document.createElement("span");
    king.className = "queue-king";
    king.textContent = `👑 ${snap.throne.username} · ${snap.throne.streak} in a row`;
    strip.appendChild(king);
  }
  if (queue.length) {
    const label = document.createElement("span");
    label.className = "queue-next muted small";
    const meName = getUsername();
    const names = queue.map((u, i) => (u === meName ? `you (#${i + 1})` : u));
    label.textContent = `Next up: ${names.join(" → ")}`;
    strip.appendChild(label);
  }
}

function renderBoards(snap, me) {
  const root = $("#boards");
  // The daily is a focused, personal puzzle (the whole world plays the same word, but
  // you see only YOUR board) — the shared standings live in the gated leaderboard, not
  // a wall of strangers' boards. Live race rooms still show everyone.
  const ordered = game.isDaily
    ? (me ? [me] : [])
    : snap.isDuel
    ? [
        // Duel rooms show only the two duelists' boards; spectators watch via the queue strip.
        ...(me && me.role === "duelist" ? [me] : []),
        ...snap.players.filter((p) => p.role === "duelist" && p.username !== getUsername()),
      ]
    : [
        ...(me ? [me] : []),
        ...snap.players.filter((p) => p.username !== getUsername()),
      ];
  // While my board's tiles are mid-explosion OR mid-payout (glow/floater anchored to
  // them), preserve the existing DOM so the animations don't get nuked by a snapshot
  // from another player's guess. Update everyone else's boards as normal.
  const preserveMine = game.exploding || game.payingOut;
  if (preserveMine) {
    for (const board of root.querySelectorAll(".player-board")) {
      if (board.dataset.player !== getUsername()) board.remove();
      // My board is frozen to protect the animating row + coin floaters, but the input
      // row below it has no animation to guard. Sync it in place so letters typed mid-
      // payout actually paint — otherwise fast play looks like it eats the next word.
      else if (me) syncMyInputRow(board, snap, me);
    }
  } else {
    root.textContent = "";
  }
  for (const p of ordered) {
    if (preserveMine && p.username === getUsername()) continue; // keep existing animating board
    const board = document.createElement("div");
    board.className = "player-board" + (p.username === getUsername() ? "" : " spectator");
    board.dataset.player = p.username;
    const name = document.createElement("div");
    name.className = "player-name";
    const nameSpan = userLink(p.username, { suffix: p.username === getUsername() ? " (you)" : "" });
    if (p.username === getUsername()) nameSpan.classList.add("me");
    name.appendChild(nameSpan);

    if (p.status === "won") {
      const b = document.createElement("span"); b.className = "badge won"; b.textContent = "WON"; name.appendChild(b);
    } else if (p.status === "lost") {
      const b = document.createElement("span"); b.className = "badge lost"; b.textContent = "OUT"; name.appendChild(b);
    } else if (!p.connected) {
      const b = document.createElement("span"); b.className = "badge off"; b.textContent = "AWAY"; name.appendChild(b);
    }
    if (snap.throne && p.username === snap.throne.username) {
      const crown = document.createElement("span");
      crown.className = "badge throne";
      crown.textContent = `👑 ×${snap.throne.streak}`;
      name.appendChild(crown);
    }
    board.appendChild(name);

    const grid = document.createElement("div");
    grid.className = "grid";
    const cols = snap.wordLength;
    const rows = snap.maxGuesses;
    // CSS vars drive grid-template + tile sizing.
    board.style.setProperty("--cols", String(cols));
    board.style.setProperty("--rows", String(rows));
    grid.style.setProperty("--rows", String(rows));
    const isMe = p.username === getUsername();
    const pending = (isMe && snap.phase === "playing" && p.status === "playing") ? game.pending : "";
    const prevCount = game.lastGuessCounts.get(p.username) ?? 0;
    const freshRowIdx = p.guesses.length > prevCount ? p.guesses.length - 1 : -1;

    for (let r = 0; r < rows; r++) {
      const row = document.createElement("div");
      row.className = "grid-row";
      row.style.setProperty("--cols", String(cols));
      const guess = p.guesses[r];
      const isCurrentRow = !guess && r === p.guesses.length;
      const isFresh = r === freshRowIdx;
      for (let c = 0; c < cols; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        if (guess) {
          if (isFresh) {
            // Render as "filled with letter" first; flip animation reveals color mid-spin.
            tile.classList.add("filled", "reveal");
            tile.style.setProperty("--reveal-delay", `${c * REVEAL_STAGGER_MS}ms`);
            if (isMe) tile.textContent = guess.word[c];
            scheduleReveal(tile, guess.mask[c], c);
          } else {
            tile.classList.add(guess.mask[c]);
            if (isMe) tile.textContent = guess.word[c];
          }
        } else if (isMe && isCurrentRow && pending[c]) {
          tile.classList.add("filled", "pop");
          tile.textContent = pending[c];
        } else if (
          isMe && isCurrentRow && c === pending.length &&
          snap.phase === "playing" && p.status === "playing"
        ) {
          // Blinking cursor on the next slot so you always know where you're typing.
          tile.classList.add("cursor");
        } else if (!isMe && isCurrentRow && snap.phase === "playing" && p.status === "playing") {
          // Opponent's LIVE typing (anonymous): ghost-fill the letters they've entered, with a
          // soft pulse on the slot they're about to fill. No letters — same hidden-word rule as
          // the rest of the spectator board. Driven by game.typing; updateOpponentGhost() patches
          // this in place between full renders.
          const tlen = Math.min(game.typing.get(p.username) ?? 0, cols);
          if (c < tlen) tile.classList.add("ghost");
          else if (c === tlen && tlen > 0) tile.classList.add("ghost-cursor");
        }
        row.appendChild(tile);
      }
      // One-shot line clear: tap your active row to wipe the whole guess (no Delete button).
      if (isMe && isCurrentRow && snap.phase === "playing" && p.status === "playing") {
        row.classList.add("input-row");
        row.addEventListener("click", clearRow);
      }
      grid.appendChild(row);
    }
    board.appendChild(grid);
    root.appendChild(board);
    game.lastGuessCounts.set(p.username, p.guesses.length);
  }
}

// Patch a single opponent's live-typing ghost row in place — far cheaper than a full render()
// and it never disturbs another board or an in-flight animation. game.typing is already updated
// by the caller; here we just re-paint the ghost / ghost-cursor classes on their current input
// row. No-ops silently if their board isn't on screen yet (a later full render picks it up).
function updateOpponentGhost(username) {
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing" || game.isDaily) return;
  const p = snap.players.find((q) => q.username === username);
  if (!p || p.status !== "playing") return;
  const root = $("#boards");
  const board = root && $$(".player-board", root).find((b) => b.dataset.player === username);
  if (!board) return;
  const rowEl = board.querySelectorAll(".grid-row")[p.guesses.length];
  if (!rowEl) return; // their current row is off the board (shouldn't happen while playing)
  const len = Math.min(game.typing.get(username) ?? 0, snap.wordLength);
  rowEl.querySelectorAll(".tile").forEach((tile, c) => {
    tile.classList.toggle("ghost", c < len);
    tile.classList.toggle("ghost-cursor", c === len && len > 0);
  });
}

// During a preserved render (mid-payout / mid-explosion) the board DOM is frozen so the
// flipping row's coin floaters stay anchored. The input row has nothing to protect, so we
// patch its tiles in place to mirror game.pending. We only rewrite tiles that actually
// changed, so an existing letter never re-fires its pop animation on each new keystroke.
function syncMyInputRow(board, snap, me) {
  if (snap.phase !== "playing" || me.status !== "playing") return;
  const inputRow = board.querySelectorAll(".grid-row")[me.guesses.length];
  if (!inputRow) return;
  const pending = game.pending;
  inputRow.querySelectorAll(".tile").forEach((tile, c) => {
    const want = pending[c] ?? "";
    const isCursor = c === pending.length;
    if (tile.textContent === want && tile.classList.contains("filled") === !!want) {
      tile.classList.toggle("cursor", isCursor); // letter unchanged — just move the cursor
      return;
    }
    tile.className = "tile";
    tile.textContent = "";
    if (want) { tile.classList.add("filled", "pop"); tile.textContent = want; }
    else if (isCursor) tile.classList.add("cursor");
  });
}

// Fast path for the typing hot loop: a keystroke only ever changes MY input row, so patch
// just that row in place instead of a full render() — which would wipe + rebuild every board,
// re-class all keyboard keys, and rebuild the scoreboard/games panels on EVERY letter (the
// tap-lag culprit). Falls back to a full render() if my board isn't built yet (first paint).
function patchMyInputRow() {
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing") { render(); return; }
  const me = snap.players.find((p) => p.username === getUsername());
  const myBoard = $$(".player-board").find((b) => b.dataset.player === getUsername());
  if (!me || !myBoard || !myBoard.querySelectorAll(".grid-row")[me.guesses.length]) { render(); return; }
  syncMyInputRow(myBoard, snap, me);
}

function scheduleReveal(tile, color, colIdx) {
  // Swap to colored class at the keyframe's halfway point so the color is revealed
  // exactly when the tile is edge-on (invisible) — that's why the snap feels seamless.
  const at = colIdx * REVEAL_STAGGER_MS + REVEAL_FLIP_HALF_MS;
  setTimeout(() => {
    tile.classList.remove("filled");
    tile.classList.add(color);
  }, at);
}

// --- Keyboard input ---

// Resolve the player's keyboard layout: an explicit saved pick always wins; an
// unset / "auto" setting falls through to locale auto-detect (fr-* → AZERTY).
// The first explicit pick in the layout picker pins it forever.
function resolvedLayoutId() {
  const s = getSettings().keyboardLayout;
  return s && s !== "auto" ? activeLayoutId(s) : detectLayout(navigator.language);
}

// Handlers injected into the on-screen keyboard's delegated click listener.
const keyboardHandlers = { onEnter: submitGuess, onBack: backspace, onLetter: typeLetter, onClear: clearRow };

function onPhysicalKey(e) {
  // Don't hijack typing in any input fields, with modifiers, or while a modal is open.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // End-game: when the stats modal is up with Play Again showing, Enter starts a
  // new game — so the instinctive "tap Enter to keep going" just works.
  if (e.key === "Enter") {
    const playAgain = $("#modalPlayAgain");
    if (playAgain && !playAgain.hidden && playAgain.offsetParent !== null) {
      e.preventDefault(); playAgain.click(); return;
    }
  }
  if (document.querySelector(".modal:not([hidden])")) return;

  const isLetter = /^[a-zA-Z]$/.test(e.key);
  const isEnter = e.key === "Enter";

  // Type-to-start: on the home screen or in a lobby, a letter or Enter kicks off the
  // game — so players who instinctively start typing don't have to hunt for the button.
  if (!game.snapshot || game.snapshot.phase === "lobby") {
    if (!isLetter && !isEnter) return;
    const startPlaying = $("#startPlayingBtn");
    if (!game.snapshot && startPlaying && startPlaying.offsetParent !== null) {
      startPlaying.click(); e.preventDefault(); return;
    }
    if (game.snapshot?.phase === "lobby") {
      const snap = game.snapshot;
      if (snap.isDuel) {
        const meP = snap.players.find((p) => p.username === getUsername());
        if (meP && meP.role === "duelist") send({ type: "ready", ready: true });
      } else {
        send({ type: "start" });
      }
      e.preventDefault();
    }
    return;
  }

  if (game.snapshot.phase !== "playing") return;
  const me = game.snapshot.players.find((p) => p.username === getUsername());
  if (!me || me.status !== "playing") return;
  // A give-up / bankruptcy ends the game from MY side without a server status change
  // (server still says "playing"). Once that's happened, input is closed — otherwise you
  // could keep typing, re-trigger payouts, even "win" after a loss was recorded.
  if (game.hasShownEndStats) return;

  if (isEnter) { submitGuess(); e.preventDefault(); }
  else if (e.key === "Escape") { clearRow(); e.preventDefault(); }
  else if (e.key === "Backspace") { backspace(); e.preventDefault(); }
  else if (isLetter) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
}

// Broadcast my current row LENGTH (never the letters) so opponents see a live ghost fill.
// Coalesced to one send per frame — fast typing or a held ⌫ collapses into the latest length —
// and only sent in a live race that actually has someone else watching; solo/daily skip it.
let _typingRaf = 0;
let _typingLen = -1;
function sendTyping(len = game.pending.length) {
  const snap = game.snapshot;
  if (!snap || snap.phase !== "playing" || game.isDaily) return;
  if (!snap.players.some((p) => p.username !== getUsername())) return; // nobody to show it to
  _typingLen = len;
  if (_typingRaf) return;
  _typingRaf = requestAnimationFrame(() => {
    _typingRaf = 0;
    send({ type: "typing", len: _typingLen });
  });
}

function typeLetter(l) {
  if (!game.snapshot || game.snapshot.phase !== "playing") return;
  if (game.pending.length >= game.snapshot.wordLength) return;
  game.pending += l.toUpperCase();
  patchMyInputRow(); // in-place: a keystroke only changes my input row, not the whole room
  sendTyping();
  resetIdle();
}
let lastWipeReactAt = 0;
function clearRow() {
  if (!game.pending.length) return;
  const cleared = game.pending.length;
  resetIdle();
  sendTyping(0); // tell opponents the row emptied the instant the wipe starts

  // A meaningful wipe (most of a word, not one stray letter) earns a dry companion
  // aside — throttled so rapid retries don't turn it into a chatterbox. Text-only:
  // the wipe is frequent enough that voicing it would wear thin fast.
  if (cleared >= 3 && Date.now() - lastWipeReactAt > 8000) {
    lastWipeReactAt = Date.now();
    showCompanion("wipe", { cleared });
  }

  const row = activeInputRow();
  if (!row || getSettings().reducedMotion) { game.pending = ""; render(); return; }

  // Sweep the tiles away left-to-right, THEN clear + re-render once the gesture lands.
  const tiles = row.querySelectorAll(".tile");
  tiles.forEach((t, i) => t.style.setProperty("--wipe-delay", `${i * 22}ms`));
  row.classList.add("wipe");
  const total = 180 + (tiles.length - 1) * 22;
  setTimeout(() => { game.pending = ""; render(); }, total);
}
// The active (unplayed) input row for me — sits right after my played guesses.
function activeInputRow() {
  const myBoard = $$(".player-board")[0];
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  if (!myBoard || !me) return null;
  return myBoard.querySelectorAll(".grid-row")[me.guesses.length] || null;
}
function backspace() {
  if (game.pending.length === 0) return;
  game.pending = game.pending.slice(0, -1);
  patchMyInputRow(); // in-place: backspace only changes my input row
  sendTyping();
  resetIdle();
  maybeShowClearHint();
}
// One-time nudge: the first time someone backspaces, reveal the faster way to bail
// on a whole guess. Shown once ever (localStorage), never nags again.
function maybeShowClearHint() {
  if (localStorage.getItem(LS.clearHint) === "1") return;
  localStorage.setItem(LS.clearHint, "1");
  const tip = isTouch() ? "Tip: hold ⌫ to clear the whole row" : "Tip: press Esc to clear the whole row";
  setTimeout(() => toast(tip, { duration: 3200 }), 500);
}
function isTouch() {
  return window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
}
function submitGuess() {
  resetIdle();
  if (game.hasShownEndStats) return; // locally forfeited/bankrupt — input is closed (server may still say "playing")
  const len = game.snapshot?.wordLength ?? 5;
  if (game.pending.length !== len) {
    flashShake();
    toast("Not enough letters", { error: true, duration: 1400 });
    bumpErrorCount(powerupsCtx); // C4: fumbling the length counts toward the 💀 give-up offer
    return;
  }
  const s = getSettings();
  if (s.hardMode) {
    const me = game.snapshot?.players.find((p) => p.username === getUsername());
    const violation = checkHardMode(game.pending, me?.guesses ?? []);
    if (violation) {
      flashShake();
      toast(violation, { error: true, duration: 2200 });
      bumpErrorCount(powerupsCtx); // C4: a hard-mode violation counts toward the 💀 offer too
      return;
    }
  }
  send({ type: "guess", word: game.pending });
}

function checkHardMode(guess, prevGuesses) {
  const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  for (const g of prevGuesses) {
    for (let i = 0; i < g.word.length; i++) {
      if (g.mask[i] === "green" && guess[i] !== g.word[i]) {
        return `${ord(i + 1)} letter must be ${g.word[i]}`;
      }
    }
    const need = {};
    for (let i = 0; i < g.word.length; i++) {
      if (g.mask[i] === "yellow") need[g.word[i]] = (need[g.word[i]] ?? 0) + 1;
    }
    const have = {};
    for (const c of guess) have[c] = (have[c] ?? 0) + 1;
    for (const [letter, count] of Object.entries(need)) {
      if ((have[letter] ?? 0) < count) {
        return `Guess must contain ${letter}${count > 1 ? ` (x${count})` : ""}`;
      }
    }
  }
  return null;
}

function flashShake() {
  // Shake my current row.
  const myBoard = $$(".player-board")[0];
  if (!myBoard) return;
  const me = game.snapshot?.players.find((p) => p.username === getUsername());
  if (!me) return;
  const rows = myBoard.querySelectorAll(".grid-row");
  const row = rows[me.guesses.length];
  if (!row) return;
  row.classList.remove("shake");
  void row.offsetWidth; // restart animation
  row.classList.add("shake");
}

function toast(text, opts = {}) {
  // Remove any existing toast so we never stack.
  const old = document.querySelector(".toast-bubble");
  if (old) old.remove();
  clearTimeout(game.toastTimer);

  const bubble = document.createElement("div");
  bubble.className = "toast-bubble" + (opts.error ? " error" : "");
  bubble.textContent = text;
  document.body.appendChild(bubble);

  const stay = opts.duration ?? 2200;
  game.toastTimer = setTimeout(() => {
    bubble.classList.add("fade");
    setTimeout(() => bubble.remove(), 280);
  }, stay);
}

// --- Start celebration ---

// GO! pop + confetti rain. Fires on every client via the shared snapshot, so the
// celebration is simultaneous on both sides. Visual only for now — the "golden
// voice" wishing luck is parked for later.
function triggerStartCelebration() {
  if (getSettings().reducedMotion) return;

  const burst = document.createElement("div");
  burst.className = "go-burst";
  burst.textContent = "GO!";
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1100);

  spawnConfetti(40);
}

// --- Duel 3-2-1 countdown overlay (server-stamped goAt keeps every client in sync) ---
let countdownTimer = null;
function startCountdownOverlay(goAt) {
  stopCountdownOverlay();
  if (getSettings().reducedMotion) return; // numbers skipped; the alarm still flips the round live
  const el = document.createElement("div");
  el.id = "countdownOverlay";
  el.className = "countdown-overlay";
  document.body.appendChild(el);
  let lastShown = null;
  const tick = () => {
    const remaining = goAt - Date.now();
    const n = remaining <= 0 ? null : Math.ceil(remaining / 1000);
    if (n == null) { stopCountdownOverlay(); return; }
    if (n !== lastShown) {
      lastShown = n;
      el.textContent = String(n);
      el.classList.remove("pulse");
      void el.offsetWidth; // restart the pop animation
      el.classList.add("pulse");
      try { playChime([[330 + (3 - n) * 110, 0]]); } catch {} // 330→440→550 Hz as it ticks down
    }
  };
  tick();
  countdownTimer = setInterval(tick, 80);
}
function stopCountdownOverlay() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  const el = $("#countdownOverlay");
  if (el) el.remove();
}

// Solve celebration: a big "SOLVED!" pop + confetti so winning the word lands as an
// event, not just a quiet toast. Reuses the GO! burst styling (green, centered).
function triggerWinCelebration() {
  if (getSettings().reducedMotion) return;
  const burst = document.createElement("div");
  burst.className = "go-burst win-burst";
  burst.textContent = "SOLVED!";
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1300);
  spawnConfetti(48);
}

const CONFETTI_COLORS = ["#538d4e", "#c9b458", "#6aaa64", "#ffd166", "#9d4edd", "#4cc9f0", "#ef476f"];
function spawnConfetti(pieces) {
  // Win/start celebration can spawn 40–130 pieces. Build them in a DocumentFragment and
  // append ONCE (one reflow instead of `pieces` reflows), and clean up with a single timer
  // instead of one per piece — both were a real synchronous stall at the win moment.
  const frag = document.createDocumentFragment();
  const nodes = [];
  for (let i = 0; i < pieces; i++) {
    const c = document.createElement("div");
    c.className = "cheer-confetti";
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    c.style.left = `${Math.random() * 100}vw`;
    c.style.setProperty("--cf-x", `${(Math.random() - 0.5) * 140}px`);
    c.style.setProperty("--cf-rot", `${(Math.random() - 0.5) * 900}deg`);
    c.style.setProperty("--cf-delay", `${Math.random() * 250}ms`);
    c.style.setProperty("--cf-dur", `${1200 + Math.random() * 900}ms`);
    frag.appendChild(c);
    nodes.push(c);
  }
  document.body.appendChild(frag);
  setTimeout(() => { for (const c of nodes) c.remove(); }, 2600); // one cleanup pass (max anim ≈ 2.35s)
}

// A short sparkle chime via Web Audio. Honors the global mute toggle.
let audioCtx = null;
// iOS/Safari start an AudioContext "suspended" until a user gesture resumes it. Our
// first chime is fired by a network message (a guess result), not a tap — so without
// this the context stays suspended and mobile hears nothing. Unlock on the first touch.
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* audio is a nice-to-have */ }
}
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("touchend", unlockAudio, { once: true });
function playChime(notes) {
  if (localStorage.getItem("wordul.muted") === "1") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    notes.forEach(([freq, at], i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at); osc.stop(t0 + at + 0.24);
    });
  } catch { /* ignore — audio is a nice-to-have */ }
}

// A short filtered-noise burst for mistake feedback. "glass" = bright, fast decay;
// "shock" = a buzzy zap; "buzz" = a low dull thud. WebAudio-only, no asset files.
function playNoise(kind) {
  if (localStorage.getItem("wordul.muted") === "1") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const dur = kind === "buzz" ? 0.18 : 0.3;
    const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    if (kind === "glass") { filter.type = "highpass"; filter.frequency.value = 2200; }
    else if (kind === "shock") { filter.type = "bandpass"; filter.frequency.value = 900; filter.Q.value = 6; }
    else { filter.type = "lowpass"; filter.frequency.value = 500; }
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.28, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start(t0); src.stop(t0 + dur);
  } catch { /* ignore — audio is a nice-to-have */ }
}

// Sensory feedback for a committed sloppy mistake (reused dead letter). Config comes
// from the active edition (activeMistakeFx); reduced motion suppresses shake + flash
// but keeps the non-motion cues (sound, haptics). No-ops when the edition opts out.
function mistakeFx(cfg, letters) {
  if (!cfg) return;
  if (cfg.sound) playNoise(cfg.sound);
  if (cfg.haptics && navigator.vibrate) navigator.vibrate([30, 40, 30]);
  if (getSettings().reducedMotion) return;
  const boards = $("#boards");
  if (cfg.shake && boards) {
    boards.classList.remove("fx-shake");
    void boards.offsetWidth; // restart the animation
    boards.classList.add("fx-shake");
    setTimeout(() => boards.classList.remove("fx-shake"), 360);
  }
  if (cfg.crack && letters && letters.length) crackTiles(letters);
  if (cfg.flash) {
    const flash = document.createElement("div");
    flash.className = "fx-flash";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 320);
  }
}

// Shatter just the reused dead-letter tiles in MY fresh row (matched by letter).
// Same bottom-up "is it filled?" walk as getMyFreshTile so a mid-payout repaint
// can't target a detached node.
function crackTiles(letters) {
  const up = new Set([...letters].map((l) => l.toUpperCase()));
  const myBoard = document.querySelector("#boards .player-board:not(.spectator)");
  if (!myBoard) return;
  const rows = myBoard.querySelectorAll(".grid .grid-row");
  for (let r = rows.length - 1; r >= 0; r--) {
    const tiles = rows[r].querySelectorAll(".tile");
    const filled = tiles[0] && (tiles[0].classList.contains("reveal") ||
      tiles[0].classList.contains("green") || tiles[0].classList.contains("yellow") ||
      tiles[0].classList.contains("gray"));
    if (!filled) continue;
    tiles.forEach((t) => {
      if (!up.has((t.textContent || "").toUpperCase())) return;
      t.classList.remove("fx-break");
      void t.offsetWidth; // restart the animation
      t.classList.add("fx-break");
      setTimeout(() => t.classList.remove("fx-break"), 600);
    });
    return; // only the fresh row
  }
}

// Yang's scaled green celebration. 1 new green → spark + soft chime; 2+ → confetti
// + an ascending chime + a hyped voice line. Visual bits respect reduced motion.
// Yang's scaled green celebration. 1 new green → spark + soft chime; 2+ → confetti
// + chime + a hyped voice line whose words match the real count. Respects reduced motion.
function celebrateGreens(count) {
  const reduced = getSettings().reducedMotion;
  const boards = $("#boards");
  if (count >= 2) {
    if (count >= 3) playChime([[523, 0], [659, 0.08], [784, 0.16], [1047, 0.26]]);
    else playChime([[523, 0], [659, 0.09], [784, 0.18]]);
    if (!reduced) spawnConfetti(count >= 3 ? 28 + (count - 2) * 18 : 28); // 3→46, 4→64, 5→82
    showCompanion("greens", { count });
  } else {
    playChime([[660, 0], [880, 0.08]]);
    if (boards && !reduced) {
      boards.classList.remove("green-spark");
      void boards.offsetWidth; // restart the animation
      boards.classList.add("green-spark");
      setTimeout(() => boards.classList.remove("green-spark"), 700);
    }
  }
}

// --- End of game ---

// Losing used to summon a skull and a roast. Now every loss — ran out of guesses,
// beaten in a race, gave up, or went bankrupt — ends on a constructive, encouraging
// line drawn from the great minds of humanity (and a few AIs). The pool lives in
// /inspire.js; pickInspire() returns one formatted “quote” — author string.

// C4: forfeit — give-up or bankruptcy ends the game from MY side WITHOUT a server
// status change. Mirrors handleGameOver's bookkeeping (record the loss, guard
// fire-once, stop the idle timer) so a forfeit counts exactly like running out of
// guesses, then runs the lose explosion. `reason` is 'gave_up' | 'bankrupt'.
function forfeit(reason) {
  const snap = game.snapshot;
  if (!snap || game.hasShownEndStats) return;
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  clearIdle();
  clearGiveUpTimer();
  game.finishReason = reason;
  game.hasShownEndStats = true;
  // Tell the server we're out: it marks us lost (others see OUT) and the next snapshot
  // reveals the word to US, so the end-screen word card has it by the time it opens.
  send({ type: "resign" });
  showCompanion("loss", { answer: snap.word });
  triggerLoseSequence(snap, me);
}

function handleGameOver(snap) {
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  clearIdle();
  clearGiveUpTimer();
  const won = me.status === "won";
  const guessCount = me.guesses.length;
  game.hasShownEndStats = true;
  // C4: record how the game ended (give-up / bankruptcy already set theirs before
  // reaching here via forfeit, which short-circuits this path).
  game.finishReason = won ? "solved" : "lost";

  if (won) {
    // Solve bonus + speed bonus (fewer guesses = richer) + the winning row's greens.
    const maxGuesses = snap.maxGuesses ?? 6;
    const finalGreens = newGreensInLast(me.guesses);
    const speedBonus = GOLD.speedPerGuessLeft * Math.max(0, maxGuesses - guessCount);
    const winGold = GOLD.solve + speedBonus + finalGreens * GOLD.green;
    awardGold(winGold, getSettings().reducedMotion);
    game.goldThisRound = (game.goldThisRound || 0) + winGold;
    // Clearer-wins: the solve is the climactic turn — capture it in the replay + hacker-log
    // so "your run, line by line" ends ON the win and its gold, not one guess short. The gold
    // was already awarded above; this only RECORDS it (shape matches the gated server viewer).
    const winEvents = [];
    for (const d of orderedDiscoveriesInLast(me.guesses)) {
      if (d.kind === "green") winEvents.push({ kind: "green", index: d.index, letter: d.letter, delta: GOLD.green });
    }
    winEvents.push({ kind: "solve", delta: GOLD.solve });
    if (speedBonus > 0) winEvents.push({ kind: "speed", delta: speedBonus });
    recordReplayEntry({ guessIndex: guessCount - 1, events: winEvents, combo: null, balanceAfter: getGold() });
    const winLog = getHacklog();
    if (winLog) for (const ev of winEvents) {
      winLog.logLine(`${ev.kind}${ev.letter ? " " + String(ev.letter).toUpperCase() : ""}  +${ev.delta}`, { tone: "gain" });
    }
    triggerWinCelebration();
    playChime([[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]]);
    showCompanion("win", { guessesUsed: me.guesses.length });
    // Same gentle pacing as before — wait for the final row's flip to finish.
    setTimeout(
      () => openStats({ snap, me, won, justFinished: true, lastGuessCount: guessCount }),
      1700,
    );
  } else {
    // Loss: let the player's last row flip first (if they made one), THEN explode.
    showCompanion("loss", { answer: snap.word });
    const lastFlipDoneAt = guessCount > 0 ? 1500 : 200;
    setTimeout(() => triggerLoseSequence(snap, me), lastFlipDoneAt);
  }
}

function triggerLoseSequence(snap, me) {
  game.exploding = true;
  // However the round ended, the player gets a lift, not a roast: one random line
  // from the great-minds pool.
  const inspire = pickInspire();

  // 1. Screen flash.
  const flash = document.createElement("div");
  flash.className = "lose-flash";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 700);

  // 2. Confetti shards from screen center.
  const colors = ["#ff3838", "#ffb347", "#ffd166", "#b59f3b", "#9d4edd", "#ef476f"];
  const shards = 28;
  for (let i = 0; i < shards; i++) {
    const s = document.createElement("div");
    s.className = "shard";
    const angle = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 280 + Math.random() * 240;
    s.style.background = colors[i % colors.length];
    s.style.setProperty("--shard-tx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--shard-ty", `${Math.sin(angle) * dist + 220}px`); // bias downward
    s.style.setProperty("--shard-rot", `${(Math.random() - 0.5) * 1080}deg`);
    s.style.setProperty("--shard-delay", `${Math.random() * 120}ms`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1700);
  }

  // 3. Shake the page + explode my board's tiles.
  document.body.classList.add("lose-shake");
  setTimeout(() => document.body.classList.remove("lose-shake"), 600);

  const myBoard = $$(".player-board")[0];
  if (myBoard) {
    const tiles = Array.from(myBoard.querySelectorAll(".tile"));
    for (const tile of tiles) {
      const tx = (Math.random() - 0.5) * 800;
      const ty = 600 + Math.random() * 400;
      const rot = (Math.random() - 0.5) * 900;
      tile.style.setProperty("--ex-tx", `${tx}px`);
      tile.style.setProperty("--ex-ty", `${ty}px`);
      tile.style.setProperty("--ex-rot", `${rot}deg`);
      tile.style.setProperty("--ex-delay", `${Math.random() * 200}ms`);
      tile.classList.add("explode");
    }
  }

  // 4. After the dust settles, release the render lock so the snapshot can repaint
  //    a clean board behind the modal, then show the joke.
  setTimeout(() => {
    game.exploding = false;
    if (game.snapshot) renderBoards(game.snapshot, game.snapshot.players.find((p) => p.username === getUsername()));
    openStats({
      snap: game.snapshot ?? snap,
      me,
      won: false,
      justFinished: true,
      lastGuessCount: me.guesses.length,
      inspire,
    });
  }, 1500);
}

// --- Stats modal ---

// "The word — and a reason to remember it." Shows the answer big plus a reason to
// remember it: a definition, a surprising fact, and a quote from a great mind. Pulls
// from the pre-generated word-intel set first (instant, offline, with fact + quote);
// for words not yet in that set it falls back to the live dictionary definition. A
// one-tap web search always offers a way to go deeper.
function renderWordCard(parent, word) {
  if (!word) return;
  const w = String(word).toLowerCase();
  const card = document.createElement("div");
  card.className = "endgame-word-card";

  const label = document.createElement("div");
  label.className = "ewc-label";
  label.textContent = t("endscreen.theWord");
  card.appendChild(label);

  const big = document.createElement("div");
  big.className = "ewc-word";
  big.textContent = word.toUpperCase();
  card.appendChild(big);

  // The reward: an inline preview of the word's OG card. Every answer word has a
  // pre-rendered card at /word/og/<slug>.png; this only runs when the word is
  // revealed (renderWordCard is only called with snap.word present). Lazy + async
  // so it never blocks the modal, and self-hides on error so a missing image can
  // never break the end-card.
  const preview = document.createElement("img");
  preview.className = "ewc-preview";
  preview.src = `/word/og/${w}.png`;
  preview.alt = `${word.toUpperCase()} — word card`;
  preview.loading = "lazy";
  preview.decoding = "async";
  // Keep it small and tasteful even before any .ewc-preview CSS lands: the OG card
  // is 1200×630, so a fluid full-width box with a 1200/630 aspect ratio stays crisp.
  preview.style.width = "100%";
  preview.style.maxWidth = "320px";
  preview.style.aspectRatio = "1200 / 630";
  preview.style.height = "auto";
  preview.style.borderRadius = "10px";
  preview.style.display = "block";
  preview.style.margin = "10px auto 0";
  preview.onerror = () => { preview.remove(); };
  card.appendChild(preview);

  const def = document.createElement("div");
  def.className = "ewc-def";
  card.appendChild(def);

  // Inward link to the word's wiki page — "see the full story of <WORD>". Plain link,
  // no auto-redirect and nothing gating the next game; the player taps it if they want.
  const look = document.createElement("a");
  look.className = "ewc-look";
  look.href = `/word/${w}`;
  look.textContent = t("endscreen.lookup");
  look.title = `See the full story of ${word.toUpperCase()}`;
  look.setAttribute("aria-label", `See the full story of ${word.toUpperCase()}`);

  const intel = wordIntel(word);
  if (intel) {
    // Rich path: pre-generated definition + fact + quote. No network needed.
    def.textContent = intel.def;
    if (intel.fact) {
      const fact = document.createElement("div");
      fact.className = "ewc-fact";
      fact.textContent = intel.fact;
      card.appendChild(fact);
    }
    if (intel.quote) {
      const q = document.createElement("blockquote");
      q.className = "ewc-quote";
      q.textContent = `“${intel.quote}”`;
      if (intel.author) {
        const cite = document.createElement("cite");
        cite.textContent = `— ${intel.author}`;
        q.appendChild(cite);
      }
      card.appendChild(q);
    }
    card.appendChild(look);
    parent.appendChild(card);
    return;
  }

  // Fallback: live dictionary definition (no key, CORS-friendly). Never blocks the modal.
  def.textContent = t("endscreen.looking");
  card.appendChild(look);
  parent.appendChild(card);
  fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const d = Array.isArray(data) && data[0]?.meanings?.[0]?.definitions?.[0]?.definition;
      const pos = Array.isArray(data) && data[0]?.meanings?.[0]?.partOfSpeech;
      if (d) {
        def.textContent = pos ? `(${pos}) ${d}` : d;
      } else {
        def.textContent = t("endscreen.noEntry");
        def.classList.add("muted");
      }
    })
    .catch(() => {
      def.textContent = t("endscreen.offline");
      def.classList.add("muted");
    });
}

const STAT_BOX_IDS = ["statPlayed", "statWinPct", "statCurStreak", "statMaxStreak"];
// Replace the distribution area with a single muted note (no username / load fail).
function setStatsNote(msg) {
  for (const id of STAT_BOX_IDS) $("#" + id).textContent = "–";
  const dist = $("#dist");
  dist.textContent = "";
  const note = document.createElement("p");
  note.className = "muted dist-note";
  note.textContent = msg;
  dist.appendChild(note);
}

// Render the 1–6 guess-distribution bars from a {guesses: count} map.
function renderDist(distribution, highlight) {
  const dist = $("#dist");
  dist.textContent = "";
  const counts = [1,2,3,4,5,6].map((i) => distribution[i] || 0);
  const maxDist = Math.max(1, ...counts);
  for (let i = 1; i <= 6; i++) {
    const v = distribution[i] || 0;
    const isEmpty = v === 0;
    const row = document.createElement("div");
    row.className = "dist-row" + (i === highlight ? " current" : "") + (isEmpty ? " empty" : "");
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(i);
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "fill";
    // Empty rows use the CSS-set fixed width (24px). Non-empty rows scale by share
    // of the max bin, with a sensible floor so a single win is still readable.
    if (!isEmpty) {
      const pct = Math.max(14, Math.round((v / maxDist) * 100));
      fill.style.width = `${pct}%`;
    }
    fill.textContent = String(v);
    track.appendChild(fill);
    row.appendChild(num);
    row.appendChild(track);
    dist.appendChild(row);
  }
}

// Fetch the server profile and fill the stats boxes + distribution. The just-
// finished append may land a beat after the modal opens (room broadcasts finish
// and reports in parallel) — we accept eventual consistency; the next open is
// correct. No username → prompt to pick one; fetch failure → honest note.
async function fillStatsPanel(opts = {}) {
  const username = getUsername();
  if (!username) { setStatsNote(t("stats.needUsername")); return; }
  let stats;
  try {
    const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(String(res.status));
    stats = (await res.json()).stats;
  } catch {
    setStatsNote(t("stats.loadFailed"));
    return;
  }
  const played = stats.gamesPlayed || 0;
  $("#statPlayed").textContent = played;
  $("#statWinPct").textContent = played ? Math.round((stats.wins / played) * 100) : 0;
  $("#statCurStreak").textContent = stats.currentStreak || 0;
  $("#statMaxStreak").textContent = stats.bestStreak || 0;
  renderDist(stats.guessDistribution || {}, opts.justFinished && opts.won ? opts.lastGuessCount : null);
}

// --- Rematch handshake (client) ---------------------------------------------
// One source of truth for proposing + rendering the four end-screen states.
function opponentName() {
  const snap = game.snapshot;
  const me = getUsername();
  const other = snap?.players.find((p) => p.username !== me);
  return other?.username ?? "your opponent";
}

// The idle rematch button reads "Rematch" in the Arena (where it sits beside Join next /
// Create / Main menu) and "Play again" on friend/daily end screens.
function rematchLabel() {
  return t(game.fromArena ? "endscreen.rematch" : "endscreen.playAgain");
}

// Propose a rematch and morph the action into a cancellable waiting state. The
// waiting/accept/decline UI lives in the stats modal, so make sure it's open
// (proposing from the lobby #rematchBtn while the modal is closed otherwise gives
// no visible "Waiting…" feedback).
function proposeRematch() {
  const dsnap = game.snapshot;
  if (dsnap && dsnap.isDuel) {
    // Duel: "play again" means ready up for the next KOTH round (no rematch handshake).
    const meP = dsnap.players.find((p) => p.username === getUsername());
    if (meP && meP.role === "duelist") send({ type: "ready", ready: true });
    closeStats();
    return;
  }
  send({ type: "rematch_propose" });
  // Solo room: there's no opponent to wait on. The server starts a fresh game at
  // once and the round-start snapshot (plus rematch_accepted → closeStats) resets the
  // board — so skip the "Waiting for your opponent" state entirely and keep replay smooth.
  if ((game.snapshot?.players?.length ?? 1) <= 1) return;
  const modal = document.getElementById("statsModal");
  if (modal && modal.hidden) openStats();
  renderRematchWaiting(opponentName());
}

// Render helpers operate on the stats-modal action row (#modalPlayAgain) so the
// handshake lives where the player already is post-game. The button is reused;
// a sibling #rematchDecline is created on demand for the recipient prompt.
function rematchControls() {
  const play = document.getElementById("modalPlayAgain");
  let decline = document.getElementById("rematchDecline");
  if (!decline && play) {
    decline = document.createElement("button");
    decline.id = "rematchDecline";
    decline.className = play.className;
    play.parentNode.insertBefore(decline, play.nextSibling);
  }
  return { play, decline };
}

function renderRematchIdle() {
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) { play.hidden = false; play.disabled = false; play.textContent = rematchLabel(); play.onclick = proposeRematch; }
}

function renderRematchWaiting(who) {
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) {
    play.hidden = false;
    play.disabled = false;
    play.textContent = t("rematch.waiting", { who });
    play.onclick = () => { send({ type: "rematch_decline" }); renderRematchIdle(); }; // ✕ cancels my own
  }
}

function renderRematchPrompt(who) {
  const { play, decline } = rematchControls();
  if (play) { play.hidden = false; play.disabled = false; play.textContent = t("rematch.accept"); play.onclick = () => send({ type: "rematch_accept" }); }
  if (decline) { decline.hidden = false; decline.textContent = t("rematch.decline"); decline.onclick = () => { send({ type: "rematch_decline" }); renderRematchIdle(); }; }
  const eg = document.getElementById("endgameMsg");
  if (eg && !eg.querySelector(".rematch-prompt")) {
    eg.hidden = false;
    const line = document.createElement("div");
    line.className = "endgame-status rematch-prompt";
    line.textContent = t("rematch.prompt", { who });
    eg.prepend(line);
  }
}

// A cancelled proposal: one friendly line keyed to reason, then fade Home (~2s).
function settleRematchHome(reason, who) {
  const key = reason === "timeout" ? "rematch.timeout" : reason === "left" ? "rematch.left" : "rematch.declined";
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) { play.disabled = true; play.textContent = t(key, { who }); }
  clearTimeout(game.rematchSettleTimer);
  game.rematchSettleTimer = setTimeout(() => {
    game.rematchSettleTimer = null;
    closeStats(); leaveRoom(); showHub();
  }, 2000);
}

function openStats(opts = {}) {
  const modal = $("#statsModal");
  modal.hidden = false;
  modal.removeAttribute("hidden");
  // Stats are server-truth: the room reports every finished game to the player's
  // User DO, so we fetch the profile rather than keep a parallel local tally.
  // Async-fill the four boxes + distribution; the rest of the modal renders now.
  fillStatsPanel(opts);

  const eg = $("#endgameMsg");
  eg.textContent = "";
  eg.className = "endgame";
  if (opts.justFinished && opts.snap) {
    const snap = opts.snap;
    const winner = snap.winner; // winner username (string) or null
    // One short status line — the word itself (+ definition + lookup) lives in the
    // word card below, so we never repeat "the word was X" here.
    const status = document.createElement("span");
    status.className = "endgame-status";
    if (opts.inspire) {
      eg.classList.add("inspire");
      status.classList.add("inspire-line");
      status.textContent = opts.inspire;
    } else if (opts.won && winner && winner === getUsername()) {
      status.textContent = t("endscreen.youWon", { n: opts.lastGuessCount });
    } else if (winner) {
      const me = snap.players.find((p) => p.username === getUsername());
      const kind = me ? lossKind({
        status: me.status,
        guessCount: me.guesses?.length ?? 0,
        maxGuesses: snap.maxGuesses,
        winner,
        me: getUsername(),
      }) : "exhausted";
      status.textContent = kind === "outpaced"
        ? t("endscreen.outpaced", { who: winner })
        : t("endscreen.someoneWon", { who: winner });
    } else {
      status.textContent = t("endscreen.nobodyWon");
    }
    eg.appendChild(status);
    // The learning beat: the word, a definition, and a one-tap way to go deeper.
    renderWordCard(eg, snap.word);
    eg.hidden = false;
  } else {
    eg.hidden = true;
  }

  const finished = !!(game.snapshot && game.snapshot.phase === "finished");
  // Arena games get the "keep playing the Arena" action set; everyone else keeps the
  // plain Challenge + Play-again pair. .is-arena flips the CSS order so the buttons read
  // Join next → Rematch → Create → Main menu → Challenge (DOM order stays friend-screen).
  const arena = finished && game.fromArena === true;
  const actions = document.querySelector(".modal-actions");
  if (actions) actions.classList.toggle("is-arena", arena);

  const playAgain = $("#modalPlayAgain");
  if (finished) {
    playAgain.hidden = false;
    playAgain.onclick = proposeRematch;
    // Reset to the plain idle state; hide any stale decline button from a prior prompt.
    const stale = document.getElementById("rematchDecline");
    if (stale) stale.hidden = true;
    playAgain.textContent = rematchLabel(); // "Rematch" in the Arena, else "Play again"
    playAgain.disabled = false;
  } else {
    playAgain.hidden = true;
  }

  // The three Arena-only actions. Hidden (and inert) on every non-Arena end screen.
  const joinNext = document.getElementById("modalJoinNext");
  if (joinNext) { joinNext.hidden = !arena; joinNext.textContent = t("endscreen.joinNext"); joinNext.onclick = joinNextArena; }
  const createGame = document.getElementById("modalCreateGame");
  if (createGame) { createGame.hidden = !arena; createGame.textContent = t("endscreen.createGame"); createGame.onclick = hostPublicArena; }
  const mainMenu = document.getElementById("modalMainMenu");
  if (mainMenu) { mainMenu.hidden = !arena; mainMenu.textContent = t("endscreen.mainMenu"); mainMenu.onclick = backToMenu; }

  // Pre-render the share card so a later Share tap can fire navigator.share with a ready
  // blob (iOS rejects share() after an async toBlob). The canvas draw is 2x-DPR and heavy,
  // so run it AFTER the modal has painted (double-rAF) rather than on the open frame — it's
  // ready in tens of ms, long before anyone reads the results and taps Share.
  requestAnimationFrame(() => requestAnimationFrame(() => { void prepareShareCard(); }));

  // Challenge end screen: show how I did vs the standing record (re-fetched fresh —
  // my own run may have just set/beaten it). Cleared for non-challenge games.
  const recEl = document.getElementById("challengeRecordLine");
  if (recEl) recEl.textContent = "";
  if (game.challengeId && recEl) {
    const me = game.snapshot?.players.find((p) => p.username === getUsername());
    const myScore = me?.status === "won" ? `${me.guesses.length}/${game.snapshot.maxGuesses}` : `X/${game.snapshot.maxGuesses}`;
    fetch(`/api/challenge/${game.challengeId}/meta`).then((r) => r.json()).then((m) => {
      const rec = m.record ? `Record: @${m.record.username} ${m.record.score}` : "You set the first record!";
      const el = document.getElementById("challengeRecordLine");
      if (el) el.textContent = `You: ${myScore} · ${rec}`;
    }).catch(() => {});
  }

  $("#modalShare").onclick = () => shareResult();
  // The headline CTA: same share, explicit "throw down the gauntlet" framing.
  const challengeBtn = $("#modalChallenge");
  if (challengeBtn) challengeBtn.onclick = () => shareResult();

  const urlEl = $("#shareUrl");
  const copyBtn = $("#shareCopy");
  const row = $(".share-row");
  if (urlEl) urlEl.value = game.shareImage?.url ?? location.href;
  if (row) row.classList.toggle("no-native", typeof navigator.share !== "function");
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(game.shareImage?.url ?? location.href);
      copyBtn.textContent = "✓ Copied"; copyBtn.classList.add("ok");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("ok"); }, 1600);
    } catch { prompt("Copy this link:", game.shareImage?.url ?? location.href); }
  };

  modal.addEventListener("click", onModalClick);
}
function onModalClick(e) {
  if (e.target.matches("[data-close]")) closeStats();
}
function closeStats() {
  const modal = $("#statsModal");
  modal.hidden = true;
  modal.setAttribute("hidden", "");
  modal.removeEventListener("click", onModalClick);
}

// --- Share ---
// The share is an IMAGE card (score grid + the word + a "beat me" CTA with a link
// straight into this room), not plain text — something you'd actually want to send.

// Build the card and cache a PNG File so shareResult() can call navigator.share
// synchronously inside the click gesture (iOS requirement). Called on modal open.
async function prepareShareCard() {
  game.shareImage = null;
  const snap = game.snapshot;
  if (!snap || snap.phase !== "finished") return;
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;

  const maxG = snap.maxGuesses ?? 6;
  const won = me.status === "won";
  const score = won ? `${me.guesses.length}/${maxG}` : `X/${maxG}`;

  // Mint (or reuse) a challenge for THIS word so the card's CTA is a real replay link.
  // If we arrived via a challenge link already, reuse that id (don't re-mint the same word).
  let challengeId = game.challengeId;
  if (!challengeId) {
    try {
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: (snap.word || "").toUpperCase(),
          wordLength: snap.wordLength ?? 5,
          owner: getUsername(),
          ownerScore: score,
          ownerGrid: (me.guesses || []).map((g) => g.mask),
        }),
      });
      challengeId = (await res.json()).id;
    } catch { /* offline / mint failed — fall back to the room link below */ }
  }
  const cardUrl = challengeId
    ? `${location.origin}/c/${challengeId}`
    : `${location.origin}/@${game.owner}/${game.slug}`;

  // The card draws ONLY the color grid (no letters, no answer) — the model is the
  // no-spoiler guarantee, unit-tested in test/share-card.test.js.
  const model = buildShareCardModel({
    username: getUsername(), guesses: me.guesses || [], won, score,
    challengeUrl: cardUrl.replace(/^https?:\/\//, ""),
  });
  const canvas = renderShareCard(model, snap.wordLength ?? 5);
  const text = won
    ? `Solved Wordul in ${score} — beat me?`
    : `Wordul got me. Your turn?`;
  // Sync essentials available immediately; the File arrives a tick later.
  game.shareImage = { file: null, url: cardUrl, text, canvas };
  // The share row may have rendered before the mint resolved — backfill its URL field.
  const urlEl = $("#shareUrl");
  if (urlEl) urlEl.value = cardUrl;
  canvas.toBlob((blob) => {
    if (blob && game.shareImage && game.shareImage.canvas === canvas) {
      game.shareImage.file = new File([blob], "wordul.png", { type: "image/png" });
    }
  }, "image/png");
}

async function shareResult() {
  const img = game.shareImage;
  // Best: native share of the image card + room link.
  if (img?.file && navigator.canShare?.({ files: [img.file] })) {
    try {
      // iOS Messages drops a standalone `url` when a file is attached — the only
      // "link" left is the one painted into the PNG (not tappable). Fold the URL
      // into the text so the message body carries a real, tappable link.
      await navigator.share({ files: [img.file], text: `${img.text} ${img.url}` });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  // Native share without files (link only) where image sharing isn't supported.
  if (img && navigator.share) {
    try {
      await navigator.share({ text: img.text, url: img.url });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  // Desktop fallback: download the card image + copy the room link.
  if (img?.canvas) {
    downloadCanvas(img.canvas, "wordle-race.png");
    try {
      await navigator.clipboard.writeText(img.url);
      toast("Card saved · link copied — go invite someone!", { duration: 2800 });
    } catch {
      toast("Card saved", { duration: 2000 });
    }
    return;
  }
  // Last resort (no finished game): just share/copy a join link.
  const url = `${location.origin}/@${game.owner}/${game.slug}`;
  if (navigator.share) navigator.share({ text: "Race me on Wordul!", url }).catch(() => fallbackCopy(url));
  else fallbackCopy(url);
}

function fallbackCopy(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Copied to clipboard"),
    () => prompt("Copy this:", text),
  );
}

function downloadCanvas(canvas, name) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}


// --- top-level UI wiring ---
document.addEventListener("DOMContentLoaded", () => {
  applySettings(getSettings());
  // The avatar IS the hub: one tap opens settings / theme / mute / stats (and, in a
  // room, the mid-play-hidden share / rename / scoreboard). Replaces the old scattered
  // ⚙ / 📊 / 🔊 icons. The avatar glyph is the username's initial (no edition avatar field).
  const avatarBtn = $("#avatarBtn");
  if (avatarBtn) {
    syncAvatar();
    avatarBtn.addEventListener("click", () => showHub(avatarBtn));
  }
  // Clicking the logo always takes you home — the universal escape hatch.
  const brandBtn = $("#brandBtn");
  if (brandBtn) brandBtn.addEventListener("click", () => navigate("/"));
  // Global physical-keyboard handler — drives type-to-start on home/lobby and typing in-game.
  document.addEventListener("keydown", onPhysicalKey);
  route();
});

// Paint the avatar glyph from the username's first letter (a generic ◆ before the
// player picks a name). Called on load + whenever the username changes.
function syncAvatar() {
  const avatarBtn = $("#avatarBtn");
  if (!avatarBtn) return;
  const u = getUsername();
  avatarBtn.textContent = u ? u[0].toUpperCase() : "◆";
}

// Open the settings modal, wiring the orchestrator-owned bits (live re-render,
// theme picker, the keyboard layout picker mount, reset-stats) into settings.js.
// settings.js owns the modal chrome (chevron sections, toggle persistence, close);
// app.js only supplies callbacks for state it owns (game.snapshot, render, stats).
function showSettings() {
  const snap = game.snapshot;
  openSettings({
    inRoom: !!snap,
    // Mount the room's word-length picker into the gear's "Room" section (in a room only).
    mountRoomLength: snap ? () => syncLengthSelect(snap) : null,
    onChange: () => { if (game.snapshot) render(); },
    renderEditionPicker,
    // Theme is bound to the room: picking sends set_edition so the server rethemes
    // everyone. send() is a no-op with no open socket, so solo play just keeps the
    // local theme applyEdition already set. Locked mid-game (server enforces too).
    onEditionPick: (id) => send({ type: "set_edition", edition: id }),
    editionLocked: game.snapshot?.phase === "playing",
    toast: (t, o) => toast(t, o),
    // Mount the keyboard layout picker into the Advanced section. Owning the
    // save → rebuild → re-render here keeps settings.js free of a keyboard import
    // (keyboard.js imports settings.js, not the reverse — no cycle).
    mountLayoutPicker: (el) => renderLayoutPicker(el, {
      current: resolvedLayoutId(),
      onPick: (id) => {
        saveSettings({ ...getSettings(), keyboardLayout: id });
        buildKeyboard($("#keyboard"), id, keyboardHandlers);
        if (game.snapshot) render();
      },
    }),
  });
}

// The avatar hub: one popover that replaces the scattered ⚙/📊/🔊 icons and keeps
// the mid-play-hidden chrome (share / rename / scoreboard) reachable. settings.js
// builds + positions the menu; app.js wires every action since they touch app state.
function showHub(anchor) {
  const inRoom = !!game.snapshot;
  // Accounts P0: show "Secure this account" only when a name is set but not yet claimed.
  const needsSecure = getUsername() && !getSessionToken();
  openHub({
    anchor,
    inRoom,
    isMuted: localStorage.getItem("wordul.muted") === "1",
    onSettings: showSettings,
    onTheme: showSettings, // theme lives inside Settings (Appearance section)
    onStats: () => openStats(),
    onMute: toggleMute,
    onShare: inRoom ? () => shareRoomInvite() : null,
    onRename: inRoom ? () => renameRoom() : null,
    onScoreboard: inRoom ? () => scrollToScoreboard() : null,
    onSecure: needsSecure ? () => openSecureSheet(getUsername(), () => location.reload()) : null,
  });
}

// Flip the mute flag (companion voice + chimes already honor wordul.muted).
function toggleMute() {
  const muted = localStorage.getItem("wordul.muted") === "1";
  localStorage.setItem("wordul.muted", muted ? "0" : "1");
  toast(muted ? "Sound on" : "Muted", { duration: 1000 });
}

// Tear down any live room connection when leaving a room view.
function leaveRoom() {
  if (game.rematchSettleTimer) { clearTimeout(game.rematchSettleTimer); game.rematchSettleTimer = null; }
  stopCountdownOverlay(); // tear down a duel 3-2-1 overlay if we navigate away mid-countdown
  stopHeartbeat();
  game.challengeId = null;
  game.challengeMeta = null;
  clearPayoutTimers(); // cancel any pending payout/drain so it can't fire off-screen + mutate gold
  clearReconnectNotice();
  clearTimeout(game.reconnectTimer);
  game.reconnectTimer = null;
  game.reconnectAttempts = 0;
  game.pendingReconnect = null;
  if (game.socketSession) {
    game.socketSession.reconnect = false;
    const ws = game.socketSession.ws;
    game.socketSession = null;
    game.ws = null;
    try { ws.close(); } catch {}
  }
  clearHeaderIdentity(); // drop the in-room username + gold from the topbar header
  document.body.classList.remove("playing"); // restore full chrome outside a room
  document.body.classList.remove("daily");
  game.isDaily = false; game.dailyDate = null;
}

// The archive: every past day as a clickable list (data from /api/daily/dates).
async function showDailyArchive() {
  leaveRoom();
  mount("tpl-profile");
  const back = $("#profileBack"); if (back) back.onclick = (e) => { e.preventDefault(); navigate("/"); };
  document.title = "Wordul Daily — Archive";
  const mountEl = $("#profileMount");
  if (mountEl) mountEl.innerHTML = `<h1>${t("daily.archiveTitle")}</h1><ul class="daily-archive-list" id="dailyArchiveList"></ul>`;
  try {
    const res = await fetch("/api/daily/dates");
    const { dates } = res.ok ? await res.json() : { dates: [] };
    const list = $("#dailyArchiveList");
    if (list) for (const d of dates.slice().reverse()) {
      const li = document.createElement("li");
      const a = document.createElement("a"); a.href = `/daily/${d}`; a.textContent = d; a.className = "link";
      a.addEventListener("click", (e) => { e.preventDefault(); navigate(`/daily/${d}`); });
      li.appendChild(a); list.appendChild(li);
    }
  } catch { /* empty archive degrades to just the heading */ }
}

function showProfile(username) {
  leaveRoom();
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  document.title = `@${username} — Wordul`;
  mount("tpl-profile");
  const backBtn = $("#profileBack");
  if (backBtn) backBtn.onclick = (e) => { e.preventDefault(); navigate("/"); };
  renderProfile(username, $("#profileMount"));
}

// Breadcrumb trail under the brand — the one place that always knows "where am I".
// Home shows nothing (the brand alone is enough); rooms/profiles show a clickable
// "Home › <here>" so you can never get stranded deep in the app.
function renderCrumbs(r) {
  const nav = $("#crumbs");
  if (!nav) return;
  if (r.kind === "home") {
    nav.hidden = true;
    nav.innerHTML = "";
    return;
  }
  const here =
    r.kind === "room" ? r.slug.replace(/-/g, " ")
    : r.kind === "challenge" ? "challenge"
    : r.kind === "daily" ? "Daily"
    : r.kind === "daily-stats" ? "Stats"
    : r.kind === "daily-archive" ? "Archive"
    : r.kind === "arena" ? "Arena"
    : r.kind === "feed" ? "Lab"
    : r.kind === "feed-post" ? "Lab · " + r.date
    : r.kind === "world" ? (getWorld(r.slug)?.name ?? "World")
    : `@${r.username}`;
  nav.hidden = false;
  nav.innerHTML = "";
  const home = document.createElement("button");
  home.type = "button";
  home.className = "crumb crumb-link";
  home.textContent = "Home";
  home.addEventListener("click", () => navigate("/"));
  const sep = document.createElement("span");
  sep.className = "crumb-sep";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = "›";
  const cur = document.createElement("span");
  cur.className = "crumb crumb-current";
  cur.setAttribute("aria-current", "page");
  cur.textContent = here;
  nav.append(home, sep, cur);
}

// A World page (/w/<slug>): a themed place you can visit, share, and play in. Landing
// here is a TRY-ON — the skin is applied for this visit only (persist:false), never
// silently saved as the default. "Make this my default" is the only thing that commits.
// Live counts + "Join the live race" + SEO meta arrive in Plan 2; an unknown slug here
// goes Home (Plan 2 redirects to /worlds instead).
function showWorld(slug) {
  const world = getWorld(slug);
  if (!world) { navigate("/"); return; }
  document.title = `${world.name} — Wordul`;
  // Try-on: preview the skin without changing the saved default.
  applyEdition(world.editionId, { persist: false });

  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");

  const screen = document.createElement("section");
  screen.className = "screen world-screen";

  const back = document.createElement("a");
  back.href = "/"; back.className = "link world-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });

  const head = document.createElement("header");
  head.className = "world-head";
  const kicker = document.createElement("span");
  kicker.className = "daily-kicker"; kicker.textContent = "World";
  const h1 = document.createElement("h1");
  h1.className = "world-title"; h1.textContent = world.name;
  const blurb = document.createElement("p");
  blurb.className = "world-blurb muted"; blurb.textContent = world.blurb;
  head.append(kicker, h1, blurb);

  const actions = document.createElement("div");
  actions.className = "world-actions";

  const play = document.createElement("button");
  play.type = "button"; play.className = "btn block"; play.textContent = "Play solo →";
  play.addEventListener("click", () => {
    if (!getUsername()) { toast("Pick a username to play", { duration: 1800 }); navigate("/"); return; } // no identity yet — register on Home first
    enterNewRoom({ autoStart: true });
  });

  const makeDefault = document.createElement("button");
  makeDefault.type = "button"; makeDefault.className = "btn block ghost";
  makeDefault.textContent = "Make this my default theme";
  makeDefault.addEventListener("click", () => {
    setDefaultEdition(world.editionId);
    toast("Saved — this World is your default look now", { duration: 1600 });
  });

  actions.append(play, makeDefault);
  screen.append(back, head, actions);
  app.appendChild(screen);
}

function route() {
  stopArenaPoll(); // leaving the in-place Arena view (incl. browser Back / popstate) kills its poll
  const r = parseRoute();
  renderCrumbs(r);
  if (r.kind === "challenge") {
    showChallenge(r.id);
    return;
  }
  if (r.kind === "daily") { showDaily(r.date); return; }
  if (r.kind === "daily-stats") { showDailyStats(r.date); return; }
  if (r.kind === "daily-archive") { showDailyArchive(); return; }
  if (r.kind === "arena") { showArenaRoute(); return; }
  if (r.kind === "feed") { showFeed(); return; }
  if (r.kind === "feed-post") { showFeedPost(r.date); return; }
  if (r.kind === "world") { showWorld(r.slug); return; }
  if (r.kind === "room") {
    if (getUsername()) {
      showRoom(r.owner, r.slug);
    } else {
      showRoomEntry(r.owner, r.slug);
    }
  } else if (r.kind === "profile") {
    showProfile(r.username);
  } else {
    leaveRoom();
    showHome();
  }
}

window.addEventListener("popstate", route);
