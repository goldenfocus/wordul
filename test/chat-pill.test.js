// Lobby chat pill model — collapsed until real conversation exists; system noise
// never expands it; an explicit user close outranks auto-expansion.
// Iter3 §4 adds the Chat ⇄ Status split: routeChatEntry decides which pane an
// entry lands in, chatPillReaction is the expand-vs-blink attention matrix, and
// formatChatTime renders the muted HH:MM stamps on status lines.
import { describe, it, expect } from "vitest";
import {
  chatPillOpen,
  chatHasUserText,
  createChatPill,
  routeChatEntry,
  chatPillReaction,
  formatChatTime,
} from "../public/chat-pill.js";

describe("chatPillOpen", () => {
  it("is closed by default in a quiet room", () => {
    expect(chatPillOpen({ manual: null, hasText: false })).toBe(false);
  });

  it("opens when real text exists", () => {
    expect(chatPillOpen({ manual: null, hasText: true })).toBe(true);
  });

  it("user open wins without text", () => {
    expect(chatPillOpen({ manual: "open", hasText: false })).toBe(true);
  });

  it("user close outranks text", () => {
    expect(chatPillOpen({ manual: "closed", hasText: true })).toBe(false);
  });
});

describe("chatHasUserText", () => {
  it("system lines are not conversation", () => {
    expect(
      chatHasUserText([
        { kind: "system", text: "wordul set the table to 3 seats" },
        { kind: "system", text: "wordul joined" },
      ]),
    ).toBe(false);
  });

  it("a real message with text is", () => {
    expect(
      chatHasUserText([
        { kind: "system", text: "wordul joined" },
        { from: "maya", text: "gl!" },
      ]),
    ).toBe(true);
  });

  it("blank or missing chat stays quiet", () => {
    expect(chatHasUserText([])).toBe(false);
    expect(chatHasUserText(undefined)).toBe(false);
    expect(chatHasUserText([{ from: "maya", text: "   " }])).toBe(false);
  });
});

describe("createChatPill", () => {
  const harness = () => {
    const calls = [];
    const pill = createChatPill((open) => calls.push(open));
    return { pill, calls };
  };

  it("auto-expands when conversation arrives, and only syncs on change", () => {
    const { pill, calls } = harness();
    pill.setHasText(false); // no change from initial — no sync
    expect(calls).toEqual([]);
    pill.setHasText(true);
    expect(calls).toEqual([true]);
    expect(pill.isOpen()).toBe(true);
  });

  it("toggle flips and records the user's word", () => {
    const { pill } = harness();
    pill.setHasText(true); // auto-open
    pill.toggle(); // user closes — sticks
    expect(pill.isOpen()).toBe(false);
    pill.setHasText(true); // more messages do NOT reopen
    expect(pill.isOpen()).toBe(false);
    pill.toggle(); // user reopens
    expect(pill.isOpen()).toBe(true);
  });

  it("opens manually in a quiet room", () => {
    const { pill } = harness();
    pill.toggle();
    expect(pill.isOpen()).toBe(true);
  });

  it("reset returns to quiet-closed", () => {
    const { pill } = harness();
    pill.toggle();
    pill.setHasText(true);
    pill.reset();
    expect(pill.isOpen()).toBe(false);
  });
});

// §4 Chat ⇄ Status split — which pane does an entry render in?
describe("routeChatEntry", () => {
  it("system lines go to the Status pane", () => {
    expect(routeChatEntry({ kind: "system", text: "maya set the table to 3 seats" })).toBe("status");
    expect(routeChatEntry({ kind: "system", text: "maya got it in 4!" })).toBe("status");
  });

  it("user messages go to the Chat pane", () => {
    expect(routeChatEntry({ kind: "user", from: "maya", text: "gl!" })).toBe("chat");
    expect(routeChatEntry({ from: "maya", text: "no kind field, still chat" })).toBe("chat");
  });

  it("legacy persisted presence noise is dropped entirely", () => {
    expect(routeChatEntry({ kind: "system", text: "maya joined" })).toBe("drop");
    expect(routeChatEntry({ kind: "system", text: "maya left" })).toBe("drop");
    expect(routeChatEntry({ kind: "system", text: "maya reconnected" })).toBe("drop");
    expect(routeChatEntry(undefined)).toBe("drop");
  });
});

// §4 attention matrix — expand on a real message, blink (never force-open) when the
// manual-close latch holds, and status/system lines never ping anything.
describe("chatPillReaction", () => {
  const quiet = { manual: null, hasText: false };
  const latched = { manual: "closed", hasText: true };
  const msg = { kind: "user", from: "maya", text: "gl!" };

  it("a real message in a quiet room expands", () => {
    expect(chatPillReaction(quiet, msg)).toBe("expand");
  });

  it("a real message while manually closed blinks instead of force-opening", () => {
    expect(chatPillReaction(latched, msg)).toBe("blink");
  });

  it("an open pill needs no attention", () => {
    expect(chatPillReaction({ manual: "open", hasText: false }, msg)).toBe("none");
    expect(chatPillReaction({ manual: null, hasText: true }, msg)).toBe("none");
  });

  it("system lines NEVER expand or blink", () => {
    const sys = { kind: "system", text: "maya set the table to 3 seats" };
    expect(chatPillReaction(quiet, sys)).toBe("none");
    expect(chatPillReaction(latched, sys)).toBe("none");
  });

  it("blank messages do nothing", () => {
    expect(chatPillReaction(quiet, { from: "maya", text: "   " })).toBe("none");
    expect(chatPillReaction(latched, undefined)).toBe("none");
  });

  it("my own message never blinks at me", () => {
    expect(chatPillReaction(latched, msg, { mine: true })).toBe("none");
  });
});

// Muted HH:MM stamps on status lines (local time, zero-padded, deterministic).
describe("formatChatTime", () => {
  it("zero-pads hours and minutes", () => {
    expect(formatChatTime(new Date(2026, 5, 7, 9, 5).getTime())).toBe("09:05");
    expect(formatChatTime(new Date(2026, 5, 7, 14, 32).getTime())).toBe("14:32");
  });

  it("garbage in, empty string out", () => {
    expect(formatChatTime(NaN)).toBe("");
    expect(formatChatTime(undefined)).toBe("");
  });
});

// Controller: notify() drives the attention matrix — blink fires the callback
// without opening; expand opens; system is silent.
describe("createChatPill notify", () => {
  const harness = () => {
    const opens = [];
    let blinks = 0;
    const pill = createChatPill((open) => opens.push(open), () => blinks++);
    return { pill, opens, blinks: () => blinks };
  };

  it("expands on a real message in a quiet room", () => {
    const { pill, blinks } = harness();
    pill.notify({ kind: "user", from: "maya", text: "gl!" });
    expect(pill.isOpen()).toBe(true);
    expect(blinks()).toBe(0);
  });

  it("blinks — and stays closed — when the manual latch holds", () => {
    const { pill, blinks } = harness();
    pill.setHasText(true); // auto-open
    pill.toggle(); // user closes — latch
    pill.notify({ kind: "user", from: "maya", text: "you there?" });
    expect(pill.isOpen()).toBe(false);
    expect(blinks()).toBe(1);
  });

  it("system lines never blink, expand, or sync", () => {
    const { pill, opens, blinks } = harness();
    pill.notify({ kind: "system", text: "maya set the table to 3 seats" });
    expect(pill.isOpen()).toBe(false);
    expect(opens).toEqual([]);
    expect(blinks()).toBe(0);
  });
});
