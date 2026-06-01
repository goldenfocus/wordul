// Wordul — client
// Single-file SPA: home → room (lobby → playing → finished), localStorage stats.
import { generateRoomCode } from "/codes.js";
import { renderProfile } from "/profile.js";
import { applyEdition, getActiveEditionId, getGold, drainGold, companionReact, renderEditionPicker } from "/edition.js";
import { speakLine } from "/voice.js";
import { newGreensInLast, orderedDiscoveriesInLast, wastedDeadLettersInLast } from "/celebrate.js";
import { GOLD, comboMultiplier, awardGold, goldDrain, escalatedPenalty, renderGoldHud, playPayoutSequence } from "/gold.js";
import { createHacklog } from "/hacklog.js";
import { renderPowerups, resetPowerHints, handlePowerupMessage, bumpErrorCount, surfaceGiveUp, checkBankruptcy } from "/powerups.js";

// Apply the active edition at module load (before motion consts read WordulMotion).
applyEdition(getActiveEditionId());

const LS = {
  username: "wr.username",
  stats: "wr.stats",
  settings: "wr.settings",
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
const DEFAULT_SETTINGS = {
  hardMode: false,
  colorBlind: false,
  reducedMotion: false,
  keyboardLayout: "qwerty",
};
function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS.settings) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  localStorage.setItem(LS.settings, JSON.stringify(s));
  applySettings(s);
}
function applySettings(s) {
  document.body.classList.toggle("cb", !!s.colorBlind);
  document.body.classList.toggle("reduced-motion", !!s.reducedMotion);
}

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
  // Cookie cache so the server can recognise returning players if needed.
  document.cookie = `wr_user=${clean}; path=/; max-age=31536000; samesite=lax`;
  return clean;
}
function clearUsername() {
  localStorage.removeItem(LS.username);
  document.cookie = "wr_user=; path=/; max-age=0";
}

// One-time device-stats import guard. The backend exposes no /import endpoint
// (User DO only has /append + /room), and the legacy localStorage stats shape
// (aggregate counts, no per-game records) can't be cleanly mapped onto the
// server's per-game applyGame model. Per the plan's G4 fallback, we ship without
// import and just set the guard flag so the server profile starts fresh. The
// local stats stay on-device and still power the existing stats modal.
function importLocalStatsOnce(username) {
  const flag = "wr.imported." + username;
  if (localStorage.getItem(flag)) return;
  localStorage.setItem(flag, "1");
}

// --- stats ---
const DEFAULT_STATS = {
  played: 0, wins: 0,
  currentStreak: 0, maxStreak: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
};
function getStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS.stats) || "{}");
    return { ...DEFAULT_STATS, distribution: { ...DEFAULT_STATS.distribution }, ...raw };
  } catch {
    return { ...DEFAULT_STATS, distribution: { ...DEFAULT_STATS.distribution } };
  }
}
function saveStats(s) { localStorage.setItem(LS.stats, JSON.stringify(s)); }
function recordResult(won, guessCount) {
  const s = getStats();
  s.played += 1;
  if (won) {
    s.wins += 1;
    s.currentStreak += 1;
    s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    if (guessCount >= 1 && guessCount <= 6) {
      s.distribution[guessCount] = (s.distribution[guessCount] || 0) + 1;
    }
  } else {
    s.currentStreak = 0;
  }
  saveStats(s);
  return s;
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

// Cheeky rotating lines under the Start button — a third nudge type-to-start.
const START_PHRASES = [
  "The keyboard is already listening. Just start typing.",
  "No need to click. Type your first guess and go.",
  "Psst, your keyboard works right now. Try a word.",
  "Five letters, six tries, infinite bragging rights.",
  "Just type. We are listening for that first letter.",
  "Go on, type a word. The board is ready when you are.",
  "Your fingers know what to do. Start typing.",
  "Skip the click. Just spell something and watch it light up.",
  "A fresh word is waiting. Your move, smarty.",
  "Green is the goal. Yellow is a flirt. Gray is honest feedback.",
  "One word a day keeps the boredom away.",
  "Type now, gloat later.",
  "Trust your gut, then type the word that proves it.",
  "Warning, mild brilliance may occur.",
  "Start typing. The keyboard has been waiting all morning.",
  "Big brain energy starts with one little word.",
];

function showHome() {
  history.replaceState(null, "", "/");
  mount("tpl-home");
  const hint = $("#startHint");
  if (hint) hint.textContent = START_PHRASES[Math.floor(Math.random() * START_PHRASES.length)];
  // No chat available outside a room.
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;

  const input = $("#usernameInput");
  input.value = getUsername();
  buildHomeLengthSelect();

  // Two intents share one create→navigate→showRoom path; only autoStart differs.
  $("#startPlayingBtn").addEventListener("click", () => enterNewRoom({ autoStart: true }));
  $("#inviteFriendBtn").addEventListener("click", () => enterNewRoom({ autoStart: false }));
  // Enter in the username field is the spontaneous path → Start playing.
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

  // Filter tabs.
  $("#roomFilterRecent").addEventListener("click", () => setRoomFilter("recent"));
  $("#roomFilterYours").addEventListener("click", () => setRoomFilter("yours"));

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
    if (nameEl) nameEl.textContent = `@${u}`;
    loadHomeRooms(u);
  } else {
    if (greeting) greeting.hidden = true;
    if (intro) intro.hidden = false;
    if (rooms) rooms.hidden = true;
    const i = $("#usernameInput");
    if (i) i.focus();
  }
}

