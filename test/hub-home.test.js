// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHub, homeTypeLetter } from "../public/hub.js";

// Minimal DOM the hub render touches (topbar stat glyphs + the mount points).
function setupDom() {
  document.body.innerHTML = `
    <span id="hubGoldVal"></span>
    <span id="hubStreak" hidden><span id="hubStreakVal"></span></span>
    <div id="hub" hidden><main id="hubContent"></main></div>`;
}

function makeCallbacks(over = {}) {
  return {
    username: "yan",
    editions: [{ id: "default" }, { id: "tactile" }, { id: "arcade" }],
    editionName: (id) => ({ tactile: "Tactile", arcade: "Arcade" }[id] || id),
    onPlay: vi.fn(),
    onSolo: vi.fn(),
    onPvP: vi.fn(),
    onStats: vi.fn(),
    onShareDaily: vi.fn(),
    fetchPlayed: () => Promise.resolve(null),
    renderRecentRooms: () => {},
    ...over,
  };
}

describe("hub home (redesign)", () => {
  beforeEach(() => setupDom());

  it("renders the new daily card with identity on top — and NO emoji", () => {
    renderHub({ gold: 0, stats: { currentStreak: 0 } }, makeCallbacks());
    const html = document.getElementById("hubContent").innerHTML;
    expect(document.getElementById("dailyCard")).toBeTruthy();
    expect(document.querySelector(".daily-head .daily-kicker")).toBeTruthy();
    expect(document.getElementById("modeSolo")).toBeTruthy();
    expect(document.getElementById("modePvP")).toBeTruthy();
    expect(document.getElementById("dailyStats")).toBeTruthy();
    // No instructional copy, no OS emoji on this surface.
    expect(html).not.toMatch(/start typing/i);
    expect(html).not.toMatch(/[⚡\u{1F465}\u{1F4CA}▶]/u); // ⚡ 👥 📊 ▶
  });

  it("tap plays today's word; Stats goes to its own page (not the card)", () => {
    const cb = makeCallbacks();
    renderHub({}, cb);
    document.getElementById("dailyCard").click();
    expect(cb.onPlay).toHaveBeenCalledTimes(1);
    expect(cb.onPlay.mock.calls[0][1]).toBeUndefined(); // tap = no seed

    cb.onPlay.mockClear();
    document.getElementById("dailyStats").click();
    expect(cb.onStats).toHaveBeenCalledTimes(1);
    expect(cb.onPlay).not.toHaveBeenCalled(); // stopPropagation: card didn't also fire
  });

  it("type-to-play seeds the board with the typed letter", () => {
    const cb = makeCallbacks();
    renderHub({}, cb);
    homeTypeLetter("G");
    expect(cb.onPlay).toHaveBeenCalledTimes(1);
    expect(cb.onPlay.mock.calls[0][1]).toBe("G");
  });

  it("fills a real played count when one arrives, else stays 'Stats'", async () => {
    renderHub({}, makeCallbacks({ fetchPlayed: () => Promise.resolve(1248) }));
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById("dailyStatsLabel").textContent).toBe("1,248 played");
  });

  it("after you've played today, shows the post-play recap — result + countdown + share, no play card", () => {
    const cb = makeCallbacks({ dailyResult: { won: true, guesses: 4 } });
    renderHub({}, cb);
    expect(document.getElementById("dailyCard")).toBeNull();           // no replay surface
    expect(document.querySelector(".daily-done")).toBeTruthy();
    expect(document.querySelector(".daily-result-text").textContent).toMatch(/Solved in 4/);
    expect(document.getElementById("dailyCountdown")).toBeTruthy();

    document.getElementById("dailyStats").click();
    expect(cb.onStats).toHaveBeenCalledTimes(1);
    document.getElementById("dailyShare").click();
    expect(cb.onShareDaily).toHaveBeenCalledTimes(1);

    // Typing must NOT start a game once today's done.
    homeTypeLetter("G");
    expect(cb.onPlay).not.toHaveBeenCalled();
  });

  it("a loss reads calmly ('Missed today'), still no play card", () => {
    renderHub({}, makeCallbacks({ dailyResult: { won: false, guesses: 6 } }));
    expect(document.getElementById("dailyCard")).toBeNull();
    expect(document.querySelector(".daily-result.is-lost")).toBeTruthy();
    expect(document.querySelector(".daily-result-text").textContent).toMatch(/Missed today/);
  });
});
