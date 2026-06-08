// @vitest-environment jsdom
// The golden card's leaderboard: top-3+you medals, Show-all roster (scroll past 25),
// and tap-a-row → modal replay (Task 7's describe lives here too).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountDailyLeaderboard, openReplayModal } from "../public/daily-lb.js";

const entry = (username, gold, over = {}) => ({
  username, gold, guesses: 3, won: true, grid: ["xxxxx", "ggggg"], words: ["SLOTH", "PENNE"], durationMs: 171000, ...over,
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

  it("your row is plain @name (accented in CSS) — never a 'you (@name)' prefix", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    const you = mount.querySelector(".daily-top-row.is-you .daily-top-name");
    expect(you.textContent).toBe("@yan");
    expect(mount.textContent).not.toContain("you (@");
  });

  it("links to the day's full recap (stats page)", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(mount.querySelector(".daily-lb-recap").getAttribute("href")).toBe("/daily/2026-06-06/stats");
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

describe("replay popup", () => {
  beforeEach(() => {
    // jsdom has no matchMedia; stub it so playStampReplay doesn't bail on the guard.
    globalThis.matchMedia = () => ({ matches: false });
  });

  it("tapping a row opens an auto-playing modal with that player's board", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector('.daily-top-row[data-user="ada"]').click();
    const modal = document.getElementById("dailyLbModal");
    expect(modal).toBeTruthy();
    expect(modal.querySelector('[role="dialog"]').getAttribute("aria-label")).toContain("ada");
    const stamp = modal.querySelector(".daily-stamp");
    expect(stamp).toBeTruthy();
    expect(stamp.classList.contains("has-letters")).toBe(true);   // finisher → real letters
    expect(stamp.querySelectorAll(".is-veiled").length).toBeGreaterThan(0); // replay started
  });

  it("the modal head tells the full story — result AND solve time (rows stay minimal)", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector('.daily-top-row[data-user="ada"]').click();
    const head = document.querySelector(".daily-lb-modal-head");
    expect(head.querySelector(".daily-top-guesses").textContent).toContain("in 3");
    expect(head.querySelector(".daily-lb-modal-time").textContent).toBe("2m 51s"); // 171000ms
  });

  it("Esc closes and focus returns to the opener row", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    const row = mount.querySelector('.daily-top-row[data-user="ada"]');
    row.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("dailyLbModal")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("scrim tap closes; a second row tap replaces the modal", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector('.daily-top-row[data-user="ada"]').click();
    mount.querySelector('.daily-top-row[data-user="bob"]').click();
    const modals = document.querySelectorAll(".daily-lb-modal");
    expect(modals.length).toBe(1); // never stacks
    modals[0].click(); // scrim
    expect(document.getElementById("dailyLbModal")).toBeNull();
  });
});

describe("real-solve tape mode", () => {
  beforeEach(() => {
    globalThis.matchMedia = () => ({ matches: false }); // playStampReplay's guard (jsdom has none)
  });
  // Closing through the modal's own ✕ keeps the keydown lifecycle clean between tests.
  const dismiss = (overlay) => overlay.querySelector(".daily-lb-modal-close").click();

  it("shows the watch-the-real-solve button only when the tape endpoint 200s", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [[0, "k", "C"]] }) });
    const overlay = openReplayModal(entry("yan", 120), null, { date: "2026-06-07", token: "secret-123" });
    await flush(); // let the tape fetch settle
    expect(String(globalThis.fetch.mock.calls[0][0])).toBe("/api/daily/2026-06-07/tape?u=yan&t=secret-123");
    expect(overlay.querySelector(".tape-mode-btn")).toBeTruthy();
    dismiss(overlay);
  });

  it("stays in synthetic mode when there is no tape (404) or no token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const withToken = openReplayModal(entry("bob", 0, { won: false }), null, { date: "2026-06-07", token: "secret-123" });
    await flush();
    expect(withToken.querySelector(".tape-mode-btn")).toBeNull();
    dismiss(withToken);
    const noOpts = openReplayModal(entry("bob", 0, { won: false }), null); // stats page path — no opts at all
    await flush();
    expect(noOpts.querySelector(".tape-mode-btn")).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no token → no fetch
    dismiss(noOpts);
  });
});
