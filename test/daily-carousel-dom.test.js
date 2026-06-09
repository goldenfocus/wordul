// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initDailyCarousel } from "../public/daily-carousel.js";

// Two days of history: today + yesterday. The controller fetches the past day's word +
// leaderboard on landing; stub both so the past card renders without a network.
const TODAY = "2026-06-08";
const YESTERDAY = "2026-06-07";

function stubFetch() {
  return vi.fn((url) => {
    if (url.includes("/api/daily/word")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ date: YESTERDAY, word: "CRANE", themeId: "default" }) });
    }
    if (url.includes("/leaderboard")) {
      // computeDailyStatsFromRoster reads full.players — one solved player → played 1, 100%.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ players: [{ username: "a", won: true, guesses: 4 }], total: 1 }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

function mount() {
  document.body.innerHTML = `
    <section id="root">
      <header id="head">
        <button id="dailyPrev" hidden>‹</button>
        <h1 id="dailyCarDate"></h1>
        <button id="dailyNext" hidden>›</button>
      </header>
      <div id="dailyCarSlot">
        <div id="dailyToday">TODAY CARD</div>
        <div id="dailyPast" hidden></div>
      </div>
    </section>`;
  return document.getElementById("root");
}

const deps = () => ({
  dates: [YESTERDAY, TODAY],
  shortDate: (d) => d,
  editionName: (id) => (id === "default" ? "Aurora" : id),
  pastRecord: () => null,                 // didn't play yesterday → Play-it affordance
  navigate: vi.fn(),
  onPlayDate: vi.fn(),
});

describe("daily carousel (DOM integration)", () => {
  beforeEach(() => { global.fetch = stubFetch(); });

  it("starts on today: back-arrow revealed, forward-arrow hidden, today card visible", () => {
    const root = mount();
    initDailyCarousel(root, deps());
    expect(document.getElementById("dailyPrev").hidden).toBe(false);
    expect(document.getElementById("dailyNext").hidden).toBe(true);
    expect(document.getElementById("dailyToday").hidden).toBe(false);
    expect(document.getElementById("dailyPast").hidden).toBe(true);
  });

  it("clicking back renders yesterday's past card (answer + stats), then forward returns to today", async () => {
    const root = mount();
    initDailyCarousel(root, deps());

    document.getElementById("dailyPrev").click();        // → yesterday
    await Promise.resolve(); await Promise.resolve();    // let the two awaits in fetchDay settle
    await new Promise((r) => setTimeout(r, 0));

    const past = document.getElementById("dailyPast");
    expect(past.hidden).toBe(false);
    expect(document.getElementById("dailyToday").hidden).toBe(true);
    expect(past.innerHTML).toContain("CRANE");           // revealed answer
    expect(past.innerHTML).not.toContain("data-past-play"); // read-only — no replay-for-gold
    expect(document.getElementById("dailyNext").hidden).toBe(false); // forward now offered
    expect(document.getElementById("dailyCarDate").textContent).toContain("Aurora"); // date · theme

    document.getElementById("dailyNext").click();        // → back to today
    expect(document.getElementById("dailyToday").hidden).toBe(false);
    expect(document.getElementById("dailyPast").hidden).toBe(true);
    expect(document.getElementById("dailyNext").hidden).toBe(true);
  });

  it("back-arrow disables at the oldest day", async () => {
    const root = mount();
    initDailyCarousel(root, deps());
    document.getElementById("dailyPrev").click();        // oldest (only 2 days)
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("dailyPrev").disabled).toBe(true);
  });
});
