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

// Stateful controller around the pure model. `sync` is called with the resolved
// open state — the caller owns the DOM (app.js toggles .chat-open on #chatPanel).
export function createChatPill(sync) {
  let state = { manual: null, hasText: false };
  const apply = () => sync(chatPillOpen(state));
  return {
    // Feed the latest chat snapshot; auto-expands on the first real message.
    setHasText(hasText) {
      if (state.hasText === hasText) return;
      state = { ...state, hasText };
      apply();
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
