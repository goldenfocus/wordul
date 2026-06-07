// Lobby chat pill — the chat collapses to a "▸ Chat" chevron row until there is
// actual conversation (design feedback, Jun 7: "only show the big box if there's
// actual text there"). System lines (joined / set the table to N seats) never
// count as conversation; a real user message auto-expands the pill.
//
// State model (pure, testable):
//   hasText — does the room's chat contain at least one non-system message?
//   manual  — the user's explicit override: null | "open" | "closed"
// The pill is open iff the user said open, or there's real text and the user
// hasn't explicitly closed it.

export function chatPillOpen({ manual, hasText }) {
  if (manual === "open") return true;
  if (manual === "closed") return false;
  return !!hasText;
}

// True when the chat snapshot holds at least one real (non-system) message with text.
export function chatHasUserText(chat) {
  return (chat || []).some((e) => e.kind !== "system" && (e.text || "").trim().length > 0);
}

// ── §4 Chat ⇄ Status split ────────────────────────────────────────────────────

// Which pane does a chat entry render in? System lines (table events, game
// notices) live in the quiet Status tab; user messages are the Chat pane.
// Presence noise is no longer emitted by the server, but rooms persisted before
// that change still carry old joined/left/reconnected lines — drop those outright.
const PRESENCE_NOISE = /\b(joined|left|reconnected)$/;
export function routeChatEntry(entry) {
  if (!entry) return "drop";
  if (entry.kind === "system") {
    return PRESENCE_NOISE.test(entry.text || "") ? "drop" : "status";
  }
  return "chat";
}

// Attention matrix for an arriving entry. Status/system lines NEVER expand,
// blink, badge, or ping anything. A real message auto-expands a quiet pill —
// but if the user's manual-close latch holds, we pulse ("blink") the collapsed
// "▸ Chat" row instead of force-opening over their explicit choice.
export function chatPillReaction(state, entry, { mine = false } = {}) {
  if (routeChatEntry(entry) !== "chat") return "none";
  if (!(entry.text || "").trim()) return "none";
  if (chatPillOpen(state)) return "none"; // already on screen
  if (state.manual === "closed") return mine ? "none" : "blink";
  return "expand";
}

// Muted HH:MM stamp for status (and transcript) lines — local time, zero-padded,
// locale-independent so it's deterministic under test.
export function formatChatTime(t) {
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Stateful controller around the pure model. `sync` is called with the resolved
// open state — the caller owns the DOM (app.js toggles .chat-open on #chatPanel).
// `onBlink` (optional) fires when an arriving message should pulse the collapsed
// pill instead of opening it (see chatPillReaction).
export function createChatPill(sync, onBlink) {
  let state = { manual: null, hasText: false };
  const apply = () => sync(chatPillOpen(state));
  const setHasText = (hasText) => {
    if (state.hasText === hasText) return;
    state = { ...state, hasText };
    apply();
  };
  return {
    // Feed the latest chat snapshot; auto-expands on the first real message.
    setHasText,
    // An entry just arrived: expand, blink, or stay quiet per the matrix.
    notify(entry, opts) {
      const reaction = chatPillReaction(state, entry, opts);
      if (reaction === "expand") setHasText(true);
      else if (reaction === "blink") onBlink?.();
    },
    // Pill tap: flip the CURRENT resolved state and record it as the user's word.
    toggle() {
      state = { ...state, manual: chatPillOpen(state) ? "closed" : "open" };
      apply();
    },
    // New room: forget overrides and history.
    reset() {
      state = { manual: null, hasText: false };
      apply();
    },
    isOpen() {
      return chatPillOpen(state);
    },
  };
}