function buildHomeLengthSelect() {
  const sel = $("#homeLengthSelect");
  if (!sel) return;
  sel.textContent = "";
  const pref = getPreferredLength();
  for (const n of SUPPORTED_LENGTHS) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} letters`;
    if (n === pref) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    const n = parseInt(sel.value, 10);
    if (SUPPORTED_LENGTHS.includes(n)) setPreferredLength(n);
  });
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
  importLocalStatsOnce(username);
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
let homeRoomFilter = "recent";

async function loadHomeRooms(username) {
  homeRoomRows = [];
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

function setRoomFilter(filter) {
  homeRoomFilter = filter;
  const recentBtn = $("#roomFilterRecent");
  const yoursBtn = $("#roomFilterYours");
  const isRecent = filter === "recent";
  if (recentBtn) { recentBtn.classList.toggle("selected", isRecent); recentBtn.setAttribute("aria-selected", String(isRecent)); }
  if (yoursBtn) { yoursBtn.classList.toggle("selected", !isRecent); yoursBtn.setAttribute("aria-selected", String(!isRecent)); }
  renderRoomList();
}

function renderRoomList() {
  const list = $("#roomList");
  if (!list) return;
  const rows = homeRoomFilter === "yours" ? homeRoomRows.filter((r) => r.owned) : homeRoomRows;
  list.textContent = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "room-empty muted small";
    li.textContent = homeRoomFilter === "yours" ? "You haven't created any rooms yet." : "No rooms yet.";
    list.appendChild(li);
    return;
  }
  for (const row of rows) {
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
  // Length is decided by the room, so the picker is irrelevant here.
  $("#homeLengthSelect").hidden = true;
  $("#inviteFriendBtn").hidden = true;

  const input = $("#usernameInput");
  input.value = getUsername();
  input.focus();
  const btn = $("#startPlayingBtn");
  btn.textContent = "Join room →";
  const join = () => {
    const username = setUsername(input.value);
    if (username.length < 3) {
      input.focus();
      toast("Pick a username — at least 3 letters", { error: true, duration: 1800 });
      return;
    }
    importLocalStatsOnce(username);
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
const REVEAL_STAGGER_MS = window.WordulMotion?.revealStaggerMs ?? 220;
const REVEAL_FLIP_HALF_MS = window.WordulMotion?.flipHalfMs ?? 275; // matches the tile-reveal keyframe halfway point

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
  buildKeyboard();
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
        text: `Race me on Wordle in ${game.owner}'s room!`,
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
  if (renameBtn) {
    renameBtn.onclick = () => {
      const next = prompt("Rename this room:", game.name || game.slug);
      if (next == null) return;
      const clean = next.replace(/[\x00-\x1f\x7f<>]/g, "").trim().slice(0, 40);
      if (!clean) return;
      send({ type: "rename", name: clean });
    };
  }
  renderGoldHud();
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
function showCompanion(event, ctx) {
  const { text, raw, speak } = companionReact(event, ctx);
  if (!text) return;
  toast(text, { duration: 3200 });
  // Look up the clip by the RAW template; fall back to speaking the substituted text.
  if (speak) speakLine(getActiveEditionId(), raw, text);
}

