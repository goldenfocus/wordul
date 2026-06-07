// Lobby chat pill model — collapsed until real conversation exists; system noise
// never expands it; an explicit user close outranks auto-expansion.
import { describe, it, expect } from "vitest";
import { chatPillOpen, chatHasUserText, createChatPill } from "../public/chat-pill.js";

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
