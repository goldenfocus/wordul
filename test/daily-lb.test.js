// @vitest-environment jsdom
// The golden card's leaderboard: top-3+you medals, Show-all roster (scroll past 25),
// and tap-a-row → modal replay (Task 7's describe lives here too).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountDailyLeaderboard } from "../public/daily-lb.js";

const entry = (username, gold, over = {}) => ({
  username, gold, guesses: 3, won: true, grid: ["xxxxx", "ggggg"], words: ["SLOTH", "PENNE"], ...over,
});
const topView = {
  top: [entry("ada", 400), entry("bob", 300), entry("cyd", 200)],
  you: { ...entry("yan", 150), rank: 7 },
  total: 40,
};
const fullView = {
  players: Array.from({ length: 40 }, (_, i) => ({ ...entry(`p${i}`, 400 - i), rank: i + 1 })),
  youRank: 7, total: 40,
};

function mockFetch() {
  return vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes("full=1") ? fullView : topView),
  }));
}

beforeEach(() => {
  document.body.innerHTML = `<div id="dailyLeaderboard" hidden></div>`;
  localStorage.setItem("wr.dailyToken:2026-06-06", "tok-1");
  globalThis.fetch = mockFetch();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("mountDailyLeaderboard", () => {
  it("renders top-3 medals + pinned you, with a Show-all footer", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(mount.hidden).toBe(false);
    expect(mount.querySelectorAll(".daily-top-row").length).toBe(4); // 3 medals + pinned you
    expect(mount.querySelector(".daily-top-row.is-pinned .daily-top-rank").textContent).toBe("#7");
    expect(mount.querySelector("#dailyLbShowAll").textContent).toContain("40");
    // The finisher token rides the request — letters unlock server-side.
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain("t=tok-1");
  });

  it("is idempotent per mount (renderDailyUnlock runs per snapshot)", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(globalThis.fetch.mock.calls.length).toBe(1);
  });

  it("Show-all expands to the full roster with the scroll class past 25 rows", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector("#dailyLbShowAll").click();
    await flush();
    expect(String(globalThis.fetch.mock.calls[1][0])).toContain("full=1");
    const roster = mount.querySelector(".daily-lb-roster");
    expect(roster.querySelectorAll(".daily-top-row").length).toBe(40);
    expect(roster.classList.contains("is-scroll")).toBe(true); // >25 rows → internal scroll
    expect(mount.querySelector("#dailyLbShowAll")).toBeNull(); // footer consumed
  });

  it("a failed fetch leaves the mount hidden (recap still renders without it)", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false }));
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(mount.hidden).toBe(true);
  });
});

describe("openReplayModal — no orphaned keydown listeners on replace", () => {
  // Regression: opening bob's modal while ada's is open used to evict ada's via .remove()
  // without calling close(), leaving ada's keydown listener alive on document. A later Escape
  // would fire that orphaned listener and try to return focus to ada's row.
  it("evicts via close() so no orphaned listener remains after replace + dismiss", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();

    const adaRow = mount.querySelector('[data-user="ada"]');
    const bobRow = mount.querySelector('[data-user="bob"]');

    // Open ada's modal by clicking her row (grid is present in topView entries).
    adaRow.click();
    expect(document.getElementById("dailyLbModal")).not.toBeNull();

    // Open bob's modal — this should evict ada's through close() (not raw .remove()).
    bobRow.click();
    const bobModal = document.getElementById("dailyLbModal");
    expect(bobModal).not.toBeNull();
    // Ada's modal is gone.
    expect(document.querySelectorAll(".daily-lb-modal").length).toBe(1);

    // Dismiss bob's modal via Escape — focus should return to bob's row.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("dailyLbModal")).toBeNull();
    expect(document.activeElement).toBe(bobRow);

    // A second Escape must NOT move focus to ada's row — her listener was cleaned up.
    adaRow.blur();
    bobRow.blur();
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).not.toBe(adaRow);
  });
});
