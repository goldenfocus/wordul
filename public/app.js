// Wordul — client
// Single-file SPA: home → room (lobby → playing → finished), localStorage stats.
import { generateRoomCode } from "/codes.js";
import { renderProfile } from "/profile.js";
import { applyEdition, getActiveEditionId, getGold, drainGold, companionReact, renderEditionPicker, VOICE_EDITION } from "/edition.js";
import { speakLine, speakTemplated } from "/voice.js";
import { newGreensInLast, orderedDiscoveriesInLast, wastedDeadLettersInLast } from "/celebrate.js";
import { GOLD, comboMultiplier, awardGold, goldDrain, escalatedPenalty, renderGoldHud, playPayoutSequence } from "/gold.js";
import { createHacklog } from "/hacklog.js";
import { renderPowerups, resetPowerHints, handlePowerupMessage, bumpErrorCount, surfaceGiveUp, checkBankruptcy } from "/powerups.js";
import { activeLayoutId, buildKeyboard, renderKeyboard, renderLayoutPicker, detectLayout } from "/keyboard.js";
import { getSettings, saveSettings, applySettings, openSettings, openHub } from "/settings.js";
import { MODES, isAvailableMode } from "/modes.js";
import { t, initLang } from "/i18n.js";
import { wordIntel } from "/data/word-intel.js";

initLang(); // resolve language (saved pick → locale auto-detect) before any t() call

// Apply the active edition at module load (before motion consts read WordulMotion).
applyEdition(getActiveEditionId());

