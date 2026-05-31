// Wordle Race — client
// Single-file SPA: home → room (lobby → playing → finished), localStorage stats.
import { generateRoomCode } from "/codes.js";
import { renderProfile } from "/profile.js";

const LS = {
  username: "wr.username",
  stats: "wr.stats",
  settings: "wr.settings",
  preferredLength: "wr.length",
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

function showHome() {
  history.replaceState(null, "", "/");
  mount("tpl-home");
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
  $(".tagline").textContent = `Join @${owner}'s Wordle Race room.`;
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
};
const REVEAL_STAGGER_MS = 220;
const REVEAL_FLIP_HALF_MS = 275; // matches the 0.55s tile-reveal keyframe halfway point

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
        title: `Wordle Race — ${game.name || game.slug}`,
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
}

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
    // "Start playing" one-shot: kick off the solo game as soon as we're in the
    // lobby. Cleared immediately so a reconnect (which replays a snapshot) can't
    // re-trigger it, and lobby-gated so it never fires mid-game.
    if (game.autoStart && msg.room.phase === "lobby") {
      game.autoStart = false;
      send({ type: "start" });
    }
    const me = msg.room.players.find((p) => p.username === getUsername());
    const prevMe = prev?.players.find((p) => p.username === getUsername());
    // Server accepted our guess → clear pending letters.
    if (me && prevMe && me.guesses.length > prevMe.guesses.length) {
      game.pending = "";
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
    // toast prominently, but DON'T burn a guess slot.
    flashShake();
    const reason = msg.reason || "not a word";
    toast(`${reason} — doesn't count, try again`, { error: true, duration: 2500 });
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
    document.title = `${game.name} — Wordle Race`;
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

  // Show the keyboard only when a guess is actually possible — keeps the lobby
  // unambiguous (no dead keys to mash) and post-game state minimal.
  const kb = $("#keyboard");
  const canType = snap.phase === "playing" && me && me.status === "playing";
  if (kb) kb.hidden = !canType;
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
  // While my board's tiles are mid-explosion, preserve the existing DOM so the
  // animations don't get nuked by a snapshot from another player's guess. Update
  // everyone else's boards as normal by removing only their nodes.
  if (game.exploding) {
    for (const board of root.querySelectorAll(".player-board")) {
      if (board.dataset.player !== getUsername()) board.remove();
    }
  } else {
    root.textContent = "";
  }
  for (const p of ordered) {
    if (game.exploding && p.username === getUsername()) continue; // keep existing exploding board
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
        }
        row.appendChild(tile);
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

function buildKeyboard() {
  const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const root = $("#keyboard");
  root.innerHTML = "";
  rows.forEach((letters, idx) => {
    const row = document.createElement("div");
    row.className = "kb-row" + (idx === 1 ? " middle" : "");
    for (const l of letters) {
      const k = document.createElement("button");
      k.className = "key";
      k.textContent = l;
      k.dataset.key = l;
      row.appendChild(k);
    }
    // Bottom row: backspace + ENTER on the right, matching iOS Return placement
    // and the universal "submit lives at the end" convention.
    if (idx === 2) {
      const back = document.createElement("button");
      back.className = "key wide";
      back.textContent = "⌫";
      back.dataset.action = "back";
      row.appendChild(back);
      const enter = document.createElement("button");
      enter.className = "key wide";
      enter.textContent = "Enter";
      enter.dataset.action = "enter";
      row.appendChild(enter);
    }
    root.appendChild(row);
  });
  root.addEventListener("click", (e) => {
    const t = e.target.closest("button.key");
    if (!t) return;
    if (t.dataset.action === "enter") submitGuess();
    else if (t.dataset.action === "back") backspace();
    else if (t.dataset.key) typeLetter(t.dataset.key);
  });
  document.addEventListener("keydown", onPhysicalKey);
}

function onPhysicalKey(e) {
  // Don't hijack typing in any input fields
  if (e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!game.snapshot || game.snapshot.phase !== "playing") return;
  const me = game.snapshot.players.find((p) => p.username === getUsername());
  if (!me || me.status !== "playing") return;

  if (e.key === "Enter") { submitGuess(); e.preventDefault(); }
  else if (e.key === "Backspace") { backspace(); e.preventDefault(); }
  else if (/^[a-zA-Z]$/.test(e.key)) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
}

function typeLetter(l) {
  if (!game.snapshot || game.snapshot.phase !== "playing") return;
  if (game.pending.length >= game.snapshot.wordLength) return;
  game.pending += l.toUpperCase();
  render();
}
function backspace() {
  if (game.pending.length === 0) return;
  game.pending = game.pending.slice(0, -1);
  render();
}
function submitGuess() {
  const len = game.snapshot?.wordLength ?? 5;
  if (game.pending.length !== len) {
    flashShake();
    toast("Not enough letters", { error: true, duration: 1400 });
    return;
  }
  const s = getSettings();
  if (s.hardMode) {
    const me = game.snapshot?.players.find((p) => p.username === getUsername());
    const violation = checkHardMode(game.pending, me?.guesses ?? []);
    if (violation) {
      flashShake();
      toast(violation, { error: true, duration: 2200 });
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

function pickJoke(arr, winnerName) {
  const j = arr[Math.floor(Math.random() * arr.length)];
  return winnerName ? j.replace("{who}", winnerName) : j;
}

function handleGameOver(snap) {
  const me = snap.players.find((p) => p.username === getUsername());
  if (!me) return;
  const won = me.status === "won";
  const guessCount = me.guesses.length;
  recordResult(won, guessCount);
  game.hasShownEndStats = true;

  if (won) {
    // Same gentle pacing as before — wait for the final row's flip to finish.
    setTimeout(
      () => openStats({ snap, me, won, justFinished: true, lastGuessCount: guessCount }),
      1700,
    );
  } else {
    // Loss: let the player's last row flip first (if they made one), THEN explode.
    const lastFlipDoneAt = guessCount > 0 ? 1500 : 200;
    setTimeout(() => triggerLoseSequence(snap, me), lastFlipDoneAt);
  }
}

function triggerLoseSequence(snap, me) {
  game.exploding = true;
  const winner = snap.winner;
  const beatenBySomeone = winner && winner !== getUsername();
  const joke = beatenBySomeone
    ? pickJoke(RACE_LOSE_JOKES, winner)
    : pickJoke(SOLO_LOSE_JOKES);

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

  $("#modalShare").onclick = () => shareResult(opts);

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

function shareResult(opts) {
  const snap = game.snapshot;
  let text = "";
  if (snap && snap.phase === "finished") {
    const me = snap.players.find((p) => p.username === getUsername());
    const guesses = me ? me.guesses.length : 0;
    const result = me?.status === "won" ? `${guesses}/6` : "X/6";
    text = `Wordle Race ${result}\n\n`;
    if (me) {
      for (const g of me.guesses) {
        text += g.mask.map((c) => c === "green" ? "🟩" : c === "yellow" ? "🟨" : "⬛").join("") + "\n";
      }
    }
    text += `\nPlay: ${location.origin}`;
  } else {
    text = `Wordle Race — race your friends!\n${location.origin}`;
  }
  if (navigator.share) {
    navigator.share({ text }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Copied to clipboard"),
    () => prompt("Copy your result:", text),
  );
}

// --- top-level UI wiring ---
document.addEventListener("DOMContentLoaded", () => {
  applySettings(getSettings());
  $("#statsBtn").addEventListener("click", () => openStats());
  $("#settingsBtn").addEventListener("click", openSettings);
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
    });
  };
  wire(hm, "hardMode");
  wire(cb, "colorBlind");
  wire(rm, "reducedMotion");

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
  document.title = `@${username} — Wordle Race`;
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