// --- Idle taunts: the companion checks in when you go quiet mid-game. ---
let idleTimer = null;
const IDLE_FIRST_MS = 22000;
const IDLE_REPEAT_MS = 34000;

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
    surfaceGiveUp(powerupsCtx); // C4: idle long enough → offer the 💀 give-up escape hatch
    armIdle(IDLE_REPEAT_MS);
  }, delay);
}
function resetIdle() { armIdle(IDLE_FIRST_MS); }

// SPA navigation: pushState + re-dispatch the router.
function navigate(path) {
  history.pushState(null, "", path);
  route();
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
    }
    const me = msg.room.players.find((p) => p.username === getUsername());
    const prevMe = prev?.players.find((p) => p.username === getUsername());
    // Server accepted our guess → clear pending letters.
    if (me && prevMe && me.guesses.length > prevMe.guesses.length) {
      game.pending = "";
      // A valid guess landed. If it didn't end the game, the companion reacts —
      // and in Yang's edition, new greens get a scaled celebration instead.
      if (me.status === "playing") {
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
          setTimeout(() => {
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
              if (penalty > 0) setTimeout(runDrain, 350);
              if (log) setTimeout(() => log.collapse(), penalty > 0 ? 1100 : 700);
            });
          }, flipDoneMs);
        } else if (penalty > 0) {
          // No discoveries this guess — no payout to wait on; drain once the row flips.
          setTimeout(runDrain, flipDoneMs);
        }
        // Yang keeps its green party; other editions only get nudged on a dud guess.
        if (getActiveEditionId() === "yang" && ng >= 1) {
          setTimeout(() => celebrateGreens(ng), flipDoneMs);
        } else if (discoveries === 0) {
          showCompanion("wrong");
        }
        resetIdle();
      }
    }
    // Two ways to end the game from my perspective:
    //   (a) phase transitions to finished (someone won, or everyone is done)
    //   (b) I personally ran out of guesses while the room continues
    // Either fires the lose sequence (handleGameOver branches on won/lost).
    const phaseEnded = prev && prev.phase !== "finished" && msg.room.phase === "finished";
    const personallyLost = prevMe?.status === "playing" && me?.status === "lost";
    if ((phaseEnded || personallyLost) && !game.hasShownEndStats) {
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
    // Penalty: a non-word submit drains gold (clamped at 0) + a red hacker-log line.
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
    startBtn.hidden = false;
    $("#lobbyHint").textContent = snap.players.length < 2
      ? `Waiting for friends — share the link. (You can start solo too.)`
      : `${snap.players.length} players in.`;
  } else if (snap.phase === "playing") {
    lobby.hidden = true;
    endControls.hidden = true;
  } else if (snap.phase === "finished") {
    lobby.hidden = true;
    endControls.hidden = false;
    rematchBtn.hidden = false;
  }

  // Chat is social — keep it out of sight while you're playing solo, and only
  // surface it (inline on desktop, 💬 button on mobile) once someone else is in
  // the room. `me` is always in snap.players, so >= 2 means real company.
  const hasCompany = snap.players.length >= 2;
  const chatPanel = $("#chatPanel");
  const chatTopBtn = $("#chatTopBtn");
  if (chatPanel) chatPanel.hidden = !hasCompany;
  if (chatTopBtn) chatTopBtn.hidden = !hasCompany;
  if (!hasCompany) closeChatSheet();

  renderBoards(snap, me);
  renderKeyboard(me);
  renderChat(snap);
  renderScoreboard(snap);
  renderPowerups(powerupsCtx, snap, me);

  // Show the keyboard only when a guess is actually possible — keeps the lobby
  // unambiguous (no dead keys to mash) and post-game state minimal.
  const kb = $("#keyboard");
  const canType = snap.phase === "playing" && me && me.status === "playing";
  if (kb) kb.hidden = !canType;
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
  game.payingOut = false;
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
  for (let i = game.lastChatLen; i < chat.length; i++) {
    log.appendChild(renderChatRow(chat[i]));
  }
  const newCount = chat.length - game.lastChatLen;
  game.lastChatLen = chat.length;
  if (newCount > 0) {
    const panel = $("#chatPanel");
    const sheetOpen = panel?.classList.contains("sheet-open");
    const visible = isMobile() ? sheetOpen : !game.chatCollapsed;
    if (visible) {
      scrollChatToBottom();
    } else {
      game.unreadChat += newCount;
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
    const from = document.createElement("span");
    from.className = "from";
    from.textContent = entry.from + ":";
    row.appendChild(from);
    row.appendChild(document.createTextNode(entry.text));
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
    name.textContent = e.username + (e.username === me ? " (you)" : "");
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
    const nameSpan = document.createElement("span");
    if (p.username === getUsername()) nameSpan.className = "me";
    nameSpan.textContent = p.username + (p.username === getUsername() ? " (you)" : "");
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

function renderKeyboard(me) {
  // Build keyboard letter color map from MY guesses only.
  const map = {};
  const priority = { gray: 1, yellow: 2, green: 3 };
  if (me) {
    for (const g of me.guesses) {
      for (let i = 0; i < g.word.length; i++) {
        const k = g.word[i];
        const c = g.mask[i];
        if (!map[k] || priority[c] > priority[map[k]]) map[k] = c;
      }
    }
  }
  for (const key of $$(".key")) {
    key.classList.remove("green", "yellow", "gray");
    const v = key.dataset.key;
    if (v && map[v]) key.classList.add(map[v]);
  }
}

// --- Keyboard build & input ---

const KEYBOARD_LAYOUTS = {
  qwerty: ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"],
  azerty: ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"],
};
const KEYBOARD_LAYOUT_LABELS = { qwerty: "QWERTY", azerty: "AZERTY" };

function activeLayoutId() {
  const id = getSettings().keyboardLayout;
  return KEYBOARD_LAYOUTS[id] ? id : "qwerty";
}

let keyboardWired = false;
function buildKeyboard() {
  const layoutId = activeLayoutId();
  const rows = KEYBOARD_LAYOUTS[layoutId];
  const root = $("#keyboard");
  root.innerHTML = "";
  rows.forEach((letters, idx) => {
    const row = document.createElement("div");
    row.className = "kb-row";
    for (const l of letters) {
      const k = document.createElement("button");
      k.className = "key";
      k.textContent = l;
      k.dataset.key = l;
      row.appendChild(k);
    }
    // Match a real computer keyboard: ⌫ sits top-right (end of row 1), Enter
    // mid-right (end of row 2). The bottom row is letters only.
    if (idx === 0) {
      const back = document.createElement("button");
      back.className = "key wide";
      back.textContent = "⌫";
      back.dataset.action = "back";
      row.appendChild(back);
    } else if (idx === 1) {
      const enter = document.createElement("button");
      enter.className = "key wide";
      enter.textContent = "Enter";
      enter.dataset.action = "enter";
      row.appendChild(enter);
    }
    root.appendChild(row);
  });
  // Attach the delegated click handler exactly once. innerHTML clears children on
  // every rebuild (e.g. a layout switch) but leaves this root listener intact.
  if (!keyboardWired) {
    keyboardWired = true;
    root.addEventListener("click", (e) => {
      const t = e.target.closest("button.key");
      if (!t) return;
      if (t.dataset.action === "enter") submitGuess();
      else if (t.dataset.action === "back") backspace();
      else if (t.dataset.key) typeLetter(t.dataset.key);
    });
  }
}

// Settings: pick QWERTY / AZERTY. Rebuilds the on-screen keyboard live. Physical
// typing is unaffected — onPhysicalKey types by character, so layout is purely
// the visual + click order.
function renderLayoutPicker(rootEl) {
  rootEl.innerHTML = "";
  const current = activeLayoutId();
  for (const id of Object.keys(KEYBOARD_LAYOUTS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edition-chip" + (id === current ? " is-active" : "");
    btn.textContent = KEYBOARD_LAYOUT_LABELS[id] ?? id.toUpperCase();
    btn.addEventListener("click", () => {
      saveSettings({ ...getSettings(), keyboardLayout: id });
      rootEl.querySelectorAll(".edition-chip").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      buildKeyboard();
      if (game.snapshot) render();
    });
    rootEl.appendChild(btn);
  }
}

function onPhysicalKey(e) {
  // Don't hijack typing in any input fields, with modifiers, or while a modal is open.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
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
function playChime(notes) {
  if (localStorage.getItem("wordul.muted") === "1") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
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
function celebrateGreens(count) {
  const reduced = getSettings().reducedMotion;
  const boards = $("#boards");
  if (count >= 2) {
    playChime([[523, 0], [659, 0.09], [784, 0.18]]);
    if (!reduced) spawnConfetti(28);
    showCompanion("rush");
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
  "Wordle: 1. You: 0. The scoreboard speaks.",
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
  "{who} is now in your contacts as \"better at Wordle\".",
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
  game.finishReason = reason;
  recordResult(false, me.guesses.length); // a forfeit is a loss for local stats
  game.hasShownEndStats = true;
  showCompanion("loss", { answer: snap.word });
  triggerLoseSequence(snap, me);
}

function handleGameOver(snap) {
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  clearIdle();
  const won = me.status === "won";
  const guessCount = me.guesses.length;
  recordResult(won, guessCount);
  game.hasShownEndStats = true;
  // C4: record how the game ended (give-up / bankruptcy already set theirs before
  // reaching here via forfeit, which short-circuits this path).
  game.finishReason = won ? "solved" : "lost";

  if (won) {
    // Solve bonus + speed bonus (fewer guesses = richer) + the winning row's greens.
    const maxGuesses = snap.maxGuesses ?? 6;
    const finalGreens = newGreensInLast(me.guesses);
    const winGold = GOLD.solve
      + GOLD.speedPerGuessLeft * Math.max(0, maxGuesses - guessCount)
      + finalGreens * GOLD.green;
    awardGold(winGold, getSettings().reducedMotion);
    game.goldThisRound = (game.goldThisRound || 0) + winGold;
    showCompanion("win");
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
  const box = document.createElement("div");
  box.className = "endgame-replay";
  for (const turn of game.replay) {
    for (const ev of turn.events || []) {
      const line = document.createElement("div");
      line.className = `endgame-replay-line ${ev.delta >= 0 ? "gain" : "loss"}`;
      const sign = ev.delta >= 0 ? "+" : "−";
      line.textContent =
        `${ev.kind} ${String(ev.letter || "").toUpperCase()} pos ${ev.index + 1}  ${sign}${Math.abs(ev.delta)}`;
      box.appendChild(line);
    }
    if (turn.combo && turn.combo.discoveries >= 2) {
      const c = document.createElement("div");
      c.className = "endgame-replay-line combo";
      c.textContent = `✦ ${turn.combo.mult}× COMBO  +${turn.combo.bonus}`;
      box.appendChild(c);
    }
  }
  parent.appendChild(box);
}

function openStats(opts = {}) {
  const modal = $("#statsModal");
  modal.hidden = false;
  modal.removeAttribute("hidden");
  const s = getStats();
  $("#statPlayed").textContent = s.played;
  $("#statWinPct").textContent = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  $("#statCurStreak").textContent = s.currentStreak;
  $("#statMaxStreak").textContent = s.maxStreak;

  const dist = $("#dist");
  dist.textContent = "";
  const counts = [1,2,3,4,5,6].map((i) => s.distribution[i] || 0);
  const maxDist = Math.max(1, ...counts);
  const highlight = opts.justFinished && opts.won ? opts.lastGuessCount : null;
  for (let i = 1; i <= 6; i++) {
    const v = s.distribution[i] || 0;
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
    if (opts.joke) {
      // Loss path: roast joke prominent, then a quieter "The word was X" reveal.
      eg.classList.add("joke");
      const roast = document.createElement("span");
      roast.className = "roast";
      roast.textContent = `💀 ${opts.joke}`;
      eg.appendChild(roast);
      if (snap.word) {
        const reveal = document.createElement("span");
        reveal.className = "reveal";
        reveal.appendChild(document.createTextNode("The word was"));
        const w = document.createElement("span");
        w.className = "word";
        w.textContent = snap.word;
        reveal.appendChild(w);
        eg.appendChild(reveal);
      }
    } else if (opts.won && winner && winner === getUsername()) {
      eg.appendChild(document.createTextNode(`🎉 You got it in ${opts.lastGuessCount}!`));
    } else if (winner) {
      eg.appendChild(document.createTextNode(`${winner} got it. The word was`));
      if (snap.word) {
        eg.appendChild(document.createTextNode(" "));
        const w = document.createElement("span");
        w.className = "word";
        w.textContent = snap.word;
        eg.appendChild(w);
      }
    } else {
      eg.appendChild(document.createTextNode("Nobody got it. The word was"));
      if (snap.word) {
        eg.appendChild(document.createTextNode(" "));
        const w = document.createElement("span");
        w.className = "word";
        w.textContent = snap.word;
        eg.appendChild(w);
      }
    }
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
  $("#statsBtn").addEventListener("click", () => openStats());
  $("#settingsBtn").addEventListener("click", openSettings);
  // Mute toggle — companion voice + chimes already honor wordul.muted; this is the switch.
  const muteBtn = $("#muteBtn");
  if (muteBtn) {
    const syncMute = () => {
      const muted = localStorage.getItem("wordul.muted") === "1";
      muteBtn.textContent = muted ? "🔇" : "🔊";
      muteBtn.setAttribute("aria-pressed", String(muted));
    };
    syncMute();
    muteBtn.addEventListener("click", () => {
      const muted = localStorage.getItem("wordul.muted") === "1";
      localStorage.setItem("wordul.muted", muted ? "0" : "1");
      syncMute();
      toast(muted ? "Sound on" : "Muted", { duration: 1000 });
    });
  }
  // Global physical-keyboard handler — drives type-to-start on home/lobby and typing in-game.
  document.addEventListener("keydown", onPhysicalKey);
  route();
});

function openSettings() {
  const modal = $("#settingsModal");
  if (!modal) return;
  const s = getSettings();
  const hm = $("#setHardMode");
  const cb = $("#setColorBlind");
  const rm = $("#setReducedMotion");
  if (hm) hm.checked = s.hardMode;
  if (cb) cb.checked = s.colorBlind;
  if (rm) rm.checked = s.reducedMotion;

  // Wire toggles every open (idempotent — replace old listeners by cloning).
  const wire = (el, key) => {
    if (!el) return;
    const fresh = el.cloneNode(true);
    el.replaceWith(fresh);
    fresh.checked = s[key];
    fresh.addEventListener("change", () => {
      const next = { ...getSettings(), [key]: fresh.checked };
      saveSettings(next);
      if (game.snapshot) render(); // apply EZ/colorblind/etc. to the live board now
    });
  };
  wire(hm, "hardMode");
  wire(cb, "colorBlind");
  wire(rm, "reducedMotion");

  // Theme/edition picker. Picking applies the edition live; re-apply settings so
  // colorblind layers on top, and refresh the board to pick up new tile colors.
  const picker = $("#editionPicker");
  if (picker) {
    renderEditionPicker(picker, () => {
      applySettings(getSettings());
      if (game.snapshot) render();
      toast("Theme applied", { duration: 1000 });
    });
  }

  const layoutPicker = $("#layoutPicker");
  if (layoutPicker) renderLayoutPicker(layoutPicker);

  const reset = $("#resetStatsBtn");
  if (reset) {
    reset.onclick = () => {
      if (!confirm("Wipe all your stats? This can't be undone.")) return;
      saveStats({ ...DEFAULT_STATS, distribution: { ...DEFAULT_STATS.distribution } });
      toast("Stats reset", { duration: 1200 });
    };
  }

  modal.hidden = false;
  modal.removeAttribute("hidden");
  modal.addEventListener("click", onSettingsModalClick);
}
function onSettingsModalClick(e) {
  if (e.target.matches("[data-close-settings]")) closeSettings();
}
function closeSettings() {
  const modal = $("#settingsModal");
  modal.hidden = true;
  modal.setAttribute("hidden", "");
  modal.removeEventListener("click", onSettingsModalClick);
}

// Tear down any live room connection when leaving a room view.
function leaveRoom() {
  stopHeartbeat();
  if (game.ws) {
    try { game.ws.onclose = null; game.ws.close(); } catch {}
    game.ws = null;
  }
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

function route() {
  const r = parseRoute();
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