const LS = {
  username: "wr.username",
  preferredLength: "wr.length",
  replay: "wr.replay", // structured per-guess payout log, keyed per game (slug:round)
};

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
function parseRoute() {
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

  // Start lands in the lobby (never auto-start) so you can set theme + length
  // before the board goes live — the edition picker locks once playing.
  $("#startPlayingBtn").addEventListener("click", () => enterNewRoom({ autoStart: false }));
  // Enter in the username field is the spontaneous path → into the lobby.
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

// Toggle greeting vs. intro based on whether we know who the player is, and kick
// off the rooms fetch for returning users.
function renderHomeIdentity() {
  const u = getUsername();
  const greeting = $("#homeGreeting");
  const intro = $("#homeIntro");
  const rooms = $("#homeRooms");
  if (u) {
    if (greeting) greeting.hidden = false;
    if (intro) intro.hidden = true;
    const nameEl = $("#greetingName");
    if (nameEl) { nameEl.textContent = ""; nameEl.appendChild(userLink(u, { at: true })); }
    loadHomeRooms(u);
  } else {
    if (greeting) greeting.hidden = true;
    if (intro) intro.hidden = false;
    if (rooms) rooms.hidden = true;
    const i = $("#usernameInput");
    if (i) i.focus();
  }
}

// Shared create flow for both CTAs. autoStart=true → solo game begins on the
// first lobby snapshot (see onServerMessage); false → land in the lobby to invite.
function enterNewRoom({ autoStart }) {
  const input = $("#usernameInput");
  const username = setUsername(input ? input.value : getUsername());
  if (username.length < 3) {
    if (input) {
      input.focus();
      input.style.outline = "2px solid var(--error)";
      setTimeout(() => (input.style.outline = ""), 700);
    }
    toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
    return;
  }
  const slug = generateRoomCode();
  history.pushState(null, "", `/@${username}/${slug}`);
  showRoom(username, slug);
  // showRoom resets game state, so set the one-shot flag after it.
  if (autoStart) {
    game.autoStart = true;
  } else {
    // Invite path: hand over the link immediately (still in the click gesture, so
    // navigator.share is allowed) rather than making them find the lobby button.
    shareRoomInvite();
  }
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

function renderRoomList() {
  const list = $("#roomList");
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
  const shown = rows.slice(0, homeRoomVisible);
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
  const remaining = rows.length - shown.length;
  if (remaining > 0) {
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
  owner: null,
  slug: null,
  path: null,
  name: null,
  snapshot: null,
  pending: "",       // current guess being typed
  toastTimer: null,
  hasShownEndStats: false,
  lastGuessCounts: new Map(),
  // Chat state: how many entries we'd already rendered so we can flag new ones for
  // the unread badge while the panel is collapsed.
  lastChatLen: 0,
  unreadChat: 0,
  chatCollapsed: false,
  exploding: false,
  reconnectToastTimer: null,
  heartbeatTimer: null,
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
  game.autoStart = false;
  game.roomTab = "play";
  game.shareImage = null;
  game.replay = [];
  game.payingOut = false;
  // tpl-room mounts a FRESH #hacklog node, so drop any stale terminal bound to the
  // previous room's (now-detached) element — it's re-created lazily on first payout.
  hacklog = null;
  mount("tpl-room");
  renderRoomHeader();
  const hasNativeShare = typeof navigator.share === "function";
  const inviteLabel = $("#inviteLabel");
  if (inviteLabel) inviteLabel.textContent = hasNativeShare ? "Share" : "Copy link";
  $("#inviteBtn").addEventListener("click", () => shareRoomInvite());
  $("#startBtn").addEventListener("click", () => send({ type: "start" }));
  $("#rematchBtn").addEventListener("click", () => {
    game.hasShownEndStats = false;
    closeStats();
    send({ type: "rematch" });
  });
  wireChat();
  wireRoomTabs();
  buildKeyboard($("#keyboard"), resolvedLayoutId(), keyboardHandlers);
  connect();
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
    const ok = $("#copyOk");
    if (ok) { ok.hidden = false; setTimeout(() => (ok.hidden = true), 1500); }
    toast("Link copied — send it to a friend!", { duration: 2400 });
  } catch {
    prompt("Copy this link:", inviteUrl);
  }
}

// Render the room name + owner + a rename affordance. Control is shared (anyone
// present can rename), matching the server's "kindness model".
function renderRoomHeader() {
  const nameEl = $("#roomName");
  const ownerEl = $("#roomOwner");
  if (nameEl) nameEl.textContent = game.name || game.slug;
  if (ownerEl) {
    ownerEl.textContent = `@${game.owner}`;
    ownerEl.href = `/@${game.owner}`;
    ownerEl.onclick = (e) => { e.preventDefault(); navigate(`/@${game.owner}`); };
  }
  const renameBtn = $("#renameBtn");
  if (renameBtn) renameBtn.onclick = renameRoom;
  renderHeaderIdentity();
  renderGoldHud();
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
  // Big moments linger; routine lines stay snappy.
  const big = tier && !(event === "wrong" && tier === "normal");
  toast(text, { duration: big ? 4200 : 3200 });
  if (!speak) return;
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
  history.pushState(null, "", path);
  route();
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

const RECONNECT_DELAY_MS = 600;
const RECONNECT_TOAST_AFTER_MS = 1500; // suppress toast if reconnect succeeds within this window
const HEARTBEAT_MS = 25_000;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?room=${encodeURIComponent(game.path)}`;
  const ws = new WebSocket(url);
  game.ws = ws;

  ws.addEventListener("open", () => {
    // Clear any "reconnecting" UI state once we're back.
    clearTimeout(game.reconnectToastTimer);
    game.reconnectToastTimer = null;
    setConnectionStatus("ok");
    send({
      type: "hello",
      username: getUsername(),
      wordLength: getPreferredLength(),
      edition: getActiveEditionId(), // seeds a fresh room with the creator's theme
      mode: "race", // only valid selectable mode today
    });
    // Kick off heartbeat so the path stays warm.
    startHeartbeat();
  });

  ws.addEventListener("message", (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "pong") return; // heartbeat reply — no-op
    onServerMessage(msg);
  });

  ws.addEventListener("close", () => {
    stopHeartbeat();
    setConnectionStatus("reconnecting");
    // Only show the toast if the reconnect actually takes a while. Most close
    // events on mobile are fleeting (background tab, signal blip) and resolve
    // before the user notices.
    game.reconnectToastTimer = setTimeout(
      () => toast("Reconnecting…", { duration: 4000 }),
      RECONNECT_TOAST_AFTER_MS,
    );
    setTimeout(connect, RECONNECT_DELAY_MS);
  });
}

function startHeartbeat() {
  stopHeartbeat();
  game.heartbeatTimer = setInterval(() => {
    if (game.ws?.readyState === WebSocket.OPEN) {
      try { game.ws.send(JSON.stringify({ type: "ping" })); } catch {}
    }
  }, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (game.heartbeatTimer) {
    clearInterval(game.heartbeatTimer);
    game.heartbeatTimer = null;
  }
}

function setConnectionStatus(state) {
  // Subtle topbar indicator: pulse on the brand dot when reconnecting.
  const dot = document.querySelector(".brand-dot");
  if (!dot) return;
  if (state === "ok") {
    dot.style.color = "";
    dot.style.animation = "";
  } else {
    dot.style.color = "var(--error)";
    dot.style.animation = "pulse 0.9s ease-in-out infinite";
  }
}

function send(msg) {
  if (game.ws && game.ws.readyState === WebSocket.OPEN) {
    game.ws.send(JSON.stringify(msg));
  }
}

function onServerMessage(msg) {
  if (msg.type === "snapshot") {
    const prev = game.snapshot;
    game.snapshot = msg.room;
    // The room owns the theme: adopt it whenever it differs from what's applied. This is
    // how invitees inherit the host's theme and how a live change reaches everyone. applyEdition
    // also persists it locally, so your last room's vibe sticks into your next solo game.
    if (msg.room.edition && msg.room.edition !== getActiveEditionId()) {
      applyEdition(msg.room.edition);
      applySettings(getSettings()); // re-layer colorblind/contrast on the new palette
    }
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
      send({ type: "start" });
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
        // Yang keeps its green party; other editions only get nudged on a dud guess.
        if (getActiveEditionId() === "yang" && ng >= 1) {
          setTimeout(() => celebrateGreens(ng), flipDoneMs);
        } else if (discoveries === 0) {
          showCompanion("wrong", { reusedDeadLetter: wasted.letters.length > 0 });
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
    if ((phaseEnded || personallyLost || personallyWon) && !game.hasShownEndStats) {
      handleGameOver(msg.room);
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
  } else if (msg.type === "revealed_letter" || msg.type === "vowels") {
    handlePowerupMessage(powerupsCtx, msg);
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
  const snap = game.snapshot;
  const me = snap.players.find((p) => p.username === getUsername());

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
    syncLengthSelect(snap);
    syncModePicker(snap);
    syncLobbyEdition();
    startBtn.hidden = false;
    $("#lobbyHint").textContent = snap.players.length < 2
      ? `Waiting for friends · start solo anytime`
      : `${snap.players.length} players in`;
  } else if (snap.phase === "playing") {
    lobby.hidden = true;
    endControls.hidden = true;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  } else if (snap.phase === "finished") {
    lobby.hidden = true;
    endControls.hidden = false;
    rematchBtn.hidden = false;
    const mc = $("#modeControl"); if (mc) mc.hidden = true;
  }

  syncModeChip(snap);

  // Chat is social — keep it out of sight while you're playing solo, and only
  // surface it (inline on desktop, 💬 button on mobile) once someone else is in
  // the room. `me` is always in snap.players, so >= 2 means real company.
  const hasCompany = snap.players.length >= 2;
  const chatPanel = $("#chatPanel");
  const chatTopBtn = $("#chatTopBtn");
  if (chatPanel) chatPanel.hidden = !hasCompany;
  if (chatTopBtn) chatTopBtn.hidden = !hasCompany;
  if (!hasCompany) closeChatSheet();

  // Immersive UI (C5): mid-play, the in-game header collapses to just avatar +
  // username + gold. Room name, ✎ rename, Share ↗, and the scoreboard hide while
  // you're guessing (all reachable via the avatar hub) and return in lobby/finished.
  setChromeVisibility(snap.phase);

  renderBoards(snap, me);
  renderKeyboard($("#keyboard"), me);
  renderChat(snap);
  renderScoreboard(snap);
  renderGames(snap);
  applyTabVisibility(snap.phase === "playing");
  renderPowerups(powerupsCtx, snap, me);

  // Show the keyboard only when a guess is actually possible — keeps the lobby
  // unambiguous (no dead keys to mash) and post-game state minimal.
  const kb = $("#keyboard");
  const canType = snap.phase === "playing" && me && me.status === "playing";
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
  control.hidden = false;
  $("#modeHeading").textContent = t("mode.heading");

  // Build rows once.
  if (list.children.length === 0) {
    for (const id of Object.keys(MODES)) {
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

      if (isAvailableMode(id)) {
        li.tabIndex = 0;
        const choose = () => send({ type: "set_mode", mode: id });
        li.addEventListener("click", choose);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
        });
      } else {
        li.classList.add("locked");
        li.setAttribute("aria-disabled", "true");
        tag.textContent = `${t("mode.comingSoon")} 🔒`;
      }
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
  chip.textContent = t(`mode.${snap.mode}.label`);
  // Read-only chip shows whenever the interactive picker is hidden (playing /
  // finished) — late-joiners mid-play still see the mode.
  chip.hidden = snap.phase === "lobby";
}

function syncLengthSelect(snap) {
  const wrap = $("#lengthControl");
  const sel = $("#lengthSelect");
  if (!wrap || !sel) return;
  wrap.hidden = false;
  // Build options once.
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
  if (parseInt(sel.value, 10) !== snap.wordLength) sel.value = String(snap.wordLength);
}

// Theme picker in the lobby — set the room's vibe before you start or invite. Picking
// sends set_edition so it themes everyone (same path as the Settings picker). The active
// chip tracks the room's edition because the snapshot handler applies it before we render.
function syncLobbyEdition() {
  const wrap = $("#editionControl");
  const mount = $("#lobbyEditionPicker");
  if (!wrap || !mount) return;
  wrap.hidden = false;
  renderEditionPicker(mount, (id) => {
    applySettings(getSettings()); // re-layer colorblind/contrast on the new palette
    send({ type: "set_edition", edition: id });
    if (game.snapshot) render();
  });
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
    tally.textContent = `${e.wins}W · ${e.played}P`;
    row.appendChild(name);
    row.appendChild(tally);
    root.appendChild(row);
  }
}

function renderBoards(snap, me) {
  const root = $("#boards");
  const ordered = [
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
        }
        row.appendChild(tile);
      }
      // One-shot line clear: tap your active row to wipe the whole guess (no Delete button).
      if (isMe && isCurrentRow && snap.phase === "playing" && p.status === "playing") {
        row.classList.add("input-row");
        row.addEventListener("click", () => {
          if (game.pending.length) { game.pending = ""; render(); resetIdle(); }
        });
      }
      grid.appendChild(row);
    }
    board.appendChild(grid);
    root.appendChild(board);
    game.lastGuessCounts.set(p.username, p.guesses.length);
  }
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
const keyboardHandlers = { onEnter: submitGuess, onBack: backspace, onLetter: typeLetter };

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
      send({ type: "start" }); e.preventDefault();
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
  else if (e.key === "Backspace") { backspace(); e.preventDefault(); }
  else if (isLetter) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
}

function typeLetter(l) {
  if (!game.snapshot || game.snapshot.phase !== "playing") return;
  if (game.pending.length >= game.snapshot.wordLength) return;
  game.pending += l.toUpperCase();
  render();
  resetIdle();
}
function backspace() {
  if (game.pending.length === 0) return;
  game.pending = game.pending.slice(0, -1);
  render();
  resetIdle();
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
  for (let i = 0; i < pieces; i++) {
    const c = document.createElement("div");
    c.className = "cheer-confetti";
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    c.style.left = `${Math.random() * 100}vw`;
    c.style.setProperty("--cf-x", `${(Math.random() - 0.5) * 140}px`);
    c.style.setProperty("--cf-rot", `${(Math.random() - 0.5) * 900}deg`);
    c.style.setProperty("--cf-delay", `${Math.random() * 250}ms`);
    c.style.setProperty("--cf-dur", `${1200 + Math.random() * 900}ms`);
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2400);
  }
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

// Generic "you ate the L" jokes — when you ran out of guesses on your own.
const SOLO_LOSE_JOKES = [
  "Plot twist: the word was inside you all along. ...nope, never mind, it wasn't.",
  "Five letters. Six guesses. Infinite regret.",
  "Statistically, this happens to exactly one in one of you.",
  "Your dictionary called. It wants a refund.",
  "Even the alphabet feels bad for you right now.",
  "There are no losers here. Just you, specifically.",
  "Wordul: 1. You: 0. The scoreboard speaks.",
  "Take comfort — somewhere, an etymologist is also crying.",
  "Your guesses formed a strong, structured wall of wrongness.",
  "An L isn't great. But it IS one of the letters.",
  "Have you considered just guessing the right word? Wild idea, I know.",
  "Reminder: crosswords give you the words for free.",
  "Don't worry, the word also doesn't know how to find you.",
  "You came so close. Then very, very far.",
];

// Tease-the-loser jokes — used when someone else won first. {who} = winner nickname.
const RACE_LOSE_JOKES = [
  "{who} just smoked you. Like, athletically.",
  "{who} solved it. Maybe try standing closer to the screen next time.",
  "{who} got the W. You got the L. The L is for Learning.",
  "{who} is faster than you at words. And probably other things too.",
  "{who} cooked. You watched.",
  "{who} knew the word. You knew vibes.",
  "{who} found it first. You found out about it.",
  "Imagine losing to {who}. Couldn't be me. (Wait — it was you.)",
  "{who} touched grass. The grass spelled the answer.",
  "{who} is now in your contacts as \"better at worduling\".",
];

// C4: self-inflicted ends get their own roast. Tapping 💀 to give up…
const GAVE_UP_JOKES = [
  "You tapped the skull. The skull respects your honesty.",
  "Strategic retreat! …is one way to put it.",
  "Quitting: technically a decision. Bold of you.",
  "You folded. The word never even broke a sweat.",
  "Surrender accepted. Your dignity has been refunded in full.",
  "Some words aren't worth fighting. This one definitely was. Oops.",
];
// …and bankrupting yourself in Hard Mode.
const BANKRUPT_JOKES = [
  "Bankrupt. You spent gold like it grew on tiles.",
  "◆ in the red. Hard Mode sends its regards (and an invoice).",
  "You bought your way to a loss. Truly the premium experience.",
  "Negative gold, negative result. At least it's consistent.",
  "The bank called. They'd like their gold back. All of it.",
  "Hard Mode finally has teeth, and it just ate your wallet.",
];

function pickJoke(arr, winnerName) {
  const j = arr[Math.floor(Math.random() * arr.length)];
  return winnerName ? j.replace("{who}", winnerName) : j;
}

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
  const winner = snap.winner;
  const beatenBySomeone = winner && winner !== getUsername();
  // C4: self-inflicted ends (gave up / went bankrupt) own the roast even in a race —
  // you ended your own game, so the joke is about you, not the winner.
  let joke;
  if (game.finishReason === "gave_up") joke = pickJoke(GAVE_UP_JOKES);
  else if (game.finishReason === "bankrupt") joke = pickJoke(BANKRUPT_JOKES);
  else if (beatenBySomeone) joke = pickJoke(RACE_LOSE_JOKES, winner);
  else joke = pickJoke(SOLO_LOSE_JOKES);

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
      joke,
    });
  }, 1500);
}

// --- Stats modal ---

// "Your run, line by line." Render the captured replay (game.replay) into the
// end-screen as a small monospace log — the same structured events the payout typed,
// now a scannable summary. Skips silently when there's nothing to show.
function renderReplayInto(parent) {
  if (!game.replay || game.replay.length === 0) return;
  // Tuck the per-beat breakdown behind a collapsed disclosure — it's there for the
  // curious, but the win moment shouldn't open onto a wall of "+100 / +50" lines.
  const details = document.createElement("details");
  details.className = "endgame-replay-details";
  const summary = document.createElement("summary");
  summary.textContent = t("endscreen.goldBreakdown");
  details.appendChild(summary);
  const box = document.createElement("div");
  box.className = "endgame-replay";
  for (const turn of game.replay) {
    for (const ev of turn.events || []) {
      const line = document.createElement("div");
      line.className = `endgame-replay-line ${ev.delta >= 0 ? "gain" : "loss"}`;
      const sign = ev.delta >= 0 ? "+" : "−";
      // Tile events carry a letter + index; the solve/speed bonuses don't — render them plainly.
      const label = String(ev.letter || "").toUpperCase();
      const pos = Number.isInteger(ev.index) ? ` pos ${ev.index + 1}` : "";
      line.textContent =
        `${ev.kind}${label ? " " + label : ""}${pos}  ${sign}${Math.abs(ev.delta)}`;
      box.appendChild(line);
    }
    if (turn.combo && turn.combo.discoveries >= 2) {
      const c = document.createElement("div");
      c.className = "endgame-replay-line combo";
      c.textContent = `✦ ${turn.combo.mult}× COMBO  +${turn.combo.bonus}`;
      box.appendChild(c);
    }
  }
  details.appendChild(box);
  parent.appendChild(details);
}

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

  const def = document.createElement("div");
  def.className = "ewc-def";
  card.appendChild(def);

  const look = document.createElement("a");
  look.className = "ewc-look";
  look.href = `https://www.google.com/search?q=${encodeURIComponent(w + " meaning")}`;
  look.target = "_blank";
  look.rel = "noopener";
  look.textContent = t("endscreen.lookup");

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
  // Your score is your gold. Headline the run's earnings + the running balance.
  if (opts.justFinished) {
    const goldLine = document.createElement("div");
    goldLine.className = "endgame-gold";
    goldLine.textContent = `◆ +${game.goldThisRound || 0} this game · ◆ ${getGold()} total`;
    eg.appendChild(goldLine);
    // Your run, line by line — the captured replay (client-side now; server viewer gated).
    renderReplayInto(eg);
  }
  if (opts.justFinished && opts.snap) {
    const snap = opts.snap;
    const winner = snap.winner; // winner username (string) or null
    // One short status line — the word itself (+ definition + lookup) lives in the
    // word card below, so we never repeat "the word was X" here.
    const status = document.createElement("span");
    status.className = "endgame-status";
    if (opts.joke) {
      eg.classList.add("joke");
      status.classList.add("roast");
      status.textContent = `💀 ${opts.joke}`;
    } else if (opts.won && winner && winner === getUsername()) {
      status.textContent = t("endscreen.youWon", { n: opts.lastGuessCount });
    } else if (winner) {
      status.textContent = t("endscreen.someoneWon", { who: winner });
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

  const playAgain = $("#modalPlayAgain");
  const snap = game.snapshot;
  if (snap && snap.phase === "finished") {
    playAgain.hidden = false;
    playAgain.onclick = () => {
      game.hasShownEndStats = false;
      closeStats();
      send({ type: "rematch" });
    };
  } else {
    playAgain.hidden = true;
  }

  // Pre-render the share card now (modal open) so the Share click can fire
  // navigator.share synchronously — iOS rejects share() after an async toBlob.
  prepareShareCard();
  $("#modalShare").onclick = () => shareResult();

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
function prepareShareCard() {
  game.shareImage = null;
  const snap = game.snapshot;
  if (!snap || snap.phase !== "finished") return;
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;

  const maxG = snap.maxGuesses ?? 6;
  const won = me.status === "won";
  const score = won ? `${me.guesses.length}/${maxG}` : `X/${maxG}`;
  const roomUrl = `${location.origin}/@${game.owner}/${game.slug}`;
  const canvas = renderResultCanvas({
    guesses: me.guesses || [],
    won,
    score,
    cols: snap.wordLength ?? 5,
    word: (snap.word || "").toUpperCase(),
    shortUrl: roomUrl.replace(/^https?:\/\//, ""),
  });
  const text = won
    ? `Solved Wordul in ${score} — beat me?`
    : `Wordul got me. Your turn?`;
  // Sync essentials available immediately; the File arrives a tick later.
  game.shareImage = { file: null, url: roomUrl, text, canvas };
  canvas.toBlob((blob) => {
    if (blob && game.shareImage && game.shareImage.canvas === canvas) {
      game.shareImage.file = new File([blob], "wordle-race.png", { type: "image/png" });
    }
  }, "image/png");
}

async function shareResult() {
  const img = game.shareImage;
  // Best: native share of the image card + room link.
  if (img?.file && navigator.canShare?.({ files: [img.file] })) {
    try {
      await navigator.share({ files: [img.file], text: img.text, url: img.url });
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

// Draw the result card. Portrait, dark-themed to match the app; retina-sharp via dpr.
function renderResultCanvas({ guesses, won, score, cols, word, shortUrl }) {
  const dpr = 2;
  const W = 560;
  const P = 40;
  const gap = 8;
  const tile = Math.min(64, Math.floor((W - 2 * P - (cols - 1) * gap) / cols));
  const gridW = cols * tile + (cols - 1) * gap;
  const gridX = (W - gridW) / 2;
  const rows = guesses.length;
  const gridH = rows > 0 ? rows * tile + (rows - 1) * gap : 0;

  const SEC = { header: 38, score: 46, word: word ? 30 : 0, cta: 64 };
  const H = P + SEC.header + 22 + SEC.score + 24 + gridH
    + (word ? 22 + SEC.word : 0) + 26 + SEC.cta + P;

  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#121213";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  let cy = P;

  // Header: WORDLE ● RACE
  drawHeader(ctx, W / 2, cy + SEC.header / 2, FONT);
  cy += SEC.header + 22;

  // Score line
  ctx.font = `800 36px ${FONT}`;
  ctx.fillStyle = won ? "#538d4e" : "#a6a6a8";
  ctx.fillText(won ? `Solved in ${score}` : `Stumped · ${score}`, W / 2, cy + SEC.score / 2);
  cy += SEC.score + 24;

  // Grid of guesses
  const COLORS = { green: "#538d4e", yellow: "#b59f3b", gray: "#565758" };
  let gy = cy;
  for (let r = 0; r < rows; r++) {
    const g = guesses[r];
    for (let c = 0; c < cols; c++) {
      const x = gridX + c * (tile + gap);
      roundRect(ctx, x, gy, tile, tile, 6);
      ctx.fillStyle = COLORS[g.mask[c]] || "#3a3a3c";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${Math.floor(tile * 0.5)}px ${FONT}`;
      ctx.fillText((g.word[c] || "").toUpperCase(), x + tile / 2, gy + tile / 2 + 1);
    }
    gy += tile + gap;
  }
  cy += gridH;

  // The word
  if (word) {
    cy += 22;
    ctx.font = `600 23px ${FONT}`;
    ctx.fillStyle = "#bdbdbf";
    ctx.fillText(`The word: ${word}`, W / 2, cy + SEC.word / 2);
    cy += SEC.word;
  }

  // CTA pill: "Beat my score →" + link
  cy += 26;
  roundRect(ctx, P, cy, W - 2 * P, SEC.cta, 12);
  ctx.fillStyle = "#538d4e";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText("Beat my score →", W / 2, cy + SEC.cta / 2 - 11);
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(shortUrl, W / 2, cy + SEC.cta / 2 + 13);

  return canvas;
}

function drawHeader(ctx, cx, cy, font) {
  ctx.font = `800 30px ${font}`;
  const left = "WORDLE";
  const right = "RACE";
  const lw = ctx.measureText(left).width;
  const rw = ctx.measureText(right).width;
  const dot = 14;
  const sp = 12;
  const total = lw + sp + dot + sp + rw;
  let x = cx - total / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  ctx.fillText(left, x, cy);
  x += lw + sp;
  ctx.fillStyle = "#538d4e";
  ctx.beginPath();
  ctx.arc(x + dot / 2, cy, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  x += dot + sp;
  ctx.fillStyle = "#fff";
  ctx.fillText(right, x, cy);
  ctx.textAlign = "center";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  openSettings({
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
  stopHeartbeat();
  clearPayoutTimers(); // cancel any pending payout/drain so it can't fire off-screen + mutate gold
  if (game.ws) {
    try { game.ws.onclose = null; game.ws.close(); } catch {}
    game.ws = null;
  }
  clearHeaderIdentity(); // drop the in-room username + gold from the topbar header
  document.body.classList.remove("playing"); // restore full chrome outside a room
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
  const here = r.kind === "room" ? r.slug.replace(/-/g, " ") : `@${r.username}`;
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

function route() {
  const r = parseRoute();
  renderCrumbs(r);
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
